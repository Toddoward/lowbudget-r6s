import './ui/styles.css';
import agentContext from '../AGENT_CONTEXT.md?raw';
import { Game } from './game/Game.ts';
import { OPERATORS } from './game/operators.ts';
import { ATTACKERS, ATTACK_SPAWNS, DEFENDERS, PVP_TIMINGS, normalizeRoomCode, randomRoomCode, sanitizeNickname } from '../shared/constants.ts';
import type { RoomState } from '../shared/protocol.ts';
import { teamOf } from '../shared/protocol.ts';
import { ACTION_SCHEMA, OBSERVATION_SCHEMA, TOOLS } from './webmcp/schema.ts';
import { esc } from './ui/Hud.ts';
import type { Mission } from './game/Objectives.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);
$('#agent-context-md').textContent = agentContext;

const game = new Game($<HTMLCanvasElement>('#game'));
(window as unknown as { r6game: Game }).r6game = game;
// dev/test hook: shorten PvP phases for local-transport rooms hosted by this tab
if (import.meta.env.DEV || new URLSearchParams(location.search).has('fastrounds')) (window as unknown as { r6timings: typeof PVP_TIMINGS }).r6timings = PVP_TIMINGS;

let toastT = 0;
game.onToast = (m) => {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.classList.remove('show'), 2600);
};

/* ---------------------------------------------------------------- menu */
let thOperator = localStorage.getItem('r6.op') ?? 'ash';
let thAgents = 0;
function renderOps() {
  $('#th-ops').innerHTML = ATTACKERS.map((id) => {
    const o = OPERATORS[id];
    return `<div class="op ${id === thOperator ? 'on' : ''}" data-op="${id}" title="${esc(o.desc)}"><div class="badge" style="background:${o.cloth}"></div>${o.name}<small>${o.unit} · ${'■'.repeat(o.armor)}${'□'.repeat(3 - o.armor)}</small></div>`;
  }).join('');
}
renderOps();
$('#th-ops').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.op');
  if (!el) return;
  thOperator = el.dataset.op!;
  localStorage.setItem('r6.op', thOperator);
  renderOps();
});
$('#th-add-agent').onclick = () => { thAgents = Math.min(4, thAgents + 1); $('#th-agents').textContent = String(thAgents); };
$('#th-clear-agents').onclick = () => { thAgents = 0; $('#th-agents').textContent = '0'; };
$('#th-start').onclick = () => startTH();
$<HTMLInputElement>('#nick').value = localStorage.getItem('r6.nick') ?? '';
$<HTMLInputElement>('#room-code').value = localStorage.getItem('r6.room') ?? '';
$('#room-random').onclick = () => { $<HTMLInputElement>('#room-code').value = randomRoomCode(); };
$('#pvp-join').onclick = () => void join();

function startTH() {
  const nick = sanitizeNickname($<HTMLInputElement>('#nick').value || 'Recruit');
  localStorage.setItem('r6.nick', nick);
  show('#menu', false);
  game.startTH({
    difficulty: $<HTMLSelectElement>('#th-diff').value as 'Normal',
    mission: $<HTMLSelectElement>('#th-mission').value as Mission | 'random',
    tod: $<HTMLSelectElement>('#th-tod').value as 'random',
    spawn: $<HTMLSelectElement>('#th-spawn').value as 'random',
    operator: thOperator,
    agents: thAgents,
  });
}

async function join(nickIn?: string, codeIn?: string, modeIn?: 'online' | 'local', asAgent?: boolean) {
  const nick = sanitizeNickname(nickIn ?? ($<HTMLInputElement>('#nick').value || 'Recruit'));
  const code = normalizeRoomCode(codeIn ?? $<HTMLInputElement>('#room-code').value) ?? randomRoomCode();
  const mode = modeIn ?? ($<HTMLSelectElement>('#room-mode').value as 'online' | 'local');
  localStorage.setItem('r6.room', code);
  $<HTMLInputElement>('#room-code').value = code;
  show('#menu', false);
  show('#lobby', true);
  $('#lobby-code').textContent = code;
  $('#lobby-mode').textContent = mode === 'online' ? 'ONLINE · Durable Object' : 'LOCAL · BroadcastChannel';
  return game.joinRoom(nick, code, mode, asAgent ?? $<HTMLInputElement>('#join-as-agent').checked);
}

/* ---------------------------------------------------------------- lobby */
let lastState: RoomState | null = null;
game.onLobby = (s, selfId) => {
  lastState = s;
  const inLobby = s.phase === 'lobby' || s.phase === 'matchEnd';
  show('#lobby', inLobby && game.mode === 'pvp');
  show('#prep-picker', s.phase === 'prep');
  if (s.phase === 'prep') renderPrepPicker(s, selfId);
  if (!inLobby) return;
  for (const sq of ['A', 'B'] as const) {
    const box = $(`#squad-${sq} .members`);
    box.innerHTML = s.members.filter((m) => m.squad === sq).map((m) => {
      const mine = m.ownerId === selfId;
      const team = teamOf(m, null);
      const pool = team === 'attack' ? ATTACKERS : DEFENDERS;
      const ctl = mine ? `<div class="ctl" data-actor="${esc(m.id)}">
          <select data-k="operator">${pool.map((o) => `<option value="${o}" ${o === m.operator ? 'selected' : ''}>${OPERATORS[o].name}</option>`).join('')}</select>
          <select data-k="spawn">${ATTACK_SPAWNS.map((z) => `<option value="${z.id}" ${z.id === m.spawn ? 'selected' : ''}>${z.label}</option>`).join('')}</select>
          <button data-k="squad" data-v="${sq === 'A' ? 'B' : 'A'}">→ Squad ${sq === 'A' ? 'B' : 'A'}</button>
          <button data-k="ready" data-v="${m.ready ? '0' : '1'}">${m.ready ? 'Unready' : 'Ready'}</button>
          ${m.isAgent ? `<button data-k="remove">remove agent</button>` : ''}</div>` : '';
      return `<div class="member ${m.ready ? 'ready' : ''}"><span class="name">${esc(m.nickname)}${m.isAgent ? ' 🤖' : ''}${m.id === s.hostId ? ' ★' : ''}</span><span class="meta">${OPERATORS[m.operator]?.name ?? m.operator} · ${m.kills}/${m.deaths}</span>${ctl}</div>`;
    }).join('') || '<div class="meta">empty</div>';
  }
  $('#lobby-start').classList.toggle('hidden', s.hostId !== selfId);
  const peers = game.room?.peerPaths() ?? [];
  $('#lobby-net').textContent = `you: ${selfId} · ${s.members.length}/10 · peers: ${peers.map((p) => `${p.id.slice(0, 6)}=${p.path}`).join(', ') || 'none'} · rtt ${game.room?.rtt ?? 0} ms${s.phase === 'matchEnd' ? ` · MATCH OVER ${s.score.A}:${s.score.B}` : ''}`;
};
$('#lobby').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement;
  const actor = el.closest<HTMLElement>('.ctl')?.dataset.actor;
  if (!actor || !el.dataset.k) return;
  game.setLoadout(actor, { [el.dataset.k]: el.value });
});
$('#lobby').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]');
  const actor = el?.closest<HTMLElement>('.ctl')?.dataset.actor;
  if (!el || !actor) return;
  if (el.dataset.k === 'squad') game.setLoadout(actor, { squad: el.dataset.v as 'A' | 'B' });
  if (el.dataset.k === 'ready') game.setLoadout(actor, { ready: el.dataset.v === '1' });
  if (el.dataset.k === 'remove') game.room?.send({ type: 'remove_agent', id: actor });
});
$('#lobby-add-agent').onclick = () => game.addRoomAgent();
$('#lobby-start').onclick = () => game.room?.send({ type: 'start_match' });
$('#lobby-leave').onclick = () => { game.quitToMenu(); };

function renderPrepPicker(s: RoomState, selfId: string) {
  const me = s.members.find((m) => m.id === selfId);
  if (!me || !s.round) return;
  const team = teamOf(me, s.round);
  const pool = team === 'attack' ? ATTACKERS : DEFENDERS;
  $('#prep-picker').innerHTML = `<span style="align-self:center;color:#9aa0a6;font-size:13px">PREP · operator:</span>` + pool.map((o) => `<button data-op="${o}" class="${o === me.operator ? 'on' : ''}">${OPERATORS[o].name}</button>`).join('');
}
$('#prep-picker').addEventListener('click', (e) => {
  const op = (e.target as HTMLElement).closest<HTMLElement>('button[data-op]')?.dataset.op;
  if (op && game.room) game.setLoadout(game.room.selfId, { operator: op });
});

/* ---------------------------------------------------------------- pause / results */
document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement;
  const inMatch = game.mode !== 'menu' && !(game.mode === 'pvp' && (lastState?.phase === 'lobby'));
  game.paused = !locked && inMatch;
  show('#pause', !locked && inMatch && $('#agent-modal').classList.contains('hidden') && $('#th-result').classList.contains('hidden'));
});
$('#pause-resume').onclick = () => { show('#pause', false); game.input.lock(); };
$('#pause-quit').onclick = () => { show('#pause', false); game.quitToMenu(); };
$('#th-restart').onclick = () => { show('#th-result', false); game.restartTH(); };
$('#th-menu').onclick = () => { show('#th-result', false); game.quitToMenu(); };
game.onMatchStart = () => { show('#menu', false); show('#th-result', false); show('#pause', false); };
game.onMenu = () => { show('#menu', true); show('#lobby', false); show('#pause', false); show('#th-result', false); };

/* ---------------------------------------------------------------- settings */
const sens = $<HTMLInputElement>('#set-sens');
const fov = $<HTMLInputElement>('#set-fov');
const qual = $<HTMLSelectElement>('#set-quality');
const vol = $<HTMLInputElement>('#set-vol');
const loadSettings = () => {
  sens.value = localStorage.getItem('r6.sens') ?? sens.value;
  fov.value = localStorage.getItem('r6.fov') ?? fov.value;
  qual.value = localStorage.getItem('r6.quality') ?? qual.value;
  vol.value = localStorage.getItem('r6.vol') ?? vol.value;
};
const applySettings = () => {
  game.input.sensitivity = Number(sens.value) / 1000;
  game.fov = Number(fov.value);
  game.audio.volume = Number(vol.value);
  localStorage.setItem('r6.sens', sens.value);
  localStorage.setItem('r6.fov', fov.value);
  localStorage.setItem('r6.quality', qual.value);
  localStorage.setItem('r6.vol', vol.value);
};
for (const el of [sens, fov, vol]) el.addEventListener('input', applySettings);
qual.addEventListener('change', () => { applySettings(); localStorage.setItem('r6.qualityManual', '1'); game.autoQuality = false; game.setQuality(qual.value as 'high'); });

/* ---------------------------------------------------------------- WebMCP guide modal */
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inCode = false;
  let code = '';
  let list = false;
  let table: string[][] | null = null;
  const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const flushTable = () => {
    if (!table) return;
    html += '<table>' + table.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') + '</table>';
    table = null;
  };
  for (const raw of lines) {
    if (raw.startsWith('```')) {
      if (inCode) { html += `<pre>${esc(code)}</pre>`; code = ''; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code += raw + '\n'; continue; }
    if (/^\|/.test(raw)) {
      if (/^\|[\s|:-]+\|$/.test(raw.trim())) continue;
      (table ??= []).push(raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      continue;
    }
    flushTable();
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) { if (list) { html += '</ul>'; list = false; } html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; continue; }
    if (/^\s*[-*]\s+/.test(raw)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(raw.replace(/^\s*[-*]\s+/, ''))}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (raw.trim()) html += `<p>${inline(raw)}</p>`;
  }
  flushTable();
  if (list) html += '</ul>';
  return html;
}
let liveTimer = 0;
function openGuide() {
  game.input.unlock();
  show('#agent-modal', true);
  show('#pause', false);
  $('#tab-guide').innerHTML = mdToHtml(agentContext);
  $('#tab-schema').textContent = JSON.stringify({ action: ACTION_SCHEMA, observation: OBSERVATION_SCHEMA, tools: TOOLS }, null, 2);
  $('#tab-snippet').textContent = SNIPPET;
  clearInterval(liveTimer);
  liveTimer = window.setInterval(() => { $('#tab-live').textContent = JSON.stringify(window.webmcp?.observe('self') ?? {}, null, 2); }, 500);
}
for (const id of ['#open-agent-guide', '#lobby-guide', '#pause-guide']) $(id).onclick = openGuide;
$('#agent-modal-close').onclick = () => { show('#agent-modal', false); clearInterval(liveTimer); };
$('#agent-modal .tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#agent-modal .tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('#agent-modal .tab').forEach((x) => x.classList.toggle('hidden', x.id !== `tab-${b.dataset.tab}`));
});
const SNIPPET = `// 1) join a room (or start Terrorist Hunt)
await webmcp.join({ nickname: 'Claude-Agent', roomCode: 'R6-8492', mode: 'online' });
// or: webmcp.startTerroristHunt({ difficulty: 'Normal', mission: 'random' });

// 2) perceive → decide → act loop (10 Hz)
webmcp.subscribe((obs) => {
  const enemy = obs.vision.find(v => v.kind === 'enemy');
  if (enemy) {
    webmcp.act({ lookLerp: { yawDelta: enemy.yawDelta, pitchDelta: enemy.pitchDelta, rate: 0.35 },
                 ads: true, fire: Math.abs(enemy.yawDelta) < 2 ? { burst: 3 } : false });
  } else {
    const cue = obs.acoustic[0];
    webmcp.act({ lookLerp: { yawDelta: cue ? cue.bearingDeg : 15, rate: 0.15 }, move: { forward: 0.6 }, durationMs: 300 });
  }
});

// DOM alternative (no JS globals):
document.querySelector('#webmcp-agent-bridge').dataset.firstPersonVision;   // JSON
document.dispatchEvent(new CustomEvent('webmcp:action', { detail: { move: { forward: 1 }, durationMs: 500 } }));

// Playwright / external process: see tools/agents/webmcp-playwright-agent.mjs`;

/* ---------------------------------------------------------------- boot */
declare global { interface Window { webmcp: { observe: (id?: string) => unknown } } }
loadSettings();
game.init((msg) => {
  $('#loading-msg').textContent = msg;
  const bar = $('#loading-bar');
  bar.style.width = `${Math.min(100, (parseFloat(bar.style.width) || 0) + 18)}%`;
}).then(() => {
  applySettings();
  game.autoQuality = localStorage.getItem('r6.qualityManual') !== '1';
  if (qual.value !== 'high') game.setQuality(qual.value as 'high');
  show('#loading', false);
  // URL automation: ?room=R6-1234&nick=Agent&agent=1&mode=local  |  ?th=1&difficulty=Hard&mission=bomb&agents=2
  const q = new URLSearchParams(location.search);
  if (q.get('room')) void join(q.get('nick') ?? undefined, q.get('room')!, (q.get('mode') as 'local') ?? 'online', q.get('agent') === '1');
  else if (q.get('th')) {
    thAgents = Number(q.get('agents') ?? 0);
    if (q.get('difficulty')) $<HTMLSelectElement>('#th-diff').value = q.get('difficulty')!;
    if (q.get('mission')) $<HTMLSelectElement>('#th-mission').value = q.get('mission')!;
    if (q.get('tod')) $<HTMLSelectElement>('#th-tod').value = q.get('tod')!;
    if (q.get('op')) thOperator = q.get('op')!;
    startTH();
  } else show('#menu', true);
}).catch((err) => {
  console.error(err);
  $('#loading-msg').textContent = `Failed to start: ${(err as Error).message}. WebGL2 + WebAssembly are required.`;
});
