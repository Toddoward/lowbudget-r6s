// Ping / drone-scan targeting: who is under the reticle, through what, and when a scan identifies them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { computeHitboxes, type Actor } from '../../src/game/Actor.ts';
import { Stance } from '../../src/game/types.ts';
import { lookTarget, SCAN_TIME, Scanner } from '../../src/game/Spotting.ts';

async function setup() {
  const ph = await Physics.create();
  const w = new World(ph, new DestructionSystem(ph), {} as never, {} as never, new THREE.Scene());
  w.phase = 'action';
  return { ph, w };
}
const actor = (id: string, side: Actor['side'], x: number, z: number, stance = Stance.Stand): Actor => {
  const pos = new THREE.Vector3(x, 0, z);
  return {
    id, name: id, side, kind: 'bot', operator: 'x', alive: true, hp: 100, pos, vel: new THREE.Vector3(), yaw: 0, pitch: 0, stance, lean: 0, inverted: false, weaponId: null,
    eye: (o = new THREE.Vector3()) => o.copy(pos).setY(1.6),
    hitboxes: () => computeHitboxes(pos, 0, stance, 0, false),
  };
};
const add = (w: World, ...as: Actor[]) => as.forEach((a) => w.actors.set(a.id, a));
const eye = new THREE.Vector3(0, 1.6, 0);
const toward = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).sub(eye).normalize();

test('the enemy under the reticle is found; teammates, hostages and a prep-phase attacker are not', async () => {
  const { w } = await setup();
  add(w, actor('mate', 'attack', 0, -10), actor('hostage', 'hostage', 0.3, -10), actor('tango', 'terrorist', 6, -10));
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(0, 1.2, -10)), null, 'a teammate / the hostage is never spotted');
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(6, 1.2, -10))?.id, 'tango');
  // an attacker during prep is not in the map
  const atk = actor('atk', 'attack', -6, -10);
  add(w, atk);
  w.phase = 'prep';
  assert.equal(lookTarget(w, 'defend', 'me', eye, toward(-6, 1.2, -10)), null);
});

test('a wall blocks the spot; a head over cover is still seen', async () => {
  const { ph, w } = await setup();
  add(w, actor('tango', 'terrorist', 0, -10));
  // a full wall in between
  const wall = ph.addBox(0, 1.5, -5, 2, 1.5, 0.1, { kind: 'static', mat: 'concrete' });
  ph.world.step();
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(0, 1.2, -10)), null);
  // a 1.3 m counter instead: chest hidden, head visible above it
  ph.remove(wall);
  ph.addBox(0, 0.65, -9.3, 1, 0.65, 0.2, { kind: 'static', mat: 'wood' });
  ph.world.step();
  const hit = lookTarget(w, 'attack', 'me', eye, toward(0, 1.6, -10));
  assert.equal(hit?.id, 'tango');
  assert.ok(hit!.point.y > 1.4, 'seen by the head');
});

test('the cone follows the target size (+ a little slack): 1.6 m off the body at 10 m is a miss; the closer of two to the crosshair wins', async () => {
  const { w } = await setup();
  add(w, actor('a', 'terrorist', 0.3, -10), actor('b', 'terrorist', -0.2, -10));
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(-0.05, 1.2, -10))?.id, 'b');
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(0.15, 1.2, -10))?.id, 'a');
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(-1.8, 1.2, -10)), null);
  // the slack: a target that stepped half a metre aside at 5 m is still pinged
  const w2 = (await setup()).w;
  add(w2, actor('m', 'terrorist', 0.55, -5));
  assert.equal(lookTarget(w2, 'attack', 'me', eye, toward(0, 1.6, -5))?.id, 'm');
  // a prone enemy is found at prone height
  const p = actor('p', 'terrorist', 0, -6, Stance.Prone);
  add(w, p);
  assert.equal(lookTarget(w, 'attack', 'me', eye, toward(0, 0.3, -6.4))?.id, 'p');
});

test('drone scan: holding the reticle for SCAN_TIME identifies and spots once; looking away resets it', async () => {
  const { w } = await setup();
  add(w, actor('tango', 'terrorist', 0, -8));
  const s = new Scanner();
  const d = toward(0, 1.2, -8);
  const dt = 1 / 30;
  const ids: string[] = [];
  for (let t = 0; t < SCAN_TIME * 0.5; t += dt) { const id = s.update(w, 'attack', 'me', eye, d, dt); if (id) ids.push(id); }
  assert.ok(s.progress > 0.3 && s.progress < 0.7);
  assert.equal(w.spots.has('tango'), false, 'not spotted before the scan completes');
  for (let t = 0; t < SCAN_TIME * 2; t += dt) { w.time += dt; const id = s.update(w, 'attack', 'me', eye, d, dt); if (id) ids.push(id); }
  assert.deepEqual(ids, ['tango'], 'identified once');
  assert.ok(w.spots.get('tango')!.until > w.time + 3);
  // the spot keeps being refreshed while held
  const until = w.spots.get('tango')!.until;
  for (let t = 0; t < 1.5; t += dt) { w.time += dt; s.update(w, 'attack', 'me', eye, d, dt); }
  assert.ok(w.spots.get('tango')!.until > until);
  // look away: progress gone
  s.update(w, 'attack', 'me', eye, toward(8, 1.2, -8), dt);
  assert.equal(s.target, null);
  assert.equal(s.progress, 0);
});
