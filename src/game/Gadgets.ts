import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G_CLIP, G_GADGET, G_WORLD, groups, type Physics } from '../core/Physics.ts';
import { buildAsset } from '../assets/build.ts';
import { chargeSpec, deviceSpec, droneSpec, throwableSpec } from '../assets/weaponModels.ts';
import { extraGadgetSpec } from '../assets/gadgetModels.ts';
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
  | 'jammer' | 'ads' | 'battery' | 'drone' | 'defuser' | 'edd' | 'turret';

type GadgetClass = 'tool' | 'place' | 'throw' | 'active';
const GADGET_CLASS: Record<string, GadgetClass> = {
  hammer: 'tool', heartbeat: 'tool', ash_round: 'tool', scanner: 'tool',
  breach: 'place', thermite: 'place', cluster: 'place', battery: 'place', castle: 'place', jammer: 'place', ads: 'place', edd: 'place', turret: 'place',
  emp: 'throw', gas: 'throw',
  shield_ext: 'active', flash_shield: 'active',
};
/** a press shorter than this is a tap (detonate), longer is a hold (place) */
const TAP_TIME = 0.25;
const PLACE_TIME: Record<string, number> = { breach: 0.6, thermite: 1.0, cluster: 0.8, battery: 0.6, castle: 1.5, jammer: 0.4, ads: 0.4, edd: 1.0, turret: 1.2 };

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
export const DRONE_R = 0.085;
/** KCC skin: small enough that the 17 cm ball still rolls under a 19 cm barricade gap */
const DRONE_SKIN = 0.004;

function makeDroneController(ph: Physics) {
  const k = ph.world.createCharacterController(DRONE_SKIN);
  k.enableAutostep(0.05, 0.04, false); // door thresholds, rug edges
  k.enableSnapToGround(0.12);
  k.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  k.setMinSlopeSlideAngle((55 * Math.PI) / 180);
  k.setApplyImpulsesToDynamicBodies(false);
  return k;
}
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
  private droneKcc: RAPIER.KinematicCharacterController | null = null;

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
  /**
   * One key per gadget, context-sensitive (spec #23):
   *  [G] operator gadget · [X] secondary gadget
   *   - tools (hammer, Pulse sensor, Ash launcher, IQ scanner): toggle equip, LMB uses
   *   - placeables (charges, batteries, jammers, ADS, EDD, turret, Castle panel):
   *     hold on a valid aim target to place (progress bar); with no valid
   *     target the same key detonates what you already placed
   *   - throwables (EMP, gas): press throws; Smoke's key detonates thrown canisters
   *   - actives: Montagne extends the shield, Blitz fires the flash
   * Slot 2/3 + LMB still works for WebMCP agents (instant use).
   */
  handleInput(s: Soldier, dt: number, inp: SoldierInput) {
    this.scanning.delete(s.id);
    this.iqScanning.delete(s.id);
    const hcd = (this.hammerCd.get(s.id) ?? 0) - dt;
    this.hammerCd.set(s.id, hcd);
    if (inp.alt) this.detonateOwned(s);
    // both keys must be processed every frame (a non-empty [G] hint must not starve [X])
    const hOp = this.useKey(s, dt, 'op', inp.gadget, inp.gadgetHeld);
    const hUni = this.useKey(s, dt, 'uni', inp.gadget2, inp.gadget2Held);
    s.gadgetHint = (inp.gadget2Held && hUni) || hOp || hUni || '';
    if (s.slot < 2) return;
    const isUniversal = s.slot === 3;
    const kind = isUniversal ? s.op.universal : s.op.gadget;
    if (kind === 'heartbeat') {
      if (inp.fire || inp.ads) { this.scanning.add(s.id); this.scan(s); }
      return;
    }
    if (kind === 'scanner') {
      if (inp.fire || inp.ads) { this.iqScanning.add(s.id); this.iqScan(s); }
      return;
    }
    if (kind === 'hammer') {
      if (inp.fire && hcd <= 0 && s.gadgetLeft > 0) { this.hammerCd.set(s.id, 1.05); this.hammer(s); }
      return;
    }
    if (kind === 'ash_round') {
      if (inp.firePressed && s.gadgetLeft > 0 && this.launch(s, 'ash_round', 38, 0.15)) { s.gadgetLeft--; if (s.gadgetLeft <= 0) s.switchSlot(0); }
      return;
    }
    // agents: slot + LMB = instant use
    if (!inp.firePressed) return;
    const left = isUniversal ? s.universalLeft : s.gadgetLeft;
    if (left <= 0) return;
    const used = this.useNow(s, kind);
    if (used) {
      if (isUniversal) s.universalLeft--; else s.gadgetLeft--;
      if ((isUniversal ? s.universalLeft : s.gadgetLeft) <= 0) s.switchSlot(0);
    }
  }

  private useNow(s: Soldier, kind: string): boolean {
    switch (kind) {
      case 'breach': case 'thermite': case 'cluster': case 'battery': return this.plant(s, kind);
      case 'emp': return this.launch(s, 'emp', THROW_SPEED, 1);
      case 'gas': return this.launch(s, 'gas', THROW_SPEED * 0.85, 1);
      case 'jammer': case 'ads': return this.deploy(s, kind);
      case 'edd': return this.placeEdd(s);
      case 'turret': return this.placeTurret(s);
      case 'castle': {
        const op = this.world.interactions.openingInFront(s, 1.8);
        if (!op || !op.barricadeable || op.barricadeKind === 'castle') return false;
        this.world.interactions.placeBarricade(op, 'castle', true);
        return true;
      }
    }
    return false;
  }

  /** returns a HUD hint (i18n key) for this key in the current context */
  private useKey(s: Soldier, dt: number, which: 'op' | 'uni', pressed: boolean, held: boolean): string {
    const kind = which === 'op' ? s.op.gadget : s.op.universal;
    if (kind === 'none' || kind === 'barricade') return '';
    const keyAction = which === 'op' ? 'G' : 'X';
    const name = which === 'op' ? s.op.gadgetName : kind === 'breach' ? 'gadgetName.breach' : kind;
    const left = which === 'op' ? s.gadgetLeft : s.universalLeft;
    const holdKey = `${s.id}:${which}`;
    const spend = () => {
      if (which === 'op') s.gadgetLeft--; else s.universalLeft--;
    };
    const cls = GADGET_CLASS[kind] ?? 'place';
    if (cls === 'tool') {
      if (pressed) s.switchSlot(s.slot === 2 && which === 'op' ? 0 : 2);
      return held ? '' : `gadget.equip|${keyAction}|${name}`;
    }
    if (cls === 'active') {
      if (kind === 'shield_ext') {
        if (pressed) s.shieldExtended = !s.shieldExtended;
        return '';
      }
      if (kind === 'flash_shield') {
        if (pressed && left > 0 && s.flashCd <= 0) { spend(); s.flashCd = 1.2; this.blitzFlash(s); }
        return left > 0 ? `gadget.fire|${keyAction}|${name}` : 'gadget.none';
      }
      return '';
    }
    if (cls === 'throw') {
      if (pressed) {
        if (kind === 'gas' && this.ownsArmed(s, 'gas')) { this.detonateOwned(s); return ''; }
        if (left > 0 && this.useNow(s, kind)) spend();
      }
      if (kind === 'gas' && this.ownsArmed(s, 'gas')) return `gadget.detonate|${keyAction}`;
      return left > 0 ? `gadget.throw|${keyAction}|${name}` : '';
    }
    // placeables: HOLD on a valid target to place · TAP to detonate what you own (even while still looking at the wall)
    const valid = left > 0 && this.validTarget(s, kind);
    const dur = PLACE_TIME[kind] ?? 0.6;
    const detonatable = this.ownsArmed(s, kind);
    if (pressed) this.pressAt.set(holdKey, this.world.time);
    const tap = !held && this.pressAt.has(holdKey) && this.world.time - this.pressAt.get(holdKey)! < TAP_TIME;
    if (!held) { this.pressAt.delete(holdKey); this.holdDone.delete(holdKey); }
    if (tap && detonatable) { this.placeHold.delete(holdKey); s.interactProgress = 0; this.detonateOwned(s); return ''; }
    if (held && valid && !this.holdDone.has(holdKey) && (!detonatable || this.world.time - (this.pressAt.get(holdKey) ?? this.world.time) >= TAP_TIME)) {
      const t = (this.placeHold.get(holdKey) ?? 0) + dt;
      this.placeHold.set(holdKey, t);
      s.interactProgress = Math.min(1, t / dur);
      s.interactLabel = kind === 'castle' ? 'action.deployCastle' : 'action.placing';
      if (t >= dur) {
        this.placeHold.delete(holdKey);
        s.interactProgress = 0;
        if (this.useNow(s, kind)) spend();
        this.holdDone.add(holdKey); // one placement per hold — release to place another
      }
      return '';
    }
    if (this.placeHold.has(holdKey) && !held) { this.placeHold.delete(holdKey); s.interactProgress = 0; }
    if (detonatable) return valid ? `gadget.placeOrDetonate|${keyAction}|${name}` : `gadget.detonate|${keyAction}`;
    if (valid) return `gadget.place|${keyAction}|${name}`;
    return '';
  }

  private ownsArmed(s: Soldier, kind: string): boolean {
    for (const g of this.list.values()) {
      if (g.owner !== s.id || !g.local) continue;
      if ((kind === 'breach' || kind === 'thermite') && g.type === kind && g.state === 'armed') return true;
      if (kind === 'gas' && g.type === 'gas' && g.state === 'stuck') return true;
    }
    return false;
  }

  /** is the soldier aiming at somewhere this gadget can go right now? */
  validTarget(s: Soldier, kind: string): boolean {
    if (kind === 'jammer' || kind === 'ads' || kind === 'turret') return !!this.floorInFront(s, kind === 'turret' ? 0.9 : 0.7);
    if (kind === 'castle' || kind === 'edd') {
      const op = this.world.interactions.openingInFront(s, 1.8);
      if (!op) return false;
      if (kind === 'castle') return op.barricadeable && op.barricadeKind !== 'castle';
      return op.kind !== 'vent' && op.kind !== 'shutter' && op.run !== 'd' && ![...this.list.values()].some((g) => g.type === 'edd' && g.data.opening === op.id);
    }
    const hit = this.world.physics.raycast(s.eye(), s.aimDir(), 1.9, G_WORLD);
    if (!hit || hit.tag?.kind !== 'panel') return kind === 'thermite' ? false : false;
    const panel = this.world.destruction.get(hit.tag.panelId);
    if (!panel || panel.kind === 'castle') return kind === 'battery' && !!panel;
    if (kind === 'battery') return panel.reinforced;
    if (kind === 'thermite') return true;
    return !panel.reinforced; // breach / cluster
  }

  private floorInFront(s: Soldier, dist: number): THREE.Vector3 | null {
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const start = s.pos.clone().addScaledVector(fwd, dist).add(new THREE.Vector3(0, 0.5, 0));
    const down = this.world.physics.raycast(start, new THREE.Vector3(0, -1, 0), 2, G_WORLD);
    if (!down || down.normal.y < 0.7) return null;
    return down.point;
  }

  /** IQ: enemy electronics within 20 m, through walls */
  readonly iqContacts = new Map<string, THREE.Vector3[]>();
  private pressAt = new Map<string, number>();
  /** a fresh soldier under a reused id (respawn / new round / operator swap) starts with clean key state */
  forgetKeys(id: string) {
    for (const m of [this.pressAt, this.placeHold]) for (const k of [...m.keys()]) if (k.startsWith(`${id}:`)) m.delete(k);
    for (const k of [...this.holdDone]) if (k.startsWith(`${id}:`)) this.holdDone.delete(k);
  }
  private holdDone = new Set<string>();
  private iqScanning = new Set<string>();
  isIqScanning(s: Soldier) { return this.iqScanning.has(s.id); }
  private iqScan(s: Soldier) {
    const out: THREE.Vector3[] = [];
    for (const g of this.list.values()) {
      if (g.team === s.side || g.state === 'done' || g.type === 'bomblet') continue;
      if (g.pos.distanceTo(s.pos) < 20) out.push(g.pos.clone());
    }
    for (const c of this.world.house.cameras) if (c.alive && s.side === 'attack' && c.pos.distanceTo(s.pos) < 20) out.push(c.pos.clone());
    for (const b of this.world.objectives.bombs) if (b.pos.distanceTo(s.pos) < 20) out.push(b.pos.clone().add(new THREE.Vector3(0, 0.3, 0)));
    this.iqContacts.set(s.id, out);
  }

  /** Blitz: blinding flash in a 60° cone, 6 m */
  private blitzFlash(s: Soldier) {
    const eye = s.eye();
    const fwd = s.aimDir();
    this.world.effects.flashBurst(eye.clone().addScaledVector(fwd, 0.6));
    this.world.sound({ type: 'gadget', pos: eye.clone(), radius: 25, source: s.id, intensity: 0.8, label: 'flash' });
    this.world.emit({ t: 'flash', p: eye.toArray(), d: fwd.toArray(), by: s.id });
    this.applyFlash(eye, fwd, s.side);
  }

  /** blind everyone in the cone that has line of sight (local sim + local player) */
  applyFlash(origin: THREE.Vector3, dir: THREE.Vector3, team: string) {
    for (const a of this.world.soldiers.values()) {
      if (!this.world.targetable(a) || a.side === team) continue;
      const head = a.eye();
      const to = head.clone().sub(origin);
      const d = to.length();
      if (d > 6.5) continue;
      if (to.normalize().dot(dir) < Math.cos(THREE.MathUtils.degToRad(32))) continue;
      if (!this.world.physics.clearLine(origin, head)) continue;
      // facing the flash = full effect, back turned = short
      const facing = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).dot(to.clone().negate().setY(0).normalize());
      a.blindUntil = Math.max(a.blindUntil, this.world.time + (facing > 0.3 ? 4 : 1.5) * (1 - d / 9));
    }
  }

  /** Kapkan: Entry Denial Device on the door / window frame in front */
  private placeEdd(s: Soldier): boolean {
    const op = this.world.interactions.openingInFront(s, 1.8);
    if (!op || op.run === 'd' || op.kind === 'vent' || op.kind === 'shutter') return false;
    const side = Math.sign(s.pos.clone().sub(op.center).dot(op.normal)) || 1;
    const along = new THREE.Vector3(-op.normal.z, 0, op.normal.x);
    const p = op.center.clone().addScaledVector(along, -op.w / 2 + 0.04).addScaledVector(op.normal, side * (op.thickness / 2 + 0.02)).setY(op.center.y - op.h / 2 + 0.35);
    const g = this.make('edd', s, p, op.normal.clone().multiplyScalar(side), true);
    g.state = 'armed';
    g.data.opening = op.id;
    g.data.a = p.toArray();
    g.data.b = p.clone().addScaledVector(along, op.w - 0.08).toArray();
    this.addLaser(g);
    this.broadcastSpawn(g);
    this.world.sound({ type: 'gadget', pos: p.clone(), radius: 6, source: s.id, intensity: 0.3, label: 'place_edd' });
    return true;
  }

  private addLaser(g: Gadget) {
    const a = new THREE.Vector3(...(g.data.a as number[]));
    const b = new THREE.Vector3(...(g.data.b as number[]));
    const len = a.distanceTo(b);
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, len, 4), new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.55, toneMapped: false }));
    laser.position.copy(a).add(b).multiplyScalar(0.5);
    laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.group.add(laser);
    g.data.laser = laser;
  }

  /** Tachanka: deployable LMG turret on the floor in front */
  private placeTurret(s: Soldier): boolean {
    const p = this.floorInFront(s, 0.9);
    if (!p) return false;
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const g = this.make('turret', s, p.clone(), fwd, true);
    g.state = 'armed';
    g.data.yaw = s.yaw;
    g.mesh.rotation.set(0, s.yaw, 0);
    g.mesh.position.copy(p);
    // a waist-high armour plate in front of the gun (bulletproof)
    const plate = p.clone().addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, 0.75, 0));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    g.data.plate = this.world.physics.addBox(plate.x, plate.y, plate.z, 0.38, 0.28, 0.03, { kind: 'gadget', gadgetId: `plate:${g.id}` }, q, G_GADGET);
    this.broadcastSpawn(g);
    this.world.sound({ type: 'gadget', pos: p.clone(), radius: 10, source: s.id, intensity: 0.5, label: 'deploy_turret' });
    return true;
  }

  /** the turret this soldier could mount (own team, standing behind it) */
  turretNear(s: Soldier): Gadget | null {
    for (const g of this.list.values()) {
      if (g.type !== 'turret' || g.team !== s.side || g.state === 'done') continue;
      if (g.data.gunner && g.data.gunner !== s.id) continue;
      const fwd = new THREE.Vector3(-Math.sin(g.data.yaw as number), 0, -Math.cos(g.data.yaw as number));
      const behind = g.pos.clone().addScaledVector(fwd, -0.55);
      if (behind.distanceTo(s.pos.clone().setY(g.pos.y)) < 0.9) return g;
    }
    return null;
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
    if (['jammer', 'ads', 'battery', 'breach', 'thermite', 'cluster', 'drone', 'defuser', 'edd', 'turret'].includes(type)) {
      // drone: 17 cm ball — fits under door barricades (19 cm) and through vents (25 cm)
      g.collider = this.world.physics.addBall(pos.x, pos.y, pos.z, type === 'drone' ? DRONE_R : type === 'turret' ? 0.25 : 0.1, { kind: 'gadget', gadgetId: g.id }, G_GADGET);
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
      edd: () => extraGadgetSpec('edd')!,
      turret: () => extraGadgetSpec('turret')!,
    }[type]();
    const m = buildAsset(spec);
    // gadget specs are authored "in hand" (-Z forward, offset); recentre for world placement
    m.children.forEach((c) => c.position.set(0, -0.05, 0.12));
    if (type === 'drone') m.children.forEach((c) => c.position.set(0, -DRONE_R - 0.005, 0));
    if (type === 'turret') m.children.forEach((c) => c.position.set(0, 0, 0));
    return m;
  }

  /** stick a charge on the panel/wall the soldier is looking at */
  private plant(s: Soldier, type: string): boolean {
    const hit = this.world.physics.raycast(s.eye(), s.aimDir(), 1.9, G_WORLD);
    if (!hit) return false;
    const panel = hit.tag?.kind === 'panel' ? this.world.destruction.get(hit.tag.panelId) ?? null : null;
    if (type === 'battery' && !(panel && (panel.reinforced || panel.kind === 'castle'))) return false;
    if ((type === 'breach' || type === 'cluster') && (!panel || panel.reinforced)) return false;
    if (type === 'thermite' && !panel) return false;
    const g = this.make(type as GadgetType, s, hit.point.clone().addScaledVector(hit.normal, 0.05), hit.normal, true);
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

  private deploy(s: Soldier, type: string): boolean {
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const start = s.pos.clone().addScaledVector(fwd, 0.7).add(new THREE.Vector3(0, 0.5, 0));
    const down = this.world.physics.raycast(start, new THREE.Vector3(0, -1, 0), 2, G_WORLD);
    if (!down) return false;
    const g = this.make(type as GadgetType, s, down.point.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), true);
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
      if (a.id === s.id || !this.world.targetable(a)) continue;
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

  private detonateOwned(s: Soldier): boolean {
    let any = false;
    for (const g of [...this.list.values()]) {
      if (g.owner !== s.id || !g.local) continue;
      if (g.type === 'breach' && g.state === 'armed') {
        if (this.jammedAt(g.pos, g.team)) { this.world.effects.spark(g.pos, '#ff4040'); continue; }
        this.explodeBreach(g);
        any = true;
      } else if (g.type === 'thermite' && g.state === 'armed') {
        g.state = 'burning';
        g.fuse = 4.0;
        this.world.emit({ t: 'gadget', op: 'trigger', id: g.id });
        any = true;
      } else if (g.type === 'gas' && g.state === 'stuck') {
        this.releaseGas(g);
        any = true;
      }
    }
    return any;
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
      if (!this.world.targetable(a) || a.id === s.id || a.side === s.side) continue;
      const d = a.pos.distanceTo(s.pos);
      if (d > 9) continue;
      const dir = a.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(eye);
      out.push({ dir: dir.normalize(), dist: d, dy: a.pos.y - s.pos.y });
    }
    this.heartbeats.set(s.id, out);
  }

  shootGadget(id: string, by: string) {
    if (id.startsWith('cctv:')) { this.destroyCamera(id.slice(5), true); return; }
    if (id.startsWith('shield:') || id.startsWith('plate:')) return;
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
        case 'edd': this.updateEdd(g); break;
        case 'battery':
          // spec #19: an electrified wall is obvious — crackling sparks on BOTH faces + a hum
          if (g.state !== 'done' && Math.random() < dt * 3.2) this.zapPanel(g);
          break;
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

  /** Bandit feedback: arcs across the panel face, both sides, plus an electric crackle */
  private zapPanel(g: Gadget) {
    const panel = g.panelId !== null ? this.world.destruction.get(g.panelId) : undefined;
    if (!panel) { this.world.effects.spark(g.pos, '#9fd8ff'); return; }
    const c = panel.center;
    for (const side of [-1, 1]) {
      const p = c.clone();
      p.setComponent(panel.uAx, panel.min.getComponent(panel.uAx) + Math.random() * panel.size(panel.uAx));
      p.setComponent(panel.vAx, panel.min.getComponent(panel.vAx) + Math.random() * panel.size(panel.vAx));
      p.setComponent(panel.nAx, (side < 0 ? panel.min : panel.max).getComponent(panel.nAx) + side * 0.02);
      this.world.effects.spark(p, '#9fd8ff');
    }
    if (Math.random() < 0.5) this.world.sound({ type: 'gadget', pos: c.clone(), radius: 9, source: g.owner, intensity: 0.35, label: 'zap_hum' });
  }

  /** Kapkan EDD: an enemy crossing the laser sets it off */
  private updateEdd(g: Gadget) {
    const a = new THREE.Vector3(...(g.data.a as number[]));
    const b = new THREE.Vector3(...(g.data.b as number[]));
    const ab = b.clone().sub(a);
    const L = ab.length();
    ab.normalize();
    for (const actor of this.world.actors.values()) {
      if (!this.world.targetable(actor) || actor.side === g.team || actor.side === 'hostage') continue;
      const feet = actor.pos.clone().setY(a.y);
      const t = THREE.MathUtils.clamp(feet.clone().sub(a).dot(ab), 0, L);
      const closest = a.clone().addScaledVector(ab, t);
      if (closest.distanceTo(feet) < 0.28 && Math.abs(actor.pos.y + 0.3 - a.y) < 0.6) {
        this.boom(g, 2.2, 75, 'small');
        this.remove(g, true);
        return;
      }
    }
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
    // hop high enough for door thresholds, low props and stair steps (spec #6)
    if (inp.jump && g.data.grounded) v.y = 5.4;
    // rolls with a character controller: slides along walls, climbs the sloped stair colliders, snaps down steps
    const ph = this.world.physics;
    const kcc = (this.droneKcc ??= makeDroneController(ph));
    const c = g.collider;
    if (!c) return;
    const want = v.clone().multiplyScalar(dt);
    kcc.computeColliderMovement(c, { x: want.x, y: want.y, z: want.z }, undefined, groups(0xffff, G_WORLD | G_CLIP));
    const m = kcc.computedMovement();
    g.pos.x += m.x;
    g.pos.y += m.y;
    g.pos.z += m.z;
    g.data.grounded = kcc.computedGrounded();
    if (g.data.grounded && v.y < 0) v.y = 0;
    if (want.y > 0 && m.y < want.y - 1e-4) v.y = 0; // bonked
    c.setTranslation({ x: g.pos.x, y: g.pos.y, z: g.pos.z });
    g.mesh.position.copy(g.pos);
    g.mesh.rotation.set(0, yaw, 0);
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
    if (g.data.laser) this.group.remove(g.data.laser as THREE.Object3D);
    if (g.data.plate) this.world.physics.remove(g.data.plate as RAPIER.Collider);
    if (g.type === 'turret' && g.data.gunner) {
      const gunner = this.world.soldiers.get(g.data.gunner as string);
      if (gunner) gunner.dismount();
    }
    if (broadcast && g.local) this.world.emit({ t: 'gadget', op: 'remove', id: g.id });
  }

  /** default CCTV: shooting it kills the feed (sparks, LED off) */
  destroyCamera(id: string, broadcast: boolean) {
    const cam = this.world.house.cameras.find((c) => c.id === id);
    if (!cam || !cam.alive) return;
    cam.alive = false;
    this.world.effects.spark(cam.pos);
    this.world.effects.spark(cam.pos, '#ffffff');
    cam.mesh.rotation.x = -1.1;
    cam.mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'SphereGeometry') o.visible = false; });
    this.world.physics.remove(cam.collider as RAPIER.Collider);
    this.world.sound({ type: 'impact', pos: cam.pos.clone(), radius: 12, source: 'cctv', intensity: 0.5, label: 'camera_break' });
    if (broadcast) this.world.emit({ t: 'gadget', op: 'remove', id: `cctv:${id}` });
  }

  remoteRemove(id: string) {
    if (id.startsWith('cctv:')) { this.destroyCamera(id.slice(5), false); return; }
    const g = this.list.get(id);
    if (g) this.remove(g, false);
  }

  remoteExplosion(p: number[], r: number, kind: string) {
    const v = new THREE.Vector3(...p);
    this.world.effects.explosion(v, Math.min(r, 2), (kind as 'frag') ?? 'frag');
    this.world.sound({ type: 'explosion', pos: v, radius: 55, source: 'remote', intensity: 1, label: kind });
  }

  /** new round: every default camera works again */
  resetCameras() {
    for (const c of this.world.house.cameras) {
      if (c.alive) continue;
      c.alive = true;
      c.mesh.rotation.x = -0.35;
      c.mesh.traverse((o) => { o.visible = true; });
      c.collider = this.world.physics.addBox(c.pos.x, c.pos.y, c.pos.z, 0.09, 0.09, 0.16, { kind: 'gadget', gadgetId: `cctv:${c.id}` });
    }
  }

  clear() {
    this.resetCameras();
    for (const g of [...this.list.values()]) this.remove(g, false);
    this.toxic = [];
    this.drones.clear();
    this.heartbeats.clear();
  }

  /** for WebMCP vision / HUD */
  all(): Gadget[] { return [...this.list.values()]; }
}
