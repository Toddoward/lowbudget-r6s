import * as THREE from 'three';
import { BoxBatch } from '../world/BoxBatch.ts';
import { vcMaterial } from '../render/palette.ts';
import type { AssetSpec, PartSpec } from './spec.ts';
import { glbBones } from './library.ts';

const geoCache = new Map<string, THREE.BufferGeometry>();
function unitGeo(shape: PartSpec['shape'], seg: number): THREE.BufferGeometry {
  const key = `${shape}:${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    switch (shape) {
      case 'cyl': g = new THREE.CylinderGeometry(1, 1, 1, seg, 1); break;
      case 'cone': g = new THREE.ConeGeometry(1, 1, seg, 1); break;
      case 'sphere': g = new THREE.IcosahedronGeometry(1, seg > 8 ? 1 : 0); break;
      case 'wedge': {
        const s = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, 0.5)]);
        g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
        g.translate(0, 0, -0.5);
        break;
      }
      default: g = new THREE.BoxGeometry(1, 1, 1);
    }
    geoCache.set(key, g);
  }
  return g;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const D2R = Math.PI / 180;

export function partMatrix(part: PartSpec, out = tmpM): THREE.Matrix4 {
  const r = part.r ?? [0, 0, 0];
  tmpQ.setFromEuler(tmpE.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ'));
  return out.compose(new THREE.Vector3(...part.p), tmpQ, new THREE.Vector3(part.s[0], part.s[1], part.s[2]));
}

/** Build a spec into one mesh per bone (key '' when unboned). */
export function buildBones(spec: AssetSpec): Map<string, THREE.Mesh> {
  const fromGlb = glbBones(spec.id);
  if (fromGlb) return fromGlb;
  const batches = new Map<string, BoxBatch>();
  const emissive = new Map<string, BoxBatch>();
  for (const part of spec.parts) {
    const bone = part.bone ?? '';
    const map = part.emissive ? emissive : batches;
    let b = map.get(bone);
    if (!b) { b = new BoxBatch(); map.set(bone, b); }
    const col = new THREE.Color(part.c);
    const m = partMatrix(part);
    if (part.shape === 'box') b.tbox(m, 1, 1, 1, col);
    else b.geom(unitGeo(part.shape, part.seg ?? 8), m, col);
  }
  const out = new Map<string, THREE.Mesh>();
  for (const [bone, b] of batches) {
    const mesh = new THREE.Mesh(b.build(), vcMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = bone || spec.id;
    out.set(bone, mesh);
  }
  for (const [bone, b] of emissive) {
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    mesh.name = `${bone}_glow`;
    const host = out.get(bone);
    if (host) host.add(mesh);
    else out.set(`${bone}_glow`, mesh);
  }
  return out;
}

/** Build a spec into a single group (all bones merged under one parent). */
export function buildAsset(spec: AssetSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.id;
  for (const m of buildBones(spec).values()) g.add(m);
  return g;
}
