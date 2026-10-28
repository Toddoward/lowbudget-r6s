import type { Ctx, EditorView } from './main.ts';
import type { Schema } from './form.ts';
import { files, schemaOf } from './store.ts';

/**
 * The House map from above, one floor at a time (or the roof / the grounds). Layers can be shown, hidden and locked
 * (hidden or locked layers are never picked); H hides the selected element, Alt+H shows everything again; clicking the
 * same spot again (or Alt+click) picks the next element under the cursor. Drag moves; rect-shaped elements (floors, holes,
 * stairs, landings, hatches, roofs, room parts, extraction zones) have corner / edge handles; wall ends change the wall's
 * length, openings slide along their wall. Arrows nudge (Shift ×10), Delete removes, Ctrl+D duplicates.
 */
type Rect = { x0: number; z0: number; x1: number; z1: number };
type Obj = Record<string, unknown>;
type Key = string | number;
interface Wall { floor: number; run: 'x' | 'z'; c: number; from: number; to: number; tier: string; ext?: boolean; t?: number; openings?: { at: number; w: number; kind: string }[]; note?: string }
interface Prop { type: string; floor: number; x: number; z: number; size: [number, number, number]; color: string; note?: string }
type Level = -1 | 0 | 1 | 'roof' | 'out';
type Layer = 'floors' | 'holes' | 'stairs' | 'landings' | 'rooms' | 'walls' | 'openings' | 'hatches' | 'props' | 'cameras' | 'roofs' | 'spawns';
/** a selected element: the file, the path to it from the file's root, what it is */
interface Sel { file: string; path: Key[]; layer: Layer }
type Edge = { x?: 'min' | 'max'; z?: 'min' | 'max' };

const SNAP = 0.05;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const W = 'maps/house/walls.json', F = 'maps/house/floors.json', S = 'maps/house/stairs.json', R = 'maps/house/rooms.json', SP = 'maps/house/spawns.json', PR = 'maps/house/props.json', M = 'maps/house/map.json';
const TIER: Record<string, string> = { solid: '#e6e0d6', soft: '#d77d5a', semi: '#d6b45a' };
const OPEN: Record<string, string> = { door: '#6ab0e0', exterior_door: '#4a7cf0', window: '#7fd6f7', french: '#9cc8ff', open_window: '#ffffff', arch: '#c8c8c8', shutter: '#9a9a9a', vent: '#8ff08f' };
const FLOORC: Record<string, string> = { concrete: '#353a40', wood: '#46392b', deck: '#56462f', roof: '#3f3434', hatch: '#5c4a30' };
const LEVELS: [Level, string][] = [[-1, 'B (지하)'], [0, '1F'], [1, '2F'], ['roof', '지붕'], ['out', '바깥 (스폰·카메라)']];
const LAYERS: [Layer, string][] = [['floors', '바닥'], ['holes', '바닥 구멍'], ['stairs', '계단'], ['landings', '층계참'], ['rooms', '방'], ['walls', '벽'], ['openings', '문·창'], ['hatches', '해치'], ['props', '소품'], ['cameras', '카메라'], ['roofs', '지붕 조각'], ['spawns', '스폰·탈출 구역']];
const NAMES: Record<Layer, string> = Object.fromEntries(LAYERS) as Record<Layer, string>;
const isRect = (v: unknown): v is Rect => !!v && typeof v === 'object' && 'x0' in (v as Obj) && 'z1' in (v as Obj);
const norm = (r: Rect) => ({ x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) });

export class PlanView implements EditorView {
  private path = '';
  private level: Level = 0;
  private cx = 0;
  private cz = 0;
  private scale = 28;
  private sel: Sel | null = null;
  private drag: { x: number; z: number; moved: boolean; edge?: Edge; part?: 'from' | 'to' } | null = null;
  private pan: { x: number; y: number; cx: number; cz: number } | null = null;
  private g: CanvasRenderingContext2D;
  private mouse = { x: 0, z: 0 };
  private snapOn = true;
  private show: Record<Layer, boolean>;
  private lock: Record<Layer, boolean>;
  private hidden = new Set<string>();
  private lastClick = { x: -1e9, y: -1e9, i: 0 };
  private layersEl: HTMLElement;

  constructor(private ctx: Ctx) {
    const c = ctx.plan;
    this.g = c.getContext('2d')!;
    const saved = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
    this.show = { ...Object.fromEntries(LAYERS.map(([l]) => [l, true])), ...(saved('r6.plan.show') ?? {}) } as Record<Layer, boolean>;
    this.lock = { ...Object.fromEntries(LAYERS.map(([l]) => [l, false])), ...(saved('r6.plan.lock') ?? {}) } as Record<Layer, boolean>;
    this.layersEl = document.createElement('div');
    this.layersEl.className = 'layers';
    c.parentElement!.append(this.layersEl);
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
  private at(file: string, path: Key[]): unknown { return path.reduce<unknown>((o, k) => (o as Record<Key, unknown>)?.[k], files[file]); }
  private item(s: Sel) { return this.at(s.file, s.path) as Obj; }
  private id(file: string, path: Key[]) { return `${file}|${path.join('.')}`; }
  private visible(layer: Layer, file: string, path: Key[]) { return this.show[layer] && !this.hidden.has(this.id(file, path)); }
  private pickable(layer: Layer, file: string, path: Key[]) { return this.visible(layer, file, path) && !this.lock[layer]; }
  private floorY(l: Level) { const fl = this.file<{ floors: Record<string, { y: number }> }>(M).floors; return l === 'roof' ? 7 : l === 'out' ? 0 : fl[String(l)].y; }
  /** the storey a height belongs to */
  private levelOf(y: number): Level { const fl = this.file<{ floors: Record<string, { y: number }> }>(M).floors; return y < fl['0'].y ? -1 : y < fl['1'].y ? 0 : 1; }
  private onLevel(y0: number, y1 = y0) { const y = this.floorY(this.level); return this.level === 'out' ? false : y1 >= y - 0.6 && y0 < y + 3.2; }
  private holeRect(h: Rect | string): Rect | undefined {
    if (typeof h !== 'string') return h;
    if (h.startsWith('stairs:')) return (this.file<{ holes: Record<string, Rect> }>(S).holes)[h.slice(7)];
    return this.file<{ hatches: { id: string; rect: Rect }[] }>(F).hatches.find((x) => x.id === h)?.rect;
  }
  /** the rect a selection resizes (if it is one) */
  private rectOf(s: Sel): Rect | null {
    const it = this.item(s);
    if (isRect(it)) return it;
    if (isRect(it?.rect)) return it.rect as Rect;
    if (s.layer === 'spawns' && isRect(it?.extract)) return it.extract as Rect;
    return null;
  }

  open(path: string) {
    this.path = path;
    this.sel = null;
    if (path === SP) this.level = 'out';
    this.toolbar();
    this.layerPanel();
    this.layersEl.style.display = 'block';
    this.ctx.hint.textContent = '클릭: 선택 (같은 곳을 다시 클릭 / Alt+클릭: 아래에 겹친 다음 요소) · 드래그: 이동 · 모서리·변 핸들: 크기 · 벽 끝: 길이 · H: 숨기기 · Alt+H: 모두 보이기 · 화살표: 0.05 m (Shift ×10) · Delete · Ctrl+D: 복제 · 휠: 확대 · 오른쪽 드래그: 이동';
    this.draw();
  }
  close() { this.sel = null; this.layersEl.style.display = 'none'; }
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
      add('＋ 바닥 구멍 (선택한 바닥에)', () => this.addHole());
    }
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.snapOn;
    cb.onchange = () => { this.snapOn = cb.checked; };
    l.append(cb, ` ${SNAP * 100} cm 격자`);
    tb.append(l);
  }

  private layerPanel() {
    const el = this.layersEl;
    el.innerHTML = '<b>레이어</b> <span class="dim">👁 보이기 · 🔒 잠금</span>';
    const save = () => { try { localStorage.setItem('r6.plan.show', JSON.stringify(this.show)); localStorage.setItem('r6.plan.lock', JSON.stringify(this.lock)); } catch { /* private mode */ } };
    for (const [layer, name] of LAYERS) {
      const row = document.createElement('div');
      const eye = document.createElement('input');
      eye.type = 'checkbox'; eye.checked = this.show[layer]; eye.title = '보이기';
      eye.onchange = () => { this.show[layer] = eye.checked; if (this.sel?.layer === layer && !eye.checked) this.sel = null; save(); this.draw(); };
      const lk = document.createElement('input');
      lk.type = 'checkbox'; lk.checked = this.lock[layer]; lk.title = '잠금 (선택 안 됨)';
      lk.onchange = () => { this.lock[layer] = lk.checked; save(); };
      row.append('👁', eye, '🔒', lk, ` ${name}`);
      el.append(row);
    }
    const h = document.createElement('div');
    h.className = 'dim';
    h.textContent = this.hidden.size ? `숨긴 요소 ${this.hidden.size}개 — Alt+H로 모두 보이기` : 'H: 선택한 요소 숨기기';
    el.append(h);
  }

  /* ------------------------------------------------------------- view transform */
  private toScreen(x: number, z: number) { const c = this.ctx.plan; return { x: (x - this.cx) * this.scale + c.clientWidth / 2, y: (z - this.cz) * this.scale + c.clientHeight / 2 }; }
  private toWorld(sx: number, sy: number) { const c = this.ctx.plan; return { x: (sx - c.clientWidth / 2) / this.scale + this.cx, z: (sy - c.clientHeight / 2) / this.scale + this.cz }; }

  /* ------------------------------------------------------------- what is on this level (drawing and picking share it) */
  /** every element on the current level, bottom to top: draw in this order, pick in reverse */
  private elements(): Sel[] {
    const L = this.level;
    const out: Sel[] = [];
    const push = (layer: Layer, file: string, path: Key[]) => { if (this.visible(layer, file, path)) out.push({ file, layer, path }); };
    if (L === 'out') {
      const sp = this.file<{ spawns: unknown[]; cameras: { exterior: boolean }[] }>(SP);
      sp.spawns.forEach((_, i) => push('spawns', SP, ['spawns', i]));
      sp.cameras.forEach((c, i) => { if (c.exterior) push('cameras', SP, ['cameras', i]); });
      return out;
    }
    const y = this.floorY(L);
    const fl = this.file<{ floors: { y: number; holes?: (Rect | string)[] }[]; hatches: { y: number }[]; roofs: unknown[] }>(F);
    fl.floors.forEach((f, i) => { if (Math.abs(f.y - y) <= 0.6) push('floors', F, ['floors', i]); });
    fl.floors.forEach((f, i) => { if (Math.abs(f.y - y) <= 0.6) (f.holes ?? []).forEach((h, k) => { if (typeof h !== 'string') push('holes', F, ['floors', i, 'holes', k]); }); });
    const st = this.file<{ stairs: { yMin: number; yMax: number }[]; landings: { y: number }[]; holes: Record<string, Rect> }>(S);
    // the stair wells: referenced from a floor at this level as `stairs:<name>`
    const wells = new Set<string>();
    fl.floors.forEach((f) => { if (Math.abs(f.y - y) <= 0.6) for (const h of f.holes ?? []) if (typeof h === 'string' && h.startsWith('stairs:')) wells.add(h.slice(7)); });
    for (const w of wells) push('holes', S, ['holes', w]);
    if (L === 'roof') fl.roofs.forEach((_, i) => push('roofs', F, ['roofs', i]));
    st.landings.forEach((l, i) => { if (this.onLevel(l.y)) push('landings', S, ['landings', i]); });
    st.stairs.forEach((s, i) => { if (this.onLevel(Math.min(s.yMin, s.yMax), Math.max(s.yMin, s.yMax))) push('stairs', S, ['stairs', i]); });
    fl.hatches.forEach((h, i) => { if (Math.abs(h.y - y) < 0.6) push('hatches', F, ['hatches', i]); });
    if (typeof L === 'number') {
      this.file<{ rooms: { floor: number; rects: Rect[] }[] }>(R).rooms.forEach((r, i) => { if (r.floor === L) r.rects.forEach((_, k) => push('rooms', R, ['rooms', i, 'rects', k])); });
      this.file<{ props: Prop[] }>(PR).props.forEach((p, i) => { if (p.floor === L) push('props', PR, ['props', i]); });
      this.file<{ walls: Wall[] }>(W).walls.forEach((w, i) => { if (w.floor === L) { push('walls', W, ['walls', i]); (w.openings ?? []).forEach((_, k) => push('openings', W, ['walls', i, 'openings', k])); } });
      this.file<{ cameras: { pos: number[]; exterior: boolean }[] }>(SP).cameras.forEach((c, i) => { if (!c.exterior && this.levelOf(c.pos[1] - 0.05) === L) push('cameras', SP, ['cameras', i]); });
    }
    return out;
  }

  /* ------------------------------------------------------------- drawing */
  draw() {
    const c = this.ctx.plan;
    if (c.style.display === 'none') return;
    const dpr = devicePixelRatio;
    if (c.width !== c.clientWidth * dpr || c.height !== c.clientHeight * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, c.clientWidth, c.clientHeight);
    this.grid();
    if (this.level === 'out') {
      const map = this.file<{ houseRect: Rect; bounds: Rect; driveway: Rect }>(M);
      this.rect(map.bounds, undefined, '#3a4652', [6, 4]);
      this.rect(map.houseRect, '#2a2f35', '#58626c');
      this.rect(map.driveway, '#262b30', '#4b5560', [3, 3]);
    }
    const sel = this.sel ? this.id(this.sel.file, this.sel.path) : '';
    for (const e of this.elements()) this.drawOne(e, this.id(e.file, e.path) === sel);
    if (this.sel) this.drawHandles(this.sel);
    g.fillStyle = '#8b96a1';
    g.font = '11px system-ui';
    g.textAlign = 'right';
    g.fillText(`x ${this.mouse.x.toFixed(2)}  z ${this.mouse.z.toFixed(2)}  (m)`, c.clientWidth - 10, 112);
    g.textAlign = 'left';
  }

  private rect(r: Rect, fill?: string, stroke?: string, dash?: number[], width = 1) {
    const g = this.g;
    const n = norm(r);
    const a = this.toScreen(n.x0, n.z0), b = this.toScreen(n.x1, n.z1);
    if (fill) { g.fillStyle = fill; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    if (stroke) { g.setLineDash(dash ?? []); g.lineWidth = width; g.strokeStyle = stroke; g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); g.setLineDash([]); g.lineWidth = 1; }
  }

  private drawOne(e: Sel, on: boolean) {
    const g = this.g;
    const it = this.item(e);
    const SEL = '#5ae0ff';
    switch (e.layer) {
      case 'floors': {
        const f = it as { rect: Rect; kind: string; holes?: (Rect | string)[] };
        this.rect(f.rect, FLOORC[f.kind] ?? '#333', on ? SEL : '#2b3036', undefined, on ? 2 : 1);
        // referenced holes (hatches) cut the slab too
        for (const h of f.holes ?? []) { const r = this.holeRect(h); if (r) this.rect(r, '#0b0d0f'); }
        break;
      }
      case 'holes': {
        const r = it as unknown as Rect;
        this.rect(r, '#0b0d0f', on ? SEL : '#e05a5a', [5, 3], on ? 2 : 1.5);
        const n = norm(r);
        const p = this.toScreen((n.x0 + n.x1) / 2, (n.z0 + n.z1) / 2);
        this.text(e.file === S ? `계단 구멍 (${String(e.path[1])})` : '구멍', p.x, p.y, '#f0a0a0', 10);
        break;
      }
      case 'roofs': { const r = it as { rect: Rect; id: string }; this.rect(r.rect, 'rgba(120,80,70,.25)', on ? SEL : '#8a5a50'); const n = norm(r.rect); const p = this.toScreen((n.x0 + n.x1) / 2, (n.z0 + n.z1) / 2); this.text(r.id, p.x, p.y, '#d9b0a8'); break; }
      case 'landings': this.rect((it as { rect: Rect }).rect, '#4d4030', on ? SEL : '#6d5a40', undefined, on ? 2 : 1); break;
      case 'stairs': this.stair(it as { rect: Rect; axis: 'x' | 'z'; yMin: number; yMax: number; steps?: number }, on); break;
      case 'hatches': this.rect((it as { rect: Rect }).rect, '#6a5030', on ? SEL : '#e0b060', undefined, on ? 2 : 1); break;
      case 'rooms': {
        const room = this.at(e.file, e.path.slice(0, 2)) as { name: string; rects: Rect[]; spot: [number, number] };
        const r = it as unknown as Rect;
        this.rect(r, undefined, on ? SEL : 'rgba(170,190,210,.35)', [4, 4], on ? 2 : 1);
        if (e.path[3] === 0) {
          const n = norm(r);
          const p = this.toScreen((n.x0 + n.x1) / 2, (n.z0 + n.z1) / 2);
          this.text(room.name, p.x, p.y, 'rgba(200,215,230,.8)');
          const s = this.toScreen(room.spot[0], room.spot[1]);
          g.fillStyle = '#e0c060'; g.fillRect(s.x - 2, s.y - 2, 4, 4);
        }
        break;
      }
      case 'props': {
        const p = it as unknown as Prop;
        this.rect({ x0: p.x - p.size[0] / 2, z0: p.z - p.size[2] / 2, x1: p.x + p.size[0] / 2, z1: p.z + p.size[2] / 2 }, p.color, on ? SEL : 'rgba(0,0,0,.6)', undefined, on ? 2 : 1);
        if (on || this.scale > 45) { const s = this.toScreen(p.x, p.z); this.text(p.type, s.x, s.y, on ? '#fff' : 'rgba(255,255,255,.7)', 10); }
        break;
      }
      case 'walls': this.wall(it as unknown as Wall, on); break;
      case 'openings': {
        const w = this.at(e.file, e.path.slice(0, 2)) as Wall;
        const o = it as { at: number; w: number; kind: string };
        const end = (v: number) => (w.run === 'x' ? this.toScreen(v, w.c) : this.toScreen(w.c, v));
        const p = end(o.at - o.w / 2), q = end(o.at + o.w / 2);
        g.lineCap = 'butt';
        g.strokeStyle = '#15181c';
        g.lineWidth = Math.max(2, (w.t ?? (w.ext ? 0.3 : 0.2)) * this.scale) + 1;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
        g.strokeStyle = on ? SEL : OPEN[o.kind] ?? '#fff';
        g.lineWidth = Math.max(on ? 4 : 2, 0.08 * this.scale);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
        g.lineWidth = 1;
        break;
      }
      case 'cameras': { const cam = it as { pos: [number, number, number]; yawDeg: number; label: string }; this.camera(cam.pos, cam.yawDeg, cam.label, on); break; }
      case 'spawns': {
        const s = it as { label: string; center: [number, number, number]; radius: number; extract: Rect };
        this.rect(s.extract, 'rgba(90,169,230,.08)', on ? SEL : '#3c6d93', [5, 4], on ? 2 : 1);
        const p = this.toScreen(s.center[0], s.center[2]);
        g.beginPath(); g.arc(p.x, p.y, Math.max(4, s.radius * this.scale), 0, Math.PI * 2);
        g.fillStyle = on ? SEL : '#5aa9e6'; g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
        this.text(s.label, p.x, p.y - Math.max(8, s.radius * this.scale) - 4, '#cfe6f7');
        break;
      }
    }
  }

  /** the selection's handles: rect corners / edge midpoints, wall ends */
  private drawHandles(s: Sel) {
    const g = this.g;
    const box = (x: number, y: number) => { g.fillStyle = '#5ae0ff'; g.strokeStyle = '#0b0d0f'; g.fillRect(x - 4, y - 4, 8, 8); g.strokeRect(x - 4, y - 4, 8, 8); };
    const r = this.rectOf(s);
    if (r) for (const h of this.rectHandles(r)) { const p = this.toScreen(h.x, h.z); box(p.x, p.y); }
    if (s.layer === 'walls') {
      const w = this.item(s) as unknown as Wall;
      for (const v of [w.from, w.to]) { const p = w.run === 'x' ? this.toScreen(v, w.c) : this.toScreen(w.c, v); box(p.x, p.y); }
    }
  }
  private rectHandles(r: Rect): { x: number; z: number; edge: Edge }[] {
    const n = norm(r), mx = (n.x0 + n.x1) / 2, mz = (n.z0 + n.z1) / 2;
    return [
      { x: n.x0, z: n.z0, edge: { x: 'min', z: 'min' } }, { x: n.x1, z: n.z0, edge: { x: 'max', z: 'min' } }, { x: n.x0, z: n.z1, edge: { x: 'min', z: 'max' } }, { x: n.x1, z: n.z1, edge: { x: 'max', z: 'max' } },
      { x: mx, z: n.z0, edge: { z: 'min' } }, { x: mx, z: n.z1, edge: { z: 'max' } }, { x: n.x0, z: mz, edge: { x: 'min' } }, { x: n.x1, z: mz, edge: { x: 'max' } },
    ];
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

  private wall(w: Wall, on: boolean) {
    const g = this.g;
    const a = w.run === 'x' ? this.toScreen(w.from, w.c) : this.toScreen(w.c, w.from);
    const b = w.run === 'x' ? this.toScreen(w.to, w.c) : this.toScreen(w.c, w.to);
    g.lineCap = 'butt';
    g.strokeStyle = on ? '#5ae0ff' : TIER[w.tier] ?? '#aaa';
    g.lineWidth = Math.max(2, (w.t ?? (w.ext ? 0.3 : 0.2)) * this.scale);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.lineWidth = 1;
  }

  private stair(s: { rect: Rect; axis: 'x' | 'z'; yMin: number; yMax: number; steps?: number }, on: boolean) {
    const g = this.g;
    const n = norm(s.rect);
    const a = this.toScreen(n.x0, n.z0), b = this.toScreen(n.x1, n.z1);
    g.fillStyle = '#4a3f33';
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const steps = s.steps ?? Math.max(2, Math.round(Math.abs(s.yMax - s.yMin) / 0.19));
    g.strokeStyle = '#7d6a52';
    g.beginPath();
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (s.axis === 'x') { const x = a.x + (b.x - a.x) * t; g.moveTo(x, a.y); g.lineTo(x, b.y); } else { const y = a.y + (b.y - a.y) * t; g.moveTo(a.x, y); g.lineTo(b.x, y); }
    }
    g.stroke();
    g.lineWidth = on ? 2 : 1;
    g.strokeStyle = on ? '#5ae0ff' : '#b49a76';
    g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    g.lineWidth = 1;
    // arrow toward the top (rect x0 / z0 is the yMin end)
    const up = (s.yMax > s.yMin ? 1 : -1) * (s.axis === 'x' ? Math.sign(s.rect.x1 - s.rect.x0) || 1 : Math.sign(s.rect.z1 - s.rect.z0) || 1);
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
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // the game's yaw: forward = (−sin yaw, −cos yaw)
    g.fillStyle = on ? '#5ae0ff' : '#e05a5a';
    g.beginPath();
    g.moveTo(p.x + fx * 14, p.y + fz * 14);
    g.lineTo(p.x - fz * 6, p.y + fx * 6);
    g.lineTo(p.x + fz * 6, p.y - fx * 6);
    g.fill();
    this.text(label, p.x, p.y + 16, '#e8b0b0', 10);
  }

  /* ------------------------------------------------------------- picking */
  /** is (x, z) on this element? */
  private hit(e: Sel, x: number, z: number): boolean {
    const tol = 6 / this.scale;
    const inR = (r: Rect, pad = 0) => { const n = norm(r); return x >= n.x0 - pad && x <= n.x1 + pad && z >= n.z0 - pad && z <= n.z1 + pad; };
    const it = this.item(e);
    switch (e.layer) {
      case 'walls': case 'openings': {
        const w = (e.layer === 'walls' ? it : this.at(e.file, e.path.slice(0, 2))) as unknown as Wall;
        const along = w.run === 'x' ? x : z, across = w.run === 'x' ? z : x;
        if (Math.abs(across - w.c) > Math.max(tol, (w.t ?? 0.25) / 2 + tol)) return false;
        if (e.layer === 'openings') { const o = it as { at: number; w: number }; return Math.abs(along - o.at) <= o.w / 2; }
        return along >= Math.min(w.from, w.to) - tol && along <= Math.max(w.from, w.to) + tol;
      }
      case 'props': { const p = it as unknown as Prop; return Math.abs(x - p.x) <= p.size[0] / 2 + tol && Math.abs(z - p.z) <= p.size[2] / 2 + tol; }
      case 'cameras': { const p = (it as { pos: number[] }).pos; return Math.hypot(p[0] - x, p[2] - z) < tol * 2.5; }
      case 'spawns': { const s = it as { center: number[]; radius: number; extract: Rect }; return Math.hypot(s.center[0] - x, s.center[2] - z) < Math.max(s.radius, tol) || inR(s.extract); }
      case 'holes': case 'rooms': return inR(it as unknown as Rect, tol);
      default: return isRect(it?.rect) && inR(it.rect as Rect);
    }
  }
  /** what's under (x, z), topmost first, pickable only */
  private under(x: number, z: number): Sel[] {
    const all = this.elements().filter((e) => this.pickable(e.layer, e.file, e.path) && this.hit(e, x, z));
    // small, specific things first: openings, walls, props, cameras, holes … floors last
    const order: Layer[] = ['openings', 'cameras', 'props', 'walls', 'hatches', 'holes', 'stairs', 'landings', 'spawns', 'rooms', 'roofs', 'floors'];
    return all.sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  }

  /* ------------------------------------------------------------- mouse / keys */
  private down(e: PointerEvent) {
    const c = this.ctx.plan;
    c.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1) { this.pan = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; return; }
    const w = this.toWorld(e.offsetX, e.offsetY);
    // a handle of the current selection?
    if (this.sel) {
      const near = (hx: number, hz: number) => Math.hypot(hx - w.x, hz - w.z) * this.scale < 7;
      const r = this.rectOf(this.sel);
      const h = r ? this.rectHandles(r).find((q) => near(q.x, q.z)) : undefined;
      if (h) { this.drag = { x: w.x, z: w.z, moved: false, edge: h.edge }; return; }
      if (this.sel.layer === 'walls') {
        const wl = this.item(this.sel) as unknown as Wall;
        for (const part of ['from', 'to'] as const) {
          const p = wl.run === 'x' ? { x: wl[part], z: wl.c } : { x: wl.c, z: wl[part] };
          if (near(p.x, p.z)) { this.drag = { x: w.x, z: w.z, moved: false, part }; return; }
        }
      }
    }
    const cands = this.under(w.x, w.z);
    const again = Math.hypot(e.offsetX - this.lastClick.x, e.offsetY - this.lastClick.y) < 4;
    let i = 0;
    if ((again || e.altKey) && cands.length > 1) {
      const cur = this.sel ? cands.findIndex((c2) => this.id(c2.file, c2.path) === this.id(this.sel!.file, this.sel!.path)) : -1;
      i = (cur + 1) % cands.length;
    }
    this.lastClick = { x: e.offsetX, y: e.offsetY, i };
    this.sel = cands[i] ?? null;
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
    const step = (v: number) => (this.snapOn ? Math.trunc(v / SNAP) * SNAP : v);
    const mx = step(dx), mz = step(dz);
    if (mx === 0 && mz === 0) return;
    if (this.drag.edge) this.resize(this.sel, this.drag.edge, mx, mz);
    else if (this.drag.part) { const wl = this.item(this.sel) as unknown as Wall; wl[this.drag.part] = r4(wl[this.drag.part] + (wl.run === 'x' ? mx : mz)); }
    else this.moveBy(this.sel, mx, mz);
    this.drag.x += mx;
    this.drag.z += mz;
    this.ctx.changed(this.sel.file);
  }

  private up() {
    if (this.drag?.moved) this.ctx.inspect();
    this.drag = null;
    this.pan = null;
  }

  /** drag a rect's edge(s): the key holding that side's coordinate moves */
  private resize(s: Sel, edge: Edge, mx: number, mz: number) {
    const r = this.rectOf(s)!;
    if (edge.x) { const k = (edge.x === 'min') === (r.x0 <= r.x1) ? 'x0' : 'x1'; r[k] = r4(r[k] + mx); }
    if (edge.z) { const k = (edge.z === 'min') === (r.z0 <= r.z1) ? 'z0' : 'z1'; r[k] = r4(r[k] + mz); }
  }

  private moveBy(s: Sel, mx: number, mz: number) {
    const it = this.item(s);
    const moveRect = (r: Rect) => { r.x0 = r4(r.x0 + mx); r.x1 = r4(r.x1 + mx); r.z0 = r4(r.z0 + mz); r.z1 = r4(r.z1 + mz); };
    switch (s.layer) {
      case 'walls': { const w = it as unknown as Wall; w.c = r4(w.c + (w.run === 'x' ? mz : mx)); return; }
      case 'openings': { const w = this.at(s.file, s.path.slice(0, 2)) as unknown as Wall; const o = it as { at: number }; o.at = r4(o.at + (w.run === 'x' ? mx : mz)); return; }
      case 'props': { const p = it as unknown as Prop; p.x = r4(p.x + mx); p.z = r4(p.z + mz); return; }
      case 'cameras': { const p = it.pos as number[]; p[0] = r4(p[0] + mx); p[2] = r4(p[2] + mz); return; }
      case 'spawns': { const p = it.center as number[]; p[0] = r4(p[0] + mx); p[2] = r4(p[2] + mz); moveRect(it.extract as Rect); return; }
      case 'rooms': {
        moveRect(it as unknown as Rect);
        return;
      }
      default: { const r = this.rectOf(s); if (r) moveRect(r); }
    }
  }

  private key(e: KeyboardEvent) {
    if (this.ctx.plan.style.display === 'none' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'KeyH' && e.altKey) { e.preventDefault(); this.hidden.clear(); this.layerPanel(); this.draw(); return; }
    const s = this.sel;
    if (!s) return;
    const n = (e.shiftKey ? 10 : 1) * SNAP;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] };
    if (arrows[e.key]) {
      e.preventDefault();
      this.moveBy(s, ...arrows[e.key]);
      this.ctx.changed(s.file);
      this.ctx.inspect();
    } else if (e.code === 'KeyH') {
      e.preventDefault();
      this.hidden.add(this.id(s.file, s.path));
      this.sel = null;
      this.layerPanel();
      this.draw();
      this.ctx.inspect();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.remove(s);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      const parent = this.at(s.file, s.path.slice(0, -1));
      const i = s.path[s.path.length - 1];
      if (!Array.isArray(parent) || typeof i !== 'number') return;
      const copy = structuredClone(parent[i]);
      if (s.layer === 'props') (copy as Prop).x += 0.5;
      else if (s.layer === 'openings') (copy as { at: number; w: number }).at += (copy as { w: number }).w + 0.2;
      else if (isRect(copy)) { copy.x0 += 0.5; copy.x1 += 0.5; }
      parent.splice(i + 1, 0, copy);
      this.sel = { ...s, path: [...s.path.slice(0, -1), i + 1] };
      this.ctx.changed(s.file);
      this.ctx.inspect();
    }
  }

  private remove(s: Sel) {
    const parent = this.at(s.file, s.path.slice(0, -1));
    const i = s.path[s.path.length - 1];
    if (Array.isArray(parent) && typeof i === 'number') parent.splice(i, 1);
    else { alert('이 요소는 지울 수 없습니다 (이름으로 참조되는 구멍은 계단·해치에서 지우세요)'); return; }
    this.sel = null;
    this.ctx.changed(s.file);
    this.ctx.inspect();
  }

  /* ------------------------------------------------------------- adding */
  private center() { return { x: Math.round(this.cx / SNAP) * SNAP, z: Math.round(this.cz / SNAP) * SNAP }; }
  private addProp() {
    const c = this.center();
    const props = this.file<{ props: Prop[] }>(PR).props;
    props.push({ type: 'Box', floor: this.level as number, x: c.x, z: c.z, size: [0.6, 0.6, 0.6], mat: 'wood', color: '#9b7f57', style: 'box' } as Prop);
    this.sel = { file: PR, layer: 'props', path: ['props', props.length - 1] };
    this.ctx.changed(PR);
    this.ctx.inspect();
  }
  private addWall() {
    const c = this.center();
    const walls = this.file<{ walls: Wall[] }>(W).walls;
    walls.push({ floor: this.level as number, run: 'x', c: c.z, from: r4(c.x - 1.5), to: r4(c.x + 1.5), tier: 'soft', openings: [] });
    this.sel = { file: W, layer: 'walls', path: ['walls', walls.length - 1] };
    this.ctx.changed(W);
    this.ctx.inspect();
  }
  private addOpening() {
    if (this.sel?.layer !== 'walls') { alert('먼저 벽을 선택하세요'); return; }
    const w = this.item(this.sel) as unknown as Wall;
    (w.openings ??= []).push({ at: r4((w.from + w.to) / 2), w: 1, kind: 'door' });
    this.sel = { file: W, layer: 'openings', path: [...this.sel.path, 'openings', w.openings.length - 1] };
    this.ctx.changed(W);
    this.ctx.inspect();
  }
  private addHole() {
    if (this.sel?.layer !== 'floors') { alert('먼저 바닥을 선택하세요 (구멍은 그 바닥에 생깁니다)'); return; }
    const f = this.item(this.sel) as { holes?: (Rect | string)[] };
    const c = this.center();
    (f.holes ??= []).push({ x0: r4(c.x - 0.5), z0: r4(c.z - 0.5), x1: r4(c.x + 0.5), z1: r4(c.z + 0.5) });
    this.sel = { file: F, layer: 'holes', path: [...this.sel.path, 'holes', f.holes.length - 1] };
    this.ctx.changed(F);
    this.ctx.inspect();
  }

  /* ------------------------------------------------------------- inspector */
  /** the schema of the element at `path` in `file` (array items, oneOf objects) */
  private schemaAt(file: string, path: Key[]): Schema | undefined {
    let s = schemaOf(file);
    for (const k of path) {
      if (!s) return undefined;
      s = typeof k === 'number' ? s.items : s.properties?.[k] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : undefined);
      if (s?.oneOf) s = s.oneOf.find((x) => x.type === 'object') ?? s;
    }
    return s;
  }

  selection() {
    const s = this.sel;
    if (!s) return null;
    // a room part / a wall opening / a floor hole: the inspector shows that piece; its owner is named in the title
    const it = this.item(s);
    const owner = s.path.length > 2 ? (this.at(s.file, s.path.slice(0, 2)) as Obj) : it;
    const nm = (owner.name ?? owner.label ?? owner.type ?? owner.id ?? owner.note ?? '') as string;
    return {
      title: `${NAMES[s.layer]}${nm ? ` — ${nm}` : ''}`,
      path: s.file,
      where: `${s.file} › ${s.path.join(' › ')}`,
      obj: it,
      schema: this.schemaAt(s.file, s.path),
      remove: () => this.remove(s),
    };
  }

  panel(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'help';
    d.textContent = this.sel
      ? '이 요소만 편집합니다 (숫자를 바꾸면 평면도도 바로 바뀝니다). 빈 곳을 클릭하면 선택이 풀리고 열린 파일 전체가 보입니다.'
      : `평면도에서 요소를 클릭하면 여기서 편집합니다. 아무것도 선택하지 않으면 data/${this.path} 전체가 보입니다.`;
    return d;
  }
}
