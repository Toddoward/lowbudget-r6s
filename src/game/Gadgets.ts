import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G_GADGET, G_WORLD } from '../core/Physics.ts';
import { buildAsset } from '../assets/build.ts';
import { chargeSpec, deviceSpec, droneSpec, throwableSpec } from '../assets/weaponModels.ts';
import type { NetGadget } from '../../shared/protocol.ts';
import type { Soldier, SoldierInput } from './Soldier.ts';
import type { World } from './World.ts';
import type { Panel } from '../world/Destruction.ts';
import { Stance } from './types.ts';

/**
 * Operator & universal gadgets. Every gadget instance is owned by the client
 * that spawned it: the owner simulates it (fuse, flight, detonation, the
 * destruction it causes) and broadcasts spawn/trigger/remove events; peers
 * render a proxy. EMP / ADS / jammer / electrified interactions are evaluated
 * by whoever triggers the effect.
 */
export type GadgetType =
  | 'breach' | 'thermite' | 'cluster' | 'ash_round' | 'emp' | 'gas' | 'bomblet'
  | 'jammer' | 'ads' | 'battery' | 'drone' | 'defuser';

export interface Gadget {
  id: string;
  type: GadgetType;
  owner: string;
  team: string;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  vel: THREE.Vector3;
  panelId: number | null;
  state: 'flying' | 'stuck' | 'armed' | 'burning' | 'done';
  t: number;
  fuse: number;
  charges: number;
  cooldown: number;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider | null;
  local: boolean;
  data: Record<string, unknown>;
}

const THROW_SPEED = 13;
let seq = 0;

export class Gadgets {
  readonly list = new Map<string, Gadget>();
  private group = new THREE.Group();
  private hammerCd = new Map<string, number>();
  private placeHold = new Map<string, number>();
  private scanning = new Set<string>();
  private toxic: { p: THREE.Vector3; r: number; until: number; owner: string }[] = [];
  /** heartbeat contacts per pulse user */
  readonly heartbeats = new Map<string, { dir: THREE.Vector3; dist: number; dy: number }[]>();
  onPlace?: (g: Gadget) => void;
  drones = new Map<string, Gadget>();

  constructor(private world: World) {
    world.scene.add(this.group);
  }

  /* ---------------------------------------------------------------- queries */
  isScanning(s: Soldier) { return this.scanning.has(s.id); }
  inToxicGas(p: THREE.Vector3) { return this.toxic.some((g) => g.until > this.world.time && g.p.distanceTo(p) < g.r); }
  jammedAt(p: THREE.Vector3, enemyOf?: string): boolean {
    for (const g of this.list.values()) if (g.type === 'jammer' && g.state !== 'done' && g.pos.distanceTo(p) < 2.5 && (!enemyOf || g.team !== enemyOf)) return true;
    return false;
  }
  electrifiedActive(panel: Panel) {
    for (const g of this.list.values()) if (g.type === 'battery' && g.panelId === panel.id && g.state !== 'done') return true;
    return false;
  }
  smokeAt(p: THREE.Vector3) { return this.inToxicGas(p); }

  /* ---------------------------------------------------------------- input */
  handleInput(s: Soldier, dt: number, inp: SoldierInput) {
    this.scanning.delete(s.id);
    const hcd = (this.hammerCd.get(s.id) ?? 0) - dt;
    this.hammerCd.set(s.id, hcd);
    // remote detonation [G] (breach charges, thermite, smoke canisters, cluster)
    if (inp.alt) this.detonateOwned(s);
    if (s.slot < 2) { this.placeHold.delete(s.id); return; }
    const isUniversal = s.slot === 3;
    const kind = isUniversal ? s.op.universal : s.op.gadget;
    if (kind === 'heartbeat') {
      if (inp.fire || inp.ads) { this.scanning.add(s.id); this.scan(s); }
      return;
    }
    if (kind === 'hammer') {
      if (inp.fire && hcd <= 0 && s.gadgetLeft > 0) { this.hammerCd.set(s.id, 1.05); this.hammer(s); }
      return;
    }
    if (kind === 'castle') {
      const op = this.world.interactions.openingInFront(s, 1.8);
      if (inp.fire && op && op.barricadeable && s.gadgetLeft > 0 && op.barricadeKind !== 'castle') {
        const t = (this.placeHold.get(s.id) ?? 0) + dt;
        this.placeHold.set(s.id, t);
        s.interactProgress = Math.min(1, t / 1.5);
        s.interactLabel = 'Deploying Armor Panel…';
        if (t >= 1.5) { this.placeHold.delete(s.id); s.gadgetLeft--; this.world.interactions.placeBarricade(op, 'castle', true); }
      } else this.placeHold.delete(s.id);
      return;
    }
    if (!inp.firePressed) return;
    const left = isUniversal ? s.universalLeft : s.gadgetLeft;
    if (left <= 0) return;
    let used = false;
    switch (kind) {
      case 'breach': used = this.plant(s, 'breach'); break;
      case 'thermite': used = this.plant(s, 'thermite'); break;
      case 'cluster': used = this.plant(s, 'cluster'); break;
      case 'ash_round': used = this.launch(s, 'ash_round', 38, 0.15); break;
      case 'emp': used = this.launch(s, 'emp', THROW_SPEED, 1); break;
      case 'gas': used = this.launch(s, 'gas', THROW_SPEED * 0.85, 1); break;
      case 'jammer': used = this.deploy(s, 'jammer'); break;
      case 'ads': used = this.deploy(s, 'ads'); break;
      case 'battery': used = this.plant(s, 'battery'); break;
    }
    if (used) {
      if (isUniversal) s.universalLeft--; else s.gadgetLeft--;
      if ((isUniversal ? s.universalLeft : s.gadgetLeft) <= 0) s.switchSlot(0);
    }
  }

  /* ---------------------------------------------------------------- creation */
  private make(type: GadgetType, owner: Soldier | { id: string; side: string }, pos: THREE.Vector3, normal: THREE.Vector3, local: boolean, id?: string): Gadget {
    const g: Gadget = {
      id: id ?? `${owner.id}:${type}:${++seq}:${Math.floor(Math.random() * 1e4)}`,
      type, owner: owner.id, team: owner.side, pos: pos.clone(), normal: normal.clone(), vel: new THREE.Vector3(),
      panelId: null, state: 'stuck', t: 0, fuse: 0, charges: type === 'ads' ? 2 : 0, cooldown: 0,
      mesh: this.meshFor(type), collider: null, local, data: {},
    };
    g.mesh.position.copy(pos);
    if (normal.lengthSq() > 0.1) g.mesh.lookAt(pos.clone().add(normal));
    this.group.add(g.mesh);
    if (['jammer', 'ads', 'battery', 'breach', 'thermite', 'cluster', 'drone', 'defuser'].includes(type)) {
      g.collider = this.world.physics.addBall(pos.x, pos.y, pos.z, type === 'drone' ? 0.14 : 0.1, { kind: 'gadget', gadgetId: g.id }, G_GADGET);
    }
    this.list.set(g.id, g);
    return g;
  }

  private meshFor(type: GadgetType): THREE.Object3D {
    const spec = {
      breach: () => chargeSpec('g_breach', '#3f4533', 0.32, 0.5),
      thermite: () => chargeSpec('g_thermite', '#7a6a48', 0.5, 0.75),
      cluster: () => chargeSpec('g_cluster', '#4a4f3a', 0.3, 0.3),
      ash_round: () => throwableSpec('g_ash', '#c84a2a', true),
      emp: () => throwableSpec('g_emp', '#2c5c8a', true),
      gas: () => throwableSpec('g_gas', '#6a6f2a', true),
      bomblet: () => throwableSpec('g_bomblet', '#3a3a30'),
      jammer: () => deviceSpec('g_jammer', '#1b1d20', '#ff3a3a'),
      ads: () => deviceSpec('g_ads', '#3c4136', '#3aff7a'),
      battery: () => deviceSpec('g_battery', '#d9792a', '#7fd0ff'),
      drone: () => droneSpec(),
      defuser: () => deviceSpec('g_defuser', '#2a2c30', '#ff2020'),
    }[type]();
    const m = buildAsset(spec);
    // gadget specs are authored "in hand" (-Z forward, offset); recentre for world placement
    m.children.forEach((c) => c.position.set(0, -0.05, 0.12));
    if (type === 'drone') m.children.forEach((c) => c.position.set(0, -0.09, 0));
    return m;
  }

  /** stick a charge on the panel/wall the soldier is looking at */
  private plant(s: Soldier, type: 'breach' | 'thermite' | 'cluster' | 'battery'): boolean {
    const hit = this.world.physics.raycast(s.eye(), s.aimDir(), 1.9, G_WORLD);
    if (!hit) return false;
    const panel = hit.tag?.kind === 'panel' ? this.world.destruction.get(hit.tag.panelId) ?? null : null;
    if (type === 'battery' && !(panel && (panel.reinforced || panel.kind === 'castle'))) return false;
    if ((type === 'breach' || type === 'cluster') && (!panel || panel.reinforced)) return false;
    if (type === 'thermite' && !panel) return false;
    const g = this.make(type, s, hit.point.clone().addScaledVector(hit.normal, 0.05), hit.normal, true);
    g.panelId = panel?.id ?? null;
    g.state = 'armed';
    if (type === 'battery' && panel) panel.electrified++;
    if (type === 'cluster') { g.fuse = 2.5; g.state = 'burning'; }
    // Bandit: thermite / breach on an electrified panel is fried immediately
    if ((type === 'thermite' || type === 'breach') && panel && this.electrifiedActive(panel)) {
      this.world.effects.spark(g.pos);
      this.world.effects.spark(g.pos, '#ffffff');
      this.world.sound({ type: 'gadget', pos: g.pos.clone(), radius: 15, source: s.id, intensity: 0.6, label: 'zap' });
      this.remove(g, true);
      return true;
    }
    this.world.sound({ type: 'gadget', pos: g.pos.clone(), radius: 10, source: s.id, intensity: 0.4, label: `place_${type}` });
    this.broadcastSpawn(g);
    this.onPlace?.(g);
    return true;
  }

  private deploy(s: Soldier, type: 'jammer' | 'ads'): boolean {
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const start = s.pos.clone().addScaledVector(fwd, 0.7).add(new THREE.Vector3(0, 0.5, 0));
    const down = this.world.physics.raycast(start, new THREE.Vector3(0, -1, 0), 2, G_WORLD);
    if (!down) return false;
    const g = this.make(type, s, down.point.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), true);
    g.state = 'armed';
    this.broadcastSpawn(g);
    this.world.sound({ type: 'gadget', pos: g.pos.clone(), radius: 8, source: s.id, intensity: 0.3, label: `deploy_${type}` });
    return true;
  }

  private launch(s: Soldier, type: 'ash_round' | 'emp' | 'gas', speed: number, gravScale: number): boolean {
    const dir = s.aimDir();
    const p = s.eye().addScaledVector(dir, 0.5);
    const g = this.make(type, s, p, new THREE.Vector3(), true);
    g.vel.copy(dir).multiplyScalar(speed);
    if (type !== 'ash_round') g.vel.y += 2.5;
    g.state = 'flying';
    g.data.grav = gravScale;
    g.fuse = type === 'emp' ? 2.0 : type === 'ash_round' ? 1.5 : 0;
    this.broadcastSpawn(g);
    this.world.sound({ type: type === 'ash_round' ? 'gunshot' : 'gadget', pos: p.clone(), radius: type === 'ash_round' ? 35 : 8, source: s.id, intensity: 0.6, label: `launch_${type}` });
    return true;
  }

  /** Sledge hammer swing */
  private hammer(s: Soldier) {
    const o = s.eye();
    const d = s.aimDir();
    s.gadgetLeft--;
    const hit = this.world.physics.raycast(o, d, 2.1, G_WORLD | G_GADGET);
    this.world.sound({ type: 'breach', pos: o.clone(), radius: 28, source: s.id, intensity: 0.8, label: 'hammer' });
    for (const a of this.world.actors.values()) {
      if (a.id === s.id || !a.alive) continue;
      const head = a.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      if (head.distanceTo(o) < 1.8 && head.clone().sub(o).normalize().dot(d) > 0.8) this.world.damageActor(a, 100, s.id, false, d);
    }
    if (!hit) return;
    if (hit.tag?.kind === 'gadget') { this.shootGadget(hit.tag.gadgetId, s.id); return; }
    const panel = hit.tag?.kind === 'panel' ? this.world.destruction.get(hit.tag.panelId) ?? null : null;
    const res = this.world.destruction.impactAndApply('sledge', hit.point.clone().addScaledVector(d, 0.05), panel);
    this.world.combat.emitCells(res.events);
    this.world.effects.impact(hit.point, hit.normal, panel?.props.mat ?? 'concrete', null, false);
  }

  private detonateOwned(s: Soldier) {
    for (const g of this.list.values()) {
      if (g.owner !== s.id || !g.local) continue;
      if (g.type === 'breach' && g.state === 'armed') {
        if (this.jammedAt(g.pos, g.team)) { this.world.effects.spark(g.pos, '#ff4040'); continue; }
        this.explodeBreach(g);
      } else if (g.type === 'thermite' && g.state === 'armed') {
        g.state = 'burning';
        g.fuse = 4.0;
        this.world.emit({ t: 'gadget', op: 'trigger', id: g.id });
      } else if (g.type === 'gas' && g.state === 'stuck') {
        this.releaseGas(g);
      }
    }
  }

  /* ---------------------------------------------------------------- effects */
  private explodeBreach(g: Gadget) {
    const panel = g.panelId !== null ? this.world.destruction.get(g.panelId) ?? null : null;
    const res = this.world.destruction.impactAndApply('breach', g.pos.clone().addScaledVector(g.normal, -0.1), panel);
    this.world.combat.emitCells(res.events);
    this.boom(g, 2.6, 75, 'breach');
    this.remove(g, true);
  }

  private boom(g: Gadget, r: number, dmg: number, kind: 'frag' | 'breach' | 'thermite' | 'emp' | 'ash' | 'small') {
    this.world.effects.explosion(g.pos, Math.min(r, 2), kind);
    this.world.sound({ type: 'explosion', pos: g.pos.clone(), radius: kind === 'small' ? 30 : 55, source: g.owner, intensity: 1, label: kind });
    if (dmg > 0) this.world.combat.areaDamage(g.pos, r, dmg, g.owner);
    this.world.emit({ t: 'explosion', p: g.pos.toArray(), r, kind, by: g.owner });
  }

  private releaseGas(g: Gadget) {
    g.state = 'done';
    this.toxic.push({ p: g.pos.clone(), r: 3, until: this.world.time + 10, owner: g.owner });
    this.world.effects.gas(g.pos, 3, 10);
    this.world.sound({ type: 'gadget', pos: g.pos.clone(), radius: 18, source: g.owner, intensity: 0.6, label: 'gas' });
    this.world.emit({ t: 'gadget', op: 'trigger', id: g.id, p: g.pos.toArray() });
    this.remove(g, true);
  }

  private emp(g: Gadget) {
    this.world.effects.explosion(g.pos, 1.2, 'emp');
    this.world.sound({ type: 'explosion', pos: g.pos.clone(), radius: 25, source: g.owner, intensity: 0.6, label: 'emp' });
    this.world.emit({ t: 'emp', p: g.pos.toArray(), r: 5, by: g.owner });
    this.applyEmp(g.pos, 5, g.team);
    this.remove(g, true);
  }

  /** destroy enemy electronics within r (through walls) */
  applyEmp(p: THREE.Vector3, r: number, team: string) {
    for (const o of [...this.list.values()]) {
      if (o.team === team) continue;
      if ((o.type === 'jammer' || o.type === 'ads' || o.type === 'battery') && o.pos.distanceTo(p) < r) {
        this.world.effects.spark(o.pos);
        this.remove(o, o.local);
      }
    }
    for (const s of this.world.soldiers.values()) if (s.side !== team && s.op.gadget === 'heartbeat' && s.pos.distanceTo(p) < r) this.scanning.delete(s.id);
  }

  private scan(s: Soldier) {
    const out: { dir: THREE.Vector3; dist: number; dy: number }[] = [];
    const eye = s.eye();
    for (const a of this.world.actors.values()) {
      if (!a.alive || a.id === s.id || a.side === s.side) continue;
      const d = a.pos.distanceTo(s.pos);
      if (d > 9) continue;
      const dir = a.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(eye);
      out.push({ dir: dir.normalize(), dist: d, dy: a.pos.y - s.pos.y });
    }
    this.heartbeats.set(s.id, out);
  }

  shootGadget(id: string, by: string) {
    const g = this.list.get(id);
    if (!g || g.type === 'defuser') return;
    const shooter = this.world.actors.get(by);
    if (shooter && shooter.side === g.team && g.type !== 'drone') return;
    this.world.effects.spark(g.pos);
    if (g.type === 'drone') g.data.destroyed = true;
    this.remove(g, true);
  }

  /** ADS: intercept enemy projectiles within 3 m (2 charges, 1 s cooldown) */
  private adsIntercept(proj: Gadget): boolean {
    for (const a of this.list.values()) {
      if (a.type !== 'ads' || a.state === 'done' || a.team === proj.team || a.charges <= 0 || a.cooldown > 0) continue;
      if (a.pos.distanceTo(proj.pos) > 3) continue;
      if (!this.world.physics.clearLine(a.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), proj.pos)) continue;
      a.charges--;
      a.cooldown = 1;
      this.world.effects.tracer(a.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), proj.pos, false);
      this.world.effects.explosion(proj.pos, 0.3, 'small');
      this.world.sound({ type: 'gadget', pos: a.pos.clone(), radius: 18, source: a.owner, intensity: 0.6, label: 'ads' });
      if (a.charges <= 0) a.state = 'done';
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- update */
  update(dt: number) {
    const w = this.world;
    for (const g of [...this.list.values()]) {
      g.t += dt;
      g.cooldown = Math.max(0, g.cooldown - dt);
      if (g.type === 'drone') continue;
      if (g.state === 'flying') {
        const grav = (g.data.grav as number) ?? 1;
        g.vel.y -= 9.8 * grav * dt;
        const step = g.vel.clone().multiplyScalar(dt);
        const len = step.length();
        if (g.local && (g.type === 'emp' || g.type === 'ash_round' || g.type === 'bomblet' || g.type === 'gas') && this.adsIntercept(g)) { this.remove(g, true); continue; }
        const hit = len > 1e-5 ? w.physics.raycast(g.pos, step.clone().normalize(), len + 0.04, G_WORLD) : null;
        if (hit) {
          if (g.type === 'ash_round') {
            g.pos.copy(hit.point).addScaledVector(hit.normal, 0.04);
            g.normal.copy(hit.normal);
            g.panelId = hit.tag?.kind === 'panel' ? hit.tag.panelId : null;
            g.state = 'armed';
            g.mesh.lookAt(g.pos.clone().add(hit.normal));
          } else {
            // bounce
            g.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
            g.vel.reflect(hit.normal).multiplyScalar(0.35);
            if (g.vel.length() < 1.2 && hit.normal.y > 0.6) { g.vel.set(0, 0, 0); g.state = g.type === 'gas' ? 'stuck' : 'armed'; }
          }
        } else g.pos.add(step);
        g.mesh.position.copy(g.pos);
      }
      if (!g.local) { g.mesh.position.copy(g.pos); continue; }
      // owner-side logic
      switch (g.type) {
        case 'ash_round':
          if (g.t >= g.fuse) this.explodeAsh(g);
          break;
        case 'emp':
          if (g.t >= g.fuse) this.emp(g);
          break;
        case 'thermite':
          if (g.state === 'burning') {
            const panel = g.panelId !== null ? w.destruction.get(g.panelId) : undefined;
            if (panel && this.electrifiedActive(panel)) { w.effects.spark(g.pos); this.remove(g, true); break; }
            w.effects.thermiteSparks(g.pos, g.normal);
            if (Math.random() < dt * 4) w.sound({ type: 'gadget', pos: g.pos.clone(), radius: 25, source: g.owner, intensity: 0.7, label: 'thermite' });
            g.fuse -= dt;
            if (g.fuse <= 0) {
              const res = w.destruction.impactAndApply('thermite', g.pos.clone().addScaledVector(g.normal, -0.1), panel ?? null);
              w.combat.emitCells(res.events);
              this.boom(g, 1.8, 40, 'thermite');
              this.remove(g, true);
            }
          }
          break;
        case 'cluster':
          g.fuse -= dt;
          if (g.fuse <= 0) this.deployCluster(g);
          break;
        case 'bomblet':
          if (g.state !== 'flying' && g.t > (g.data.delay as number)) {
            const panel = w.destruction.panelsNear(g.pos, 0.6)[0] ?? null;
            const res = w.destruction.impactAndApply('cluster', g.pos, panel);
            w.combat.emitCells(res.events);
            this.boom(g, 3.2, 70, 'small');
            this.remove(g, true);
          } else if (g.t > 4) this.remove(g, true);
          break;
      }
    }
    // toxic gas damage to locally simulated soldiers
    for (const z of this.toxic) {
      if (z.until < w.time) continue;
      for (const s of w.soldiers.values()) if (s.alive && s.pos.distanceTo(z.p) < z.r && s.stance !== Stance.Rappel) w.damageActor(s, 13 * dt, z.owner, false);
      for (const id of w.objectives.hostageIds()) {
        const h = w.actors.get(id);
        if (h && h.alive && w.isLocal(id) && h.pos.distanceTo(z.p) < z.r) w.damageActor(h, 13 * dt, z.owner, false);
      }
    }
    this.toxic = this.toxic.filter((z) => z.until > w.time);
  }

  private explodeAsh(g: Gadget) {
    const panel = g.panelId !== null ? this.world.destruction.get(g.panelId) ?? null : null;
    const res = this.world.destruction.impactAndApply('ash', g.pos.clone().addScaledVector(g.normal, -0.1), panel);
    this.world.combat.emitCells(res.events);
    this.boom(g, 2.2, 55, 'ash');
    this.remove(g, true);
  }

  /** Fuze: punch through the panel and scatter 5 bomblets into the room behind */
  private deployCluster(g: Gadget) {
    const into = g.normal.clone().negate();
    const panel = g.panelId !== null ? this.world.destruction.get(g.panelId) : undefined;
    const through = panel ? panel.thickness + 0.25 : 0.4;
    const origin = g.pos.clone().addScaledVector(into, through);
    this.world.sound({ type: 'explosion', pos: g.pos.clone(), radius: 30, source: g.owner, intensity: 0.6, label: 'cluster_launch' });
    for (let i = 0; i < 5; i++) {
      const b = this.make('bomblet', { id: g.owner, side: g.team }, origin, new THREE.Vector3(), true);
      const spread = new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 0.8, (Math.random() - 0.5) * 1.4);
      b.vel.copy(into).multiplyScalar(5 + Math.random() * 4).add(spread.multiplyScalar(4));
      b.state = 'flying';
      b.data.grav = 1;
      b.data.delay = 1.2 + i * 0.35;
      this.broadcastSpawn(b);
    }
    this.remove(g, true);
  }

  /* ---------------------------------------------------------------- drones */
  spawnDrone(owner: Soldier, p: THREE.Vector3): Gadget {
    const g = this.make('drone', owner, p, new THREE.Vector3(0, 1, 0), true, `${owner.id}:drone`);
    g.state = 'armed';
    g.data.yaw = owner.yaw;
    g.data.pitch = 0;
    this.drones.set(owner.id, g);
    return g;
  }

  updateDrone(g: Gadget, dt: number, inp: SoldierInput): void {
    if (g.data.destroyed || g.state === 'done') return;
    let yaw = (g.data.yaw as number) + inp.lookDYaw;
    let pitch = THREE.MathUtils.clamp((g.data.pitch as number) + inp.lookDPitch, -0.6, 0.9);
    g.data.yaw = yaw;
    g.data.pitch = pitch;
    const jammed = this.jammedAt(g.pos, g.team);
    g.data.jammed = jammed;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const v = (g.vel ??= new THREE.Vector3());
    const wish = fwd.multiplyScalar(inp.moveF).addScaledVector(right, inp.moveR).multiplyScalar(jammed ? 0 : inp.sprint ? 4.2 : 2.8);
    v.x += (wish.x - v.x) * Math.min(1, dt * 6);
    v.z += (wish.z - v.z) * Math.min(1, dt * 6);
    v.y -= 14 * dt;
    if (inp.jump && g.data.grounded) v.y = 3.2;
    // simple sphere-vs-world movement (3 sub-steps along axes)
    const ph = this.world.physics;
    const r = 0.13;
    g.data.grounded = false;
    for (const ax of ['x', 'z', 'y'] as const) {
      const d = v[ax] * dt;
      if (Math.abs(d) < 1e-6) continue;
      const dir = new THREE.Vector3();
      dir[ax] = Math.sign(d);
      const hit = ph.raycast(g.pos, dir, Math.abs(d) + r, G_WORLD | 0x0008, (t) => t?.kind === 'gadget');
      if (hit) {
        g.pos[ax] += Math.sign(d) * Math.max(0, hit.dist - r);
        if (ax === 'y' && d < 0) g.data.grounded = true;
        v[ax] = 0;
      } else g.pos[ax] += d;
    }
    g.mesh.position.copy(g.pos);
    g.mesh.rotation.set(0, yaw, 0);
    g.collider?.setTranslation({ x: g.pos.x, y: g.pos.y, z: g.pos.z });
    void pitch;
  }

  /* ---------------------------------------------------------------- network */
  private broadcastSpawn(g: Gadget) {
    const ng: NetGadget = { id: g.id, type: g.type, owner: g.owner, p: g.pos.toArray(), n: g.normal.toArray(), v: g.vel.toArray(), data: { panel: g.panelId, team: g.team, delay: g.data.delay } };
    this.world.emit({ t: 'gadget', op: 'spawn', g: ng });
  }

  remoteSpawn(ng: NetGadget) {
    if (this.list.has(ng.id)) return;
    const team = (ng.data?.team as string) ?? 'attack';
    const g = this.make(ng.type as GadgetType, { id: ng.owner, side: team }, new THREE.Vector3(...ng.p), new THREE.Vector3(...(ng.n ?? [0, 1, 0])), false, ng.id);
    g.vel.set(...((ng.v ?? [0, 0, 0]) as [number, number, number]));
    g.panelId = (ng.data?.panel as number | null) ?? null;
    g.state = g.vel.lengthSq() > 0.01 ? 'flying' : 'armed';
    g.data.grav = g.type === 'ash_round' ? 0.15 : 1;
    if (g.type === 'battery' && g.panelId !== null) {
      const p = this.world.destruction.get(g.panelId);
      if (p) p.electrified++;
    }
  }

  remoteTrigger(id: string, p?: number[]) {
    const g = this.list.get(id);
    if (g?.type === 'thermite') { g.state = 'burning'; return; }
    if (p) this.world.effects.gas(new THREE.Vector3(...p), 3, 10);
    if (p) this.toxic.push({ p: new THREE.Vector3(...p), r: 3, until: this.world.time + 10, owner: g?.owner ?? '' });
  }

  remove(g: Gadget, broadcast: boolean) {
    if (!this.list.has(g.id)) return;
    this.list.delete(g.id);
    g.state = 'done';
    this.group.remove(g.mesh);
    this.world.physics.remove(g.collider);
    g.collider = null;
    if (g.type === 'battery' && g.panelId !== null) {
      const p = this.world.destruction.get(g.panelId);
      if (p) p.electrified = Math.max(0, p.electrified - 1);
    }
    if (g.type === 'drone') for (const [k, d] of this.drones) if (d === g) this.drones.delete(k);
    if (broadcast && g.local) this.world.emit({ t: 'gadget', op: 'remove', id: g.id });
  }

  remoteRemove(id: string) {
    const g = this.list.get(id);
    if (g) this.remove(g, false);
  }

  remoteExplosion(p: number[], r: number, kind: string) {
    const v = new THREE.Vector3(...p);
    this.world.effects.explosion(v, Math.min(r, 2), (kind as 'frag') ?? 'frag');
    this.world.sound({ type: 'explosion', pos: v, radius: 55, source: 'remote', intensity: 1, label: kind });
  }

  clear() {
    for (const g of [...this.list.values()]) this.remove(g, false);
    this.toxic = [];
    this.drones.clear();
    this.heartbeats.clear();
  }

  /** for WebMCP vision / HUD */
  all(): Gadget[] { return [...this.list.values()]; }
}
