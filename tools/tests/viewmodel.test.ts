// First-person arms: the forearms never come up into the sight picture; every item is on screen at the hip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ViewModel } from '../../src/render/ViewModel.ts';
import { WEAPONS } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';

/** just what the view model reads off a soldier */
const soldier = (operator: string, slot: number, ads: number) => {
  const op = OPERATORS[operator];
  const w = (id: string) => ({ def: WEAPONS[id], mag: WEAPONS[id].mag, reserve: 0 });
  const weapons = [w(op.primary), w(op.secondary)];
  return {
    op, slot, ads, weapons, get weapon() { return slot < 2 ? weapons[slot] : null; },
    vel: new THREE.Vector3(), equipT: 0, reloading: false, reloadT: 0, reloadDur: 1, meleeCd: 0, interactProgress: 0, shieldPose: null,
  } as never;
};

function settle(vm: ViewModel, s: never) {
  for (let i = 0; i < 90; i++) vm.update(1 / 60, s, { x: 0, y: 0 }, false, false, 16 / 9, 1);
  vm.camera.updateMatrixWorld(true);
}

/** screen-space (NDC) box of a mesh */
function ndc(vm: ViewModel, o: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(o, true);
  const out = new THREE.Box2();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(vm.camera.matrixWorldInverse);
    if (p.z > -0.005) { out.expandByPoint(new THREE.Vector2(0, -2)); continue; } // behind / at the eye: clipped below
    p.applyMatrix4(vm.camera.projectionMatrix);
    out.expandByPoint(new THREE.Vector2(p.x, p.y));
  }
  return out;
}
/** the sleeves (forearms) of both gun hands */
const sleeves = (vm: ViewModel) => ['handR', 'handL'].map((k) => (vm as unknown as Record<string, THREE.Group>)[k].children[1]);

test('aiming down sights, neither forearm comes up into the sight picture', () => {
  for (const [op, slot] of [['ash', 0], ['jager', 0], ['ash', 1], ['thermite', 0]] as const) {
    const vm = new ViewModel();
    settle(vm, soldier(op, slot, 1));
    for (const sl of sleeves(vm)) {
      const b = ndc(vm, sl);
      // the sight picture: the middle of the screen, from a little below the reticle up
      const intrudes = b.max.y > -0.35 && b.min.x < 0.35 && b.max.x > -0.35;
      assert.ok(!intrudes, `${op} slot ${slot}: a forearm reaches y ${b.max.y.toFixed(2)} (NDC) inside the sight picture`);
    }
  }
});

test('at the hip every item is on screen, in the lower right, the forearms going down out of the frame', () => {
  for (const [op, slot] of [['ash', 0], ['ash', 1], ['ash', 2], ['sledge', 2], ['jager', 2], ['thermite', 2]] as const) {
    const vm = new ViewModel();
    settle(vm, soldier(op, slot, 0));
    const holder = (vm as unknown as { holder: THREE.Group }).holder;
    const item = holder.children.find((c) => c.name.startsWith('vm_'))!;
    const b = ndc(vm, item);
    assert.ok(b.max.x > 0 && b.min.x < 1 && b.max.y > -1 && b.min.y < 0.6, `${op} slot ${slot}: item at x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)} y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`);
    for (const sl of sleeves(vm)) {
      const s = ndc(vm, sl);
      assert.ok(s.min.y < -0.9, `${op} slot ${slot}: a forearm floats in the view (bottom at ${s.min.y.toFixed(2)})`);
    }
  }
});
