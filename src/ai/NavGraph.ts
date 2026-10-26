import * as THREE from 'three';
import { G_CLIP, G_WORLD, type Physics } from '../core/Physics.ts';
import { FLOOR_Y, ROOMS, SPAWN_ZONES, STAIRS, GROUND_Y, LOWER_GROUND_Y } from '../map/houseLayout.ts';
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

/**
 * Waypoint graph for bots (and the built-in WebMCP agent's planner — this is
 * static map knowledge every human player has).
 *  - room nodes: 1.25 m grid inside every room, validated by raycasts
 *  - door nodes: both sides of every doorway/arch (blocked while barricaded)
 *  - stair nodes: bottom / mid / top of every staircase
 *  - exterior ring + spawn zones
 *  - breach edges through soft wall panels, enabled only once the panel has a
 *    body-sized hole (Panel.passable) → bots path through fresh breaches
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private openings: Opening[] = [];

  constructor(private physics: Physics, private destruction: DestructionSystem) {}

  build(openings: Opening[], wallPanels: Panel[]) {
    this.openings = openings;
    const ph = this.physics;
    const add = (p: THREE.Vector3, room: string | null, kind: NavNode['kind']): NavNode => {
      const n: NavNode = { id: this.nodes.length, pos: p.clone(), room, kind, cover: false, edges: [] };
      this.nodes.push(n);
      return n;
    };
    const free = (p: THREE.Vector3) => !ph.overlapsWorld(p.clone().add(new THREE.Vector3(0, 0.55, 0)), 0.3) && !ph.overlapsWorld(p.clone().add(new THREE.Vector3(0, 1.3, 0)), 0.3);
    const snap = (p: THREE.Vector3): THREE.Vector3 | null => {
      const hit = ph.raycast(p.clone().add(new THREE.Vector3(0, 0.9, 0)), new THREE.Vector3(0, -1, 0), 1.6, G_WORLD);
      if (!hit || hit.normal.y < 0.7) return null;
      return hit.point.clone().add(new THREE.Vector3(0, 0.02, 0));
    };
    // rooms
    for (const room of ROOMS) {
      const y = FLOOR_Y[room.floor];
      for (const r of room.rects) {
        for (let x = r.x0 + 0.55; x <= r.x1 - 0.5; x += 1.25) {
          for (let z = r.z0 + 0.55; z <= r.z1 - 0.5; z += 1.25) {
            const s = snap(new THREE.Vector3(x, y, z));
            if (!s || Math.abs(s.y - y) > 0.3 || !free(s)) continue;
            add(s, room.id, 'room');
          }
        }
      }
    }
    // doors
    for (const op of openings) {
      if (op.kind === 'window' || op.kind === 'open_window' || op.kind === 'shutter') continue;
      const n = op.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const a = snap(op.center.clone().addScaledVector(n, -0.6).setY(op.floorY));
      const b = snap(op.center.clone().addScaledVector(n, 0.6).setY(op.floorY));
      if (!a || !b) continue;
      const na = add(a, op.rooms[0], 'door');
      const nb = add(b, op.rooms[1], 'door');
      this.link(na, nb, op.id);
    }
    // stairs
    for (const s of STAIRS) {
      const r = s.rect;
      const mid = new THREE.Vector3((r.x0 + r.x1) / 2, (s.yMin + s.yMax) / 2, (r.z0 + r.z1) / 2);
      const lo = s.axis === 'x' ? new THREE.Vector3(r.x0 - 0.45, s.yMin, mid.z) : new THREE.Vector3(mid.x, s.yMin, r.z0 - 0.45);
      const hi = s.axis === 'x' ? new THREE.Vector3(r.x1 + 0.45, s.yMax, mid.z) : new THREE.Vector3(mid.x, s.yMax, r.z1 + 0.45);
      const sm = snap(mid.clone().add(new THREE.Vector3(0, 0.3, 0)));
      // ends: straight extension first, else step off sideways near that end (stairs against a wall)
      const width = s.axis === 'x' ? r.z1 - r.z0 : r.x1 - r.x0;
      const end = (p: THREE.Vector3, y: number, inward: number) => {
        // the ramp's foot on that end, at floor level
        const foot = p.clone().setY(y);
        if (s.axis === 'x') foot.x += Math.sign(inward) * 0.75; else foot.z += Math.sign(inward) * 0.75;
        const cands = [p.clone().setY(y)];
        const base = p.clone();
        if (s.axis === 'x') base.x += inward; else base.z += inward;
        for (const side of [1, -1]) {
          const q = base.clone();
          if (s.axis === 'x') q.z = mid.z + side * (width / 2 + 0.45); else q.x = mid.x + side * (width / 2 + 0.45);
          cands.push(q.setY(y));
        }
        for (const c of cands) {
          const sn = snap(c);
          if (sn && Math.abs(sn.y - y) < 0.35 && free(sn) && this.walkable(sn, foot)) return sn;
        }
        return null;
      };
      const sLo = end(lo, s.yMin, 0.85);
      const sHi = end(hi, s.yMax, -0.85);
      if (!sm || !sLo || !sHi) continue;
      const nm = add(sm, null, 'stair');
      const nl = add(sLo, null, 'stair');
      const nh = add(sHi, null, 'stair');
      this.link(nl, nm);
      this.link(nm, nh);
    }
    // exterior ring + spawns
    const ring: [number, number, number][] = [];
    for (let x = -12; x <= 6; x += 3) { ring.push([x, GROUND_Y, -10]); ring.push([x, GROUND_Y, 11]); }
    for (let z = -9; z <= 9; z += 3) ring.push([-12.5, GROUND_Y, z]);
    for (let z = -10; z <= 10; z += 2.5) ring.push([11, LOWER_GROUND_Y, z]);
    for (const zone of SPAWN_ZONES) ring.push(zone.center);
    ring.push([-6, GROUND_Y, -20], [-20, GROUND_Y, 0], [0, GROUND_Y, 22], [-20, GROUND_Y, 22], [-20, GROUND_Y, -22], [22, LOWER_GROUND_Y, 0], [14, GROUND_Y - 1.4, -11.5], [14, GROUND_Y - 1.4, 15.5], [4, GROUND_Y, 8.2], [-0.25, GROUND_Y, 8.0], [-14, GROUND_Y, 0], [-11.5, GROUND_Y, 0]);
    // coarse exterior grid so every spawn zone connects to the house (both ground levels)
    for (let x = -49; x <= 49; x += 7) {
      for (let z = -49; z <= 49; z += 7) {
        if (Math.abs(x) < 10 && Math.abs(z) < 9) continue;
        ring.push([x, x > 8 ? LOWER_GROUND_Y : GROUND_Y, z]);
      }
    }
    for (const [x, y, z] of ring) {
      const s = snap(new THREE.Vector3(x, y + 0.6, z));
      if (s && free(s)) add(s, null, 'ext');
    }
    // breach edges through soft walls separating two places
    for (const p of wallPanels) {
      if (p.kind !== 'wall_soft' || p.size(1) < 2.0) continue;
      const n = new THREE.Vector3();
      n.setComponent(p.nAx, 1);
      const c = p.center.setY(p.min.y + 0.02);
      const a = snap(c.clone().addScaledVector(n, -0.6));
      const b = snap(c.clone().addScaledVector(n, 0.6));
      if (!a || !b || !free(a) || !free(b)) continue;
      const na = add(a, p.rooms[0], 'breach');
      const nb = add(b, p.rooms[1], 'breach');
      na.edges.push({ to: nb.id, cost: 1.2, panel: p.id });
      nb.edges.push({ to: na.id, cost: 1.2, panel: p.id });
    }
    // proximity links with line-of-movement checks
    const N = this.nodes.length;
    for (let i = 0; i < N; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = this.nodes[j];
        const ext = (a.kind === 'ext' ? 1 : 0) + (b.kind === 'ext' ? 1 : 0);
        const doorExt = ext === 1 && (a.kind === 'door' || b.kind === 'door' || a.kind === 'stair' || b.kind === 'stair');
        const maxD = ext === 2 ? 10.5 : doorExt ? 6 : 2.7;
        const d = a.pos.distanceTo(b.pos);
        if (d > maxD || Math.abs(a.pos.y - b.pos.y) > (ext === 2 ? 1.2 : 0.6)) continue;
        if (a.edges.some((e) => e.to === b.id)) continue;
        if (this.walkable(a.pos, b.pos)) this.link(a, b);
      }
    }
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

  private link(a: NavNode, b: NavNode, opening?: number) {
    const cost = a.pos.distanceTo(b.pos);
    a.edges.push({ to: b.id, cost, opening });
    b.edges.push({ to: a.id, cost, opening });
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
      const n = op.run === 'x' ? 2 : 0;
      const ca = a.getComponent(n) - op.c;
      const cb = b.getComponent(n) - op.c;
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

  /** A* → list of node positions (smoothed). allowBarricades: route through wooden barricades (the caller melees them). */
  path(from: THREE.Vector3, to: THREE.Vector3, allowBarricades = false): THREE.Vector3[] | null {
    const s = this.nearest(from);
    const t = this.nearest(to);
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
      let j = Math.min(pts.length - 1, i + 6);
      while (j > i + 1 && !(Math.abs(pts[j].y - pts[i].y) < 0.3 && this.walkable(pts[i], pts[j]) && !this.crossesBarricade(pts[i], pts[j]))) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  randomNodeIn(rooms: string[], rand = Math.random): NavNode | null {
    const ext = rooms.includes('__ext');
    const c = this.nodes.filter((n) => (n.room && rooms.includes(n.room) && n.kind === 'room') || (ext && n.kind === 'ext' && Math.abs(n.pos.x) < 16 && Math.abs(n.pos.z) < 15));
    return c.length ? c[Math.floor(rand() * c.length)] : null;
  }
}
