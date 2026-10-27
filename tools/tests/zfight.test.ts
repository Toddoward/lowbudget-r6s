// Z-fighting, checked on the geometry rather than by looking: no two faces of the House as it is drawn (walls, bands, slabs,
// trims, destructible panels, props — every mesh in the scene, in world space) lie in the same plane facing the same way
// and overlap where they can be seen. Faces drawn with a different polygon offset (soft walls, hatches) do not fight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { BoxBatch } from '../../src/world/BoxBatch.ts';

type Box = { min: number[]; max: number[]; skip: number; layer: string; mesh: string };
type Face = { axis: number; sign: number; at: number; a0: number; a1: number; b0: number; b1: number; box: number };

/** the House's boxes in world space, read back from the scene graph (meshes turned by other than a quarter turn are left out) */
function worldBoxes(scene: THREE.Scene): Box[] {
  scene.updateMatrixWorld(true);
  const out: Box[] = [];
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    const rec: number[] | undefined = m.isMesh ? m.geometry.userData.boxes : undefined;
    if (!rec) return;
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return;
    m.matrixWorld.decompose(p, q, s);
    if (Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) > 1e-6) return;
    const mat = m.material as THREE.Material;
    const layer = mat.polygonOffset ? `${mat.polygonOffsetFactor}/${mat.polygonOffsetUnits}` : '0';
    for (let i = 0; i < rec.length; i += 7) {
      const lo = [rec[i], rec[i + 1], rec[i + 2]], hi = [rec[i + 3], rec[i + 4], rec[i + 5]];
      const min = [0, 1, 2].map((k) => Math.min(lo[k], hi[k]) * s.getComponent(k) + p.getComponent(k));
      const max = [0, 1, 2].map((k) => Math.max(lo[k], hi[k]) * s.getComponent(k) + p.getComponent(k));
      if ([0, 1, 2].every((k) => max[k] - min[k] > 1e-4)) out.push({ min, max, skip: rec[i + 6], layer, mesh: m.name || m.parent?.name || '' });
    }
  });
  return out;
}

/** every coplanar, same-facing overlap of two faces that can be seen (the spot just in front of it is not inside a solid) */
function coplanarFights(boxes: Box[]): string[] {
  const C = 1;
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let x = Math.floor(b.min[0] / C); x <= Math.floor(b.max[0] / C); x++)
      for (let y = Math.floor(b.min[1] / C); y <= Math.floor(b.max[1] / C); y++)
        for (let z = Math.floor(b.min[2] / C); z <= Math.floor(b.max[2] / C); z++) {
          const k = `${x},${y},${z}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
        }
  });
  // closed boxes: a spot on the seam between two touching solids is covered
  const inside = (pt: number[], skip: Set<number>) => (grid.get(pt.map((v) => Math.floor(v / C)).join(',')) ?? []).some((i) => !skip.has(i) && [0, 1, 2].every((a) => pt[a] >= boxes[i].min[a] - 1e-4 && pt[a] <= boxes[i].max[a] + 1e-4));
  const groups = new Map<string, Face[]>();
  // faces: +x -x +y -y +z -z (BoxBatch's skipFaces bits)
  boxes.forEach((b, i) => {
    for (let axis = 0; axis < 3; axis++) {
      const [u, v] = [0, 1, 2].filter((a) => a !== axis);
      for (const sign of [1, -1]) {
        if (b.skip & (1 << (axis * 2 + (sign > 0 ? 0 : 1)))) continue;
        const at = sign > 0 ? b.max[axis] : b.min[axis];
        const k = `${b.layer}|${axis}${sign}:${at.toFixed(3)}`;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push({ axis, sign, at, a0: b.min[u], a1: b.max[u], b0: b.min[v], b1: b.max[v], box: i });
      }
    }
  });
  const fights: string[] = [];
  for (const fs of groups.values()) {
    if (fs.length < 2) continue;
    fs.sort((p, q) => p.a0 - q.a0);
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length && fs[j].a0 < fs[i].a1 - 1e-4; j++) {
        const p = fs[i], q = fs[j];
        const a0 = Math.max(p.a0, q.a0), a1 = Math.min(p.a1, q.a1), b0 = Math.max(p.b0, q.b0), b1 = Math.min(p.b1, q.b1);
        if (a1 - a0 < 0.01 || b1 - b0 < 0.01) continue;
        const [u, v] = [0, 1, 2].filter((a) => a !== p.axis);
        const skip = new Set([p.box, q.box]);
        let seen = false;
        for (const [fa, fb] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]]) {
          const pt = [0, 0, 0];
          pt[p.axis] = p.at + p.sign * 0.004;
          pt[u] = a0 + (a1 - a0) * fa;
          pt[v] = b0 + (b1 - b0) * fb;
          if (!inside(pt, skip)) { seen = true; break; }
        }
        if (!seen) continue;
        const c = [0, 0, 0];
        c[p.axis] = p.at; c[u] = (a0 + a1) / 2; c[v] = (b0 + b1) / 2;
        const desc = (b: Box) => `${b.mesh}[${b.min.map((n) => n.toFixed(2))} → ${b.max.map((n) => n.toFixed(2))}]`;
        fights.push(`${'xyz'[p.axis]}${p.sign > 0 ? '+' : '−'} face at (${c.map((n) => n.toFixed(2)).join(', ')}) ${(a1 - a0).toFixed(2)} × ${(b1 - b0).toFixed(2)} m: ${desc(boxes[p.box])} / ${desc(boxes[q.box])}`);
      }
    }
  }
  return fights;
}

test('no coplanar overlapping faces anywhere in the House (the source of the flicker at corners and floor lines)', async () => {
  BoxBatch.record = true;
  const ph = await Physics.create();
  const scene = new THREE.Scene();
  buildHouse(ph, new DestructionSystem(ph), scene);
  BoxBatch.record = false;
  const boxes = worldBoxes(scene);
  if (process.env.ZFIGHT_DUMP) console.log(Object.entries(boxes.reduce((n: Record<string, number>, b) => ((n[b.mesh] = (n[b.mesh] ?? 0) + 1), n), {})));
  assert.ok(boxes.length > 1000, `${boxes.length} boxes read back`);
  const fights = coplanarFights(boxes);
  if (process.env.ZFIGHT_DUMP) (await import('node:fs')).writeFileSync(process.env.ZFIGHT_DUMP, fights.join('\n'));
  assert.deepEqual(fights.slice(0, 40), [], `${fights.length} coplanar overlaps`);
});
