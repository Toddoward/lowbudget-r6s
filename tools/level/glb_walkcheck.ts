// Cross-check our walkability against the source model: which rooms open into
// which, judged by a body (r 0.36 m) moving between the model's wall slabs
// (glb_faces.py → faces.json, sliced at 60 % of wall height: doors open,
// walls closed), compared with the same question asked of our built map's
// clearance grid (src/map/walkGrid.ts). The .glb is not redistributed, so this
// runs where you have it:
//
//   python3 glb_extract.py house_map.glb && python3 glb_faces.py
//   node --experimental-transform-types --no-warnings tools/level/glb_walkcheck.ts faces.json [out-dir]
//
// Output: per floor, every pair of touching rooms with "model / ours"; any
// disagreement is listed (a door we blocked, or a gap the model does not have),
// and with an out-dir, PNG overlays (model walls on our reach map).
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildOutdoor } from '../../src/map/Outdoor.ts';
import { decodeHouseDatamap512Headless } from '../../src/map/houseDatamap.ts';
import { FLOOR_Y, ROOMS, WALLS, type FloorId, type Rect } from '../../src/map/houseLayout.ts';
const FLOOR_TAG: Record<number, string> = { [-1]: 'B', 0: '1F', 1: '2F' };
import { BODY_R, buildWalkGrid, surfaceAt } from '../../src/map/walkGrid.ts';
import { png } from './png.ts';

const S = 2.85; // model plan → metres (houseLayout.ts)
const CELL = 0.1;
const AREA = { x0: -11, z0: -9, x1: 11, z1: 8.5 };
const NX = Math.round((AREA.x1 - AREA.x0) / CELL);
const NZ = Math.round((AREA.z1 - AREA.z0) / CELL);
const FLOORS: Record<string, FloorId> = { B1: -1, '1F': 0, '2F': 1 };

interface Piece { o: 'h' | 'v'; c0: number; c1: number; a: number; b: number }
type Diag = [[number, number], [number, number], [number, number], string];
const faces: Record<string, { pieces: Piece[]; diag: Diag[] }> = JSON.parse(readFileSync(process.argv[2] ?? 'faces.json', 'utf8'));
const outDir = process.argv[3];

/**
 * Reviewed differences we keep on purpose (matched by the printed location prefix).
 * Everything else the audit prints is a defect to fix in houseLayout.ts.
 */
const KEEP: Record<string, string> = {
  'B x=9.7 z≈2.00': 'garage shutter A: the model draws the roll-up door closed (a wall); it opens in game',
  'B x=7.2 z≈-2.70': 'garage shutter B: same',
  '1F z=3.75 x≈-7.90': 'an unbarricaded 1.2 m gap in the model\'s back-entrance façade (no door/window box): kept closed — the back door is the barricaded one at x −4.3',
  'B1 model wall 2.79 m, x -8.92': 'the model\'s B1 corridor west of storage: our NW stairwell follows the datamap (zone 11, from the north) and ends in a pit at the storage door',
  'B1 model wall 1.32 m, x -8.71': 'same corridor (its north end)',
  '2F z=-5.5 x≈-5.15': 'the model\'s bathroom/west-hall wall is below the slice height (a low partition in the model); the bathroom keeps its wall and door',
};
const kept = (msg: string) => Object.keys(KEEP).find((k) => msg.includes(k));
const report = (msg: string) => { const k = kept(msg); if (k) { console.log(`ok ${msg}  [kept: ${KEEP[k]}]`); return 0; } console.log(`!! ${msg}`); return 1; };

/** model walls → raw wall cells */
function modelWalls(fl: string): Uint8Array {
  const wall = new Uint8Array(NX * NZ);
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    for (let iz = Math.max(0, Math.floor((z0 - AREA.z0) / CELL)); iz <= Math.min(NZ - 1, Math.floor((z1 - AREA.z0) / CELL)); iz++)
      for (let ix = Math.max(0, Math.floor((x0 - AREA.x0) / CELL)); ix <= Math.min(NX - 1, Math.floor((x1 - AREA.x0) / CELL)); ix++) wall[iz * NX + ix] = 1;
  };
  for (const p of faces[fl].pieces) {
    if (p.o === 'h') mark(p.a * S, -p.c1 * S, p.b * S, -p.c0 * S);
    else mark(p.c0 * S, -p.b * S, p.c1 * S, -p.a * S);
  }
  for (const [p, q] of faces[fl].diag) {
    const n = Math.ceil((Math.hypot(q[0] - p[0], q[1] - p[1]) * S) / 0.05);
    for (let k = 0; k <= n; k++) { const x = (p[0] + ((q[0] - p[0]) * k) / n) * S; const z = -(p[1] + ((q[1] - p[1]) * k) / n) * S; mark(x - 0.08, z - 0.08, x + 0.08, z + 0.08); }
  }
  return wall;
}

/** … dilated by the body radius */
function modelBlocked(fl: string): Uint8Array {
  const wall = modelWalls(fl);
  const r = Math.round(BODY_R / CELL);
  const out = new Uint8Array(NX * NZ);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      if (!wall[iz * NX + ix]) continue;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx >= 0 && jz >= 0 && jx < NX && jz < NZ) out[jz * NX + jx] = 1;
      }
    }
  }
  return out;
}

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });
const inAny = (rs: Rect[], x: number, z: number) => rs.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
const touches = (a: Rect[], b: Rect[]) => a.some((p) => b.some((q) => p.x0 <= q.x1 + 0.5 && q.x0 <= p.x1 + 0.5 && p.z0 <= q.z1 + 0.5 && q.z0 <= p.z1 + 0.5));

/** can a body get from A to B moving only inside A ∪ B (+ the wall between)? */
function connected(free: (ix: number, iz: number) => boolean, A: Rect[], B: Rect[]): boolean {
  const region = [...A, ...B].map((r) => grow(r, 0.2));
  const at = (ix: number, iz: number) => [AREA.x0 + (ix + 0.5) * CELL, AREA.z0 + (iz + 0.5) * CELL] as const;
  const seen = new Uint8Array(NX * NZ);
  const st: number[] = [];
  for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) { const [x, z] = at(ix, iz); if (inAny(A, x, z) && free(ix, iz)) { seen[iz * NX + ix] = 1; st.push(iz * NX + ix); } }
  while (st.length) {
    const i = st.pop()!;
    const ix = i % NX, iz = (i / NX) | 0;
    const [x, z] = at(ix, iz);
    if (inAny(B, x, z) && !inAny(A, x, z)) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= NX || jz >= NZ) continue;
      const j = jz * NX + jx;
      if (seen[j] || !free(jx, jz)) continue;
      const [x2, z2] = at(jx, jz);
      if (!inAny(region, x2, z2)) continue;
      seen[j] = 1;
      st.push(j);
    }
  }
  return false;
}

const ph = await Physics.create();
buildHouse(ph, new DestructionSystem(ph), new THREE.Scene());
buildOutdoor(ph, new THREE.Scene(), decodeHouseDatamap512Headless());
ph.world.step();
const grid = buildWalkGrid(ph, AREA, CELL);

let mismatches = 0;
for (const [fl, floor] of Object.entries(FLOORS)) {
  const y = FLOOR_Y[floor];
  const blocked = modelBlocked(fl);
  const modelFree = (ix: number, iz: number) => !blocked[iz * NX + ix];
  // ours: the upright body fits on the floor here — furniture included, so "model open, ours shut" means a wall or a prop blocks it
  const ours = (ix: number, iz: number) => {
    const s = surfaceAt(grid, AREA.x0 + (ix + 0.5) * CELL, y, AREA.z0 + (iz + 0.5) * CELL, 0.4);
    return s >= 0 && (grid.fit[s] & 1) === 1;
  };
  const rooms = ROOMS.filter((r) => r.floor === floor);
  console.log(`\n== ${fl} ==`);
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j];
      if (!touches(A.rects, B.rects)) continue;
      const m = connected(modelFree, A.rects, B.rects);
      const o = connected(ours, A.rects, B.rects);
      // informational: our room rects and the model's walls can sit a few cm apart, which this coarse test cannot tell
      // from a real difference — the wall-by-wall audit below is the verdict
      const flag = m === o ? '  ' : ' ?';
      if (m !== o) mismatches++;
      console.log(`${flag} ${A.id.padEnd(13)} ↔ ${B.id.padEnd(13)} model ${m ? 'open ' : 'shut '} ours ${o ? 'open ' : 'shut '}${m !== o ? (m ? '← we block a passage the model has' : '← we have a passage the model does not') : ''}`);
    }
  }
  if (outDir) {
    // overlay: model walls (dark), our walkable floor (green), both (olive)
    const K = 3;
    const img = Buffer.alloc(NX * K * NZ * K * 3);
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const mw = blocked[iz * NX + ix], ow = ours(ix, iz);
      const c = mw && ow ? [150, 120, 30] : mw ? [40, 40, 40] : ow ? [60, 190, 80] : [200, 70, 70];
      for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) { const p = ((iz * K + a) * NX * K + ix * K + b) * 3; img[p] = c[0]; img[p + 1] = c[1]; img[p + 2] = c[2]; }
    }
    writeFileSync(`${outDir}/glbcheck_${fl}.png`, png(NX * K, NZ * K, img));
  }
}
// door audit: along each of our axis-aligned walls, the model's gaps vs our openings
let doorIssues = 0;
console.log('\n== openings, wall by wall ==');
for (const [fl, floor] of Object.entries(FLOORS)) {
  const raw = modelWalls(fl);
  const wallAt = (x: number, z: number) => { const ix = Math.floor((x - AREA.x0) / CELL), iz = Math.floor((z - AREA.z0) / CELL); return ix >= 0 && iz >= 0 && ix < NX && iz < NZ && raw[iz * NX + ix] === 1; };
  for (const w of WALLS.filter((q) => q.floor === floor)) {
    // model wall present at u: any wall cell within ±0.25 m of our wall line
    const present = (u: number) => [-0.25, -0.15, -0.05, 0.05, 0.15, 0.25].some((d) => (w.run === 'x' ? wallAt(u, w.c + d) : wallAt(w.c + d, u)));
    const gaps: [number, number][] = [];
    let start: number | null = null;
    for (let u = w.from + 0.15; u <= w.to - 0.15 + 1e-6; u += 0.05) {
      if (!present(u)) { if (start === null) start = u; } else if (start !== null) { if (u - start >= 0.6) gaps.push([start, u]); start = null; }
    }
    if (start !== null && w.to - 0.15 - start >= 0.6) gaps.push([start, w.to - 0.15]);
    const ops = (w.openings ?? []).filter((o) => o.kind !== 'vent');
    const where = (u: number) => `${FLOOR_TAG[floor]} ${w.run === 'x' ? `z=${w.c} x≈${u.toFixed(2)}` : `x=${w.c} z≈${u.toFixed(2)}`}`;
    for (const [a, b] of gaps) {
      if (!ops.some((o) => o.at + o.w / 2 > a && o.at - o.w / 2 < b)) doorIssues += report(`model gap ${(b - a).toFixed(2)} m wide at ${where((a + b) / 2)} — we have a wall there`);
    }
    for (const o of ops) {
      // windows: the model's wall slices run through them (its barricade boxes mark windows) — only doors are compared here
      if (o.kind === 'window' || o.kind === 'open_window' || o.kind === 'french') continue;
      if (!gaps.some(([a, b]) => o.at + o.w / 2 > a && o.at - o.w / 2 < b)) doorIssues += report(`our ${o.kind} (${o.w} m) at ${where(o.at)} — the model has a wall there`);
    }
    // our solid wall where the model has nothing at all (a gap wider than a door)
    for (const [a, b] of gaps) {
      if (b - a < 1.6) continue;
      const covered = ops.filter((o) => o.at + o.w / 2 > a && o.at - o.w / 2 < b).reduce((m, o) => m + o.w, 0);
      if (b - a - covered > 1.2) doorIssues += report(`our wall ${(b - a - covered).toFixed(2)} m at ${where((a + b) / 2)} — the model is open there (${(b - a).toFixed(2)} m)`);
    }
  }
}
// the other way round: every model wall slab ≥ 0.8 m long must stand in our map too (a collider at chest height)
let missing = 0;
console.log('\n== model walls missing in ours ==');
for (const [fl, floor] of Object.entries(FLOORS)) {
  const y = FLOOR_Y[floor] + 1.3;
  for (const p of faces[fl].pieces) {
    const [x0, z0, x1, z1] = p.o === 'h' ? [p.a * S, -p.c1 * S, p.b * S, -p.c0 * S] : [p.c0 * S, -p.b * S, p.c1 * S, -p.a * S];
    const len = Math.max(x1 - x0, z1 - z0);
    if (len < 0.8) continue;
    const n = Math.ceil(len / 0.2);
    let hole = 0;
    let firstGap: [number, number] | null = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * (x1 - x0 > z1 - z0 ? t : 0.5);
      const z = z0 + (z1 - z0) * (x1 - x0 > z1 - z0 ? 0.5 : t);
      if (!ph.overlapsWorld(new THREE.Vector3(x, y, z), 0.22)) { hole++; firstGap ??= [x, z]; }
    }
    if (hole / (n + 1) > 0.3) missing += report(`${fl} model wall ${len.toFixed(2)} m, x ${x0.toFixed(2)}..${x1.toFixed(2)} z ${z0.toFixed(2)}..${z1.toFixed(2)}: ${hole}/${n + 1} samples have nothing in ours (e.g. ${firstGap!.map((v) => v.toFixed(2)).join(', ')})`);
  }
}
console.log(`\n${doorIssues} opening(s) differ, ${missing} model wall(s) missing (room pairs to eyeball: ${mismatches})`);
process.exitCode = doorIssues || missing ? 1 : 0;

