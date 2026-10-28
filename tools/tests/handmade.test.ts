// Hand-made GLBs linked from the data (`model.glb` in data/weapons …): loadable as the game loads them (no Draco /
// extensions, transforms applied, named parts, vertex colours), and a gun's anchors (data/weapons/<id>.json) really sit
// on its model: the sight axis runs free through the optic, the lens stencil fits inside it, the muzzle is the barrel end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OPTICS, WEAPONS } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';
import { linkedModels, partName } from '../../src/assets/library.ts';

const DIR = 'public/assets/models/';
const links = Object.entries(linkedModels());
const guns = Object.values(WEAPONS).filter((w) => w.model.glb);

function gltfJson(buf: Buffer) {
  const n = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + n).toString('utf8'));
}
async function meshes(file: string): Promise<Record<string, THREE.Mesh>> {
  const buf = readFileSync(`${DIR}${file}`);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const out: Record<string, THREE.Mesh> = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { (m.material as THREE.Material).side = THREE.DoubleSide; out[partName(m.name)] = m; } });
  return out;
}

test('every model the data links exists under public/assets/models/', () => {
  assert.ok(links.length >= 1);
  for (const [id, file] of links) assert.ok(existsSync(`${DIR}${file}`), `${id}: ${file}`);
});

test('the linked GLBs load as the game loads them: no compression, named parts (a model prefix allowed), vertex colours', () => {
  for (const [id, file] of links) {
    const j = gltfJson(readFileSync(`${DIR}${file}`));
    assert.equal(j.extensionsUsed, undefined, `${id}: extensions (Draco …) the loader can't read`);
    if (id.startsWith('weapon_')) {
      // meshes are body / body_glow / mag (l85_body …); other nodes are anchor empties
      const meshes = j.nodes.filter((n: { mesh?: number }) => n.mesh !== undefined).map((n: { name: string }) => partName(n.name));
      for (const n of meshes) assert.ok(['body', 'body_glow', 'mag'].includes(n), `${id}: unexpected part ${n}`);
      assert.deepEqual(meshes.filter((n: string) => n !== 'body_glow').sort(), ['body', 'mag'], `${id}: body + mag`);
    }
    for (const m of j.meshes) for (const p of m.primitives) assert.ok('COLOR_0' in p.attributes, `${id}: ${m.name} vertex colours`);
  }
});

test('hand-made guns carry their lens caps (body_glow: drawn in 3P only), and the caps close the sight axis — why 1P hides them', async () => {
  for (const w of guns) {
    const parts = await meshes(w.model.glb!);
    assert.ok(parts.body_glow && parts.body_glow.geometry.getAttribute('position').count > 0, `${w.id}: body_glow geometry`);
    const { sight, lens } = w.model.anchors;
    const rc = new THREE.Raycaster(new THREE.Vector3(0, sight[1], lens[2] - 0.1), new THREE.Vector3(0, 0, 1), 0, sight[2] - lens[2] + 0.2);
    assert.ok(rc.intersectObject(parts.body_glow, false).length > 0, `${w.id}: caps on the sight axis`);
  }
});

test('hand-made guns: anchors sit on the model — a free sight line, the lens stencil inside the optic, the muzzle at the barrel end', async () => {
  for (const w of guns) {
    const { body } = await meshes(w.model.glb!);
    const [, sy, sz] = w.model.anchors.sight;
    const [, ly, lz] = w.model.anchors.lens;
    assert.equal(sy, ly, `${w.id}: sight axis level`);
    for (const [dx, dy] of [[0, 0], [0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]]) {
      const rc = new THREE.Raycaster(new THREE.Vector3(dx, sy + dy, lz - 0.05), new THREE.Vector3(0, 0, 1), 0, sz - lz + 0.1);
      assert.deepEqual(rc.intersectObject(body, false).map((h) => +h.point.z.toFixed(3)), [], `${w.id}: sight line (${dx}, ${dy}) blocked`);
    }
    const optic = OPTICS[w.style.optic];
    if (optic.lens) {
      let r = Infinity;
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * Math.PI * 2;
        const rc = new THREE.Raycaster(new THREE.Vector3(0, ly, lz), new THREE.Vector3(Math.cos(t), Math.sin(t), 0), 0, 0.1);
        r = Math.min(r, rc.intersectObject(body, false)[0]?.distance ?? Infinity);
      }
      assert.ok(r >= optic.lens.size[0] / 2, `${w.id}: tube radius at the lens ${r.toFixed(4)} < the ${optic.id} lens ${optic.lens.size[0] / 2}`);
    }
    const box = new THREE.Box3().setFromObject(body);
    const [, my, mz] = w.model.anchors.muzzle;
    assert.ok(Math.abs(mz - box.min.z) < 0.005, `${w.id}: muzzle z ${mz} vs front ${box.min.z.toFixed(4)}`);
    const front: number[] = [];
    const p = body.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < box.min.z + 0.003) front.push(p.getY(i));
    assert.ok(my > Math.min(...front) && my < Math.max(...front), `${w.id}: muzzle y ${my} inside the barrel end`);
  }
});

test('Sledge carries the hand-made L85A2', () => {
  assert.equal(OPERATORS.sledge.primary, 'l85a2');
  assert.equal(WEAPONS.l85a2.model.glb, 'handmade/weapon_l85a2.glb');
});

test('part names: Blender suffixes and a model prefix are dropped, side suffixes folded (l85_body → body, arm.L → armL)', () => {
  const cases: [string, string][] = [['l85_body', 'body'], ['l85_body_glow', 'body_glow'], ['l85_mag', 'mag'], ['body.001', 'body'], ['sledge_armL', 'armL'], ['arm.L', 'armL'], ['thigh_R', 'thighR'], ['l85_handL', 'handL'], ['Empty', 'Empty']];
  for (const [raw, want] of cases) assert.equal(partName(raw), want, raw);
});
