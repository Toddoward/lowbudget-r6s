import { FLOORS, MAP_BOUNDS, NW_STAIRWELL_PIT, STAIRS, VENT_SHAFT, YARD, DRIVEWAY, GARAGE_VENT_WELL, type Rect } from './houseLayout.ts';
import { P } from './plan.ts';

/**
 * The ground outside the House: one continuous surface — no stacked boxes — built from the agreed levels (houseLayout
 * `YARD`) laid out on the top view (blueprints, the official top view, the user's screenshots):
 *
 *  - hard areas at their level: the north road, its sidewalks and the construction site across it; the east road falling
 *    gently from the corner to the basement level at the garage drive and on along the river; the quay; the drive, flush
 *    with the garage floor and the road; the front yard's two terraces; the west and back yards; the APC lot, the
 *    neighbour's lot and the far-west lane
 *  - steps between hard areas sit inside something solid: a kerb, a retaining wall (front yard terraces, the drive's
 *    walls, the yard over the east sidewalk), a flight of steps with its cheek walls, the quay wall, a pit wall — the
 *    surface ramps across the strip the wall stands on, so nothing of it shows
 *  - everything else (lawns, banks) is the smoothest surface between them: a Laplace solve over a 0.5 m raster, walls and
 *    the House's footprint as boundaries it does not lean on
 *  - the House's footprint, its pits (NW stairwell, vent shaft) are holes, edged by the House's outer walls and the pit walls
 *
 * The mesh is a rectilinear grid whose lines include every area's and hole's edge (so edges are exact), drawn and collided
 * as the same triangles.
 */

export type Surface = 'asphalt' | 'concrete' | 'pavers' | 'lawn' | 'dirt' | 'stone' | 'riverbed';
type Fn = (x: number, z: number) => number;
const K = (v: number): Fn => () => v;

/** an area of the ground: hard areas (closed rects) at their own height; strips (open rects: kerbs, walls, flights) win
 *  inside, the hard areas on either side keep their edges */
interface Area { r: Rect; y: Fn; s: Surface; prio: number; strip?: boolean }
/** what is built on a strip: a solid box from `bottom` to `top` (a function: a sloped top, along the strip's long axis;
 *  'rim': flush with the highest ground beside it — pit walls; { rim: h }: that much over it — a parapet over the higher side) */
export interface Solid { r: Rect; top: number | Fn | 'rim' | { rim: number }; bottom: number; color: string; mat: 'concrete' | 'dirt' | 'wood' }

const KERB = 0.15;
const WALL = 0.35;
const CHEEK = 0.3;
/** the surface reaches this far past the map's playable edge (what you see over the edge clip) */
export const EDGE = 8;
export const BOUNDS = { x0: MAP_BOUNDS.x0 - EDGE, x1: MAP_BOUNDS.x1 + EDGE, z0: MAP_BOUNDS.z0 - EDGE, z1: MAP_BOUNDS.z1 + EDGE };
const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = BOUNDS;

/* --------------------------------------------------------------- the layout (traced plan units → world) */
/** the north road's carriageway */
export const ROAD_N = { z0: P(-24.0), z1: P(-17.5) };
/** the east road's carriageway */
export const ROAD_E = { x0: P(14.13), x1: P(20.4) };
/** the sidewalk along the site, across the road */
const WALK_N = { z0: ROAD_N.z0 - KERB - 1.6, z1: ROAD_N.z0 - KERB };
/** the front yard's walls: the low wall along the sidewalk (→ lower terrace), the next one (→ upper terrace) */
const Z_T1 = P(-15.0);
const Z_T2 = P(-12.5);
/** the front yard's west edge (the bank down to the west lot beyond it) */
const X_YARD_W = P(-14.3);
/** the yard's east edge: its retaining wall over the east road's sidewalk */
const X_SE = P(12.6);
/** the quay's edge over the river */
export const X_QUAY = P(25.2);
const Hc = (c: number, side: -1 | 1, m = 0.15) => P(c) + side * m;

/** where the east road falls: from the front yard's corner (level with the north road before it) to the drive */
export const EAST_FALL = { z0: Z_T1, z1: DRIVEWAY.z0 };
/** the east road: level with the north road round the corner, falling evenly to the basement level at the drive, level after */
export function eastRoadY(z: number): number {
  const { z0: a, z1: b } = EAST_FALL;
  if (z <= a) return YARD.road;
  if (z >= b) return YARD.garage;
  return YARD.road + ((YARD.garage - YARD.road) * (z - a)) / (b - a);
}
/** the east road's sidewalks: a kerb over the road, dropped to the road over 1.5 m either side of the drive */
const sidewalkE: Fn = (_x, z) => eastRoadY(z) + KERB * Math.min(1, Math.max(0, Math.max(DRIVEWAY.z0 - z, z - DRIVEWAY.z1) / 1.5));
/** the quay along the river: a kerb over the road all the way */
export const quayY = (z: number) => eastRoadY(z) + KERB;

/** the House's below-grade volumes and pits: no ground there (edges: the outer faces of its basement walls) */
export const HOUSE_HOLES: Rect[] = [
  { x0: Hc(-7.25, -1), z0: Hc(-7.4, -1), x1: Hc(-1.7, 1), z1: Hc(-4.8, 1) }, // storage
  { x0: Hc(-7.25, -1), z0: Hc(-4.8, -1), x1: Hc(7.2, 1), z1: P(-2.45) },
  { x0: Hc(-7.95, -1), z0: Hc(-2.45, -1), x1: Hc(7.2, 1), z1: Hc(-0.6, 1) },
  { x0: Hc(-7.95, -1), z0: Hc(-0.6, -1), x1: Hc(9.7, 1), z1: Hc(0.55, 1) },
  { x0: Hc(-8.65, -1), z0: Hc(0.55, -1), x1: Hc(9.7, 1), z1: Hc(3.7, 1) }, // (the B side stairs reach out to x −8.65 only south of z 0.55)
  { x0: Hc(-9.45, -1), z0: Hc(1.1, -1, 0.1), x1: Hc(-8.65, 1), z1: Hc(3.25, 1) }, // bay
  { x0: Hc(-5.45, -1), z0: Hc(3.7, -1), x1: Hc(9.7, 1), z1: Hc(4.85, 1) },
  { x0: Hc(-5.45, -1), z0: Hc(4.85, -1), x1: Hc(2.05, 1), z1: Hc(6.45, 1) }, // back hallway (under the back deck)
  NW_STAIRWELL_PIT,
  STAIRS.find((s) => s.id === 'stairs_storage_ext')!.rect,
  VENT_SHAFT,
];

const AREAS: Area[] = [];
const SOLIDS: Solid[] = [];
const area = (r: Rect, y: Fn | number, s: Surface, prio = 0) => AREAS.push({ r, y: typeof y === 'number' ? K(y) : y, s, prio });
/** a strip with a solid on it; `low` is the surface under it (hidden), `gaps` (along its long axis) stay open */
const strip = (r: Rect, low: Fn | number, top: Solid['top'], bottom: number, color: string, gaps: [number, number][] = [], s: Surface = 'stone') => {
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  let pieces: [number, number][] = [[alongX ? r.x0 : r.z0, alongX ? r.x1 : r.z1]];
  for (const [g0, g1] of gaps) pieces = pieces.flatMap(([a, b]) => (g1 <= a || g0 >= b ? [[a, b]] : [[a, g0], [g1, b]].filter(([p, q]) => q - p > 1e-3)) as [number, number][]);
  for (const [a, b] of pieces) {
    const q = alongX ? { x0: a, z0: r.z0, x1: b, z1: r.z1 } : { x0: r.x0, z0: a, x1: r.x1, z1: b };
    AREAS.push({ r: q, y: typeof low === 'number' ? K(low) : low, s, prio: 2, strip: true });
    SOLIDS.push({ r: q, top, bottom, color, mat: 'concrete' });
  }
};
const STONE = '#a69b88';
const KERB_C = '#8e8b84';

const stair = (id: string) => STAIRS.find((s) => s.id === id)!;
const s1 = stair('steps_front_1'), s2 = stair('steps_front_2'), sp = stair('steps_porch');
const D = DRIVEWAY, WELL = GARAGE_VENT_WELL;

/* roads, sidewalks, the site, the quay, the river */
area({ x0: X0, z0: Z0, x1: X_QUAY, z1: WALK_N.z0 - WALL }, YARD.site, 'dirt');
area({ x0: X0, z0: WALK_N.z0, x1: X_QUAY, z1: WALK_N.z1 }, YARD.sidewalk, 'concrete');
area({ x0: X0, z0: ROAD_N.z0, x1: ROAD_E.x1, z1: ROAD_N.z1 }, YARD.road, 'asphalt');
area({ x0: ROAD_E.x0, z0: ROAD_N.z0, x1: ROAD_E.x1, z1: Z1 }, (_x, z) => eastRoadY(z), 'asphalt');
area({ x0: ROAD_E.x1 + KERB, z0: WALK_N.z1, x1: X_QUAY - WALL, z1: Z1 }, (_x, z) => quayY(z), 'concrete'); // the quay
area({ x0: X_QUAY, z0: Z0, x1: X1, z1: Z1 }, YARD.riverBed, 'riverbed');
area({ x0: X0, z0: ROAD_N.z1 + KERB, x1: ROAD_E.x0 - KERB, z1: Z_T1 }, YARD.sidewalk, 'concrete');
area({ x0: X_SE, z0: Z_T1, x1: ROAD_E.x0 - KERB, z1: Z1 }, sidewalkE, 'concrete');
/* the front yard */
area({ x0: X_YARD_W, z0: Z_T1 + WALL, x1: X_SE - WALL, z1: Z_T2 }, YARD.lowerTerrace, 'lawn');
area({ x0: X_YARD_W, z0: Z_T2 + WALL, x1: X_SE - WALL, z1: P(-9.5) }, YARD.upperTerrace, 'lawn');
area({ x0: Hc(-7.25, -1) + 0.01, z0: P(-9.5), x1: D.x0 - 0.3, z1: D.z0 }, YARD.upperTerrace, 'lawn'); // (up to the House: under the porch and the office)
area({ x0: D.x0 - 0.3, z0: P(-9.5), x1: X_SE - WALL, z1: D.z0 - WALL }, YARD.upperTerrace, 'lawn');
/* west and back yards (the back yard reaches round to the drive's south wall); between the upper terrace and the west yard a
   lawn bank west of the House (the NW stairwell in it) */
area({ x0: X_YARD_W, z0: P(-5.5), x1: P(-7.25), z1: P(6.0) }, YARD.westYard, 'lawn'); // (up to the House's west walls)
area({ x0: P(-7.25), z0: P(6.95), x1: P(5.15), z1: P(10) }, YARD.backYard, 'lawn');
area({ x0: P(5.15), z0: P(4.85), x1: X_SE - WALL, z1: P(10) }, YARD.backYard, 'lawn');
area({ x0: WELL.x1 + WALL, z0: D.z1 + WALL, x1: X_SE - WALL, z1: P(4.85) }, YARD.backYard, 'lawn');
/* the lots further out */
area({ x0: P(-16), z0: P(19.5), x1: P(-0.5), z1: Z1 }, YARD.south, 'asphalt'); // APC lot
area({ x0: X0, z0: P(3.4), x1: P(-24.8), z1: P(19.8) }, YARD.south, 'asphalt'); // the neighbour's lot
area({ x0: P(-29.5), z0: Z_T1, x1: P(-26.0), z1: P(3.4) }, (_x, z) => (z >= P(-3) ? YARD.south : YARD.sidewalk + ((YARD.south - YARD.sidewalk) * (z - Z_T1)) / (P(-3) - Z_T1)), 'asphalt'); // far-west lane
/* the drive and the well beside it: level with the garage, across the sidewalk to the road */
area({ x0: D.x0, z0: D.z0, x1: D.x1, z1: D.z1 }, YARD.garage, 'pavers', 1);
area(WELL, YARD.garage, 'pavers', 1);

/* kerbs */
strip({ x0: X0, z0: ROAD_N.z0 - KERB, x1: ROAD_E.x1 + KERB, z1: ROAD_N.z0 }, YARD.road, YARD.sidewalk, YARD.road - 0.2, KERB_C);
strip({ x0: X0, z0: ROAD_N.z1, x1: ROAD_E.x0, z1: ROAD_N.z1 + KERB }, YARD.road, YARD.sidewalk, YARD.road - 0.2, KERB_C);
strip({ x0: ROAD_E.x0 - KERB, z0: ROAD_N.z1 + KERB, x1: ROAD_E.x0, z1: Z1 }, (_x, z) => eastRoadY(z), sidewalkE, YARD.garage - 0.25, KERB_C, [[D.z0, D.z1]]);
strip({ x0: ROAD_E.x1, z0: ROAD_N.z0, x1: ROAD_E.x1 + KERB, z1: Z1 }, (_x, z) => eastRoadY(z), (_x, z) => quayY(z), YARD.garage - 0.25, KERB_C);
/* the quay wall: from the river bed to the quay */
strip({ x0: X_QUAY - WALL, z0: Z0, x1: X_QUAY, z1: Z1 }, YARD.riverBed, (_x, z) => quayY(z), YARD.riverBed - 0.2, '#77756f');
/* the site's wall along its sidewalk, a gate in line with the front walk */
strip({ x0: X0, z0: WALK_N.z0 - WALL, x1: X_QUAY - WALL, z1: WALK_N.z0 }, YARD.site, YARD.sidewalk + 0.6, YARD.site - 0.2, STONE, [[P(-1.5), P(1.5)]]);
/* the front yard's walls (a parapet over the high side), gaps for the flights and their cheeks */
strip({ x0: X_YARD_W, z0: Z_T1, x1: X_SE - WALL, z1: Z_T1 + WALL }, YARD.sidewalk, YARD.lowerTerrace + 0.3, YARD.sidewalk - 0.2, STONE, [[s1.rect.x0 - CHEEK, s1.rect.x1 + CHEEK]]);
strip({ x0: X_YARD_W, z0: Z_T2, x1: X_SE - WALL, z1: Z_T2 + WALL }, YARD.lowerTerrace, YARD.upperTerrace + 0.3, YARD.lowerTerrace - 0.2, STONE, [[s2.rect.x0 - CHEEK, s2.rect.x1 + CHEEK]]);
/* the terraces' west side: a wall down to the lawn west of the yard (a parapet over whichever side is higher) */
strip({ x0: X_YARD_W - WALL, z0: Z_T1, x1: X_YARD_W, z1: P(-9.5) }, YARD.sidewalk - 0.1, { rim: 0.3 }, YARD.sidewalk - 0.3, STONE);
/* the yard's wall over the east sidewalk (north of the drive: two heights, the two terraces behind it; south of it: the back yard) */
strip({ x0: X_SE - WALL, z0: Z_T1, x1: X_SE, z1: Z_T2 }, sidewalkE, YARD.lowerTerrace + 0.3, YARD.garage - 0.3, STONE);
strip({ x0: X_SE - WALL, z0: Z_T2, x1: X_SE, z1: D.z0 - WALL }, sidewalkE, YARD.upperTerrace + 0.3, YARD.garage - 0.3, STONE);
strip({ x0: X_SE - WALL, z0: D.z1, x1: X_SE, z1: Z1 }, sidewalkE, YARD.backYard + 0.45, YARD.garage - 0.3, STONE);
/* the drive's walls: up to the office floor under the House, a parapet over the yards outside it */
strip({ x0: D.x0 - 0.3, z0: D.z0 - WALL, x1: P(8.3), z1: D.z0 }, YARD.garage, -0.3, YARD.garage - 0.1, '#8d8a83');
strip({ x0: P(8.3), z0: D.z0 - WALL, x1: X_SE, z1: D.z0 }, YARD.garage, YARD.upperTerrace + 0.3, YARD.garage - 0.1, STONE);
strip({ x0: WELL.x1 + WALL, z0: D.z1, x1: X_SE - WALL, z1: D.z1 + WALL }, YARD.garage, YARD.backYard + 0.45, YARD.garage - 0.1, STONE);
strip({ x0: WELL.x1, z0: D.z1, x1: WELL.x1 + WALL, z1: WELL.z1 + WALL }, YARD.garage, YARD.backYard + 0.45, YARD.garage - 0.1, STONE);
strip({ x0: WELL.x0, z0: WELL.z1, x1: WELL.x1, z1: WELL.z1 + WALL }, YARD.garage, YARD.backYard + 0.45, YARD.garage - 0.1, STONE);
/* the front walk's flights: the ground goes under the steps; cheek walls either side (the pedestals of the screenshots) */
for (const [s, top] of [[s1, YARD.lowerTerrace + 0.3], [s2, YARD.upperTerrace + 0.3], [sp, 0.35]] as const) {
  AREAS.push({ r: { x0: s.rect.x0 - CHEEK, z0: s.rect.z0, x1: s.rect.x1 + CHEEK, z1: s.rect.z1 }, y: K(s.yMin - 0.15), s: 'stone', prio: 2, strip: true });
  for (const x of [s.rect.x0 - CHEEK, s.rect.x1]) SOLIDS.push({ r: { x0: x, z0: s.rect.z0, x1: x + CHEEK, z1: s.rect.z1 }, top, bottom: s.yMin - 0.25, color: STONE, mat: 'concrete' });
}
/* pit walls round the NW stairwell and the vent shaft (outside the hole, flush with the ground round them; the open
   north end of the stairwell is the top of the flight). The stairwell's carry its guard rails (MapBuilder). */
const S_NW = STAIRS.find((s) => s.id === 'stairs_storage_ext')!.rect;
export const NW_PIT_WALLS: Rect[] = [
  { x0: S_NW.x0 - WALL, z0: S_NW.z0, x1: S_NW.x0, z1: NW_STAIRWELL_PIT.z1 + WALL }, // west, along the flight and the landing
  { x0: S_NW.x0, z0: NW_STAIRWELL_PIT.z1, x1: Hc(-7.25, -1), z1: NW_STAIRWELL_PIT.z1 + WALL }, // south, to the House
  { x0: S_NW.x1, z0: S_NW.z0, x1: S_NW.x1 + WALL, z1: NW_STAIRWELL_PIT.z0 }, // east of the flight
  { x0: S_NW.x1 + WALL, z0: NW_STAIRWELL_PIT.z0 - WALL, x1: Hc(-7.25, -1), z1: NW_STAIRWELL_PIT.z0 }, // north of the landing, to the House
];
{
  const V = VENT_SHAFT;
  for (const r of [...NW_PIT_WALLS, { x0: V.x0 - WALL, z0: V.z0 - WALL, x1: V.x0, z1: V.z1 }, { x0: V.x1, z0: V.z0 - WALL, x1: V.x1 + WALL, z1: V.z1 }, { x0: V.x0, z0: V.z0 - WALL, x1: V.x1, z1: V.z0 }]) {
    strip(r, YARD.garage - 0.1, 'rim', YARD.garage - 0.1, '#8d8a83');
  }
}

/* --------------------------------------------------------------- the solve */
const RES = 0.5;
/** mesh spacing between the areas' own edges */
const MESH = 0.75;

export interface TerrainData {
  /** ground height (the surface the mesh draws), anywhere on the map */
  y(x: number, z: number): number;
  surface(x: number, z: number): Surface;
  /** inside the House's footprint or a pit */
  hole(x: number, z: number): boolean;
  /** grid lines and the height at each grid vertex (row-major, z rows) */
  xs: number[];
  zs: number[];
  hs: Float32Array;
  /** per cell: −1 hole, else the index of its surface in SURFACES; cells inside a strip are flagged */
  cell: Int8Array;
  stripCell: Uint8Array;
  solids: Solid[];
}
export const SURFACES: Surface[] = ['asphalt', 'concrete', 'pavers', 'lawn', 'dirt', 'stone', 'riverbed'];

const inClosed = (r: Rect, x: number, z: number) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6;
const inOpen = (r: Rect, x: number, z: number) => x > r.x0 + 1e-6 && x < r.x1 - 1e-6 && z > r.z0 + 1e-6 && z < r.z1 - 1e-6;
const SORTED = [...AREAS].sort((a, b) => b.prio - a.prio);
function areaAt(x: number, z: number): Area | null {
  for (const a of SORTED) if (a.strip ? inOpen(a.r, x, z) : inClosed(a.r, x, z)) return a;
  return null;
}
/** index of the first line greater than v */
const upper = (lines: number[], v: number) => { let lo = 0, hi = lines.length; while (lo < hi) { const m = (lo + hi) >> 1; if (lines[m] <= v) lo = m + 1; else hi = m; } return lo; };
const isHole = (x: number, z: number) => HOUSE_HOLES.some((r) => inOpen(r, x, z));
const touchesStrip = (x0: number, z0: number, x1: number, z1: number) => AREAS.some((a) => a.strip && a.r.x0 < x1 && a.r.x1 > x0 && a.r.z0 < z1 && a.r.z1 > z0);

let cached: TerrainData | null = null;
export function terrain(): TerrainData {
  return (cached ??= build());
}
export const terrainY = (x: number, z: number) => terrain().y(x, z);

function build(): TerrainData {
  /* Laplace raster: hard cells fixed, strip and hole cells are walls of the solve (reflecting), the rest relaxes */
  const nx = Math.ceil((X1 - X0) / RES), nz = Math.ceil((Z1 - Z0) / RES);
  const v = new Float32Array(nx * nz);
  const kind = new Uint8Array(nx * nz); // 0 free, 1 fixed, 2 boundary (strip / hole)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = X0 + (i + 0.5) * RES, z = Z0 + (j + 0.5) * RES;
      const k = j * nx + i;
      if (isHole(x, z) || touchesStrip(x - RES / 2, z - RES / 2, x + RES / 2, z + RES / 2)) { kind[k] = 2; continue; }
      const a = areaAt(x, z);
      if (a) { kind[k] = 1; v[k] = a.y(x, z); continue; }
      // a hard area reaching into the cell holds it at its edge's height (the free surface starts a whole cell out)
      const b = SORTED.find((q) => !q.strip && q.r.x0 < x + RES / 2 && q.r.x1 > x - RES / 2 && q.r.z0 < z + RES / 2 && q.r.z1 > z - RES / 2);
      if (b) { kind[k] = 1; v[k] = b.y(Math.min(b.r.x1, Math.max(b.r.x0, x)), Math.min(b.r.z1, Math.max(b.r.z0, z))); }
    }
  }
  // first guess: free cells take the mean of the cells already set, growing out from the fixed ones (breadth first)
  {
    const set = new Uint8Array(nx * nz);
    let front: number[] = [];
    for (let k = 0; k < nx * nz; k++) if (kind[k] === 1) { set[k] = 1; front.push(k); }
    while (front.length) {
      const next: number[] = [];
      for (const k of front) {
        const i = k % nx, j = (k / nx) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const n = b * nx + a;
          if (set[n] || kind[n] !== 0) continue;
          set[n] = 1;
          v[n] = v[k];
          next.push(n);
        }
      }
      front = next;
    }
  }
  // successive over-relaxation
  const free: number[] = [];
  for (let k = 0; k < nx * nz; k++) if (kind[k] === 0) free.push(k);
  for (let it = 0; it < 900; it++) {
    let delta = 0;
    for (const k of free) {
      const i = k % nx, j = (k / nx) | 0;
      let sum = 0, n = 0;
      if (i > 0 && kind[k - 1] !== 2) { sum += v[k - 1]; n++; }
      if (i < nx - 1 && kind[k + 1] !== 2) { sum += v[k + 1]; n++; }
      if (j > 0 && kind[k - nx] !== 2) { sum += v[k - nx]; n++; }
      if (j < nz - 1 && kind[k + nx] !== 2) { sum += v[k + nx]; n++; }
      if (!n) continue;
      const d = sum / n - v[k];
      v[k] += 1.85 * d;
      delta = Math.max(delta, Math.abs(d));
    }
    if (delta < 1e-4) break;
  }
  // the smooth surface steepens at the edges and corners of the flat areas: limit every free cell to 15° from its
  // neighbours (a free cell between two that disagree by more takes their mean)
  {
    const s = Math.tan((15 * Math.PI) / 180) * RES;
    for (let pass = 0; pass < 600; pass++) {
      let moved = 0;
      for (const k of free) {
        const i = k % nx, j = (k / nx) | 0;
        let lo = -Infinity, hi = Infinity;
        for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1]) {
          if (n < 0 || kind[n] === 2) continue;
          lo = Math.max(lo, v[n] - s);
          hi = Math.min(hi, v[n] + s);
        }
        const want = lo <= hi ? Math.min(hi, Math.max(lo, v[k])) : (lo + hi) / 2;
        if (Math.abs(want - v[k]) > 1e-5) { v[k] = want; moved++; }
      }
      if (!moved) break;
    }
  }
  /** the relaxed surface at a point: bilinear over the cells around it (boundary cells left out: never across a wall) */
  const relaxed = (x: number, z: number) => {
    const fx = (x - X0) / RES - 0.5, fz = (z - Z0) / RES - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    let sum = 0, w = 0;
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = Math.min(nx - 1, Math.max(0, i0 + di)), j = Math.min(nz - 1, Math.max(0, j0 + dj));
      const k = j * nx + i;
      if (kind[k] === 2) continue;
      const wt = (di ? fx - i0 : 1 - (fx - i0)) * (dj ? fz - j0 : 1 - (fz - j0));
      sum += v[k] * wt;
      w += wt;
    }
    if (w > 1e-6) return sum / w;
    // nothing free around: the nearest free or fixed cell's value
    let best = Infinity, val = 0;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        const i = Math.min(nx - 1, Math.max(0, Math.round(fx) + di)), j = Math.min(nz - 1, Math.max(0, Math.round(fz) + dj));
        const k = j * nx + i;
        if (kind[k] === 2) continue;
        const d = di * di + dj * dj;
        if (d < best) { best = d; val = v[k]; }
      }
    }
    return val;
  };
  let meshY: ((x: number, z: number) => number) | null = null;
  const y = (x: number, z: number) => { const a = areaAt(x, z); return a ? a.y(x, z) : meshY ? meshY(x, z) : relaxed(x, z); };
  const surface = (x: number, z: number): Surface => areaAt(x, z)?.s ?? 'lawn';

  /* the mesh grid: even lines plus every area's and hole's edge */
  const lines = (lo: number, hi: number, edges: number[]) => {
    const ex = [...new Set(edges.filter((e) => e > lo + 1e-6 && e < hi - 1e-6).map((e) => Math.round(e * 1e4) / 1e4))].sort((a, b) => a - b);
    const out = [lo, hi, ...ex];
    for (let t = lo + MESH; t < hi - 1e-6; t += MESH) if (!ex.some((e) => Math.abs(e - t) < MESH * 0.3)) out.push(t);
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const rects = [...AREAS.map((a) => a.r), ...HOUSE_HOLES];
  const xs = lines(X0, X1, rects.flatMap((r) => [r.x0, r.x1]));
  const zs = lines(Z0, Z1, rects.flatMap((r) => [r.z0, r.z1]));
  const hs = new Float32Array(xs.length * zs.length);
  const vkind = new Uint8Array(xs.length * zs.length); // 0 free, 1 hard, 2 inside a strip or a hole
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < xs.length; i++) {
      const a = areaAt(xs[i], zs[j]);
      hs[j * xs.length + i] = a ? a.y(xs[i], zs[j]) : relaxed(xs[i], zs[j]);
      vkind[j * xs.length + i] = a?.strip || isHole(xs[i], zs[j]) ? 2 : a ? 1 : 0;
    }
  }
  // the same 15° limit on the mesh itself (its lines are not the raster's: a hard area's exact edge can sit nearer a free
  // vertex than the raster saw it)
  {
    const t = Math.tan((15 * Math.PI) / 180);
    const nxv = xs.length;
    for (let pass = 0; pass < 200; pass++) {
      let moved = 0;
      for (let j = 0; j < zs.length; j++) {
        for (let i = 0; i < nxv; i++) {
          const k = j * nxv + i;
          if (vkind[k] !== 0) continue;
          let lo = -Infinity, hi = Infinity;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= nxv || b >= zs.length) continue;
            const n = b * nxv + a;
            if (vkind[n] === 2) continue;
            // not across a wall, a kerb or a hole (the segment between them runs over one)
            const mx = (xs[a] + xs[i]) / 2, mz = (zs[b] + zs[j]) / 2;
            if (areaAt(mx, mz)?.strip || isHole(mx, mz)) continue;
            const d = di ? Math.abs(xs[a] - xs[i]) : Math.abs(zs[b] - zs[j]);
            lo = Math.max(lo, hs[n] - t * d);
            hi = Math.min(hi, hs[n] + t * d);
          }
          const want = lo <= hi ? Math.min(hi, Math.max(lo, hs[k])) : (lo + hi) / 2;
          if (Math.abs(want - hs[k]) > 1e-5) { hs[k] = want; moved++; }
        }
      }
      if (!moved) break;
    }
  }
  // the height of the drawn surface between grid lines (what stands on the free ground stands on the mesh)
  meshY = (x: number, z: number) => {
    const i = Math.min(xs.length - 2, Math.max(0, upper(xs, x) - 1)), j = Math.min(zs.length - 2, Math.max(0, upper(zs, z) - 1));
    const fx = (x - xs[i]) / (xs[i + 1] - xs[i]), fz = (z - zs[j]) / (zs[j + 1] - zs[j]);
    const h = (a: number, b: number) => hs[(j + b) * xs.length + i + a];
    // the cell's two triangles: (0,0)-(1,1)-(1,0) and (0,0)-(0,1)-(1,1)
    return fx >= fz ? h(0, 0) + (h(1, 0) - h(0, 0)) * fx + (h(1, 1) - h(1, 0)) * fz : h(0, 0) + (h(0, 1) - h(0, 0)) * fz + (h(1, 1) - h(0, 1)) * fx;
  };
  const cell = new Int8Array((xs.length - 1) * (zs.length - 1));
  const stripCell = new Uint8Array(cell.length);
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      const k = j * (xs.length - 1) + i;
      if (isHole(cx, cz)) { cell[k] = -1; continue; }
      const a = areaAt(cx, cz);
      cell[k] = SURFACES.indexOf(a?.s ?? 'lawn');
      if (a?.strip) stripCell[k] = 1;
    }
  }
  return { y, surface, hole: isHole, xs, zs, hs, cell, stripCell, solids: SOLIDS };
}

/** a wall in pieces of about a metre, each `over` above the highest ground beside it (pit walls: flush, +3 cm) */
export function rimPieces(r: Rect, over = 0.03): { r: Rect; top: number }[] {
  const T = terrain();
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const n = Math.max(1, Math.round(len));
  const out: { r: Rect; top: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (alongX ? r.x0 : r.z0) + (len * k) / n, c = a + len / n;
    let top = -Infinity;
    for (const t of [a, (a + c) / 2, c]) {
      for (const o of alongX ? [r.z0 - 0.05, r.z1 + 0.05] : [r.x0 - 0.05, r.x1 + 0.05]) {
        const x = alongX ? t : o, z = alongX ? o : t;
        if (!T.hole(x, z)) top = Math.max(top, T.y(x, z));
      }
    }
    out.push({ r: alongX ? { x0: a, z0: r.z0, x1: c, z1: r.z1 } : { x0: r.x0, z0: a, x1: r.x1, z1: c }, top: top + over });
  }
  return out;
}

/** the decks and the porch stand on plinths down to the ground (outdoor floors at the 1F level, less what the House holds up) */
export const DECKS = FLOORS.filter((f) => f.kind === 'deck');
