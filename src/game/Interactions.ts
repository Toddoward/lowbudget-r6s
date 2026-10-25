import * as THREE from 'three';
import { G_WORLD } from '../core/Physics.ts';
import type { Opening } from '../map/MapBuilder.ts';
import type { Soldier, SoldierInput } from './Soldier.ts';
import type { World } from './World.ts';
import { Stance } from './types.ts';
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
      const c = op.center;
      if (Math.abs(c.y - eye.y) > op.h / 2 + 1.2) continue;
      // distance to opening plane & lateral offset
      const n = op.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const toC = c.clone().sub(eye);
      const plane = Math.abs(toC.dot(n));
      const lat = Math.abs(op.run === 'x' ? toC.x : toC.z);
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

  private candidate(s: Soldier): Candidate | null {
    if (s.mode !== 'normal') return null;
    const obj = this.world.objectives.candidate(s);
    if (obj) return obj;
    const defender = s.side === 'defend' || s.side === 'terrorist';
    const op = this.openingInFront(s);
    if (op) {
      if (op.barricadePanel === null && op.barricadeable && defender && s.op.universal === 'barricade' && this.world.phase !== 'over') {
        return { key: `bar${op.id}`, label: `Hold [F] Barricade ${op.kind === 'window' ? 'window' : 'door'}`, hold: 1.4, run: () => this.placeBarricade(op, 'wood', true) };
      }
      if (op.barricadePanel === null && (op.kind === 'window' || op.kind === 'open_window') && s.pos.y > op.floorY - 0.6) {
        return { key: `vault${op.id}`, label: '[F]/[Space] Vault', hold: 0, run: () => this.vault(s, op) };
      }
    }
    if (defender && s.reinforcementsLeft > 0) {
      const ph = this.panelInFront(s);
      if (ph && ph.panel.reinforceable && !ph.panel.reinforced && ph.panel.brokenCount === 0) {
        return { key: `rf${ph.panel.id}`, label: `Hold [F] Reinforce (${s.reinforcementsLeft} left)`, hold: 2.5, run: () => this.reinforce(s, ph.panel, true) };
      }
    }
    if (s.side === 'attack') {
      // throttled dry-run of the rope hook so the HUD can offer "[F] Rappel"
      const h = this.rappelHint.get(s.id);
      let ok = h?.ok ?? false;
      if (!h || this.world.time - h.t > 0.3) { ok = s.startRappel(true); this.rappelHint.set(s.id, { t: this.world.time, ok }); }
      return { key: 'rappel', label: ok ? '[F] Rappel' : '', hold: 0, run: () => s.startRappel() };
    }
    return null;
  }

  update(s: Soldier, dt: number, inp: SoldierInput) {
    const c = this.candidate(s);
    const st = this.held.get(s.id);
    s.interactLabel = c?.label ?? (s.mode === 'rappel' ? '[W/S] climb · [A/D] traverse · [C] invert · [F] breach & swing · [Space] detach' : '');
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
    const hw = op.w / 2, y0 = op.center.y - op.h / 2, y1 = op.center.y + op.h / 2;
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
    if (panel.reinforced) return;
    panel.reinforced = true;
    panel.dirty = true;
    if (s) s.reinforcementsLeft--;
    this.world.sound({ type: 'gadget', pos: panel.center, radius: 18, source: s?.id ?? 'reinforce', intensity: 0.6, label: 'reinforce' });
    if (broadcast) this.world.emit({ t: 'reinforce', panel: panel.id, by: s?.id ?? '' });
  }

  /* ------------------------------------------------------------- vault / swing */
  tryVault(s: Soldier): boolean {
    const op = this.openingInFront(s, 1.2);
    if (!op || op.barricadePanel !== null || !(op.kind === 'window' || op.kind === 'open_window' || op.kind === 'door' || op.kind === 'exterior_door')) return false;
    if (op.kind === 'door' || op.kind === 'exterior_door') return false;
    return this.vault(s, op);
  }

  private otherSide(s: Soldier, op: Opening, depth: number): { n: THREE.Vector3; target: THREE.Vector3 } {
    const n = op.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const side = Math.sign(s.pos.clone().sub(op.center).dot(n)) || 1;
    const across = n.clone().multiplyScalar(-side);
    const target = op.center.clone().addScaledVector(across, depth);
    // find floor on the far side
    const fl = this.world.physics.raycast(target.clone().setY(op.center.y + 0.5), new THREE.Vector3(0, -1, 0), 6, G_WORLD);
    target.y = fl ? fl.point.y : op.floorY;
    return { n: across, target };
  }

  vault(s: Soldier, op: Opening): boolean {
    if (op.barricadePanel !== null) return false;
    const { target } = this.otherSide(s, op, 0.75);
    const sill = op.center.y - op.h / 2;
    const mid = op.center.clone().setY(Math.max(sill + 0.1, s.pos.y + 0.3));
    s.playMove(s.pos, mid, target, 0.6, Stance.Crouch);
    this.world.sound({ type: 'footstep', pos: s.pos.clone(), radius: 10, source: s.id, intensity: 0.6, label: 'vault' });
    return true;
  }

  /** Rappel Breach & Swing: kick through the window in front, smashing a wooden barricade. */
  trySwing(s: Soldier): boolean {
    if (!s.rappel) return false;
    const n = s.rappel.n;
    const eye = s.eye();
    let best: Opening | null = null;
    let bestD = 1.4;
    for (const op of this.world.house.openings) {
      if (!op.exterior || !(op.kind === 'window' || op.kind === 'open_window')) continue;
      const toC = op.center.clone().sub(eye);
      const lat = Math.abs(op.run === 'x' ? toC.x : toC.z);
      if (lat > op.w / 2 + 0.35) continue;
      const vert = s.pos.y - (op.center.y - op.h / 2);
      if (vert < -1.3 || vert > 0.6) continue;
      const plane = Math.abs(op.run === 'x' ? toC.z : toC.x);
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
