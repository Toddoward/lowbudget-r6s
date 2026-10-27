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

/* ------------------------------------------------------------------ the plate is where it is drawn */
const ndcRect = (pts: THREE.Vector3[], cam: THREE.Camera) => {
  const b = new THREE.Box2();
  for (const p of pts) { const q = p.clone().project(cam); b.expandByPoint(new THREE.Vector2(q.x, q.y)); }
  return b;
};
const iou = (a: THREE.Box2, b: THREE.Box2) => {
  const i = a.clone().intersect(b);
  if (i.isEmpty()) return 0;
  const ar = (x: THREE.Box2) => (x.max.x - x.min.x) * (x.max.y - x.min.y);
  return ar(i) / (ar(a) + ar(b) - ar(i));
};
/** the 4 corners of the collider's face, world space */
function colliderFace(c: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number }; halfExtents(): { x: number; y: number; z: number } }) {
  const t = c.translation(), r = c.rotation(), h = c.halfExtents();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * h.x, y * h.y, 0).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z)));
}

test('third person: the drawn plate is the collider (centre, facing, size) in every pose and stance', async () => {
  const { Rig } = await import('../../src/render/Rig.ts');
  const { Stance } = await import('../../src/game/types.ts');
  for (const op of ['montagne', 'blitz']) {
    const { s, step } = await setup(op);
    const rig = new Rig(op, s.weapon!.def.id);
    const poses: [string, Partial<SoldierInput>, number][] = [['front', {}, 0], ['ads', { ads: true }, 0], ['run', { moveF: 1, sprint: true }, 0], ['front', { stance: Stance.Crouch }, 1]];
    for (const [want, inp, st] of poses) {
      step(inp, 20);
      assert.equal(s.shieldPose, want, `${op}: ${want}`);
      rig.root.position.copy(s.pos);
      rig.root.rotation.y = s.yaw;
      rig.setShieldPose(s.shieldPose);
      rig.pose(1 / 30, s.stance, s.pitch, 0, 0, false, { ads: s.ads, sprint: s.sprinting });
      rig.root.updateMatrixWorld(true);
      const plate = (rig as unknown as { shield: THREE.Group }).shield;
      const c = s.shieldCollider!;
      const t = c.translation();
      const pc = plate.getWorldPosition(new THREE.Vector3());
      assert.ok(pc.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) < 0.01, `${op} ${want} stance ${st}: plate ${pc.distanceTo(new THREE.Vector3(t.x, t.y, t.z)).toFixed(3)} m from its collider`);
      const nPlate = new THREE.Vector3(0, 0, -1).applyQuaternion(plate.getWorldQuaternion(new THREE.Quaternion()));
      const r = c.rotation();
      const nCol = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      assert.ok(nPlate.angleTo(nCol) < 0.02, `${op} ${want}: facing`);
      // the model's plate is the collider's size
      const local = new THREE.Box3();
      plate.updateMatrixWorld(true);
      const inv = plate.matrixWorld.clone().invert();
      plate.traverse((o) => { if ((o as THREE.Mesh).isMesh) local.union(new THREE.Box3().setFromObject(o, true).applyMatrix4(inv)); });
      const h = c.halfExtents();
      assert.ok(Math.abs((local.max.y - local.min.y) * plate.scale.y - 2 * h.y) < 0.03, `${op}: height`);
      assert.ok(Math.abs((local.max.x - local.min.x) * plate.scale.x - 2 * h.x) < 0.05, `${op}: width`);
      step({ stance: Stance.Stand }, 10);
    }
  }
});

test('first person: the shield covers exactly the screen area its collider covers; in front the crosshair is in the viewport', async () => {
  const { ViewModel } = await import('../../src/render/ViewModel.ts');
  const { SHIELD_PLATES } = await import('../../src/assets/gadgetModels.ts');
  for (const op of ['montagne', 'blitz']) {
    for (const [want, inp] of [['front', {}], ['ads', { ads: true }], ['run', { moveF: 1, sprint: true }]] as const) {
      for (const pitch of [0, -0.4, 0.3]) {
        const { s, step } = await setup(op);
        s.pitch = pitch;
        step(inp, 25);
        s.pitch = pitch;
        assert.equal(s.shieldPose, want);
        const vm = new ViewModel();
        vm.worldFov = 75;
        for (let i = 0; i < 60; i++) vm.update(1 / 60, s, { x: 0, y: 0 }, false, want === 'run', 16 / 9, 1);
        vm.camera.updateMatrixWorld(true);
        const world = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
        world.position.copy(s.eye());
        world.rotation.set(s.pitch + s.recoilP, s.yaw + s.recoilY, s.cameraRoll, 'YXZ');
        world.updateMatrixWorld(true);
        const col = ndcRect(colliderFace(s.shieldCollider! as never), world);
        const plate = (vm as unknown as { shield: THREE.Group }).shield;
        plate.updateMatrixWorld(true);
        const P = op === 'blitz' ? SHIELD_PLATES.flash_shield : SHIELD_PLATES.shield;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3((x * P.w) / 2, (y * P.h) / 2, 0).applyMatrix4(plate.matrixWorld));
        const drawn = ndcRect(corners, vm.camera);
        if (want === 'run') {
          // carried along the left side of the body: at the left edge of the view, not in front
          const c = plate.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
          assert.ok(c.x < -0.2 && Math.atan2(-c.x, -c.z) > 0.6, `${op} run: plate centre at (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) in view space`);
          continue;
        }
        const tag = `${op} ${want} pitch ${pitch}: drawn x ${drawn.min.x.toFixed(2)}..${drawn.max.x.toFixed(2)} y ${drawn.min.y.toFixed(2)}..${drawn.max.y.toFixed(2)} vs collider x ${col.min.x.toFixed(2)}..${col.max.x.toFixed(2)} y ${col.min.y.toFixed(2)}..${col.max.y.toFixed(2)}`;
        assert.ok(iou(drawn, col) > 0.9, tag);
        if (want === 'front' && pitch === 0) {
          const slit = [[-1, -1], [1, 1]].map(([x, y]) => new THREE.Vector3(P.sx + (x * P.sw) / 2, P.sy + (y * P.sh) / 2, 0).applyMatrix4(plate.matrixWorld));
          const r = ndcRect(slit, vm.camera);
          assert.ok(r.containsPoint(new THREE.Vector2(0, 0)), `${op}: the crosshair is in the viewport (slit x ${r.min.x.toFixed(2)}..${r.max.x.toFixed(2)} y ${r.min.y.toFixed(2)}..${r.max.y.toFixed(2)})`);
          assert.ok(col.containsPoint(new THREE.Vector2(0, 0)) && col.min.y < -0.9, `${op}: in front, square in the middle of the view`);
        }
      }
    }
  }
});

test('rounds: held in front it stops them at the head and chest; sprinting it is at the left side and only covers the left', async () => {
  const { ph, s, step } = await setup();
  step({}, 15);
  const at = (h: number, from: THREE.Vector3) => {
    const target = s.pos.clone().add(new THREE.Vector3(0, h, 0));
    const d = target.clone().sub(from).normalize();
    return !!ph.raycast(from, d, from.distanceTo(target), G_GADGET, (t) => !(t?.kind === 'gadget' && t.gadgetId.startsWith('shield:')));
  };
  assert.equal(s.shieldPose, 'front');
  assert.ok(at(1.65, new THREE.Vector3(0, 1.65, -8)), 'front: head shot stopped');
  assert.ok(at(1.2, new THREE.Vector3(0, 1.2, -8)), 'front: chest shot stopped');
  step({ moveF: 1, sprint: true }, 20);
  assert.equal(s.shieldPose, 'run');
  const ahead = s.pos.clone().add(new THREE.Vector3(0, 1.2, -8));
  assert.ok(!at(1.2, ahead), 'sprinting: the chest is open from the front');
  const left = s.pos.clone().add(new THREE.Vector3(-8, 1.1, 0));
  assert.ok(at(1.1, left), 'sprinting: the left flank is covered');
  assert.ok(!at(1.1, s.pos.clone().add(new THREE.Vector3(8, 1.1, 0))), 'sprinting: the right flank is open');
});
