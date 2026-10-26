import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { rappelAxes } from '../../src/game/Soldier.ts';
import type { Actor } from '../../src/game/Actor.ts';
import { computeHitboxes } from '../../src/game/Actor.ts';
import { Stance } from '../../src/game/types.ts';

test('rappel controls follow the view: inverted, W descends, S climbs, A/D mirror', () => {
  assert.deepEqual(rappelAxes(1, 0, false), { up: 1, side: 0 });
  assert.deepEqual(rappelAxes(-1, 1, false), { up: -1, side: 1 });
  assert.deepEqual(rappelAxes(1, 0, true), { up: -1, side: -0 });
  assert.deepEqual(rappelAxes(-1, 1, true), { up: 1, side: -1 });
});

const actor = (id: string, side: Actor['side']): Actor => {
  let hp = 100;
  return {
    id, name: id, side, kind: 'bot', operator: 'x', alive: true, get hp() { return hp; }, set hp(v) { hp = v; },
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, stance: Stance.Stand, lean: 0, inverted: false, weaponId: null,
    eye: (o = new THREE.Vector3()) => o.set(0, 1.6, 0),
    hitboxes: () => computeHitboxes(new THREE.Vector3(), 0, Stance.Stand, 0, false),
    damage(amount: number) { hp -= amount; return hp <= 0; },
  };
};

test('prep phase: attackers are not in the map — not targetable, not damageable; defenders are', async () => {
  const ph = await Physics.create();
  const w = new World(ph, new DestructionSystem(ph), {} as never, {} as never, new THREE.Scene());
  const atk = actor('atk', 'attack');
  const tango = actor('t', 'terrorist');
  w.actors.set(atk.id, atk);
  w.actors.set(tango.id, tango);
  w.soldiers.set(atk.id, atk as never);
  w.soldiers.set(tango.id, tango as never);
  w.phase = 'prep';
  assert.equal(w.deployed(atk), false);
  assert.equal(w.targetable(atk), false);
  assert.equal(w.targetable(tango), true);
  w.damageActor(atk, 50, tango.id, false);
  assert.equal(atk.hp, 100, 'no damage while droning');
  w.phase = 'action';
  assert.equal(w.targetable(atk), true);
  w.damageActor(atk, 50, tango.id, false);
  assert.equal(atk.hp, 50);
});
