import RAPIER from '@dimforge/rapier3d-compat';
import { G_CLIP, G_WORLD, groups, type Physics } from '../core/Physics.ts';
import type { Rect } from './houseLayout.ts';

/**
 * Static walkability grid: every walkable surface of the built map sampled on a
 * square grid, with which character stances fit there. Paths are then plain
 * graph search over the cells — no simulation, no play-through.
 *
 *  - surfaces: all upward-facing collider tops in a column (multi-hit ray)
 *  - body test per stance: a cylinder of the character's radius from step
 *    height up to the stance's full height (what the character controller
 *    would collide with; anything lower is a step the autostep climbs)
 *  - edges: 4-neighbour cells whose surfaces differ by ≤ STEP (both ways),
 *    or a one-way drop of ≤ MAX_DROP; stance changes in place where the
 *    taller stance fits
 */
export const BODY_R = 0.36; // capsule r 0.35 + controller offset
export const STEP = 0.36; // Soldier autostep max height
export const MAX_DROP = 1.0; // walk off a ledge without vaulting
export const MIN_NORMAL_Y = Math.cos((52 * Math.PI) / 180); // max climbable slope
export const STANCES = [
  { id: 'stand', h: 1.82 },
  { id: 'crouch', h: 1.22 },
  { id: 'prone', h: 0.72 },
] as const;
export type StanceId = (typeof STANCES)[number]['id'];
const BIT = { stand: 1, crouch: 2, prone: 4 } as const;
const MAX_LAYERS = 12;

export interface WalkGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** surface y per (column * MAX_LAYERS + layer) */
  y: Float32Array;
  /** surfaces in each column */
  n: Uint8Array;
  /** stance bits per surface (1 stand, 2 crouch, 4 prone) */
  fit: Uint8Array;
}

export interface GridOptions {
  /** ray start height (above every walkable surface) */
  top?: number;
  /** surfaces above this are recorded (they block steps) but never tested for a body */
  yMax?: number;
  /** columns inside are left empty (another, finer grid covers them) */
  skip?: Rect;
  /** test only the upright body (bots' nav): crouch / prone are then known only where standing fits */
  standOnly?: boolean;
}

export function buildWalkGrid(ph: Physics, area: Rect, cell = 0.1, opts: GridOptions = {}): WalkGrid {
  const top = opts.top ?? 12;
  const yMax = opts.yMax ?? Infinity;
  const nx = Math.round((area.x1 - area.x0) / cell) + 1;
  const nz = Math.round((area.z1 - area.z0) / cell) + 1;
  const g: WalkGrid = { x0: area.x0, z0: area.z0, cell, nx, nz, y: new Float32Array(nx * nz * MAX_LAYERS), n: new Uint8Array(nx * nz), fit: new Uint8Array(nx * nz * MAX_LAYERS) };
  const mask = groups(0xffff, G_WORLD | G_CLIP);
  const w = ph.world;
  const ray = new RAPIER.Ray({ x: 0, y: top, z: 0 }, { x: 0, y: -1, z: 0 });
  const bodies = (opts.standOnly ? STANCES.slice(0, 1) : STANCES).map((s) => ({ bit: BIT[s.id], half: (s.h - STEP) / 2, shape: new RAPIER.Cylinder((s.h - STEP) / 2, BODY_R) }));
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  const ys: number[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = area.x0 + ix * cell;
      const z = area.z0 + iz * cell;
      if (opts.skip && x > opts.skip.x0 && x < opts.skip.x1 && z > opts.skip.z0 && z < opts.skip.z1) continue;
      ray.origin = { x, y: top, z };
      ys.length = 0;
      w.intersectionsWithRay(ray, top + 30, false, (h) => {
        if (h.normal.y >= MIN_NORMAL_Y) ys.push(top - h.timeOfImpact);
        return true;
      }, undefined, mask);
      ys.sort((a, b) => b - a);
      // stacked boxes count once; past MAX_LAYERS drop the highest (roof / wall tops), never a floor below
      const uniq = ys.filter((v, i) => i === 0 || ys[i - 1] - v >= 0.05);
      if (uniq.length > MAX_LAYERS) uniq.splice(0, uniq.length - MAX_LAYERS);
      const c = iz * nx + ix;
      let k = 0;
      for (const [i, sy] of uniq.entries()) {
        let fit = 0;
        // buried: something else's top is within a step above (a deck over the ground, a rug on the floor)
        const buried = i > 0 && uniq[i - 1] - sy <= STEP;
        // stand ⊃ crouch ⊃ prone: test the tallest first, stop at the first that fits
        for (const b of sy <= yMax && !buried ? bodies : []) {
          if (!w.intersectionWithShape({ x, y: sy + STEP + b.half, z }, rot, b.shape, undefined, mask)) {
            fit = b.bit === 1 ? 7 : b.bit === 2 ? 6 : 4;
            break;
          }
        }
        g.y[c * MAX_LAYERS + k] = sy;
        g.fit[c * MAX_LAYERS + k] = fit;
        k++;
      }
      g.n[c] = k;
    }
  }
  // support: a top only one cell wide in either direction (a rail, a wall edge) is not something to stand on
  // neighbours of a sloped surface differ by up to tan(52°) per cell
  const tol = Math.tan((52 * Math.PI) / 180) * cell + 0.01;
  const same = (c: number, y: number) => { for (let k = 0; k < g.n[c]; k++) if (Math.abs(g.y[c * MAX_LAYERS + k] - y) < tol) return true; return false; };
  const thin: number[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const c = iz * nx + ix;
      for (let k = 0; k < g.n[c]; k++) {
        const s = c * MAX_LAYERS + k;
        if (!g.fit[s]) continue;
        const y = g.y[s];
        const xs = (ix > 0 && same(c - 1, y)) || (ix < nx - 1 && same(c + 1, y));
        const zs = (iz > 0 && same(c - nx, y)) || (iz < nz - 1 && same(c + nx, y));
        if (!xs || !zs) thin.push(s);
      }
    }
  }
  for (const s of thin) g.fit[s] = 0;
  return g;
}

/**
 * Does a character fit standing at feet position p in the live physics world?
 * The same body as the grid (radius BODY_R up to the stance height), but from
 * just above the floor: a spawn must not start inside a low step either.
 */
export function bodyFree(ph: Physics, x: number, y: number, z: number, stance: StanceId = 'stand', from = 0.12): boolean {
  const h = STANCES.find((s) => s.id === stance)!.h;
  const half = (h - from) / 2;
  return !ph.world.intersectionWithShape({ x, y: y + from + half, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cylinder(half, BODY_R), undefined, groups(0xffff, G_WORLD | G_CLIP));
}

/** surface id = column * MAX_LAYERS + layer */
export function surfaceAt(g: WalkGrid, x: number, y: number, z: number, tol = 0.4): number {
  const ix = Math.round((x - g.x0) / g.cell);
  const iz = Math.round((z - g.z0) / g.cell);
  if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return -1;
  const c = iz * g.nx + ix;
  let best = -1;
  let bd = tol;
  for (let k = 0; k < g.n[c]; k++) {
    const d = Math.abs(g.y[c * MAX_LAYERS + k] - y);
    if (d <= bd) { bd = d; best = c * MAX_LAYERS + k; }
  }
  return best;
}

export const surfacePos = (g: WalkGrid, s: number): [number, number, number] => {
  const c = Math.floor(s / MAX_LAYERS);
  return [g.x0 + (c % g.nx) * g.cell, g.y[s], g.z0 + Math.floor(c / g.nx) * g.cell];
};

/** nearest surface around (x,z) at ~y that fits the stance (search radius r) */
export function nearestFit(g: WalkGrid, x: number, y: number, z: number, stance: StanceId = 'stand', r = 0.35, tol = 0.4): number {
  let best = -1;
  let bd = Infinity;
  const n = Math.ceil(r / g.cell);
  for (let dz = -n; dz <= n; dz++) {
    for (let dx = -n; dx <= n; dx++) {
      const s = surfaceAt(g, x + dx * g.cell, y, z + dz * g.cell, tol);
      if (s < 0 || !(g.fit[s] & BIT[stance])) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
  }
  return best;
}

/**
 * Neighbours reachable from surface s while keeping stance bit `bit`. Moving
 * into a column lands on its highest surface at most `up` above (a step, or a
 * climb when `up` is the vault height); landing more than `drop` below is not
 * a walk. Gaps of up to GAP_CELLS empty cells (seams between a flight and its
 * landing) are stepped over: the capsule's footprint (Ø 0.72 m) spans them.
 * With `drop = Infinity` this is "where can I end up" (falls included).
 */
const GAP_CELLS = 2;
export function* moves(g: WalkGrid, s: number, bit: number, drop = MAX_DROP, up = STEP): Generator<number> {
  const c = Math.floor(s / MAX_LAYERS);
  const ix = c % g.nx;
  const iz = Math.floor(c / g.nx);
  const y = g.y[s];
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    for (let step = 1; step <= GAP_CELLS + 1; step++) {
      const jx = ix + dx * step;
      const jz = iz + dz * step;
      if (jx < 0 || jz < 0 || jx >= g.nx || jz >= g.nz) break;
      const d = jz * g.nx + jx;
      // the surface a body moving in stands on: the highest one it can step / climb onto
      let t = -1;
      for (let k = 0; k < g.n[d]; k++) if (g.y[d * MAX_LAYERS + k] - y <= up) { t = d * MAX_LAYERS + k; break; }
      const dy = t < 0 ? -Infinity : g.y[t] - y;
      if (t >= 0 && dy >= -MAX_DROP) {
        // walked onto; across a seam only at about the same level
        if (g.fit[t] & bit && (step === 1 || Math.abs(dy) <= STEP)) yield t;
        else if (up > STEP) {
          // blocked by a ledge within climbing height: walk up to it and vault on top
          for (let m = 1; m <= 6; m++) {
            const kx = jx + dx * m;
            const kz = jz + dz * m;
            if (kx < 0 || kz < 0 || kx >= g.nx || kz >= g.nz) break;
            const e = kz * g.nx + kx;
            let hi = -1;
            let tall = false;
            for (let k = 0; k < g.n[e]; k++) {
              const sy = g.y[e * MAX_LAYERS + k];
              if (sy > y + up && sy < y + 2.2) tall = true;
              else if (sy <= y + up && hi < 0) hi = e * MAX_LAYERS + k;
            }
            if (tall) break;
            if (hi >= 0 && g.y[hi] - y > STEP && g.fit[hi] & bit) { yield hi; break; }
          }
        }
        break;
      }
      if (t >= 0 && dy >= -drop) {
        // walked off a ledge: land on the first surface below, as far in as the body needs (it does not land against a wall)
        const ly = g.y[t];
        for (let m = 0; m <= 6; m++) {
          const kx = jx + dx * m;
          const kz = jz + dz * m;
          if (kx < 0 || kz < 0 || kx >= g.nx || kz >= g.nz) break;
          const e = kz * g.nx + kx;
          let u = -1;
          for (let k = 0; k < g.n[e]; k++) if (Math.abs(g.y[e * MAX_LAYERS + k] - ly) <= STEP && g.fit[e * MAX_LAYERS + k] & bit) { u = e * MAX_LAYERS + k; break; }
          if (u >= 0) { yield u; break; }
        }
        break;
      }
      // nothing to stand on within a step: a seam the body spans — look one cell further
    }
  }
}

export interface Reach {
  /** stance bits a surface was reached with (1 stand, 2 crouch, 4 prone) */
  bits: Uint8Array;
  /** BFS parent of a (surface, stance) state, for path recovery (-1 = seed) */
  from: Int32Array;
}

const stateOf = (s: number, si: number) => s * 3 + si;

/**
 * Breadth-first search over (surface, stance) from seed surfaces. With
 * `stances = ['stand']` only stand-upright routes count; with all three the
 * character may crouch / go prone wherever that fits and stand back up.
 */
export function reach(g: WalkGrid, seeds: number[], stances: StanceId[] = ['stand', 'crouch', 'prone']): Reach {
  const total = g.fit.length;
  const bits = new Uint8Array(total);
  const from = new Int32Array(total * 3).fill(-2);
  const allowed = stances.map((s) => STANCES.findIndex((t) => t.id === s));
  const q = new Int32Array(total * 3);
  let qh = 0;
  let qt = 0;
  const push = (st: number, parent: number) => {
    if (from[st] !== -2) return;
    from[st] = parent;
    bits[Math.floor(st / 3)] |= 1 << (st % 3);
    q[qt++] = st;
  };
  for (const s of seeds) for (const si of allowed) if (g.fit[s] & (1 << si)) { push(stateOf(s, si), -1); break; }
  while (qh < qt) {
    const st = q[qh++];
    const s = Math.floor(st / 3);
    const si = st % 3;
    for (const sj of allowed) if (sj !== si && g.fit[s] & (1 << sj)) push(stateOf(s, sj), st);
    for (const t of moves(g, s, 1 << si)) push(stateOf(t, si), st);
  }
  return { bits, from };
}

/** surfaces from a seed to s (any stance it was reached with), or null */
export function pathTo(r: Reach, s: number): number[] | null {
  let st = -1;
  for (let si = 0; si < 3; si++) if (r.from[s * 3 + si] !== -2) { st = s * 3 + si; break; }
  if (st < 0) return null;
  const out: number[] = [];
  while (st >= 0) { out.push(Math.floor(st / 3)); st = r.from[st]; }
  return out.reverse();
}

/**
 * Bounded breadth-first search between two surfaces keeping one stance:
 * number of cells on the shortest grid route, or -1 when there is none within
 * `maxCells` steps (used to check every bot nav edge has a real walkway).
 */
let stamp: Int32Array | null = null;
let gen = 0;
export function gridDistance(g: WalkGrid, a: number, b: number, maxCells: number, stance: StanceId = 'stand'): number {
  if (!stamp || stamp.length !== g.fit.length) { stamp = new Int32Array(g.fit.length); gen = 0; }
  gen++;
  const bit = BIT[stance];
  if (!(g.fit[a] & bit) || !(g.fit[b] & bit)) return -1;
  let cur = [a];
  stamp[a] = gen;
  for (let d = 0; d <= maxCells && cur.length; d++) {
    const next: number[] = [];
    for (const s of cur) {
      if (s === b) return d;
      for (const t of moves(g, s, bit)) if (stamp[t] !== gen) { stamp[t] = gen; next.push(t); }
    }
    cur = next;
  }
  return -1;
}

/**
 * Clear width through a doorway for a stance: the run of consecutive cells
 * along the opening's centre line that fit the body, plus the body diameter.
 * 0 when the body fits nowhere in it.
 */
export function clearWidth(g: WalkGrid, run: 'x' | 'z', c: number, at: number, w: number, y: number, stance: StanceId = 'stand'): number {
  let best = 0;
  let cur = 0;
  for (let u = at - w / 2 - 0.2; u <= at + w / 2 + 0.2; u += g.cell) {
    const s = run === 'x' ? surfaceAt(g, u, y, c, 0.3) : surfaceAt(g, c, y, u, 0.3);
    if (s >= 0 && g.fit[s] & BIT[stance]) { cur++; best = Math.max(best, cur); } else cur = 0;
  }
  return best ? (best - 1) * g.cell + BODY_R * 2 : 0;
}

export { BIT as STANCE_BIT, MAX_LAYERS };

/**
 * Can a body walk the straight segment a → b keeping `stance`? Follows the
 * surface under the line (steps ≤ STEP either way, so it holds both ways),
 * stepping over seams of ≤ 0.25 m. This is what a bot's straight-line move
 * between two nav nodes actually needs.
 */
export function lineWalk(g: WalkGrid, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, stance: StanceId = 'stand'): boolean {
  // always walk from the same end, so a → b and b → a agree
  if (a.x > b.x || (a.x === b.x && a.z > b.z)) [a, b] = [b, a];
  const bit = BIT[stance];
  const at = (x: number, z: number) => {
    const ix = Math.round((x - g.x0) / g.cell);
    const iz = Math.round((z - g.z0) / g.cell);
    return ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz ? -1 : iz * g.nx + ix;
  };
  let c = at(a.x, a.z);
  if (c < 0) return false;
  // start on the surface nearest a
  let y = NaN;
  for (let k = 0; k < g.n[c]; k++) { const s = c * MAX_LAYERS + k; if (Math.abs(g.y[s] - a.y) < 0.3 && g.fit[s] & bit) { y = g.y[s]; break; } }
  if (Number.isNaN(y)) return false;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  let gap = 0;
  let last = c;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    c = at(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f);
    if (c < 0) return false;
    if (c === last) continue;
    last = c;
    // the surface stepped onto: the highest one within a step up (as in moves())
    let t = -1;
    for (let k = 0; k < g.n[c]; k++) if (g.y[c * MAX_LAYERS + k] - y <= STEP) { t = c * MAX_LAYERS + k; break; }
    const dy = t < 0 ? -Infinity : g.y[t] - y;
    if (dy >= -STEP) {
      if (!(g.fit[t] & bit)) return false; // something there, and the body does not fit on it
      y = g.y[t];
      gap = 0;
      continue;
    }
    if (dy >= -MAX_DROP) return false; // a ledge: fine to drop, but not a two-way walk
    gap += g.cell;
    if (gap > 0.25) return false;
  }
  return Math.abs(y - b.y) < 0.3;
}

/** surfaces reached upright from the seeds (1 = reached): a lean stand-only BFS for runtime use */
export function reachedUpright(g: WalkGrid, seeds: number[]): Uint8Array {
  const seen = new Uint8Array(g.fit.length);
  const q = new Int32Array(g.fit.length);
  let qh = 0;
  let qt = 0;
  for (const s of seeds) if (s >= 0 && g.fit[s] & 1 && !seen[s]) { seen[s] = 1; q[qt++] = s; }
  while (qh < qt) for (const t of moves(g, q[qh++], 1)) if (!seen[t]) { seen[t] = 1; q[qt++] = t; }
  return seen;
}
