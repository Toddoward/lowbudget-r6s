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
await p.evaluate(() => window.webmcp.act({ move: { forward: 1, strafe: 0, sprint: true }, durationMs: 120000 }));
await frames(20);
await p.screenshot({ path: `${OUT}/1p_montagne_sprint.png` });
await p.evaluate(() => window.webmcp.act({ move: { forward: 0, strafe: 0, sprint: false }, durationMs: 120000 }));
await frames(10);
await p.evaluate(() => window.webmcp.act({ ads: true, durationMs: 120000 }));
await frames(30);
await p.screenshot({ path: `${OUT}/1p_montagne_ads.png` });
// third person: line up White Masks and park them in poses in front of a free camera
await p.evaluate(() => {
  const g = window.r6game;
  const P = g.player; P.teleport(g.nav.randomNodeIn(['__ext']).pos.clone(), 0);
  const zones = window.webmcp.getMapKnowledge().spawnZones ?? window.webmcp.getMapKnowledge().spawns;
  const zc = zones[0].center ?? zones[0].pos;
  const base = new (g.player.pos.constructor)(zc[0] ?? zc.x, (zc[1] ?? zc.y) + 0.05, zc[2] ?? zc.z);
  window.__base = base;
  const bots = g.bots.slice(0, 5);
  const poses = [{}, { ads: true }, { stance: 1 }, { stance: 2 }, { moveF: 1, sprint: true }];
  bots.forEach((b, i) => {
    const inp = { ...window.__z, ...poses[i] };
    b.update = () => ({ ...inp });
    b.s.teleport(base.clone().add({ x: (i - 2) * 1.6, y: 0, z: 0 }), Math.PI * 0.85);
    b.s.pitch = 0;
  });
  g.freeCam = { p: [base.x + 0.5, base.y + 1.7, base.z - 4.2], yaw: Math.PI - 0.1, pitch: -0.15, fov: 60 };
});
await frames(40);
// sprinting bot drifts — put it back each frame for the shot
await p.evaluate(() => { const g = window.r6game; const b = g.bots[4]; b.s.teleport(window.__base.clone().add({ x: 3.2, y: 0, z: 0 }), Math.PI * 0.85); });
await frames(3);
await p.screenshot({ path: `${OUT}/3p_terrorists.png` });
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
    r.root.rotation.y = Math.PI * 0.82;
    if (shield) r.setShieldPose(shield);
    g.scene.add(r.root);
    return { r, st, pitch, act };
  });
  const loop = () => { for (const x of window.__rigs) x.r.pose(1 / 60, x.st, x.pitch, 0, x.act.sprint ? 5 : 0, false, x.act); requestAnimationFrame(loop); };
  loop();
  g.freeCam = { p: [base.x + 0.4, base.y + 1.7, base.z - 3.6], yaw: Math.PI - 0.08, pitch: -0.2, fov: 62 };
});
await frames(30);
await p.screenshot({ path: `${OUT}/3p_operators.png` });
for (const [row, name] of [[0, 'rifles'], [1, 'shields']]) {
  await p.evaluate((row) => {
    const g = window.r6game;
    const c = window.__rigs[row * 4].r.root.position.clone().add(window.__rigs[row * 4 + 3].r.root.position).multiplyScalar(0.5);
    g.freeCam = { p: [c.x - 1.2, c.y + 1.5, c.z - 5.2], yaw: Math.PI - 0.2, pitch: -0.08, fov: 36 };
    for (const [i, x] of window.__rigs.entries()) x.r.root.visible = Math.floor(i / 4) === row;
  }, row);
  await frames(15);
  await p.screenshot({ path: `${OUT}/3p_${name}.png` });
}
await browser.close();
