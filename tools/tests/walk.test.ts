// Walkability by graph search, not by playing: the built map's colliders are
// sampled into a per-stance clearance grid (src/map/walkGrid.ts) and every
// scenario that needs a route — spawn → room, door, staircase, objective, bot
// spawn, bot nav edge — is checked with BFS over it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildSuburb } from '../../src/map/Suburb.ts';
import { FLOOR_Y, ROOMS, SPAWN_ZONES, STAIRS } from '../../src/map/houseLayout.ts';
import { NavGraph } from '../../src/ai/NavGraph.ts';
import { BODY_R, buildWalkGrid, clearWidth, gridDistance, MAX_LAYERS, moves, nearestFit, reach, surfaceAt, surfacePos } from '../../src/map/walkGrid.ts';
import { SITES } from '../../shared/constants.ts';

const ph = await Physics.create();
const destruction = new DestructionSystem(ph);
const scene = new THREE.Scene();
const house = buildHouse(ph, destruction, scene);
buildSuburb(ph, scene);
ph.world.step();
const nav = new NavGraph(ph, destruction);
nav.build(house.openings, house.wallPanels);
const AREA = { x0: -46, z0: -46, x1: 46, z1: 42 };
const grid = buildWalkGrid(ph, AREA, 0.1);
const inArea = (p: THREE.Vector3) => p.x > AREA.x0 + 1 && p.x < AREA.x1 - 1 && p.z > AREA.z0 + 1 && p.z < AREA.z1 - 1;
const seeds = SPAWN_ZONES.map((z) => nearestFit(grid, z.center[0], z.center[1], z.center[2], 'stand', 1.5, 1));
const upright = reach(grid, seeds.filter((s) => s >= 0), ['stand']);
const anyStance = reach(grid, seeds.filter((s) => s >= 0));

/** a standing spot within r of (x, y, z) that a character walked to upright from the spawns */
const reachedNear = (x: number, y: number, z: number, r = 0.3, tol = 0.25) => {
  for (let dz = -r; dz <= r + 1e-6; dz += grid.cell) {
    for (let dx = -r; dx <= r + 1e-6; dx += grid.cell) {
      const s = surfaceAt(grid, x + dx, y, z + dz, tol);
      if (s >= 0 && upright.bits[s] & 1) return s;
    }
  }
  return -1;
};
const fmt = (p: THREE.Vector3 | number[]) => (Array.isArray(p) ? p : [p.x, p.y, p.z]).map((v) => v.toFixed(2)).join(', ');

test('every attacker spawn zone has standing room and they all connect', () => {
  SPAWN_ZONES.forEach((z, i) => assert.ok(seeds[i] >= 0, `${z.id}: no standing spot near ${z.center}`));
  for (const [i, z] of SPAWN_ZONES.entries()) {
    const only = reach(grid, [seeds[i]], ['stand']);
    for (const [j, o] of SPAWN_ZONES.entries()) assert.ok(only.bits[seeds[j]] & 1, `${z.id} → ${o.id}: no upright route`);
  }
});

const REACH_OFFSETS = Array.from({ length: 10 }, (_, i) => i + 1).flatMap((d) => [[-d, 0], [d, 0], [0, -d], [0, d]]);

test('no traps: wherever you can walk or fall to, you can walk (or vault) back to a spawn', () => {
  const CLIMB = 1.3; // Soldier VAULT_MAX_H
  // forward: walking plus falls of any height
  const fwd = new Uint8Array(grid.fit.length);
  const q: number[] = [];
  for (const s of seeds) { fwd[s] = 1; q.push(s); }
  while (q.length) for (const t of moves(grid, q.pop()!, 1, Infinity)) if (!fwd[t]) { fwd[t] = 1; q.push(t); }
  // backward from the spawns: u → s is a move (walk / short drop / vault up) when s ∈ moves(u)
  const back = new Uint8Array(grid.fit.length);
  for (const s of seeds) { back[s] = 1; q.push(s); }
  while (q.length) {
    const s = q.pop()!;
    const c = Math.floor(s / MAX_LAYERS);
    const ix = c % grid.nx;
    const iz = Math.floor(c / grid.nx);
    // a move spans at most 3 cells walking, ~10 when vaulting a ledge or falling clear of a wall
    for (const [dx, dz] of REACH_OFFSETS) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= grid.nx || jz >= grid.nz) continue;
      const d = jz * grid.nx + jx;
      for (let k = 0; k < grid.n[d]; k++) {
        const u = d * MAX_LAYERS + k;
        if (back[u] || !fwd[u]) continue;
        for (const t of moves(grid, u, 1, 1.0, CLIMB)) if (t === s) { back[u] = 1; q.push(u); break; }
      }
    }
  }
  const traps: string[] = [];
  const seen = new Uint8Array(grid.fit.length);
  for (let s0 = 0; s0 < grid.fit.length; s0++) {
    if (!fwd[s0] || back[s0] || seen[s0]) continue;
    const comp = [s0];
    seen[s0] = 1;
    for (let i = 0; i < comp.length; i++) for (const t of moves(grid, comp[i], 1, Infinity)) if (fwd[t] && !back[t] && !seen[t]) { seen[t] = 1; comp.push(t); }
    if (comp.length >= 5) traps.push(`${(comp.length * 0.01).toFixed(2)} m² trap at ${fmt(surfacePos(grid, s0))}`);
  }
  assert.deepEqual(traps, []);
});

test('every room is entered upright and has no sealed-off standing pockets', () => {
  const problems: string[] = [];
  for (const r of ROOMS) {
    const y = FLOOR_Y[r.floor];
    let free = 0;
    let reached = 0;
    const seen = new Set<number>();
    for (const rr of r.rects) {
      for (let x = rr.x0 + 0.05; x < rr.x1; x += 0.1) {
        for (let z = rr.z0 + 0.05; z < rr.z1; z += 0.1) {
          const s0 = surfaceAt(grid, x, y, z, 0.15);
          if (s0 < 0 || !(grid.fit[s0] & 1)) continue;
          free++;
          if (upright.bits[s0] & 1) { reached++; continue; }
          if (seen.has(s0)) continue;
          // flood the unreached standing floor around it: a pocket ≥ 0.5 m² is a sealed-off area
          const stack = [s0];
          seen.add(s0);
          let n = 0;
          while (stack.length) {
            const s = stack.pop()!;
            n++;
            const [px, py, pz] = surfacePos(grid, s);
            for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              const t = surfaceAt(grid, px + dx * grid.cell, py, pz + dz * grid.cell, 0.36);
              if (t >= 0 && grid.fit[t] & 1 && !(upright.bits[t] & 1) && !seen.has(t)) { seen.add(t); stack.push(t); }
            }
          }
          if (n >= 50) problems.push(`${r.id}: sealed standing pocket of ${(n * 0.01).toFixed(2)} m² at ${fmt([x, y, z])}`);
        }
      }
    }
    if (!reached) problems.push(`${r.id}: no standing floor reachable (${free} free cells)`);
  }
  assert.deepEqual(problems, []);
});

test('objective spots of every site (and every room) are reached upright', () => {
  const bad = ROOMS.filter((r) => reachedNear(r.spot[0], FLOOR_Y[r.floor], r.spot[1], 0.15) < 0).map((r) => `${r.id} spot ${r.spot}`);
  assert.deepEqual(bad, []);
  for (const s of SITES) assert.ok(ROOMS.some((r) => r.id === s.id), `site ${s.id} is a room`);
});

test('every doorway / archway is wide enough to walk through upright, and both sides are reached', () => {
  const bad: string[] = [];
  for (const op of house.openings) {
    if (op.kind !== 'door' && op.kind !== 'exterior_door' && op.kind !== 'arch' && op.kind !== 'french') continue;
    if (op.run === 'd') continue;
    const w = clearWidth(grid, op.run, op.c, op.run === 'x' ? op.center.x : op.center.z, op.w, op.floorY);
    if (w < BODY_R * 2) bad.push(`${op.label}: body does not fit (clear ${w.toFixed(2)} m)`);
    for (const side of [-0.7, 0.7]) {
      const p = op.center.clone().addScaledVector(op.normal, side);
      if (reachedNear(p.x, op.floorY, p.z, 0.4) < 0) bad.push(`${op.label}: side ${side > 0 ? '+' : '−'} not reached upright at ${fmt(p.setY(op.floorY))}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('both ends of every staircase are reached upright', () => {
  const bad: string[] = [];
  for (const s of STAIRS) {
    const r = s.rect;
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    const ends: [number, number, number][] = s.axis === 'x' ? [[r.x0 - 0.3, s.yMin, mz], [r.x1 + 0.3, s.yMax, mz]] : [[mx, s.yMin, r.z0 - 0.3], [mx, s.yMax, r.z1 + 0.3]];
    for (const [x, y, z] of ends) if (reachedNear(x, y, z, 0.6, 0.3) < 0) bad.push(`${s.id} end ${fmt([x, y, z])}`);
  }
  assert.deepEqual(bad, []);
});

test('every bot nav node stands on reachable floor and every nav edge is a real walkway', () => {
  const bad: string[] = [];
  const surf = new Map<number, number>();
  for (const n of nav.nodes) {
    if (!inArea(n.pos)) continue; // the far edge of the coarse outdoor grid
    const s = reachedNear(n.pos.x, n.pos.y, n.pos.z, 0.2, 0.3);
    if (s < 0) bad.push(`node ${n.id} (${n.kind} ${n.room ?? ''}) at ${fmt(n.pos)} is not on upright-reachable floor`);
    else surf.set(n.id, s);
  }
  for (const n of nav.nodes) {
    for (const e of n.edges) {
      if (e.to < n.id || e.panel !== undefined) continue; // breach edges open only once a wall is blown
      const a = surf.get(n.id);
      const b = surf.get(e.to);
      if (a === undefined || b === undefined) continue;
      const m = nav.nodes[e.to];
      const straight = Math.hypot(n.pos.x - m.pos.x, n.pos.z - m.pos.z) / grid.cell;
      if (gridDistance(grid, a, b, Math.ceil(straight * 1.6 + 12)) < 0) bad.push(`edge ${n.id}→${e.to} (${n.room ?? n.kind} → ${m.room ?? m.kind}) ${fmt(n.pos)} → ${fmt(m.pos)} has no walkway`);
    }
  }
  assert.deepEqual(bad, []);
});

test('bots can route over the nav graph from every spawn to every room (A*, no barricades)', () => {
  const bad: string[] = [];
  for (const z of SPAWN_ZONES) {
    const from = new THREE.Vector3(...z.center);
    for (const r of ROOMS) {
      const to = new THREE.Vector3(r.spot[0], FLOOR_Y[r.floor], r.spot[1]);
      const p = nav.path(from, to);
      if (!p) { bad.push(`${z.id} → ${r.id}: no nav path`); continue; }
      // the route's last waypoint must be a straight walk from the goal (path() appends the goal itself)
      const last = p[p.length - 2] ?? p[0];
      if (!nav.canWalk(last, to)) bad.push(`${z.id} → ${r.id}: last waypoint ${fmt(last)} cannot walk to the goal`);
    }
  }
  // and the graph is one piece: every room / door / stair node is reachable from the first spawn
  const seen = new Set<number>();
  const start = nav.nearest(new THREE.Vector3(...SPAWN_ZONES[0].center))!;
  const stack = [start.id];
  seen.add(start.id);
  while (stack.length) for (const e of nav.nodes[stack.pop()!].edges) if (e.panel === undefined && !seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  for (const n of nav.nodes) if (n.kind !== 'breach' && inArea(n.pos) && !seen.has(n.id)) bad.push(`node ${n.id} (${n.kind} ${n.room ?? ''}) at ${fmt(n.pos)} is cut off from the nav graph`);
  assert.deepEqual(bad, []);
});

test('every room has bot spawn spots and every doorway is a nav edge', () => {
  const bad: string[] = [];
  for (const r of ROOMS) if (!nav.nodes.some((n) => n.room === r.id && n.kind === 'room')) bad.push(`${r.id}: no room nodes (bots can neither spawn nor patrol there)`);
  const linked = new Set(nav.nodes.flatMap((n) => n.edges.flatMap((e) => (e.opening === undefined ? [] : [e.opening]))));
  for (const op of house.openings) if (['door', 'exterior_door', 'arch', 'french'].includes(op.kind) && !linked.has(op.id)) bad.push(`${op.label}: no nav edge through it`);
  // bots spawn only where the body also clears low steps: every room keeps some of those
  for (const r of ROOMS) if (!r.transit && !nav.spawnSpots([r.id], 1).length) bad.push(`${r.id}: no spawn spot clears the body`);
  assert.deepEqual(bad, []);
});

test('crawl-only areas are real (prone / crouch reach somewhere upright cannot)', () => {
  // sanity of the stance model itself: crouching and going prone never lose ground
  let only = 0;
  for (let s = 0; s < grid.fit.length; s++) {
    if ((upright.bits[s] & 1) && !anyStance.bits[s]) assert.fail(`surface ${s} reached upright but not with stance changes`);
    if (anyStance.bits[s] && !(upright.bits[s] & 1)) only++;
  }
  assert.ok(only > 0, 'some places (under tables, vents) need crouching or prone');
});

export { grid, upright, anyStance, MAX_LAYERS };
