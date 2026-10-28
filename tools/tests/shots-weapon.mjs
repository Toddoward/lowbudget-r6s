import { chromium } from 'playwright';
// Screenshots of a weapon model for visual review: per operator 1P hip + ADS, then the operators' 3P rigs side by side.
// Needs the QA preview on :4173 (see docs/HANDOFF.md §1). Usage: node tools/tests/shots-weapon.mjs <outdir> <op>:<weapon> [<op>:<weapon> …]
const [OUT, ...ARGS] = process.argv.slice(2);
const PAIRS = ARGS.map((a) => a.split(':'));
const OPS = PAIRS.map(([op]) => op);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
p.setDefaultTimeout(180000);
const frames = async (n = 25) => { for (let i = 0; i < n; i++) await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };
const freeze = () => p.evaluate(() => { const g = window.r6game; if (!g.__step) { g.__step = g.step; g.step = () => {}; } });
const thaw = () => p.evaluate(() => { const g = window.r6game; if (g.__step) { g.step = g.__step; delete g.__step; } });
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => window.r6game?.ready, null, { timeout: 180000 });
await p.evaluate(() => { window.r6game.autoQuality = false; window.r6game.setQuality('low'); });
for (const op of OPS) {
  await p.evaluate((op) => window.r6game.startTH({ ...window.r6game.defaultTH(), mission: 'elimination', operator: op, tod: 'day' }), op);
  await p.waitForFunction(() => window.r6game.world.phase);
  await p.evaluate(() => {
    const g = window.r6game;
    const z = { moveF: 0, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false, stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0, gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false };
    g.phaseEnds = g.world.time;
    g.player.damage = () => false;
    g.bots.forEach((b) => { b.update = () => z; b.s.damage = () => false; });
    const P = g.player; P.teleport(g.nav.randomNodeIn(['lobby']).pos.clone(), 0); P.pitch = 0;
  });
  await frames(40);
  console.log(op, 'weapon', await p.evaluate(() => window.r6game.player.weapon.def.id));
  await p.screenshot({ path: `${OUT}/1p_${op}_hip.png` });
  await p.evaluate(() => { window.webmcp.act({ ads: true, durationMs: 5000 }); for (let i = 0; i < 40; i++) window.r6game.step(1 / 60); });
  await freeze();
  await frames(4);
  await p.screenshot({ path: `${OUT}/1p_${op}_ads.png` });
  await thaw();
  await p.evaluate(() => window.webmcp.act({ ads: false, durationMs: 500 }));
  await frames(10);
}
// third person: the operators' rigs with their primaries, close up on the spawn pad
await p.evaluate((pairs) => {
  const g = window.r6game;
  const zc = window.webmcp.getMapKnowledge().spawns[0].center;
  const base = new (g.player.pos.constructor)(zc[0], zc[1] + 0.05, zc[2]);
  g.player.teleport(base.clone().add({ x: 0, y: 0, z: 12 }), 0);
  const R = [...g.rigs.values()][0].constructor;
  window.__rigs = pairs.map(([op, w], i) => {
    const r = new R(op, w);
    r.root.position.copy(base).add({ x: (i - (pairs.length - 1) / 2) * 0.9, y: 0, z: 3 });
    r.root.rotation.y = Math.PI / 2 + 0.25; // gun side toward the camera
    g.scene.add(r.root);
    return r;
  });
  const loop = () => { for (const r of window.__rigs) r.pose(1 / 60, 0, 0, 0, 0, false, {}); requestAnimationFrame(loop); };
  loop();
  const c = base.clone().add({ x: 0, y: 0, z: 3 });
  g.freeCam = { p: [c.x + 0.2, c.y + 1.45, c.z - 1.9], yaw: Math.PI, pitch: -0.08, fov: 40 };
}, PAIRS);
await frames(15);
await p.screenshot({ path: `${OUT}/3p_${OPS.join('_')}.png` });
await browser.close();
