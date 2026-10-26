// Corpses lie flat whatever pose the body died in (walking, crouched, prone, upside down on a rope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rig } from '../../src/render/Rig.ts';
import { Stance } from '../../src/game/types.ts';

/** what is drawn of the body (a dropped gun is hidden) */
function bodyBox(rig: Rig) {
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if ((o as THREE.Mesh).isMesh) box.union(new THREE.Box3().setFromObject(o, true));
    o.children.forEach(visit);
  };
  visit(rig.root);
  return box;
}

const cases: [string, Stance, number, boolean][] = [
  ['mid-stride', Stance.Stand, 4, false],
  ['crouched', Stance.Crouch, 1, false],
  ['prone', Stance.Prone, 0, false],
  ['upside down on a rope', Stance.Rappel, 0, true],
];

for (const [name, stance, speed, inverted] of cases) {
  for (const fallForward of [false, true]) {
    test(`a body shot ${name} lies flat (${fallForward ? 'face down' : 'on its back'}), gun dropped`, () => {
      const rig = new Rig('ash', 'r4c');
      for (let i = 0; i < 20; i++) rig.pose(1 / 30, stance, 0.2, 0.5, speed, inverted);
      const alive = bodyBox(rig);
      assert.ok(alive.max.y - alive.min.y > 0.5, 'standing / crouched / prone before');
      rig.setDead(true, fallForward, 0.4);
      for (let i = 0; i < 60; i++) rig.pose(1 / 30, stance, 0.2, 0.5, speed, inverted);
      const b = bodyBox(rig);
      assert.equal(rig.root.rotation.z, 0, 'the right way up');
      assert.ok(b.max.y < 0.55, `flat on the floor: top of the body at ${b.max.y.toFixed(2)} m`);
      assert.ok(b.min.y > -0.25, `not sunk into the floor: ${b.min.y.toFixed(2)} m`);
      // limbs relaxed: the legs are no longer bent or mid-stride
      assert.ok(Math.abs((rig as unknown as { legL: THREE.Group }).legL.rotation.x) < 0.2);
      rig.setDead(false);
      for (let i = 0; i < 30; i++) rig.pose(1 / 30, Stance.Stand, 0, 0, 0);
      assert.ok(bodyBox(rig).max.y > 1.5, 'stands up again on respawn');
    });
  }
}

test('a dead soldier blocks nothing: no body collider, no shield collider where the body lies', async () => {
  const { Physics, G_CHAR, G_GADGET, groups } = await import('../../src/core/Physics.ts');
  const { DestructionSystem } = await import('../../src/world/Destruction.ts');
  const { World } = await import('../../src/game/World.ts');
  const { Soldier } = await import('../../src/game/Soldier.ts');
  const ph = await Physics.create();
  const w = new World(ph, new DestructionSystem(ph), {} as never, {} as never, new THREE.Scene());
  w.phase = 'action';
  const s = new Soldier(w, { id: 'm', name: 'm', side: 'attack', operator: 'montagne', kind: 'bot', pos: new THREE.Vector3(0, 0, 0), yaw: 0 });
  w.soldiers.set(s.id, s);
  w.actors.set(s.id, s);
  const blocked = () => {
    ph.world.step();
    let n = 0;
    for (const y of [0.3, 0.9, 1.5]) ph.world.intersectionsWithShape({ x: 0, y, z: -0.2 }, { x: 0, y: 0, z: 0, w: 1 }, new ph.R.Ball(0.6), () => { n++; return true; }, undefined, groups(0xffff, G_CHAR | G_GADGET));
    return n;
  };
  assert.ok(blocked() > 0, 'alive: body and shield are there');
  s.die('x', false);
  assert.equal(blocked(), 0, 'dead: nothing to bump into or to stop a round');
});
