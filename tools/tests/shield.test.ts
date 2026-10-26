// Shield operators: [1] shield front ↔ back, the pistol always in hand, RMB swings the shield aside to aim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G_GADGET, Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { Combat } from '../../src/game/Combat.ts';
import { Gadgets } from '../../src/game/Gadgets.ts';
import { Interactions } from '../../src/game/Interactions.ts';
import { Objectives } from '../../src/game/Objectives.ts';
import { emptyInput, SHIELD_SPEED, Soldier, type SoldierInput } from '../../src/game/Soldier.ts';

async function setup(operator = 'montagne') {
  const ph = await Physics.create();
  ph.addBox(0, -0.5, 0, 20, 0.5, 20, { kind: 'static', mat: 'concrete' }); // floor
  const scene = new THREE.Scene();
  const w = new World(ph, new DestructionSystem(ph), { gas() {}, clearAllDecals() {} } as never, { openings: [], props: [], cameras: [], stairs: [], wallPanels: [], roomAt: () => null, floorOf: () => 0, locationName: () => '' } as never, scene);
  w.combat = new Combat(w);
  w.interactions = new Interactions(w);
  w.gadgets = new Gadgets(w);
  w.objectives = new Objectives(w);
  w.phase = 'action';
  const s = new Soldier(w, { id: 'me', name: 'me', side: 'attack', operator, kind: 'local', pos: new THREE.Vector3(0, 0, 0), yaw: 0 });
  w.soldiers.set(s.id, s);
  w.actors.set(s.id, s);
  ph.world.step();
  const step = (inp: Partial<SoldierInput> = {}, n = 1) => {
    for (let i = 0; i < n; i++) { s.update(1 / 30, { ...emptyInput(), ...inp }); ph.world.step(); }
  };
  return { ph, w, s, step };
}

/** does a round fired from `from` toward the soldier's chest hit the shield first? */
function shieldStops(ph: Physics, s: Soldier, from: THREE.Vector3) {
  const chest = s.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
  const d = chest.clone().sub(from).normalize();
  const hit = ph.raycast(from, d, from.distanceTo(chest), G_GADGET, (t) => !(t?.kind === 'gadget' && t.gadgetId.startsWith('shield:')));
  return !!hit;
}

test('shield + pistol: both slots are the one pistol; [1] slings / raises the shield, the pistol stays in hand', async () => {
  const { s, step } = await setup();
  assert.equal(s.weapons[0], s.weapons[1], 'one pistol');
  assert.equal(s.weapon!.def.cls, 'Pistol');
  assert.equal(s.shieldPose, 'front', 'held in front by default');
  step({ slot: 0 });
  assert.equal(s.shieldPose, 'back');
  assert.equal(s.slot, 0);
  assert.equal(s.weapon!.def.cls, 'Pistol', 'the pistol is still in hand');
  step({ slot: 1 });
  assert.equal(s.shieldPose, 'back', '[2] does not touch the shield');
  step({ slot: 0 });
  assert.equal(s.shieldPose, 'front');
});

test('RMB swings the shield aside and aims; the collider follows front / aside / back', async () => {
  const { ph, s, step } = await setup();
  step({}, 15); // equip settles
  const ahead = new THREE.Vector3(0, 1.3, -6);
  const behind = new THREE.Vector3(0, 1.3, 6);
  assert.ok(shieldStops(ph, s, ahead), 'front: rounds from ahead hit the shield');
  assert.ok(!shieldStops(ph, s, behind));
  step({ ads: true }, 15);
  assert.ok(s.ads > 0.9, 'aims with the shield up');
  assert.equal(s.shieldPose, 'ads');
  // aside: covers the left flank, not the line straight ahead of the right shoulder
  assert.ok(shieldStops(ph, s, new THREE.Vector3(-6, 1.3, -2)), 'ADS: the left flank is covered');
  step({ ads: false }, 15);
  step({ slot: 0 }); // a key press is one frame
  step({}, 15);
  assert.equal(s.shieldPose, 'back');
  assert.ok(shieldStops(ph, s, behind), 'back: covers the back');
  assert.ok(!shieldStops(ph, s, ahead));
});

test('Montagne extends only with the shield in front, cannot fire extended; speeds per pose', async () => {
  const { s, step } = await setup();
  step({}, 15);
  step({ gadget: true });
  assert.equal(s.shieldPose, 'ext');
  const mag = s.weapon!.mag;
  step({ fire: true }, 3);
  assert.equal(s.weapon!.mag, mag, 'no shooting while extended');
  step({ gadget: true });
  step({ slot: 0 });
  step({}, 15);
  step({ gadget: true });
  assert.equal(s.shieldPose, 'back', 'no extending from the back');
  assert.ok(SHIELD_SPEED.back > SHIELD_SPEED.front && SHIELD_SPEED.front > SHIELD_SPEED.ext);
});
