// [F] interactions per kind of thing: objects need reach + crosshair + sight, doorways need the body at them
// facing them in sight; never through a wall. Nearest-to-crosshair wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { Interactions } from '../../src/game/Interactions.ts';
import { aimAt } from '../../src/game/Reach.ts';
import { emptyInput } from '../../src/game/Soldier.ts';

async function setup(openings: unknown[] = []) {
  const ph = await Physics.create();
  const w = new World(ph, new DestructionSystem(ph), {} as never, { openings, props: [], cameras: [] } as never, new THREE.Scene());
  w.phase = 'action';
  return { ph, w };
}
/** a soldier standing at (x, z) looking along yaw / pitch */
const who = (x: number, z: number, yaw = 0, pitch = 0) => {
  const pos = new THREE.Vector3(x, 0, z);
  return {
    pos, yaw,
    eye: (o = new THREE.Vector3()) => o.copy(pos).setY(1.6),
    aimDir: (o = new THREE.Vector3()) => o.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)),
  };
};
const obj = (x: number, y: number, z: number) => ({ points: [new THREE.Vector3(x, y, z)], radius: 0.4, reach: 2.1 });

test('an object: within reach, under the crosshair, in sight — not behind you, not through a wall', async () => {
  const { ph, w } = await setup();
  const at = obj(0, 0.8, -1.5);
  assert.ok(aimAt(w, who(0, 0, 0, -0.45), at) !== null, 'looking at it');
  assert.equal(aimAt(w, who(0, 0, Math.PI), at), null, 'behind you');
  assert.equal(aimAt(w, who(0, 3), at), null, 'out of reach');
  ph.addBox(0, 1.5, -0.8, 2, 1.5, 0.08, { kind: 'static', mat: 'plaster' });
  ph.world.step();
  assert.equal(aimAt(w, who(0, 0, 0, -0.45), at), null, 'through a wall');
});

test('an object at your feet counts without aiming at it; the one nearest the crosshair is preferred', async () => {
  const { w } = await setup();
  assert.ok(aimAt(w, who(0, 0, Math.PI / 2), obj(0.3, 0.2, -0.3)) !== null, 'at your feet, looking elsewhere');
  const s = who(0, 0, 0, -0.4);
  const left = aimAt(w, s, obj(-0.5, 0.8, -1.4));
  const ahead = aimAt(w, s, obj(0, 0.8, -1.6));
  assert.ok(left !== null && ahead !== null && ahead < left);
});

test('barricade: offered at a doorway you face — not for the doorway behind the wall you face', async () => {
  // a doorway in a wall along X at z = −1, 1 m wide, and a solid wall at z = −0.6 between it and the soldier
  const op = { id: 0, kind: 'door', center: new THREE.Vector3(0, 1.15, -1), w: 1, h: 2.3, normal: new THREE.Vector3(0, 0, 1), floorY: 0, barricadeable: true, barricadePanel: null };
  const { ph, w } = await setup([op]);
  const it = new Interactions(w);
  w.interactions = it;
  w.objectives = { candidate: () => null } as never;
  const s = {
    ...who(0, 0, 0, -0.1), id: 'd', side: 'defend', mode: 'normal', interactLabel: '', interactProgress: 0, reinforcementsLeft: 0,
    op: { gadget: 'none', universal: 'barricade' }, weapons: [], probeVault: () => null,
  };
  it.update(s as never, 1 / 30, emptyInput());
  assert.equal(s.interactLabel, 'action.barricadeDoor');
  ph.addBox(0, 1.5, -0.6, 2, 1.5, 0.06, { kind: 'static', mat: 'plaster' });
  ph.world.step();
  it.update(s as never, 1 / 30, emptyInput());
  assert.equal(s.interactLabel, '', 'the doorway is behind a wall');
});
