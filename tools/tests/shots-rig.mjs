import { chromium } from 'playwright';
// Screenshots for visual review: 1P Montagne (front / sprint / ADS) and 3P rigs posed with the game's Rig class.
// Needs the QA preview on :4173 (see docs/HANDOFF.md §1). Usage: node tools/tests/shots-rig.mjs <outdir>
const OUT = process.argv[2];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => window.r6game?.ready, null, { timeout: 180000 });
await p.evaluate(() => { window.r6game.autoQuality = false; window.r6game.setQuality('low'); });
await p.evaluate(() => window.r6game.startTH({ ...window.r6game.defaultTH(), mission: 'elimination', operator: 'montagne', tod: 'day' }));
await p.waitForFunction(() => window.r6game.world.phase);
p.setDefaultTimeout(180000);
// freeze the simulation for a capture (rendering goes on): slow headless frames would otherwise outlast the agent's input holds
const freeze = () => p.evaluate(() => { const g = window.r6game; if (!g.__step) { g.__step = g.step; g.step = () => {}; } });
const thaw = () => p.evaluate(() => { const g = window.r6game; if (g.__step) { g.step = g.__step; delete g.__step; } });
const frames = async (n = 25) => { for (let i = 0; i < n; i++) await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };
await p.evaluate(() => {
  const g = window.r6game;
  const z = { moveF: 0, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false, stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0, gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false };
  window.__z = z;
  g.phaseEnds = g.world.time;
  g.player.damage = () => false;
  g.bots.forEach((b) => { b.update = () => z; b.s.damage = () => false; });
});
await frames(10);
// first person: Montagne in the lobby looking north toward the front door
await p.evaluate(() => { const g = window.r6game; const P = g.player; P.teleport(g.nav.randomNodeIn(['lobby']).pos.clone(), 0); P.pitch = 0; });
await frames(40);
await p.screenshot({ path: `${OUT}/1p_montagne_front.png` });
// sprint: step the game synchronously until the pose is on (wall-clock holds outlast slow frames this way)
await p.evaluate(() => { window.webmcp.act({ move: { forward: 1, strafe: 0, sprint: true }, durationMs: 5000 }); for (let i = 0; i < 30 && window.r6game.player.shieldPose !== 'run'; i++) window.r6game.step(1 / 60); });
await freeze();
await frames(4);
console.log('sprint:', await p.evaluate(() => `${window.r6game.player.shieldPose} vm ${window.r6game.vm.shield.position.toArray().map((v) => v.toFixed(2))}`));
await p.screenshot({ path: `${OUT}/1p_montagne_sprint.png` });
await thaw();
await p.evaluate(() => window.webmcp.act({ move: { forward: 0, strafe: 0, sprint: false }, durationMs: 5000 }));
await frames(10);
await p.evaluate(() => { window.webmcp.act({ ads: true, durationMs: 5000 }); for (let i = 0; i < 40; i++) window.r6game.step(1 / 60); });
await freeze();
await frames(4);
console.log('ads:', await p.evaluate(() => `${window.r6game.player.shieldPose} vm ${window.r6game.vm.shield.position.toArray().map((v) => v.toFixed(2))}`));
await p.screenshot({ path: `${OUT}/1p_montagne_ads.png` });
await thaw();
// third person: a clear spot on the attackers' first spawn zone
await p.evaluate(() => {
  const g = window.r6game;
  const zc = window.webmcp.getMapKnowledge().spawns[0].center;
  window.__base = new (g.player.pos.constructor)(zc[0], zc[1] + 0.05, zc[2]);
  g.player.teleport(window.__base.clone().add({ x: 0, y: 0, z: 12 }), 0);
});
// operators posed by hand: rigs built with the game's own Rig class (same as bots / peers)
await p.evaluate(() => {
  const g = window.r6game;
  const R = [...g.rigs.values()][0].constructor;
  const base = window.__base.clone().add({ x: 0, y: 0, z: 3 });
  const list = [
    ['ash', 'r4c', 0, 0, {}, null], ['ash', 'r4c', 0, 0, { ads: 1 }, null], ['smoke', 'fmg9', 1, -0.2, {}, null], ['ash', 'r4c', 0, 0, { sprint: true }, null],
    ['montagne', 'p9', 0, 0, {}, 'front'], ['montagne', 'p9', 0, 0, { sprint: true }, 'run'], ['blitz', 'p12', 0, 0, { ads: 1 }, 'ads'], ['blitz', 'p12', 1, 0, {}, 'front'],
  ];
  window.__rigs = list.map(([op, w, st, pitch, act, shield], i) => {
    const r = new R(op, w);
    r.root.position.copy(base).add({ x: (i % 4 - 1.5) * 1.5, y: 0, z: Math.floor(i / 4) * 2.2 });
    r.root.rotation.y = 0.35; // turned toward the camera (it looks north from the south)
    if (shield) r.setShieldPose(shield);
    g.scene.add(r.root);
    return { r, st, pitch, act };
  });
  const loop = () => { for (const x of window.__rigs) x.r.pose(1 / 60, x.st, x.pitch, 0, x.act.sprint ? 5 : 0, false, x.act); requestAnimationFrame(loop); };
  loop();
  g.freeCam = { p: [base.x + 0.4, base.y + 1.7, base.z - 3.6], yaw: Math.PI - 0.08, pitch: -0.2, fov: 62 };
});
await frames(10);
for (const [row, name] of [[0, 'rifles'], [1, 'shields']]) {
  await p.evaluate((row) => {
    const g = window.r6game;
    const c = window.__rigs[row * 4].r.root.position.clone().add(window.__rigs[row * 4 + 3].r.root.position).multiplyScalar(0.5);
    g.freeCam = { p: [c.x - 1.4, c.y + 1.45, c.z - 5.4], yaw: Math.PI + 0.25, pitch: -0.06, fov: 34 };
    for (const [i, x] of window.__rigs.entries()) x.r.root.visible = Math.floor(i / 4) === row;
  }, row);
  await frames(15);
  await p.screenshot({ path: `${OUT}/3p_${name}.png` });
}
await browser.close();
