// Every ground-floor outer window (the attackers' way in) can be vaulted from either side you can stand at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { buildHouse } from '../../src/map/MapBuilder.ts';
import { buildOutdoor } from '../../src/map/Outdoor.ts';
import { decodeHouseDatamap512Headless } from '../../src/map/houseDatamap.ts';
import { World } from '../../src/game/World.ts';
import { Gadgets } from '../../src/game/Gadgets.ts';
import { Soldier } from '../../src/game/Soldier.ts';

test('every 1F outer window offers a vault from each side with floor to stand on (no furniture or clip in the way)', async () => {
  const ph = await Physics.create();
  const d = new DestructionSystem(ph);
  const scene = new THREE.Scene();
  const house = buildHouse(ph, d, scene);
  buildOutdoor(ph, scene, decodeHouseDatamap512Headless());
  ph.world.step();
  const w = new World(ph, d, {} as never, house, scene);
  w.gadgets = new Gadgets(w);
  w.phase = 'action';
  const s = new Soldier(w, { id: 'me', name: 'me', side: 'attack', operator: 'ash', kind: 'local', pos: new THREE.Vector3(), yaw: 0 });
  const windows = house.openings.filter((o) => o.kind === 'window' && o.exterior && o.floor === 0 && o.run !== 'd');
  assert.ok(windows.length >= 4);
  const bad: string[] = [];
  let checked = 0;
  for (const op of windows) {
    const sill = op.center.y - op.h / 2;
    for (const side of [1, -1]) {
      const n = op.normal.clone().multiplyScalar(side);
      const at = op.center.clone().addScaledVector(n, 0.75);
      const floor = ph.raycast(at.clone().setY(sill), new THREE.Vector3(0, -1, 0), 1.4);
      // somewhere to stand with the sill at vaulting height (else: a drop on that side — nothing to vault from)
      if (!floor || floor.normal.y < 0.7 || sill - floor.point.y < 0.33) continue;
      s.teleport(floor.point.clone(), Math.atan2(n.x, n.z));
      ph.world.step();
      checked++;
      if (!s.probeVault()) bad.push(`${op.label} #${op.id} from the ${side > 0 ? '+' : '−'}normal side`);
    }
  }
  // (the back-entrance bay window became the back stairwell's: 5 standable sides on the 1F outer windows that remain)
  assert.ok(checked >= 5, `only ${checked} window sides checked`);
  assert.deepEqual(bad, []);
});
