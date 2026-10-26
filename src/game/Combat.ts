import * as THREE from 'three';
import { G_GADGET, G_WORLD, type SurfaceMaterial } from '../core/Physics.ts';
import { rayActor, type Actor } from './Actor.ts';
import { damageAt, WEAPONS, type WeaponDef } from './weapons.ts';
import type { Soldier } from './Soldier.ts';
import type { World } from './World.ts';
import type { CellDamage, Panel } from '../world/Destruction.ts';

const PENETRABLE_PROPS = new Set<SurfaceMaterial>(['fabric', 'wood', 'plaster', 'glass']);

/**
 * Hitscan ballistics with wall-bang penetration.
 *
 * A round is traced through Rapier (world + gadget colliders) and tested
 * analytically against every actor's head sphere / torso & leg capsules
 * between successive surface hits. Soft/semi panels and barricades are
 * penetrable: the cell under the impact takes `wallDmg`, the round loses
 * 35 % damage and one penetration point and continues on the far side.
 * Solid, reinforced and metal surfaces stop it. Headshots are always lethal.
 */
export class Combat {
  private pendingCells: CellDamage[] = [];

  constructor(private world: World) {}

  fireBullet(shooter: Soldier, def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, primary: boolean, visualOnly = false) {
    const w = this.world;
    w.lastWeaponOf.set(shooter.id, def.name);
    const end = this.trace(shooter.id, def, origin, dir, visualOnly);
    const muzzle = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.08, 0));
    w.effects.tracer(muzzle, end, shooter.side !== w.actors.get(w.localId)?.side);
    if (primary) {
      w.effects.muzzle(muzzle, dir, def.suppressed || def.style.suppressor);
      const sup = !!(def.suppressed || def.style.suppressor);
      w.sound({ type: sup ? 'suppressed' : 'gunshot', pos: origin.clone(), radius: sup ? 12 : 45, source: shooter.id, intensity: sup ? 0.4 : 1, label: def.id });
      if (!visualOnly) w.emit({ t: 'fire', actor: shooter.id, o: origin.toArray().map(r3), d: dir.toArray().map(r4), w: def.id, sup });
    }
    this.flushCells();
  }

  /** Remote peer fired: draw tracer/impacts, play sound — no damage. */
  remoteFire(actor: Actor, o: number[], d: number[], weapon: string) {
    const def = WEAPONS[weapon] ?? WEAPONS.r4c;
    const origin = new THREE.Vector3(...o);
    const dir = new THREE.Vector3(...d).normalize();
    this.world.lastWeaponOf.set(actor.id, def.name);
    const end = this.trace(actor.id, def, origin, dir, true);
    const muzzle = origin.clone().addScaledVector(dir, 0.6);
    this.world.effects.tracer(muzzle, end, true);
    const sup = !!(def.suppressed || def.style.suppressor);
    this.world.effects.muzzle(muzzle, dir, sup);
    this.world.sound({ type: sup ? 'suppressed' : 'gunshot', pos: origin, radius: sup ? 12 : 45, source: actor.id, intensity: sup ? 0.4 : 1, label: def.id });
  }

  /** returns the end point of the round */
  private trace(shooterId: string, def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, visualOnly: boolean): THREE.Vector3 {
    const w = this.world;
    const o = origin.clone();
    let remaining = 140;
    let travelled = 0;
    let power = def.pen;
    let mul = 1;
    const skip = new Set<number>();
    const exclude = (_t: unknown, c: { handle: number }) => skip.has(c.handle);
    const shooter = w.actors.get(shooterId);
    const ownShield = (shooter as Soldier | undefined)?.shieldCollider;
    if (ownShield) skip.add(ownShield.handle);
    for (let iter = 0; iter < 7; iter++) {
      const hit = w.physics.raycast(o, dir, remaining, G_WORLD | G_GADGET, exclude);
      const surfDist = hit ? hit.dist : remaining;
      // actors between here and the surface
      let best: { a: Actor; t: number; zone: 'head' | 'torso' | 'legs' } | null = null;
      for (const a of w.actors.values()) {
        if (a.id === shooterId || !w.targetable(a)) continue;
        if (a.pos.distanceToSquared(o) > (surfDist + 3) * (surfDist + 3)) continue;
        if (!visualOnly && shooter && shooter.kind === 'bot' && a.kind === 'bot') continue; // bots don't team-kill
        const r = rayActor(o, dir, a.hitboxes(), surfDist);
        if (r && (!best || r.t < best.t)) best = { a, t: r.t, zone: r.zone };
      }
      if (best) {
        const p = o.clone().addScaledVector(dir, best.t);
        w.effects.blood(p, dir);
        if (!visualOnly) {
          const zoneMul = best.zone === 'legs' ? 0.75 : 1;
          const dmg = damageAt(def, travelled + best.t) * mul * zoneMul;
          w.damageActor(best.a, dmg, shooterId, best.zone === 'head', dir);
        }
        return p;
      }
      if (!hit) return o.clone().addScaledVector(dir, remaining);
      const tag = hit.tag;
      if (tag?.kind === 'gadget') {
        if (tag.gadgetId.startsWith('shield:') || tag.gadgetId.startsWith('plate:')) {
          // ballistic shield / turret plate: the round stops, sparks fly
          w.effects.impact(hit.point, hit.normal, 'metal', null, false);
          w.effects.spark(hit.point, '#ffd27a');
          w.sound({ type: 'impact', pos: hit.point.clone(), radius: 14, source: shooterId, intensity: 0.4, label: 'ricochet' });
          return hit.point;
        }
        if (!visualOnly) w.gadgets.shootGadget(tag.gadgetId, shooterId);
        w.effects.impact(hit.point, hit.normal, 'metal', null, false);
        return hit.point;
      }
      if (tag?.kind === 'panel') {
        const panel = w.destruction.get(tag.panelId);
        if (panel && panel.props.penetrable && !panel.reinforced && power > 0) {
          const inside = hit.point.clone().addScaledVector(dir, 0.01);
          const cell = panel.cellAt(inside);
          w.effects.impact(hit.point, hit.normal, panel.props.mat, `${panel.id}:${cell}`);
          // shotgun pellets also snap studs / joists (soft walls, hatches); other rounds go through them
          if (!visualOnly) this.panelHit(panel, inside, def.wallDmg * (panel.kind === 'barricade' ? 1 : mul), (def.pellets ?? 1) > 1);
          power -= panel.kind === 'barricade' ? 0.5 : 1;
          // spec: a round through a soft wall keeps 60 % of its damage
          mul *= panel.kind === 'barricade' ? 0.85 : 0.6;
          const cos = Math.max(0.25, Math.abs(dir.getComponent(panel.nAx)));
          const step = Math.min(0.7, panel.thickness / cos + 0.03);
          skip.add(hit.collider.handle);
          o.copy(hit.point).addScaledVector(dir, step);
          travelled += hit.dist + step;
          remaining -= hit.dist + step;
          continue;
        }
        w.effects.impact(hit.point, hit.normal, panel?.reinforced ? 'metal' : panel?.props.mat ?? 'concrete', panel ? `${panel.id}:${panel.cellAt(hit.point.clone().addScaledVector(dir, 0.01))}` : null);
        return hit.point;
      }
      const mat = tag?.kind === 'static' ? tag.mat : 'concrete';
      if (PENETRABLE_PROPS.has(mat) && power > 0) {
        w.effects.impact(hit.point, hit.normal, mat, null, false);
        power -= 0.5;
        mul *= 0.8;
        skip.add(hit.collider.handle);
        const step = 0.05;
        o.copy(hit.point).addScaledVector(dir, step);
        travelled += hit.dist + step;
        remaining -= hit.dist + step;
        continue;
      }
      w.effects.impact(hit.point, hit.normal, mat, null);
      return hit.point;
    }
    return o;
  }

  private panelHit(panel: Panel, point: THREE.Vector3, dmg: number, heavy = false) {
    const res = this.world.destruction.impactAndApply('bullet', point, panel, dmg, heavy);
    this.pendingCells.push(...res.events);
  }

  /** batch cell damage of one shot (multi-pellet) into few network events */
  flushCells() {
    if (!this.pendingCells.length) return;
    const merged = new Map<string, CellDamage>();
    for (const e of this.pendingCells) {
      const k = `${e.panel}:${e.dmg.toFixed(3)}:${e.frame ? 1 : 0}`;
      const m = merged.get(k);
      if (m) m.cells.push(...e.cells);
      else merged.set(k, { panel: e.panel, cells: [...e.cells], dmg: e.dmg, frame: e.frame });
    }
    for (const e of merged.values()) this.world.emit({ t: 'cells', panel: e.panel, cells: e.cells, dmg: +e.dmg.toFixed(3), fr: e.frame ? 1 : undefined });
    this.pendingCells = [];
  }

  /** broadcast & keep events computed elsewhere (gadgets) */
  emitCells(events: CellDamage[]) {
    for (const e of events) this.world.emit({ t: 'cells', panel: e.panel, cells: e.cells, dmg: e.dmg, fr: e.frame ? 1 : undefined });
  }

  melee(s: Soldier) {
    const w = this.world;
    const o = s.eye();
    const d = s.aimDir();
    const hit = w.physics.raycast(o, d, 1.6, G_WORLD | G_GADGET);
    const maxT = hit ? hit.dist : 1.6;
    for (const a of w.actors.values()) {
      if (a.id === s.id || !w.targetable(a)) continue;
      const r = rayActor(o, d, a.hitboxes(), maxT + 0.2);
      if (r) {
        w.damageActor(a, 60, s.id, false, d);
        w.effects.blood(o.clone().addScaledVector(d, r.t), d);
        w.sound({ type: 'impact', pos: o.clone(), radius: 8, source: s.id, intensity: 0.5, label: 'melee' });
        return;
      }
    }
    w.sound({ type: 'impact', pos: o.clone(), radius: 10, source: s.id, intensity: 0.5, label: 'melee' });
    // melee is a short volume, not a thin ray: a barricade / armor panel right in front is struck even
    // when the ray slips through a hole already knocked into it
    if (!(hit?.tag?.kind === 'panel' && ['barricade', 'castle'].includes(w.destruction.get(hit.tag.panelId)?.kind ?? ''))) {
      const reach = o.clone().addScaledVector(d, 0.9);
      for (const p of w.destruction.panelsNear(reach, 0.7)) {
        if (p.kind !== 'barricade' && p.kind !== 'castle') continue;
        const c = new THREE.Vector3(THREE.MathUtils.clamp(reach.x, p.min.x, p.max.x), THREE.MathUtils.clamp(reach.y, p.min.y, p.max.y), THREE.MathUtils.clamp(reach.z, p.min.z, p.max.z));
        if (c.clone().sub(o).normalize().dot(d) < 0.5) continue;
        const res = w.destruction.impactAndApply('melee', c, p);
        this.emitCells(res.events);
        w.effects.impact(c, d.clone().negate(), p.props.mat, null, false);
        return;
      }
    }
    if (!hit) return;
    if (hit.tag?.kind === 'panel') {
      const panel = w.destruction.get(hit.tag.panelId);
      if (!panel) return;
      if (panel.electrified > 0 && w.gadgets.electrifiedActive(panel)) {
        w.damageActor(s, 10, s.id, false);
        w.effects.spark(hit.point);
        return;
      }
      const res = w.destruction.impactAndApply('melee', hit.point.clone().addScaledVector(d, 0.02), panel);
      this.emitCells(res.events);
      if (res.broke.length) w.sound({ type: 'breach', pos: hit.point.clone(), radius: 22, source: s.id, intensity: 0.6, label: 'melee_breach' });
      w.effects.impact(hit.point, hit.normal, panel.props.mat, null, false);
    } else if (hit.tag?.kind === 'gadget') {
      w.gadgets.shootGadget(hit.tag.gadgetId, s.id);
    } else {
      w.effects.impact(hit.point, hit.normal, hit.tag?.kind === 'static' ? hit.tag.mat : 'concrete', null, false);
    }
  }

  /**
   * Area damage (frag, breach charge, ash round, cluster bomblets, gas).
   * Line of sight through soft geometry reduces damage; solid blocks it.
   */
  areaDamage(center: THREE.Vector3, radius: number, maxDmg: number, attacker: string, falloff = 1.3) {
    const w = this.world;
    for (const a of w.actors.values()) {
      if (!w.targetable(a)) continue;
      const chest = a.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
      const d = chest.distanceTo(center);
      if (d > radius) continue;
      let mul = Math.pow(1 - d / radius, falloff);
      const dir = chest.clone().sub(center).normalize();
      const hit = w.physics.raycast(center, dir, d, G_WORLD);
      if (hit) {
        const p = hit.tag?.kind === 'panel' ? w.destruction.get(hit.tag.panelId) : null;
        mul *= p && !p.reinforced ? 0.55 : 0.05;
      }
      if (mul * maxDmg >= 1) w.damageActor(a, maxDmg * mul, attacker, false, dir);
    }
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
