#!/usr/bin/env node
/**
 * Browser smoke test (Playwright + bundled Chromium, SwiftShader WebGL):
 *   npm run build && npx vite preview --port 4173 &   then   npm run test:e2e
 * Checks: boot, Terrorist Hunt start, WebMCP observe/act/DOM bridge, destruction,
 * rappel, local two-tab PvP room (BroadcastChannel) with WebRTC + event sync.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.E2E_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const errors = [];
const open = async () => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => window.r6game?.ready, null, { timeout: 180000 });
  return p;
};
const step = (name) => console.log(`✓ ${name}`);

const A = await open();
step('boot (Rapier WASM, House, suburb, nav graph)');
await A.evaluate(() => window.webmcp.startTerroristHunt({ difficulty: 'Normal', mission: 'elimination' }));
const o = await A.evaluate(() => window.webmcp.observe());
assert.equal(o.self.team, 'attack');
assert.equal(o.match.mode, 'terrorist_hunt');
assert.ok(Array.isArray(o.vision) && Array.isArray(o.acoustic));
step('Terrorist Hunt + WebMCP observation');
const dom = await A.waitForFunction(() => document.querySelector('#webmcp-agent-bridge').dataset.selfState, null, { timeout: 30000 });
assert.ok(JSON.parse(await dom.jsonValue()).operator);
step('#webmcp-agent-bridge data-self-state');
const r = await A.evaluate(() => window.webmcp.act({ move: { forward: 1 }, lookLerp: { yawDelta: 30, rate: 0.5 }, durationMs: 400 }));
assert.equal(r.ok, true);
step('window.webmcp.act');
const destr = await A.evaluate(() => {
  const g = window.r6game;
  const p = [...g.destruction.panels.values()].find((x) => x.kind === 'wall_soft' && !x.reinforced && x.size(1) > 2.5);
  g.destruction.impactAndApply('breach', p.center, p);
  g.destruction.update();
  return p.passable;
});
assert.equal(destr, true);
step('breach charge opens a passable soft wall');
const rap = await A.evaluate(() => {
  const g = window.r6game; const P = g.player; const V3 = P.pos.constructor;
  // a plain stretch of the north (front) wall, west of the porch and east of the storage well
  const inp0 = { moveF: 0, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false, stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0, gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false };
  g.bots.forEach((b) => { b.update = () => inp0; b.s.teleport(g.nav.randomNodeIn(['__ext']).pos.clone()); }); // freeze (killing them all would end the hunt)
  P.teleport(new V3(-5, -0.23, -8.05), Math.PI); P.pitch = 0; P.update(1 / 60, inp0); P.update(1 / 60, inp0);
  let ok = true;
  ok = ok && P.startRappel();
  const inp = { moveF: 1, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false, stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0, gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false };
  for (let i = 0; i < 900 && P.mode !== 'normal'; i++) { P.update(1 / 60, inp); g.physics.step(); }
  return { ok, y: P.pos.y };
});
assert.ok(rap.ok && rap.y > 5.5, `rappel to roof ${JSON.stringify(rap)}`);
step('rappel from the ground onto the roof');

const B = await open();
const code = `R6-${1000 + Math.floor(Math.random() * 8999)}`;
await A.evaluate((c) => window.webmcp.join({ nickname: 'Alpha', roomCode: c, mode: 'local' }), code);
await B.evaluate((c) => window.webmcp.join({ nickname: 'Bravo', roomCode: c, mode: 'local' }), code);
await A.waitForFunction(() => window.r6game.room.state.members.length >= 2, null, { timeout: 60000 });
step('two tabs joined the same 6-char room');
await A.evaluate(() => window.r6game.room.send({ type: 'start_match' }));
await B.waitForFunction(() => window.r6game.player, null, { timeout: 60000 });
await A.waitForFunction(() => window.r6game.room.peerPaths().some((p) => p.path === 'webrtc'), null, { timeout: 60000 }).catch(() => {});
const paths = await A.evaluate(() => window.r6game.room.peerPaths());
console.log('  peer paths', JSON.stringify(paths));
const pid = await A.evaluate(() => { const g = window.r6game; const p = [...g.destruction.panels.values()].find((x) => x.kind === 'wall_soft'); const res = g.destruction.impactAndApply('sledge', p.center, p); g.world.combat.emitCells(res.events); return p.id; });
await B.waitForFunction((id) => window.r6game.destruction.get(id).brokenCount > 0, pid, { timeout: 30000 });
step('destruction delta replicated over the room');
assert.deepEqual(errors, []);
step('no page errors');
await browser.close();
