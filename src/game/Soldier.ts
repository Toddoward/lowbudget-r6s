import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G_CHAR, G_CLIP, G_GADGET, G_WORLD, groups } from '../core/Physics.ts';
import { computeHitboxes, type Actor, type Hitboxes } from './Actor.ts';
import { OPERATORS, ARMOR_MUL, SPEED_MUL, MAX_HP, REINFORCEMENTS_PER_ROUND, type OperatorDef } from './operators.ts';
import { WEAPONS, type WeaponDef } from './weapons.ts';
import { Stance, type ActorKind, type Side } from './types.ts';
import type { World } from './World.ts';
import { gaussian } from '../../shared/rng.ts';

/** Per-frame intent. Produced by keyboard/mouse, by the WebMCP action API or by the bot FSM. */
export interface SoldierInput {
  moveF: number;
  moveR: number;
  sprint: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  reload: boolean;
  melee: boolean;
  /** requested stance (null = keep) */
  stance: Stance | null;
  lean: -1 | 0 | 1;
  interact: boolean;
  interactPressed: boolean;
  /** 0 primary 1 secondary 2 operator gadget 3 universal gadget */
  slot: number | null;
  /** remote detonate / alt use [G] */
  alt: boolean;
  /** rappel: toggle upside-down [C] */
  invert: boolean;
  /** rappel: push off / vault [Space] */
  jump: boolean;
  /** operator gadget key [G]: press edge / held */
  gadget: boolean;
  gadgetHeld: boolean;
  /** secondary gadget key [X] */
  gadget2: boolean;
  gadget2Held: boolean;
  /** ping / spot [B] */
  ping: boolean;
  lookDYaw: number;
  lookDPitch: number;
}
export const emptyInput = (): SoldierInput => ({
  moveF: 0, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false,
  stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0,
  gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false,
});

export interface WeaponState { def: WeaponDef; mag: number; reserve: number }

type Mode = 'normal' | 'rappel' | 'vault' | 'swing' | 'dead';
interface RappelState {
  n: THREE.Vector3;
  topY: number;
  topCheckT: number;
  climbing: number;
  climbFrom: THREE.Vector3;
  climbTo: THREE.Vector3;
}
interface MoveAnim { t: number; dur: number; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3; onMid?: () => void; midDone: boolean; endStance: Stance }

const UP = new THREE.Vector3(0, 1, 0);
// spec: 1.8 m tall standing capsule (r 0.35); eye heights 1.65 / 1.05 / 0.40
const RADIUS = 0.35;
const HALF: Record<number, number> = { [Stance.Stand]: 0.55, [Stance.Crouch]: 0.25, [Stance.Prone]: 0.0, [Stance.Rappel]: 0.55 };
const EYE: Record<number, number> = { [Stance.Stand]: 1.65, [Stance.Crouch]: 1.05, [Stance.Prone]: 0.4, [Stance.Rappel]: 1.65 };
/** generic vault: anything with its top at most this high above the feet */
const VAULT_MAX_H = 1.3;
/** shallower than this → vault over; deeper → climb on top */
const VAULT_OVER_DEPTH = 0.85;
export interface VaultPlan { over: boolean; top: number; mid: THREE.Vector3; land: THREE.Vector3 }
const WALL_GAP = 0.42;

/**
 * Rappel controls follow the view: hanging upright, W climbs and D goes right; hanging
 * inverted (camera rolled 180°) the top of the screen points at the ground, so W
 * descends, S climbs, and screen-right is the world's left.
 */
export function rappelAxes(moveF: number, moveR: number, inverted: boolean): { up: number; side: number } {
  return inverted ? { up: -moveF, side: -moveR } : { up: moveF, side: moveR };
}

/** Mouse look follows the view the same way: with the camera rolled 180°, moving the mouse right turns toward screen-right (the world's left) and up toward screen-up (the ground) */
/** a surface is walked on (not pushed against) up to the controller's 52° climb limit */
const WALKABLE_NY = Math.cos((52 * Math.PI) / 180);
/** height gained moving (dx, dz) along a surface with this outward normal */
export function groundRise(n: { x: number; y: number; z: number }, dx: number, dz: number) {
  return -(n.x * dx + n.z * dz) / n.y;
}

export function viewLook(dYaw: number, dPitch: number, rolled: boolean): { dYaw: number; dPitch: number } {
  return rolled ? { dYaw: -dYaw, dPitch: -dPitch } : { dYaw, dPitch };
}

export class Soldier implements Actor {
  readonly id: string;
  name: string;
  side: Side;
  kind: ActorKind;
  operator: string;
  op: OperatorDef;
  alive = true;
  hp = MAX_HP;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance = Stance.Stand;
  lean = 0;
  inverted = false;
  /** outward normal of the ground under the feet after the last move (null in the air) */
  private groundN: THREE.Vector3 | null = null;
  weapons: WeaponState[] = [];
  slot = 0;
  ads = 0;
  reloadT = 0;
  reloadDur = 0;
  equipT = 0;
  fireCd = 0;
  recoilP = 0;
  recoilY = 0;
  shotsInBurst = 0;
  gadgetLeft = 0;
  universalLeft = 0;
  reinforcementsLeft = REINFORCEMENTS_PER_ROUND;
  meleeCd = 0;
  mode: Mode = 'normal';
  grounded = true;
  lastHurt = -99;
  lastHurtDir = new THREE.Vector3();
  killer = '';
  /** extra aim error (deg, 1σ) – bots */
  extraSpread = 0;
  spreadModel: 'gaussian' | 'linear' = 'gaussian';
  /** interaction progress 0..1 for HUD */
  interactProgress = 0;
  interactLabel = '';
  noiseAcc = 0;
  collider: RAPIER.Collider;
  rappel: RappelState | null = null;
  private anim: MoveAnim | null = null;
  private controller: RAPIER.KinematicCharacterController;
  private eyeH = EYE[Stance.Stand];
  private headBob = 0;
  private wasFire = false;
  private camLean = 0;
  /** HUD hint for the gadget keys in the current context (i18n key) */
  gadgetHint = '';
  /** Montagne: shield extended (full cover, no shooting) */
  shieldExtended = false;
  /** shield operators: shield slung on the back ([1] toggles; default: held in front). The pistol stays in hand either way. */
  shieldBack = false;
  /** Blitz flash cooldown */
  flashCd = 0;
  /** blinded by a flash until world time */
  blindUntil = -1;
  /** Tachanka: mounted turret gadget id */
  mounted: string | null = null;
  private mountSave: WeaponState[] | null = null;
  /** ballistic shield collider (Montagne / Blitz) */
  shieldCollider: RAPIER.Collider | null = null;
  /** angular offset of the weapon bore from the camera axis (local player, from the view model) — the shot follows the collimated reticle */
  boreYaw = 0;
  borePitch = 0;
  /** set by World.damage to let HUD flash */
  hitMarker = 0;
  onDeath?: (s: Soldier, killer: string, head: boolean) => void;

  constructor(private world: World, opts: { id: string; name: string; side: Side; operator: string; kind: ActorKind; pos: THREE.Vector3; yaw?: number }) {
    this.id = opts.id;
    this.name = opts.name;
    this.side = opts.side;
    this.kind = opts.kind;
    this.operator = opts.operator;
    this.op = OPERATORS[opts.operator] ?? OPERATORS.recruit;
    this.pos.copy(opts.pos);
    this.yaw = opts.yaw ?? 0;
    const ph = world.physics;
    this.collider = ph.addCapsule(this.pos.x, this.pos.y + HALF[0] + RADIUS, this.pos.z, HALF[0], RADIUS, { kind: 'char', actorId: this.id }, G_CHAR, G_WORLD | G_CHAR | G_CLIP);
    this.controller = ph.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.36, 0.12, false);
    this.controller.enableSnapToGround(0.32);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.resetLoadout();
    this.syncShield();
  }

  /** (re)create / remove the ballistic shield collider to match the operator */
  private syncShield() {
    const want = !!this.op.shield;
    if (want && !this.shieldCollider) {
      this.shieldCollider = this.world.physics.addBox(this.pos.x, this.pos.y + 1, this.pos.z, 0.3, 0.55, 0.03, { kind: 'gadget', gadgetId: `shield:${this.id}` }, undefined, G_GADGET);
    } else if (!want && this.shieldCollider) {
      this.world.physics.remove(this.shieldCollider);
      this.shieldCollider = null;
    }
  }

  /** shield follows the body: left-of-centre at the hip, or the whole body when extended */
  private updateShield() {
    if (this.shieldCollider) placeShield(this.shieldCollider, this.pos, this.yaw, this.stance, this.shieldPose!, this.alive);
  }

  mountTurret(turretId: string, at: THREE.Vector3, yaw: number) {
    if (this.mounted) return;
    this.mounted = turretId;
    this.mountSave = this.weapons;
    this.weapons = [{ def: WEAPONS.rp46, mag: WEAPONS.rp46.mag, reserve: 0 }, this.weapons[1]];
    this.slot = 0;
    this.equipT = 0.5;
    this.trySetStance(Stance.Crouch);
    this.teleport(at, yaw);
    this.mounted = turretId;
    this.mode = 'normal';
  }

  dismount() {
    if (!this.mounted) return;
    this.mounted = null;
    if (this.mountSave) this.weapons = this.mountSave;
    this.mountSave = null;
    this.slot = 0;
    this.equipT = 0.4;
  }

  resetLoadout() {
    const op = this.op;
    if (op.shield) {
      // shield + pistol: both weapon slots are the one pistol (slot [1] works the shield instead)
      const def = WEAPONS[op.secondary];
      const pistol = { def, mag: def.mag, reserve: def.reserve };
      this.weapons = [pistol, pistol];
    } else {
      this.weapons = [op.primary, op.secondary].map((id) => {
        const def = WEAPONS[id];
        return { def, mag: def.mag, reserve: def.reserve };
      });
    }
    this.slot = 0;
    this.gadgetLeft = op.gadgetCount;
    this.universalLeft = op.universalCount;
    this.reinforcementsLeft = this.side === 'defend' ? REINFORCEMENTS_PER_ROUND : 0;
    this.shieldExtended = false;
    this.shieldBack = false;
    this.blindUntil = -1;
    this.mounted = null;
    this.mountSave = null;
    this.hp = MAX_HP;
    this.alive = true;
    this.mode = 'normal';
    this.rappel = null;
    this.anim = null;
    this.stance = Stance.Stand;
    this.inverted = false;
    this.reloadT = 0;
  }

  setOperator(id: string) {
    this.operator = id;
    this.op = OPERATORS[id] ?? OPERATORS.recruit;
    this.resetLoadout();
    this.syncShield();
  }

  get weapon(): WeaponState | null { return this.slot < 2 ? this.weapons[this.slot] : null; }
  get weaponId(): string | null { return this.weapon?.def.id ?? null; }
  get speedMul() { return SPEED_MUL[this.op.speed]; }
  get armorMul() { return ARMOR_MUL[this.op.armor]; }
  /** where the shield is right now (null: no shield) */
  get shieldPose(): ShieldPose | null { return this.op.shield ? shieldPoseOf(this.shieldExtended, this.shieldBack, this.ads > 0.5) : null; }
  get reloading() { return this.reloadT > 0; }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.mode === 'rappel' && this.inverted) return out.copy(this.pos).add(new THREE.Vector3(0, 0.22, 0));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3().crossVectors(fwd, UP);
    return out.copy(this.pos).add(new THREE.Vector3(0, this.eyeH + this.headBob, 0)).addScaledVector(right, this.camLean);
  }

  /** forward look vector (with recoil applied) */
  aimDir(out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.pitch + this.recoilP;
    const y = this.yaw + this.recoilY;
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  hitboxes(): Hitboxes {
    return computeHitboxes(this.pos, this.yaw, this.stance, this.lean, this.mode === 'rappel' && this.inverted);
  }

  get cameraRoll(): number {
    if (this.mode === 'rappel' && this.inverted) return Math.PI;
    return -this.lean * 0.21;
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.mode = this.alive ? 'normal' : 'dead';
    this.rappel = null;
    this.anim = null;
    this.inverted = false;
    if (this.stance === Stance.Rappel) this.stance = Stance.Stand;
    this.grounded = true;
    this.syncCollider();
  }

  private syncCollider() {
    const h = HALF[this.stance];
    this.collider.setHalfHeight(h);
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + h + RADIUS, z: this.pos.z });
  }

  /* ================================================================ update */
  update(dt: number, inp: SoldierInput) {
    // not deployed yet (attackers while droning): no body in the world
    const deployed = this.world.deployed(this);
    if (this.collider.isEnabled() !== deployed) this.collider.setEnabled(deployed);
    if (this.shieldCollider && this.shieldCollider.isEnabled() !== deployed) this.shieldCollider.setEnabled(deployed);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.flashCd = Math.max(0, this.flashCd - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.updateShield();
    this.equipT = Math.max(0, this.equipT - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    if (!this.alive) { this.mode = 'dead'; return; }

    // look
    const look = viewLook(inp.lookDYaw, inp.lookDPitch, this.mode === 'rappel' && this.inverted);
    this.yaw += look.dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.dPitch, -1.45, 1.45);
    if (this.mode === 'rappel' && this.rappel && !this.inverted) {
      // keep facing roughly into the wall (±85°)
      const wallYaw = Math.atan2(this.rappel.n.x, this.rappel.n.z);
      let d = THREE.MathUtils.euclideanModulo(this.yaw - wallYaw + Math.PI, Math.PI * 2) - Math.PI;
      d = THREE.MathUtils.clamp(d, -1.5, 1.5);
      this.yaw = wallYaw + d;
    }
    // recoil recovery
    const wdef = this.weapon?.def;
    const rec = wdef ? wdef.recoil.recover : 8;
    if (!inp.fire || !wdef) {
      this.recoilP -= this.recoilP * Math.min(1, rec * dt);
      this.recoilY -= this.recoilY * Math.min(1, rec * dt);
      this.shotsInBurst = 0;
    }

    if (this.anim) { this.updateAnim(dt); return; }
    if (this.mounted) {
      // turret gunner: body locked, limited traverse, [F]/[Space]/weapon key to leave
      const g = this.world.gadgets.list.get(this.mounted);
      if (!g || (inp.interactPressed || inp.jump || inp.slot === 1)) { this.dismount(); if (g) g.data.gunner = null; }
      else {
        const base = g.data.yaw as number;
        let d = THREE.MathUtils.euclideanModulo(this.yaw - base + Math.PI, Math.PI * 2) - Math.PI;
        d = THREE.MathUtils.clamp(d, -1.05, 1.05);
        this.yaw = base + d;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -0.35, 0.35);
        g.mesh.rotation.y = this.yaw;
        this.vel.set(0, 0, 0);
        this.updateWeapon(dt, { ...inp, slot: null });
        return;
      }
    }
    if (this.mode === 'rappel') this.updateRappel(dt, inp);
    else this.updateMove(dt, inp);
    this.updateWeapon(dt, inp);
    this.world.interactions.update(this, dt, inp);
    this.world.gadgets.handleInput(this, dt, inp);
  }

  /* ------------------------------------------------------------ on foot */
  private updateMove(dt: number, inp: SoldierInput) {
    // stance
    if (inp.stance !== null && inp.stance !== this.stance && inp.stance !== Stance.Rappel) this.trySetStance(inp.stance);
    // lean (not while prone / sprinting)
    const wantLean = this.stance === Stance.Prone || (inp.sprint && inp.moveF > 0.1) ? 0 : inp.lean;
    this.lean += (wantLean - this.lean) * Math.min(1, dt * 9);
    // camera lean offset limited by walls
    const maxLean = this.leanClearance(Math.sign(this.lean) || 1);
    this.camLean = THREE.MathUtils.clamp(this.lean * (this.stance === Stance.Crouch ? 0.28 : 0.34), -maxLean, maxLean);

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3().crossVectors(fwd, UP);
    const wish = new THREE.Vector3().addScaledVector(fwd, inp.moveF).addScaledVector(right, inp.moveR);
    if (wish.lengthSq() > 1) wish.normalize();
    let speed = 3.3 * this.speedMul;
    const sprinting = inp.sprint && inp.moveF > 0.3 && this.stance === Stance.Stand && this.ads < 0.3 && !this.reloading;
    if (sprinting) speed *= 1.6;
    if (this.stance === Stance.Crouch) speed *= 0.55;
    if (this.stance === Stance.Prone) speed *= 0.24;
    speed *= 1 - this.ads * 0.4;
    if (Math.abs(this.lean) > 0.3) speed *= 0.75;
    if (this.world.gadgets.isScanning(this)) speed *= 0.6;
    if (this.op.shield) speed *= SHIELD_SPEED[this.shieldPose!];
    if (this.world.gadgets.inToxicGas(this.pos)) speed *= 0.85;
    const target = wish.multiplyScalar(speed);
    const k = Math.min(1, dt * (this.grounded ? 14 : 2));
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    this.vel.y = this.grounded ? -1.5 : this.vel.y - 18 * dt;
    this.vel.y = Math.max(this.vel.y, -30);
    const desired = this.vel.clone().multiplyScalar(dt);
    // on the ground the legs carry the body along the surface — up a slope or a stair ramp the body is lifted and the
    // pace over the ground is the pace on the flat (pushing a flat vector into the hill made the controller slide it away)
    // (kept in contact by pressing into the surface along its normal: a vertical press would slide down the slope)
    if (this.grounded && this.groundN) desired.setY(groundRise(this.groundN, desired.x, desired.z)).addScaledVector(this.groundN, -0.4 * dt);
    this.moveCollide(desired, true);
    // eye height smoothing + head bob
    this.eyeH += (EYE[this.stance] - this.eyeH) * Math.min(1, dt * 10);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.headBob = this.grounded && this.kind === 'local' ? Math.sin(performance.now() * 0.012 * (sprinting ? 1.4 : 1)) * Math.min(1, hs / 4) * 0.025 : 0;
    // footsteps → acoustic events
    if (this.grounded && hs > 0.5) {
      this.noiseAcc += hs * dt;
      const stride = sprinting ? 1.4 : 1.0;
      if (this.noiseAcc > stride) {
        this.noiseAcc = 0;
        const radius = sprinting ? 16 : this.stance === Stance.Stand ? 9 : this.stance === Stance.Crouch ? 4 : 2;
        this.world.sound({ type: 'footstep', pos: this.pos.clone(), radius, source: this.id, intensity: sprinting ? 0.8 : 0.4 });
      }
    }
    // fall damage
    if (this.pos.y < -20) this.world.damageActor(this, 999, this.id, false);
    if (inp.jump && this.grounded) this.tryVault();
  }

  /** move with the character controller; updates pos & grounded */
  private moveCollide(desired: THREE.Vector3, gravity: boolean) {
    const filter = groups(0xffff, G_WORLD | G_CHAR | G_CLIP);
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z }, undefined, filter);
    const m = this.controller.computedMovement();
    // the walkable surface touched on this move (the one asking for the most lift if several)
    let gn: THREE.Vector3 | null = null;
    for (let i = 0, n = this.controller.numComputedCollisions(); i < n; i++) {
      const c = this.controller.computedCollision(i);
      if (!c || c.normal1.y < WALKABLE_NY) continue;
      if (!gn || groundRise(c.normal1, desired.x, desired.z) > groundRise(gn, desired.x, desired.z)) gn = new THREE.Vector3(c.normal1.x, c.normal1.y, c.normal1.z);
    }
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    this.grounded = gravity ? this.controller.computedGrounded() : false;
    if (this.grounded && !gn) {
      const hit = this.world.physics.raycast(this.pos.clone().setY(this.pos.y + 0.3), new THREE.Vector3(0, -1, 0), 0.6, G_WORLD | G_CLIP);
      if (hit && hit.normal.y >= WALKABLE_NY) gn = hit.normal.clone();
    }
    this.groundN = this.grounded ? gn : null;
    if (gravity && this.grounded && this.vel.y < 0) this.vel.y = -1.5;
    if (gravity && !this.grounded && m.y > desired.y + 1e-4 && desired.y > 0) this.vel.y = 0; // bonked ceiling
    this.syncCollider();
  }

  private leanClearance(side: number): number {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3().crossVectors(fwd, UP).multiplyScalar(side);
    const head = this.pos.clone().add(new THREE.Vector3(0, this.eyeH, 0));
    const hit = this.world.physics.raycast(head, right, 0.6, G_WORLD | G_CLIP);
    return hit ? Math.max(0, hit.dist - 0.16) : 0.4;
  }

  trySetStance(s: Stance): boolean {
    if (s === this.stance) return true;
    const cur = HALF[this.stance] * 2 + RADIUS * 2;
    const nxt = HALF[s] * 2 + RADIUS * 2;
    if (nxt > cur) {
      // head-room check
      const from = this.pos.clone().add(new THREE.Vector3(0, cur - 0.05, 0));
      for (const off of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
        const o = from.clone().add(new THREE.Vector3(off[0], 0, off[1]));
        if (this.world.physics.raycast(o, UP, nxt - cur + 0.05, G_WORLD | G_CLIP)) return false;
      }
    }
    this.stance = s;
    this.syncCollider();
    return true;
  }

  /* ------------------------------------------------------------ vault / climb */
  /**
   * Generic, geometry-driven vault (no special "vaultable" flags): look for an
   * obstacle right in front, find its top, then march along the top to measure
   * its depth. Thin things (window sills, breach lips, stair rails, counters)
   * are vaulted over; deep things (tables, beds, ledges) are climbed onto.
   */
  probeVault(): VaultPlan | null {
    if (this.mode !== 'normal' || !this.grounded || this.stance === Stance.Prone) return null;
    const ph = this.world.physics;
    const mask = G_WORLD | G_CLIP;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const feet = this.pos;
    let hitD = Infinity;
    for (const h of [0.4, 0.75, 1.1]) {
      const hit = ph.raycast(feet.clone().add(new THREE.Vector3(0, h, 0)), fwd, 0.9, mask);
      if (hit && Math.abs(hit.normal.y) < 0.5) hitD = Math.min(hitD, hit.dist);
    }
    if (hitD === Infinity) return null;
    const down = new THREE.Vector3(0, -1, 0);
    const front = feet.clone().addScaledVector(fwd, hitD + 0.1);
    const fromY = feet.y + VAULT_MAX_H + 0.5;
    const topHit = ph.raycast(front.clone().setY(fromY), down, VAULT_MAX_H + 0.5, mask);
    if (!topHit || topHit.dist < 0.02 || topHit.normal.y < 0.6) return null;
    const top = topHit.point.y;
    const rel = top - feet.y;
    if (rel < 0.33 || rel > VAULT_MAX_H) return null;
    // the body has to fit over the top (a window opening, not a wall with a shelf)
    if (ph.raycast(topHit.point.clone().add(new THREE.Vector3(0, 0.04, 0)), new THREE.Vector3(0, 1, 0), 0.85, mask)) return null;
    if (ph.raycast(feet.clone().add(new THREE.Vector3(0, rel + 0.45, 0)), fwd, hitD + 0.35, mask)) return null;
    // depth along the top
    let depth = 0;
    let land: THREE.Vector3 | null = null;
    for (let d = hitD + 0.25; d <= hitD + 2.2; d += 0.15) {
      const p = feet.clone().addScaledVector(fwd, d).setY(top + 0.45);
      const h = ph.raycast(p, down, 4.2, mask);
      if (h && Math.abs(h.point.y - top) < 0.14 && h.normal.y > 0.6) { depth = d - hitD; continue; }
      if (depth < VAULT_OVER_DEPTH) {
        const lp = feet.clone().addScaledVector(fwd, d + 0.35).setY(top + 0.45);
        const lh = ph.raycast(lp, down, 4.6, mask);
        if (lh && lh.normal.y > 0.6 && top - lh.point.y < 4.0) land = lh.point.clone().add(new THREE.Vector3(0, 0.02, 0));
      }
      break;
    }
    const mid = feet.clone().addScaledVector(fwd, hitD + 0.15).setY(top + 0.55);
    if (land && depth < VAULT_OVER_DEPTH) {
      if (ph.overlapsWorld(land.clone().add(new THREE.Vector3(0, 0.65, 0)), 0.3)) return null;
      return { over: true, top, mid, land };
    }
    const onTop = feet.clone().addScaledVector(fwd, hitD + 0.45).setY(top + 0.02);
    if (ph.overlapsWorld(onTop.clone().add(new THREE.Vector3(0, 0.62, 0)), 0.3)) return null;
    return { over: false, top, mid, land: onTop };
  }

  tryVault(): boolean {
    const plan = this.probeVault();
    if (!plan) return false;
    const clearUp = !this.world.physics.raycast(plan.land.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), 1.75, G_WORLD | G_CLIP);
    const dur = plan.over ? 0.55 + Math.max(0, plan.top - this.pos.y) * 0.15 : 0.75;
    this.playMove(this.pos, plan.mid, plan.land, dur, plan.over || !clearUp ? Stance.Crouch : Stance.Stand);
    this.world.sound({ type: 'footstep', pos: this.pos.clone(), radius: 10, source: this.id, intensity: 0.6, label: 'vault' });
    return true;
  }

  /* ------------------------------------------------------------ rappel */
  /** Try to hook a rope: from a roof/ledge edge (facing the drop) or from the ground (facing an exterior wall). */
  startRappel(dryRun = false): boolean {
    if (this.mode !== 'normal' || this.stance === Stance.Prone) return false;
    const ph = this.world.physics;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const isExterior = (tag: ReturnType<typeof ph.tagOf>) => {
      if (!tag) return false;
      if (tag.kind === 'static') return !!tag.exterior;
      if (tag.kind === 'panel') return !!this.world.destruction.get(tag.panelId)?.exterior;
      return false;
    };
    // (a) edge below us: drop-off ahead and an exterior wall face under the lip
    const probe = this.pos.clone().addScaledVector(fwd, 0.85).add(new THREE.Vector3(0, 0.3, 0));
    const down = ph.raycast(probe, new THREE.Vector3(0, -1, 0), 2.6, G_WORLD | G_CLIP);
    if (!down) {
      const back = this.pos.clone().addScaledVector(fwd, 1.4).add(new THREE.Vector3(0, -1.0, 0));
      const hit = ph.raycast(back, fwd.clone().negate(), 1.6, G_WORLD);
      if (hit && Math.abs(hit.normal.y) < 0.3 && isExterior(hit.tag)) {
        if (dryRun) return true;
        const n = hit.normal.clone().setY(0).normalize();
        this.enterRappel(n, hit.point.clone().addScaledVector(n, WALL_GAP).setY(this.pos.y - 1.75), this.pos.y);
        return true;
      }
    }
    // (b) from the ground: wall ahead, find its top from above
    if (this.grounded) {
      const chest = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      const hit = ph.raycast(chest, fwd, 1.1, G_WORLD);
      if (hit && Math.abs(hit.normal.y) < 0.3 && isExterior(hit.tag)) {
        const n = hit.normal.clone().setY(0).normalize();
        const topY = this.findTop(hit.point, n);
        if (topY !== null && topY > this.pos.y + 2.4) {
          if (dryRun) return true;
          this.enterRappel(n, hit.point.clone().addScaledVector(n, WALL_GAP).setY(this.pos.y + 0.25), topY);
          return true;
        }
      }
    }
    return false;
  }

  /** y of the walkable top above a wall face (roof/ledge), or null */
  private findTop(wallPoint: THREE.Vector3, n: THREE.Vector3): number | null {
    const from = wallPoint.clone().addScaledVector(n, -0.45).setY(wallPoint.y + 9);
    const hit = this.world.physics.raycast(from, new THREE.Vector3(0, -1, 0), 9.5, G_WORLD);
    if (!hit || hit.normal.y < 0.7) return null;
    // need head-room on the top
    const above = hit.point.clone().add(new THREE.Vector3(0, 0.15, 0));
    if (this.world.physics.raycast(above, UP, 1.7, G_WORLD)) return null;
    return hit.point.y;
  }

  private enterRappel(n: THREE.Vector3, p: THREE.Vector3, topY: number) {
    this.mode = 'rappel';
    this.stance = Stance.Rappel;
    this.inverted = false;
    this.lean = 0;
    this.camLean = 0;
    this.rappel = { n, topY, topCheckT: 0, climbing: 0, climbFrom: new THREE.Vector3(), climbTo: new THREE.Vector3() };
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(n.x, n.z);
    this.syncCollider();
    this.world.sound({ type: 'gadget', pos: this.pos.clone(), radius: 8, source: this.id, intensity: 0.4, label: 'rope' });
  }

  exitRappel(push = false) {
    if (!this.rappel) return;
    const n = this.rappel.n;
    this.mode = 'normal';
    this.rappel = null;
    this.inverted = false;
    this.stance = Stance.Stand;
    if (push) this.vel.copy(n).multiplyScalar(2.6).add(new THREE.Vector3(0, 1.2, 0));
    else this.vel.set(0, 0, 0);
    this.grounded = false;
    this.syncCollider();
  }

  private updateRappel(dt: number, inp: SoldierInput) {
    const R = this.rappel!;
    const ph = this.world.physics;
    const right = new THREE.Vector3().crossVectors(R.n.clone().negate(), UP);
    if (inp.invert) { this.inverted = !this.inverted; this.pitch = 0; }
    if (inp.jump) { this.exitRappel(true); return; }
    if (inp.interactPressed && this.world.interactions.trySwing(this)) return;
    this.lean += (inp.lean - this.lean) * Math.min(1, dt * 9);
    this.camLean = 0;
    // periodically re-evaluate the top (facades have different heights)
    R.topCheckT -= dt;
    if (R.topCheckT <= 0) {
      R.topCheckT = 0.25;
      const wallPt = this.pos.clone().addScaledVector(R.n, -WALL_GAP);
      const t = this.findTop(wallPt.setY(this.pos.y + 1), R.n);
      if (t !== null) R.topY = t;
    }
    const { up, side } = rappelAxes(inp.moveF, inp.moveR, this.inverted);
    const upSpd = up > 0 ? 1.6 : inp.sprint ? 4.2 : 2.3;
    let vy = up * upSpd;
    const vx = side * 1.3;
    // climb over the top
    if (up > 0.2 && this.pos.y >= R.topY - 1.9) {
      const over = this.pos.clone().addScaledVector(R.n, -WALL_GAP - 0.7).setY(R.topY + 0.05);
      if (!ph.overlapsWorld(over.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.28)) {
        this.anim = { t: 0, dur: 0.75, from: this.pos.clone(), mid: this.pos.clone().setY(R.topY + 0.25), to: over, midDone: false, endStance: Stance.Crouch };
        this.mode = 'vault';
        this.rappel = null;
        this.inverted = false;
        return;
      }
      vy = 0;
    }
    if (this.pos.y + vy * dt > R.topY - 1.75) vy = Math.min(vy, 0);
    const delta = new THREE.Vector3().addScaledVector(UP, vy * dt).addScaledVector(right, vx * dt);
    // hold distance to the wall
    const mid = this.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    const wh = ph.raycast(mid, R.n.clone().negate(), 1.5, G_WORLD);
    if (wh) delta.addScaledVector(R.n, -(wh.dist - WALL_GAP) * Math.min(1, dt * 8));
    // lateral move only while a wall stays behind the rope at some height (windows are fine)
    const test = this.pos.clone().add(delta);
    if (!this.wallBehind(test, R.n)) { delta.addScaledVector(right, -vx * dt); }
    this.moveCollide(delta, false);
    // reached the ground?
    if (vy < 0) {
      const g = ph.raycast(this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, -1, 0), 0.25, G_WORLD | G_CLIP);
      if (g) { this.exitRappel(false); return; }
    }
    if (Math.abs(vy) > 0.1 && Math.random() < dt * 3) this.world.sound({ type: 'footstep', pos: this.pos.clone(), radius: 6, source: this.id, intensity: 0.3 });
    this.eyeH = EYE[Stance.Stand];
  }

  private wallBehind(p: THREE.Vector3, n: THREE.Vector3): boolean {
    const back = n.clone().negate();
    for (const h of [0.3, 0.9, 1.5, 2.1]) {
      if (this.world.physics.raycast(p.clone().add(new THREE.Vector3(0, h, 0)), back, 1.2, G_WORLD)) return true;
    }
    return false;
  }

  /** scripted kinematic move (vault / swing / climb-over). */
  playMove(from: THREE.Vector3, mid: THREE.Vector3, to: THREE.Vector3, dur: number, endStance: Stance, onMid?: () => void) {
    this.anim = { t: 0, dur, from: from.clone(), mid: mid.clone(), to: to.clone(), onMid, midDone: false, endStance };
    this.mode = 'swing';
    this.rappel = null;
    this.inverted = false;
  }

  private updateAnim(dt: number) {
    const a = this.anim!;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    // quadratic bezier from → mid → to
    const p0 = a.from, p1 = a.mid, p2 = a.to;
    const u = 1 - k;
    this.pos.set(u * u * p0.x + 2 * u * k * p1.x + k * k * p2.x, u * u * p0.y + 2 * u * k * p1.y + k * k * p2.y, u * u * p0.z + 2 * u * k * p1.z + k * k * p2.z);
    if (!a.midDone && k >= 0.55) { a.midDone = true; a.onMid?.(); }
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + HALF[Stance.Crouch] + RADIUS, z: this.pos.z });
    if (k >= 1) {
      this.anim = null;
      this.mode = 'normal';
      this.stance = Stance.Stand;
      this.trySetStance(a.endStance);
      this.syncCollider();
      this.vel.set(0, 0, 0);
      this.grounded = false;
    }
  }

  /* ------------------------------------------------------------ weapon */
  private updateWeapon(dt: number, inp: SoldierInput) {
    if (this.op.shield && inp.slot !== null && inp.slot < 2) {
      // [1]: shield front ↔ back (from a gadget: back to the pistol); [2]: the pistol (already in hand)
      if (this.slot >= 2) this.switchSlot(0);
      else if (inp.slot === 0) this.toggleShield();
    } else if (inp.slot !== null && inp.slot !== this.slot) this.switchSlot(inp.slot);
    const w = this.weapon;
    const canAds = !!w && !this.reloading && this.equipT <= 0 && !(this.mode === 'rappel' && this.inverted) && !this.shieldExtended;
    this.ads += ((inp.ads && canAds ? 1 : 0) - this.ads) * Math.min(1, dt * 11);
    if (inp.melee && this.meleeCd <= 0) { this.meleeCd = 0.75; this.world.combat.melee(this); }
    if (!w) { this.wasFire = inp.fire; return; }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = w.def.mag + (w.mag > 0 && w.def.cls !== 'Shotgun' ? 1 : 0) - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    }
    if (inp.reload && this.reloadT <= 0 && w.mag < w.def.mag + 1 && w.reserve > 0) {
      this.reloadDur = w.mag === 0 ? w.def.reloadEmpty : w.def.reload;
      this.reloadT = this.reloadDur;
      this.ads = Math.min(this.ads, 0.2);
    }
    const trigger = (w.def.mode === 'auto' ? inp.fire : inp.fire && !this.wasFire) && !this.shieldExtended;
    this.wasFire = inp.fire;
    if (trigger && this.fireCd <= 0 && this.reloadT <= 0 && this.equipT <= 0) {
      if (w.mag <= 0) {
        if (w.reserve > 0) { this.reloadDur = w.def.reloadEmpty; this.reloadT = this.reloadDur; }
        this.fireCd = 0.25;
        return;
      }
      w.mag--;
      this.fireCd = 60 / w.def.rpm;
      this.shoot(w.def);
    }
  }

  /** sling the shield on the back / bring it round to the front (the pistol stays up, a short transition) */
  toggleShield() {
    if (!this.op.shield) return;
    this.shieldBack = !this.shieldBack;
    this.shieldExtended = false;
    this.equipT = Math.max(this.equipT, 0.35);
    this.ads = 0;
  }

  switchSlot(s: number) {
    if (s >= 2) {
      if (s === 2 && (this.op.gadget === 'none' || (this.gadgetLeft <= 0 && this.op.gadget !== 'heartbeat'))) return;
      if (s === 3 && (this.op.universal === 'none' || this.universalLeft <= 0)) return;
    }
    this.slot = s;
    this.reloadT = 0;
    this.equipT = 0.45;
    this.ads = 0;
  }

  private shoot(def: WeaponDef) {
    const origin = this.eye();
    const base = this.aimDir();
    if (this.kind === 'local' && this.ads > 0.05) {
      // optical collimation: the round leaves along the bore the reticle is drawn on
      const p = this.pitch + this.recoilP + this.borePitch * this.ads;
      const y = this.yaw + this.recoilY + this.boreYaw * this.ads;
      base.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    }
    // spread: hip vs ADS, movement, stance; bots add their own gaussian/linear aim error
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.6 ? 1 : 0;
    const stanceMul = this.stance === Stance.Crouch ? 0.85 : this.stance === Stance.Prone ? 0.7 : 1;
    let spreadDeg = THREE.MathUtils.lerp(def.hipSpread * (1 + moving * 0.6), def.adsSpread * (1 + moving * 0.8), this.ads) * stanceMul;
    // bots model their inaccuracy entirely through extraSpread (difficulty / distance / motion / aim error)
    if (this.kind === 'bot') spreadDeg = def.adsSpread;
    spreadDeg += Math.min(this.shotsInBurst, 10) * 0.05 * (1 - this.ads * 0.5);
    if (this.mode === 'rappel') spreadDeg *= 1.3;
    // pistol one-handed beside a shield held in front: wider from the hip
    if (this.op.shield && !this.shieldBack) spreadDeg *= 1 + (1 - this.ads) * 0.5;
    const pellets = def.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const d = applySpread(base, spreadDeg, this.extraSpread, this.spreadModel);
      this.world.combat.fireBullet(this, def, origin, d, i === 0);
    }
    // recoil kick
    const adsMul = 1 - this.ads * 0.38;
    const sm = this.stance === Stance.Crouch ? 0.85 : this.stance === Stance.Prone ? 0.65 : 1;
    this.recoilP += THREE.MathUtils.degToRad(def.recoil.v) * adsMul * sm * (1 + Math.min(this.shotsInBurst, 8) * 0.04);
    this.recoilY += THREE.MathUtils.degToRad((Math.random() - 0.4) * def.recoil.h * 2) * adsMul * sm;
    this.recoilP = Math.min(this.recoilP, 0.35);
    this.shotsInBurst++;
  }

  /* ------------------------------------------------------------ damage */
  takeDamage(amount: number, attacker: string, head: boolean, dir?: THREE.Vector3): boolean {
    if (!this.alive) return false;
    const dmg = head ? 999 : amount * this.armorMul;
    this.hp -= dmg;
    this.lastHurt = this.world.time;
    if (dir) this.lastHurtDir.copy(dir);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(attacker, head);
      return true;
    }
    return false;
  }

  damage(amount: number, attackerId: string, headshot: boolean, dir?: THREE.Vector3) {
    return this.takeDamage(amount, attackerId, headshot, dir);
  }

  die(killer: string, head: boolean) {
    if (this.mounted) { const g = this.world.gadgets.list.get(this.mounted); if (g) g.data.gunner = null; this.dismount(); }
    this.shieldExtended = false;
    this.alive = false;
    this.mode = 'dead';
    this.killer = killer;
    this.rappel = null;
    this.anim = null;
    this.collider.setTranslation({ x: this.pos.x, y: -500, z: this.pos.z });
    this.updateShield(); // the shield goes down with the body, not a frame later
    this.onDeath?.(this, killer, head);
  }

  revive(p: THREE.Vector3, yaw: number) {
    this.resetLoadout();
    this.teleport(p, yaw);
  }

  dispose() {
    if (this.shieldCollider) { this.world.physics.remove(this.shieldCollider); this.shieldCollider = null; }
    this.world.physics.remove(this.collider);
    this.world.physics.world.removeCharacterController(this.controller);
  }
}

/** Rotate `dir` by a random cone. gaussian: σ = spread/2 per axis ; linear: uniform disc of radius spread. */
export type ShieldPose = 'front' | 'ads' | 'back' | 'ext';
export const shieldPoseOf = (ext: boolean, back: boolean, ads: boolean): ShieldPose => (back ? 'back' : ext ? 'ext' : ads ? 'ads' : 'front');
/** movement speed with the shield: extended walks, ADS beside it is slow, on the back is free */
export const SHIELD_SPEED: Record<ShieldPose, number> = { front: 0.9, ads: 0.85, back: 1, ext: 0.6 };

/**
 * Ballistic shield collider pose (local soldiers and remote peers share it).
 *  front: left of centre at chest height · ads: swung out to the left, turned 65° (covers the left flank, the
 *  pistol aims past its edge) · back: slung over the back · ext: Montagne's full-body extension.
 */
export function placeShield(c: RAPIER.Collider, pos: THREE.Vector3, yaw: number, stance: Stance, pose: ShieldPose, alive: boolean) {
  if (!alive) { c.setTranslation({ x: pos.x, y: -600, z: pos.z }); return; }
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3().crossVectors(fwd, UP);
  const crouch = stance === Stance.Crouch;
  const ext = pose === 'ext';
  const h = ext ? (crouch ? 0.62 : 0.9) : crouch ? 0.42 : 0.5;
  const cy = ext ? h + 0.02 : pose === 'back' ? (crouch ? 0.8 : 1.15) : crouch ? 0.62 : 1.0;
  const p = pos.clone().add(new THREE.Vector3(0, cy, 0));
  let turn = 0;
  if (pose === 'back') p.addScaledVector(fwd, -0.26);
  else if (pose === 'ads') { p.addScaledVector(fwd, 0.32).addScaledVector(right, -0.34); turn = THREE.MathUtils.degToRad(65); }
  else p.addScaledVector(fwd, 0.5).addScaledVector(right, ext ? 0 : -0.1);
  c.setTranslation({ x: p.x, y: p.y, z: p.z });
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw + turn);
  c.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  (c as unknown as { setHalfExtents?: (v: { x: number; y: number; z: number }) => void }).setHalfExtents?.({ x: ext ? 0.38 : 0.28, y: h, z: 0.03 });
}

export function applySpread(dir: THREE.Vector3, spreadDeg: number, extraDeg: number, model: 'gaussian' | 'linear'): THREE.Vector3 {
  const total = spreadDeg + extraDeg;
  let ax: number, ay: number;
  if (model === 'linear') {
    const r = Math.sqrt(Math.random()) * total;
    const a = Math.random() * Math.PI * 2;
    ax = Math.cos(a) * r;
    ay = Math.sin(a) * r;
  } else {
    ax = gaussian() * total * 0.5;
    ay = gaussian() * total * 0.5;
  }
  const right = new THREE.Vector3().crossVectors(dir, UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return dir.clone()
    .addScaledVector(right, Math.tan(THREE.MathUtils.degToRad(ax)))
    .addScaledVector(up, Math.tan(THREE.MathUtils.degToRad(ay)))
    .normalize();
}
