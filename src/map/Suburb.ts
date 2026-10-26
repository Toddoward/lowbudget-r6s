import * as THREE from 'three';
import { G_CLIP, type Physics, type SurfaceMaterial } from '../core/Physics.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { PAL, vcMaterial } from '../render/palette.ts';
import { DRIVEWAY, GROUND_Y, LOWER_GROUND_Y, MAP_BOUNDS, VENT_SHAFT, type Rect } from './houseLayout.ts';
import { subtractRects } from './geometry.ts';

/**
 * Surrounding suburb: two-level terrain (street level y=-0.25 on the W/N/S,
 * river level y=-3.5 on the E, reaching the garage driveway), the four attacker spawn areas, roads, police
 * cruisers, the APC, the construction site skeleton, the docks and a ring of
 * low-poly neighbour-house silhouettes. Everything that blocks has a collider.
 */
export interface StreetLight { pos: THREE.Vector3; dir?: THREE.Vector3; color: string; kind: 'lamp' | 'police' | 'flood' | 'porch' }
export interface SuburbWorld { lights: StreetLight[]; policeBars: THREE.Mesh[]; water: THREE.Mesh; windowGlow: THREE.Mesh }

export function buildSuburb(physics: Physics, scene: THREE.Scene): SuburbWorld {
  const b = new BoxBatch();
  const glow = new BoxBatch();
  const lights: StreetLight[] = [];
  const policeBars: THREE.Mesh[] = [];
  const solid = (min: number[], max: number[], c: THREE.Color | string, mat: SurfaceMaterial = 'concrete', side?: THREE.Color) => {
    const col = typeof c === 'string' ? new THREE.Color(c) : c;
    b.box(min, max, col, side ?? col.clone().multiplyScalar(0.75), 1);
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat, exterior: true });
  };
  const deco = (min: number[], max: number[], c: string) => b.box(min, max, new THREE.Color(c));

  /* ------------------------------------------------------------- terrain */
  const B = MAP_BOUNDS;
  const RIVER_X = DRIVEWAY.x1; // the lot drops to river level east of here
  const upper: Rect = { x0: B.x0, z0: B.z0, x1: RIVER_X, z1: B.z1 };
  // everything below grade that the House occupies + the sunken areas around it
  const holes: Rect[] = [
    { x0: -7.4, z0: -7.55, x1: -1.55, z1: -4.65 }, // storage
    { x0: -8.1, z0: -4.95, x1: 7.35, z1: -0.45 },
    { x0: -8.1, z0: -0.75, x1: 9.85, z1: 0.7 },
    { x0: -8.8, z0: 0.4, x1: 9.85, z1: 3.85 }, // (the B side stairs reach out to x −8.65 only south of z 0.55)
    { x0: -9.6, z0: 1.0, x1: -8.5, z1: 3.4 }, // bay
    { x0: -5.6, z0: 3.55, x1: 9.85, z1: 5.0 },
    { x0: -5.6, z0: 4.7, x1: 2.2, z1: 6.6 }, // back hallway (under the back deck)
    { x0: -14.0, z0: -7.6, x1: -7.25, z1: -5.4 }, // storage stairwell
    DRIVEWAY,
    VENT_SHAFT,
  ];
  for (const r of subtractRects(upper, holes)) {
    solid([r.x0, LOWER_GROUND_Y - 0.4, r.z0], [r.x1, GROUND_Y, r.z1], PAL.grass, 'dirt', PAL.concreteDark);
  }
  // pit floors
  solid([-14.0, LOWER_GROUND_Y - 0.4, -7.6], [-7.25, LOWER_GROUND_Y - 0.02, -5.4], PAL.concreteDark);
  solid([VENT_SHAFT.x0, LOWER_GROUND_Y - 0.4, VENT_SHAFT.z0], [VENT_SHAFT.x1, LOWER_GROUND_Y, VENT_SHAFT.z1], PAL.concreteDark);
  // vent shaft grille at grade (drones drop through, boots don't)
  for (let k = 0; k <= 5; k++) {
    const x = VENT_SHAFT.x0 + ((VENT_SHAFT.x1 - VENT_SHAFT.x0) * k) / 5;
    deco([x - 0.012, GROUND_Y - 0.03, VENT_SHAFT.z0], [x + 0.012, GROUND_Y + 0.01, VENT_SHAFT.z1], '#2b2e33');
  }
  physics.addBox((VENT_SHAFT.x0 + VENT_SHAFT.x1) / 2, GROUND_Y + 0.3, (VENT_SHAFT.z0 + VENT_SHAFT.z1) / 2, (VENT_SHAFT.x1 - VENT_SHAFT.x0) / 2, 0.3, (VENT_SHAFT.z1 - VENT_SHAFT.z0) / 2, { kind: 'static', mat: 'metal' }, undefined, G_CLIP);
  // sunken garage driveway (river level) in front of both shutters
  solid([DRIVEWAY.x0, LOWER_GROUND_Y - 0.4, DRIVEWAY.z0], [DRIVEWAY.x1, LOWER_GROUND_Y, DRIVEWAY.z1], '#55575a');
  // lower river-level yard
  solid([RIVER_X, LOWER_GROUND_Y - 0.5, B.z0], [36, LOWER_GROUND_Y, B.z1], PAL.dirt, 'dirt');
  // river bed + water
  solid([36, -5.2, B.z0], [B.x1, -4.6, B.z1], '#3b4a45', 'dirt');
  const water = new THREE.Mesh(new THREE.PlaneGeometry(B.x1 - 36 + 40, B.z1 - B.z0), new THREE.MeshStandardMaterial({ color: PAL.water, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set((36 + B.x1 + 40) / 2, -4.2, 0);
  water.receiveShadow = true;
  scene.add(water);

  // wedge ramps from street level down to the river yard (NE + SE)
  for (const [z0, z1] of [[-14, -10.5], [14, 17.5]]) {
    const x0 = RIVER_X, x1 = RIVER_X + 11;
    const run = x1 - x0;
    const rise = GROUND_Y - LOWER_GROUND_Y;
    const theta = Math.atan2(rise, run);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -theta);
    const L = Math.hypot(run, rise);
    const cx = (x0 + x1) / 2;
    const cy = (GROUND_Y + LOWER_GROUND_Y) / 2 - 0.15 / Math.cos(theta);
    physics.addBox(cx, cy, (z0 + z1) / 2, L / 2, 0.15, (z1 - z0) / 2, { kind: 'static', mat: 'concrete', exterior: true }, q);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1));
    b.tbox(m, L, 0.3, z1 - z0, new THREE.Color('#6d6b66'));
    const shape = new THREE.Shape([new THREE.Vector2(x0, GROUND_Y), new THREE.Vector2(x1, LOWER_GROUND_Y), new THREE.Vector2(x0, LOWER_GROUND_Y)]);
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
    b.geom(wedge, new THREE.Matrix4().makeTranslation(0, 0, z0), new THREE.Color('#6a5f4e'));
    wedge.dispose();
  }

  /* ------------------------------------------------------------- roads */
  const road = (x0: number, z0: number, x1: number, z1: number, y = GROUND_Y) => {
    deco([x0, y, z0], [x1, y + 0.02, z1], '#3a3b3e');
  };
  road(B.x0, -21.5, RIVER_X, -15.5); // front street (north, in front of the porch)
  for (let x = B.x0 + 2; x < RIVER_X - 3; x += 6) deco([x, GROUND_Y + 0.02, -18.6], [x + 3, GROUND_Y + 0.03, -18.4], '#d8c65a');
  deco([B.x0, GROUND_Y, -15.5], [RIVER_X, GROUND_Y + 0.08, -14.2], '#9a978f'); // sidewalk
  road(-26, -15.5, -16, B.z1); // west avenue (to the APC checkpoint)
  for (let z = -12; z < B.z1; z += 6) deco([-21.1, GROUND_Y + 0.02, z], [-20.9, GROUND_Y + 0.03, z + 3], '#d8c65a');
  road(-26, 26, RIVER_X, 34); // side street (south)
  road(RIVER_X, 26, 36, 34, LOWER_GROUND_Y);
  for (let x = -24; x < 34; x += 6) deco([x, (x < RIVER_X ? GROUND_Y : LOWER_GROUND_Y) + 0.02, 29.9], [x + 3, (x < RIVER_X ? GROUND_Y : LOWER_GROUND_Y) + 0.03, 30.1], '#e8e4d6');
  // front walk from the sidewalk to the porch steps
  deco([-0.9, GROUND_Y, -14.2], [1.1, GROUND_Y + 0.03, -7.35], '#a29d92');
  // back walk from the back porch to the side street
  deco([-4.9, GROUND_Y, 6.95], [-3.7, GROUND_Y + 0.03, 26], '#a29d92');
  // picket fence along the front yard (gap at the walk)
  for (const [x0, x1] of [[-13, -1.4], [1.6, RIVER_X - 0.4]]) {
    deco([x0, GROUND_Y, -13.65], [x1, GROUND_Y + 0.9, -13.55], '#e9e6dc');
    physics.addBox((x0 + x1) / 2, GROUND_Y + 0.45, -13.6, (x1 - x0) / 2, 0.45, 0.05, { kind: 'static', mat: 'wood' }, undefined, G_CLIP);
  }
  // hedges
  solid([-9.5, GROUND_Y, -12.6], [-6.5, GROUND_Y + 1.1, -11.6], '#3f5a2e', 'fabric');
  solid([4.5, GROUND_Y, -12.6], [7.5, GROUND_Y + 1.1, -11.6], '#3f5a2e', 'fabric');
  // mailbox
  deco([2.0, GROUND_Y, -14.0], [2.1, GROUND_Y + 1.0, -13.9], '#333');
  deco([1.85, GROUND_Y + 1.0, -14.15], [2.25, GROUND_Y + 1.25, -13.75], '#2b4f7a');

  /* --------------------------------------------------- street lamps */
  const lamp = (x: number, z: number, y = GROUND_Y, dx = 1) => {
    deco([x - 0.08, y, z - 0.08], [x + 0.08, y + 5.2, z + 0.08], '#3a3d42');
    deco([x - 0.06, y + 5.1, z - 0.06], [x + dx * 1.1, y + 5.2, z + 0.06], '#3a3d42');
    glow.box([x + dx * 0.8, y + 4.95, z - 0.18], [x + dx * 1.25, y + 5.08, z + 0.18], new THREE.Color('#ffd28a'));
    physics.addBox(x, y + 2.6, z, 0.1, 2.6, 0.1, { kind: 'static', mat: 'metal', exterior: true });
    lights.push({ pos: new THREE.Vector3(x + dx * 1.0, y + 4.9, z), color: '#ffc27a', kind: 'lamp' });
  };
  lamp(-8, -14.6, GROUND_Y, 1); lamp(8, -14.6, GROUND_Y, -1); lamp(-15, 12, GROUND_Y, -1); lamp(-4, 25.5); lamp(16, 25.5, LOWER_GROUND_Y); lamp(-15, 40, GROUND_Y, -1);
  lamp(24, -8, LOWER_GROUND_Y, -1);

  /* --------------------------------------------------- police cruisers */
  const cruiser = (x: number, z: number, rotY: number, y = GROUND_Y) => {
    const g = new BoxBatch();
    const W = '#e8e8e4', K = '#16181b';
    g.box([-0.9, 0.3, -2.3], [0.9, 0.95, 2.3], new THREE.Color(K));
    g.box([-0.92, 0.55, -1.0], [0.92, 0.95, 1.4], new THREE.Color(W));
    g.box([-0.8, 0.95, -0.9], [0.8, 1.45, 1.0], new THREE.Color(K));
    g.box([-0.78, 1.0, -0.95], [0.78, 1.38, -0.9], new THREE.Color('#7fa5b5'));
    for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box([wx * 0.82 - 0.1, 0, wz * 1.45 - 0.33], [wx * 0.82 + 0.1, 0.62, wz * 1.45 + 0.33], new THREE.Color('#111'));
    const mesh = new THREE.Mesh(g.build(), vcMaterial());
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.25), [
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: '#2050ff', toneMapped: false }),
    ]);
    bar.position.set(0, 1.52, 0.1);
    mesh.add(bar);
    policeBars.push(bar);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    physics.addBox(x, y + 0.75, z, 0.9, 0.75, 2.3, { kind: 'static', mat: 'vehicle', exterior: true }, q);
    lights.push({ pos: new THREE.Vector3(x, y + 1.7, z), color: '#ff3040', kind: 'police' });
  };
  cruiser(-5, 30, Math.PI / 2 + 0.3);
  cruiser(4, 31.5, Math.PI / 2 - 0.2);
  cruiser(-20, 8, 0.15);
  cruiser(-14, -18.5, Math.PI / 2 + 0.1);

  /* --------------------------------------------------- APC area (SW) */
  {
    const ax = -34, az = 24, y = GROUND_Y;
    const g = new BoxBatch();
    const O = new THREE.Color('#3f4636'), D = new THREE.Color('#2b3026');
    g.box([-1.3, 0.6, -3.4], [1.3, 2.0, 3.0], O, D);
    g.box([-1.1, 2.0, -1.2], [1.1, 2.5, 2.4], O, D);
    g.box([-0.9, 1.2, -3.9], [0.9, 2.0, -3.4], D);
    g.box([-0.35, 2.5, 0.2], [0.35, 2.95, 1.2], D); // turret
    g.box([-0.07, 2.65, -1.4], [0.07, 2.79, 0.2], new THREE.Color('#222'));
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.box([s * 1.3 - 0.18, 0, -2.6 + i * 1.6 - 0.45], [s * 1.3 + 0.18, 0.95, -2.6 + i * 1.6 + 0.45], new THREE.Color('#141414'));
    const mesh = new THREE.Mesh(g.build(), vcMaterial());
    mesh.position.set(ax, y, az);
    mesh.rotation.y = 0.6;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    physics.addBox(ax, y + 1.25, az, 1.3, 1.25, 3.5, { kind: 'static', mat: 'vehicle', exterior: true }, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6));
    // sandbag walls + floodlight + barriers
    for (const [x, z, w, d] of [[-30, 32, 4, 0.6], [-40, 28, 0.6, 4], [-36, 36, 3.5, 0.6], [-28, 22, 0.6, 3]]) solid([x - w / 2, y, z - d / 2], [x + w / 2, y + 0.9, z + d / 2], '#8a7c5c', 'dirt');
    deco([-41, y, 20], [-40.8, y + 4.2, 20.2], '#333');
    glow.box([-41.2, y + 4.0, 20.2], [-40.6, y + 4.5, 20.4], new THREE.Color('#fff4d0'));
    lights.push({ pos: new THREE.Vector3(-40.9, y + 4.2, 20.6), dir: new THREE.Vector3(0.7, -0.3, 0.6).normalize(), color: '#fff4d8', kind: 'flood' });
    for (let i = 0; i < 4; i++) solid([-30 + i * 2.2, y, 38], [-28.4 + i * 2.2, y + 0.9, 38.4], i % 2 ? '#e0e0dc' : '#c8352a', 'concrete');
  }

  /* --------------------------------------------------- construction site (N) */
  {
    const y = GROUND_Y;
    const C = new THREE.Color('#8b8983');
    // two-storey concrete skeleton
    for (const x of [-14, -8, -2, 4, 10]) for (const z of [-52, -46]) solid([x - 0.25, y, z - 0.25], [x + 0.25, y + 8, z + 0.25], C);
    solid([-14.4, y + 3.8, -52.4], [10.4, y + 4.1, -45.6], C);
    solid([-14.4, y + 7.8, -52.4], [10.4, y + 8.1, -45.6], C);
    // scaffolding
    for (let i = 0; i < 7; i++) deco([-14 + i * 4, y, -44.8], [-13.9 + i * 4, y + 8, -44.7], '#c47b2a');
    solid([-14.2, y + 3.9, -45.2], [10.2, y + 4.0, -44.5], '#7a5b33', 'wood');
    // containers
    const container = (x: number, z: number, col: string, rot = false) => rot
      ? solid([x - 1.25, y, z - 3], [x + 1.25, y + 2.6, z + 3], col, 'metal')
      : solid([x - 3, y, z - 1.25], [x + 3, y + 2.6, z + 1.25], col, 'metal');
    container(-12, -30, '#2f5a7a'); container(8, -32, '#8a3b2b', true); container(-3, -26, '#4e6b3a'); container(14, -40, '#7a6a2b');
    solid([-12.9, y + 2.6, -31.2], [-11.1, y + 5.2, -28.8], '#8a3b2b', 'metal'); // stacked
    // concrete pipes
    for (const [x, z] of [[2, -38], [4.2, -38], [-6, -40]]) {
      b.geom(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 10, 1, true), new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.75, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)), new THREE.Color('#9a968c'));
      physics.addBox(x, y + 0.75, z, 0.75, 0.75, 1.1, { kind: 'static', mat: 'concrete', exterior: true });
    }
    // sand piles + portable toilet + fence
    b.geom(new THREE.ConeGeometry(2.5, 1.6, 7), new THREE.Matrix4().makeTranslation(16, y + 0.8, -28), new THREE.Color('#b59a6a'));
    physics.addBox(16, y + 0.5, -28, 1.6, 0.5, 1.6, { kind: 'static', mat: 'dirt', exterior: true });
    solid([-18, y, -36], [-16.8, y + 2.3, -34.8], '#2d6a9a', 'fabric');
    for (let x = -24; x < 24; x += 3) deco([x, y, -22.05], [x + 2.6, y + 1.9, -21.95], '#9aa0a2');
    // tower crane silhouette
    for (let k = 0; k < 10; k++) deco([20, y + k * 3, -52], [21.4, y + k * 3 + 0.12, -50.6], '#d9a21a');
    for (const [dx, dz] of [[0, 0], [1.3, 0], [0, 1.3], [1.3, 1.3]]) deco([20 + dx, y, -52 + dz], [20.1 + dx, y + 30, -51.9 + dz], '#d9a21a');
    deco([4, y + 29.6, -51.8], [36, y + 30.4, -50.8], '#d9a21a');
    deco([28, y + 20, -51.4], [28.05, y + 29.6, -51.35], '#222');
    glow.box([20.4, y + 30.6, -51.6], [20.9, y + 30.9, -51.1], new THREE.Color('#ff3020'));
    lights.push({ pos: new THREE.Vector3(-2, y + 7.5, -44), dir: new THREE.Vector3(0, -0.6, 1).normalize(), color: '#fff0c8', kind: 'flood' });
  }

  /* --------------------------------------------------- river docks (E) */
  {
    const y = LOWER_GROUND_Y;
    solid([30, y, -18], [44, y + 0.25, 20], '#6b5236', 'wood'); // main deck
    for (let x = 30.5; x < 44; x += 1.2) deco([x, y + 0.25, -18], [x + 0.05, y + 0.26, 20], '#4f3b26');
    for (const z of [-17, -8, 1, 10, 19]) for (const x of [36.5, 43.5]) deco([x - 0.18, -5, z - 0.18], [x + 0.18, y + 0.6, z + 0.18], '#4a3a28');
    solid([44, y, -3], [52, y + 0.2, 1], '#6b5236', 'wood'); // jetty
    // boat at the jetty
    const boat = new BoxBatch();
    boat.box([-1.2, -0.4, -3], [1.2, 0.6, 3], new THREE.Color('#e4e0d4'));
    boat.box([-0.9, 0.6, -0.5], [0.9, 1.6, 1.8], new THREE.Color('#2f4f6f'));
    const bm = new THREE.Mesh(boat.build(), vcMaterial());
    bm.position.set(48, -3.6, 4.5);
    bm.castShadow = true;
    scene.add(bm);
    physics.addBox(48, -3.0, 4.5, 1.2, 1.0, 3, { kind: 'static', mat: 'vehicle', exterior: true });
    // crates, barrels, warehouse
    for (const [x, z, s] of [[33, -10, 1.2], [34.3, -10, 1.2], [33.6, -10, 1.2], [39, 8, 1.0], [40.2, 8.6, 1.0], [32.5, 12, 1.4]]) solid([x - s / 2, y + 0.25, z - s / 2], [x + s / 2, y + 0.25 + s, z + s / 2], '#8a6b42', 'wood');
    for (const [x, z] of [[41, -6], [41.7, -6.4], [41.3, -5.4]]) {
      b.geom(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), new THREE.Matrix4().makeTranslation(x, y + 0.7, z), new THREE.Color('#3b5f8a'));
      physics.addBox(x, y + 0.7, z, 0.3, 0.45, 0.3, { kind: 'static', mat: 'metal', exterior: true });
    }
    solid([22, y, -40], [40, y + 7, -26], '#6f6a62', 'metal');
    deco([21.95, y + 1, -36], [22.0, y + 5, -30], '#3a3a38');
    lights.push({ pos: new THREE.Vector3(36, y + 4, -10), color: '#ffd8a0', kind: 'lamp' });
    deco([35.9, y, -10.1], [36.1, y + 4.2, -9.9], '#333');
  }

  /* --------------------------------------------------- neighbour silhouettes */
  const house = (x: number, z: number, w: number, d: number, h: number, y = GROUND_Y, col = '#b9b2a4') => {
    solid([x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2], col);
    const roof = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.4, 0), new THREE.Vector2(w / 2 + 0.4, 0), new THREE.Vector2(0, h * 0.5)]);
    const rg = new THREE.ExtrudeGeometry(roof, { depth: d + 0.8, bevelEnabled: false });
    b.geom(rg, new THREE.Matrix4().makeTranslation(x, y + h, z - d / 2 - 0.4), new THREE.Color('#4b4642'));
    rg.dispose();
    for (let i = 0; i < 3; i++) {
      const wx = x - w / 2 + (w * (i + 0.5)) / 3;
      glow.box([wx - 0.4, y + 1.2, z + d / 2 + 0.01], [wx + 0.4, y + 2.1, z + d / 2 + 0.04], new THREE.Color(i % 2 ? '#ffcf86' : '#ffe3b0'));
      glow.box([wx - 0.4, y + 1.2, z - d / 2 - 0.04], [wx + 0.4, y + 2.1, z - d / 2 - 0.01], new THREE.Color('#ffd79a'));
    }
  };
  const tones = ['#b9b2a4', '#a9b0b4', '#c2b49a', '#9fa69a', '#c8c0b0'];
  let k = 0;
  for (let z = -48; z <= 48; z += 14) { house(-36, z, 9, 8, 5.5, GROUND_Y, tones[k++ % 5]); house(-50, z + 6, 8, 9, 5, GROUND_Y, tones[k++ % 5]); }
  for (const x of [-12, 2, 18]) house(x, 46, 10, 8, 6, x > 8 ? LOWER_GROUND_Y : GROUND_Y, tones[k++ % 5]);
  house(24, 46, 10, 8, 6, LOWER_GROUND_Y, tones[k++ % 5]);
  house(-46, -40, 9, 9, 6, GROUND_Y, tones[k++ % 5]);
  // trees
  const tree = (x: number, z: number, y = GROUND_Y, s = 1) => {
    deco([x - 0.15 * s, y, z - 0.15 * s], [x + 0.15 * s, y + 2.2 * s, z + 0.15 * s], '#4a3826');
    b.geom(new THREE.IcosahedronGeometry(1.6 * s, 0), new THREE.Matrix4().makeTranslation(x, y + 3.3 * s, z), new THREE.Color('#3d5530'));
    physics.addBox(x, y + 1.1 * s, z, 0.2 * s, 1.1 * s, 0.2 * s, { kind: 'static', mat: 'wood', exterior: true });
  };
  for (const [x, z, s] of [[-16.5, -10, 1.1], [-12, 16, 1], [-14, 4, 1.2], [5, 18, 1], [-28, -10, 1.3], [-28, 12, 1.1], [-8, 22, 0.9], [16, -20, 1], [26, 18, 1.2], [-44, 4, 1.4], [16, 7, 0.9]]) tree(x, z, x > RIVER_X ? LOWER_GROUND_Y : GROUND_Y, s);
  // parked car on the street + the garden shed in the north yard
  solid([-24.5, GROUND_Y, -6], [-22.7, GROUND_Y + 1.4, -1.6], '#7a2b25', 'vehicle');
  solid([-15.5, GROUND_Y, 0.5], [-13, GROUND_Y + 2.4, 3.5], '#8b7d63', 'wood');
  // retaining-wall caps along the drop to the river yard
  for (const [z0, z1] of [[-58, -14], [-10.5, DRIVEWAY.z0], [DRIVEWAY.z1, 14], [17.5, 58]]) {
    deco([RIVER_X - 0.2, GROUND_Y, z0], [RIVER_X, GROUND_Y + 0.5, z1], '#77736b');
    physics.addBox(RIVER_X - 0.1, GROUND_Y + 0.45, (z0 + z1) / 2, 0.1, 0.45, (z1 - z0) / 2, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);
  }
  // driveway retaining-wall caps + rails
  for (const z of [DRIVEWAY.z0, DRIVEWAY.z1]) {
    deco([DRIVEWAY.x0, GROUND_Y, z - 0.1], [RIVER_X, GROUND_Y + 0.5, z + 0.1], '#77736b');
    physics.addBox((DRIVEWAY.x0 + RIVER_X) / 2, GROUND_Y + 0.45, z, (RIVER_X - DRIVEWAY.x0) / 2, 0.45, 0.1, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);
  }

  /* --------------------------------------------------- map bounds (clip) */
  const H = 40;
  physics.addBox(B.x0 - 0.5, 10, 0, 0.5, H, B.z1, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);
  physics.addBox(B.x1 + 0.5, 10, 0, 0.5, H, B.z1, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);
  physics.addBox(0, 10, B.z0 - 0.5, B.x1, H, 0.5, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);
  physics.addBox(0, 10, B.z1 + 0.5, B.x1, H, 0.5, { kind: 'static', mat: 'concrete' }, undefined, G_CLIP);

  const mesh = new THREE.Mesh(b.build(), vcMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'suburb';
  scene.add(mesh);
  const windowGlow = new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  windowGlow.name = 'window_glow';
  scene.add(windowGlow);
  return { lights, policeBars, water, windowGlow };
}
