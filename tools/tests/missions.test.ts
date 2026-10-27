// Terrorist Hunt mission rules, driven directly (no rendering, no play-through).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../src/core/Physics.ts';
import { DestructionSystem } from '../../src/world/Destruction.ts';
import { World } from '../../src/game/World.ts';
import { DEFUSE_TIME, DISABLE_TIME, GRAB_TIME, Objectives } from '../../src/game/Objectives.ts';
import { SPAWN_ZONES } from '../../src/map/houseLayout.ts';

async function setup(mission: 'bomb' | 'protect' | 'hostage' | 'elimination') {
  const ph = await Physics.create();
  const w = new World(ph, new DestructionSystem(ph), {} as never, {} as never, new THREE.Scene());
  const o = new Objectives(w);
  w.objectives = o;
  w.mode = 'th';
  w.phase = 'action';
  const results: [boolean, string][] = [];
  const calls: string[] = [];
  o.onResult = (a, r) => results.push([a, r]);
  o.onAnnounce = (k) => calls.push(k);
  o.setup(mission, 'garage', 'th');
  const step = (secs: number) => { for (let t = 0; t < secs; t += 0.1) { w.time += 0.1; o.update(0.1); } };
  return { w, o, results, calls, step };
}
const soldierAt = (id: string, side: 'attack' | 'defend' | 'terrorist', p: THREE.Vector3) => {
  const pos = p.clone();
  return { id, side, pos, alive: true, yaw: 0, stance: 0, eye: (o = new THREE.Vector3()) => o.copy(pos).setY(pos.y + 1.6), aimDir: (o = new THREE.Vector3()) => o.set(0, 0, -1) } as never;
};

test('Bomb (TH): plant a defuser, it runs DEFUSE_TIME; White Masks on it cut it; progress is kept; two bombs win', async () => {
  const { w, o, results, calls, step } = await setup('bomb');
  const [b0, b1] = o.bombs;
  const me = soldierAt('self', 'attack', b0.pos);
  w.actors.set('self', me);
  // the plant action is offered next to a bomb
  const c = o.candidate(me);
  assert.equal(c?.label, 'action.plantDefuser');
  c!.run();
  assert.ok(o.defuser);
  assert.ok(calls.includes('defuserPlanted'));
  // White Masks are ordered onto the running defuser
  const goal = o.botGoal('tango0');
  assert.ok(goal && goal.pos.distanceTo(o.defuser!.pos) < 1e-6, 'bots converge on the defuser');
  step(10);
  // one of them reaches it and works it for DISABLE_TIME
  for (let t = 0; t < DISABLE_TIME + 0.2; t += 0.1) goal!.work!(0.1);
  assert.equal(o.defuser, null, 'defuser cut');
  assert.ok(calls.includes('defuserCut'));
  assert.equal(o.botGoal('tango0'), null, 'nothing left to rush');
  assert.ok(b0.done >= 9.9 && b0.done < 11, 'progress kept');
  // replant and hold: the first bomb is defused, the second is next
  o.candidate(me)!.run();
  assert.ok(calls.includes('defuserResumed'));
  step(DEFUSE_TIME - b0.done + 0.2);
  assert.equal(b0.state, 'defused');
  assert.ok(calls.includes('bombDefused'));
  assert.equal(results.length, 0);
  (me as { pos: THREE.Vector3 }).pos.copy(b1.pos);
  o.candidate(me)!.run();
  step(DEFUSE_TIME + 0.2);
  assert.deepEqual(results, [[true, 'Bombs disarmed']]);
});

test('Bomb (TH): before a plant, eliminating every White Mask wins', async () => {
  const { o, results } = await setup('bomb');
  o.checkElimination(2);
  assert.equal(results.length, 0);
  o.checkElimination(0);
  assert.deepEqual(results, [[true, 'All hostiles eliminated']]);
});

test('Bomb (TH): once the defuser is planted only it decides — not the White Masks dying, not the operators dying', async () => {
  // every White Mask dead after the plant: the round runs on until the defuser completes
  const a = await setup('bomb');
  const me = soldierAt('self', 'attack', a.o.bombs[0].pos);
  a.w.actors.set('self', me);
  a.o.candidate(me)!.run();
  a.o.checkElimination(0);
  a.o.checkOperators(0);
  assert.equal(a.results.length, 0, 'planted: neither side is out of the round');
  a.step(DEFUSE_TIME + 0.2);
  assert.equal(a.o.defuser, null, 'the first bomb is done');
  a.o.checkElimination(0);
  assert.deepEqual(a.results, [[true, 'All hostiles eliminated']], 'no defuser running, no White Masks left: won');
  // every operator dead after the plant: the White Masks have to cut it
  const b = await setup('bomb');
  const me2 = soldierAt('self', 'attack', b.o.bombs[0].pos);
  b.w.actors.set('self', me2);
  b.o.candidate(me2)!.run();
  b.o.checkOperators(0);
  b.step(5);
  b.o.checkOperators(0);
  assert.equal(b.results.length, 0, 'the player is dead but the defuser is still working');
  const goal = b.o.botGoal('tango0')!;
  for (let t = 0; t < DISABLE_TIME + 0.2; t += 0.1) goal.work!(0.1);
  b.o.checkOperators(0);
  assert.deepEqual(b.results, [[false, 'All operators down']], 'cut with no operator left to replant: lost');
  // no plant: the operators dying ends it at once
  const c = await setup('bomb');
  c.o.checkOperators(1);
  assert.equal(c.results.length, 0);
  c.o.checkOperators(0);
  assert.deepEqual(c.results, [[false, 'All operators down']]);
});

test('Elimination / Hostage Rescue (TH): every White Mask down wins; every operator down loses', async () => {
  for (const m of ['elimination', 'hostage'] as const) {
    const a = await setup(m);
    a.o.checkElimination(0);
    assert.deepEqual(a.results, [[true, 'All hostiles eliminated']], m);
    const b = await setup(m);
    b.o.checkOperators(0);
    assert.deepEqual(b.results, [[false, 'All operators down']], m);
  }
});

test('Hostage Protection: White Masks take the hostage after GRAB_TIME and win at an extraction; the defender wins on elimination', async () => {
  const { w, o, results, calls, step } = await setup('protect');
  const h = o.hostage!;
  const tango = soldierAt('tango0', 'terrorist', h.pos);
  w.actors.set('tango0', tango);
  const g = o.botGoal('tango0')!;
  assert.ok(g.pos.distanceTo(h.pos) < 1e-6, 'go for the hostage');
  for (let t = 0; t < GRAB_TIME + 0.2; t += 0.1) g.work!(0.1);
  assert.equal(h.carrier, 'tango0');
  assert.ok(calls.includes('hostageTaken'));
  // the carrier is sent to an extraction, the others escort it
  const carry = o.botGoal('tango0')!;
  assert.ok(SPAWN_ZONES.some((z) => carry.pos.distanceTo(new THREE.Vector3(...z.center)) < 1e-6));
  assert.ok(o.botGoal('tango1')!.pos.distanceTo((tango as { pos: THREE.Vector3 }).pos) < 1e-6);
  // carrier killed → hostage dropped
  (tango as { alive: boolean }).alive = false;
  step(0.2);
  assert.equal(h.carrier, null);
  assert.ok(calls.includes('hostageDropped'));
  // a carrier that makes it out: the attacking side (White Masks) wins
  const t2 = soldierAt('tango2', 'terrorist', h.pos);
  w.actors.set('tango2', t2);
  w.soldiers.set('tango2', t2);
  o.setCarrier('tango2', false);
  (t2 as { pos: THREE.Vector3 }).pos.set(...SPAWN_ZONES[0].center);
  h.pos.set(...SPAWN_ZONES[0].center);
  step(0.3);
  assert.deepEqual(results, [[true, 'Hostage taken']]);
});

test('Hostage Protection: elimination is the defender\'s win; a dead hostage is a loss in every TH mission', async () => {
  const a = await setup('protect');
  a.o.checkElimination(0);
  assert.deepEqual(a.results, [[false, 'All hostiles eliminated']], 'attackers lost = defender won');
  const d = await setup('protect');
  d.o.checkOperators(0);
  assert.deepEqual(d.results, [[true, 'All operators down']], 'every defender down = the White Masks won');
  const r = await setup('hostage');
  r.w.onKill.forEach((k) => k({ killer: 'self', victim: 'hostage', head: false, weapon: '' }));
  assert.deepEqual(r.results, [[false, 'Hostage killed']]);
});

test('Bomb (TH): White Masks from every floor reach a planted defuser on the real map', async () => {
  // deterministic: bots roll dice (aim error, patrol picks) — a seeded generator makes a failure reproducible
  const random = Math.random;
  let seed = 12345;
  Math.random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  try {
    const { Combat } = await import('../../src/game/Combat.ts');
    const { Interactions } = await import('../../src/game/Interactions.ts');
    const { Gadgets } = await import('../../src/game/Gadgets.ts');
    const { Effects } = await import('../../src/render/Effects.ts');
    const { Soldier } = await import('../../src/game/Soldier.ts');
    const { Bot, DIFFICULTY } = await import('../../src/ai/Bot.ts');
    const { NavGraph } = await import('../../src/ai/NavGraph.ts');
    const { buildHouse } = await import('../../src/map/MapBuilder.ts');
    const { buildOutdoor } = await import('../../src/map/Outdoor.ts');
    const { decodeHouseDatamap512Headless } = await import('../../src/map/houseDatamap.ts');
    const ph = await Physics.create();
    const d = new DestructionSystem(ph);
    const scene = new THREE.Scene();
    const house = buildHouse(ph, d, scene);
    buildOutdoor(ph, scene, decodeHouseDatamap512Headless());
    ph.world.step();
    const nav = new NavGraph(ph, d);
    nav.build(house.openings, house.wallPanels);
    const w = new World(ph, d, new Effects(scene), house, scene);
    w.combat = new Combat(w); w.interactions = new Interactions(w); w.gadgets = new Gadgets(w); w.objectives = new Objectives(w);
    w.mode = 'th';
    w.phase = 'action';
    w.objectives.setup('bomb', 'garage', 'th');
    // one bot per room, basement to 2F; none starts in the garage
    const rooms = ['kids', 'master', 'bathroom', 'office', 'living', 'kitchen', 'dining', 'workshop', 'training', 'laundry'];
    const bots = rooms.map((room, i) => {
      const s = new Soldier(w, { id: `t${i}`, name: `t${i}`, side: 'terrorist', operator: 'terrorist', kind: 'bot', pos: nav.spawnSpots([room], 1)[0], yaw: 0 });
      w.soldiers.set(s.id, s);
      w.actors.set(s.id, s);
      const b = new Bot(w, nav, s, DIFFICULTY.Normal, [room], false);
      b.order = () => w.objectives.botGoal(s.id);
      return b;
    });
    w.objectives.plantDefuser(0, 'self', false);
    const at = w.objectives.defuser!.pos.clone();
    const arrived = new Map<string, number>();
    const dt = 1 / 30;
    for (let k = 0; k < 30 * 60 && arrived.size < bots.length; k++) {
      w.time += dt;
      for (const b of bots) b.s.update(dt, b.update(dt));
      w.objectives.update(dt);
      d.update();
      ph.step();
      // keep it running so every bot keeps converging after the first one cuts it
      if (!w.objectives.defuser) w.objectives.plantDefuser(0, 'self', false);
      for (const b of bots) if (!arrived.has(b.s.id) && b.s.pos.distanceTo(at) < 2.5) arrived.set(b.s.id, w.time);
    }
    const late = rooms.filter((_, i) => !arrived.has(`t${i}`));
    assert.deepEqual(late, [], `never reached the defuser within 60 s: ${late.join(', ')}`);
  } finally {
    Math.random = random;
  }
});
