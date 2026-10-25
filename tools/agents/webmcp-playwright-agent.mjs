#!/usr/bin/env node
/**
 * External WebMCP agent example — joins a PvP room (or Terrorist Hunt) in a real
 * browser and plays using ONLY the DOM contract:
 *   read : #webmcp-agent-bridge [data-self-state] [data-first-person-vision] [data-acoustic-cues] [data-match-state]
 *   write: document.dispatchEvent(new CustomEvent('webmcp:action', { detail: action }))
 *
 *   node tools/agents/webmcp-playwright-agent.mjs --url https://<pages>.pages.dev --room R6-8492 --nick Claude-Agent
 *   node tools/agents/webmcp-playwright-agent.mjs --url http://localhost:5173 --th --seconds 60 --headed
 *
 * The `decide()` function is the only "brain" — swap it for an LLM call that
 * receives the observation JSON + AGENT_CONTEXT.md and returns an action.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const URL = args.url ?? 'http://localhost:5173';
const SECONDS = Number(args.seconds ?? 90);

const browser = await chromium.launch({ headless: !args.headed, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('[page]', e.message));
const q = args.th ? `?th=1&difficulty=${args.difficulty ?? 'Normal'}` : `?room=${encodeURIComponent(args.room ?? 'R6-0001')}&nick=${encodeURIComponent(args.nick ?? 'WebMCP-Agent')}&agent=1&mode=${args.mode ?? 'online'}`;
await page.goto(`${URL.replace(/\/$/, '')}/${q}`);
await page.waitForFunction(() => document.querySelector('#webmcp-agent-bridge')?.dataset.tick, null, { timeout: 120000 });
console.log('[agent] connected — reading the WebMCP DOM bridge');

/** perception → decision (pure function of the observation) */
function decide(o, mem) {
  const self = o.self;
  if (!self || !self.alive) return null;
  const enemy = (o.vision ?? []).filter((v) => v.kind === 'enemy').sort((a, b) => a.distance - b.distance)[0];
  if (enemy) {
    const on = Math.abs(enemy.yawDelta) < 2 && Math.abs(enemy.pitchDelta) < 2;
    mem.last = { heading: self.heading + enemy.yawDelta, t: Date.now() };
    return { lookLerp: { yawDelta: enemy.yawDelta, pitchDelta: enemy.pitchDelta, rate: 0.35 }, ads: enemy.distance > 6, fire: on ? { burst: 3 } : false, stance: enemy.distance > 12 ? 'crouch' : 'stand', durationMs: 200 };
  }
  if (self.weapon?.ammoInMag !== undefined && self.weapon.ammoInMag < 8 && !self.weapon.reloading) return { reload: true };
  const cue = (o.acoustic ?? []).find((c) => c.ageMs < 1500 && c.vertical === 'Same_Floor' && c.intensity > 0.1);
  if (cue) return { lookLerp: { yawDelta: cue.bearingDeg, pitch: 0, rate: 0.2 }, stance: 'crouch', move: { forward: 0.3 }, durationMs: 300 };
  if (mem.last && Date.now() - mem.last.t < 2500) return { lookLerp: { yaw: mem.last.heading, rate: 0.2 }, durationMs: 300 };
  if (o.match?.droneActive) return { drone: { forward: 1 }, lookLerp: { yawDelta: 6, rate: 0.05 }, durationMs: 300 };
  // wander: walk forward, slowly sweep; turn around when a wall is very close in view
  const wall = (o.vision ?? []).find((v) => (v.kind.endsWith('wall') || v.kind === 'door' || v.kind === 'window') && v.distance < 1.2 && Math.abs(v.yawDelta) < 25);
  return { move: { forward: wall ? 0 : 0.8 }, lookLerp: { yawDelta: wall ? 70 : 4, rate: 0.12 }, durationMs: 300 };
}

const mem = {};
const t0 = Date.now();
let ticks = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  const o = await page.evaluate(() => {
    const el = document.querySelector('#webmcp-agent-bridge');
    const j = (k) => { try { return JSON.parse(el.dataset[k] ?? 'null'); } catch { return null; } };
    return { self: j('selfState'), vision: j('firstPersonVision'), acoustic: j('acousticCues'), match: j('matchState'), tick: Number(el.dataset.tick) };
  });
  const action = decide(o, mem);
  if (action) await page.evaluate((a) => document.dispatchEvent(new CustomEvent('webmcp:action', { detail: a })), action);
  if (++ticks % 20 === 0) console.log(`[agent] t=${((Date.now() - t0) / 1000).toFixed(0)}s room=${o.self?.room} hp=${o.self?.hp} visible=${o.vision?.length} cues=${o.acoustic?.length} phase=${o.match?.phase}`);
  await page.waitForTimeout(100);
}
await browser.close();
