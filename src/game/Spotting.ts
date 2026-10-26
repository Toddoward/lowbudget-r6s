import * as THREE from 'three';
import type { Actor } from './Actor.ts';
import type { World } from './World.ts';

/**
 * Who is under the reticle — shared by the ping key (instant) and the drone /
 * camera scan (hold the reticle on someone to identify and spot them).
 */
export const SPOT_SECS = 5;
/** drone / camera: seconds the reticle stays on an enemy until they are identified */
export const SCAN_TIME = 0.5;
export const PING_RANGE = 70;

/** head, chest, hips, knees: any of them in sight counts (someone peeking over cover is still seen) */
export function bodyPoints(a: Actor): THREE.Vector3[] {
  const h = a.hitboxes();
  const chest = h.torso.a.clone().lerp(h.torso.b, 0.6);
  const knees = h.legs.a.clone().lerp(h.legs.b, 0.5);
  return [h.head.c, chest, h.torso.a, knees];
}

export interface LookHit { id: string; ang: number; dist: number; point: THREE.Vector3 }

/**
 * The enemy closest to the line of sight o + t·d whose body subtends the ray (`pad` m around each
 * visible body point, never less than `minDeg`), with a clear line to that point.
 */
export function lookTarget(w: World, team: string, selfId: string, o: THREE.Vector3, d: THREE.Vector3, pad = 0.35, minDeg = 1.5, range = PING_RANGE): LookHit | null {
  let best: LookHit | null = null;
  const minAng = THREE.MathUtils.degToRad(minDeg);
  const to = new THREE.Vector3();
  for (const a of w.actors.values()) {
    if (a.id === selfId || a.side === team || a.side === 'hostage' || !w.targetable(a)) continue;
    if (a.pos.distanceTo(o) > range + 2) continue;
    for (const p of bodyPoints(a)) {
      to.subVectors(p, o);
      const dist = to.length();
      if (dist < 0.05 || dist > range) continue;
      const ang = to.multiplyScalar(1 / dist).angleTo(d);
      if (ang > Math.max(minAng, Math.atan(pad / dist))) continue;
      if (best && ang >= best.ang) continue;
      if (!w.physics.clearLine(o, p)) continue;
      best = { id: a.id, ang, dist, point: p.clone() };
    }
  }
  return best;
}

/** drone / CCTV scan: keep the reticle on an enemy for SCAN_TIME to identify and spot them (refreshed while held) */
export class Scanner {
  target: string | null = null;
  progress = 0;
  private spottedAt = -1e9;

  /** returns the id identified on this frame (once per lock), else null */
  update(w: World, team: string, selfId: string, o: THREE.Vector3, d: THREE.Vector3, dt: number): string | null {
    // a tighter cone than the ping: the reticle has to be on the body
    const hit = lookTarget(w, team, selfId, o, d, 0.3, 1.0);
    const id = hit?.id ?? null;
    if (id !== this.target) {
      this.target = id;
      this.progress = 0;
      this.spottedAt = -1e9;
    }
    if (!id) return null;
    const was = this.progress;
    this.progress = Math.min(1, this.progress + dt / SCAN_TIME);
    if (this.progress < 1) return null;
    // identified: spot now, then keep the spot fresh while the reticle stays on them
    if (w.time - this.spottedAt > 1) {
      w.spot(id, team, SPOT_SECS, true, selfId);
      this.spottedAt = w.time;
    }
    return was < 1 ? id : null;
  }

  reset() {
    this.target = null;
    this.progress = 0;
    this.spottedAt = -1e9;
  }
}
