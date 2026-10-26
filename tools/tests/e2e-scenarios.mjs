#!/usr/bin/env node
/**
 * UX scenario suite (spec #27): every flow a player goes through, driven the way a
 * player (DOM clicks / keys) or an agent (window.webmcp.act with the human G/X keys)
 * would, asserting on game state rather than pixels.
 *
 *   VITE_QA=1 npm run build && npx vite preview --port 4173 &   then   npm run test:scenarios
 *
 *   S1  menu → play: home, TH setup (operator by role), deploy, prep drone → action,
 *       death → cursor free (no pause), result screen + stats, redeploy, back to menu,
 *       language switch, key rebinding reflected in the HUD
 *   S2  attack roles: breacher (Sledge, Ash, breach charge), hard breacher (Thermite:
 *       hold to place, tap to detonate even while looking at the wall, no re-reinforce),
 *       support (Thatcher, Fuze), shield (Montagne, Blitz), intel (IQ, drone ping), vault
 *   S3  defense roles: reinforce, barricade, Castle, Kapkan, Tachanka, Mute, Bandit,
 *       Pulse, Jäger, Smoke, CCTV
 *   S4  PvP state: two tabs, lobby → round → drone prep for attackers → action
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.E2E_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const errors = [];
let failures = 0;
const open = async (q = '') => {
  const p = await ctx.newPage();
  p.setDefaultTimeout(120000);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL + q);
  await p.waitForFunction(() => window.r6game?.ready, null, { timeout: 180000 });
  await p.evaluate(() => { window.r6game.autoQuality = false; window.r6game.setQuality('low'); });
  return p;
};
let current = null;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) {
    failures++;
    const diag = current ? await current.evaluate(() => { const g = window.r6game; const P = g.player; return { mode: g.mode, phase: g.world.phase, result: g.thResult?.reason, paused: g.paused, view: g.view, op: P?.op.id, alive: P?.alive, slot: P?.slot, gl: P?.gadgetLeft, ul: P?.universalLeft, label: P?.interactLabel, hint: P?.gadgetHint, prog: P?.interactProgress }; }).catch(() => null) : null;
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n')[0]}\n      state ${JSON.stringify(diag)}`);
  }
};
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }, sel);

/* ------------------------------------------------------------------ in-page helpers */
const HELPERS = () => {
  const g = window.r6game;
  const V = () => g.player.pos.constructor;
  window.qa = {
    /** freeze & park every White Mask far away so the scenario isn't interrupted */
    parkBots() {
      const z = { moveF: 0, moveR: 0, sprint: false, fire: false, firePressed: false, ads: false, reload: false, melee: false, stance: null, lean: 0, interact: false, interactPressed: false, slot: null, alt: false, invert: false, jump: false, lookDYaw: 0, lookDPitch: 0, gadget: false, gadgetHeld: false, gadget2: false, gadget2Held: false, ping: false };
      g.bots.forEach((b) => { b.update = () => z; if (b.s.alive) b.s.teleport(g.nav.randomNodeIn(['__ext']).pos.clone()); });
    },
    action() { g.phaseEnds = g.world.time; },
    /** stand ~d m in front of a panel, looking at its centre */
    face(panel, d = 1.0, side = panel.qaSide ?? 1) {
      const c = panel.center.clone();
      const n = new (V())(panel.nAx === 0 ? 1 : 0, 0, panel.nAx === 2 ? 1 : 0).multiplyScalar(side);
      const p = c.clone().addScaledVector(n, d); p.y = panel.min.y + 0.05;
      const P = g.player;
      P.teleport(p, Math.atan2(n.x, n.z));
      P.pitch = Math.atan2(c.y - (p.y + 1.65), d) * 0.9;
      g.physics.step();
      return P;
    },
    /** a full-height, untouched soft panel (any floor) with ~1 m of clear floor on at least one face; remembers that face */
    softWall() {
      const used = (window.qa.usedPanels ??= new Set());
      for (const p of g.destruction.panels.values()) {
        if (p.kind !== 'wall_soft' || p.reinforced || p.brokenCount > 0 || used.has(p.id) || p.size(1) < 2.6 || Math.max(p.size(0), p.size(2)) < 0.95) continue;
        for (const side of [1, -1]) {
          const n = new (V())(p.nAx === 0 ? side : 0, 0, p.nAx === 2 ? side : 0);
          const from = p.center.clone().addScaledVector(n, 1.0); from.y = p.min.y + 1.0;
          const down = g.physics.raycast(from, new (V())(0, -1, 0), 1.3, 1);
          if (!down || Math.abs(down.point.y - p.min.y) > 0.15) continue;
          if (!g.physics.clearLine(from, p.center.clone().addScaledVector(n, 0.2).setY(from.y))) continue;
          used.add(p.id);
          p.qaSide = side;
          return p;
        }
      }
      return undefined;
    },
    /** stand in front of an unbarricaded interior door that really reads as "in front" */
    pickDoor() {
      const used = (window.qa.usedDoors ??= new Set());
      for (const d of g.house.openings) {
        if (d.kind !== 'door' || !d.barricadeable || d.exterior || d.barricadeKind !== 'none' || used.has(d.id)) continue;
        for (const side of [1, -1]) {
          window.qa.faceOpening(d, 1.0, side);
          if (g.world.interactions.openingInFront(g.player)?.id === d.id && Math.abs(g.player.pos.y - (d.center.y - 1.15)) < 0.2) { used.add(d.id); return d.id; }
        }
      }
      return null;
    },
    /** stand in an open room facing a direction with ≥ dist m of clear line and intact floor; returns the point dist ahead */
    openFacing(dist = 4, room = 'living') {
      const P = g.player;
      // earlier steps blow holes in floors (breach, Thermite, cluster charges); the map is not reset between steps
      const floorAlong = (fwd) => {
        for (let d = 0.5; d <= dist + 1e-6; d += 0.25) {
          const hit = g.physics.raycast(P.pos.clone().addScaledVector(fwd, d).setY(P.pos.y + 0.5), new (V())(0, -1, 0), 1.0, 1);
          if (!hit || hit.normal.y < 0.7) return false;
        }
        return true;
      };
      for (const r of [room, 'lobby', 'dining', 'garage', 'master']) {
        for (let tries = 0; tries < 6; tries++) {
          P.teleport(window.qa.roomSpot(r), 0); P.pitch = 0;
          for (let k = 0; k < 16; k++) {
            P.yaw = (k / 16) * Math.PI * 2;
            const fwd = P.aimDir().setY(0).normalize();
            const at = P.pos.clone().addScaledVector(fwd, dist);
            if (g.physics.clearLine(P.eye(), at.clone().setY(P.eye().y)) && g.physics.clearLine(P.pos.clone().setY(P.pos.y + 0.5), at.clone().setY(P.pos.y + 0.5)) && floorAlong(fwd)) { g.physics.step(); return at; }
          }
        }
      }
      throw new Error('no open spot');
    },
    /** an open spot in a room (nav node) */
    roomSpot(room = 'living') { return g.nav.randomNodeIn([room]).pos.clone(); },
    faceOpening(op, d = 1.1, side = 1) {
      const n = op.normal.clone().multiplyScalar(side);
      const p = op.center.clone().addScaledVector(n, d); p.y = op.center.y - 1.1;
      g.player.teleport(p, Math.atan2(n.x, n.z));
      g.player.pitch = -0.1;
      g.physics.step();
    },
    act: (a) => window.webmcp.act(a),
    /** swap operator; the scenarios test gadget logic, so the player can't be killed by their own charges */
    swap(op) { const P = g.qaSwapOperator(op); P.damage = () => false; return P; },
    count: (type) => [...g.world.gadgets.list.values()].filter((x) => x.type === type).length,
  };
};
const until = (page, fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
/** step the simulation synchronously (SwiftShader renders at a few fps; agent holds are wall-clock) until fn(arg) */
const sim = async (page, fn, arg, maxSec = 12) => {
  const ok = await page.evaluate(({ src, arg, maxSec }) => {
    const f = new Function('arg', `return (${src})(arg)`);
    const g = window.r6game;
    for (let t = 0; t < maxSec; t += 1 / 60) { g.step(1 / 60); if (f(arg)) return true; }
    return false;
  }, { src: fn.toString(), arg, maxSec });
  if (!ok) throw new Error(`condition not met within ${maxSec}s sim: ${fn.toString().slice(0, 90)}`);
};

/* ================================================================== S1 · menu → play */
console.log('S1 · menu → play · state handling');
const A = await open('?lang=ko');
current = A;
await A.evaluate(HELPERS);
await step('home shows 5 entries, depth-1 menu', async () => {
  assert.ok(await visible(A, '#menu'));
  assert.equal(await A.locator('.home-nav .nav-item').count(), 5);
});
await step('Terrorist Hunt setup groups operators by role; picking one updates the info card', async () => {
  await A.click('#nav-th');
  assert.ok(await visible(A, '#th-setup'));
  const groups = await A.locator('#th-ops .op-group').count();
  assert.ok(groups >= 5, `role groups ${groups}`);
  await A.click('#th-ops .op[data-op="thermite"]');
  assert.match(await A.textContent('#th-op-info'), /Thermite/);
});
await step('deploy → HUD, prep phase in the drone view (attacker)', async () => {
  // headless Chromium grants and then drops pointer lock at random (= an Esc → pause); the
  // cursor state machine itself is checked through wantsPointer() and the pause/result screens
  await A.evaluate(() => { window.r6game.input.lock = () => {}; });
  await A.click('#th-start');
  await until(A, () => window.r6game.mode === 'th' && window.r6game.world.phase === 'prep');
  assert.ok(await visible(A, '#hud'));
  assert.ok(!(await visible(A, '#th-setup')));
  assert.equal(await A.evaluate(() => window.r6game.view), 'drone');
  assert.equal(await A.evaluate(() => window.r6game.wantsPointer()), true);
});
await step('Enter skips prep → action phase, back in the body view', async () => {
  await A.keyboard.press('Enter');
  await until(A, () => window.r6game.world.phase === 'action');
  assert.equal(await A.evaluate(() => window.r6game.view), 'body');
});
await step('HUD is localized (Korean phase label, objective, gadget slots with key caps)', async () => {
  await A.waitForTimeout(400);
  assert.match(await A.textContent('#phase'), /작전/);
  assert.ok((await A.textContent('#objective')).length > 3);
  assert.match(await A.textContent('#gadgets'), /G.*써마이트/);
});
await step('death frees the cursor without a pause screen; result screen shows stats', async () => {
  // headless Chromium may drop pointer lock on its own (= Esc → pause); resume first
  if (await visible(A, '#pause')) await A.click('#pause-resume');
  await A.evaluate(() => window.r6game.player.die('tango0', false));
  await until(A, () => !window.r6game.wantsPointer());
  assert.ok(!(await visible(A, '#pause')));
  await until(A, () => !document.querySelector('#th-result').classList.contains('hidden'), null, 15000);
  assert.match(await A.textContent('#res-title'), /실패/);
  assert.equal((await A.textContent('#res-acc')).trim().endsWith('%'), true);
});
await step('redeploy starts a fresh match; main menu returns home', async () => {
  await A.click('#th-restart');
  await until(A, () => window.r6game.world.phase === 'prep' && window.r6game.player?.alive);
  assert.ok(!(await visible(A, '#th-result')));
  await A.evaluate(() => window.r6game.quitToMenu());
  assert.ok(await visible(A, '#menu'));
});
await step('language switch relabels the UI (KO → EN)', async () => {
  await A.click('.lang-switch button[data-lang="en"]');
  assert.match(await A.textContent('#nav-quick'), /Quick Play/);
  await A.click('.lang-switch button[data-lang="ko"]');
  assert.match(await A.textContent('#nav-quick'), /빠른 시작/);
});
await step('rebinding a key (gadget → H) updates bindings and prompts; reset restores G', async () => {
  await A.click('#nav-controls');
  await A.click('#binds button.kb[data-action="gadget"][data-slot="0"]');
  await A.keyboard.press('KeyH');
  assert.equal(await A.evaluate(() => window.r6game.input.binds.binds.gadget[0]), 'KeyH');
  assert.equal(await A.evaluate(() => window.r6game.input.binds.cap('gadget')), 'H');
  // conflict: binding H to reload steals it from gadget
  await A.click('#binds button.kb[data-action="reload"][data-slot="0"]');
  await A.keyboard.press('KeyH');
  assert.equal(await A.evaluate(() => window.r6game.input.binds.binds.gadget[0]), null);
  await A.click('#binds-reset');
  assert.equal(await A.evaluate(() => window.r6game.input.binds.binds.gadget[0]), 'KeyG');
  await A.click('#settings [data-close]');
});
await step('Ctrl is never bound (browser shortcuts can’t fire mid-game)', async () => {
  const bad = await A.evaluate(() => Object.values(window.r6game.input.binds.binds).flat().filter((c) => c && /Control|Meta|Alt/.test(c)));
  assert.deepEqual(bad, []);
});

/* ================================================================== S2 · attack roles */
console.log('S2 · attack roles');
await A.evaluate(() => window.r6game.startTH({ ...window.r6game.defaultTH(), mission: 'bomb', operator: 'sledge', tod: 'day' }));
await A.evaluate(() => { window.qa.parkBots(); window.qa.action(); window.r6game.player.damage = () => false; });
await sim(A, () => window.r6game.world.phase === 'action');

await step('breacher · Sledge: [G] equips the hammer, swings break a soft wall', async () => {
  const id = await A.evaluate(() => { const p = window.qa.softWall(); window.qa.face(p, 0.9); return p.id; });
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => window.r6game.player.slot === 2);
  await A.evaluate(() => window.qa.act({ fire: true, durationMs: 8000 }));
  await sim(A, (id) => window.r6game.destruction.get(id).brokenCount > 6, id);
});
await step('breacher · universal breach charge: hold [X] to place, tap [X] to detonate → passable', async () => {
  const id = await A.evaluate(() => { const g = window.r6game; g.player.switchSlot(0); const p = window.qa.softWall(); window.qa.face(p, 0.8); return p.id; });
  await A.evaluate(() => window.qa.act({ gadget: 'key_universal_hold', durationMs: 6000 }));
  await sim(A, () => window.qa.count('breach') > 0);
  await sim(A, () => window.r6game.player.universalLeft < 2 && !window.r6game.player.interactProgress);
  await A.waitForTimeout(1500);
  await A.evaluate(() => window.qa.act({ gadget: 'key_universal' }));
  await sim(A, (id) => window.r6game.destruction.get(id).passable, id);
});
await step('hard breacher · Thermite: reinforced wall, hold [G] place, tap [G] detonate while still facing it', async () => {
  await A.evaluate(() => window.qa.swap('thermite'));
  const id = await A.evaluate(() => { const g = window.r6game; const p = window.qa.softWall(); g.world.interactions.reinforce(null, p, false); window.qa.face(p, 0.8); return p.id; });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 7000 }));
  await sim(A, () => window.qa.count('thermite') > 0);
  await sim(A, () => window.r6game.player.gadgetLeft < 2);
  await A.waitForTimeout(5200); // let the agent's (wall-clock) key-hold expire
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, (id) => { const p = window.r6game.destruction.get(id); return p.thermited && p.passable; }, id);
  // a thermited wall can't be re-reinforced
  const offered = await A.evaluate((id) => { const g = window.r6game; const p = g.destruction.get(id); const def = window.qa.swap('castle'); window.qa.face(p, 0.8); g.world.interactions.sweep(); return def.interactLabel; }, id);
  assert.ok(!/reinforce/.test(offered), `offered "${offered}"`);
});
await step('support · Thatcher: [G] throws an EMP', async () => {
  await A.evaluate(() => window.qa.swap('thatcher'));
  const n0 = await A.evaluate(() => window.qa.count('emp'));
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, (n0) => window.qa.count('emp') > n0 || window.r6game.player.gadgetLeft < 3, n0);
});
await step('support · Fuze: hold [G] on a soft wall plants a cluster charge', async () => {
  await A.evaluate(() => { window.qa.swap('fuze'); window.qa.face(window.qa.softWall(), 0.8); });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 6000 }));
  await sim(A, () => window.qa.count('cluster') > 0 || window.r6game.player.gadgetLeft < 3);
});
await step('shield · Montagne: [G] extends Le Roc; the shield collider stops a ray from the front', async () => {
  await A.evaluate(() => { window.qa.swap('montagne'); window.qa.openFacing(2); });
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => window.r6game.player.shieldExtended);
  const blocked = await A.evaluate(() => {
    const g = window.r6game; const P = g.player; g.physics.step();
    const fwd = P.aimDir().setY(0).normalize();
    const from = P.pos.clone().addScaledVector(fwd, 1.4).setY(P.pos.y + 1.2);
    const hit = g.physics.raycast(from, fwd.clone().negate(), 4);
    return hit ? (hit.tag?.gadgetId ?? JSON.stringify(hit.tag)) : 'none';
  });
  assert.match(blocked, /^shield:/);
});
await step('shield · Blitz: [G] flash blinds a White Mask in front', async () => {
  await A.evaluate(() => {
    const g = window.r6game; window.qa.swap('blitz'); const P = g.player;
    const at = window.qa.openFacing(3.5);
    const b = g.bots.find((x) => x.s.alive); window.qa.target = b.s.id; b.s.teleport(at, P.yaw + Math.PI); b.s.pitch = 0; g.physics.step();
  });
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => { const g = window.r6game; return g.world.actors.get(window.qa.target).blindUntil > g.world.time; });
  await A.evaluate(() => window.qa.parkBots());
});
await step('intel · IQ: [G] + aim lists electronics (bombs) through walls', async () => {
  await A.evaluate(() => {
    const g = window.r6game; window.qa.swap('iq');
    const b = g.world.objectives.bombs[0]; const P = g.player;
    P.teleport(b.pos.clone().add(new (P.pos.constructor)(4, 0, 0)), Math.PI / 2);
  });
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => window.r6game.player.slot === 2);
  await A.evaluate(() => window.qa.act({ ads: true, durationMs: 1500 }));
  await sim(A, () => (window.r6game.world.gadgets.iqContacts.get('self') ?? []).length > 0);
  await A.evaluate(() => window.qa.act({ ads: false }));
});
await step('intel · ping: spotting an enemy marks it for the team (HUD marker)', async () => {
  await A.evaluate(() => {
    const g = window.r6game; window.qa.swap('ash');
    const at = window.qa.openFacing(5);
    const b = g.bots.find((x) => x.s.alive); window.qa.target = b.s.id; b.s.teleport(at, 0); g.physics.step();
  });
  await A.evaluate(() => window.qa.act({ ping: true }));
  await sim(A, () => window.r6game.world.spots.has(window.qa.target));
  await until(A, () => document.querySelectorAll('#markers .mk.spot').length > 0 && [...document.querySelectorAll('#markers .mk.spot')].some((m) => m.style.display !== 'none'));
  await A.evaluate(() => window.qa.parkBots());
});
await step('vault: an unbarricaded window offers vault (Space)', async () => {
  const ok = await A.evaluate(() => {
    const g = window.r6game;
    const w = g.house.openings.find((o) => o.kind === 'window' && o.exterior && o.barricadeKind === 'none' && o.run !== 'd' && Math.abs(o.center.y - 1.65) < 0.6);
    if (!w) return 'no window';
    window.qa.faceOpening(w, 0.75);
    return g.player.probeVault() ? 'ok' : 'no plan';
  });
  assert.equal(ok, 'ok');
});

/* ================================================================== S3 · defense roles */
console.log('S3 · defense roles');
await step('anchor · reinforce: hold [F] on a soft wall reinforces it', async () => {
  const id = await A.evaluate(() => { const g = window.r6game; window.qa.swap('castle'); const p = window.qa.softWall(); window.qa.face(p, 0.8); return p.id; });
  await A.evaluate(() => window.qa.act({ interact: 'hold', durationMs: 12000 }));
  await sim(A, (id) => window.r6game.destruction.get(id).reinforced, id);
});
await step('barricade: hold [F] at a door', async () => {
  const id = await A.evaluate(() => window.qa.pickDoor());
  await A.evaluate(() => window.qa.act({ interact: 'hold', durationMs: 8000 }));
  await sim(A, (id) => window.r6game.house.openings.find((o) => o.id === id).barricadeKind === 'wood', id);
});
await step('anchor · Castle: hold [G] at a door deploys an armor panel', async () => {
  const id = await A.evaluate(() => window.qa.pickDoor());
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 9000 }));
  await sim(A, (id) => window.r6game.house.openings.find((o) => o.id === id).barricadeKind === 'castle', id);
});
await step('trapper · Kapkan: hold [G] at a door frame sets an EDD', async () => {
  await A.evaluate(() => { const g = window.r6game; window.qa.swap('kapkan'); window.qa.pickDoor(); });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 7000 }));
  await sim(A, () => window.qa.count('edd') > 0);
});
await step('anchor · Tachanka: hold [G] sets the LMG, [F] mounts it (RP-46)', async () => {
  await A.evaluate(() => { const g = window.r6game; window.qa.swap('tachanka'); window.qa.openFacing(2.5); g.player.pitch = -0.3; g.physics.step(); });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 8000 }));
  await sim(A, () => window.qa.count('turret') > 0);
  await A.waitForTimeout(400);
  await A.evaluate(() => window.qa.act({ interact: 'press' }));
  await sim(A, () => !!window.r6game.player.mounted && window.r6game.player.weapon?.def.id === 'rp46');
});
await step('anti-gadget · Mute: hold [G] places a jammer', async () => {
  await A.evaluate(() => { const g = window.r6game; window.qa.swap('mute'); window.qa.openFacing(2.5); g.player.pitch = -0.3; g.physics.step(); });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 6000 }));
  await sim(A, () => window.qa.count('jammer') > 0);
});
await step('anti-gadget · Bandit: battery on a reinforced wall electrifies it', async () => {
  const id = await A.evaluate(() => { const g = window.r6game; window.qa.swap('bandit'); const p = window.qa.softWall(); g.world.interactions.reinforce(null, p, false); window.qa.face(p, 0.75); return p.id; });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 6000 }));
  await sim(A, (id) => window.r6game.destruction.get(id).electrified > 0, id);
});
await step('intel · Pulse: [G] + aim runs the heartbeat scan', async () => {
  await A.evaluate(() => window.qa.swap('pulse'));
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => window.r6game.player.slot === 2);
  await A.evaluate(() => window.qa.act({ ads: true, durationMs: 1200 }));
  await sim(A, () => window.r6game.world.gadgets.isScanning(window.r6game.player));
  await A.evaluate(() => window.qa.act({ ads: false }));
});
await step('anti-gadget · Jäger: hold [G] places an ADS', async () => {
  await A.evaluate(() => { const g = window.r6game; window.qa.swap('jager'); window.qa.openFacing(2.5, 'dining'); g.player.pitch = -0.3; g.physics.step(); });
  await A.evaluate(() => window.qa.act({ gadget: 'key_hold', durationMs: 6000 }));
  await sim(A, () => window.qa.count('ads') > 0);
});
await step('support · Smoke: [G] throws, [G] again detonates', async () => {
  await A.evaluate(() => window.qa.swap('smoke'));
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => window.qa.count('gas') > 0);
  await A.waitForTimeout(1500);
  await A.evaluate(() => window.qa.act({ gadget: 'key' }));
  await sim(A, () => [...window.r6game.world.gadgets.list.values()].some((x) => x.type === 'gas' && x.state !== 'stuck'));
});
await step('defender CCTV: [3] opens the camera feed, click cycles, [3] returns', async () => {
  await A.evaluate(() => window.r6game.onUiAction('observe'));
  assert.equal(await A.evaluate(() => window.r6game.view), 'cam');
  await until(A, () => !document.querySelector('#feed-overlay').classList.contains('hidden'));
  await A.evaluate(() => window.r6game.onUiAction('observe'));
  assert.equal(await A.evaluate(() => window.r6game.view), 'body');
});

/* ================================================================== S4 · PvP state */
console.log('S4 · PvP lobby → round');
const B = await open();
const code = `R6-${1000 + Math.floor(Math.random() * 8999)}`;
await step('two tabs join one room; lobby screen lists both', async () => {
  await A.evaluate(() => window.r6game.quitToMenu());
  await A.evaluate((c) => window.webmcp.join({ nickname: 'Alpha', roomCode: c, mode: 'local' }), code);
  await B.evaluate((c) => window.webmcp.join({ nickname: 'Bravo', roomCode: c, mode: 'local' }), code);
  await until(A, () => window.r6game.room.state.members.length >= 2, null, 60000);
  assert.ok(await visible(A, '#lobby'));
});
await step('host starts: attackers get the drone view in prep, defenders their body; lobby hides', async () => {
  // each tab notes its view and the lobby as it handles the first prep state (message-driven: two contended
  // SwiftShader tabs can stall for most of the 45 s prep — and a stalled tab can miss heartbeats and drop the
  // round back to the lobby — so neither polling from here nor an in-page timer reliably sees it)
  const watch = () => {
    const g = window.r6game;
    const room = g.room;
    const prev = room.onState;
    window.__prep = null;
    room.onState = (st) => {
      prev.call(room, st);
      if (st.phase === 'prep' && !window.__prep && g.player) {
        const lobby = document.querySelector('#lobby');
        window.__prep = [g.player.side, g.view, !!lobby && !lobby.classList.contains('hidden') && getComputedStyle(lobby).display !== 'none'];
      }
    };
  };
  await Promise.all([A, B].map((p) => p.evaluate(watch)));
  await A.evaluate(() => window.r6game.room.send({ type: 'start_match' }));
  const seen = await Promise.all([A, B].map(async (p) => { await until(p, () => window.__prep !== null, null, 60000); return p.evaluate(() => window.__prep); }));
  for (const [side, view, lobby] of seen) {
    assert.equal(view, side === 'attack' ? 'drone' : 'body');
    assert.equal(lobby, false, 'the lobby hides as the round starts');
  }
});

/* ================================================================== S5 · online reconnect (needs the Worker: `npm run dev:worker`) */
if (process.env.E2E_ONLINE === '1') {
  console.log('S5 · online room · dropped socket resumes the same seat');
  await A.close(); await B.close(); // SwiftShader: fewer tabs → timers fire on time
  const C = await open();
  current = C;
  const D = await open();
  const code2 = `R6-${1000 + Math.floor(Math.random() * 8999)}`;
  await step('two tabs join an online (Durable Object) room', async () => {
    await C.evaluate((c) => window.webmcp.join({ nickname: 'Charlie', roomCode: c, mode: 'online' }), code2);
    await D.evaluate((c) => window.webmcp.join({ nickname: 'Delta', roomCode: c, mode: 'online' }), code2);
    await until(C, () => window.r6game.room?.state?.members.length >= 2, null, 60000);
    await C.evaluate(() => window.r6game.room.send({ type: 'start_match' }));
    await until(C, () => window.r6game.player && window.r6game.world.phase === 'prep', null, 60000);
    await until(D, () => window.r6game.player && window.r6game.world.phase === 'prep', null, 60000);
  });
  await step('socket drops → reconnecting → resumed with the same id; destruction done meanwhile is replayed', async () => {
    const before = await C.evaluate(() => window.r6game.room.selfId);
    // C reconnects 0.5 s after the drop, so "away" is brief: D acts inside its room-state handler the moment it
    // sees C away — it breaks a wall right then (destruction done *while* C is away), instead of a slow poll from
    // here that can land after C is already back
    await D.evaluate((id) => {
      const g = window.r6game;
      const room = g.room;
      const prev = room.onState;
      window.__sawAway = false;
      window.__pid = null;
      room.onState = (st) => {
        prev.call(room, st);
        if (window.__sawAway || !st.members.find((m) => m.id === id)?.away) return;
        window.__sawAway = true;
        const p = [...g.destruction.panels.values()].find((x) => x.kind === 'wall_soft' && !x.reinforced);
        const res = g.destruction.impactAndApply('sledge', p.center, p);
        g.world.combat.emitCells(res.events);
        window.__pid = p.id;
      };
    }, before);
    await C.evaluate(() => { window.r6game.room.t.ws.close(4000, 'test drop'); });
    await until(D, () => window.__sawAway === true, null, 15000);
    const pid = await D.evaluate(() => window.__pid);
    await until(C, () => window.r6game.room.reconnects > 0, null, 45000);
    assert.equal(await C.evaluate(() => window.r6game.room.selfId), before);
    assert.ok(await C.evaluate(() => !!window.r6game.player && window.r6game.mode === 'pvp'));
    await until(C, (id) => window.r6game.destruction.get(id).brokenCount > 0, pid, 20000);
  });
}

assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
console.log(failures ? `\n${failures} scenario(s) failed` : '\nall scenarios passed');
await browser.close();
process.exit(failures ? 1 : 0);
