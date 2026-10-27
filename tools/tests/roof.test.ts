// The roof is pitched (blueprint roof plan), covers every 2F room, and can be stood on (≤ 30° slopes + a flat top).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G_WORLD, Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { ROOF_Y, ROOMS } from '../../src/map/houseLayout.ts';

test('a pitched roof over every 2F room: hips at 30° up to a flat top, nothing left flat at the eaves', async () => {
  const ph = await Physics.create();
  buildHouse(ph, new DestructionSystem(ph), new THREE.Scene());
  ph.world.step();
  const down = new THREE.Vector3(0, -1, 0);
  const bad: string[] = [];
  let slope = 0, flat = 0, top = -Infinity;
  for (const room of ROOMS.filter((r) => r.floor === 1)) {
    for (const r of room.rects) {
      for (let x = r.x0 + 0.3; x < r.x1; x += 0.5) {
        for (let z = r.z0 + 0.3; z < r.z1; z += 0.5) {
          const hit = ph.raycast(new THREE.Vector3(x, 30, z), down, 40, G_WORLD);
          if (!hit || hit.point.y < ROOF_Y + 0.05) { bad.push(`${room.id} (${x.toFixed(1)}, ${z.toFixed(1)}): roof at ${hit?.point.y.toFixed(2)}`); continue; }
          if (hit.normal.y < Math.cos(THREE.MathUtils.degToRad(31))) bad.push(`${room.id} (${x.toFixed(1)}, ${z.toFixed(1)}): ${THREE.MathUtils.radToDeg(Math.acos(hit.normal.y)).toFixed(0)}° — too steep to stand on`);
          if (hit.normal.y > 0.999) flat++; else slope++;
          top = Math.max(top, hit.point.y);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(slope > flat * 0.5, `mostly pitched: ${slope} sloped samples, ${flat} on the flat top`);
  assert.ok(top > ROOF_Y + 1.8 && top < ROOF_Y + 3.2, `roof top ${top.toFixed(2)} m`);
});
