import * as THREE from 'three';
import { buildBones } from '../assets/build.ts';
import { ARM_FORE, ARM_UPPER, operatorSpec } from '../assets/operatorModels.ts';
import { OPERATORS } from '../game/operators.ts';
import { buildAsset } from '../assets/build.ts';
import { WEAPONS, weaponSpec } from '../game/weapons.ts';
import { extraGadgetSpec } from '../assets/gadgetModels.ts';
import { Stance } from '../game/types.ts';
import { shieldLocal, shieldPlace, shieldPlateOf, type ShieldPose } from '../game/Soldier.ts';

/** what the body is doing besides moving (drives the hold) */
export interface RigAction {
  /** 0..1 aiming down sights */
  ads?: number;
  sprint?: boolean;
  /** 0..1 through a reload, −1 not reloading */
  reload?: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const SHOULDER_L = new THREE.Vector3(-0.21, 0.45, 0);
const SHOULDER_R = new THREE.Vector3(0.21, 0.45, 0);

/**
 * Third-person operator rig. Pivots (relative to the feet origin, facing −Z):
 *   hips (0, 0.95) → torso (pelvis) → head (0, 0.5 above the pelvis)
 *   armL / armR (upper arms) at the shoulders → foreL / foreR at the elbows · legL / legR at the hip joints
 * Poses: stand / crouch / prone / rappel (upright against the wall) / rappel-inverted (flipped, head down)
 * + lean roll + aim pitch + walk cycle. The hands are solved onto what is held (two-bone IK): the right hand on
 * the grip, the left on the handguard / cupping the pistol / on the shield handle — the same holds as first person.
 * The gun and the shield hang off the root (body frame) so the shield is exactly where its collider is
 * (Soldier.shieldPlace).
 */
export class Rig {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private gun: THREE.Group | null = null;
  private gunAnchors: Record<string, [number, number, number]> = {};
  private pistol = false;
  weaponId: string | null = null;
  private shield: THREE.Group | null = null;
  private shieldPose: ShieldPose | null = null;
  private readonly plate;
  private readonly cuffed: boolean;
  private walk = 0;
  private stanceBlend = 0;
  private adsK = 0;
  private sprintK = 0;
  dead = false;
  private deathT = 0;
  private fallFwd = false;
  private fallSide = 0;
  readonly nameTag: THREE.Sprite | null = null;
  /** root-space hand targets of the last pose (tests / debugging) */
  readonly targets = { left: new THREE.Vector3(), right: new THREE.Vector3() };

  constructor(operatorId: string, weaponId: string | null, label?: string, labelColor = '#ffffff') {
    const def = OPERATORS[operatorId] ?? OPERATORS.recruit;
    const bones = buildBones(operatorSpec(def));
    const attach = (name: string, g: THREE.Group) => {
      const m = bones.get(name);
      if (m) g.add(m);
    };
    attach('hips', this.hips);
    attach('torso', this.torso);
    attach('head', this.head);
    attach('armL', this.armL);
    attach('armR', this.armR);
    attach('foreL', this.foreL);
    attach('foreR', this.foreR);
    attach('legL', this.legL);
    attach('legR', this.legR);
    this.root.add(this.hips);
    this.hips.position.set(0, 0.95, 0);
    this.hips.add(this.torso);
    this.torso.add(this.head);
    this.head.position.set(0, 0.5, 0);
    this.torso.add(this.armL, this.armR);
    this.armL.position.copy(SHOULDER_L);
    this.armR.position.copy(SHOULDER_R);
    this.armL.add(this.foreL);
    this.armR.add(this.foreR);
    this.foreL.position.set(0, -ARM_UPPER, 0);
    this.foreR.position.set(0, -ARM_UPPER, 0);
    this.hips.add(this.legL, this.legR);
    this.legL.position.set(-0.09, -0.02, 0);
    this.legR.position.set(0.09, -0.02, 0);
    this.cuffed = def.team === 'hostage';
    this.plate = shieldPlateOf(def);
    if (weaponId) this.setWeapon(weaponId);
    if (def.shield) {
      this.shield = buildAsset(extraGadgetSpec(def.gadget === 'flash_shield' ? 'flash_shield' : 'shield')!);
      this.root.add(this.shield);
      this.shieldPose = 'front';
    }
    if (label) {
      const sprite = makeLabel(label, labelColor);
      sprite.position.set(0, 2.15, 0);
      this.root.add(sprite);
      (this as { nameTag: THREE.Sprite | null }).nameTag = sprite;
    }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  }

  setWeapon(id: string | null) {
    if (this.gun) this.root.remove(this.gun);
    this.gun = null;
    this.weaponId = id;
    if (!id) return;
    const spec = weaponSpec(id);
    this.gun = buildAsset(spec);
    this.gunAnchors = spec.anchors ?? {};
    this.pistol = WEAPONS[id]?.cls === 'Pistol';
    this.gun.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.root.add(this.gun);
  }

  /** front (viewport on the eye line) · run (carried at the left side) · ads (swung aside) · back · ext (Montagne) */
  setShieldPose(pose: ShieldPose | null) {
    if (this.shield && pose) this.shieldPose = pose;
  }

  /**
   * @param pitch aim pitch (rad, + up)  @param lean -1..1 (+ right)  @param speed horizontal m/s
   */
  pose(dt: number, stance: Stance, pitch: number, lean: number, speed: number, inverted = false, act: RigAction = {}) {
    if (this.dead) {
      this.deathPose(dt);
      return;
    }
    const prone = stance === Stance.Prone;
    const crouch = stance === Stance.Crouch;
    const rappel = stance === Stance.Rappel;
    const target = prone ? 2 : crouch ? 1 : 0;
    this.stanceBlend += (target - this.stanceBlend) * Math.min(1, dt * 10);
    const sb = this.stanceBlend;
    this.walk += dt * speed * (prone ? 2.5 : 5);
    const swing = Math.sin(this.walk) * Math.min(1, speed / 3) * (prone ? 0.25 : 0.6);
    this.adsK += ((act.ads ?? 0) - this.adsK) * Math.min(1, dt * 12);
    this.sprintK += ((act.sprint ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);

    this.root.rotation.z = inverted ? Math.PI : 0;
    if (rappel) {
      this.hips.position.set(0, 0.95, 0);
      this.hips.rotation.set(0, 0, 0);
      this.legL.rotation.x = this.legR.rotation.x = -1.2 + swing * 0.3;
      this.torso.rotation.set(0.15, 0, 0);
    } else if (sb > 1) {
      // crouch → prone
      const k = sb - 1;
      this.hips.position.set(0, THREE.MathUtils.lerp(0.62, 0.22, k), THREE.MathUtils.lerp(0, 0.35, k));
      this.hips.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2 + 0.08, k);
      this.legL.rotation.x = THREE.MathUtils.lerp(-0.86, 0, k) + swing;
      this.legR.rotation.x = THREE.MathUtils.lerp(0.86, 0, k) - swing;
      this.torso.rotation.set(0, 0, lean * 0.15);
    } else {
      // crouch: one knee forward, one back so both feet stay on the floor (leg ≈ 0.95 m, hips at 0.62 → 49°)
      this.hips.position.set(0, THREE.MathUtils.lerp(0.95, 0.62, sb), 0);
      this.hips.rotation.x = 0;
      this.legL.rotation.x = -0.86 * sb + swing;
      this.legR.rotation.x = 0.86 * sb - swing;
      // crouched / sprinting the upper body leans forward (−X tips the torso's +Y toward −Z)
      this.torso.rotation.set(-(sb * 0.25 + this.sprintK * 0.12), 0, -lean * 0.35);
    }
    this.head.rotation.x = THREE.MathUtils.clamp(prone ? pitch * 0.5 + Math.PI / 2 - 0.15 : pitch * 0.6 - this.torso.rotation.x, -1, 1.6);
    this.root.updateMatrix();
    this.hips.updateMatrix();
    this.torso.updateMatrix();
    this.head.updateMatrix();
    const torsoM = new THREE.Matrix4().multiplyMatrices(this.hips.matrix, this.torso.matrix);
    const toRoot = (p: THREE.Vector3) => p.clone().applyMatrix4(torsoM);

    // --- the shield: exactly where its collider is
    const sp = this.shield ? this.shieldPose : null;
    if (this.shield && sp) {
      const pl = shieldPlace(sp, stance === Stance.Rappel ? Stance.Stand : stance, this.plate);
      const { p, q } = shieldLocal(pl);
      this.shield.position.copy(p);
      this.shield.quaternion.copy(q);
      this.shield.scale.set(pl.sx, pl.sy, 1);
      this.shield.visible = true;
    }

    // --- the gun, held along the aim (body frame: x right, y up, −z ahead)
    const aim = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));
    const shoulderR = toRoot(SHOULDER_R);
    const eye = new THREE.Vector3(0, 0.15, -0.09).applyMatrix4(new THREE.Matrix4().multiplyMatrices(torsoM, this.head.matrix));
    const shielded = !!sp && sp !== 'back';
    // hold point of the grip in the aim frame, from the right shoulder (rifle at the shoulder pocket; a pistol pushed out)
    // hold of the grip in the aim frame: a rifle pivots on the shoulder pocket (just in from the shoulder joint), a pistol is pushed out
    const pocket = shoulderR.clone().add(new THREE.Vector3(-0.07, -0.05, -0.08));
    const hold = this.pistol
      ? shielded ? new THREE.Vector3(0.07, -0.09, -0.3) : new THREE.Vector3(-0.1, -0.05, -0.34)
      : new THREE.Vector3(0, -0.07, -0.19);
    let gunQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim);
    const grip = new THREE.Vector3(...(this.gunAnchors.grip ?? [0, -0.03, 0]));
    const sight = new THREE.Vector3(...(this.gunAnchors.sight ?? [0, 0.08, 0.05]));
    const hipGrip = pocket.clone().add(hold.applyQuaternion(gunQ));
    // aiming: the sight on the eye line, eye relief behind it
    const adsGrip = eye.clone().addScaledVector(aim, this.pistol ? 0.36 : 0.24).sub(sight.clone().sub(grip).applyQuaternion(gunQ));
    const ext = sp === 'ext';
    let gripAt = hipGrip.lerp(adsGrip, ext ? 0 : this.adsK);
    // sprinting: low ready, muzzle down and across the body
    if (this.sprintK > 0.01 && !shielded) {
      const low = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0.55, 0, 'YXZ'));
      gunQ = gunQ.slerp(low, this.sprintK);
      gripAt = gripAt.lerp(shoulderR.clone().add(new THREE.Vector3(-0.1, -0.2, -0.16)), this.sprintK);
    }
    if (ext) gripAt = shoulderR.clone().add(new THREE.Vector3(-0.02, -0.38, -0.12)); // Montagne extended: the pistol lowered behind it
    // where the left hand goes on the gun (gun-local), if it holds the gun
    const fore = new THREE.Vector3(...(this.gunAnchors.fore ?? [0, 0.02, -0.2]));
    fore.z = Math.max(fore.z, grip.z - 0.27); // the rear of a long handguard: a natural reach ahead of the grip
    const leftOnGun = this.gun && !shielded ? (this.pistol ? grip.clone().add(new THREE.Vector3(-0.045, -0.02, 0.02)) : fore.add(new THREE.Vector3(-0.01, -0.035, 0))) : null;
    // never further than the arms reach: slide the gun back along the aim until both hands are on it
    const shoulderL = toRoot(SHOULDER_L);
    const reach = ARM_UPPER + ARM_FORE - 0.01;
    for (let i = 0; i < 12; i++) {
      const left = leftOnGun ? gripAt.clone().add(leftOnGun.clone().sub(grip).applyQuaternion(gunQ)) : null;
      if (gripAt.distanceTo(shoulderR) <= reach && (!left || left.distanceTo(shoulderL) <= reach)) break;
      gripAt.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(gunQ), -0.02);
    }
    const rightT = gripAt.clone();
    let leftT: THREE.Vector3;
    if (this.gun) {
      this.gun.quaternion.copy(gunQ);
      this.gun.position.copy(gripAt).sub(grip.clone().applyQuaternion(gunQ));
      this.gun.visible = true;
    }
    if (shielded && this.shield) {
      // the left hand on the shield's handle (plate-local (0, −0.02, 0.035))
      this.shield.updateMatrix();
      leftT = new THREE.Vector3(0, -0.02, 0.06).applyMatrix4(this.shield.matrix);
    } else if (this.gun && leftOnGun) {
      // the left hand under the handguard / cupping the pistol grip
      leftT = this.gun.position.clone().add(leftOnGun.clone().applyQuaternion(gunQ));
    } else if (this.cuffed) {
      leftT = toRoot(new THREE.Vector3(-0.04, 0.12, -0.2));
    } else {
      // nothing in hand: hands low in front
      leftT = toRoot(new THREE.Vector3(-0.16, 0.08, -0.16));
    }
    let rightHand = rightT;
    if (!this.gun) rightHand = this.cuffed ? toRoot(new THREE.Vector3(0.04, 0.12, -0.2)) : toRoot(new THREE.Vector3(0.16, 0.08, -0.16));
    // reloading: the left hand goes to the magazine well and back
    const rk = act.reload ?? -1;
    if (rk >= 0 && this.gun && !shielded) {
      const well = this.gun.position.clone().add(new THREE.Vector3(0, -0.1, this.pistol ? 0.02 : -0.06).applyQuaternion(gunQ));
      leftT = leftT.lerp(well, Math.sin(Math.min(1, rk) * Math.PI));
    }
    this.targets.left.copy(leftT);
    this.targets.right.copy(rightHand);

    // --- arms: two-bone IK in torso space, elbows out and down
    const inv = torsoM.clone().invert();
    solveArm(this.armR, this.foreR, SHOULDER_R, rightHand.clone().applyMatrix4(inv), new THREE.Vector3(0.7, -1, 0.35));
    solveArm(this.armL, this.foreL, SHOULDER_L, leftT.clone().applyMatrix4(inv), new THREE.Vector3(-0.7, -1, 0.35));
  }

  /** world position of a hand's centre (tests) */
  handWorld(side: 'left' | 'right', out = new THREE.Vector3()) {
    const f = side === 'left' ? this.foreL : this.foreR;
    this.root.updateMatrixWorld(true);
    return out.set(0, -ARM_FORE, 0).applyMatrix4(f.matrixWorld);
  }

  /**
   * @param fallForward face down (shot from behind, or already prone) — else onto the back
   * @param side a small sideways roll (−1..1), so bodies don't all land the same way
   */
  setDead(dead: boolean, fallForward = false, side = 0) {
    this.dead = dead;
    this.fallFwd = fallForward;
    this.fallSide = side;
    if (!dead) {
      this.deathT = 0;
      this.hips.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, 0);
      this.legL.rotation.set(0, 0, 0);
      this.legR.rotation.set(0, 0, 0);
      if (this.gun) this.gun.visible = true;
    }
    if (this.nameTag) this.nameTag.visible = !dead;
  }

  /** collapse from whatever pose the body was in (walking, crouched, rappelling) to lying flat, limbs relaxed */
  private deathPose(dt: number) {
    const was = this.deathT;
    this.deathT = Math.min(1, this.deathT + dt * 1.9);
    if (was >= 1) return;
    const e = 1 - (1 - this.deathT) ** 3; // the fall
    const k = Math.min(1, dt * 7); // limbs relax toward the lying pose
    const f = this.fallFwd ? -1 : 1;
    const ap = (o: THREE.Object3D, x: number, y: number, z: number) => {
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.y += (y - o.rotation.y) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    this.root.rotation.z = 0; // a rappeller upside down falls the right way up
    // lying on the back (+π/2 about X: legs forward, torso back) or face down (−π/2), hips on the floor
    this.hips.position.y += (0.14 - this.hips.position.y) * e;
    this.hips.position.z += (0 - this.hips.position.z) * k;
    this.hips.rotation.x += (f * (Math.PI / 2 - 0.04) - this.hips.rotation.x) * e;
    this.hips.rotation.y += (0 - this.hips.rotation.y) * k;
    this.hips.rotation.z += (this.fallSide * 0.25 - this.hips.rotation.z) * e;
    // legs straight out, a little apart; torso flat; head turned aside; arms flung out, elbows loose
    ap(this.legL, -0.06, 0, -0.16);
    ap(this.legR, 0.04, 0, 0.12 + this.fallSide * 0.1);
    ap(this.torso, 0, 0, this.fallSide * -0.12);
    ap(this.head, f * 0.15, (this.fallSide >= 0 ? 1 : -1) * 0.9, 0);
    ap(this.armL, -0.35 * f, 0, -1.25);
    ap(this.armR, -0.6 * f, 0, 1.05);
    ap(this.foreL, 0.2, 0, 0);
    ap(this.foreR, 0.25, 0, 0);
    if (this.gun && this.deathT > 0.25) this.gun.visible = false; // dropped
    if (this.shield && this.deathT > 0.25) this.shield.visible = false;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

/**
 * Two-bone arm: the upper arm hangs from `shoulder` (its −Y toward the elbow), the forearm from the elbow; the elbow
 * is put on the side of `pole`. Out-of-reach targets are reached for along the line.
 */
function solveArm(upper: THREE.Group, fore: THREE.Group, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3) {
  const d = target.clone().sub(shoulder);
  const dist = THREE.MathUtils.clamp(d.length(), Math.abs(ARM_UPPER - ARM_FORE) + 0.02, ARM_UPPER + ARM_FORE - 0.002);
  const dir = d.lengthSq() > 1e-8 ? d.normalize() : DOWN.clone();
  const a = (ARM_UPPER * ARM_UPPER - ARM_FORE * ARM_FORE + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, ARM_UPPER * ARM_UPPER - a * a));
  const pn = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (pn.lengthSq() < 1e-6) pn.set(0, -1, 0).addScaledVector(dir, -dir.y);
  pn.normalize();
  const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(pn, h);
  const hand = shoulder.clone().addScaledVector(dir, dist);
  upper.quaternion.setFromUnitVectors(DOWN, elbow.clone().sub(shoulder).normalize());
  const foreDir = hand.sub(elbow).normalize().applyQuaternion(upper.quaternion.clone().invert());
  fore.quaternion.setFromUnitVectors(DOWN, foreDir);
}

function makeLabel(text: string, color: string): THREE.Sprite {
  // headless (node tests / tools): no canvas, an empty sprite keeps the rig's shape
  if (typeof document === 'undefined') return new THREE.Sprite();
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px "Rajdhani", "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.1, 0.28, 1);
  s.renderOrder = 10;
  return s;
}
