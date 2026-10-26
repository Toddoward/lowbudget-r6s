// Walk maps for people: per level, what the clearance grid (src/map/walkGrid.ts)
// says about every 10 cm cell. One PNG per level band, 1 m grid lines.
//
//   node --experimental-transform-types --no-warnings tools/level/walkmap.ts <out-dir> [whole]
//
// colours
//   green   reached on foot, upright, from the attacker spawns
//   yellow  reached, but only crouched / prone (under tables, low gaps)
//   black   something solid at knee-to-head height (wall, prop, vehicle)
//   grey    free floor next to something solid: the body (r 0.36 m) cannot be centred here
//   red     free floor nobody can walk to (a sealed pocket, a roof, a table top)
//   dark    no surface at this level
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildOutdoor } from '../../src/map/Outdoor.ts';
import { decodeHouseDatamap512Headless } from '../../src/map/houseDatamap.ts';
import { MAP_BOUNDS, SPAWN_ZONES } from '../../src/map/houseLayout.ts';
import { buildWalkGrid, MAX_LAYERS, nearestFit, reach } from '../../src/map/walkGrid.ts';
import { png } from './png.ts';

const out = process.argv[2] ?? '.';
const whole = process.argv[3] === 'whole';
const ph = await Physics.create();
buildHouse(ph, new DestructionSystem(ph), new THREE.Scene());
buildOutdoor(ph, new THREE.Scene(), decodeHouseDatamap512Headless());
ph.world.step();
const AREA = { x0: MAP_BOUNDS.x0, z0: MAP_BOUNDS.z0, x1: MAP_BOUNDS.x1, z1: MAP_BOUNDS.z1 };
const g = buildWalkGrid(ph, AREA, 0.1);
const seeds = SPAWN_ZONES.map((z) => nearestFit(g, z.center[0], z.center[1], z.center[2], 'stand', 1.5, 1)).filter((s) => s >= 0);
const up = reach(g, seeds, ['stand']);
const any = reach(g, seeds);

const view = whole ? AREA : { x0: -13, z0: -13, x1: 15, z1: 10 };
const bands: [string, number, number][] = whole ? [['ground', -5, 1.6]] : [['B', -3.9, -1.6], ['1F', -0.45, 1.6], ['2F', 3.1, 5.2], ['roof', 6.5, 9]];
const K = whole ? 2 : 4;
for (const [name, lo, hi] of bands) {
  const W = Math.round((view.x1 - view.x0) / 0.1);
  const H = Math.round((view.z1 - view.z0) / 0.1);
  const img = Buffer.alloc(W * K * H * K * 3);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = view.x0 + (i + 0.5) * 0.1;
      const z = view.z0 + (j + 0.5) * 0.1;
      const c = Math.floor((z - g.z0) / g.cell + 0.5) * g.nx + Math.floor((x - g.x0) / g.cell + 0.5);
      let col = [24, 24, 28];
      for (let k = 0; k < g.n[c]; k++) {
        const s = c * MAX_LAYERS + k;
        const y = g.y[s];
        if (y < lo || y >= hi) continue;
        if (up.bits[s] & 1) col = [60, 185, 85];
        else if (any.bits[s]) col = [225, 200, 50];
        else if (g.fit[s]) col = [200, 70, 70];
        else col = ph.overlapsWorld(new THREE.Vector3(x, y + 1.0, z), 0.04) || ph.overlapsWorld(new THREE.Vector3(x, y + 0.5, z), 0.04) ? [10, 10, 10] : [120, 120, 125];
        break;
      }
      // 1 m grid
      if (Math.abs(x - Math.round(x)) < 0.05 || Math.abs(z - Math.round(z)) < 0.05) col = col.map((v) => Math.min(255, v + 28));
      for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) { const p = ((j * K + a) * W * K + i * K + b) * 3; img[p] = col[0]; img[p + 1] = col[1]; img[p + 2] = col[2]; }
    }
  }
  writeFileSync(`${out}/walk_${name}.png`, png(W * K, H * K, img));
  console.log(`${out}/walk_${name}.png  x ${view.x0}..${view.x1}, z ${view.z0}..${view.z1} (north up), ${K} px per 10 cm`);
}
