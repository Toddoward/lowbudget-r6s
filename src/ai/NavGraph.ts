import * as THREE from 'three';
import { G_CLIP, G_WORLD, type Physics } from '../core/Physics.ts';
import { FLOOR_Y, HOUSE_RECT, LANDINGS, ROOMS, SPAWN_ZONES, STAIRS } from '../map/houseLayout.ts';
import { bodyFree, buildWalkGrid, lineWalk, MAX_LAYERS, nearestFit, reachedUpright, surfaceAt, surfacePos, type WalkGrid } from '../map/walkGrid.ts';
import type { Opening } from '../map/MapBuilder.ts';
import type { DestructionSystem, Panel } from '../world/Destruction.ts';

export interface NavNode {
  id: number;
  pos: THREE.Vector3;
  room: string | null;
  kind: 'room' | 'door' | 'stair' | 'ext' | 'breach';
  cover: boolean;
  edges: NavEdge[];
}
export interface NavEdge { to: number; cost: number; opening?: number; panel?: number }

/** where the fine (0.1 m) clearance grid is built: the House and its yard */
export const NAV_FINE_AREA = { x0: HOUSE_RECT.x0 - 3, z0: HOUSE_RECT.z0 - 3, x1: HOUSE_RECT.x1 + 3, z1: HOUSE_RECT.z1 + 3 };
/** the coarse (0.3 m) grid covers the whole playable outdoors */
export const NAV_COARSE_AREA = { x0: -50, z0: -50, x1: 50, z1: 50 };
const PASS_KINDS = new Set(['door', 'exterior_door', 'arch', 'french']);

/**
 * Waypoint graph for bots (and the built-in WebMCP agent's planner — this is
 * static map knowledge every human player has), built on the same clearance
 * grid the walk tests use (src/map/walkGrid.ts), so every node is a spot an
 * upright character can stand on and every edge is a straight line it can
 * walk without touching furniture:
 *  - room nodes: 0.9 m lattice inside every room, snapped to reachable floor
 *  - door nodes: both sides of every doorway/arch (blocked while barricaded)
 *  - stair nodes: along every flight and landing
 *  - exterior: 1.25 m lattice in the yard, 2.5 m beyond it, spawn zones
 *  - breach edges through soft wall panels, enabled only once the panel has a
 *    body-sized hole (Panel.passable) → bots path through fresh breaches
 * Nodes no spawn can walk to (sealed pockets behind furniture, under stairs)
 * are dropped, so nothing ever spawns or patrols there.
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private openings: Opening[] = [];
  /** fine grid (House + yard) and coarse grid (outdoors), standing body only */
  fine: WalkGrid | null = null;
  coarse: WalkGrid | null = null;
  private fineReached: Uint8Array | null = null;
  private coarseReached: Uint8Array | null = null;

  constructor(private physics: Physics, private destruction: DestructionSystem) {}

  build(openings: Opening[], wallPanels: Panel[]) {
    this.openings = openings;
    this.nodes = [];
    const ph = this.physics;
    const fine = (this.fine = buildWalkGrid(ph, NAV_FINE_AREA, 0.1, { yMax: 6, standOnly: true }));
    // (the coarse grid leaves out the House itself: the fine grid covers it and every link near it)
    const coarse = (this.coarse = buildWalkGrid(ph, NAV_COARSE_AREA, 0.4, { yMax: 6, standOnly: true, skip: { x0: HOUSE_RECT.x0 + 0.5, z0: HOUSE_RECT.z0 + 0.5, x1: HOUSE_RECT.x1 - 0.5, z1: HOUSE_RECT.z1 - 0.5 } }));
    // outdoors: everything walkable from the attacker spawns
    this.coarseReached = reachedUpright(coarse, SPAWN_ZONES.map((z) => nearestFit(coarse, z.center[0], z.center[1], z.center[2], 'stand', 2, 1.5)));
    // House + yard: everything walkable from the yard at the fine grid's border
    const border: number[] = [];
    for (let iz = 0; iz < fine.nz; iz++) {
      for (let ix = 0; ix < fine.nx; ix++) {
        if (ix > 0 && iz > 0 && ix < fine.nx - 1 && iz < fine.nz - 1) continue;
        const c = iz * fine.nx + ix;
        for (let k = 0; k < fine.n[c]; k++) { const sf = c * MAX_LAYERS + k; if (fine.y[sf] < 1 && fine.fit[sf] & 1) border.push(sf); }
      }
    }
    this.fineReached = reachedUpright(fine, border);
    const fr = this.fineReached;
    const cr = this.coarseReached;
    const B = 4;
    const buckets = new Map<string, NavNode[]>();
    const key = (x: number, z: number) => `${Math.floor(x / B)},${Math.floor(z / B)}`;
    const add = (p: THREE.Vector3, room: string | null, kind: NavNode['kind']): NavNode => {
      const n: NavNode = { id: this.nodes.length, pos: p.clone(), room, kind, cover: false, edges: [] };
      this.nodes.push(n);
      const k = key(p.x, p.z);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(n);
      return n;
    };
    const around = function* (p: THREE.Vector3) {
      const bx = Math.floor(p.x / B);
      const bz = Math.floor(p.z / B);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) yield* buckets.get(`${bx + i},${bz + j}`) ?? [];
    };
    /** a reached standing spot of the fine grid within r of (x, y±tol, z) */
    const spot = (x: number, y: number, z: number, r = 0.3, tol = 0.12): THREE.Vector3 | null => {
      let best = -1;
      let bd = Infinity;
      const n = Math.ceil(r / fine.cell);
      for (let dz = -n; dz <= n; dz++) {
        for (let dx = -n; dx <= n; dx++) {
          const sf = surfaceAt(fine, x + dx * fine.cell, y, z + dz * fine.cell, tol);
          if (sf < 0 || !fr[sf]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = sf; }
        }
      }
      if (best < 0) return null;
      const [px, py, pz] = surfacePos(fine, best);
      return new THREE.Vector3(px, py + 0.02, pz);
    };
    const taken = (p: THREE.Vector3, d: number) => { for (const n of around(p)) if (Math.abs(n.pos.y - p.y) < 0.5 && n.pos.distanceToSquared(p) < d * d) return true; return false; };
    // rooms: 0.9 m lattice on reachable floor
    for (const room of ROOMS) {
      const y = FLOOR_Y[room.floor];
      for (const r of room.rects) {
        for (let x = r.x0 + 0.45; x < r.x1; x += 0.9) {
          for (let z = r.z0 + 0.45; z < r.z1; z += 0.9) {
            const p = spot(x, y, z, 0.35);
            if (p && !taken(p, 0.45)) add(p, room.id, 'room');
          }
        }
      }
    }
    // doors: one node either side of every walk-through opening, linked through it
    for (const op of openings) {
      if (!PASS_KINDS.has(op.kind)) continue;
      const n = op.normal;
      // (exterior doors and French windows step down to the yard: allow a step either side)
      const a = spot(op.center.x - n.x * 0.6, op.floorY, op.center.z - n.z * 0.6, 0.35, 0.35);
      const b = spot(op.center.x + n.x * 0.6, op.floorY, op.center.z + n.z * 0.6, 0.35, 0.35);
      if (!a || !b) continue;
      const na = add(a, op.rooms[0], 'door');
      const nb = add(b, op.rooms[1], 'door');
      if (lineWalk(fine, na.pos, nb.pos)) this.link(na, nb, op.id);
    }
    // stairs: nodes along each flight's centre line (and its landings), plus both feet
    for (const s of STAIRS) {
      const r = s.rect;
      const len = s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let u = -0.4; u <= len + 0.4 + 1e-6; u += 0.7) {
        const t = THREE.MathUtils.clamp(u / len, 0, 1);
        const y = s.yMin + (s.yMax - s.yMin) * t;
        const x = s.axis === 'x' ? r.x0 + u : (r.x0 + r.x1) / 2;
        const z = s.axis === 'x' ? (r.z0 + r.z1) / 2 : r.z0 + u;
        const p = s.exterior ? coarseSpot(coarse, cr, x, y, z) : spot(x, y, z, 0.3, 0.3);
        if (p && !taken(p, 0.35)) add(p, null, 'stair');
      }
    }
    for (const l of LANDINGS) {
      const p = spot((l.rect.x0 + l.rect.x1) / 2, l.y, (l.rect.z0 + l.rect.z1) / 2, 0.45, 0.15);
      if (p && !taken(p, 0.35)) add(p, null, 'stair');
    }
    // yard (fine grid, everywhere walkable that is not a room: yard, porches, stairwells) and outdoors (coarse grid)
    const inRoom = (x: number, y: number, z: number) => ROOMS.some((r) => Math.abs(FLOOR_Y[r.floor] - y) < 0.4 && r.rects.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1));
    for (let x = NAV_FINE_AREA.x0 + 0.4; x < NAV_FINE_AREA.x1; x += 1.25) {
      for (let z = NAV_FINE_AREA.z0 + 0.4; z < NAV_FINE_AREA.z1; z += 1.25) {
        for (const y of groundLevels(fine, fr, x, z)) {
          if (inRoom(x, y, z)) continue;
          const p = spot(x, y, z, 0.4, 0.2);
          if (p && !taken(p, 0.6)) add(p, null, 'ext');
        }
      }
    }
    for (let x = NAV_COARSE_AREA.x0 + 1; x < NAV_COARSE_AREA.x1; x += 2.5) {
      for (let z = NAV_COARSE_AREA.z0 + 1; z < NAV_COARSE_AREA.z1; z += 2.5) {
        if (inFine(x, z, 0.6)) continue;
        for (const y of groundLevels(coarse, cr, x, z)) { const p = coarseSpot(coarse, cr, x, y, z); if (p && !taken(p, 1.0)) add(p, null, 'ext'); }
      }
    }
    for (const zone of SPAWN_ZONES) {
      const p = coarseSpot(coarse, cr, zone.center[0], zone.center[1], zone.center[2], 2, 1.5);
      if (p && !taken(p, 0.8)) add(p, null, 'ext');
    }
    // breach edges through soft walls separating two places (feet on the floor at the wall's base)
    for (const p of wallPanels) {
      if (p.kind !== 'wall_soft' || p.size(1) < 2.0) continue;
      const n = new THREE.Vector3();
      n.setComponent(p.nAx, 1);
      const c = p.center;
      const a = spot(c.x - n.x * 0.6, p.min.y, c.z - n.z * 0.6, 0.3, 0.15);
      const b = spot(c.x + n.x * 0.6, p.min.y, c.z + n.z * 0.6, 0.3, 0.15);
      if (!a || !b) continue;
      const na = add(a, p.rooms[0], 'breach');
      const nb = add(b, p.rooms[1], 'breach');
      na.edges.push({ to: nb.id, cost: 1.2, panel: p.id });
      nb.edges.push({ to: na.id, cost: 1.2, panel: p.id });
    }
    // proximity links: a straight walk on the grid that covers both ends
    for (const a of this.nodes) {
      for (const b of around(a.pos)) {
        if (b.id <= a.id || a.edges.some((e) => e.to === b.id)) continue;
        const fineBoth = inFine(a.pos.x, a.pos.z, 0.2) && inFine(b.pos.x, b.pos.z, 0.2);
        const both = (a.kind === 'ext' ? 1 : 0) + (b.kind === 'ext' ? 1 : 0);
        const maxD = !fineBoth ? 3.8 : both === 2 ? 1.9 : both === 1 ? 1.6 : 1.35;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > maxD || Math.abs(a.pos.y - b.pos.y) > maxD) continue;
        if (!lineWalk(fineBoth ? fine : coarse, a.pos, b.pos)) continue;
        this.link(a, b, this.crossedOpening(a.pos, b.pos));
      }
    }
    this.dropUnreachable();
    // cover flags (low/full cover within 0.9 m)
    for (const n of this.nodes) {
      if (n.kind === 'ext') continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        if (ph.raycast(n.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), dir, 0.95, G_WORLD)) { n.cover = true; break; }
      }
    }
  }

  /** keep only nodes connected (without breaches) to a spawn zone; renumber */
  private dropUnreachable() {
    const seen = new Uint8Array(this.nodes.length);
    const stack: number[] = [];
    for (const z of SPAWN_ZONES) {
      const n = this.nearest(new THREE.Vector3(...z.center), (m) => m.kind === 'ext');
      if (n && !seen[n.id]) { seen[n.id] = 1; stack.push(n.id); }
    }
    while (stack.length) for (const e of this.nodes[stack.pop()!].edges) if (!seen[e.to]) { seen[e.to] = 1; stack.push(e.to); }
    const map = new Int32Array(this.nodes.length).fill(-1);
    const kept = this.nodes.filter((n) => seen[n.id]);
    kept.forEach((n, i) => (map[n.id] = i));
    for (const n of kept) { n.id = map[n.id]; n.edges = n.edges.filter((e) => map[e.to] >= 0).map((e) => ({ ...e, to: map[e.to] })); }
    this.nodes = kept;
  }

  /** the walk-through opening a straight segment passes, if any (for barricade checks) */
  private crossedOpening(a: THREE.Vector3, b: THREE.Vector3): number | undefined {
    for (const op of this.openings) {
      if (!PASS_KINDS.has(op.kind) || op.run === 'd') continue;
      const ax = op.run === 'x' ? 'z' : 'x';
      const ux = op.run === 'x' ? 'x' : 'z';
      const da = a[ax] - op.c;
      const db = b[ax] - op.c;
      if (Math.sign(da) === Math.sign(db) || Math.abs(a.y - op.floorY) > 1) continue;
      const t = da / (da - db);
      const u = a[ux] + (b[ux] - a[ux]) * t;
      if (Math.abs(u - op.center[ux]) <= op.w / 2) return op.id;
    }
    return undefined;
  }

  private link(a: NavNode, b: NavNode, opening?: number) {
    const cost = a.pos.distanceTo(b.pos);
    a.edges.push({ to: b.id, cost, opening });
    b.edges.push({ to: a.id, cost, opening });
  }

  /** straight walk on the clearance grid (falls back to raycasts before build) */
  canWalk(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (this.fine && inFine(a.x, a.z, 0.2) && inFine(b.x, b.z, 0.2)) return lineWalk(this.fine, a, b);
    if (this.coarse) return lineWalk(this.coarse, a, b);
    return this.walkable(a, b);
  }

  walkable(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const h of [0.35, 1.2]) {
      const pa = a.clone().add(new THREE.Vector3(0, h, 0));
      const pb = b.clone().add(new THREE.Vector3(0, h, 0));
      const d = pb.clone().sub(pa);
      const len = d.length();
      if (len < 0.01) continue;
      d.normalize();
      // widen: centre + both shoulders
      const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(0.22);
      for (const off of [0, 1, -1]) {
        if (this.physics.raycast(pa.clone().addScaledVector(side, off), d, len, G_WORLD | G_CLIP)) return false;
      }
    }
    return true;
  }

  private crossesBarricade(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const op of this.openings) {
      if (op.barricadePanel === null) continue;
      const ca = a.clone().sub(op.center).dot(op.normal);
      const cb = b.clone().sub(op.center).dot(op.normal);
      if (Math.sign(ca) !== Math.sign(cb) && Math.abs(op.center.y - (a.y + 1)) < 2 && a.distanceTo(op.center) < 4) return true;
    }
    return false;
  }

  edgeOpen(e: NavEdge, allowBarricades = false): boolean {
    if (e.opening !== undefined) {
      const op = this.openings[e.opening];
      if (op && op.barricadePanel !== null && !(allowBarricades && op.barricadeKind === 'wood')) return false;
    }
    if (e.panel !== undefined) {
      const p = this.destruction.get(e.panel);
      return !!p && p.passable;
    }
    return true;
  }

  nearest(p: THREE.Vector3, filter?: (n: NavNode) => boolean): NavNode | null {
    let best: NavNode | null = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const dy = Math.abs(n.pos.y - p.y) * 3;
      const d = n.pos.distanceToSquared(p) + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** the node to start from / end at for a point: the nearest one it can walk straight to (not the one behind the wall) */
  entry(p: THREE.Vector3): NavNode | null {
    const near = this.nodes
      .map((n) => ({ n, d: n.pos.distanceToSquared(p) + (Math.abs(n.pos.y - p.y) * 3) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
    for (const { n } of near) if (n.pos.distanceTo(p) < 0.15 || this.canWalk(p, n.pos)) return n;
    return near[0]?.n ?? null;
  }

  /** A* → list of node positions (smoothed). allowBarricades: route through wooden barricades (the caller melees them). */
  path(from: THREE.Vector3, to: THREE.Vector3, allowBarricades = false): THREE.Vector3[] | null {
    const s = this.entry(from);
    const t = this.entry(to);
    if (!s || !t) return null;
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const f = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open: number[] = [s.id];
    g[s.id] = 0;
    f[s.id] = s.pos.distanceTo(t.pos);
    let iter = 0;
    while (open.length && iter++ < 12000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === t.id) break;
      closed[cur] = 1;
      for (const e of this.nodes[cur].edges) {
        if (closed[e.to] || !this.edgeOpen(e, allowBarricades)) continue;
        const barricaded = e.opening !== undefined && this.openings[e.opening]?.barricadePanel != null;
        const ng = g[cur] + e.cost + (barricaded ? 6 : 0);
        if (ng < g[e.to]) {
          g[e.to] = ng;
          f[e.to] = ng + this.nodes[e.to].pos.distanceTo(t.pos);
          came[e.to] = cur;
          if (!open.includes(e.to)) open.push(e.to);
        }
      }
    }
    if (came[t.id] === -1 && s.id !== t.id) return null;
    const ids: number[] = [];
    for (let c = t.id; c !== -1; c = came[c]) ids.unshift(c);
    const pts = ids.map((i) => this.nodes[i].pos.clone());
    pts.push(to.clone());
    // string-pull smoothing on the same level
    const out: THREE.Vector3[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 12);
      while (j > i + 1 && !(Math.abs(pts[j].y - pts[i].y) < 0.3 && this.canWalk(pts[i], pts[j]) && !this.crossesBarricade(pts[i], pts[j]))) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** an upright character standing at p touches nothing solid (the walk grid's body, from just above the floor) */
  capsuleFree(p: THREE.Vector3): boolean {
    return bodyFree(this.physics, p.x, p.y, p.z);
  }

  /**
   * n distinct, free standing spots in these rooms (≥ minSep from each other and
   * from `avoid`), each re-checked against the live physics world.
   */
  spawnSpots(rooms: string[], n: number, rand = Math.random, avoid: THREE.Vector3[] = [], minSep = 1.2): THREE.Vector3[] {
    const ext = rooms.includes('__ext');
    const pool = this.nodes.filter((nd) => (nd.room && rooms.includes(nd.room) && nd.kind === 'room') || (ext && nd.kind === 'ext' && Math.abs(nd.pos.x) < 16 && Math.abs(nd.pos.z) < 15));
    const out: THREE.Vector3[] = [];
    const taken = [...avoid];
    // shuffle (deterministic with the given rand)
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const nd of pool) {
      if (out.length >= n) break;
      if (taken.some((t) => t.distanceTo(nd.pos) < minSep)) continue;
      if (!this.capsuleFree(nd.pos)) continue;
      out.push(nd.pos.clone());
      taken.push(nd.pos);
    }
    return out;
  }

  randomNodeIn(rooms: string[], rand = Math.random): NavNode | null {
    const ext = rooms.includes('__ext');
    const c = this.nodes.filter((n) => (n.room && rooms.includes(n.room) && n.kind === 'room') || (ext && n.kind === 'ext' && Math.abs(n.pos.x) < 16 && Math.abs(n.pos.z) < 15));
    return c.length ? c[Math.floor(rand() * c.length)] : null;
  }
}

const inFine = (x: number, z: number, m: number) => x > NAV_FINE_AREA.x0 + m && x < NAV_FINE_AREA.x1 - m && z > NAV_FINE_AREA.z0 + m && z < NAV_FINE_AREA.z1 - m;

/** heights of the reached standing surfaces in the column at (x, z), lowest first */
function groundLevels(g: WalkGrid, reached: Uint8Array, x: number, z: number): number[] {
  const ix = Math.round((x - g.x0) / g.cell);
  const iz = Math.round((z - g.z0) / g.cell);
  if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) return [];
  const c = iz * g.nx + ix;
  const out: number[] = [];
  for (let k = g.n[c] - 1; k >= 0; k--) { const s = c * MAX_LAYERS + k; if (reached[s]) out.push(g.y[s]); }
  return out;
}

/** a reached standing spot of the coarse grid near (x, y, z) */
function coarseSpot(g: WalkGrid, reached: Uint8Array, x: number, y: number, z: number, r = 0.6, tol = 0.35): THREE.Vector3 | null {
  let best = -1;
  let bd = Infinity;
  const n = Math.ceil(r / g.cell);
  for (let dz = -n; dz <= n; dz++) {
    for (let dx = -n; dx <= n; dx++) {
      const s = surfaceAt(g, x + dx * g.cell, y, z + dz * g.cell, tol);
      if (s < 0 || !reached[s]) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
  }
  if (best < 0) return null;
  const [px, py, pz] = surfacePos(g, best);
  return new THREE.Vector3(px, py + 0.02, pz);
}
