// Drone movement on the built map, driven headless: stairs (sloped colliders), barricade gaps, vents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { DRONE_R, Gadgets, type Gadget } from '../../src/game/Gadgets.ts';
import { Interactions } from '../../src/game/Interactions.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildOutdoor } from '../../src/map/Outdoor.ts';
import { decodeHouseDatamap512Headless } from '../../src/map/houseDatamap.ts';
import { STAIRS } from '../../src/map/houseLayout.ts';
import type { SoldierInput } from '../../src/game/Soldier.ts';

const ph = await Physics.create();
const d = new DestructionSystem(ph);
const scene = new THREE.Scene();
const house = buildHouse(ph, d, scene);
buildOutdoor(ph, scene, decodeHouseDatamap512Headless());
ph.world.step();
const w = new World(ph, d, {} as never, house, scene);
w.gadgets = new Gadgets(w);
w.interactions = new Interactions(w);
const owner = { id: 'pilot', side: 'attack', yaw: 0 } as never;

const input = (moveF: number): SoldierInput => ({ moveF, moveR: 0, lookDYaw: 0, lookDPitch: 0 }) as unknown as SoldierInput;
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** drive straight for up to `secs`; stops early when `done` holds; returns the fraction of frames on the ground */
function drive(g: Gadget, secs: number, done: () => boolean) {
  let grounded = 0;
  let n = 0;
  for (let t = 0; t < secs && !done(); t += 1 / 60) {
    w.gadgets.updateDrone(g, 1 / 60, input(1));
    ph.world.step();
    n++;
    if (g.data.grounded) grounded++;
  }
  return n ? grounded / n : 1;
}

function launch(p: THREE.Vector3, yaw: number) {
  w.gadgets.clear();
  const g = w.gadgets.spawnDrone(owner, p);
  g.data.yaw = yaw;
  // settle onto the floor
  for (let i = 0; i < 20; i++) { w.gadgets.updateDrone(g, 1 / 60, input(0)); ph.world.step(); }
  return g;
}

for (const s of STAIRS) {
  const r = s.rect;
  const lowAtMin = s.yMin < s.yMax;
  const yLow = Math.min(s.yMin, s.yMax);
  const yHigh = Math.max(s.yMin, s.yMax);
  // point on the flight at fraction f from the low end (centre line)
  const at = (f: number) => {
    const a = lowAtMin ? f : 1 - f;
    const c = s.axis === 'x' ? new THREE.Vector3(r.x0 + (r.x1 - r.x0) * a, 0, (r.z0 + r.z1) / 2) : new THREE.Vector3((r.x0 + r.x1) / 2, 0, r.z0 + (r.z1 - r.z0) * a);
    c.y = yLow + (yHigh - yLow) * f + DRONE_R + 0.04;
    return c;
  };
  const up = at(1).sub(at(0)).setY(0).normalize();

  test(`drone rolls up ${s.id} (${s.label}) without hopping`, () => {
    const g = launch(at(0.08), yawToward(up.x, up.z));
    const ground = drive(g, 10, () => g.pos.y > yHigh + DRONE_R - 0.05);
    assert.ok(g.pos.y > yHigh + DRONE_R - 0.05, `stuck at y ${g.pos.y.toFixed(2)} (top ${yHigh})`);
    assert.ok(ground > 0.9, `airborne ${(100 - ground * 100).toFixed(0)} % of the way`);
  });

  test(`drone rolls down ${s.id} staying on the slope`, () => {
    const g = launch(at(0.92), yawToward(-up.x, -up.z));
    const ground = drive(g, 10, () => g.pos.y < yLow + DRONE_R + 0.05);
    assert.ok(g.pos.y < yLow + DRONE_R + 0.05, `stuck at y ${g.pos.y.toFixed(2)} (bottom ${yLow})`);
    assert.ok(ground > 0.8, `airborne ${(100 - ground * 100).toFixed(0)} % of the way`);
  });
}

/** start 0.7 m in front of the opening, drive along its normal, must come out 0.5 m past the other face */
function through(op: (typeof house.openings)[number], dir = 1) {
  const n = op.normal.clone().setY(0).normalize().multiplyScalar(dir);
  const start = op.center.clone().addScaledVector(n, -0.7);
  start.y = op.floorY + DRONE_R + 0.03;
  const g = launch(start, yawToward(n.x, n.z));
  const past = () => g.pos.clone().sub(op.center).dot(n) > 0.5;
  drive(g, 6, past);
  return past();
}

test('drone rolls under a wooden door barricade (19 cm gap)', () => {
  const doors = house.openings.filter((o) => o.kind === 'door' && o.barricadeable && o.gap >= 0.19 && !o.exterior);
  assert.ok(doors.length > 0);
  let ok = 0;
  const bad: string[] = [];
  for (const op of doors) {
    w.interactions.placeBarricade(op, 'wood', false);
    d.update();
    ph.world.step();
    if (through(op) && through(op, -1)) ok++;
    else bad.push(`${op.label}#${op.id}`);
    w.interactions.removeBarricade(op);
    d.update();
  }
  assert.deepEqual(bad, [], `${ok}/${doors.length} doors`);
});

test('drone rolls through every vent, both ways', () => {
  const vents = house.openings.filter((o) => o.kind === 'vent');
  assert.ok(vents.length > 0);
  const bad = vents.flatMap((op) => [1, -1].filter((dir) => !through(op, dir)).map((dir) => `${op.label}#${op.id} ${dir > 0 ? '→' : '←'} @${op.center.toArray().map((v) => v.toFixed(2))}`));
  assert.deepEqual(bad, []);
});
