// Third-person arms hold what is in hand — hands on the grip and handguard (or the shield handle), in front of the
// body, the gun along the aim — in every stance and pitch, at the hip, aiming and sprinting (as first person does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rig } from '../../src/render/Rig.ts';
import { Stance } from '../../src/game/types.ts';
import { OPERATORS } from '../../src/game/operators.ts';

const FWD = new THREE.Vector3(0, 0, -1);

function posed(op: string, weapon: string | null, stance: Stance, pitch: number, act: { ads?: number; sprint?: boolean; reload?: number } = {}, shield?: 'front' | 'ads' | 'run' | 'back') {
  const rig = new Rig(op, weapon);
  if (shield) rig.setShieldPose(shield);
  for (let i = 0; i < 60; i++) rig.pose(1 / 30, stance, pitch, 0, act.sprint ? 5 : 0, false, act);
  rig.root.updateMatrixWorld(true);
  return rig;
}

const CASES: [string, string, Stance, number, { ads?: number; sprint?: boolean }][] = [];
for (const [op, w] of [['ash', 'r4c'], ['smoke', 'fmg9'], ['terrorist', OPERATORS.terrorist.primary], ['ash', 'p226']] as const) {
  for (const st of [Stance.Stand, Stance.Crouch, Stance.Prone]) {
    for (const pitch of [-0.6, 0, 0.6]) {
      CASES.push([op, w, st, pitch, {}]);
      CASES.push([op, w, st, pitch, { ads: 1 }]);
    }
  }
}

test('hands on the weapon (right on the grip, left on the handguard / cupping a pistol), in front of the body, gun along the aim', () => {
  const bad: string[] = [];
  for (const [op, w, st, pitch, act] of CASES) {
    const rig = posed(op, w, st, pitch, act);
    const tag = `${op} ${w} stance ${st} pitch ${pitch}${act.ads ? ' ADS' : ''}`;
    for (const side of ['left', 'right'] as const) {
      const hand = rig.handWorld(side);
      const t = rig.targets[side];
      if (hand.distanceTo(t) > 0.03) bad.push(`${tag}: ${side} hand ${hand.distanceTo(t).toFixed(3)} m off its hold`);
      // in front of its shoulder (the old rig had them behind the back)
      const shoulder = (rig as unknown as Record<string, THREE.Group>)[side === 'left' ? 'armL' : 'armR'].getWorldPosition(new THREE.Vector3());
      if (hand.z > shoulder.z - 0.12) bad.push(`${tag}: ${side} hand ${(shoulder.z - hand.z).toFixed(2)} m ahead of the shoulder — not in front of the body`);
    }
    const gun = (rig as unknown as { gun: THREE.Group }).gun;
    const dir = FWD.clone().applyQuaternion(gun.quaternion);
    const aim = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));
    if (dir.angleTo(aim) > THREE.MathUtils.degToRad(2)) bad.push(`${tag}: gun ${THREE.MathUtils.radToDeg(dir.angleTo(aim)).toFixed(1)}° off the aim`);
  }
  assert.deepEqual(bad, []);
});

test('sprinting: low ready, both hands still on the gun', () => {
  const rig = posed('ash', 'r4c', Stance.Stand, 0, { sprint: true });
  for (const side of ['left', 'right'] as const) assert.ok(rig.handWorld(side).distanceTo(rig.targets[side]) < 0.03, side);
  const gun = (rig as unknown as { gun: THREE.Group }).gun;
  const dir = FWD.clone().applyQuaternion(gun.quaternion);
  assert.ok(dir.y < -0.4, `muzzle down (${dir.y.toFixed(2)})`);
});

test('shield operators: right hand on the pistol, left hand on the shield handle; the shield in front of the body', () => {
  for (const op of ['montagne', 'blitz']) {
    for (const pose of ['front', 'ads', 'run'] as const) {
      for (const st of [Stance.Stand, Stance.Crouch]) {
        const rig = posed(op, OPERATORS[op].secondary, st, 0, { ads: pose === 'ads' ? 1 : 0, sprint: pose === 'run' }, pose);
        for (const side of ['left', 'right'] as const) {
          const d = rig.handWorld(side).distanceTo(rig.targets[side]);
          assert.ok(d < 0.04, `${op} ${pose} stance ${st}: ${side} hand ${d.toFixed(3)} m off its hold`);
        }
      }
    }
  }
});

test('the hostage keeps its cuffed hands in front; empty hands hang in front, not behind', () => {
  for (const [op, w] of [['hostage', null], ['ash', null]] as const) {
    const rig = posed(op, w, Stance.Stand, 0);
    for (const side of ['left', 'right'] as const) assert.ok(rig.handWorld(side).z < -0.05, `${op} ${side}: z ${rig.handWorld(side).z.toFixed(2)}`);
  }
});
