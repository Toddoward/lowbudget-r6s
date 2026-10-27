import * as THREE from 'three';
import { G_CLIP, type Physics, type SurfaceMaterial } from '../core/Physics.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { vcMaterial } from '../render/palette.ts';
import { greedy } from '../world/Destruction.ts';
import { DRIVEWAY, LOWER_GROUND_Y, MAP_BOUNDS, ROOF_Y, SPAWN_ZONES, STAIRS, VENT_SHAFT, YARD, type Rect } from './houseLayout.ts';

const stairRect = (id: string) => STAIRS.find((s) => s.id === id)!.rect;
import { subtractRects } from './geometry.ts';
import { P } from './plan.ts';
import { FORM, HOUSE_POLICE_CRUISERS, setActiveDatamap, uToX, vToZ, xToU, zToV, ZONE, type HouseDatamap } from './houseDatamap.ts';
import { BOUNDS, DECKS, EAST_FALL, HOUSE_HOLES, ROAD_E, ROAD_N, SURFACES, X_QUAY, eastRoadY, quayY, rimPieces, terrain, type Surface } from './terrain.ts';

/**
 * Everything outside the House:
 *  - the ground: terrain.ts — one surface built from the agreed levels (no boxes), drawn and collided as the same
 *    triangles; the kerbs, retaining walls, the flights' cheek walls, the quay wall and the pit walls it hides its steps in;
 *    plinths under the porch and the decks down to it
 *  - forms placed from the House datamap (houseDatamap.ts: positions and heights above their ground only): scissor lifts,
 *    treehouse, gazebo, pergola, APC, sailboats, container, the SW neighbour house, roof vents, spawn pads, and the 11
 *    police cruisers from HOUSE_POLICE_CRUISERS — each stood on the terrain under it; the datamap's zones name places
 *  - river (water plane) and map edges are player-clipped
 * Every solid thing's collider is built from the same boxes as its mesh, so a bullet stops exactly where something is drawn
 * and nowhere else.
 */
export interface StreetLight { pos: THREE.Vector3; dir?: THREE.Vector3; color: string; kind: 'lamp' | 'police' | 'flood' | 'porch' }
export interface OutdoorWorld { lights: StreetLight[]; policeBars: THREE.Mesh[]; water: THREE.Mesh; windowGlow: THREE.Mesh; map: HouseDatamap }

const N = 512;
const BASE_Y = -6;
const UP = new THREE.Vector3(0, 1, 0);
export { HOUSE_HOLES };

/** surface → ground colour (lawn a shade darker low down) */
const SURFACE_COLOR: Record<Surface, string> = { asphalt: '#3a3b3e', concrete: '#9a978f', pavers: '#8c877c', lawn: '#5a6a3b', dirt: '#7d6c53', stone: '#a69b88', riverbed: '#24332f' };

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

  /* ------------------------------------------------------------- the datamap: forms and their heights over the ground */
  const HU = new Float32Array(N * N);
  const F = new Uint8Array(N * N);
  const Z = new Uint8Array(N * N);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const s = map.sample(u, v);
      HU[v * N + u] = s.hUpper;
      F[v * N + u] = s.formId;
      Z[v * N + u] = s.zoneId;
    }
  }

  /* ------------------------------------------------------------- the ground */
  const T = terrain();
  const groundAt = T.y;
  {
    const { xs, zs, hs, cell, stripCell } = T;
    const nx = xs.length;
    const at = (i: number, j: number) => hs[j * nx + i];
    // collider: every cell that is not a hole, as two triangles (the strips under walls and steps too: they are inside solids)
    const verts = new Float32Array(xs.length * zs.length * 3);
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < nx; i++) verts.set([xs[i], at(i, j), zs[j]], (j * nx + i) * 3);
    const idx: number[] = [];
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        if (cell[j * (nx - 1) + i] < 0) continue;
        const a = j * nx + i, b2 = a + 1, c = a + nx + 1, d = a + nx;
        idx.push(a, c, b2, a, d, c);
      }
    }
    physics.addTrimesh(verts, new Uint32Array(idx), { kind: 'static', mat: 'dirt', exterior: true });
    // the ground is solid under its surface (a sheet alone leaves a void under it to stand or fall into): boxes up to a
    // little under the lowest corner of every cell, cells of one level merged
    {
      const cw = nx - 1, ch = zs.length - 1;
      const level = new Int16Array(cw * ch);
      const levels = new Set<number>();
      for (let j = 0; j < ch; j++) {
        for (let i = 0; i < cw; i++) {
          const k = j * cw + i;
          if (cell[k] < 0) { level[k] = -32768; continue; }
          const low = Math.min(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
          level[k] = Math.floor((low - 0.05) * 10);
          levels.add(level[k]);
        }
      }
      const mask = new Uint8Array(cw * ch);
      for (const lv of levels) {
        mask.fill(0);
        for (let k = 0; k < mask.length; k++) if (level[k] === lv) mask[k] = 1;
        const top = lv / 10;
        if (top <= BASE_Y) continue;
        for (const [i0, j0, i1, j1] of greedy(mask, cw, ch)) {
          const x0 = xs[i0], x1 = xs[i1], z0 = zs[j0], z1 = zs[j1];
          physics.addBox((x0 + x1) / 2, (BASE_Y + top) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (top - BASE_Y) / 2, (z1 - z0) / 2, { kind: 'static', mat: 'dirt', exterior: true });
        }
      }
    }
    // mesh: one colour per cell (crisp edges between road, kerb, lawn), normals smoothed over the cells round a vertex that
    // are open ground (not the hidden ramps inside walls and kerbs)
    const nrm = new Float32Array(xs.length * zs.length * 3);
    const fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = j * (nx - 1) + i;
        if (cell[k] < 0 || stripCell[k]) continue;
        e1.set(xs[i + 1] - xs[i], at(i + 1, j + 1) - at(i, j), zs[j + 1] - zs[j]);
        e2.set(xs[i + 1] - xs[i], at(i + 1, j) - at(i, j + 1), zs[j] - zs[j + 1]);
        fn.crossVectors(e2, e1).normalize();
        if (fn.y < 0) fn.negate();
        for (const v of [j * nx + i, j * nx + i + 1, (j + 1) * nx + i, (j + 1) * nx + i + 1]) { nrm[v * 3] += fn.x; nrm[v * 3 + 1] += fn.y; nrm[v * 3 + 2] += fn.z; }
      }
    }
    const pos: number[] = [], nor: number[] = [], col: number[] = [];
    const tmp = new THREE.Vector3();
    const colors = SURFACES.map((s) => new THREE.Color(SURFACE_COLOR[s]));
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = j * (nx - 1) + i;
        if (cell[k] < 0) continue;
        const c = colors[cell[k]].clone();
        if (SURFACES[cell[k]] === 'lawn') c.multiplyScalar(0.92 + 0.06 * Math.max(-1, Math.min(1, (at(i, j) + 1) / 1.5)));
        for (const [ii, jj] of [[0, 0], [1, 1], [1, 0], [0, 0], [0, 1], [1, 1]]) {
          const v = (j + jj) * nx + i + ii;
          pos.push(xs[i + ii], hs[v], zs[j + jj]);
          tmp.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
          if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
          tmp.normalize();
          nor.push(tmp.x, tmp.y, tmp.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const ground = new THREE.Mesh(g, vcMaterial());
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);
  }
  // what stands on the strips: kerbs, retaining walls, cheek walls, the quay wall, pit walls (a sloped top: one tilted box
  // per even stretch)
  for (const w of T.solids) {
    const r = w.r;
    if (w.top === 'rim' || typeof w.top === 'object') {
      for (const q of rimPieces(r, w.top === 'rim' ? 0.03 : w.top.rim)) solid([q.r.x0, w.bottom, q.r.z0], [q.r.x1, q.top, q.r.z1], w.color);
      continue;
    }
    if (typeof w.top === 'number') { solid([r.x0, w.bottom, r.z0], [r.x1, w.top, r.z1], w.color); continue; }
    // a sloped top (the east road's kerbs, the quay wall): one box per stretch the road keeps its grade
    const topFn = w.top;
    const cuts = [r.z0, EAST_FALL.z0, DRIVEWAY.z0 - 1.5, DRIVEWAY.z0, DRIVEWAY.z1, DRIVEWAY.z1 + 1.5, r.z1].filter((z, i, a) => z >= r.z0 && z <= r.z1 && a.indexOf(z) === i).sort((p, q) => p - q);
    for (let k = 0; k < cuts.length - 1; k++) {
      const z0 = cuts[k], z1 = cuts[k + 1];
      if (z1 - z0 < 0.01) continue;
      const cx = (r.x0 + r.x1) / 2;
      const y0 = topFn(cx, z0 + 1e-4), y1 = topFn(cx, z1 - 1e-4);
      if (Math.abs(y1 - y0) < 1e-3) { solid([r.x0, w.bottom, z0], [r.x1, y0, z1], w.color); continue; }
      // tilted about X: the top edge runs from (z0, y0) to (z1, y1); the box goes down to below the low end
      const L = Math.hypot(z1 - z0, y1 - y0);
      const theta = Math.atan2(y1 - y0, z1 - z0);
      const hgt = Math.max(y0, y1) - w.bottom;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta);
      const c = new THREE.Vector3(cx, (y0 + y1) / 2 - (hgt / 2) * Math.cos(theta), (z0 + z1) / 2 + (hgt / 2) * Math.sin(theta));
      const color = new THREE.Color(w.color);
      b.tbox(new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)), r.x1 - r.x0, hgt, L, color);
      physics.addBox(c.x, c.y, c.z, (r.x1 - r.x0) / 2, hgt / 2, L / 2, { kind: 'static', mat: 'concrete', exterior: true }, q);
    }
  }
  // plinths: the porch and the back decks stand on stone down to the ground (less what the House holds up)
  for (const f of DECKS) {
    for (const q of subtractRects(f.rect, HOUSE_HOLES)) {
      let low = Infinity;
      for (const x of [q.x0 + 0.05, (q.x0 + q.x1) / 2, q.x1 - 0.05]) for (const z of [q.z0 + 0.05, (q.z0 + q.z1) / 2, q.z1 - 0.05]) low = Math.min(low, groundAt(x, z));
      const bottom = Math.min(low, f.y - (f.t ?? 0.3)) - 0.1;
      if (f.y - (f.t ?? 0.3) - bottom > 0.02) solid([q.x0, bottom, q.z0], [q.x1, f.y - (f.t ?? 0.3), q.z1], '#9b9284');
    }
  }
  // the vent shaft (yard → storage vent): its floor, a grille at grade and a lid flush with it (walk across; drones drop through)
  {
    const V = VENT_SHAFT;
    const top = YARD.upperTerrace;
    solid([V.x0, BASE_Y, V.z0], [V.x1, LOWER_GROUND_Y, V.z1], '#4a4a48');
    for (let k = 0; k <= 5; k++) {
      const x = V.x0 + ((V.x1 - V.x0) * k) / 5;
      deco([x - 0.012, top - 0.03, V.z0], [x + 0.012, top + 0.01, V.z1], '#2b2e33');
    }
    clip([V.x0, top - 0.02, V.z0], [V.x1, top + 0.02, V.z1]);
  }
  // a foundation under every cut-out, a little wider all round: whatever slips past a wall lands, it never falls out of the world
  for (const r of HOUSE_HOLES) physics.addBox((r.x0 + r.x1) / 2, (BASE_Y + LOWER_GROUND_Y - 0.05) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2 + 0.2, (LOWER_GROUND_Y - 0.05 - BASE_Y) / 2, (r.z1 - r.z0) / 2 + 0.2, { kind: 'static', mat: 'concrete', exterior: true });

  /* ------------------------------------------------------------- river: water plane, clip at the quay edge */
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 220), new THREE.MeshStandardMaterial({ color: '#2f4a55', roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(X_QUAY + 70, YARD.water, (MAP_BOUNDS.z0 + MAP_BOUNDS.z1) / 2);
  water.receiveShadow = true;
  scene.add(water);
  clip([X_QUAY, YARD.riverBed, BOUNDS.z0], [X_QUAY + 0.4, 12, BOUNDS.z1]);
  /** clear of the spawn pads (R3: nothing to get stuck on where a team comes in) */
  const clearOfSpawns = (x: number, z: number, r = 4.5) => SPAWN_ZONES.every((sz) => Math.hypot(sz.center[0] - x, sz.center[2] - z) > r);
  // mooring bollards along the quay edge
  for (let z = P(4); z < P(28); z += 4.5) {
    if (!clearOfSpawns(X_QUAY - 0.6, z)) continue;
    const k = new Kit('metal');
    k.cyl(0, 0, 0, 0.55, 0.14, '#2b2e33');
    k.place(b, physics, X_QUAY - 0.6, quayY(z), z);
  }

  /* ------------------------------------------------------------- map edges (player clip) + backdrop */
  const B = MAP_BOUNDS;
  clip([B.x0 - 1, BASE_Y, B.z0], [B.x0, 30, B.z1]);
  clip([B.x1, BASE_Y, B.z0], [B.x1 + 1, 30, B.z1]);
  clip([B.x0, BASE_Y, B.z0 - 1], [B.x1, 30, B.z0]);
  clip([B.x0, BASE_Y, B.z1], [B.x1, 30, B.z1 + 1]);
  // the world goes on past the ground's edge, at the road's level (no colliders: nobody can reach it)
  deco([BOUNDS.x0 - 90, YARD.road - 0.12, BOUNDS.z0 - 90], [X_QUAY, YARD.road - 0.02, BOUNDS.z0], '#3a3b3e');
  deco([BOUNDS.x0 - 90, YARD.road - 0.12, BOUNDS.z1], [X_QUAY, YARD.road - 0.02, BOUNDS.z1 + 90], '#3a3b3e');
  deco([BOUNDS.x0 - 90, YARD.road - 0.12, BOUNDS.z0], [BOUNDS.x0, YARD.road - 0.02, BOUNDS.z1], '#3a3b3e');

  /* ------------------------------------------------------------- forms */
  const forms = formBoxes(F);
  const upperAt = (x: number, z: number) => HU[Math.min(N - 1, Math.max(0, Math.floor(zToV(z)))) * N + Math.min(N - 1, Math.max(0, Math.floor(xToU(x))))];
  for (const f of forms) {
    let cx = (f.x0 + f.x1) / 2;
    let cz = (f.z0 + f.z1) / 2;
    const w = f.x1 - f.x0;
    const d = f.z1 - f.z0;
    const top = upperAt(cx, cz);
    // the APC stood on the APC spawn pad (bodies got stuck in it): parked at the west end of its lot
    if (f.form === FORM.apc) { cx = P(-12.5); cz = P(22.5); }
    const g = f.form === FORM.sailboat ? YARD.water : groundAt(cx, cz);
    switch (f.form) {
      case FORM.lift1: case FORM.lift2: case FORM.lift3: scissorLift(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.treehouse: buildTreehouse(cx, g, cz, w, d, top); break;
      case FORM.apc: apc(w, d, top).place(b, physics, cx, g, cz); lights.push({ pos: new THREE.Vector3(cx + 3, g + 4.2, cz - 2), dir: new THREE.Vector3(-0.4, -0.5, 0.75).normalize(), color: '#fff4d8', kind: 'flood' }); break;
      case FORM.gazebo: gazebo(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.pergola: pergola(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.sailboat: sailboat(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.container: container(w, d, top).place(b, physics, cx, g, cz); break;
      case FORM.spawnPad: spawnPad(cx, g, cz, w, d); break;
      case FORM.vent: roofVent(cx, cz, top); break;
      default: break; // CCTV cams A / B: House cameras (MapBuilder, CCTVS)
    }
  }
  // the SW neighbour house (zone 14): walls up to H_upper, a stepped hip roof, lit windows
  {
    const r = zoneBox(Z, ZONE.neighbor);
    if (r) {
      const g = groundAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
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
  // police cruisers: the supplied 11 placements (u, v, yaw on the top view), stood on the ground under them; five moved
  // off what the new ground put under them (a kerb, the yard's wall, a lawn bank) onto the road or a lot beside
  const MOVED: Record<number, { x?: number; z?: number; yawDeg?: number }> = { 2: { z: -21.6 }, 5: { x: -27.75, yawDeg: 85 }, 6: { x: -27.5, z: 7.0 }, 7: { x: 17.0, z: -7.0 }, 10: { x: 17.0 } };
  HOUSE_POLICE_CRUISERS.forEach((c, i) => {
    const m = MOVED[i] ?? {};
    const x = m.x !== undefined ? P(m.x) : uToX(c.u);
    const z = m.z !== undefined ? P(m.z) : vToZ(c.v);
    // the model's long axis is world X at yaw 0; top-view yaw turns clockwise on the image (+X → +Z)
    const yaw = -((m.yawDeg ?? c.yawDeg) * Math.PI) / 180;
    let y = -Infinity;
    for (const lx of [-2.3, 0, 2.3]) for (const lz of [-0.9, 0.9]) y = Math.max(y, groundAt(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)));
    cruiser().place(b, physics, x, y, z, yaw);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 1.2), [
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
    ]);
    bar.position.set(x, y + 1.5, z);
    bar.rotation.y = yaw;
    scene.add(bar);
    policeBars.push(bar);
    lights.push({ pos: new THREE.Vector3(x, y + 1.9, z), color: '#ff3040', kind: 'police' });
  });

  /* ------------------------------------------------------------- dressing (context: lamps, trees, walls' pillars, site, docks) */
  const lamp = (x: number, z: number, dx = 1) => {
    const y = groundAt(x, z);
    const k = new Kit('metal');
    k.cyl(0, 0, 0, 5.2, 0.08, '#3a3d42').box([-0.06, 5.1, -0.06], [dx * 1.1, 5.2, 0.06], '#3a3d42');
    k.place(b, physics, x, y, z);
    glow.box([x + dx * 0.8, y + 4.95, z - 0.18], [x + dx * 1.25, y + 5.08, z + 0.18], new THREE.Color('#ffd28a'));
    lights.push({ pos: new THREE.Vector3(x + dx * 1.0, y + 4.9, z), color: '#ffc27a', kind: 'lamp' });
  };
  // street lamps on the sidewalks and the quay (arms over the road)
  for (const [x, z, dx] of [[-8, -16.2, 1], [8, -16.2, -1], [-15.2, 9.5, 1], [-1, 22.4, 1], [13.3, 21.5, 1], [13.3, -12, 1], [22.5, 14, -1]]) lamp(P(x), P(z), dx);
  const tree = (x: number, z: number, s = 1) => {
    const y = groundAt(x, z);
    const k = new Kit('wood');
    k.cyl(0, 0, 0, 2.4 * s, 0.17 * s, '#4a3826');
    k.place(b, physics, x, y, z);
    // foliage: no collider (leaves neither stop a body nor a bullet)
    b.geom(new THREE.IcosahedronGeometry(1.7 * s, 0), new THREE.Matrix4().makeTranslation(x, y + 3.4 * s, z), new THREE.Color('#3d5530'));
  };
  for (const [x, z, s] of [[-20, -12, 1.2], [-19, 2, 1.1], [-22, 6, 1.0], [-12.5, -10.5, 0.9], [10.8, -12, 1.0], [-12.8, 14.5, 1.0], [8.5, 15, 1.1], [-24, -4, 1.3]]) tree(P(x), P(z), s);
  // stone pillars along the front yard's walls (the screenshots): at the ends, beside the flights and every ~4 m
  for (const w of T.solids) {
    if (w.color !== '#a69b88' || typeof w.top !== 'number' || w.r.z1 - w.r.z0 > 0.5) continue; // the yard's walls along X
    const n = Math.max(1, Math.round((w.r.x1 - w.r.x0) / 4));
    for (let k = 0; k <= n; k++) {
      // (1.5 cm in from the wall's ends: flush, the two end faces would flicker)
      const x = THREE.MathUtils.clamp(w.r.x0 + ((w.r.x1 - w.r.x0) * k) / n, w.r.x0 + 0.24, w.r.x1 - 0.24);
      const cz = (w.r.z0 + w.r.z1) / 2;
      solid([x - 0.225, w.top - 0.01, cz - 0.225], [x + 0.225, w.top + 0.3, cz + 0.225], '#b3a893');
    }
  }
  // the front walk: paving on both terraces between the flights
  {
    const f1 = stairRect('steps_front_1'), f2 = stairRect('steps_front_2'), fp = stairRect('steps_porch');
    deco([f1.x0, YARD.lowerTerrace, f1.z1], [f1.x1, YARD.lowerTerrace + 0.02, f2.z0], '#a29d92');
    deco([f2.x0, YARD.upperTerrace, f2.z1], [f2.x1, YARD.upperTerrace + 0.02, fp.z0], '#a29d92');
  }
  deco([P(-4.9), YARD.backYard, P(6.95)], [P(-3.7), YARD.backYard + 0.02, P(10)], '#a29d92'); // back walk
  // road markings: the north road's centre line, the east road's (tilted with the road where it falls)
  for (let x = B.x0 + 2; x < ROAD_E.x0 - 2; x += 6) deco([x, YARD.road, (ROAD_N.z0 + ROAD_N.z1) / 2 - 0.1], [x + 3, YARD.road + 0.012, (ROAD_N.z0 + ROAD_N.z1) / 2 + 0.1], '#d8c65a');
  for (let z = ROAD_N.z1 + 2; z < B.z1 - 2; z += 6) {
    const cx = (ROAD_E.x0 + ROAD_E.x1) / 2;
    const y0 = eastRoadY(z), y1 = eastRoadY(z + 3);
    const theta = Math.atan2(y1 - y0, 3);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, (y0 + y1) / 2 + 0.006, z + 1.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta), new THREE.Vector3(1, 1, 1));
    b.tbox(m, 0.2, 0.012, Math.hypot(3, y1 - y0), new THREE.Color('#d8c65a'));
  }
  // construction site: fence panels on its wall (a gate in line with the House's front walk), pipes, lights
  {
    const zf = ROAD_N.z0 - 0.15 - 1.6 - 0.175;
    for (let x = P(-14); x < P(13); x += 3) {
      if (x + 2.6 > P(-1.5) && x < P(1.5)) continue;
      const k = new Kit('metal');
      k.box([0, 0, -0.03], [2.6, 1.9, 0.03], '#9aa0a2');
      k.place(b, physics, x, YARD.sidewalk + 0.6, zf);
    }
    for (const [x, z] of [[P(-9), P(-33)], [P(-9), P(-33) - 1.6]]) {
      // concrete pipes lying along X: a horizontal cylinder
      b.geom(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 10, 1, true), new THREE.Matrix4().compose(new THREE.Vector3(x, YARD.site + 0.75, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(1, 1, 1)), new THREE.Color('#9a968c'));
      physics.addCylinder(x, YARD.site + 0.75, z, 1.1, 0.75, { kind: 'static', mat: 'concrete', exterior: true }, undefined, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    }
    lights.push({ pos: new THREE.Vector3(P(1), 6.5, P(-24)), dir: new THREE.Vector3(0, -0.6, -1).normalize(), color: '#fff0c8', kind: 'flood' });
    // the skeleton of the building going up beyond the fence line (backdrop: past the map edge)
    for (const x of [-12, -6, 0, 6, 12].map(P)) for (const z of [-46, -41].map(P)) deco([x - 0.25, YARD.site - 0.1, z - 0.25], [x + 0.25, 6.8, z + 0.25], '#8b8983');
    deco([P(-12) - 0.4, 2.6, P(-46) - 0.4], [P(12) + 0.4, 2.9, P(-41) + 0.4], '#8b8983');
    deco([P(-12) - 0.4, 6.6, P(-46) - 0.4], [P(12) + 0.4, 6.9, P(-41) + 0.4], '#8b8983');
  }
  // docks: crates and barrels on the quay
  for (const [x, z, s] of [[21.5, 14, 1.1], [22.6, 14, 1.1], [21.9, 15.2, 1.0], [23.8, 22, 1.2]].map(([x, z, s]) => [P(x), P(z), s])) solid([x - s / 2, quayY(z), z - s / 2], [x + s / 2, quayY(z) + s, z + s / 2], '#8a6b42', 'wood');
  for (const [x, z] of [[23.6, 17.5], [24.2, 17.9]].map(([x, z]) => [P(x), P(z)])) { const k = new Kit('metal'); k.cyl(0, 0, 0, 0.9, 0.3, '#3b5f8a'); k.place(b, physics, x, quayY(z), z); }
  // APC lot: sandbags and a barrier (clear of the spawn pad)
  for (const [x, z, w, dd] of [[-10.5, 21.5, 0.6, 3], [-3.0, 19.8, 3, 0.6]].map(([x, z, w, dd]) => [P(x), P(z), w, dd])) {
    const g = groundAt(x, z);
    solid([x - w / 2, g - 0.05, z - dd / 2], [x + w / 2, g + 0.9, z + dd / 2], '#8a7c5c', 'dirt');
  }

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
    // (the sides between the ends: stripes that overlap at the corners would flicker)
    deco([cx - hw, g, cz - hd], [cx + hw, g + 0.012, cz - hd + 0.12], c);
    deco([cx - hw, g, cz + hd - 0.12], [cx + hw, g + 0.012, cz + hd], c);
    deco([cx - hw, g, cz - hd + 0.12], [cx - hw + 0.12, g + 0.012, cz + hd - 0.12], c);
    deco([cx + hw - 0.12, g, cz - hd + 0.12], [cx + hw, g + 0.012, cz + hd - 0.12], c);
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

