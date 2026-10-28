import { buildForm, type Schema } from './form.ts';
import { addFile, dirtyPaths, edited, files, isDirty, save, schemaOf, undo } from './store.ts';
import { View3D } from './view3d.ts';
import { WeaponView } from './weaponView.ts';
import { RigView } from './rigView.ts';
import { PlanView } from './planView.ts';
import { GadgetView } from './gadgetView.ts';
import { reloadWeapons } from '../src/game/weapons.ts';
import { reloadOperators } from '../src/game/operators.ts';
import { preloadGlbAssets } from '../src/assets/library.ts';

/**
 * The editor (`npm run editor`): every data file in a tree, a form for the selected one (or for the element selected in
 * the view), a 3D / plan view that follows the edits live, save to disk through the dev server.
 */
export interface Ctx {
  view3d: View3D;
  plan: HTMLCanvasElement;
  toolbar: HTMLElement;
  hint: HTMLElement;
  /** call after changing the open file's data (a view dragged something) */
  changed(path?: string): void;
  /** redraw the inspector (the selection changed) */
  inspect(): void;
  open(path: string): void;
}
export interface EditorView {
  open(path: string): void;
  close(): void;
  /** the data changed (form edit, undo): rebuild what depends on it */
  refresh(): void;
  /** the inspector's subject: the selected element's object + schema, or null for the whole file */
  /** `path`: the data file the element lives in (edits mark that file, not the open one); `where`: shown under the title */
  selection?(): { title: string; path: string; where?: string; obj: Record<string, unknown>; schema?: Schema; remove?: () => void } | null;
  /** extra inspector content (actions, help) above the form */
  panel?(): HTMLElement | null;
}

const $ = (id: string) => document.getElementById(id)!;
const tree = $('tree'), inspector = $('inspector'), status = $('status');
const plan = $('plan') as HTMLCanvasElement;
const view3d = new View3D($('view'));

let current: string | null = null;
let view: EditorView | null = null;

const ctx: Ctx = {
  view3d, plan, toolbar: $('toolbar'), hint: $('hint'),
  changed(path = current!) { afterEdit(path); view?.refresh(); },
  inspect: () => renderInspector(),
  open: (p) => open(p),
};
const views = {
  weapon: new WeaponView(ctx), rig: new RigView(ctx), plan: new PlanView(ctx), gadget: new GadgetView(ctx),
};
(window as unknown as { editor: unknown }).editor = { view3d, views }; // (the console and tools/tests/editor-check.mjs)
const viewFor = (path: string): EditorView => (path.startsWith('maps/') ? views.plan : path.startsWith('operators/') || path === 'rig/skeleton.json' || path === 'rig/animation.json' ? views.rig : path.startsWith('gadgets/') ? views.gadget : views.weapon);

/** an edit landed in `path`: undo history, tables rebuilt, "unsaved" marks */
function afterEdit(path: string) {
  edited(path);
  if (path.startsWith('weapons/') || path.startsWith('optics/')) reloadWeapons();
  if (path.startsWith('operators/')) reloadOperators();
  markDirty();
}

function markDirty() {
  const d = dirtyPaths();
  status.textContent = d.length ? `저장 안 됨: ${d.length}개 파일` : '모두 저장됨';
  status.classList.toggle('dirty', d.length > 0);
  for (const el of tree.querySelectorAll<HTMLElement>('.file')) el.classList.toggle('dirty', isDirty(el.dataset.path!));
}

const GROUPS: [string, string][] = [['weapons/', '총기'], ['optics/', '조준경'], ['operators/', '오퍼레이터'], ['gadgets/', '가젯'], ['rig/', '리그 (골격·애니메이션·1인칭)'], ['maps/house/', '맵: 하우스']];
function renderTree() {
  tree.innerHTML = '';
  for (const [pre, title] of GROUPS) {
    const d = document.createElement('details');
    d.open = true;
    const s = document.createElement('summary');
    s.textContent = title;
    d.append(s);
    const paths = Object.keys(files).filter((p) => p.startsWith(pre)).sort((a, b) => ((files[a].order as number) ?? 1e9) - ((files[b].order as number) ?? 1e9) || a.localeCompare(b));
    for (const p of paths) {
      const f = document.createElement('div');
      f.className = 'file' + (p === current ? ' sel' : '');
      f.dataset.path = p;
      const name = files[p].name as string | undefined;
      f.textContent = `${p.slice(pre.length, -5)}${name && name.toLowerCase() !== p.slice(pre.length, -5) ? ` · ${name}` : ''}`;
      f.onclick = () => open(p);
      d.append(f);
    }
    if (['weapons/', 'operators/', 'gadgets/'].includes(pre)) {
      const b = document.createElement('button');
      b.className = 'new';
      b.textContent = '+ 선택한 것 복제해서 새로 만들기';
      b.onclick = () => duplicate(pre);
      d.append(b);
    }
    tree.append(d);
  }
  markDirty();
}

function duplicate(pre: string) {
  const src = current?.startsWith(pre) ? current : Object.keys(files).find((p) => p.startsWith(pre))!;
  const id = prompt('새 ID (영문 소문자, 숫자, _ ):', `${files[src].id}_copy`)?.trim();
  if (!id || !/^[a-z0-9_]+$/.test(id)) return;
  const path = `${pre}${id}.json`;
  if (files[path]) { alert('이미 있는 ID입니다'); return; }
  const v = structuredClone(files[src]);
  v.id = id;
  if (typeof v.order === 'number') v.order = Math.max(...Object.keys(files).filter((p) => p.startsWith(pre)).map((p) => (files[p].order as number) ?? 0)) + 1;
  if ((v.model as { glb?: string })?.glb) delete (v.model as { glb?: string }).glb;
  addFile(path, v);
  afterEdit(path);
  renderTree();
  open(path);
}

function renderInspector() {
  inspector.innerHTML = '';
  if (!current) { inspector.textContent = '왼쪽에서 파일을 고르세요.'; return; }
  const h2 = document.createElement('h2');
  const sel = view?.selection?.() ?? null;
  h2.textContent = sel ? sel.title : String(files[current].name ?? current);
  const p = document.createElement('div');
  p.className = 'path';
  p.textContent = `data/${sel ? sel.where ?? sel.path : current}`;
  inspector.append(h2, p);
  const extra = view?.panel?.();
  if (extra) inspector.append(extra);
  if (sel) {
    if (sel.remove) {
      const del = document.createElement('button');
      del.textContent = '🗑 이 요소 삭제';
      del.onclick = () => { sel.remove!(); ctx.changed(sel.path); renderInspector(); };
      inspector.append(del);
    }
    inspector.append(buildForm(sel.obj, sel.schema, () => ctx.changed(sel.path), { open: 3 }));
  } else {
    inspector.append(buildForm(files[current], schemaOf(current), () => ctx.changed()));
  }
}

function open(path: string) {
  if (!files[path]) return;
  view?.close();
  current = path;
  location.hash = path;
  for (const el of tree.querySelectorAll<HTMLElement>('.file')) el.classList.toggle('sel', el.dataset.path === path);
  ctx.toolbar.innerHTML = '';
  ctx.hint.textContent = '';
  view = viewFor(path);
  const isPlan = view === views.plan;
  plan.style.display = isPlan ? 'block' : 'none';
  $('view').style.display = isPlan ? 'none' : 'block';
  view.open(path);
  renderInspector();
}

async function saveAll() {
  const d = dirtyPaths();
  try {
    const where: string[] = [];
    for (const p of d) where.push(await save(p));
    status.textContent = d.length ? `저장했습니다 (${d.length}개): ${where.join(' · ')}` : '바뀐 것이 없습니다';
    status.classList.remove('dirty');
    for (const el of tree.querySelectorAll<HTMLElement>('.file')) el.classList.toggle('dirty', isDirty(el.dataset.path!));
  } catch (e) {
    status.textContent = `저장 실패: ${(e as Error).message}`;
    status.classList.add('dirty');
  }
}
function doUndo() {
  const p = undo();
  if (!p) return;
  if (p.startsWith('weapons/') || p.startsWith('optics/')) reloadWeapons();
  if (p.startsWith('operators/')) reloadOperators();
  if (p === current) { view?.refresh(); renderInspector(); } else open(p);
  markDirty();
}

// a link / the address bar names a file (#weapons/l85a2.json)
addEventListener('hashchange', () => { const p = decodeURIComponent(location.hash.slice(1)); if (p !== current && p in files) open(p); });
// panel widths: drag the splitters (double-click folds a panel); remembered per browser
function splitter(id: string, varName: '--left' | '--right', sign: 1 | -1, def: number) {
  const el = $(id);
  const key = `r6.editor${varName}`;
  const set = (w: number) => { document.body.style.setProperty(varName, `${Math.round(w)}px`); try { localStorage.setItem(key, String(Math.round(w))); } catch { /* private mode */ } };
  let w = def;
  try { w = Number(localStorage.getItem(key)) || def; } catch { /* private mode */ }
  set(w);
  el.onpointerdown = (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const x0 = e.clientX, w0 = parseFloat(getComputedStyle(document.body).getPropertyValue(varName));
    el.onpointermove = (m) => set(Math.min(innerWidth * 0.6, Math.max(0, w0 + sign * (m.clientX - x0))));
    el.onpointerup = () => { el.onpointermove = null; el.classList.remove('drag'); view3d.resize(); views.plan.draw(); };
  };
  el.ondblclick = () => { const cur = parseFloat(getComputedStyle(document.body).getPropertyValue(varName)); set(cur < 40 ? def : 0); view3d.resize(); views.plan.draw(); };
}
splitter('split-left', '--left', 1, 230);
splitter('split-right', '--right', -1, 420);
$('save').onclick = saveAll;
$('undo').onclick = doUndo;
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAll(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); doUndo(); }
});
addEventListener('beforeunload', (e) => { if (dirtyPaths().length) e.preventDefault(); });
// a data file changed on disk outside the editor (hand edit, git): offer to reload
if (import.meta.hot) import.meta.hot.on('r6:data', (d: { path: string }) => {
  status.textContent = `디스크에서 바뀜: data/${d.path} — 새로고침하면 반영됩니다`;
  status.classList.add('dirty');
});

renderTree();
await preloadGlbAssets(['weapon', 'operator', 'gadget'], '/assets/models/');
open(decodeURIComponent(location.hash.slice(1)) in files ? decodeURIComponent(location.hash.slice(1)) : 'weapons/l85a2.json');
