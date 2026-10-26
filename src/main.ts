import './ui/styles.css';
import agentContext from '../AGENT_CONTEXT.md?raw';
import { Game } from './game/Game.ts';
import { OPERATORS, type Role } from './game/operators.ts';
import { ATTACKERS, ATTACK_SPAWNS, DEFENDERS, PVP_TIMINGS, normalizeRoomCode, randomRoomCode, sanitizeNickname } from '../shared/constants.ts';
import type { RoomState } from '../shared/protocol.ts';
import { teamOf } from '../shared/protocol.ts';
import { ACTION_SCHEMA, OBSERVATION_SCHEMA, TOOLS } from './webmcp/schema.ts';
import { esc } from './ui/Hud.ts';
import type { Mission } from './game/Objectives.ts';
import { applyDom, getLang, onLangChange, setKeyCapResolver, setLang, t, type Lang } from './ui/i18n.ts';
import { ACTIONS, codeLabel, type Action } from './core/Keybinds.ts';
import { QA } from './qa.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const show = (id: string, on: boolean) => $(id).classList.toggle('hidden', !on);
const isShown = (id: string) => !$(id).classList.contains('hidden');
$('#agent-context-md').textContent = agentContext;
document.body.classList.toggle('qa', QA);

const game = new Game($<HTMLCanvasElement>('#game'));
(window as unknown as { r6game: Game }).r6game = game;
// QA hook: shorten PvP phases for local-transport rooms hosted by this tab
if (QA || new URLSearchParams(location.search).has('fastrounds')) (window as unknown as { r6timings: typeof PVP_TIMINGS }).r6timings = PVP_TIMINGS;
setKeyCapResolver((a) => game.input.binds.cap(a));

let toastT = 0;
game.onToast = (m) => {
  const el = $('#toast');
  el.textContent = m;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => el.classList.remove('show'), 2600);
};

/* ================================================================ screens (menu depth ≤ 2) */
const SCREENS = ['#menu', '#th-setup', '#mp', '#lobby', '#pause', '#th-result'] as const;
type Screen = (typeof SCREENS)[number] | null;
function screen(id: Screen) {
  for (const s of SCREENS) show(s, s === id);
  if (id && id !== '#pause') { show('#help-overlay', false); }
}
document.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => (b.onclick = () => screen('#menu')));

/* ================================================================ language */
function relabel() {
  applyDom();
  document.title = getLang() === 'ko' ? 'R6S: TEMU — 테무 에디션' : 'R6S: TEMU — Low-Budget Edition';
  document.querySelectorAll<HTMLElement>('.lang-switch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  $<HTMLSelectElement>('#set-lang').value = getLang();
  game.hud.refresh();
  renderOps();
  renderQuickSub();
  renderBinds();
  renderHelp();
  if (lastState && game.room) game.onLobby(lastState, game.room.selfId);
}
onLangChange(relabel);
document.querySelectorAll<HTMLElement>('.lang-switch button').forEach((b) => (b.onclick = () => setLang(b.dataset.lang as Lang)));

/* ================================================================ home */
// one remembered pick per side: Hostage Protection is played as a defender
let thOperator = localStorage.getItem('r6.op') ?? 'ash';
if (!(ATTACKERS as readonly string[]).includes(thOperator)) thOperator = 'ash';
let thDefender = localStorage.getItem('r6.opDef') ?? 'smoke';
if (!(DEFENDERS as readonly string[]).includes(thDefender)) thDefender = 'smoke';
const thDefending = () => $<HTMLSelectElement>('#th-mission').value === 'protect';
const thPick = () => (thDefending() ? thDefender : thOperator);
let thAgents = 0;
function renderQuickSub() {
  $('#quick-sub').textContent = t('menu.quickSub2', OPERATORS[thOperator]?.name ?? thOperator);
}
$('#nav-quick').onclick = () => startTH(true);
$('#nav-th').onclick = () => screen('#th-setup');
$('#nav-mp').onclick = () => screen('#mp');
$('#nav-settings').onclick = () => openSettings('general');
$('#nav-controls').onclick = () => openSettings('controls');

/* ================================================================ Terrorist Hunt setup: operators grouped by role */
const ROLE_ORDER: Role[] = ['breacher', 'hardBreacher', 'shield', 'support', 'intel', 'fragger', 'antiGadget', 'anchor', 'trapper', 'flank'];
function renderOps() {
  const groups = new Map<Role, string[]>();
  for (const id of thDefending() ? DEFENDERS : ATTACKERS) {
    const r = OPERATORS[id].roles?.[0] ?? 'support';
    groups.set(r, [...(groups.get(r) ?? []), id]);
  }
  $('#th-ops').innerHTML = ROLE_ORDER.filter((r) => groups.has(r)).map((r) => `<div class="op-group"><h4>${esc(t(`role.${r}`))}</h4><div class="ops">${groups.get(r)!.map((id) => opCard(id)).join('')}</div></div>`).join('');
  const o = OPERATORS[thPick()];
  $('#th-op-info').innerHTML = `<b>${esc(o.name)}</b> <small>${esc(o.unit)} · ${(o.roles ?? []).map((r) => t(`role.${r}`)).join(' / ')}</small>
    <div class="pips"><span>${t('menu.armor')}</span>${pips(o.armor)}<span>${t('menu.speed')}</span>${pips(o.speed)}</div>
    <div class="gadget-line"><kbd>${esc(game.input.binds.cap('gadget'))}</kbd> ${esc(t(`gname.${o.gadget}`))}${o.universal === 'breach' ? ` · <kbd>${esc(game.input.binds.cap('gadget2'))}</kbd> ${esc(t('gname.breach'))} ×${o.universalCount}` : ''}</div>
    <p>${esc(getLang() === 'ko' ? o.descKo ?? o.desc : o.desc)}</p>`;
}
const pips = (n: number) => `<i class="pip on"></i>`.repeat(n) + `<i class="pip"></i>`.repeat(3 - n);
function opCard(id: string) {
  const o = OPERATORS[id];
  return `<button class="op ${id === thPick() ? 'on' : ''}" data-op="${id}"><span class="badge" style="background:${o.cloth};border-color:${o.accent}">${esc(o.name.slice(0, 2).toUpperCase())}</span>${esc(o.name)}<small>${esc(o.unit)}</small></button>`;
}
$('#th-ops').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.op');
  if (!el) return;
  if (thDefending()) { thDefender = el.dataset.op!; localStorage.setItem('r6.opDef', thDefender); }
  else { thOperator = el.dataset.op!; localStorage.setItem('r6.op', thOperator); }
  renderOps();
  renderQuickSub();
});
$('#th-ops').addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.op')) startTH(); });
for (const id of ['#th-mission', '#th-diff', '#th-tod', '#th-spawn']) {
  const el = $<HTMLSelectElement>(id);
  el.value = localStorage.getItem(`r6.th${id}`) ?? el.value;
  el.addEventListener('change', () => { localStorage.setItem(`r6.th${id}`, el.value); if (id === '#th-mission') renderOps(); });
}
// (an old saved 'secure' choice: Secure Area is PvP-only now)
if ($<HTMLSelectElement>('#th-mission').value === '' || $<HTMLSelectElement>('#th-mission').value === 'secure') $<HTMLSelectElement>('#th-mission').value = 'random';
$('#th-add-agent').onclick = () => { thAgents = Math.min(4, thAgents + 1); $('#th-agents').textContent = String(thAgents); };
$('#th-clear-agents').onclick = () => { thAgents = 0; $('#th-agents').textContent = '0'; };
$('#th-start').onclick = () => startTH();

function startTH(quick = false) {
  const nick = sanitizeNickname(localStorage.getItem('r6.nick') || $<HTMLInputElement>('#nick').value || 'Recruit');
  localStorage.setItem('r6.nick', nick);
  screen(null);
  goFullscreen();
  const v = (id: string) => (quick ? 'random' : $<HTMLSelectElement>(id).value);
  game.startTH({
    difficulty: (quick ? 'Normal' : $<HTMLSelectElement>('#th-diff').value) as 'Normal',
    mission: v('#th-mission') as Mission | 'random',
    tod: v('#th-tod') as 'random',
    spawn: v('#th-spawn') as 'random',
    operator: quick ? thOperator : thPick(),
    agents: QA ? thAgents : 0,
  });
}

/* ================================================================ multiplayer */
$<HTMLInputElement>('#nick').value = localStorage.getItem('r6.nick') ?? '';
$<HTMLInputElement>('#room-code').value = localStorage.getItem('r6.room') ?? '';
$('#pvp-join').onclick = () => {
  if (!normalizeRoomCode($<HTMLInputElement>('#room-code').value)) { game.onToast(t('menu.badCode')); $('#room-code').focus(); return; }
  void join();
};
$('#pvp-create').onclick = () => { $<HTMLInputElement>('#room-code').value = randomRoomCode(); void join(); };

async function join(nickIn?: string, codeIn?: string, modeIn?: 'online' | 'local', asAgent?: boolean) {
  const nick = sanitizeNickname(nickIn ?? ($<HTMLInputElement>('#nick').value || 'Recruit'));
  const code = normalizeRoomCode(codeIn ?? $<HTMLInputElement>('#room-code').value) ?? randomRoomCode();
  const mode = QA ? modeIn ?? ($<HTMLSelectElement>('#room-mode').value as 'online' | 'local') : 'online';
  localStorage.setItem('r6.room', code);
  $<HTMLInputElement>('#room-code').value = code;
  screen('#lobby');
  $('#lobby-code').textContent = code;
  $('#lobby-mode').textContent = mode === 'online' ? t('lobby.online') : 'LOCAL · BroadcastChannel';
  return game.joinRoom(nick, code, mode, asAgent ?? (QA && $<HTMLInputElement>('#join-as-agent').checked));
}

/* ================================================================ lobby */
let lastState: RoomState | null = null;
game.onLobby = (s, selfId) => {
  lastState = s;
  const inLobby = s.phase === 'lobby' || s.phase === 'matchEnd';
  if (inLobby && game.mode === 'pvp' && !isShown('#lobby')) screen('#lobby');
  if (!inLobby && isShown('#lobby')) screen(null);
  renderPrepPicker(s, selfId);
  if (!inLobby) return;
  for (const sq of ['A', 'B'] as const) {
    const box = $(`#squad-${sq} .members`);
    box.innerHTML = s.members.filter((m) => m.squad === sq).map((m) => {
      const mine = m.ownerId === selfId;
      const team = teamOf(m, null);
      const pool = team === 'attack' ? ATTACKERS : DEFENDERS;
      const ctl = mine ? `<div class="ctl" data-actor="${esc(m.id)}">
          <select data-k="operator">${pool.map((o) => `<option value="${o}" ${o === m.operator ? 'selected' : ''}>${OPERATORS[o].name} · ${t(`role.${OPERATORS[o].roles?.[0] ?? 'support'}`)}</option>`).join('')}</select>
          ${team === 'attack' ? `<select data-k="spawn">${ATTACK_SPAWNS.map((z) => `<option value="${z.id}" ${z.id === m.spawn ? 'selected' : ''}>${t(`spawn.${z.id}`)}</option>`).join('')}</select>` : ''}
          <button data-k="squad" data-v="${sq === 'A' ? 'B' : 'A'}">${t('lobby.moveTo', sq === 'A' ? 'B' : 'A')}</button>
          <button data-k="ready" data-v="${m.ready ? '0' : '1'}" class="${m.ready ? '' : 'primary-lite'}">${t(m.ready ? 'lobby.unready' : 'lobby.ready')}</button>
          ${m.isAgent ? `<button data-k="remove">✕</button>` : ''}</div>` : '';
      return `<div class="member ${m.ready ? 'ready' : ''}"><span class="name">${esc(m.nickname)}${m.isAgent ? ' 🤖' : ''}${m.id === s.hostId ? ' ★' : ''}${m.away ? ` <small class="away">${t('lobby.away')}</small>` : ''}</span><span class="meta">${OPERATORS[m.operator]?.name ?? m.operator} · ${m.kills}/${m.deaths}</span>${ctl}</div>`;
    }).join('') || `<div class="meta">${t('lobby.empty')}</div>`;
  }
  $('#squad-A h3').textContent = `SQUAD A · ${t(s.round ? 'hud.attacking' : 'menu.attackers')}`;
  $('#squad-B h3').textContent = `SQUAD B · ${t(s.round ? 'hud.defending' : 'menu.defenders')}`;
  $('#lobby-start').classList.toggle('hidden', s.hostId !== selfId);
  const peers = game.room?.peerPaths() ?? [];
  $('#lobby-net').textContent = `${s.members.length}/10 · rtt ${game.room?.rtt ?? 0} ms${QA ? ` · you: ${selfId} · peers: ${peers.map((p) => `${p.id.slice(0, 6)}=${p.path}`).join(', ') || 'none'}` : ''}${s.phase === 'matchEnd' ? ` · ${t('lobby.matchOver', s.score.A, s.score.B)}` : ''}`;
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
$('#lobby-start').onclick = () => { goFullscreen(); game.room?.send({ type: 'start_match' }); };
$('#lobby-leave').onclick = () => game.quitToMenu();
$('#lobby-copy').onclick = () => { void navigator.clipboard?.writeText($('#lobby-code').textContent ?? '').then(() => game.onToast(t('lobby.copied'))); };

/** PvP prep: change operator from the pause screen (cursor is free there) */
function renderPrepPicker(s: RoomState, selfId: string) {
  const me = s.members.find((m) => m.id === selfId);
  const on = s.phase === 'prep' && !!me && !!s.round;
  show('#prep-picker', on);
  if (!on) return;
  const team = teamOf(me!, s.round);
  const pool = team === 'attack' ? ATTACKERS : DEFENDERS;
  $('#prep-picker').innerHTML = `<small>${t('lobby.prepPick')}</small><div class="ops">` + pool.map((o) => `<button data-op="${o}" class="op ${o === me!.operator ? 'on' : ''}"><span class="badge" style="background:${OPERATORS[o].cloth}">${esc(OPERATORS[o].name.slice(0, 2).toUpperCase())}</span>${OPERATORS[o].name}<small>${t(`role.${OPERATORS[o].roles?.[0] ?? 'support'}`)}</small></button>`).join('') + '</div>';
}
$('#prep-picker').addEventListener('click', (e) => {
  const op = (e.target as HTMLElement).closest<HTMLElement>('button[data-op]')?.dataset.op;
  if (op && game.room) game.setLoadout(game.room.selfId, { operator: op });
});

/* ================================================================ pointer lock / cursor state machine
 *  playing ──Esc──▶ paused (cursor) ──Resume/click──▶ playing
 *  playing ──death · round end · result · lobby · menu──▶ cursor free, no pause screen
 *  new round / respawn ──▶ "click to take control" until the next click or key
 */
let userPaused = false;
let autoUnlock = false;
const modalOpen = () => isShown('#settings') || isShown('#agent-modal');
document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement;
  if (locked) { userPaused = false; if (isShown('#pause')) screen(null); }
  else if (!autoUnlock && game.wantsPointer() && !modalOpen()) pause();
  autoUnlock = false;
  syncCursor();
});
function pause() {
  userPaused = true;
  screen('#pause');
  if (lastState && game.room) renderPrepPicker(lastState, game.room.selfId);
}
function resume() {
  userPaused = false;
  screen(null);
  game.input.lock();
}
function releasePointer() {
  if (!document.pointerLockElement) return;
  autoUnlock = true;
  game.input.unlock();
}
function syncCursor() {
  const want = game.wantsPointer() && !userPaused && !modalOpen();
  const locked = !!document.pointerLockElement;
  if (!want && locked && !userPaused) releasePointer();
  show('#click-to-play', want && !locked);
  game.paused = game.mode === 'th' && (userPaused || modalOpen()) && game.wantsPointer();
  game.input.capturing = game.mode !== 'menu' && (locked || want);
}
window.setInterval(syncCursor, 100);
game.input.onGesture = () => { if (game.wantsPointer() && !userPaused && !modalOpen() && !document.pointerLockElement) game.input.lock(); };
$('#click-to-play').addEventListener('mousedown', () => game.input.lock());
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (modalOpen()) { closeModals(); return; }
  if (isShown('#help-overlay')) { show('#help-overlay', false); return; }
  if (document.pointerLockElement && game.wantsPointer()) { releasePointer(); pause(); }
});
window.addEventListener('beforeunload', (e) => {
  if (game.mode === 'menu') return;
  e.preventDefault();
  e.returnValue = '';
});
$('#pause-resume').onclick = resume;
$('#pause-settings').onclick = () => openSettings('general');
$('#pause-quit').onclick = () => { if (confirm(t('pause.leaveConfirm'))) game.quitToMenu(); };
game.onMatchStart = () => { userPaused = false; screen(null); };
game.onMenu = () => { userPaused = false; screen('#menu'); exitFullscreen(); };

function goFullscreen() {
  if (localStorage.getItem('r6.fslock') !== '0') void game.input.enterFullscreenLock();
}
function exitFullscreen() { game.input.exitFullscreenLock(); }

/* ================================================================ Terrorist Hunt result */
let resultTimer = 0;
game.onResult = (r) => {
  $('#res-title').textContent = t(r.win ? 'result.title.win' : 'result.title.lose');
  $('#res-title').className = r.win ? 'win' : 'lose';
  $('#res-reason').textContent = `${r.reason} · ${r.operator}`;
  $('#res-kills').textContent = String(r.kills);
  const sec = Math.round(r.time);
  $('#res-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('#res-acc').textContent = `${r.accuracy}%`;
  $('#res-hs').textContent = String(r.headshots);
  clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => { if (game.mode === 'th') { releasePointer(); screen('#th-result'); } }, 2200);
};
$('#th-restart').onclick = () => { screen(null); game.restartTH(); };
$('#th-change').onclick = () => { game.quitToMenu(); screen('#th-setup'); };
$('#th-menu').onclick = () => game.quitToMenu();

/* ================================================================ F1 help: the full keymap */
function renderHelp() {
  const groups = ['move', 'combat', 'gear', 'ui'] as const;
  const b = game.input.binds;
  $('#help-overlay').innerHTML = `<h3>${t('menu.controls')} <small>${t('help.close', b.cap('help'))}</small></h3><div class="help-cols">` + groups.map((g) => `<div><h4>${t(`key.group.${g}`)}</h4>${ACTIONS.filter((a) => a.group === g && (!a.qa || QA)).map((a) => `<div class="kr"><kbd>${esc(codeLabel(b.binds[a.id][0]))}</kbd>${b.binds[a.id][1] ? `<kbd>${esc(codeLabel(b.binds[a.id][1]))}</kbd>` : ''}<span>${esc(t(`key.${a.id}`))}</span></div>`).join('')}</div>`).join('') + `</div><p>${esc(t('help.context'))}</p><p>${esc(t('help.rappel'))}</p><p>${esc(t('help.walls'))}</p>`;
}
game.onHelp = () => { renderHelp(); show('#help-overlay', !isShown('#help-overlay')); };

/* ================================================================ settings */
const sens = $<HTMLInputElement>('#set-sens');
const adsS = $<HTMLInputElement>('#set-ads');
const inv = $<HTMLInputElement>('#set-invert');
const fov = $<HTMLInputElement>('#set-fov');
const qual = $<HTMLSelectElement>('#set-quality');
const vol = $<HTMLInputElement>('#set-vol');
const fsl = $<HTMLInputElement>('#set-fslock');
function loadSettings() {
  sens.value = localStorage.getItem('r6.sens') ?? sens.value;
  adsS.value = localStorage.getItem('r6.adsSens') ?? adsS.value;
  inv.checked = localStorage.getItem('r6.invertY') === '1';
  fov.value = localStorage.getItem('r6.fov') ?? fov.value;
  qual.value = localStorage.getItem('r6.quality') ?? qual.value;
  vol.value = localStorage.getItem('r6.vol') ?? vol.value;
  fsl.checked = localStorage.getItem('r6.fslock') !== '0';
  const P = game.input.binds.prefs;
  $<HTMLSelectElement>('#pref-crouch').value = P.crouch;
  $<HTMLSelectElement>('#pref-lean').value = P.lean;
  $<HTMLSelectElement>('#pref-ads').value = P.ads;
}
function applySettings() {
  game.input.sensitivity = Number(sens.value) / 1000;
  game.input.adsSensMul = Number(adsS.value);
  game.input.invertY = inv.checked;
  game.fov = Number(fov.value);
  game.audio.volume = Number(vol.value);
  $('#set-sens-v').textContent = sens.value;
  $('#set-ads-v').textContent = `×${adsS.value}`;
  $('#set-fov-v').textContent = `${fov.value}°`;
  $('#set-vol-v').textContent = `${Math.round(Number(vol.value) * 100)}%`;
  localStorage.setItem('r6.sens', sens.value);
  localStorage.setItem('r6.adsSens', adsS.value);
  localStorage.setItem('r6.invertY', inv.checked ? '1' : '0');
  localStorage.setItem('r6.fov', fov.value);
  localStorage.setItem('r6.quality', qual.value);
  localStorage.setItem('r6.vol', vol.value);
  localStorage.setItem('r6.fslock', fsl.checked ? '1' : '0');
}
for (const el of [sens, adsS, fov, vol]) el.addEventListener('input', applySettings);
for (const el of [inv, fsl]) el.addEventListener('change', applySettings);
qual.addEventListener('change', () => { applySettings(); localStorage.setItem('r6.qualityManual', '1'); game.autoQuality = false; game.setQuality(qual.value as 'high'); });
$<HTMLSelectElement>('#set-lang').addEventListener('change', (e) => setLang((e.target as HTMLSelectElement).value as Lang));
for (const k of ['crouch', 'lean', 'ads'] as const) {
  $<HTMLSelectElement>(`#pref-${k}`).addEventListener('change', (e) => {
    game.input.binds.prefs[k] = (e.target as HTMLSelectElement).value as 'hold';
    game.input.binds.save();
    game.input.resetStance();
  });
}

function openSettings(tab: 'general' | 'controls' | 'video') {
  releasePointer();
  setTab(tab);
  renderBinds();
  show('#settings', true);
}
function setTab(tab: string) {
  document.querySelectorAll<HTMLElement>('#set-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('.set-tab').forEach((x) => x.classList.toggle('hidden', x.id !== `set-${tab}`));
}
$('#set-tabs').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-tab]'); if (b) setTab(b.dataset.tab!); });
function closeModals() {
  stopRebind();
  show('#settings', false);
  show('#agent-modal', false);
  clearInterval(liveTimer);
}
document.querySelectorAll<HTMLElement>('#settings [data-close]').forEach((b) => (b.onclick = closeModals));
$('#settings').addEventListener('mousedown', (e) => { if (e.target === $('#settings') && !rebinding) closeModals(); });

/* key rebinding: click a slot, press a key / mouse button (Esc cancels, Backspace clears) */
let rebinding: { action: Action; slot: 0 | 1; el: HTMLElement } | null = null;
function renderBinds() {
  const b = game.input.binds;
  $('#binds').innerHTML = (['move', 'combat', 'gear', 'ui'] as const).map((g) => `<h4>${t(`key.group.${g}`)}</h4>` + ACTIONS.filter((a) => a.group === g && (!a.qa || QA)).map((a) => `<div class="bind-row"><span>${esc(t(`key.${a.id}`))}</span>${[0, 1].map((i) => `<button class="kb" data-action="${a.id}" data-slot="${i}">${esc(codeLabel(b.binds[a.id][i]))}</button>`).join('')}</div>`).join('')).join('');
}
$('#binds').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button.kb');
  if (!el || rebinding) return;
  rebinding = { action: el.dataset.action as Action, slot: Number(el.dataset.slot) as 0 | 1, el };
  el.textContent = t('set.pressKey');
  el.classList.add('waiting');
});
function stopRebind() { rebinding = null; renderBinds(); renderHelp(); }
function commitBind(code: string | null) {
  if (!rebinding) return;
  const lost = game.input.binds.set(rebinding.action, rebinding.slot, code);
  if (lost) game.onToast(t('set.conflict', t(`key.${lost}`)));
  stopRebind();
  renderOps();
}
window.addEventListener('keydown', (e) => {
  if (!rebinding) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code === 'Escape') { stopRebind(); return; }
  if (e.code === 'Backspace' || e.code === 'Delete') { commitBind(null); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || /^(Control|Meta|Alt|OS)/.test(e.code)) { game.onToast(t('set.noModifiers')); return; }
  commitBind(e.code);
}, true);
window.addEventListener('mousedown', (e) => {
  if (!rebinding) return;
  if (!(e.target as HTMLElement).closest('#binds')) { stopRebind(); return; }
  e.preventDefault();
  e.stopImmediatePropagation();
  commitBind(`Mouse${e.button}`);
}, true);
$('#binds').addEventListener('contextmenu', (e) => e.preventDefault());
$('#binds-reset').onclick = () => { game.input.binds.reset(); loadSettings(); renderBinds(); renderHelp(); };

/* ================================================================ WebMCP guide modal */
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
  releasePointer();
  show('#agent-modal', true);
  $('#tab-guide').innerHTML = mdToHtml(agentContext);
  $('#tab-schema').textContent = JSON.stringify({ action: ACTION_SCHEMA, observation: OBSERVATION_SCHEMA, tools: TOOLS }, null, 2);
  $('#tab-snippet').textContent = SNIPPET;
  clearInterval(liveTimer);
  liveTimer = window.setInterval(() => { $('#tab-live').textContent = JSON.stringify(window.webmcp?.observe('self') ?? {}, null, 2); }, 500);
}
document.querySelectorAll<HTMLElement>('[data-guide]').forEach((b) => (b.onclick = openGuide));
$('#agent-modal-close').onclick = closeModals;
$('#agent-modal .tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#agent-modal .tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('#agent-modal .tab').forEach((x) => x.classList.toggle('hidden', x.id !== `tab-${b.dataset.tab}`));
});
const SNIPPET = `// 1) join a room (or start Terrorist Hunt)
await webmcp.join({ nickname: 'Claude-Agent', roomCode: 'R6-8492' });
// or: webmcp.startTerroristHunt({ difficulty: 'Normal', mission: 'random' });
// or open  https://<site>/?room=R6-8492&nick=Claude-Agent&agent=1  in a (headless) browser

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

// Playwright / external process (local or cloud): see tools/agents/webmcp-playwright-agent.mjs`;

/* ================================================================ boot */
declare global { interface Window { webmcp: { observe: (id?: string) => unknown } } }
loadSettings();
relabel();
const LOAD_KEYS = ['menu.loadPhysics', 'menu.loadHouse', 'menu.loadSuburb', 'menu.loadNav', 'menu.ready'];
let loadStep = 0;
game.init(() => {
  $('#loading-msg').textContent = t(LOAD_KEYS[Math.min(loadStep++, LOAD_KEYS.length - 1)]);
  $('#loading-bar').style.width = `${Math.min(100, loadStep * 22)}%`;
}).then(() => {
  applySettings();
  game.autoQuality = localStorage.getItem('r6.qualityManual') !== '1';
  if (qual.value !== 'high') game.setQuality(qual.value as 'high');
  show('#loading', false);
  // URL automation (agents, cloud runners): ?room=R6-1234&nick=Agent&agent=1  |  ?th=1&difficulty=Hard&mission=bomb
  const q = new URLSearchParams(location.search);
  if (q.get('lang') === 'ko' || q.get('lang') === 'en') setLang(q.get('lang') as Lang);
  if (q.get('room')) void join(q.get('nick') ?? undefined, q.get('room')!, (q.get('mode') as 'local') ?? 'online', q.get('agent') === '1');
  else if (q.get('th')) {
    thAgents = Number(q.get('agents') ?? 0);
    if (q.get('difficulty')) $<HTMLSelectElement>('#th-diff').value = q.get('difficulty')!;
    if (q.get('mission')) $<HTMLSelectElement>('#th-mission').value = q.get('mission')!;
    if (q.get('tod')) $<HTMLSelectElement>('#th-tod').value = q.get('tod')!;
    if (q.get('op')) thOperator = q.get('op')!;
    startTH();
  } else screen('#menu');
}).catch((err) => {
  console.error(err);
  $('#loading-msg').textContent = t('menu.failed', (err as Error).message);
});
