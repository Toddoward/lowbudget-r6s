import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G_CHAR, G_GADGET, G_WORLD, type Physics } from '../core/Physics.ts';
import { placeShield, shieldPoseOf, type ShieldPose } from '../game/Soldier.ts';
import type { ActorSnapshot } from '../../shared/protocol.ts';
import { computeHitboxes, type Actor, type Hitboxes } from '../game/Actor.ts';
import { Rig } from '../render/Rig.ts';
import { Stance, type Side } from '../game/types.ts';
import { OPERATORS } from '../game/operators.ts';
import { WEAPONS } from '../game/weapons.ts';

/** A peer's character, rendered ~100 ms in the past from buffered snapshots (snapshot interpolation). */
export class RemoteActor implements Actor {
  kind = 'remote' as const;
  alive = true;
  hp = 100;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance = Stance.Stand;
  lean = 0;
  inverted = false;
  weaponId: string | null = null;
  rig: Rig;
  ghost = false;
  drone: THREE.Vector3 | null = null;
  private buf: (ActorSnapshot & { rt: number })[] = [];
  private collider: RAPIER.Collider;
  private shield: RAPIER.Collider | null = null;
  shieldExtended = false;
  private shieldPose: ShieldPose = 'front';
  private offset = 0;
  lastHeard = performance.now();

  constructor(readonly id: string, public name: string, public side: Side, public operator: string, private physics: Physics, scene: THREE.Scene, friendly: boolean) {
    const def = OPERATORS[operator] ?? OPERATORS.recruit;
    this.weaponId = def.shield ? def.secondary : def.primary;
    this.rig = new Rig(operator, this.weaponId, name, friendly ? '#7fd0ff' : '#ff6b5a');
    scene.add(this.rig.root);
    this.collider = physics.addCapsule(0, -500, 0, 0.6, 0.3, { kind: 'char', actorId: id }, G_CHAR, G_WORLD);
    // a peer's ballistic shield must stop OUR rounds too (the shooter's client resolves hits)
    if (def.shield) this.shield = physics.addBox(0, -600, 0, 0.3, 0.55, 0.03, { kind: 'gadget', gadgetId: `shield:${id}` }, undefined, G_GADGET);
  }

  eye(out = new THREE.Vector3()) {
    const h = this.stance === Stance.Crouch ? 1.12 : this.stance === Stance.Prone ? 0.38 : 1.64;
    return out.copy(this.pos).add(new THREE.Vector3(0, this.inverted ? 0.22 : h, 0));
  }

  hitboxes(): Hitboxes { return computeHitboxes(this.pos, this.yaw, this.stance, this.lean, this.inverted); }

  push(s: ActorSnapshot) {
    const now = performance.now();
    // sender clock → local clock offset (smoothed)
    const off = now - s.t;
    this.offset = this.buf.length ? this.offset * 0.9 + off * 0.1 : off;
    this.buf.push({ ...s, rt: s.t + this.offset });
    if (this.buf.length > 30) this.buf.shift();
    this.lastHeard = now;
  }

  update(dt: number) {
    const renderT = performance.now() - 100;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].rt <= renderT && this.buf[i + 1].rt >= renderT) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    }
    if (a && b) {
      const k = b.rt > a.rt ? THREE.MathUtils.clamp((renderT - a.rt) / (b.rt - a.rt), 0, 1.2) : 1;
      this.pos.set(lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k));
      this.vel.set(...b.v);
      this.yaw = lerpAngle(a.yaw, b.yaw, k);
      this.pitch = lerp(a.pitch, b.pitch, k);
      this.lean = lerp(a.lean, b.lean, k);
      const st = b.st;
      this.stance = st === 1 ? Stance.Crouch : st === 2 ? Stance.Prone : st >= 3 && st <= 4 ? Stance.Rappel : Stance.Stand;
      this.inverted = st === 4;
      this.hp = b.hp;
      const wasAlive = this.alive;
      this.alive = b.alive;
      if (wasAlive !== this.alive) this.rig.setDead(!this.alive, this.stance === Stance.Prone, Math.sin(this.yaw * 7.3));
      this.drone = b.dr ? new THREE.Vector3(...b.dr) : null;
      this.shieldExtended = !!b.sx;
      this.shieldPose = shieldPoseOf(this.shieldExtended, !!b.sb, !!b.ads);
      if (this.shield) this.rig.setShieldPose(this.shieldPose);
      const def = OPERATORS[this.operator];
      const wid = def?.shield && b.w < 2 ? def.secondary : b.w === 0 ? def?.primary : b.w === 1 ? def?.secondary : null;
      if (wid !== this.weaponId && (wid === null || WEAPONS[wid])) { this.weaponId = wid ?? null; this.rig.setWeapon(this.weaponId); }
    }
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.pose(dt, this.stance, this.pitch, this.lean, Math.hypot(this.vel.x, this.vel.z), this.inverted);
    const h = this.stance === Stance.Crouch ? 0.33 : this.stance === Stance.Prone ? 0.06 : 0.6;
    this.collider.setHalfHeight(h);
    this.collider.setTranslation(this.alive ? { x: this.pos.x, y: this.pos.y + h + 0.3, z: this.pos.z } : { x: 0, y: -500, z: 0 });
    if (this.shield) placeShield(this.shield, this.pos, this.yaw, this.stance, this.shieldPose, this.alive);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.rig.root);
    this.rig.dispose();
    this.physics.remove(this.collider);
    if (this.shield) this.physics.remove(this.shield);
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number) {
  const d = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
  return a + d * k;
}
