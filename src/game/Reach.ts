import * as THREE from 'three';
import type { World } from './World.ts';

/**
 * Interaction reach, by kind of thing:
 *  - objects (hostage, bomb, defuser, ammo crate, turret): within arm's reach of the eyes, under the crosshair
 *    (a cone the size of the object, plus slack), with a clear line to it — never through a wall or a floor.
 *    Standing on top of it counts without looking (the object at your feet).
 *  - openings (barricade a door / window): see Interactions.openingInFront — body at the opening, facing it.
 *  - surfaces (reinforce a wall / hatch): the panel the aim ray hits.
 *  - movement (vault, climb, rappel): body probes in Soldier.
 * When several are on offer, the one nearest the crosshair wins.
 */
export interface ReachTarget {
  /** points on the object, any of which in sight will do (e.g. chest and head) */
  points: THREE.Vector3[];
  /** object radius (m) */
  radius: number;
  /** max distance eye → object (m) */
  reach: number;
}

export interface Reacher {
  pos: THREE.Vector3;
  eye(out?: THREE.Vector3): THREE.Vector3;
  aimDir(out?: THREE.Vector3): THREE.Vector3;
}

/** extra cone around the object's own size (rad) */
const SLACK = THREE.MathUtils.degToRad(12);
/** horizontal distance under which the object is "at your feet" */
const AT_FEET = 0.75;

/** angle between the crosshair and the object (rad) when it can be used now, else null */
export function aimAt(w: World, s: Reacher, t: ReachTarget): number | null {
  const eye = s.eye();
  const dir = s.aimDir();
  let best: number | null = null;
  for (const p of t.points) {
    const to = p.clone().sub(eye);
    const dist = to.length();
    if (dist > t.reach) continue;
    const flat = Math.hypot(p.x - s.pos.x, p.z - s.pos.z);
    const ang = dist > 1e-3 ? to.normalize().angleTo(dir) : 0;
    const atFeet = flat < AT_FEET && p.y < eye.y;
    if (!atFeet && ang > Math.atan(t.radius / Math.max(dist, 0.1)) + SLACK) continue;
    // a clear line, stopping short of the object itself
    const stop = p.clone().addScaledVector(to, -Math.min(t.radius * 0.8, dist * 0.5));
    if (!w.physics.clearLine(eye, stop)) continue;
    const score = atFeet ? Math.min(ang, SLACK) : ang;
    if (best === null || score < best) best = score;
  }
  return best;
}
