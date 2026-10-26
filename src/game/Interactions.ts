import * as THREE from 'three';
import { G_WORLD } from '../core/Physics.ts';
import type { Opening } from '../map/MapBuilder.ts';
import type { Soldier, SoldierInput } from './Soldier.ts';
import type { World } from './World.ts';
import { Stance } from './types.ts';
import { AMMO_CRATES } from '../map/houseProps.ts';
import { FLOOR_Y } from '../map/houseLayout.ts';
import type { Panel } from '../world/Destruction.ts';

interface Candidate {
  key: string;
  label: string;
  /** seconds to hold; 0 = press */
  hold: number;
  run: () => void;
}

const BARRICADE_BASE = 60000;

/**
 * Context-sensitive [F] interactions: objectives, barricading (defenders),
 * vaulting through windows, steel reinforcement of soft walls / hatches
 * (2 per defender per round), hooking a rappel rope (attackers) and the
 * rappel Breach & Swing through a window.
 */
export class Interactions {
  private held = new Map<string, { key: string; t: number }>();
  private rappelHint = new Map<string, { t: number; ok: boolean }>();

  constructor(private world: World) {}

  /** nearest opening the soldier is looking at */
  openingInFront(s: Soldier, maxDist = 1.7): Opening | null {
    const eye = s.eye();
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    let best: Opening | null = null;
    let bestD = maxDist;
    for (const op of this.world.house.openings) {
      if (op.kind === 'vent') continue;
      const c = op.center;
      if (Math.abs(c.y - eye.y) > op.h / 2 + 1.2) continue;
      // distance to opening plane & lateral offset
      const n = op.normal;
      const toC = c.clone().sub(eye);
      const plane = Math.abs(toC.dot(n));
      const lat = Math.abs(toC.x * n.z - toC.z * n.x);
      if (lat > op.w / 2 + 0.25 || plane > bestD) continue;
      const flat = toC.clone().setY(0);
      if (flat.lengthSq() > 0.01 && flat.normalize().dot(fwd) < 0.35) continue;
      best = op;
      bestD = plane;
    }
    return best;
  }

  panelInFront(s: Soldier, maxDist = 1.9): { panel: Panel; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const hit = this.world.physics.raycast(s.eye(), s.aimDir(), maxDist, G_WORLD);
    if (!hit || hit.tag?.kind !== 'panel') return null;
    const panel = this.world.destruction.get(hit.tag.panelId);
    return panel ? { panel, point: hit.point, normal: hit.normal } : null;
  }

  private resupplied = new Map<string, number>();

  private candidate(s: Soldier): Candidate | null {
    if (s.mode !== 'normal') return null;
    const obj = this.world.objectives.candidate(s);
    if (obj) return obj;
    // Tachanka: mount the LMG from behind it
    if (s.op.gadget === 'turret' && !s.mounted) {
      const t = this.world.gadgets.turretNear(s);
      if (t) {
        return {
          key: `mount${t.id}`, label: 'action.mount', hold: 0, run: () => {
            const yaw = t.data.yaw as number;
            const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
            t.data.gunner = s.id;
            s.mountTurret(t.id, t.pos.clone().addScaledVector(fwd, -0.6), yaw);
          },
        };
      }
    }
    // ammo crates (resupply, 30 s cooldown per soldier)
    const fy = s.pos.y;
    for (const p of AMMO_CRATES) {
      const py = FLOOR_Y[p.floor];
      if (Math.abs(py - fy) > 0.6) continue;
      const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
      if (d > 1.35) continue;
      const k = `${s.id}:${p.x},${p.z}`;
      const full = s.weapons.every((w) => w.reserve >= w.def.reserve && w.mag >= w.def.mag);
      if (full || (this.resupplied.get(k) ?? -99) > this.world.time) return { key: 'ammofull', label: 'action.ammoFull', hold: 0, run: () => {} };
      return {
        key: `ammo${k}`, label: 'action.ammo', hold: 0.8, run: () => {
          for (const w of s.weapons) { w.reserve = w.def.reserve; if (w.mag < w.def.mag) w.mag = w.def.mag; }
          this.resupplied.set(k, this.world.time + 30);
          this.world.sound({ type: 'gadget', pos: s.pos.clone(), radius: 6, source: s.id, intensity: 0.3, label: 'resupply' });
        },
      };
    }
    const defender = s.side === 'defend' || s.side === 'terrorist';
    const op = this.openingInFront(s);
    if (op) {
      if (op.barricadePanel === null && op.barricadeable && defender && s.op.universal === 'barricade' && this.world.phase !== 'over') {
        const what = op.kind === 'window' || op.kind === 'french' ? 'action.barricadeWindow' : 'action.barricadeDoor';
        return { key: `bar${op.id}`, label: what, hold: 1.4, run: () => this.placeBarricade(op, 'wood', true) };
      }
    }
    if (defender && s.reinforcementsLeft > 0) {
      const ph = this.panelInFront(s);
      // spec #15: shot-up / breached soft walls can still be reinforced; a section Thermite burnt through cannot
      if (ph && ph.panel.reinforceable && !ph.panel.reinforced && !ph.panel.thermited) {
        return { key: `rf${ph.panel.id}`, label: `action.reinforce|${s.reinforcementsLeft}`, hold: 2.5, run: () => this.reinforce(s, ph.panel, true) };
      }
    }
    // generic vault / climb (any obstacle under the height limit: sills, breached wall lips, rails, counters)
    const v = s.probeVault();
    if (v) return { key: 'vault', label: v.over ? 'action.vault' : 'action.climb', hold: 0, run: () => s.tryVault() };
    if (s.side === 'attack') {
      // throttled dry-run of the rope hook so the HUD can offer "[F] Rappel"
      const h = this.rappelHint.get(s.id);
      let ok = h?.ok ?? false;
      if (!h || this.world.time - h.t > 0.3) { ok = s.startRappel(true); this.rappelHint.set(s.id, { t: this.world.time, ok }); }
      return { key: 'rappel', label: ok ? 'action.rappel' : '', hold: 0, run: () => s.startRappel() };
    }
    return null;
  }

  update(s: Soldier, dt: number, inp: SoldierInput) {
    const c = this.candidate(s);
    const st = this.held.get(s.id);
    s.interactLabel = c?.label ?? (s.mode === 'rappel' ? 'action.rappelHelp' : '');
    if (!c) { this.held.delete(s.id); s.interactProgress = 0; return; }
    if (c.hold === 0) {
      s.interactProgress = 0;
      if (inp.interactPressed) c.run();
      return;
    }
    if (inp.interact) {
      if (!st || st.key !== c.key) this.held.set(s.id, { key: c.key, t: 0 });
      const h = this.held.get(s.id)!;
      h.t += dt;
      s.interactProgress = Math.min(1, h.t / c.hold);
      if (h.t >= c.hold) {
        this.held.delete(s.id);
        s.interactProgress = 0;
        c.run();
      }
    } else {
      this.held.delete(s.id);
      s.interactProgress = 0;
    }
  }

  /* ------------------------------------------------------------- barricades */
  placeBarricade(op: Opening, kind: 'wood' | 'castle', broadcast: boolean) {
    const d = this.world.destruction;
    if (op.barricadePanel !== null) d.remove(op.barricadePanel);
    op.barricadeGen++;
    const id = BARRICADE_BASE + op.id * 64 + (op.barricadeGen % 64);
    const t = kind === 'castle' ? 0.1 : 0.05;
    if (op.run === 'd') return;
    // door barricades keep an 18–20 cm gap at the bottom (drones roll under, prone players see feet)
    const hw = op.w / 2, y0 = op.center.y - op.h / 2 + (kind === 'wood' ? op.gap : 0), y1 = op.center.y + op.h / 2;
    const min: [number, number, number] = op.run === 'x' ? [op.center.x - hw, y0, op.c - t / 2] : [op.c - t / 2, y0, op.center.z - hw];
    const max: [number, number, number] = op.run === 'x' ? [op.center.x + hw, y1, op.c + t / 2] : [op.c + t / 2, y1, op.center.z + hw];
    d.add({ kind: kind === 'castle' ? 'castle' : 'barricade', min, max, nAx: op.run === 'x' ? 2 : 0, label: `${op.label} ${kind === 'castle' ? 'Armor Panel' : 'Barricade'}`, openingId: op.id, exterior: op.exterior, rooms: op.rooms }, id);
    op.barricadePanel = id;
    op.barricadeKind = kind;
    this.world.sound({ type: 'barricade', pos: op.center.clone(), radius: 14, source: 'barricade', intensity: 0.5, label: 'place' });
    if (broadcast) this.world.emit({ t: 'barricade', opening: op.id, kind });
  }

  removeBarricade(op: Opening) {
    if (op.barricadePanel !== null) this.world.destruction.remove(op.barricadePanel);
    op.barricadePanel = null;
    op.barricadeKind = 'none';
  }

  /** drop destroyed barricade panels */
  sweep() {
    for (const op of this.world.house.openings) {
      if (op.barricadePanel === null) continue;
      const p = this.world.destruction.get(op.barricadePanel);
      if (!p || p.destroyed) {
        if (p) this.world.sound({ type: 'barricade', pos: op.center.clone(), radius: 25, source: 'barricade', intensity: 0.8, label: 'break' });
        this.removeBarricade(op);
      }
    }
  }

  reinforce(s: Soldier | null, panel: Panel, broadcast: boolean) {
    if (panel.reinforced || panel.thermited) return;
    // the steel plate covers whatever was shot out of the plaster
    if (panel.brokenCount > 0) panel.resetSkin();
    panel.reinforced = true;
    panel.dirty = true;
    if (s) s.reinforcementsLeft--;
    this.world.sound({ type: 'gadget', pos: panel.center, radius: 18, source: s?.id ?? 'reinforce', intensity: 0.6, label: 'reinforce' });
    if (broadcast) this.world.emit({ t: 'reinforce', panel: panel.id, by: s?.id ?? '' });
  }

  /* ------------------------------------------------------------- swing */
  /** Rappel Breach & Swing: kick through the window in front, smashing a wooden barricade. */
  trySwing(s: Soldier): boolean {
    if (!s.rappel) return false;
    const n = s.rappel.n;
    const eye = s.eye();
    let best: Opening | null = null;
    let bestD = 1.4;
    for (const op of this.world.house.openings) {
      if (!op.exterior || !(op.kind === 'window' || op.kind === 'open_window' || op.kind === 'french')) continue;
      const toC = op.center.clone().sub(eye);
      const lat = Math.abs(toC.x * op.normal.z - toC.z * op.normal.x);
      if (lat > op.w / 2 + 0.35) continue;
      const vert = s.pos.y - (op.center.y - op.h / 2);
      if (vert < -1.3 || vert > 0.6) continue;
      const plane = Math.abs(toC.dot(op.normal));
      if (plane < bestD) { best = op; bestD = plane; }
    }
    if (!best || best.barricadeKind === 'castle') return false;
    const op = best;
    const out = s.pos.clone().addScaledVector(n, 1.3).add(new THREE.Vector3(0, 0.4, 0));
    const inside = op.center.clone().addScaledVector(n, -0.9);
    const fl = this.world.physics.raycast(inside.clone().setY(op.center.y), new THREE.Vector3(0, -1, 0), 4, G_WORLD);
    inside.y = fl ? fl.point.y : op.floorY;
    s.playMove(s.pos, out, inside, 0.85, Stance.Crouch, () => {
      if (op.barricadePanel !== null) {
        const p = this.world.destruction.get(op.barricadePanel);
        if (p) {
          const res = this.world.destruction.impactAndApply('swing', p.center, p);
          this.world.combat.emitCells(res.events);
        }
      }
      this.world.sound({ type: 'breach', pos: op.center.clone(), radius: 25, source: s.id, intensity: 0.8, label: 'swing' });
    });
    return true;
  }

  /** apply a remote barricade event */
  remoteBarricade(openingId: number, kind: 'wood' | 'castle' | 'none') {
    const op = this.world.house.openings[openingId];
    if (!op) return;
    if (kind === 'none') this.removeBarricade(op);
    else this.placeBarricade(op, kind, false);
  }
}
