// The ground outside the House (terrain.ts), checked on the data and on the built colliders: the agreed levels, one smooth
// walkable surface (no boxes, no cliffs where there is no wall), the garage drive flush with the road, the front yard
// climbing in two terraces and the porch stairs to a door nobody on the ground in front can see into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildOutdoor } from '../../src/map/Outdoor.ts';
import { decodeHouseDatamap512Headless } from '../../src/map/houseDatamap.ts';
import { DRIVEWAY, FLOOR_Y, OPENING_DIMS, SPAWN_ZONES, STAIRS, YARD } from '../../src/map/houseLayout.ts';
import { EAST_FALL, ROAD_E, ROAD_N, X_QUAY, eastRoadY, terrain } from '../../src/map/terrain.ts';
import { P } from '../../src/map/plan.ts';
import { buildWalkGrid, nearestFit, reach, surfaceAt } from '../../src/map/walkGrid.ts';

const T = terrain();

test('the agreed levels: road −2.4, sidewalk −2.25, terraces −1.8 / −1.2, porch 0; the east road down to the garage level', () => {
  const at = (x: number, z: number) => T.y(P(x), P(z));
  const near = (v: number, want: number, what: string) => assert.ok(Math.abs(v - want) < 0.02, `${what}: ${v.toFixed(2)}, want ${want}`);
  near(at(0, -21), YARD.road, 'north road');
  near(at(5, -16), YARD.sidewalk, 'sidewalk in front of the House');
  near(at(5, -13.5), YARD.lowerTerrace, 'lower terrace');
  near(at(5, -10), YARD.upperTerrace, 'upper terrace');
  near(at(-12, 0), YARD.westYard, 'west yard');
  near(at(0, 8), YARD.backYard, 'back yard');
  near(at(-27, -30), YARD.site, 'construction site');
  // the east road: level with the north road at the corner, then down evenly (no step) to the garage level at the drive
  near(eastRoadY(EAST_FALL.z0), YARD.road, 'east road at the corner');
  near(eastRoadY(DRIVEWAY.z0), YARD.garage, 'east road at the drive');
  let worst = 0;
  for (let z = EAST_FALL.z0; z < DRIVEWAY.z0; z += 0.5) worst = Math.max(worst, Math.abs(eastRoadY(z + 0.5) - eastRoadY(z)) / 0.5);
  assert.ok(worst < Math.tan((5 * Math.PI) / 180), `east road grade ${(Math.atan(worst) * 180 / Math.PI).toFixed(1)}° (gentle: < 5°)`);
  // the river is below the quay
  assert.ok(T.y(X_QUAY + 2, 0) < YARD.water - 0.5, 'river bed under the water');
});

test('the spawn pads stand where the ground is (layout heights = terrain)', () => {
  for (const s of SPAWN_ZONES) assert.ok(Math.abs(T.y(s.center[0], s.center[2]) - s.center[1]) < 0.02, `${s.id}: layout ${s.center[1]}, ground ${T.y(s.center[0], s.center[2]).toFixed(2)}`);
});

test('the garage drive is flush: garage floor = drive = east road, no ramp', () => {
  const z = (DRIVEWAY.z0 + DRIVEWAY.z1) / 2;
  for (let x = DRIVEWAY.x0 + 0.1; x < ROAD_E.x1; x += 0.25) {
    const y = T.y(x, z);
    assert.ok(Math.abs(y - FLOOR_Y[-1]) < 0.02, `drive at x ${x.toFixed(2)}: ${y.toFixed(2)} (garage floor ${FLOOR_Y[-1]})`);
  }
});

test('the open ground is gentle and walkable: outside the walls, kerbs and flights nothing over 40°, nearly all under 15°', () => {
  const { xs, zs, hs, cell, stripCell } = T;
  const nx = xs.length;
  const steep: string[] = [];
  let cells = 0, gentle = 0;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * (nx - 1) + i;
      if (cell[k] < 0 || stripCell[k]) continue;
      // the river bed under the quay wall is not walked on
      if (xs[i] >= X_QUAY - 1e-6) continue;
      cells++;
      const h = (a: number, b: number) => hs[(j + b) * nx + i + a];
      const dx = Math.max(Math.abs(h(1, 0) - h(0, 0)), Math.abs(h(1, 1) - h(0, 1))), dz = Math.max(Math.abs(h(0, 1) - h(0, 0)), Math.abs(h(1, 1) - h(1, 0)));
      const deg = (Math.atan(Math.hypot(dx / (xs[i + 1] - xs[i]), dz / (zs[j + 1] - zs[j]))) * 180) / Math.PI;
      // (a seam of a few centimetres across a sliver of a cell is no slope: the feet don't notice it)
      if (deg <= 15 || Math.max(dx, dz) <= 0.06) gentle++;
      else if (deg > 40) steep.push(`(${((xs[i] + xs[i + 1]) / 2).toFixed(1)}, ${((zs[j] + zs[j + 1]) / 2).toFixed(1)}) ${deg.toFixed(0)}°`);
    }
  }
  assert.ok(cells > 5000, `${cells} cells`);
  assert.deepEqual(steep, []);
  assert.ok(gentle / cells > 0.97, `${((100 * gentle) / cells).toFixed(1)} % of the open ground under 15°`);
});

test('the 1F windows over the front yard: someone standing on the ground there is below the sill (not seen from inside)', () => {
  const sill = FLOOR_Y[0] + OPENING_DIMS.window.y0;
  for (const y of [YARD.upperTerrace, YARD.lowerTerrace, YARD.sidewalk]) assert.ok(y + 1.8 < sill, `head at ${(y + 1.8).toFixed(2)} vs sill ${sill}`);
});

test('from the road up the front walk to the front door: sidewalk → steps → lower terrace → steps → upper terrace → 7 porch steps → porch', async () => {
  const ph = await Physics.create();
  buildHouse(ph, new DestructionSystem(ph), new THREE.Scene());
  buildOutdoor(ph, new THREE.Scene(), decodeHouseDatamap512Headless());
  ph.world.step();
  const flights = ['steps_front_1', 'steps_front_2', 'steps_porch'].map((id) => STAIRS.find((s) => s.id === id)!);
  assert.equal(flights[2].steps, 7);
  const x = (flights[0].rect.x0 + flights[0].rect.x1) / 2;
  const area = { x0: x - 2, z0: ROAD_N.z1 - 1, x1: x + 2, z1: P(-4.0) };
  const g = buildWalkGrid(ph, area, 0.1);
  const seed = nearestFit(g, x, YARD.road, (ROAD_N.z0 + ROAD_N.z1) / 2 + 3.2, 'stand', 0.5, 0.5);
  assert.ok(seed >= 0, 'standing room on the road');
  const r = reach(g, [seed], ['stand']);
  // every level on the way is reached upright, and the porch at the front door
  for (const [z, y, what] of [[P(-16), YARD.sidewalk, 'sidewalk'], [P(-13.5), YARD.lowerTerrace, 'lower terrace'], [P(-10), YARD.upperTerrace, 'upper terrace'], [P(-6.0), 0, 'porch at the front door']] as const) {
    const s = surfaceAt(g, x, y, z, 0.1);
    assert.ok(s >= 0 && r.bits[s] & 1, `${what} at (${x.toFixed(1)}, ${y}, ${z.toFixed(1)}) not reached upright from the road`);
  }
});
