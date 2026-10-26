import * as THREE from 'three';
import { t } from './i18n.ts';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** a world point projected to the screen (or pinned to the edge when off-screen) */
export interface HudMarker {
  x: number;
  y: number;
  kind: 'spot' | 'ping' | 'obj' | 'iq' | 'mate';
  label: string;
  dist: number;
  off: boolean;
}
export interface HudMate { name: string; op: string; hp: number; alive: boolean; me: boolean; agent: boolean; color: string }
export interface HudGadget { cap: string; name: string; left: string; active: boolean }
export interface HudHint { cap: string; label: string }

export interface HudState {
  hp: number;
  operator: string;
  unit: string;
  opColor: string;
  weapon: string;
  mag: number;
  magMax: number;
  reserve: number;
  reloading: boolean;
  reloadCap: string;
  slot: number;
  gadgets: HudGadget[];
  location: string;
  heading: number;
  phase: string;
  timer: number;
  urgent: boolean;
  objective: string;
  objectiveProgress: number;
  site: string;
  score: string;
  prompt: string;
  progress: number;
  spread: number;
  ads: number;
  stance: string;
  flags: string;
  view: 'body' | 'drone' | 'cam';
  viewTitle: string;
  viewHelp: string;
  droneJammed: boolean;
  scanning: { bearing: number; dist: number; vertical: string }[];
  dead: boolean;
  spectating: string;
  markers: HudMarker[];
  team: HudMate[];
  hints: HudHint[];
}

/** DOM heads-up display (crosshair, ammo, HP, compass, objective, prompts, killfeed, radar, world markers). */
export class Hud {
  private root = $('#hud');
  private hit = $('#hitmarker');
  private dmgDirs = $('#damage-dirs');
  private feed = $('#killfeed');
  private banner = $('#banner');
  private bannerT = 0;
  private compassStrip = $('#compass-strip');
  private radar = $('#radar');
  private markerBox = $('#markers');
  private markerPool: HTMLElement[] = [];
  private last: Record<string, string> = {};

  constructor() {
    this.buildCompass();
  }

  buildCompass() {
    const labels = t('hud.compass').split(',');
    let html = '';
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const deg = d + rep * 360;
        const lab = d % 45 === 0 ? labels[d / 45] : '';
        html += `<span class="tick ${lab ? 'major' : ''}" style="left:${deg * 4}px">${lab || '|'}</span>`;
      }
    }
    this.compassStrip.innerHTML = html;
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  /** only touch the DOM when a value changed (the HUD updates every frame) */
  private set(sel: string, text: string, html = false) {
    if (this.last[sel] === text) return;
    this.last[sel] = text;
    if (html) $(sel).innerHTML = text;
    else $(sel).textContent = text;
  }

  update(s: HudState, dt: number) {
    const body = s.view === 'body';
    this.root.dataset.view = s.view;
    $('#hp-fill').style.width = `${Math.max(0, s.hp)}%`;
    this.set('#hp-num', String(Math.max(0, Math.round(s.hp))));
    $('#hp-fill').classList.toggle('low', s.hp < 30);
    this.set('#op-name', s.operator);
    this.set('#op-unit', s.unit);
    $('#op-badge').style.background = s.opColor;
    this.set('#weapon-name', s.weapon);
    const gun = s.slot < 2;
    this.set('#ammo', gun ? String(s.mag) : '');
    this.set('#reserve', gun ? `/ ${s.reserve}` : '');
    $('#ammo').classList.toggle('low', gun && s.mag <= Math.max(1, Math.floor(s.magMax * 0.25)));
    const rh = $('#reload-hint');
    rh.classList.toggle('hidden', !(s.reloading || (gun && s.mag === 0)));
    this.set('#reload-hint', s.reloading ? t('hud.reloading') : t('hud.reloadHint', s.reloadCap));
    this.set('#gadgets', s.gadgets.map((g) => `<div class="gd ${g.active ? 'active' : ''}"><kbd>${esc(g.cap)}</kbd><span class="gn">${esc(g.name)}</span><b>${esc(g.left)}</b></div>`).join(''), true);
    this.set('#location', s.location);
    this.set('#stance', s.stance);
    this.set('#phase', s.phase);
    const tm = Math.max(0, Math.ceil(s.timer));
    this.set('#timer', `${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, '0')}`);
    $('#timer').classList.toggle('urgent', s.urgent);
    this.set('#objective', s.objective);
    this.set('#site', s.site);
    $('#obj-progress').style.width = `${Math.round(s.objectiveProgress * 100)}%`;
    $('#obj-progress-wrap').classList.toggle('hidden', s.objectiveProgress <= 0);
    this.set('#score', s.score);
    this.set('#extra', s.flags);
    const prompt = $('#prompt');
    this.set('#prompt', s.prompt);
    prompt.classList.toggle('hidden', !s.prompt);
    $('#prompt-progress').style.width = `${Math.round(s.progress * 100)}%`;
    $('#prompt-progress-wrap').classList.toggle('hidden', s.progress <= 0);
    // compass: 4 px per degree
    this.compassStrip.style.transform = `translateX(${-s.heading * 4}px)`;
    this.set('#heading', `${Math.round(s.heading)}°`);
    // crosshair
    const gap = 4 + s.spread * 7;
    const ch = $('#crosshair');
    ch.style.setProperty('--gap', `${gap}px`);
    ch.style.opacity = body ? String(1 - s.ads) : '0';
    // drone / camera feed
    $('#feed-overlay').classList.toggle('hidden', body);
    this.set('#feed-title', s.viewTitle);
    this.set('#feed-help', s.viewHelp);
    $('#drone-jammed').classList.toggle('hidden', !s.droneJammed);
    $('#dead-overlay').classList.toggle('hidden', !s.dead);
    this.set('#spectating', s.spectating);
    // team roster
    this.set('#team', s.team.map((m) => `<div class="mate ${m.alive ? '' : 'dead'} ${m.me ? 'me' : ''}"><i style="background:${m.color}"></i><span class="mn">${esc(m.name)}${m.agent ? ' 🤖' : ''}</span><span class="mo">${esc(m.op)}</span><span class="mh"><span style="width:${Math.max(0, m.hp)}%"></span></span></div>`).join(''), true);
    // compact, context-sensitive key hints
    this.set('#hints', s.hints.map((h) => `<span><kbd>${esc(h.cap)}</kbd>${esc(h.label)}</span>`).join(''), true);
    // world markers
    this.markers(s.markers);
    // heartbeat radar
    this.radar.classList.toggle('hidden', !s.scanning.length && !s.flags.includes(t('hud.scan')));
    this.radar.querySelectorAll('.blip').forEach((b) => b.remove());
    for (const b of s.scanning) {
      const el = document.createElement('div');
      el.className = `blip ${b.vertical !== 'Same_Floor' ? 'other-floor' : ''}`;
      const r = (b.dist / 9) * 70;
      const a = THREE.MathUtils.degToRad(b.bearing);
      el.style.left = `${80 + Math.sin(a) * r}px`;
      el.style.top = `${80 - Math.cos(a) * r}px`;
      this.radar.appendChild(el);
    }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.add('hidden'); }
  }

  private markers(list: HudMarker[]) {
    while (this.markerPool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = '<i></i><span></span>';
      this.markerBox.appendChild(el);
      this.markerPool.push(el);
    }
    this.markerPool.forEach((el, i) => {
      const m = list[i];
      if (!m) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.className = `mk ${m.kind} ${m.off ? 'off' : ''}`;
      el.style.transform = `translate(${m.x.toFixed(0)}px, ${m.y.toFixed(0)}px)`;
      const txt = m.label ? `${m.label} · ${Math.round(m.dist)}m` : `${Math.round(m.dist)}m`;
      const span = el.lastElementChild as HTMLElement;
      if (span.textContent !== txt) span.textContent = txt;
    });
  }

  hitMarker(head: boolean, kill: boolean) {
    this.hit.classList.remove('show', 'head', 'kill');
    void this.hit.offsetWidth;
    this.hit.classList.add('show');
    if (head) this.hit.classList.add('head');
    if (kill) this.hit.classList.add('kill');
  }

  damageFrom(bearingDeg: number) {
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.style.transform = `rotate(${bearingDeg}deg)`;
    this.dmgDirs.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  kill(killer: string, victim: string, head: boolean, weapon: string, mine: boolean, killerTeam: 'ally' | 'enemy' = 'enemy') {
    const el = document.createElement('div');
    el.className = `kf ${mine ? 'mine' : ''} ${killerTeam}`;
    el.innerHTML = `<b class="k">${esc(killer)}</b> <span class="w">${esc(weapon)}${head ? ' <i class="hs">◎</i>' : ''}</span> <b class="v">${esc(victim)}</b>`;
    this.feed.prepend(el);
    setTimeout(() => el.remove(), 6000);
    while (this.feed.children.length > 6) this.feed.lastChild?.remove();
  }

  showBanner(title: string, sub = '', secs = 4) {
    this.banner.innerHTML = `<div class="b-title">${esc(title)}</div><div class="b-sub">${esc(sub)}</div>`;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    this.bannerT = secs;
  }

  hideBanner() { this.banner.classList.add('hidden'); this.bannerT = 0; }

  scoreboard(on: boolean, html = '') {
    const sb = $('#scoreboard');
    sb.classList.toggle('hidden', !on);
    if (on && this.last['#scoreboard'] !== html) { this.last['#scoreboard'] = html; sb.innerHTML = html; }
  }

  /** invalidate cached strings (language switch) */
  refresh() { this.last = {}; this.buildCompass(); }
}

export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
