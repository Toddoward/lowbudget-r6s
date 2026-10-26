import * as THREE from 'three';
import { Stance, type ActorKind, type Side } from './types.ts';

/** Minimal shape every character (local soldier, bot, remote peer, hostage) exposes. */
export interface Actor {
  id: string;
  name: string;
  side: Side;
  kind: ActorKind;
  operator: string;
  alive: boolean;
  hp: number;
  /** feet position */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  stance: Stance;
  /** -1..1 (+ = right / E) */
  lean: number;
  inverted: boolean;
  weaponId: string | null;
  eye(out?: THREE.Vector3): THREE.Vector3;
  hitboxes(): Hitboxes;
  /** apply damage from the authoritative shooter. returns true if killed */
  damage?(amount: number, attackerId: string, headshot: boolean, dir?: THREE.Vector3): boolean;
  /** ignore for hit tests (e.g. lagging remote while dead) */
  ghost?: boolean;
  flashlight?: boolean;
}

export interface Capsule { a: THREE.Vector3; b: THREE.Vector3; r: number }
export interface Hitboxes { head: { c: THREE.Vector3; r: number }; torso: Capsule; legs: Capsule }

const UP = new THREE.Vector3(0, 1, 0);

/** Hitboxes derived purely from (pos, yaw, stance, lean, inverted) so all peers agree. */
export function computeHitboxes(pos: THREE.Vector3, yaw: number, stance: Stance, lean: number, inverted: boolean): Hitboxes {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3().crossVectors(fwd, UP);
  if (stance === Stance.Prone) {
    const pelvis = pos.clone().add(new THREE.Vector3(0, 0.22, 0)).addScaledVector(fwd, -0.1);
    const neck = pelvis.clone().addScaledVector(fwd, 0.62).add(new THREE.Vector3(0, 0.06, 0));
    const head = neck.clone().addScaledVector(fwd, 0.2).add(new THREE.Vector3(0, 0.1, 0));
    const feet = pelvis.clone().addScaledVector(fwd, -0.9);
    return { head: { c: head, r: 0.14 }, torso: { a: pelvis, b: neck, r: 0.2 }, legs: { a: feet, b: pelvis, r: 0.14 } };
  }
  const crouch = stance === Stance.Crouch;
  const pelvisY = crouch ? 0.62 : 0.95;
  // torso capsule top (neck + radius) stays below the head sphere so it never shadows headshots
  const neckY = crouch ? 0.88 : 1.28;
  const headY = crouch ? 1.18 : 1.6;
  const lx = lean * (crouch ? 0.28 : 0.34);
  const sgn = inverted ? -1 : 1;
  const base = inverted ? pos.clone().add(new THREE.Vector3(0, 1.85, 0)) : pos;
  const pelvis = base.clone().add(new THREE.Vector3(0, pelvisY * sgn, 0));
  const neck = base.clone().add(new THREE.Vector3(0, neckY * sgn, 0)).addScaledVector(right, lx * 0.7);
  const head = base.clone().add(new THREE.Vector3(0, headY * sgn - Math.abs(lean) * 0.05, 0)).addScaledVector(right, lx);
  const feet = base.clone().add(new THREE.Vector3(0, 0.12 * sgn, 0));
  if (crouch) feet.addScaledVector(fwd, 0.1);
  return { head: { c: head, r: 0.14 }, torso: { a: pelvis, b: neck, r: 0.23 }, legs: { a: feet, b: pelvis, r: 0.15 } };
}

/** Ray vs sphere: returns t or -1 */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}

/** Ray vs capsule (segment a-b, radius r): returns t or -1 */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, cap: Capsule): number {
  // closest approach between the ray and the capsule's core segment, then an exact
  // sphere test around that segment point (accurate enough for hitboxes)
  const v = _v.subVectors(cap.b, cap.a);
  const w = _w.subVectors(o, cap.a);
  const a = d.dot(d), b = d.dot(v), c = v.dot(v), dd = d.dot(w), e = v.dot(w);
  const D = a * c - b * b;
  let t = D > 1e-8 ? (a * e - b * dd) / D : 0;
  t = THREE.MathUtils.clamp(t, 0, 1);
  const s = Math.max(0, (t * b - dd) / a);
  // refine segment param for the clamped ray point
  _pr.copy(o).addScaledVector(d, s);
  t = THREE.MathUtils.clamp(_w.subVectors(_pr, cap.a).dot(v) / Math.max(c, 1e-8), 0, 1);
  _ps.copy(cap.a).addScaledVector(v, t);
  return raySphere(o, d, _ps, cap.r);
}
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _ps = new THREE.Vector3();

export type HitZone = 'head' | 'torso' | 'legs';
export function rayActor(o: THREE.Vector3, d: THREE.Vector3, hb: Hitboxes, maxT: number): { t: number; zone: HitZone } | null {
  let best: { t: number; zone: HitZone } | null = null;
  const th = raySphere(o, d, hb.head.c, hb.head.r);
  if (th >= 0 && th < maxT) best = { t: th, zone: 'head' };
  const tt = rayCapsule(o, d, hb.torso);
  // head wins near-ties (round grazing the collar still counts as a headshot)
  if (tt >= 0 && tt < maxT && (!best || tt < best.t - 0.12)) best = { t: tt, zone: 'torso' };
  const tl = rayCapsule(o, d, hb.legs);
  if (tl >= 0 && tl < maxT && (!best || tl < best.t)) best = { t: tl, zone: 'legs' };
  return best;
}
