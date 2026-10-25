import * as THREE from 'three';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface HudState {
  hp: number;
  operator: string;
  weapon: string;
  mag: number;
  reserve: number;
  reloading: boolean;
  gadget: string;
  gadgetLeft: number | string;
  universal: string;
  universalLeft: number | string;
  reinforcements: number;
  slot: number;
  location: string;
  heading: number;
  phase: string;
  timer: number;
  objective: string;
  objectiveProgress: number;
  site: string;
  prompt: string;
  progress: number;
  spread: number;
  ads: number;
  stance: string;
  lean: number;
  score: string;
  extra: string;
  drone: boolean;
  droneJammed: boolean;
  scanning: { bearing: number; dist: number; vertical: string }[];
  dead: boolean;
  spectating: string;
}

/** DOM heads-up display (crosshair, ammo, HP, compass, objective, prompts, killfeed, radar). */
export class Hud {
  private root = $('#hud');
  private hit = $('#hitmarker');
  private dmgDirs = $('#damage-dirs');
  private feed = $('#killfeed');
  private banner = $('#banner');
  private bannerT = 0;
  private compassStrip = $('#compass-strip');
  private radar = $('#radar');

  constructor() {
    // compass ticks
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
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

  update(s: HudState, dt: number) {
    $('#hp-fill').style.width = `${Math.max(0, s.hp)}%`;
    $('#hp-num').textContent = String(Math.max(0, Math.round(s.hp)));
    $('#hp-fill').classList.toggle('low', s.hp < 30);
    $('#op-name').textContent = s.operator;
    $('#weapon-name').textContent = s.weapon;
    $('#ammo').textContent = s.slot < 2 ? `${s.mag}` : '';
    $('#reserve').textContent = s.slot < 2 ? `/ ${s.reserve}` : '';
    $('#reload-hint').classList.toggle('hidden', !(s.reloading || (s.slot < 2 && s.mag === 0)));
    $('#reload-hint').textContent = s.reloading ? 'RELOADING' : 'RELOAD [R]';
    $('#gadget-1').textContent = `[3] ${s.gadget} ×${s.gadgetLeft}`;
    $('#gadget-2').textContent = `[4] ${s.universal} ${s.universalLeft === '' ? '' : `×${s.universalLeft}`}${s.reinforcements ? ` · reinforce ×${s.reinforcements}` : ''}`;
    $('#gadget-1').classList.toggle('active', s.slot === 2);
    $('#gadget-2').classList.toggle('active', s.slot === 3);
    $('#location').textContent = s.location;
    $('#stance').textContent = `${s.stance}${s.lean < -0.3 ? ' · LEAN Q' : s.lean > 0.3 ? ' · LEAN E' : ''}`;
    $('#phase').textContent = s.phase;
    const t = Math.max(0, Math.ceil(s.timer));
    $('#timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('#timer').classList.toggle('urgent', t <= 30 && s.phase.startsWith('ACTION'));
    $('#objective').textContent = s.objective;
    $('#site').textContent = s.site;
    $('#obj-progress').style.width = `${Math.round(s.objectiveProgress * 100)}%`;
    $('#obj-progress-wrap').classList.toggle('hidden', s.objectiveProgress <= 0);
    $('#score').textContent = s.score;
    $('#extra').textContent = s.extra;
    const prompt = $('#prompt');
    prompt.textContent = s.prompt;
    prompt.classList.toggle('hidden', !s.prompt);
    $('#prompt-progress').style.width = `${Math.round(s.progress * 100)}%`;
    $('#prompt-progress-wrap').classList.toggle('hidden', s.progress <= 0);
    // compass: 4 px per degree
    this.compassStrip.style.transform = `translateX(${-s.heading * 4}px)`;
    $('#heading').textContent = `${Math.round(s.heading)}°`;
    // crosshair
    const gap = 4 + s.spread * 7;
    const ch = $('#crosshair');
    ch.style.setProperty('--gap', `${gap}px`);
    ch.style.opacity = String(1 - s.ads);
    $('#drone-overlay').classList.toggle('hidden', !s.drone);
    $('#drone-jammed').classList.toggle('hidden', !s.droneJammed);
    $('#dead-overlay').classList.toggle('hidden', !s.dead);
    $('#spectating').textContent = s.spectating;
    // heartbeat radar
    this.radar.classList.toggle('hidden', !s.scanning.length && !s.extra.includes('SCAN'));
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

  kill(killer: string, victim: string, head: boolean, weapon: string, mine: boolean) {
    const el = document.createElement('div');
    el.className = `kf ${mine ? 'mine' : ''}`;
    el.innerHTML = `<b>${esc(killer)}</b> <span class="w">${esc(weapon)}${head ? ' ☠' : ''}</span> <b>${esc(victim)}</b>`;
    this.feed.prepend(el);
    setTimeout(() => el.remove(), 6000);
    while (this.feed.children.length > 6) this.feed.lastChild?.remove();
  }

  showBanner(title: string, sub = '', secs = 4) {
    this.banner.innerHTML = `<div class="b-title">${esc(title)}</div><div class="b-sub">${esc(sub)}</div>`;
    this.banner.classList.remove('hidden');
    this.bannerT = secs;
  }

  scoreboard(on: boolean, html = '') {
    const sb = $('#scoreboard');
    sb.classList.toggle('hidden', !on);
    if (on) sb.innerHTML = html;
  }
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
