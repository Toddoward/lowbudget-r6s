// Hand-made GLBs (public/assets/models/handmade/): loadable as the game loads them (no Draco / extensions, transforms
// applied, parts named body / mag / body_glow, vertex colours), and the anchors measured on the model really sit on it:
// the sight axis runs free through the hollow scope, the lens stencil fits inside the tube, the muzzle is the barrel's end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HANDMADE_ANCHORS } from '../../src/assets/handmade.ts';
import { WEAPONS, weaponSpec } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';

const DIR = 'public/assets/models/';
const manifest = JSON.parse(readFileSync(`${DIR}manifest.json`, 'utf8')).assets as Record<string, { file: string; category: string; handmade?: boolean; bytes: number }>;
const handmade = Object.entries(manifest).filter(([, a]) => a.handmade);

function gltfJson(buf: Buffer) {
  const n = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + n).toString('utf8'));
}
async function meshes(file: string): Promise<Record<string, THREE.Mesh>> {
  const buf = readFileSync(`${DIR}${file}`);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const out: Record<string, THREE.Mesh> = {};
  gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { (m.material as THREE.Material).side = THREE.DoubleSide; out[m.name] = m; } });
  return out;
}

test('every hand-made manifest entry has its file, and every hand-made anchor set has its entry', () => {
  assert.ok(handmade.length >= 2);
  for (const [id, a] of handmade) {
    assert.ok(a.file.startsWith('handmade/') && existsSync(`${DIR}${a.file}`), `${id}: ${a.file}`);
    assert.equal(readFileSync(`${DIR}${a.file}`).length, a.bytes, `${id}: manifest bytes`);
  }
  for (const id of Object.keys(HANDMADE_ANCHORS)) assert.ok(manifest[id]?.handmade, `${id} in the manifest as handmade`);
});

test('the hand-made GLBs load as the game loads them: no compression, transforms applied, named parts, vertex colours', () => {
  for (const [id, a] of handmade) {
    const j = gltfJson(readFileSync(`${DIR}${a.file}`));
    assert.equal(j.extensionsUsed, undefined, `${id}: extensions (Draco …) the loader can't read`);
    for (const n of j.nodes) {
      for (const k of ['translation', 'rotation', 'scale', 'matrix']) assert.equal(n[k], undefined, `${id}: node ${n.name} has ${k} (apply transforms: the game drops node transforms)`);
      assert.ok(['body', 'body_glow', 'mag'].includes(n.name), `${id}: unexpected part ${n.name}`);
    }
    assert.deepEqual(j.nodes.filter((n: { mesh?: number }) => n.mesh !== undefined).map((n: { name: string }) => n.name).filter((s: string) => s !== 'body_glow').sort(), ['body', 'mag'], `${id}: body + mag`);
    for (const m of j.meshes) for (const p of m.primitives) assert.ok('COLOR_0' in p.attributes, `${id}: ${m.name} vertex colours`);
  }
});

test('L85A2: the plain model carries lens caps (body_glow, drawn in 3P only), the *_noglow one none', async () => {
  const withCaps = await meshes(manifest.weapon_l85a2.file);
  const without = await meshes(manifest.weapon_l85a2_noglow.file);
  assert.ok(withCaps.body_glow, 'body_glow in weapon_l85a2');
  assert.equal(without.body_glow, undefined, 'no body_glow geometry in weapon_l85a2_noglow');
  // the caps close the sight axis: that's why the first-person view hides *_glow parts
  const a = HANDMADE_ANCHORS.weapon_l85a2;
  const rc = new THREE.Raycaster(new THREE.Vector3(0, a.sight![1], a.lens![2] - 0.1), new THREE.Vector3(0, 0, 1), 0, 1);
  assert.ok(rc.intersectObject(withCaps.body_glow, false).length > 0, 'caps on the sight axis');
});

test('L85A2 anchors sit on the model: a free sight line through the scope, the lens stencil inside the tube, the muzzle at the barrel end', async () => {
  for (const id of ['l85a2', 'l85a2_noglow']) {
    const spec = weaponSpec(id);
    assert.deepEqual(spec.anchors!.sight, HANDMADE_ANCHORS[spec.id].sight, `${id}: hand-made anchors override the procedural ones`);
    const { body } = await meshes(manifest[spec.id].file);
    const [, sy, sz] = spec.anchors!.sight!;
    const [, ly, lz] = spec.anchors!.lens!;
    assert.equal(sy, ly, 'sight axis level');
    // from in front of the objective to behind the eyepiece nothing of the body is on the axis (nor 1 cm around it)
    for (const [dx, dy] of [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]]) {
      const rc = new THREE.Raycaster(new THREE.Vector3(dx, sy + dy, lz - 0.05), new THREE.Vector3(0, 0, 1), 0, sz - lz + 0.1);
      assert.deepEqual(rc.intersectObject(body, false).map((h) => +h.point.z.toFixed(3)), [], `${id}: sight line (${dx}, ${dy}) blocked`);
    }
    // the ACOG lens stencil (Ø 42 mm, ViewModel) fits inside the objective tube at the lens anchor
    let r = Infinity;
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      const rc = new THREE.Raycaster(new THREE.Vector3(0, ly, lz), new THREE.Vector3(Math.cos(t), Math.sin(t), 0), 0, 0.1);
      r = Math.min(r, rc.intersectObject(body, false)[0]?.distance ?? Infinity);
    }
    assert.ok(r >= 0.021 && r < 0.03, `${id}: tube radius at the lens ${r.toFixed(4)}`);
    // the eyepiece ends just behind the sight anchor (the eye sits eyeRelief behind it, outside the tube)
    const box = new THREE.Box3().setFromObject(body);
    const [, my, mz] = spec.anchors!.muzzle!;
    assert.ok(Math.abs(mz - box.min.z) < 0.005, `${id}: muzzle z ${mz} vs front ${box.min.z.toFixed(4)}`);
    const front: number[] = [];
    const p = body.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < box.min.z + 0.003) front.push(p.getY(i));
    assert.ok(my > Math.min(...front) && my < Math.max(...front), `${id}: muzzle y ${my} inside the barrel end`);
  }
});

test('Sledge carries the plain L85A2, Thatcher the one without lens caps (same weapon otherwise)', () => {
  assert.equal(OPERATORS.sledge.primary, 'l85a2');
  assert.equal(OPERATORS.thatcher.primary, 'l85a2_noglow');
  const { id: _a, ...a } = WEAPONS.l85a2;
  const { id: _b, ...b } = WEAPONS.l85a2_noglow;
  assert.deepEqual(a, b);
});
