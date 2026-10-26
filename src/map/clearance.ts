import { HATCHES, ROOMS, STAIRS, WALLS, type FloorId, type Rect } from './houseLayout.ts';
import type { PropDef } from './houseProps.ts';

/**
 * Walk-through clearance: the floor in front of and behind every doorway, the
 * approach to both ends of every staircase and every hatch must stay free of
 * furniture. Props are data, so this is checked by a unit test (and the walk
 * E2E proves it physically) instead of being trusted by eye.
 */
export interface Zone { floor: FloorId; rect: Rect; why: string }

/** metres kept free on each side of a doorway, and to its left/right */
export const DOOR_DEPTH = 1.2;
export const DOOR_SIDE = 0.25;
/** metres kept free in front of / behind a drone vent, and to its left/right */
export const VENT_DEPTH = 0.6;
export const VENT_SIDE = 0.1;
/** metres kept free past each end of a staircase */
export const STAIR_APPROACH = 1.3;

const PASSABLE = new Set(['door', 'exterior_door', 'arch', 'french', 'shutter']);

export function clearanceZones(): Zone[] {
  const out: Zone[] = [];
  for (const w of WALLS) {
    for (const o of w.openings ?? []) {
      if (!PASSABLE.has(o.kind)) continue;
      const a = o.at - o.w / 2 - DOOR_SIDE;
      const b = o.at + o.w / 2 + DOOR_SIDE;
      const rect = w.run === 'x' ? { x0: a, x1: b, z0: w.c - DOOR_DEPTH, z1: w.c + DOOR_DEPTH } : { x0: w.c - DOOR_DEPTH, x1: w.c + DOOR_DEPTH, z0: a, z1: b };
      out.push({ floor: w.floor, rect, why: `${o.kind} @${w.run === 'x' ? `z=${w.c} x=${o.at}` : `x=${w.c} z=${o.at}`}` });
    }
  }
  // drone vents: a straight run in and out for the drone, on both sides of the wall
  for (const w of WALLS) {
    for (const o of w.openings ?? []) {
      if (o.kind !== 'vent') continue;
      const a = o.at - o.w / 2 - VENT_SIDE;
      const b = o.at + o.w / 2 + VENT_SIDE;
      const rect = w.run === 'x' ? { x0: a, x1: b, z0: w.c - VENT_DEPTH, z1: w.c + VENT_DEPTH } : { x0: w.c - VENT_DEPTH, x1: w.c + VENT_DEPTH, z0: a, z1: b };
      out.push({ floor: w.floor, rect, why: `vent @${w.run === 'x' ? `z=${w.c} x=${o.at}` : `x=${w.c} z=${o.at}`}` });
    }
  }
  for (const s of STAIRS) {
    if (s.exterior) continue;
    const r = s.rect;
    const lo = Math.min(s.yMin, s.yMax);
    // only ends that land on a floor (the U-stairs' mid landing at 1.75 m is a platform, not floor space)
    const floorOf = (y: number): FloorId | null => ([-3.5, 0, 3.5].findIndex((f) => Math.abs(f - y) < 0.3) - 1) as FloorId | null;
    const ends: [number, Rect][] = s.axis === 'x'
      ? [[s.yMin, { x0: r.x0 - STAIR_APPROACH, x1: r.x0, z0: r.z0, z1: r.z1 }], [s.yMax, { x0: r.x1, x1: r.x1 + STAIR_APPROACH, z0: r.z0, z1: r.z1 }]]
      : [[s.yMin, { x0: r.x0, x1: r.x1, z0: r.z0 - STAIR_APPROACH, z1: r.z0 }], [s.yMax, { x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + STAIR_APPROACH }]];
    for (const [y, rect] of ends) { const f = floorOf(y); if (f !== null && f >= -1) out.push({ floor: f, rect, why: `stairs ${s.id} end` }); }
    // the flight itself on its lower floor (nothing parked on the steps)
    const f = floorOf(lo);
    if (f !== null && f >= -1) out.push({ floor: f, rect: r, why: `stairs ${s.id}` });
  }
  for (const h of HATCHES) {
    const floorOf = (y: number): FloorId => (y < -1.5 ? -1 : y < 2 ? 0 : 1);
    out.push({ floor: floorOf(h.y), rect: grow(h.rect, 0.2), why: `hatch ${h.id} (top)` });
    out.push({ floor: (floorOf(h.y) - 1) as FloorId, rect: grow(h.rect, 0.2), why: `hatch ${h.id} (below)` });
  }
  return out;
}

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
export const propRect = (p: PropDef): Rect => ({ x0: p.x - p.size[0] / 2, x1: p.x + p.size[0] / 2, z0: p.z - p.size[2] / 2, z1: p.z + p.size[2] / 2 });
const inside = (a: Rect, b: Rect, m = 0.02) => a.x0 >= b.x0 - m && a.x1 <= b.x1 + m && a.z0 >= b.z0 - m && a.z1 <= b.z1 + m;

/** every rule a prop breaks (empty = fine) */
export function propProblems(props: PropDef[]): string[] {
  const zones = clearanceZones();
  const out: string[] = [];
  props.forEach((p, i) => {
    const r = propRect(p);
    // flat things (rugs, mats) and things hung off the floor can sit anywhere
    const blocking = p.size[1] > 0.1 && !(p.lift && p.lift > 1.9);
    const rooms = ROOMS.filter((rm) => rm.floor === p.floor);
    const porch = p.type.startsWith('Porch') || p.type === 'Planter';
    if (!porch && !rooms.some((rm) => rm.rects.some((rr) => inside(r, rr)))) out.push(`${p.type} #${i} (${p.x},${p.z}) is not inside a single room rectangle`);
    if (!blocking) return;
    for (const z of zones) if (z.floor === p.floor && overlaps(r, z.rect)) out.push(`${p.type} #${i} (${p.x},${p.z}) blocks ${z.why}`);
    props.forEach((q, j) => {
      if (j <= i || q.floor !== p.floor || q.size[1] <= 0.1) return;
      if (q.type === 'TV' || p.type === 'TV') return; // the TV stands on its stand
      if (overlaps(r, propRect(q))) out.push(`${p.type} #${i} overlaps ${q.type} #${j}`);
    });
  });
  return out;
}
