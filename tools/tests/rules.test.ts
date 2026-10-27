import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { rappelAxes, viewLook } from '../../src/game/Soldier.ts';
import type { Actor } from '../../src/game/Actor.ts';
import { computeHitboxes } from '../../src/game/Actor.ts';
import { Stance } from '../../src/game/types.ts';

/**
 * Rappel controls are judged on screen, the way the player sees them: the camera is built exactly as the game builds it
 * (YXZ: yaw, pitch, then the roll — 180° hanging upside down) and a point is projected before / after the input.
 */
test('rappel: mouse and keys always follow the view — upright and hanging upside down', () => {
  for (const inverted of [false, true]) {
    for (const yaw of [0, 1.1, -2.4]) {
      const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
      const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // facing into the wall: forward = −n
      const place = (y: number, p: number) => { cam.position.set(0, 0, 0); cam.rotation.set(p, y, inverted ? Math.PI : 0, 'YXZ'); cam.updateMatrixWorld(true); };
      const ndc = (p: THREE.Vector3) => p.clone().project(cam);
      const fwd = n.clone().negate();
      place(yaw, 0.1);
      const toRight = new THREE.Vector3(0.4, 0, -1).unproject(cam).sub(cam.position).normalize().multiplyScalar(5);
      const toTop = new THREE.Vector3(0, 0.4, -1).unproject(cam).sub(cam.position).normalize().multiplyScalar(5);
      // the mouse moved right (Input: lookDYaw = −dx·sens) brings what was right of the crosshair toward it
      let l = viewLook(-0.05, 0, inverted);
      place(yaw + l.dYaw, 0.1 + l.dPitch);
      assert.ok(ndc(toRight).x < 0.4 - 0.01, `${inverted ? 'inverted' : 'upright'} yaw ${yaw}: mouse right turns toward screen-right (${ndc(toRight).x.toFixed(2)})`);
      // the mouse moved up (lookDPitch = +dy·sens) brings what was above the crosshair toward it
      place(yaw, 0.1);
      l = viewLook(0, 0.05, inverted);
      place(yaw + l.dYaw, 0.1 + l.dPitch);
      assert.ok(ndc(toTop).y < 0.4 - 0.01, `${inverted ? 'inverted' : 'upright'}: mouse up looks toward screen-up (${ndc(toTop).y.toFixed(2)})`);
      // keys: D moves toward screen-right, W toward screen-up (Soldier.updateRappel: right = (−n) × up)
      place(yaw, 0);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const move = (f: number, r: number) => { const a = rappelAxes(f, r, inverted); return new THREE.Vector3(0, a.up, 0).addScaledVector(right, a.side); };
      const ahead = fwd.clone().multiplyScalar(3);
      assert.ok(ndc(ahead.clone().add(move(0, 1))).x > 0.05, 'D → screen-right');
      assert.ok(ndc(ahead.clone().add(move(0, -1))).x < -0.05, 'A → screen-left');
      assert.ok(ndc(ahead.clone().add(move(1, 0))).y > 0.05, 'W → screen-up');
      assert.ok(ndc(ahead.clone().add(move(-1, 0))).y < -0.05, 'S → screen-down');
    }
  }
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
