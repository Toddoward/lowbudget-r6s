/**
 * Export every procedural asset spec (weapons, operators, gadgets, House
 * architecture modules, furniture/cover, vehicles) plus the House layout to
 * JSON, as input for the CLI-Anything Blender pipeline (pipeline.py).
 *
 *   npm run assets:spec        → tools/cli-anything/build/specs/*.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPONS, weaponSpec } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';
import { operatorSpec } from '../../src/assets/operatorModels.ts';
import { hammerSpec, launcherSpec, chargeSpec, deviceSpec, throwableSpec, pulseSensorSpec, droneSpec } from '../../src/assets/weaponModels.ts';
import { box, cyl, type AssetSpec, type PartSpec } from '../../src/assets/spec.ts';
import { WALLS, FLOORS, STAIRS, HATCHES, ROOMS, SPAWN_ZONES, OPENING_DIMS, WALL_H, CELL } from '../../src/map/houseLayout.ts';
import { PROPS } from '../../src/map/houseProps.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'build', 'specs');
mkdirSync(out, { recursive: true });
const specs: AssetSpec[] = [];

for (const id of Object.keys(WEAPONS)) specs.push(weaponSpec(id));
for (const def of Object.values(OPERATORS)) specs.push(operatorSpec(def));
specs.push(hammerSpec(), launcherSpec(), pulseSensorSpec(), droneSpec(),
  chargeSpec('g_breach', '#3f4533', 0.32, 0.5), chargeSpec('g_thermite', '#7a6a48', 0.5, 0.75), chargeSpec('g_cluster', '#4a4f3a', 0.3, 0.3),
  throwableSpec('g_emp', '#2c5c8a', true), throwableSpec('g_gas', '#6a6f2a', true),
  deviceSpec('g_jammer', '#1b1d20', '#ff3a3a'), deviceSpec('g_ads', '#3c4136'), deviceSpec('g_battery', '#d9792a', '#7fd0ff'));

/* House architecture modules (Tactical Low-Poly, tier colour coded) */
const panel = (id: string, face: string, core: string, studs: boolean): AssetSpec => {
  const P: PartSpec[] = [box([0, WALL_H / 2, 0], [2.5, WALL_H, 0.2], face)];
  if (studs) for (let u = 0; u < 10; u += 3) P.push(box([-1.25 + (u + 0.5) * CELL, WALL_H / 2, 0], [CELL, WALL_H, 0.13], core));
  return { id, category: 'module', parts: P };
};
specs.push(panel('module_wall_soft', '#a8665a', '#e6dccb', false), panel('module_wall_semi', '#c6a35a', '#6d5232', true), panel('module_wall_solid', '#e4e0d6', '#5d5b57', false));
const frame = (id: string, y0: number, h: number, w: number): AssetSpec => ({
  id, category: 'module',
  parts: [
    box([-w / 2 - 0.025, y0 + h / 2, 0], [0.05, h, 0.34], '#3b2f24'), box([w / 2 + 0.025, y0 + h / 2, 0], [0.05, h, 0.34], '#3b2f24'),
    box([0, y0 + h + 0.025, 0], [w + 0.1, 0.05, 0.34], '#3b2f24'), ...(y0 > 0 ? [box([0, y0 - 0.025, 0], [w + 0.1, 0.05, 0.4], '#3b2f24')] : []),
  ],
});
specs.push(frame('module_door_frame', 0, OPENING_DIMS.door.h, 1), frame('module_window_frame', OPENING_DIMS.window.y0, OPENING_DIMS.window.h, 1));
specs.push({ id: 'module_hatch', category: 'module', parts: [box([0, -0.1, 0], [1, 0.2, 1], '#9a6b3d'), box([0, 0.005, 0], [0.9, 0.01, 0.06], '#5e4128'), box([0, 0.005, 0], [0.06, 0.01, 0.9], '#5e4128')] });
specs.push({ id: 'module_barricade', category: 'module', parts: [0, 1, 2, 3, 4].map((i) => box([0, 0.2 + i * 0.45, 0], [1.05, 0.22, 0.05], i % 2 ? '#9c7a4a' : '#b08a55', { r: [0, 0, i % 2 ? 4 : -3] })) });
specs.push({ id: 'module_reinforcement', category: 'module', parts: [box([0, WALL_H / 2, 0], [1.2, WALL_H, 0.06], '#6f747a'), ...[0.4, 1.4, 2.4].map((y) => box([0, y, 0.04], [1.2, 0.1, 0.04], '#4b4f55')), box([0, WALL_H / 2, 0.05], [0.12, WALL_H, 0.05], '#4b4f55')] });
const stepParts: PartSpec[] = [];
for (let i = 0; i < 15; i++) stepParts.push(box([0, (i + 1) * 0.2 - 0.11, i * 0.267 + 0.13], [1.25, 0.22, 0.267], '#a77d4c'));
specs.push({ id: 'module_stairs', category: 'module', parts: stepParts });

/* furniture / cover (one spec per prop type) */
const seen = new Set<string>();
for (const p of PROPS) {
  const key = `prop_${p.type.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const [sx, sy, sz] = p.size;
  const parts: PartSpec[] = p.style === 'cylinder' ? [cyl([0, sy / 2, 0], sx / 2, sy, p.color, { seg: 10 })] : [box([0, sy / 2, 0], [sx, sy, sz], p.color)];
  if (p.style === 'table' || p.style === 'desk') parts.splice(0, 1, box([0, sy - 0.025, 0], [sx, 0.05, sz], p.color), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box([a * (sx / 2 - 0.06), (sy - 0.05) / 2, b * (sz / 2 - 0.06)], [0.06, sy - 0.05, 0.06], '#3b2f24')));
  specs.push({ id: key, category: 'prop', parts });
}
/* vehicles */
specs.push({ id: 'vehicle_police_cruiser', category: 'vehicle', parts: [box([0, 0.62, 0], [1.8, 0.65, 4.6], '#16181b'), box([0, 0.75, 0.2], [1.84, 0.4, 2.4], '#e8e8e4'), box([0, 1.2, 0.05], [1.6, 0.5, 1.9], '#16181b'), box([0, 1.5, 0.1], [1.2, 0.1, 0.25], '#ff2030', { emissive: true }), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box([a * 0.82, 0.31, b * 1.45], [0.2, 0.62, 0.66], '#111'))] });
specs.push({ id: 'vehicle_apc', category: 'vehicle', parts: [box([0, 1.3, -0.2], [2.6, 1.4, 6.4], '#3f4636'), box([0, 2.25, 0.6], [2.2, 0.5, 3.6], '#3f4636'), box([0, 2.72, 0.7], [0.7, 0.45, 1.0], '#2b3026'), box([0, 2.72, -0.6], [0.14, 0.14, 1.6], '#222'), ...[0, 1, 2, 3].flatMap((i) => [-1, 1].map((s) => box([s * 1.3, 0.47, -2.6 + i * 1.6], [0.36, 0.95, 0.9], '#141414')))] });

for (const s of specs) writeFileSync(join(out, `${s.id}.json`), JSON.stringify(s));
writeFileSync(join(out, '..', 'house_layout.json'), JSON.stringify({ WALLS, FLOORS, STAIRS, HATCHES, ROOMS, SPAWN_ZONES, OPENING_DIMS, WALL_H }, null, 1));
writeFileSync(join(out, '..', 'index.json'), JSON.stringify(specs.map((s) => ({ id: s.id, category: s.category, parts: s.parts.length })), null, 1));
console.log(`exported ${specs.length} asset specs → ${out}`);
