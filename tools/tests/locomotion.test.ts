// Walking is walking: up a slope, a stair ramp or real steps, in every stance, the legs lift the body and the
// pace over the ground stays what it is on the flat (no "pushing into the hill").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { Soldier, emptyInput } from '../../src/game/Soldier.ts';
import { Stance } from '../../src/game/types.ts';
import { Interactions } from '../../src/game/Interactions.ts';
import { Gadgets } from '../../src/game/Gadgets.ts';
import { Objectives } from '../../src/game/Objectives.ts';

const tag = { kind: 'static' as const, mat: 'concrete' };

/** flat ground for z > 0, then the course climbs toward −z (the way a yaw-0 soldier walks) */
async function course(build: (ph: Physics) => void) {
  const ph = await Physics.create();
  ph.addBox(0, -0.5, 6, 4, 0.5, 6, tag);
  build(ph);
  ph.world.step();
  const w = new World(ph, new DestructionSystem(ph), {} as never, { openings: [], props: [], cameras: [] } as never, new THREE.Scene());
  w.interactions = new Interactions(w);
  w.gadgets = new Gadgets(w);
  w.objectives = new Objectives(w);
  w.phase = 'action';
  return { ph, w };
}

const slope = (deg: number) => (ph: Physics) => {
  const a = THREE.MathUtils.degToRad(deg);
  const len = 40;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  // a slab whose top face runs from (z 0, y 0) up to (z −len·cos, y len·sin)
  const c = new THREE.Vector3(0, -0.25, -len / 2).applyQuaternion(q);
  ph.addBox(c.x, c.y, c.z, 4, 0.25, len / 2, tag, q);
};
const steps = (rise: number, run: number, n: number) => (ph: Physics) => {
  for (let i = 1; i <= n; i++) ph.addBox(0, (i * rise) / 2, -(i - 0.5) * run, 4, (i * rise) / 2, run / 2, tag);
  ph.addBox(0, (n * rise) / 2, -n * run - 20, 4, (n * rise) / 2, 20, tag);
};

/** walk forward (W) from z 3; returns the horizontal pace (m/s) on the flat and over the climb, and the height reached */
function walk(w: World, stance: Stance, secs: number, climbTo = -1e9, climbFrom = -0.6) {
  const s = new Soldier(w, { id: 'p', name: 'p', side: 'attack', operator: 'ash', kind: 'local', pos: new THREE.Vector3(0, 0.05, 3), yaw: 0 });
  w.soldiers.set(s.id, s);
  w.actors.set(s.id, s);
  const inp = { ...emptyInput(), stance };
  const dt = 1 / 60;
  for (let t = 0; t < 0.5; t += dt) { s.update(dt, { ...emptyInput(), stance }); w.physics.world.step(); }
  assert.equal(s.stance, stance);
  let flatT = 0, flatD = 0, climbT = 0, climbD = 0;
  for (let t = 0; t < secs; t += dt) {
    const z0 = s.pos.z;
    s.update(dt, { ...inp, moveF: 1 });
    w.physics.world.step();
    const dz = z0 - s.pos.z;
    if (t > 0.4 && s.pos.z > 0.4) { flatT += dt; flatD += dz; }
    else if (s.pos.z < climbFrom && s.pos.z > climbTo) { climbT += dt; climbD += dz; }
  }
  return { flat: flatD / flatT, climb: climbT ? climbD / climbT : 0, y: s.pos.y, z: s.pos.z };
}

const STANCES: [string, Stance][] = [['standing', Stance.Stand], ['crouched', Stance.Crouch], ['prone', Stance.Prone]];

for (const deg of [15, 33]) {
  test(`up a ${deg}° slope at the flat pace, standing, crouched and prone`, async () => {
    for (const [name, st] of STANCES) {
      const { w } = await course(slope(deg));
      const r = walk(w, st, st === Stance.Prone ? 14 : 7);
      assert.ok(r.climb > 0.9 * r.flat, `${name}: ${r.climb.toFixed(2)} m/s up the slope vs ${r.flat.toFixed(2)} on the flat`);
      assert.ok(r.y > 1, `${name}: climbed to ${r.y.toFixed(2)} m`);
    }
  });
}

test('up real steps (18 cm × 28 cm) at the flat pace, standing, crouched and prone', async () => {
  for (const [name, st] of STANCES) {
    const { w } = await course(steps(0.18, 0.28, 12));
    const r = walk(w, st, st === Stance.Prone ? 14 : 7, -12 * 0.28);
    assert.ok(r.y > 12 * 0.18 - 0.05, `${name}: reached the top (${r.y.toFixed(2)} m)`);
    assert.ok(r.climb > 0.85 * r.flat, `${name}: ${r.climb.toFixed(2)} m/s up the steps vs ${r.flat.toFixed(2)} on the flat`);
  }
});

test('down a 33° slope: same pace, feet stay on the ground', async () => {
  const { w } = await course(slope(33));
  const s = new Soldier(w, { id: 'p', name: 'p', side: 'attack', operator: 'ash', kind: 'local', pos: new THREE.Vector3(0, 8 * Math.sin(THREE.MathUtils.degToRad(33)) + 0.05, -6.6), yaw: Math.PI });
  w.soldiers.set(s.id, s);
  w.actors.set(s.id, s);
  const dt = 1 / 60;
  let airborne = 0, d = 0, T = 0;
  for (let t = 0; t < 3; t += dt) {
    const z0 = s.pos.z;
    s.update(dt, { ...emptyInput(), moveF: 1 });
    w.physics.world.step();
    if (t > 0.5 && s.pos.z < -0.5) { T += dt; d += s.pos.z - z0; if (!s.grounded) airborne++; }
  }
  assert.ok(d / T > 3.0, `pace down the slope ${(d / T).toFixed(2)} m/s`);
  assert.ok(airborne < 3, `airborne for ${airborne} frames on the way down`);
});
