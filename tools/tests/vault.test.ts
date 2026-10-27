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

test("2F: out of the Kids' Room east window, across the back porch roof, in through the Master Bedroom window — and back", async () => {
  const { buildWalkGrid, lineWalk, nearestFit } = await import('../../src/map/walkGrid.ts');
  const { FLOORS } = await import('../../src/map/houseLayout.ts');
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
  const roof = FLOORS.find((f) => f.id === 'roof_porch_s')!;
  const onRoof = (p: THREE.Vector3) => p.x > roof.rect.x0 && p.x < roof.rect.x1 && p.z > roof.rect.z0 && p.z < roof.rect.z1 && Math.abs(p.y - roof.y) < 0.2;
  // the 2F windows that open onto that roof
  const wins = house.openings.filter((o) => o.kind === 'window' && o.floor === 1 && o.exterior && onRoof(o.center.clone().addScaledVector(o.normal, Math.sign(o.normal.x + o.normal.z) * 0.8).setY(roof.y)));
  const kids = wins.find((o) => o.rooms.includes('kids'));
  const master = wins.find((o) => o.rooms.includes('master'));
  assert.ok(kids && master, `windows onto the back porch roof: ${wins.map((o) => o.label).join(', ')}`);
  /** vault through a window from one side; returns where the body lands */
  const vault = (op: typeof kids, side: number) => {
    const n = op!.normal.clone().multiplyScalar(side);
    const floor = ph.raycast(op!.center.clone().addScaledVector(n, 0.75).setY(op!.center.y - op!.h / 2), new THREE.Vector3(0, -1, 0), 1.4)!;
    s.teleport(floor.point.clone(), Math.atan2(n.x, n.z));
    ph.world.step();
    return s.probeVault()?.land ?? null;
  };
  /** the window side (±normal) the room is on */
  const roomSide = (op: typeof kids) => (onRoof(op!.center.clone().addScaledVector(op!.normal, 0.8).setY(roof.y)) ? -1 : 1);
  const kOut = vault(kids, roomSide(kids));
  const mOut = vault(master, roomSide(master));
  assert.ok(kOut && onRoof(kOut), `Kids' Room → roof lands at ${kOut?.toArray().map((v) => v.toFixed(2))}`);
  assert.ok(mOut && onRoof(mOut), `Master Bedroom → roof lands at ${mOut?.toArray().map((v) => v.toFixed(2))}`);
  const kIn = vault(kids, -roomSide(kids));
  const mIn = vault(master, -roomSide(master));
  assert.ok(kIn && !onRoof(kIn) && Math.abs(kIn.y - 3.5) < 0.2, 'roof → Kids\' Room');
  assert.ok(mIn && !onRoof(mIn) && Math.abs(mIn.y - 3.5) < 0.2, 'roof → Master Bedroom');
  // walking across the roof between the two landing spots, upright (an L: along the Kids' Room wall, then along the Master's)
  const g = buildWalkGrid(ph, { x0: roof.rect.x0 - 0.5, z0: roof.rect.z0 - 0.5, x1: roof.rect.x1 + 0.5, z1: roof.rect.z1 + 0.5 }, 0.1, { yMax: 5 });
  const a = kOut!, b = mOut!;
  const corner = new THREE.Vector3(a.x, roof.y, b.z + 0.3);
  for (const p of [a, corner, b]) assert.ok(nearestFit(g, p.x, roof.y, p.z, 'stand', 0.4, 0.3) >= 0, `standing room on the roof at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
  assert.ok(lineWalk(g, { x: a.x, y: roof.y, z: a.z }, { x: corner.x, y: roof.y, z: corner.z }) && lineWalk(g, { x: corner.x, y: roof.y, z: corner.z }, { x: b.x, y: roof.y, z: b.z }), 'walk the roof from one window to the other');
});
