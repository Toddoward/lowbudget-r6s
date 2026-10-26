import * as THREE from 'three';
import { G_CLIP, type Physics, type SurfaceMaterial } from '../core/Physics.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { greedy } from '../world/Destruction.ts';
import { vcMaterial } from '../render/palette.ts';
import { DRIVEWAY, FLOORS, GARAGE_RAMP, LOWER_GROUND_Y, MAP_BOUNDS, NW_STAIRWELL_PIT, ROOF_Y, STAIRS, VENT_SHAFT, type Rect } from './houseLayout.ts';
import { subtractRects } from './geometry.ts';
import { FORM, HOUSE_POLICE_CRUISERS, setActiveDatamap, uToX, vToZ, xToU, zToV, ZONE, type HouseDatamap } from './houseDatamap.ts';

/**
 * Everything outside the House, built from the House datamap (houseDatamap.ts):
 *  - terrain: every datamap pixel's H_ground, merged into boxes per height and
 *    zone; where two walkable zones differ by more than a step (0.36 m) and at
 *    most 1.6 m, the lower side gets stairs (0.17 m risers) along the edge —
 *    the datamap gives levels, the stairs make them walkable
 *  - the House's own below-grade volumes (basement, NW stairwell pit, garage
 *    driveway + ramp, vent shaft) are cut out of the terrain
 *  - forms: scissor lifts, treehouse, gazebo, pergola, APC, sailboats,
 *    container, the SW neighbour house, roof vents, spawn pads, and the 11
 *    police cruisers from HOUSE_POLICE_CRUISERS
 *  - river (water zone) and map edges are player-clipped
 * Every solid thing's collider is built from the same boxes as its mesh, so a
 * bullet stops exactly where something is drawn and nowhere else.
 */
export interface StreetLight { pos: THREE.Vector3; dir?: THREE.Vector3; color: string; kind: 'lamp' | 'police' | 'flood' | 'porch' }
export interface OutdoorWorld { lights: StreetLight[]; policeBars: THREE.Mesh[]; water: THREE.Mesh; windowGlow: THREE.Mesh; map: HouseDatamap }

const N = 512;
const BASE_Y = -6;
const RIVER_BED = -5.0;
const STEP_OK = 0.36;
const STAIR_MAX = 1.6;
const RISER = 0.17;
const UP = new THREE.Vector3(0, 1, 0);

/** the House's below-grade volumes and pits: no terrain there */
export const HOUSE_HOLES: Rect[] = [
  { x0: -7.4, z0: -7.55, x1: -1.55, z1: -4.65 }, // storage
  { x0: -8.1, z0: -4.95, x1: 7.35, z1: -0.45 },
  { x0: -8.1, z0: -0.75, x1: 9.85, z1: 0.7 },
  { x0: -8.8, z0: 0.4, x1: 9.85, z1: 3.85 }, // (the B side stairs reach out to x −8.65 only south of z 0.55)
  { x0: -9.6, z0: 1.0, x1: -8.5, z1: 3.4 }, // bay
  { x0: -5.6, z0: 3.55, x1: 9.85, z1: 5.0 },
  { x0: -5.6, z0: 4.7, x1: 2.2, z1: 6.6 }, // back hallway (under the back deck)
  NW_STAIRWELL_PIT,
  STAIRS.find((s) => s.id === 'stairs_storage_ext')!.rect,
  DRIVEWAY,
  { x0: GARAGE_RAMP.x0, z0: GARAGE_RAMP.z0, x1: GARAGE_RAMP.x1, z1: GARAGE_RAMP.z1 },
  VENT_SHAFT,
];

const inR = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
/** the House's ground-floor slabs and decks (+ wall thickness): the terrain stays under them */
const UNDER_FLOORS: Rect[] = FLOORS.filter((f) => f.y === 0).map((f) => ({ x0: f.rect.x0 - 0.2, z0: f.rect.z0 - 0.2, x1: f.rect.x1 + 0.2, z1: f.rect.z1 + 0.2 }));

/** zone → ground colour (top) */
function zoneColor(zone: number, h: number): string {
  switch (zone) {
    case ZONE.construction: return h < -1.6 ? '#6c5c45' : '#7d6c53';
    case ZONE.water: return '#24332f';
    case ZONE.docks: return '#6b5236';
    case ZONE.apc: return '#35373a';
    case ZONE.frontYard: return h < -0.5 ? '#9a978f' : '#5a6a3b';
    case ZONE.treehouseAlley: return '#53613a';
    case ZONE.backPatio: return '#8c877c';
    case ZONE.house: case ZONE.porchRoof: return '#5a6a3b';
    default: return '#3a3b3e'; // asphalt: roads, side street, under the neighbour house
  }
}

/** a group of boxes (and upright cylinders) in object space, placed once with a yaw */
class Kit {
  private parts: { min: number[]; max: number[]; c: THREE.Color; solid: boolean; mat: SurfaceMaterial }[] = [];
  private cyls: { x: number; z: number; y0: number; y1: number; r: number; c: THREE.Color; solid: boolean; mat: SurfaceMaterial; seg: number }[] = [];
  constructor(private mat: SurfaceMaterial = 'concrete') {}
  box(min: number[], max: number[], c: string, solid = true, mat = this.mat) { this.parts.push({ min, max, c: new THREE.Color(c), solid, mat }); return this; }
  cyl(x: number, z: number, y0: number, y1: number, r: number, c: string, solid = true, mat = this.mat, seg = 8) { this.cyls.push({ x, z, y0, y1, r, c: new THREE.Color(c), solid, mat, seg }); return this; }
  place(batch: BoxBatch, physics: Physics, x: number, y: number, z: number, yaw = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
    for (const p of this.parts) {
      const s = [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]];
      const c = at((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2);
      batch.tbox(new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)), s[0], s[1], s[2], p.c);
      // decals (stripes, lenses, handles) ride on the box under them
      if (p.solid && Math.min(...s) >= 0.025) physics.addBox(c.x, c.y, c.z, s[0] / 2, s[1] / 2, s[2] / 2, { kind: 'static', mat: p.mat, exterior: true }, q);
    }
    for (const k of this.cyls) {
      const c = at(k.x, (k.y0 + k.y1) / 2, k.z);
      batch.geom(new THREE.CylinderGeometry(k.r, k.r, k.y1 - k.y0, k.seg), new THREE.Matrix4().makeTranslation(c.x, c.y, c.z), k.c);
      if (k.solid) physics.addCylinder(c.x, c.y, c.z, (k.y1 - k.y0) / 2, k.r, { kind: 'static', mat: k.mat, exterior: true });
    }
  }
}

export function buildOutdoor(physics: Physics, scene: THREE.Scene, map: HouseDatamap): OutdoorWorld {
  setActiveDatamap(map);
  const b = new BoxBatch();
  const glow = new BoxBatch();
  const lights: StreetLight[] = [];
  const policeBars: THREE.Mesh[] = [];
  const solid = (min: number[], max: number[], c: string, mat: SurfaceMaterial = 'concrete') => {
    const col = new THREE.Color(c);
    b.box(min, max, col, col.clone().multiplyScalar(0.72), 1);
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat, exterior: true });
  };
  const deco = (min: number[], max: number[], c: string) => b.box(min, max, new THREE.Color(c));
  const clip = (min: number[], max: number[]) =>
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat: 'metal' }, undefined, G_CLIP);

  /* ------------------------------------------------------------- read the datamap */
  const H = new Float32Array(N * N);
  const HU = new Float32Array(N * N);
  const Z = new Uint8Array(N * N);
  const F = new Uint8Array(N * N);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const s = map.sample(u, v);
      const i = v * N + u;
      H[i] = Math.round(s.hGround * 100) / 100;
      HU[i] = s.hUpper;
      Z[i] = s.zoneId;
      F[i] = s.formId;
    }
  }
  // close slivers: road-level strips under 2 m wide between two higher zones (levels within 0.6 m of each
  // other) are seams between the datamap's House outline and the yards around it: they take the lower side's level
  {
    const GAP = 15;
    const fill = (i: number, j: number) => { H[i] = H[j]; Z[i] = Z[j]; };
    for (let pass = 0; pass < 2; pass++) {
      for (let v = 0; v < N; v++) {
        for (let u = 0; u < N; u++) {
          const i = v * N + u;
          if (Z[i] !== ZONE.road) continue;
          for (const [du, dv] of pass ? [[0, 1]] : [[1, 0]]) {
            let a = -1;
            let b = -1;
            for (let k = 1; k <= GAP && a < 0; k++) { const uu = u - du * k, vv = v - dv * k; if (uu < 0 || vv < 0) break; const j = vv * N + uu; if (Z[j] !== ZONE.road) a = j; }
            for (let k = 1; k <= GAP && b < 0; k++) { const uu = u + du * k, vv = v + dv * k; if (uu >= N || vv >= N) break; const j = vv * N + uu; if (Z[j] !== ZONE.road) b = j; }
            if (a < 0 || b < 0 || Z[a] === ZONE.water || Z[b] === ZONE.water) continue;
            const ua = a % N, va = (a / N) | 0, ub = b % N, vb = (b / N) | 0;
            if (Math.abs(ua - ub) + Math.abs(va - vb) > GAP + 1) continue;
            const lower = H[a] <= H[b] ? a : b;
            if (Math.abs(H[a] - H[b]) <= 0.6 && H[lower] > H[i] + STEP_OK) fill(i, lower);
          }
        }
      }
    }
  }
  /** pixel centre in world space */
  const px = (u: number) => uToX(u + 0.5);
  const pz = (v: number) => vToZ(v + 0.5);
  const cut = new Uint8Array(N * N); // under the House / in a House pit
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const i = v * N + u;
      const x = px(u);
      const z = pz(v);
      if (HOUSE_HOLES.some((r) => inR(r, x, z))) cut[i] = 1;
      if (Z[i] === ZONE.water) H[i] = RIVER_BED;
      // under the House's 1F floors and decks: below the slab (the House brings its own floors)
      else if (UNDER_FLOORS.some((r) => inR(r, x, z))) H[i] = Math.min(H[i], -0.3);
    }
  }

  /* ------------------------------------------------------------- stairs between levels */
  const stepable = (i: number) => !cut[i] && Z[i] !== ZONE.water && Z[i] !== ZONE.garageRamp && Z[i] !== ZONE.nwStairs && !UNDER_FLOORS.some((r) => inR(r, px(i % N), pz((i / N) | 0)));
  const stair = new Float32Array(N * N).fill(-Infinity);
  /** the walking surface over the stairs: one even slope through the flight (no step edges for feet or drone wheels) */
  const smooth = new Float32Array(N * N).fill(-Infinity);
  {
    // every pixel next to a higher walkable pixel (a step to 1.6 m higher) starts a flight going down into its own level
    type Q = { i: number; hs: number; d: number };
    const queue: Q[] = [];
    for (let v = 0; v < N; v++) {
      for (let u = 0; u < N; u++) {
        const i = v * N + u;
        if (!stepable(i)) continue;
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const uu = u + du;
          const vv = v + dv;
          if (uu < 0 || vv < 0 || uu >= N || vv >= N) continue;
          const j = vv * N + uu;
          if (!stepable(j)) continue;
          const d = H[j] - H[i];
          if (d > STEP_OK && d <= STAIR_MAX) queue.push({ i, hs: H[j], d: 1 });
        }
      }
    }
    // treads two pixels (0.27 m) deep, risers 0.17 m: h = hs − RISER · ceil(d / 2)
    while (queue.length) {
      const { i, hs, d } = queue.pop()!;
      const h = hs - RISER * Math.ceil(d / 2);
      if (h <= H[i] + 1e-3 || h <= stair[i] + 1e-3) continue;
      stair[i] = h;
      smooth[i] = Math.max(smooth[i], Math.max(H[i], hs - (RISER * d) / 2));
      const u = i % N;
      const v = (i / N) | 0;
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const uu = u + du;
        const vv = v + dv;
        if (uu < 0 || vv < 0 || uu >= N || vv >= N) continue;
        const j = vv * N + uu;
        if (stepable(j) && H[j] < h) queue.push({ i: j, hs, d: d + 1 });
      }
    }
  }
  const G = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) G[i] = Math.max(H[i], stair[i]);

  /* ------------------------------------------------------------- terrain boxes */
  {
    const keys = new Map<string, number[]>();
    for (let i = 0; i < N * N; i++) {
      if (Z[i] === ZONE.garageRamp || Z[i] === ZONE.nwStairs) continue; // built below / by the House
      const isStair = stair[i] > H[i];
      const k = `${G[i].toFixed(2)}|${isStair ? 's' : Z[i]}`;
      (keys.get(k) ?? keys.set(k, []).get(k)!).push(i);
    }
    const mask = new Uint8Array(N * N);
    // stairs: stepped boxes to look at, one sloped triangle mesh to walk on
    const isStair = (i: number) => stair[i] > H[i] && !cut[i] && Z[i] !== ZONE.garageRamp && Z[i] !== ZONE.nwStairs;
    {
      const surf = (i: number) => (isStair(i) ? smooth[i] : G[i]);
      const corner = new Map<number, number>();
      const verts: number[] = [];
      const idx: number[] = [];
      const vert = (cu: number, cv: number) => {
        const key = cv * (N + 1) + cu;
        let k = corner.get(key);
        if (k !== undefined) return k;
        // corner height: the mean surface of the pixels around it that are walkable ground or stairs
        let sum = 0;
        let n = 0;
        for (const [pu, pv] of [[cu - 1, cv - 1], [cu, cv - 1], [cu - 1, cv], [cu, cv]]) {
          if (pu < 0 || pv < 0 || pu >= N || pv >= N) continue;
          const j = pv * N + pu;
          if (cut[j] || Z[j] === ZONE.water || Z[j] === ZONE.garageRamp || Z[j] === ZONE.nwStairs) continue;
          sum += surf(j);
          n++;
        }
        k = verts.length / 3;
        verts.push(uToX(cu), sum / Math.max(1, n), vToZ(cv));
        corner.set(key, k);
        return k;
      };
      for (let i = 0; i < N * N; i++) {
        if (!isStair(i)) continue;
        const u = i % N;
        const v = (i / N) | 0;
        const a = vert(u, v), b2 = vert(u + 1, v), c = vert(u + 1, v + 1), d = vert(u, v + 1);
        idx.push(a, c, b2, a, d, c);
      }
      if (idx.length) physics.addTrimesh(new Float32Array(verts), new Uint32Array(idx), { kind: 'static', mat: 'concrete', exterior: true });
    }
    for (const [k, idx] of keys) {
      mask.fill(0);
      for (const i of idx) mask[i] = 1;
      const [hs, tag] = k.split('|');
      const h = Number(hs);
      const color = tag === 's' ? '#85827a' : zoneColor(Number(tag), h);
      for (const [u0, v0, u1, v1] of greedy(mask, N, N)) {
        const r = { x0: uToX(u0), z0: vToZ(v0), x1: uToX(u1), z1: vToZ(v1) };
        for (const q of subtractRects(r, HOUSE_HOLES)) {
          if (tag === 's') {
            // steps: drawn, not collided (the slope mesh above carries feet, wheels and bullets alike)
            const col = new THREE.Color(color);
            b.box([q.x0, BASE_Y, q.z0], [q.x1, h, q.z1], col, col.clone().multiplyScalar(0.72), 1);
          } else solid([q.x0, BASE_Y, q.z0], [q.x1, h, q.z1], color, tag === '3' ? 'dirt' : tag === String(ZONE.docks) ? 'wood' : 'dirt');
        }
      }
    }
  }
  // the House's outdoor pits: driveway (bay + apron) and vent shaft floors
  solid([DRIVEWAY.x0, BASE_Y, DRIVEWAY.z0], [9.7, LOWER_GROUND_Y, -0.6], '#55575a');
  solid([9.7, BASE_Y, DRIVEWAY.z0], [DRIVEWAY.x1, LOWER_GROUND_Y, DRIVEWAY.z1], '#55575a');
  solid([VENT_SHAFT.x0, BASE_Y, VENT_SHAFT.z0], [VENT_SHAFT.x1, LOWER_GROUND_Y, VENT_SHAFT.z1], '#4a4a48');
  // vent shaft grille at grade (drones drop through, boots don't)
  for (let k = 0; k <= 5; k++) {
    const x = VENT_SHAFT.x0 + ((VENT_SHAFT.x1 - VENT_SHAFT.x0) * k) / 5;
    deco([x - 0.012, -0.03, VENT_SHAFT.z0], [x + 0.012, 0.01, VENT_SHAFT.z1], '#2b2e33');
  }
  clip([VENT_SHAFT.x0, 0, VENT_SHAFT.z0], [VENT_SHAFT.x1, 0.6, VENT_SHAFT.z1]);

  // garage entrance ramp (datamap zone 9): one slope from the apron up to the road
  {
    const R = GARAGE_RAMP;
    const run = R.x1 - R.x0;
    const rise = R.y1 - R.y0;
    const theta = Math.atan2(rise, run);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta);
    const L = Math.hypot(run, rise);
    const cx = (R.x0 + R.x1) / 2;
    const cy = (R.y0 + R.y1) / 2 - 0.15 / Math.cos(theta);
    const cz = (R.z0 + R.z1) / 2;
    physics.addBox(cx, cy, cz, L / 2, 0.15, (R.z1 - R.z0) / 2, { kind: 'static', mat: 'concrete', exterior: true }, q);
    b.tbox(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1)), L, 0.3, R.z1 - R.z0, new THREE.Color('#5e5f61'));
    // the fill under it
    const shape = new THREE.Shape([new THREE.Vector2(R.x0, R.y0 - 0.3), new THREE.Vector2(R.x1, R.y1 - 0.3), new THREE.Vector2(R.x1, BASE_Y), new THREE.Vector2(R.x0, BASE_Y)]);
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: R.z1 - R.z0, bevelEnabled: false });
    b.geom(wedge, new THREE.Matrix4().makeTranslation(0, 0, R.z0), new THREE.Color('#4f4b45'));
    wedge.dispose();
    solid([R.x0 - 0.01, BASE_Y, R.z0], [R.x1, R.y0 - 0.3, R.z1], '#4f4b45'); // (collider for the fill's bulk)
    // guard rails along both sides at road level
    for (const z of [R.z0, R.z1]) { deco([R.x0, -1.51, z - 0.04], [R.x1, -0.55, z + 0.04], '#6f7378'); clip([R.x0, -1.51, z - 0.06], [R.x1, -0.45, z + 0.06]); }
  }

  /* ------------------------------------------------------------- river: water plane, clip at the bank */
  const waterX0 = uToX(432);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 220), new THREE.MeshStandardMaterial({ color: '#2f4a55', roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(waterX0 + 70, -4.2, (MAP_BOUNDS.z0 + MAP_BOUNDS.z1) / 2);
  water.receiveShadow = true;
  scene.add(water);
  clip([waterX0, RIVER_BED, MAP_BOUNDS.z0 - 1], [waterX0 + 0.4, 12, MAP_BOUNDS.z1 + 1]);
  // mooring bollards along the dock edge
  for (let z = 4; z < 28; z += 4.5) { const k = new Kit('metal'); k.cyl(0, 0, 0, 0.55, 0.14, '#2b2e33'); k.place(b, physics, waterX0 - 0.35, -3.0, z); }

  /* ------------------------------------------------------------- map edges (player clip) + backdrop */
  const B = MAP_BOUNDS;
  clip([B.x0 - 1, BASE_Y, B.z0], [B.x0, 30, B.z1]);
  clip([B.x1, BASE_Y, B.z0], [B.x1 + 1, 30, B.z1]);
  clip([B.x0, BASE_Y, B.z0 - 1], [B.x1, 30, B.z0]);
  clip([B.x0, BASE_Y, B.z1], [B.x1, 30, B.z1 + 1]);
  // the world goes on past the edge (no colliders: nobody can reach it)
  deco([B.x0 - 90, -1.6, B.z0 - 90], [waterX0, -1.52, B.z0], '#3a3b3e');
  deco([B.x0 - 90, -1.6, B.z1], [waterX0, -1.52, B.z1 + 90], '#3a3b3e');
  deco([B.x0 - 90, -1.6, B.z0], [B.x0, -1.52, B.z1], '#3a3b3e');

  /* ------------------------------------------------------------- forms */
  const forms = formBoxes(F);
  const groundAt = (x: number, z: number) => G[Math.min(N - 1, Math.max(0, Math.floor(zToV(z)))) * N + Math.min(N - 1, Math.max(0, Math.floor(xToU(x))))];
  const upperAt = (x: number, z: number) => HU[Math.min(N - 1, Math.max(0, Math.floor(zToV(z)))) * N + Math.min(N - 1, Math.max(0, Math.floor(xToU(x))))];
  for (const f of forms) {
    const cx = (f.x0 + f.x1) / 2;
    const cz = (f.z0 + f.z1) / 2;
    const w = f.x1 - f.x0;
    const d = f.z1 - f.z0;
    const g = f.form === FORM.sailboat ? -4.2 : H[Math.floor(zToV(cz)) * N + Math.floor(xToU(cx))];
    const top = upperAt(cx, cz);
    switch (f.form) {
      case FORM.lift1: case FORM.lift2: case FORM.lift3: scissorLift(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.treehouse: buildTreehouse(cx, g, cz, w, d, top); break;
      case FORM.apc: apc(w, d, top).place(b, physics, cx, g, cz); lights.push({ pos: new THREE.Vector3(cx + 3, g + 4.2, cz - 2), dir: new THREE.Vector3(-0.4, -0.5, 0.75).normalize(), color: '#fff4d8', kind: 'flood' }); break;
      case FORM.gazebo: gazebo(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.pergola: pergola(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.sailboat: sailboat(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.container: container(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.spawnPad: spawnPad(cx, groundAt(cx, cz), cz, w, d); break;
      case FORM.vent: roofVent(cx, cz, g + top); break;
      default: break; // CCTV cams A / B: House cameras (MapBuilder, CCTVS)
    }
  }
  // the SW neighbour house (zone 14): walls up to H_upper, a stepped hip roof, lit windows
  {
    const r = zoneBox(Z, ZONE.neighbor);
    if (r) {
      const g = -1.51;
      const top = upperAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      const k = new Kit('concrete');
      const hw = (r.x1 - r.x0) / 2 - 0.3;
      const hd = (r.z1 - r.z0) / 2 - 0.3;
      k.box([-hw, 0, -hd], [hw, top - 0.9, hd], '#b9b2a4');
      for (let s = 0; s < 3; s++) k.box([-hw - 0.3 + s * 1.0, top - 0.9 + s * 0.3, -hd - 0.3 + s * 0.6], [hw + 0.3 - s * 1.0, top - 0.6 + s * 0.3, hd + 0.3 - s * 0.6], '#4b4642');
      k.place(b, physics, (r.x0 + r.x1) / 2, g, (r.z0 + r.z1) / 2);
      for (let i = 0; i < 4; i++) {
        const wz = r.z0 + 0.3 + ((r.z1 - r.z0 - 0.6) * (i + 0.5)) / 4;
        glow.box([r.x1 - 0.31, g + 1.3, wz - 0.5], [r.x1 - 0.28, g + 2.3, wz + 0.5], new THREE.Color(i % 2 ? '#ffcf86' : '#ffe3b0'));
      }
    }
  }
  // police cruisers: the supplied 11 placements (u, v, yaw on the top view, y = their ground)
  for (const c of HOUSE_POLICE_CRUISERS) {
    const x = uToX(c.u);
    const z = vToZ(c.v);
    // the model's long axis is world X at yaw 0; top-view yaw turns clockwise on the image (+X → +Z)
    const yaw = -(c.yawDeg * Math.PI) / 180;
    cruiser().place(b, physics, x, c.y, z, yaw);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 1.2), [
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
    ]);
    bar.position.set(x, c.y + 1.5, z);
    bar.rotation.y = yaw;
    scene.add(bar);
    policeBars.push(bar);
    lights.push({ pos: new THREE.Vector3(x, c.y + 1.9, z), color: '#ff3040', kind: 'police' });
  }

  /* ------------------------------------------------------------- dressing (context: lamps, trees, fences, dock clutter) */
  const lamp = (x: number, z: number, dx = 1) => {
    const y = groundAt(x, z);
    const k = new Kit('metal');
    k.cyl(0, 0, 0, 5.2, 0.08, '#3a3d42').box([-0.06, 5.1, -0.06], [dx * 1.1, 5.2, 0.06], '#3a3d42');
    k.place(b, physics, x, y, z);
    glow.box([x + dx * 0.8, y + 4.95, z - 0.18], [x + dx * 1.25, y + 5.08, z + 0.18], new THREE.Color('#ffd28a'));
    lights.push({ pos: new THREE.Vector3(x + dx * 1.0, y + 4.9, z), color: '#ffc27a', kind: 'lamp' });
  };
  lamp(-8, -18.0, 1); lamp(8, -18.0, -1); lamp(-15.2, 9.5, 1); lamp(-1, 22.4, 1); lamp(17, 21.5, -1); lamp(19.6, -12, -1); lamp(22.5, 14, 1);
  const tree = (x: number, z: number, s = 1) => {
    const y = groundAt(x, z);
    const k = new Kit('wood');
    k.cyl(0, 0, 0, 2.4 * s, 0.17 * s, '#4a3826');
    k.place(b, physics, x, y, z);
    // foliage: no collider (leaves neither stop a body nor a bullet)
    b.geom(new THREE.IcosahedronGeometry(1.7 * s, 0), new THREE.Matrix4().makeTranslation(x, y + 3.4 * s, z), new THREE.Color('#3d5530'));
  };
  for (const [x, z, s] of [[-20, -12, 1.2], [-19, 2, 1.1], [-22, 6, 1.0], [-12.5, -10.5, 0.9], [10.8, -12, 1.0], [-12.8, 14.5, 1.0], [8.5, 15, 1.1], [-27, -4, 1.3]]) tree(x, z, s);
  // white picket fence along the sidewalk edge of the front yard (gap at the front walk)
  for (const [x0, x1] of [[-13.0, -1.1], [1.3, 11.2]]) {
    const k = new Kit('wood');
    k.box([0, 0, -0.04], [x1 - x0, 0.08, 0.04], '#e9e6dc').box([0, 0.75, -0.04], [x1 - x0, 0.83, 0.04], '#e9e6dc');
    for (let x = 0; x <= x1 - x0; x += 0.6) k.box([x - 0.03, 0, -0.02], [x + 0.03, 0.95, 0.02], '#e9e6dc');
    k.place(b, physics, x0, 0, -15.0);
  }
  deco([-0.9, 0, -15.31], [1.1, 0.02, -7.0], '#a29d92'); // front walk
  deco([-4.9, -0.36, 6.83], [-3.7, -0.34, 11.8], '#a29d92'); // back walk
  // road markings
  for (let x = B.x0 + 2; x < 19; x += 6) deco([x, -1.5, -21.1], [x + 3, -1.49, -20.9], '#d8c65a');
  for (let x = -14; x < 19; x += 6) deco([x, -1.5, 25.4], [x + 3, -1.49, 25.6], '#e8e4d6');
  // construction site: barrier fence, pipes, sand pile, site lights
  {
    // site fence panels, with a 2.4 m gate in line with the House's front walk
    for (let x = -14; x < 13; x += 3) { if (x > -2 && x < 2) continue; const k = new Kit('metal'); k.box([0, 0, -0.03], [2.6, 1.9, 0.03], '#9aa0a2'); k.place(b, physics, x, -1.29, -24.7); }
    for (const [x, z] of [[-9, -33], [-9, -34.6]]) {
      // concrete pipes lying along X: a horizontal cylinder
      b.geom(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 10, 1, true), new THREE.Matrix4().compose(new THREE.Vector3(x, -1.29 + 0.75, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(1, 1, 1)), new THREE.Color('#9a968c'));
      physics.addCylinder(x, -1.29 + 0.75, z, 1.1, 0.75, { kind: 'static', mat: 'concrete', exterior: true }, undefined, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    }
    lights.push({ pos: new THREE.Vector3(1, 6.5, -24), dir: new THREE.Vector3(0, -0.6, -1).normalize(), color: '#fff0c8', kind: 'flood' });
    // the skeleton of the building going up beyond the fence line (backdrop: past the map edge)
    for (const x of [-12, -6, 0, 6, 12]) for (const z of [-46, -41]) deco([x - 0.25, -1.29, z - 0.25], [x + 0.25, 6.8, z + 0.25], '#8b8983');
    deco([-12.4, 2.6, -46.4], [12.4, 2.9, -40.6], '#8b8983');
    deco([-12.4, 6.6, -46.4], [12.4, 6.9, -40.6], '#8b8983');
  }
  // docks: crates and barrels
  for (const [x, z, s] of [[21.5, 14, 1.1], [22.6, 14, 1.1], [21.9, 15.2, 1.0], [23.8, 22, 1.2]]) solid([x - s / 2, -3.0, z - s / 2], [x + s / 2, -3.0 + s, z + s / 2], '#8a6b42', 'wood');
  for (const [x, z] of [[23.6, 17.5], [24.2, 17.9]]) { const k = new Kit('metal'); k.cyl(0, 0, 0, 0.9, 0.3, '#3b5f8a'); k.place(b, physics, x, -3.0, z); }
  // APC area sandbags + barriers
  for (const [x, z, w, dd] of [[-10.5, 21.5, 0.6, 3], [-3.0, 19.8, 3, 0.6]]) solid([x - w / 2, -1.51, z - dd / 2], [x + w / 2, -0.61, z + dd / 2], '#8a7c5c', 'dirt');

  const mesh = new THREE.Mesh(b.build(), vcMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'outdoor';
  scene.add(mesh);
  const windowGlow = new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  windowGlow.name = 'window_glow';
  scene.add(windowGlow);
  return { lights, policeBars, water, windowGlow, map };

  /* ================================================================ form models (object space: x/z = footprint, y up from the ground) */
  function scissorLift(w: number, d: number, top: number): Kit {
    const k = new Kit('metal');
    const hw = w / 2;
    const hd = d / 2;
    k.box([-hw + 0.1, 0.15, -hd + 0.1], [hw - 0.1, 0.6, hd - 0.1], '#c9a227');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box([sx * (hw - 0.25) - 0.12, 0, sz * (hd - 0.25) - 0.08], [sx * (hw - 0.25) + 0.12, 0.3, sz * (hd - 0.25) + 0.08], '#141414');
    // scissor stack: crossing arm pairs per section (thin: shot through)
    const sections = Math.max(2, Math.round((top - 0.75) / 0.9));
    const sh = (top - 0.75) / sections;
    for (let s = 0; s < sections; s++) {
      const y = 0.6 + s * sh;
      for (const sz of [-hd + 0.25, hd - 0.25]) {
        k.box([-hw + 0.3, y, sz - 0.03], [hw - 0.3, y + 0.06, sz + 0.03], '#3a3d42', false);
        k.box([-0.04, y, sz - 0.03], [0.04, y + sh, sz + 0.03], '#3a3d42', false);
      }
    }
    k.box([-hw, top - 0.12, -hd], [hw, top, hd], '#c9a227');
    for (const sz of [-hd, hd - 0.05]) k.box([-hw, top + 0.95, sz], [hw, top + 1.0, sz + 0.05], '#c9a227');
    for (const sx of [-hw, hw - 0.05]) k.box([sx, top + 0.95, -hd], [sx + 0.05, top + 1.0, hd], '#c9a227');
    for (const sx of [-hw, hw - 0.05]) for (const sz of [-hd, hd - 0.05]) k.box([sx, top, sz], [sx + 0.05, top + 1.0, sz + 0.05], '#c9a227');
    return k;
  }

  function buildTreehouse(cx: number, g: number, cz: number, w: number, d: number, top: number) {
    const k = new Kit('wood');
    const hw = w / 2;
    const hd = d / 2;
    // the old oak it hangs on + corner posts
    k.cyl(0, 0, 0, top + 3.5, 0.45, '#4a3826', true, 'wood', 10);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(sx * (hw - 0.15), sz * (hd - 0.15), 0, top, 0.1, '#5a4330');
    k.box([-hw, top - 0.15, -hd], [hw, top, hd], '#7a5b3a'); // floor
    // plank parapet (bullets go through planks) — open on the west for the stairs
    k.box([-hw, top, -hd], [hw, top + 1.0, -hd + 0.06], '#6b4f33');
    k.box([-hw, top, hd - 0.06], [hw, top + 1.0, hd], '#6b4f33');
    k.box([hw - 0.06, top, -hd], [hw, top + 1.0, hd], '#6b4f33');
    k.box([-hw, top, -hd], [-hw + 0.06, top + 1.0, -hd + 0.9], '#6b4f33');
    k.box([-hw, top, hd - 0.9], [-hw + 0.06, top + 1.0, hd], '#6b4f33');
    // roof on four posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box([sx * (hw - 0.1) - 0.05, top, sz * (hd - 0.1) - 0.05], [sx * (hw - 0.1) + 0.05, top + 2.1, sz * (hd - 0.1) + 0.05], '#5a4330');
    k.box([-hw - 0.2, top + 2.1, -hd - 0.2], [hw + 0.2, top + 2.25, hd + 0.2], '#4b4642');
    k.box([-hw + 0.4, top + 2.25, -hd + 0.4], [hw - 0.4, top + 2.45, hd - 0.4], '#4b4642');
    k.place(b, physics, cx, g, cz);
    b.geom(new THREE.IcosahedronGeometry(3.0, 0), new THREE.Matrix4().makeTranslation(cx + 0.6, g + top + 4.4, cz), new THREE.Color('#3d5530'));
    // steep stairs down the west side (sniper platform access)
    const x1 = cx - hw;
    const yTop = g + top;
    const yBot = groundAt(x1 - 4.4, cz);
    const run = 4.4;
    const steps = Math.round((yTop - yBot) / 0.2);
    for (let i = 0; i < steps; i++) {
      const a0 = (run * i) / steps;
      const a1 = (run * (i + 1)) / steps;
      const y = yTop - ((yTop - yBot) * (i + 1)) / steps;
      b.box([x1 - a1, y - 0.06, cz - 0.5], [x1 - a0, y, cz + 0.5], new THREE.Color('#7a5b3a'));
    }
    const theta = Math.atan2(yTop - yBot, run);
    const L = Math.hypot(run, yTop - yBot);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -theta);
    physics.addBox(x1 - run / 2, (yTop + yBot) / 2 - 0.1 / Math.cos(theta), cz, L / 2, 0.1, 0.5, { kind: 'static', mat: 'wood', exterior: true }, q);
    for (const sz of [-0.55, 0.55]) {
      b.tbox(new THREE.Matrix4().compose(new THREE.Vector3(x1 - run / 2, (yTop + yBot) / 2 + 0.85, cz + sz), q, new THREE.Vector3(1, 1, 1)), L, 0.06, 0.05, new THREE.Color('#5a4330'));
      physics.addBox(x1 - run / 2, (yTop + yBot) / 2 + 0.5, cz + sz, L / 2, 0.5, 0.03, { kind: 'static', mat: 'wood' }, q, G_CLIP);
    }
  }

  function apc(w: number, d: number, top: number): Kit {
    const k = new Kit('vehicle');
    const hw = w / 2;
    const hd = d / 2;
    k.box([-hw + 0.1, 0.55, -hd], [hw - 0.1, top - 0.6, hd], '#3f4636');
    k.box([-hw + 0.35, top - 0.6, -hd + 0.6], [hw - 0.35, top - 0.15, hd - 0.4], '#3f4636');
    k.box([-0.3, top - 0.15, -0.2], [0.3, top, 0.5], '#2b3026'); // turret
    k.box([-0.06, top - 0.1, -hd + 0.2], [0.06, top - 0.02, -0.2], '#222'); // gun
    k.box([-hw + 0.3, 0.9, -hd - 0.02], [hw - 0.3, 1.4, -hd], '#7fa5b5', false); // windscreen
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.box([s * (hw - 0.1) - 0.17, 0, -hd + 0.55 + i * ((d - 1.1) / 2) - 0.42], [s * (hw - 0.1) + 0.17, 0.9, -hd + 0.55 + i * ((d - 1.1) / 2) + 0.42], '#141414');
    return k;
  }

  function gazebo(w: number, d: number, top: number): Kit {
    const k = new Kit('wood');
    const hw = w / 2;
    const hd = d / 2;
    k.box([-hw, 0, -hd], [hw, 0.2, hd], '#8a7353'); // deck
    const eave = top - 0.6;
    for (const [sx, sz] of [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]) k.box([sx * (hw - 0.15) - 0.08, 0.2, sz * (hd - 0.15) - 0.08], [sx * (hw - 0.15) + 0.08, eave, sz * (hd - 0.15) + 0.08], '#e8e4da');
    // low rails, open in the middle of the north and south sides
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) k.box([sx > 0 ? 0.7 : -hw + 0.15, 0.85, sz * (hd - 0.15) - 0.03], [sx > 0 ? hw - 0.15 : -0.7, 0.92, sz * (hd - 0.15) + 0.03], '#e8e4da');
    for (const sx of [-1, 1]) k.box([sx * (hw - 0.15) - 0.03, 0.85, -hd + 0.15], [sx * (hw - 0.15) + 0.03, 0.92, hd - 0.15], '#e8e4da');
    // stepped hip roof
    k.box([-hw - 0.3, eave, -hd - 0.3], [hw + 0.3, eave + 0.15, hd + 0.3], '#6a4a3a');
    k.box([-hw * 0.6, eave + 0.15, -hd * 0.6], [hw * 0.6, eave + 0.38, hd * 0.6], '#6a4a3a');
    k.box([-hw * 0.25, eave + 0.38, -hd * 0.25], [hw * 0.25, top, hd * 0.25], '#6a4a3a');
    return k;
  }

  function pergola(w: number, d: number, top: number): Kit {
    const k = new Kit('wood');
    const hw = w / 2;
    const hd = d / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box([sx * (hw - 0.2) - 0.09, 0, sz * (hd - 0.2) - 0.09], [sx * (hw - 0.2) + 0.09, top - 0.2, sz * (hd - 0.2) + 0.09], '#7a5b3a');
    for (const sz of [-1, 1]) k.box([-hw, top - 0.2, sz * (hd - 0.2) - 0.06], [hw, top - 0.05, sz * (hd - 0.2) + 0.06], '#6b4f33');
    for (let i = 0; i < 9; i++) { const x = -hw + 0.2 + ((w - 0.4) * i) / 8; k.box([x - 0.04, top - 0.05, -hd], [x + 0.04, top, hd], '#6b4f33'); }
    return k;
  }

  function sailboat(w: number, d: number, top: number): Kit {
    const k = new Kit('vehicle');
    const hw = w / 2;
    const hd = d / 2;
    k.box([-hw * 0.7, -0.5, -hd + 0.6], [hw * 0.7, 0.1, hd - 0.4], '#e4e0d4');
    k.box([-hw, 0.1, -hd + 0.3], [hw, 0.7, hd], '#e4e0d4');
    k.box([-hw * 0.4, 0.1, -hd], [hw * 0.4, 0.7, -hd + 0.3], '#e4e0d4');
    k.box([-hw * 0.6, 0.7, -hd * 0.2], [hw * 0.6, top, hd * 0.5], '#2f4f6f');
    k.cyl(0, -hd * 0.3, top, top + 8.5, 0.07, '#d9d9d4', true, 'metal');
    k.box([-0.05, top + 0.6, -hd * 0.3], [0.05, top + 0.68, hd * 0.6], '#d9d9d4', true, 'metal'); // boom
    return k;
  }

  function container(w: number, d: number, top: number): Kit {
    const k = new Kit('metal');
    const hw = w / 2;
    const hd = d / 2;
    k.box([-hw, 0, -hd], [hw, top, hd], '#8a3b2b');
    for (let z = -hd + 0.3; z < hd; z += 0.45) for (const s of [-1, 1]) k.box([s * hw - (s > 0 ? 0 : 0.02), 0.1, z - 0.06], [s * hw + (s > 0 ? 0.02 : 0), top - 0.1, z + 0.06], '#6e2f22', false);
    k.box([-hw + 0.1, 0.2, hd], [hw - 0.1, top - 0.2, hd + 0.02], '#6e2f22', false);
    return k;
  }

  function cruiser(): Kit {
    const k = new Kit('vehicle');
    const W = '#e8e8e4';
    const K = '#16181b';
    k.box([-2.3, 0.3, -0.9], [2.3, 0.95, 0.9], K);
    k.box([-1.0, 0.55, -0.92], [1.4, 0.95, 0.92], W, false); // door panels (decal on the body)
    k.box([-0.9, 0.95, -0.8], [1.0, 1.45, 0.8], K);
    k.box([-0.95, 1.0, -0.78], [-0.9, 1.38, 0.78], '#7fa5b5', false);
    for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box([wx * 1.45 - 0.33, 0, wz * 0.82 - 0.1], [wx * 1.45 + 0.33, 0.62, wz * 0.82 + 0.1], '#111');
    return k;
  }

  function spawnPad(cx: number, g: number, cz: number, w: number, d: number) {
    const hw = w / 2 - 0.2;
    const hd = d / 2 - 0.2;
    const c = '#d9b23a';
    deco([cx - hw, g, cz - hd], [cx + hw, g + 0.012, cz - hd + 0.12], c);
    deco([cx - hw, g, cz + hd - 0.12], [cx + hw, g + 0.012, cz + hd], c);
    deco([cx - hw, g, cz - hd], [cx - hw + 0.12, g + 0.012, cz + hd], c);
    deco([cx + hw - 0.12, g, cz - hd], [cx + hw, g + 0.012, cz + hd], c);
  }

  /** the datamap's above-grade drone vents: rooftop vent units on the House's roof / porch roof */
  function roofVent(x: number, z: number, y: number) {
    if (y < 1) return; // the B-level ones: the House shell's own vent openings (storage W wall)
    const roofY = y > 5 ? ROOF_Y : 3.5;
    // keep them on the traced roofs (the datamap's House outline is ~0.5 m off)
    const cx = THREE.MathUtils.clamp(x, -7.0, 9.4);
    const cz = THREE.MathUtils.clamp(z, roofY > 5 ? -7.1 : -6.9, roofY > 5 ? 6.3 : -5.6);
    const k = new Kit('metal');
    k.box([-0.3, 0, -0.3], [0.3, 0.45, 0.3], '#9a9b98').box([-0.36, 0.45, -0.36], [0.36, 0.52, 0.36], '#7d7f80');
    for (let i = 0; i < 4; i++) k.box([-0.31, 0.08 + i * 0.09, -0.31], [0.31, 0.12 + i * 0.09, -0.3], '#3a3d42', false);
    k.place(b, physics, cx, roofY, cz);
  }
}

/** bounding boxes of every connected region of each form id (world rects) */
function formBoxes(F: Uint8Array): { form: number; x0: number; z0: number; x1: number; z1: number }[] {
  const seen = new Uint8Array(N * N);
  const out: { form: number; x0: number; z0: number; x1: number; z1: number }[] = [];
  for (let i = 0; i < N * N; i++) {
    const f = F[i];
    if (!f || seen[i] || f === FORM.cruiser) continue;
    let u0 = N, v0 = N, u1 = -1, v1 = -1;
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const j = st.pop()!;
      const u = j % N;
      const v = (j / N) | 0;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      for (const k of [j - 1, j + 1, j - N, j + N]) if (k >= 0 && k < N * N && !seen[k] && F[k] === f && Math.abs((k % N) - u) <= 1) { seen[k] = 1; st.push(k); }
    }
    out.push({ form: f, x0: uToX(u0), z0: vToZ(v0), x1: uToX(u1 + 1), z1: vToZ(v1 + 1) });
  }
  return out;
}

function zoneBox(Z: Uint8Array, zone: number): Rect | null {
  let u0 = N, v0 = N, u1 = -1, v1 = -1;
  for (let i = 0; i < N * N; i++) {
    if (Z[i] !== zone) continue;
    const u = i % N;
    const v = (i / N) | 0;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return u1 < 0 ? null : { x0: uToX(u0), z0: vToZ(v0), x1: uToX(u1 + 1), z1: vToZ(v1 + 1) };
}

