import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem, greedy } from '../../src/world/Destruction.ts';
import { raySphere, rayCapsule, computeHitboxes, rayActor } from '../../src/game/Actor.ts';
import { applySpread } from '../../src/game/Soldier.ts';
import { Stance } from '../../src/game/types.ts';
import { subtractRects } from '../../src/map/geometry.ts';

test('greedy merge covers exactly the filled cells', () => {
  const nu = 9, nv = 7;
  const g = new Uint8Array(nu * nv).map((_, i) => ((i * 7919) % 5 === 0 ? 0 : 1));
  const rects = greedy(g, nu, nv);
  const cover = new Uint8Array(nu * nv);
  for (const [u0, v0, u1, v1] of rects) for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) { assert.equal(cover[v * nu + u], 0, 'no overlap'); cover[v * nu + u] = 1; }
  assert.deepEqual([...cover], [...g]);
});

test('subtractRects leaves holes', () => {
  const r = subtractRects({ x0: 0, z0: 0, x1: 4, z1: 4 }, [{ x0: 1, z0: 1, x1: 2, z1: 2 }]);
  const area = r.reduce((a, q) => a + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
  assert.equal(area, 15);
});

test('soft wall: bullets chip, breach opens a passable hole; semi wall keeps studs; reinforced only yields to thermite', async () => {
  const ph = await Physics.create();
  const d = new DestructionSystem(ph);
  const soft = d.add({ kind: 'wall_soft', min: [0, 0, -0.1], max: [2.5, 2.8, 0.1], nAx: 2, label: 'soft', reinforceable: true });
  const semi = d.add({ kind: 'wall_semi', min: [5, 0, -0.1], max: [7.5, 2.8, 0.1], nAx: 2, label: 'semi' });
  const hit = new THREE.Vector3(1.2, 1.2, 0);
  for (let i = 0; i < 3; i++) d.impactAndApply('bullet', hit, soft, 1);
  assert.equal(soft.brokenCount, 1, 'three rifle rounds break one 0.25 m cell');
  d.update();
  assert.equal(soft.passable, false);
  d.impactAndApply('breach', new THREE.Vector3(1.2, 1.0, 0), soft);
  d.update();
  assert.equal(soft.passable, true, 'breach charge makes a door-sized hole');
  d.impactAndApply('sledge', new THREE.Vector3(6.2, 1.0, 0), semi);
  d.impactAndApply('sledge', new THREE.Vector3(6.2, 1.8, 0), semi);
  d.update();
  assert.ok(semi.brokenCount > 20);
  assert.equal(semi.passable, false, 'studs stay: see & shoot through, cannot pass');
  // ray passes through the semi wall gaps somewhere
  let through = 0;
  for (let x = 5.3; x < 7.3; x += 0.05) if (!ph.raycast(new THREE.Vector3(x, 1.4, -2), new THREE.Vector3(0, 0, 1), 4)) through++;
  ph.step();
  assert.ok(through > 0, 'sight lines exist through broken semi wall');
  const r = d.add({ kind: 'wall_soft', min: [10, 0, -0.1], max: [12.5, 2.8, 0.1], nAx: 2, label: 'r', reinforceable: true });
  r.reinforced = true;
  assert.equal(d.impact('breach', new THREE.Vector3(11, 1, 0), r).events.length, 0);
  assert.equal(d.impact('ash', new THREE.Vector3(11, 1, 0), r).events.length, 0);
  d.impactAndApply('thermite', new THREE.Vector3(11.2, 1.2, 0), r);
  d.update();
  assert.equal(r.passable, true, 'thermite opens reinforced walls');
  r.electrified = 1;
  const r2 = d.add({ kind: 'wall_soft', min: [15, 0, -0.1], max: [17.5, 2.8, 0.1], nAx: 2, label: 'r2', reinforceable: true });
  r2.reinforced = true;
  r2.electrified = 1;
  assert.equal(d.impact('thermite', new THREE.Vector3(16, 1, 0), r2).events.length, 0, 'Bandit battery stops thermite');
});

test('cell damage is commutative (multiplayer convergence)', async () => {
  const ph = await Physics.create();
  const mk = () => new DestructionSystem(ph).add({ kind: 'wall_soft', min: [0, 0, -0.1], max: [2.5, 2.8, 0.1], nAx: 2, label: 's' });
  const a = mk();
  const b = mk();
  const evs = [{ cells: [5, 6, 7], dmg: 1 }, { cells: [6, 7, 8], dmg: 2.5 }, { cells: [5], dmg: 2 }, { cells: [40, 41], dmg: 999 }];
  for (const e of evs) a.applyDamage(e.cells, e.dmg);
  for (const e of [...evs].reverse()) b.applyDamage(e.cells, e.dmg);
  assert.deepEqual([...a.state], [...b.state]);
});

test('hitboxes: headshot zone, crouch lowers the head, lean shifts it', () => {
  const o = new THREE.Vector3(0, 1.6, 5);
  const d = new THREE.Vector3(0, 0, -1);
  const stand = computeHitboxes(new THREE.Vector3(0, 0, 0), 0, Stance.Stand, 0, false);
  assert.equal(rayActor(o, d, stand, 100)?.zone, 'head');
  const crouch = computeHitboxes(new THREE.Vector3(0, 0, 0), 0, Stance.Crouch, 0, false);
  assert.equal(rayActor(o, d, crouch, 100), null, 'crouched target ducks under a head-height ray');
  assert.equal(rayActor(new THREE.Vector3(0, 1.0, 5), d, stand, 100)?.zone, 'torso');
  const lean = computeHitboxes(new THREE.Vector3(0, 0, 0), 0, Stance.Stand, 1, false);
  assert.ok(lean.head.c.x > 0.25, 'lean E moves the head right');
  assert.ok(raySphere(o, d, new THREE.Vector3(0, 1.6, 0), 0.14) > 4.8);
  assert.ok(rayCapsule(new THREE.Vector3(3, 1, 0), new THREE.Vector3(-1, 0, 0), { a: new THREE.Vector3(0, 0.5, 0), b: new THREE.Vector3(0, 1.5, 0), r: 0.2 }) > 2.7);
});

test('spread models: gaussian σ ≈ spread/2 per axis, linear stays inside the disc', () => {
  const dir = new THREE.Vector3(0, 0, -1);
  let maxLin = 0;
  let sumSq = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    maxLin = Math.max(maxLin, THREE.MathUtils.radToDeg(applySpread(dir, 2, 0, 'linear').angleTo(dir)));
    const g = applySpread(dir, 2, 0, 'gaussian');
    sumSq += THREE.MathUtils.radToDeg(Math.atan2(g.x, -g.z)) ** 2;
  }
  assert.ok(maxLin <= 2.0001, `linear max ${maxLin}`);
  const sigma = Math.sqrt(sumSq / N);
  assert.ok(sigma > 0.85 && sigma < 1.15, `gaussian σ ${sigma}`);
});

test('soft walls and hatches keep their wooden frame until a heavy hit', async () => {
  const ph = await Physics.create();
  const d = new DestructionSystem(ph);
  const soft = d.add({ kind: 'wall_soft', min: [0, 0, -0.07], max: [1.45, 2.8, 0.07], nAx: 2, label: 'soft' });
  // punch the whole section out: plaster gone, studs + plates stay — no way through
  for (let y = 0.2; y < 2.8; y += 0.4) for (let x = 0.1; x < 1.45; x += 0.3) d.impactAndApply('melee', new THREE.Vector3(x, y, 0), soft);
  d.update();
  assert.ok(soft.brokenFraction > 0.9, 'punches open the plaster');
  assert.equal(soft.passable, false, 'the stud frame stops bodies');
  // bullets pass the frame between studs (sight / fire lines exist)
  ph.step();
  let through = 0;
  for (let x = 0.05; x < 1.4; x += 0.05) if (!ph.raycast(new THREE.Vector3(x, 1.4, -2), new THREE.Vector3(0, 0, 1), 4)) through++;
  assert.ok(through > 10, 'rounds and eyes go between the studs');
  // a sledge swing takes the frame down: now it is a doorway
  d.impactAndApply('sledge', new THREE.Vector3(0.7, 1.0, 0), soft);
  d.update();
  assert.equal(soft.passable, true, 'heavy hit breaks the frame');
  // shotgun pellets snap studs too, rifle rounds do not
  const s2 = d.add({ kind: 'wall_soft', min: [5, 0, -0.07], max: [6.45, 2.8, 0.07], nAx: 2, label: 's2' });
  for (let y = 0.2; y < 2.8; y += 0.25) for (let x = 5.05; x < 6.45; x += 0.12) d.impactAndApply('bullet', new THREE.Vector3(x, y, 0), s2, 6);
  d.update();
  assert.equal(s2.passable, false, 'rifle fire: frame stays');
  for (let y = 0.2; y < 2.8; y += 0.25) for (let x = 5.05; x < 6.45; x += 0.12) d.impactAndApply('bullet', new THREE.Vector3(x, y, 0), s2, 6, true);
  d.update();
  assert.equal(s2.passable, true, 'shotgun: frame goes');
  // hatch: punched boards leave the joists; breach / sledge opens it
  const hatch = d.add({ kind: 'hatch', min: [10, -0.3, 0], max: [11, 0, 1], nAx: 1, label: 'hatch' });
  for (let i = 0; i < 4; i++) d.impactAndApply('melee', new THREE.Vector3(10.5, 0, 0.5), hatch);
  d.update();
  assert.equal(hatch.brokenFraction, 1, 'boards gone');
  assert.equal(hatch.passable, false, 'joists stay');
  d.impactAndApply('sledge', new THREE.Vector3(10.5, 0, 0.5), hatch);
  d.update();
  assert.equal(hatch.passable, true, 'sledge drops through');
  // a round reset brings back plaster and frame
  soft.resetSkin();
  d.update();
  assert.equal(soft.passable, false);
  assert.equal(soft.brokenCount, 0);
});
