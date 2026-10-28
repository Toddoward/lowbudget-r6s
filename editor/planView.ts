import type { Ctx, EditorView } from './main.ts';
import type { Schema } from './form.ts';
import { files, schemaOf } from './store.ts';

/**
 * The House map from above, one floor at a time (or the grounds): floors, holes, stairs, rooms, walls with their
 * openings, hatches, props, cameras, spawn pads. Click to select (the inspector shows the element), drag to move,
 * arrows to nudge (Shift ×10), Delete to remove, Ctrl+D to duplicate; the toolbar adds props, walls and openings.
 * Saved files reload the game tab: walk the change there.
 */
type Rect = { x0: number; z0: number; x1: number; z1: number };
type Obj = Record<string, unknown>;
interface Wall { floor: number; run: 'x' | 'z'; c: number; from: number; to: number; tier: string; ext?: boolean; t?: number; openings?: { at: number; w: number; kind: string }[]; note?: string }
interface Prop { type: string; floor: number; x: number; z: number; size: [number, number, number]; color: string; note?: string }
type Level = -1 | 0 | 1 | 'roof' | 'out';
interface Sel { file: string; key: string; index: number; sub?: number; part?: 'from' | 'to' | 'body' }

const SNAP = 0.05;
const snap = (v: number, on = true) => (on ? Math.round(v / SNAP) * SNAP : Math.round(v * 1e4) / 1e4);
const W = 'maps/house/walls.json', F = 'maps/house/floors.json', S = 'maps/house/stairs.json', R = 'maps/house/rooms.json', SP = 'maps/house/spawns.json', PR = 'maps/house/props.json', M = 'maps/house/map.json';
const TIER: Record<string, string> = { solid: '#e6e0d6', soft: '#d77d5a', semi: '#d6b45a' };
const OPEN: Record<string, string> = { door: '#6ab0e0', exterior_door: '#4a7cf0', window: '#7fd6f7', french: '#9cc8ff', open_window: '#ffffff', arch: '#c8c8c8', shutter: '#9a9a9a', vent: '#8ff08f' };
const FLOORC: Record<string, string> = { concrete: '#353a40', wood: '#46392b', deck: '#56462f', roof: '#3f3434', hatch: '#5c4a30' };
const LEVELS: [Level, string][] = [[-1, 'B (지하)'], [0, '1F'], [1, '2F'], ['roof', '지붕'], ['out', '바깥 (스폰·카메라)']];

export class PlanView implements EditorView {
  private path = '';
  private level: Level = 0;
  private cx = 0;
  private cz = 0;
  private scale = 28;
  private sel: Sel | null = null;
  private drag: { x: number; z: number; moved: boolean } | null = null;
  private pan: { x: number; y: number; cx: number; cz: number } | null = null;
  private g: CanvasRenderingContext2D;
  private mouse = { x: 0, z: 0 };
  private snapOn = true;

  constructor(private ctx: Ctx) {
    const c = ctx.plan;
    this.g = c.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(c);
    c.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); const before = this.toWorld(e.offsetX, e.offsetY); this.scale = Math.min(400, Math.max(4, this.scale * k)); const after = this.toWorld(e.offsetX, e.offsetY); this.cx += before.x - after.x; this.cz += before.z - after.z; this.draw(); }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.key(e));
  }

  /* ------------------------------------------------------------- data access */
  private file<T = Obj>(p: string) { return files[p] as unknown as T; }
  private floorY(l: Level) { const fl = this.file<{ floors: Record<string, { y: number }> }>(M).floors; return l === 'roof' ? 7 : l === 'out' ? 0 : fl[String(l)].y; }
  private walls() { return this.file<{ walls: Wall[] }>(W).walls; }
  private props() { return this.file<{ props: Prop[] }>(PR).props; }
  private arr(s: Sel): Obj[] { return (this.file<Obj>(s.file)[s.key] as Obj[]); }
  private item(s: Sel): Obj { return this.arr(s)[s.index]; }
  /** the storey a height belongs to (B below 1F, 1F below 2F, else 2F) */
  private levelOf(y: number): Level { const fl = this.file<{ floors: Record<string, { y: number }> }>(M).floors; return y < fl['0'].y ? -1 : y < fl['1'].y ? 0 : 1; }
  private onLevel(y0: number, y1 = y0) { const y = this.floorY(this.level); return this.level === 'out' ? false : y1 >= y - 0.6 && y0 < y + 3.2; }

  open(path: string) {
    this.path = path;
    this.sel = null;
    const pre: Record<string, Level> = { 'maps/house/spawns.json': 'out' };
    if (pre[path] !== undefined) this.level = pre[path];
    this.toolbar();
    this.ctx.hint.textContent = '클릭: 선택 · 드래그: 이동 (벽은 끝을 잡으면 길이) · 휠: 확대 · 오른쪽 드래그: 화면 이동 · 화살표: 0.05 m (Shift ×10) · Delete: 삭제 · Ctrl+D: 복제 · 저장하면 열린 게임 탭이 새로고침됩니다';
    this.draw();
  }
  close() { this.sel = null; }
  refresh() { this.draw(); }

  private toolbar() {
    const tb = this.ctx.toolbar;
    tb.innerHTML = '';
    for (const [l, name] of LEVELS) {
      const b = document.createElement('button');
      b.textContent = name;
      b.className = this.level === l ? 'on' : '';
      b.onclick = () => { this.level = l; this.sel = null; this.toolbar(); this.draw(); this.ctx.inspect(); };
      tb.append(b);
    }
    const add = (name: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = name; b.onclick = fn; tb.append(b); };
    if (typeof this.level === 'number') {
      add('＋ 소품', () => this.addProp());
      add('＋ 벽', () => this.addWall());
      add('＋ 문·창 (선택한 벽에)', () => this.addOpening());
    }
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.snapOn;
    cb.onchange = () => { this.snapOn = cb.checked; };
    l.append(cb, ` ${SNAP * 100} cm 격자에 맞춤`);
    tb.append(l);
  }

  /* ------------------------------------------------------------- view transform */
  private toScreen(x: number, z: number) { const c = this.ctx.plan; return { x: (x - this.cx) * this.scale + c.clientWidth / 2, y: (z - this.cz) * this.scale + c.clientHeight / 2 }; }
  private toWorld(sx: number, sy: number) { const c = this.ctx.plan; return { x: (sx - c.clientWidth / 2) / this.scale + this.cx, z: (sy - c.clientHeight / 2) / this.scale + this.cz }; }

  /* ------------------------------------------------------------- drawing */
  draw() {
    const c = this.ctx.plan;
    if (c.style.display === 'none') return;
    const dpr = devicePixelRatio;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, c.clientWidth, c.clientHeight);
    this.grid();
    const L = this.level;
    const rect = (r: Rect, fill?: string, stroke?: string, dash?: number[]) => {
      const a = this.toScreen(Math.min(r.x0, r.x1), Math.min(r.z0, r.z1)), b = this.toScreen(Math.max(r.x0, r.x1), Math.max(r.z0, r.z1));
      if (fill) { g.fillStyle = fill; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
      if (stroke) { g.setLineDash(dash ?? []); g.strokeStyle = stroke; g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); g.setLineDash([]); }
    };
    const isSel = (file: string, key: string, i: number) => this.sel?.file === file && this.sel.key === key && this.sel.index === i;
    const map = this.file<{ houseRect: Rect; bounds: Rect; driveway: Rect }>(M);
    if (L === 'out') {
      rect(map.bounds, undefined, '#3a4652', [6, 4]);
      rect(map.houseRect, '#2a2f35', '#58626c');
      rect(map.driveway, '#262b30', '#4b5560', [3, 3]);
      const sp = this.file<{ spawns: { label: string; center: [number, number, number]; radius: number; extract: Rect }[]; cameras: { label: string; pos: [number, number, number]; yawDeg: number; exterior: boolean }[] }>(SP);
      sp.spawns.forEach((s, i) => {
        rect(s.extract, 'rgba(90,169,230,.08)', isSel(SP, 'spawns', i) ? '#5ae0ff' : '#3c6d93', [5, 4]);
        const p = this.toScreen(s.center[0], s.center[2]);
        g.beginPath(); g.arc(p.x, p.y, Math.max(4, s.radius * this.scale), 0, Math.PI * 2);
        g.fillStyle = isSel(SP, 'spawns', i) ? '#5ae0ff' : '#5aa9e6'; g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
        this.text(s.label, p.x, p.y - Math.max(8, s.radius * this.scale) - 4, '#cfe6f7');
      });
      sp.cameras.forEach((cam, i) => { if (cam.exterior) this.camera(cam.pos, cam.yawDeg, cam.label, isSel(SP, 'cameras', i)); });
      return;
    }
    const y = this.floorY(L);
    // floors (slabs at this level) and their holes
    const fl = this.file<{ floors: { y: number; rect: Rect; kind: string; holes?: (Rect | string)[]; label?: string }[]; hatches: { rect: Rect; y: number; label: string }[]; roofs: { rect: Rect; id: string }[] }>(F);
    fl.floors.forEach((f, i) => {
      if (Math.abs(f.y - y) > 0.6) return;
      rect(f.rect, FLOORC[f.kind] ?? '#333', isSel(F, 'floors', i) ? '#5ae0ff' : '#2b3036');
      for (const h of f.holes ?? []) if (typeof h !== 'string') rect(h, '#0b0d0f');
    });
    if (L === 'roof') fl.roofs.forEach((r, i) => { rect(r.rect, 'rgba(120,80,70,.25)', isSel(F, 'roofs', i) ? '#5ae0ff' : '#8a5a50'); const p = this.toScreen((r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2); this.text(r.id, p.x, p.y, '#d9b0a8'); });
    const st = this.file<{ stairs: { rect: Rect; axis: 'x' | 'z'; yMin: number; yMax: number; label: string; steps?: number }[]; holes: Record<string, Rect>; landings: { rect: Rect; y: number }[] }>(S);
    if (L === 1) for (const h of Object.values(st.holes)) rect(h, '#0b0d0f');
    fl.floors.forEach((f) => { if (Math.abs(f.y - y) <= 0.6) for (const h of f.holes ?? []) if (typeof h === 'string') { const r = h.startsWith('stairs:') ? st.holes[h.slice(7)] : fl.hatches.find((x) => (x as unknown as { id: string }).id === h)?.rect; if (r) rect(r, '#0b0d0f'); } });
    st.landings.forEach((l, i) => { if (this.onLevel(l.y)) rect(l.rect, '#4d4030', isSel(S, 'landings', i) ? '#5ae0ff' : '#6d5a40'); });
    st.stairs.forEach((s, i) => { if (this.onLevel(Math.min(s.yMin, s.yMax), Math.max(s.yMin, s.yMax))) this.stair(s, isSel(S, 'stairs', i)); });
    fl.hatches.forEach((h, i) => { if (Math.abs(h.y - y) < 0.6) rect(h.rect, '#6a5030', isSel(F, 'hatches', i) ? '#5ae0ff' : '#e0b060'); });
    // rooms
    const rooms = this.file<{ rooms: { name: string; floor: number; rects: Rect[]; spot: [number, number] }[] }>(R).rooms;
    if (typeof L === 'number') rooms.forEach((r, i) => {
      if (r.floor !== L) return;
      for (const q of r.rects) rect(q, undefined, isSel(R, 'rooms', i) ? '#5ae0ff' : 'rgba(170,190,210,.35)', [4, 4]);
      const big = r.rects.reduce((a, b) => (Math.abs((b.x1 - b.x0) * (b.z1 - b.z0)) > Math.abs((a.x1 - a.x0) * (a.z1 - a.z0)) ? b : a));
      const p = this.toScreen((big.x0 + big.x1) / 2, (big.z0 + big.z1) / 2);
      this.text(r.name, p.x, p.y, 'rgba(200,215,230,.75)');
      const s = this.toScreen(r.spot[0], r.spot[1]);
      g.fillStyle = '#e0c060'; g.fillRect(s.x - 2, s.y - 2, 4, 4);
    });
    // props
    if (typeof L === 'number') this.props().forEach((p, i) => {
      if (p.floor !== L) return;
      const r = { x0: p.x - p.size[0] / 2, z0: p.z - p.size[2] / 2, x1: p.x + p.size[0] / 2, z1: p.z + p.size[2] / 2 };
      const on = isSel(PR, 'props', i);
      rect(r, p.color, on ? '#5ae0ff' : 'rgba(0,0,0,.6)');
      if (on || this.scale > 45) { const s = this.toScreen(p.x, p.z); this.text(p.type, s.x, s.y, on ? '#fff' : 'rgba(255,255,255,.7)', 10); }
    });
    // walls (+ their openings)
    if (typeof L === 'number') {
      this.walls().forEach((w, i) => { if (w.floor === L) this.wall(w, isSel(W, 'walls', i), this.sel?.file === W && this.sel.index === i ? this.sel.sub : undefined); });
      const diag = this.file<{ diagonal: { floor: number; a: [number, number]; b: [number, number] }[] }>(W).diagonal;
      for (const d of diag) if (d.floor === L) { const a = this.toScreen(d.a[0], d.a[1]), b = this.toScreen(d.b[0], d.b[1]); g.strokeStyle = TIER.solid; g.lineWidth = Math.max(2, 0.3 * this.scale); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.lineWidth = 1; }
      const cams = this.file<{ cameras: { label: string; pos: [number, number, number]; yawDeg: number; exterior: boolean }[] }>(SP).cameras;
      cams.forEach((cam, i) => { if (!cam.exterior && this.levelOf(cam.pos[1] - 0.05) === L) this.camera(cam.pos, cam.yawDeg, cam.label, isSel(SP, 'cameras', i)); });
    }
    // cursor read-out
    g.fillStyle = '#8b96a1';
    g.font = '11px system-ui';
    g.textAlign = 'right';
    g.fillText(`x ${this.mouse.x.toFixed(2)}  z ${this.mouse.z.toFixed(2)}  (m)`, c.clientWidth - 10, 112);
    g.textAlign = 'left';
  }

  private grid() {
    const g = this.g, c = this.ctx.plan;
    const a = this.toWorld(0, 0), b = this.toWorld(c.clientWidth, c.clientHeight);
    for (const [step, col] of [[1, '#1c2025'], [5, '#252b31']] as const) {
      if (step * this.scale < 6) continue;
      g.strokeStyle = col;
      g.beginPath();
      for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) { const s = this.toScreen(x, 0); g.moveTo(s.x, 0); g.lineTo(s.x, c.clientHeight); }
      for (let z = Math.floor(a.z / step) * step; z <= b.z; z += step) { const s = this.toScreen(0, z); g.moveTo(0, s.y); g.lineTo(c.clientWidth, s.y); }
      g.stroke();
    }
    const o = this.toScreen(0, 0);
    g.strokeStyle = '#3d4a56';
    g.beginPath(); g.moveTo(o.x - 8, o.y); g.lineTo(o.x + 8, o.y); g.moveTo(o.x, o.y - 8); g.lineTo(o.x, o.y + 8); g.stroke();
    this.text('N ↑ (−Z)', c.clientWidth - 50, 60, '#8b96a1', 11);
  }

  private text(t: string, x: number, y: number, col: string, size = 11) {
    const g = this.g;
    g.font = `${size}px system-ui`;
    g.textAlign = 'center';
    g.fillStyle = col;
    g.fillText(t, x, y + size / 3);
    g.textAlign = 'left';
  }

  private wall(w: Wall, on: boolean, subSel?: number) {
    const g = this.g;
    const end = (v: number) => (w.run === 'x' ? this.toScreen(v, w.c) : this.toScreen(w.c, v));
    const a = end(w.from), b = end(w.to);
    g.lineCap = 'butt';
    g.strokeStyle = on ? '#5ae0ff' : TIER[w.tier] ?? '#aaa';
    g.lineWidth = Math.max(2, (w.t ?? (w.ext ? 0.3 : 0.2)) * this.scale);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    (w.openings ?? []).forEach((o, k) => {
      const p = end(o.at - o.w / 2), q = end(o.at + o.w / 2);
      g.strokeStyle = '#15181c';
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
      g.strokeStyle = subSel === k ? '#5ae0ff' : OPEN[o.kind] ?? '#fff';
      g.lineWidth = Math.max(2, 0.08 * this.scale);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
      g.lineWidth = Math.max(2, (w.t ?? (w.ext ? 0.3 : 0.2)) * this.scale);
    });
    g.lineWidth = 1;
    if (on) for (const p of [a, b]) { g.fillStyle = '#5ae0ff'; g.fillRect(p.x - 4, p.y - 4, 8, 8); }
  }

  private stair(s: { rect: Rect; axis: 'x' | 'z'; yMin: number; yMax: number; steps?: number }, on: boolean) {
    const g = this.g;
    const a = this.toScreen(s.rect.x0, s.rect.z0), b = this.toScreen(s.rect.x1, s.rect.z1);
    g.fillStyle = '#4a3f33';
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const n = s.steps ?? Math.max(2, Math.round(Math.abs(s.yMax - s.yMin) / 0.19));
    g.strokeStyle = '#7d6a52';
    g.beginPath();
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (s.axis === 'x') { const x = a.x + (b.x - a.x) * t; g.moveTo(x, a.y); g.lineTo(x, b.y); } else { const y = a.y + (b.y - a.y) * t; g.moveTo(a.x, y); g.lineTo(b.x, y); }
    }
    g.stroke();
    g.strokeStyle = on ? '#5ae0ff' : '#b49a76';
    g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    // arrow toward the top
    const up = s.yMax > s.yMin ? 1 : -1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const dx = s.axis === 'x' ? up * (b.x - a.x) * 0.35 : 0, dy = s.axis === 'z' ? up * (b.y - a.y) * 0.35 : 0;
    g.strokeStyle = '#f0d9a8';
    g.beginPath(); g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy); g.stroke();
    g.fillStyle = '#f0d9a8';
    g.beginPath(); g.arc(cx + dx, cy + dy, 3, 0, Math.PI * 2); g.fill();
  }

  private camera(pos: [number, number, number], yawDeg: number, label: string, on: boolean) {
    const g = this.g;
    const p = this.toScreen(pos[0], pos[2]);
    const yaw = (yawDeg * Math.PI) / 180;
    // the game's yaw: forward = (−sin yaw, −cos yaw)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    g.fillStyle = on ? '#5ae0ff' : '#e05a5a';
    g.beginPath();
    g.moveTo(p.x + fx * 14, p.y + fz * 14);
    g.lineTo(p.x - fz * 6, p.y + fx * 6);
    g.lineTo(p.x + fz * 6, p.y - fx * 6);
    g.fill();
    this.text(label, p.x, p.y + 16, '#e8b0b0', 10);
  }

  /* ------------------------------------------------------------- picking & editing */
  private pick(x: number, z: number): Sel | null {
    const L = this.level;
    const tol = 8 / this.scale;
    const inR = (r: Rect, pad = 0) => x >= Math.min(r.x0, r.x1) - pad && x <= Math.max(r.x0, r.x1) + pad && z >= Math.min(r.z0, r.z1) - pad && z <= Math.max(r.z0, r.z1) + pad;
    if (L === 'out') {
      const sp = this.file<{ spawns: { center: [number, number, number]; radius: number; extract: Rect }[]; cameras: { pos: [number, number, number]; exterior: boolean }[] }>(SP);
      const ci = sp.cameras.findIndex((c) => c.exterior && Math.hypot(c.pos[0] - x, c.pos[2] - z) < tol * 2);
      if (ci >= 0) return { file: SP, key: 'cameras', index: ci };
      const si = sp.spawns.findIndex((s) => Math.hypot(s.center[0] - x, s.center[2] - z) < Math.max(s.radius, tol));
      if (si >= 0) return { file: SP, key: 'spawns', index: si };
      const ei = sp.spawns.findIndex((s) => inR(s.extract));
      if (ei >= 0) return { file: SP, key: 'spawns', index: ei };
      return null;
    }
    if (typeof L === 'number') {
      const ws = this.walls();
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        if (w.floor !== L) continue;
        const along = w.run === 'x' ? x : z, across = w.run === 'x' ? z : x;
        if (Math.abs(across - w.c) > Math.max(tol, 0.2)) continue;
        if (along < Math.min(w.from, w.to) - tol || along > Math.max(w.from, w.to) + tol) continue;
        const oi = (w.openings ?? []).findIndex((o) => Math.abs(along - o.at) <= o.w / 2);
        if (oi >= 0) return { file: W, key: 'walls', index: i, sub: oi };
        const part = Math.abs(along - w.from) < 0.35 ? 'from' : Math.abs(along - w.to) < 0.35 ? 'to' : 'body';
        return { file: W, key: 'walls', index: i, part };
      }
      const ps = this.props();
      for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; if (p.floor === L && Math.abs(x - p.x) <= p.size[0] / 2 && Math.abs(z - p.z) <= p.size[2] / 2) return { file: PR, key: 'props', index: i }; }
      const cams = this.file<{ cameras: { pos: [number, number, number]; exterior: boolean }[] }>(SP).cameras;
      const ci = cams.findIndex((c) => !c.exterior && this.levelOf(c.pos[1] - 0.05) === L && Math.hypot(c.pos[0] - x, c.pos[2] - z) < tol * 2);
      if (ci >= 0) return { file: SP, key: 'cameras', index: ci };
    }
    const y = this.floorY(L);
    const fl = this.file<{ floors: { y: number; rect: Rect }[]; hatches: { y: number; rect: Rect }[]; roofs: { rect: Rect }[] }>(F);
    const hi = fl.hatches.findIndex((h) => Math.abs(h.y - y) < 0.6 && inR(h.rect));
    if (hi >= 0) return { file: F, key: 'hatches', index: hi };
    const st = this.file<{ stairs: { rect: Rect; yMin: number; yMax: number }[]; landings: { rect: Rect; y: number }[] }>(S);
    const sti = st.stairs.findIndex((s) => this.onLevel(Math.min(s.yMin, s.yMax), Math.max(s.yMin, s.yMax)) && inR(s.rect));
    if (sti >= 0) return { file: S, key: 'stairs', index: sti };
    const li = st.landings.findIndex((l) => this.onLevel(l.y) && inR(l.rect));
    if (li >= 0) return { file: S, key: 'landings', index: li };
    if (L === 'roof') { const ri = fl.roofs.findIndex((r) => inR(r.rect)); if (ri >= 0) return { file: F, key: 'roofs', index: ri }; }
    if (typeof L === 'number') {
      const rooms = this.file<{ rooms: { floor: number; rects: Rect[] }[] }>(R).rooms;
      const ri = rooms.findIndex((r) => r.floor === L && r.rects.some((q) => inR(q)));
      if (ri >= 0) return { file: R, key: 'rooms', index: ri };
    }
    const fi = fl.floors.findIndex((f) => Math.abs(f.y - y) <= 0.6 && inR(f.rect));
    if (fi >= 0) return { file: F, key: 'floors', index: fi };
    return null;
  }

  private down(e: PointerEvent) {
    const c = this.ctx.plan;
    c.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1) { this.pan = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; return; }
    const w = this.toWorld(e.offsetX, e.offsetY);
    this.sel = this.pick(w.x, w.z);
    this.drag = this.sel ? { x: w.x, z: w.z, moved: false } : null;
    this.ctx.inspect();
    this.draw();
  }

  private move(e: PointerEvent) {
    const w = this.toWorld(e.offsetX, e.offsetY);
    this.mouse = w;
    if (this.pan) { this.cx = this.pan.cx - (e.clientX - this.pan.x) / this.scale; this.cz = this.pan.cz - (e.clientY - this.pan.y) / this.scale; this.draw(); return; }
    if (!this.drag || !this.sel) { this.draw(); return; }
    const dx = w.x - this.drag.x, dz = w.z - this.drag.z;
    if (!this.drag.moved && Math.hypot(dx, dz) * this.scale < 3) return;
    this.drag.moved = true;
    const moved = this.moveBy(this.sel, dx, dz);
    if (moved) { this.drag.x += moved.x; this.drag.z += moved.z; this.ctx.changed(this.sel.file); }
  }

  private up() {
    if (this.drag?.moved) this.ctx.inspect();
    this.drag = null;
    this.pan = null;
  }

  /** move the selection by (dx, dz) in snap steps; returns what was applied */
  private moveBy(s: Sel, dx: number, dz: number): { x: number; z: number } | null {
    const step = (v: number) => (this.snapOn ? Math.trunc(v / SNAP) * SNAP : v);
    const mx = step(dx), mz = step(dz);
    if (mx === 0 && mz === 0) return null;
    const it = this.item(s);
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    const moveRect = (r: Rect) => { r.x0 = r4(r.x0 + mx); r.x1 = r4(r.x1 + mx); r.z0 = r4(r.z0 + mz); r.z1 = r4(r.z1 + mz); };
    if (s.file === W) {
      const w = it as unknown as Wall;
      const along = w.run === 'x' ? mx : mz, across = w.run === 'x' ? mz : mx;
      if (s.sub !== undefined) { const o = w.openings![s.sub]; o.at = r4(o.at + along); return { x: w.run === 'x' ? mx : 0, z: w.run === 'z' ? mz : 0 }; }
      if (s.part === 'from') { w.from = r4(w.from + along); return { x: w.run === 'x' ? mx : 0, z: w.run === 'z' ? mz : 0 }; }
      if (s.part === 'to') { w.to = r4(w.to + along); return { x: w.run === 'x' ? mx : 0, z: w.run === 'z' ? mz : 0 }; }
      w.c = r4(w.c + across);
      return { x: w.run === 'z' ? mx : 0, z: w.run === 'x' ? mz : 0 };
    }
    if (s.file === PR) { const p = it as unknown as Prop; p.x = r4(p.x + mx); p.z = r4(p.z + mz); return { x: mx, z: mz }; }
    if (s.key === 'cameras') { const p = it.pos as number[]; p[0] = r4(p[0] + mx); p[2] = r4(p[2] + mz); return { x: mx, z: mz }; }
    if (s.key === 'spawns') { const p = it.center as number[]; p[0] = r4(p[0] + mx); p[2] = r4(p[2] + mz); moveRect(it.extract as Rect); return { x: mx, z: mz }; }
    if (s.key === 'rooms') { for (const q of it.rects as Rect[]) moveRect(q); const sp = it.spot as number[]; sp[0] = r4(sp[0] + mx); sp[1] = r4(sp[1] + mz); return { x: mx, z: mz }; }
    if (it.rect) { moveRect(it.rect as Rect); return { x: mx, z: mz }; }
    return null;
  }

  private key(e: KeyboardEvent) {
    if (this.ctx.plan.style.display === 'none' || !this.sel || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const s = this.sel;
    const n = (e.shiftKey ? 10 : 1) * SNAP;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] };
    if (arrows[e.key]) {
      e.preventDefault();
      const was = this.snapOn;
      this.snapOn = false;
      if (this.moveBy(s, ...arrows[e.key])) this.ctx.changed(s.file);
      this.snapOn = was;
      this.ctx.inspect();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.remove(s);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      const a = this.arr(s);
      if (s.sub !== undefined) { const w = a[s.index] as unknown as Wall; const o = structuredClone(w.openings![s.sub]); o.at += o.w + 0.2; w.openings!.push(o); this.sel = { ...s, sub: w.openings!.length - 1 }; }
      else { const c = structuredClone(a[s.index]); if (s.file === PR) { (c as unknown as Prop).x += 0.5; } a.splice(s.index + 1, 0, c); this.sel = { ...s, index: s.index + 1 }; }
      this.ctx.changed(s.file);
      this.ctx.inspect();
    }
  }

  private remove(s: Sel) {
    const a = this.arr(s);
    if (s.sub !== undefined) (a[s.index] as unknown as Wall).openings!.splice(s.sub, 1);
    else a.splice(s.index, 1);
    this.sel = null;
    this.ctx.changed(s.file);
    this.ctx.inspect();
  }

  private center() { return { x: snap(this.cx), z: snap(this.cz) }; }
  private addProp() {
    const c = this.center();
    this.props().push({ type: 'Box', floor: this.level as number, x: c.x, z: c.z, size: [0.6, 0.6, 0.6], mat: 'wood', color: '#9b7f57', style: 'box' } as Prop);
    this.sel = { file: PR, key: 'props', index: this.props().length - 1 };
    this.ctx.changed(PR);
    this.ctx.inspect();
  }
  private addWall() {
    const c = this.center();
    this.walls().push({ floor: this.level as number, run: 'x', c: c.z, from: snap(c.x - 1.5), to: snap(c.x + 1.5), tier: 'soft', openings: [] });
    this.sel = { file: W, key: 'walls', index: this.walls().length - 1, part: 'body' };
    this.ctx.changed(W);
    this.ctx.inspect();
  }
  private addOpening() {
    if (this.sel?.file !== W) { alert('먼저 벽을 선택하세요'); return; }
    const w = this.walls()[this.sel.index];
    (w.openings ??= []).push({ at: snap((w.from + w.to) / 2), w: 1, kind: 'door' });
    this.sel = { ...this.sel, sub: w.openings.length - 1 };
    this.ctx.changed(W);
    this.ctx.inspect();
  }

  selection() {
    const s = this.sel;
    if (!s) return null;
    const fileSchema = schemaOf(s.file);
    const itemSchema = fileSchema?.properties?.[s.key]?.items as Schema | undefined;
    const it = this.item(s);
    if (s.sub !== undefined) {
      const w = it as unknown as Wall;
      return { title: `문·창 (${w.openings![s.sub].kind}) — 벽 ${w.note ?? ''}`, file: `${s.file} › ${s.key}[${s.index}] › openings[${s.sub}]`, obj: w.openings![s.sub] as unknown as Obj, schema: itemSchema?.properties?.openings?.items as Schema | undefined, remove: () => this.remove(s) };
    }
    const names: Record<string, string> = { walls: '벽', props: '소품', floors: '바닥', hatches: '해치', stairs: '계단', landings: '층계참', rooms: '방', cameras: '카메라', spawns: '스폰', roofs: '지붕' };
    const nm = (it.name ?? it.label ?? it.type ?? it.id ?? it.note ?? '') as string;
    return { title: `${names[s.key] ?? s.key}${nm ? `: ${nm}` : ''}`, file: `${s.file} › ${s.key}[${s.index}]`, obj: it, schema: itemSchema, remove: () => this.remove(s) };
  }

  panel(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'help';
    d.textContent = this.sel
      ? '이 요소만 편집합니다. 빈 곳을 클릭하면 선택이 풀리고 열린 파일 전체가 보입니다.'
      : `평면도에서 요소를 클릭하면 여기서 편집합니다. 아무것도 선택하지 않으면 data/${this.path} 전체가 보입니다.`;
    return d;
  }
}
