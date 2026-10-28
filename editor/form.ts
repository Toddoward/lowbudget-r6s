/**
 * A form for a JSON value from its JSON Schema: the field titles, units and help come from the schema (data/schema/).
 * Edits write straight into the value (the shared data object) and call `changed`. Fields without a schema are inferred
 * from the value (numbers, [x, y, z], nested objects).
 */
export interface Schema {
  type?: string | string[]; title?: string; description?: string; enum?: unknown[]; pattern?: string;
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema;
  items?: Schema; minItems?: number; maxItems?: number; oneOf?: Schema[]; minimum?: number; maximum?: number;
}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** a default value for a schema (new array items, optional fields switched on) */
export function defaultOf(s: Schema | undefined): unknown {
  if (!s) return 0;
  if (s.oneOf) return defaultOf(s.oneOf.find((x) => x.type !== 'null'));
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'number': case 'integer': return s.minimum ?? 0;
    case 'string': return s.pattern?.includes('#') ? '#808080' : '';
    case 'boolean': return false;
    case 'array': return s.minItems && s.minItems === s.maxItems ? Array.from({ length: s.minItems }, () => defaultOf(s.items)) : [];
    case 'object': return Object.fromEntries((s.required ?? []).map((k) => [k, defaultOf(s.properties?.[k])]));
  }
  return null;
}

/** what to call an array item in its summary line */
export function itemName(v: unknown, i: number): string {
  if (!isObj(v)) return `#${i + 1}`;
  const name = v.id ?? v.label ?? v.name ?? v.type ?? (v.kind ? `${v.kind} @ ${v.at}` : undefined);
  const note = typeof v.note === 'string' ? ` — ${v.note}` : '';
  if (name !== undefined) return `${name}${note}`;
  if ('run' in v) return `${v.run === 'x' ? '─' : '│'} ${v.floor === -1 ? 'B' : v.floor === 0 ? '1F' : '2F'} c ${v.c} (${v.from} … ${v.to})${note}`;
  return `#${i + 1}${note}`;
}

export function buildForm(value: Obj, schema: Schema | undefined, changed: () => void, opts: { open?: number } = {}): HTMLElement {
  const root = h('div', 'form');
  root.append(fields(value, schema, changed, opts.open ?? 2));
  return root;
}

function label(key: string, s?: Schema) {
  const l = h('label', 'k', s?.title ? `${s.title}` : key);
  l.title = `${key}${s?.description ? `\n${s.description}` : ''}`;
  if (s?.title && s.title !== key) { const k = h('span', 'key', key); l.append(' ', k); }
  return l;
}

function fields(obj: Obj, s: Schema | undefined, changed: () => void, depth: number): HTMLElement {
  const box = h('div', 'fields');
  const props = s?.properties ?? {};
  const keys = [...Object.keys(props).filter((k) => k !== '$schema'), ...Object.keys(obj).filter((k) => !(k in props) && k !== '$schema')];
  for (const k of keys) {
    const ps = props[k] ?? (isObj(s?.additionalProperties) ? s!.additionalProperties : undefined);
    const present = k in obj && obj[k] !== undefined;
    const required = s?.required?.includes(k) ?? false;
    if (!present) {
      if (required) obj[k] = defaultOf(ps);
      else {
        const add = h('button', 'add', `+ ${ps?.title ?? k}`);
        add.title = ps?.description ?? k;
        add.onclick = () => { obj[k] = defaultOf(ps); changed(); box.replaceWith(fields(obj, s, changed, depth)); };
        box.append(add);
        continue;
      }
    }
    const row = h('div', 'row');
    row.append(label(k, ps));
    row.append(field(obj, k, ps, changed, depth));
    if (!required) {
      const del = h('button', 'del', '×');
      del.title = '이 값 지우기';
      del.onclick = () => { delete obj[k]; changed(); box.replaceWith(fields(obj, s, changed, depth)); };
      row.append(del);
    }
    box.append(row);
  }
  return box;
}

function field(obj: Obj | unknown[], k: string | number, s: Schema | undefined, changed: () => void, depth: number): HTMLElement {
  const v = (obj as Obj)[k as string];
  const set = (x: unknown) => { (obj as Obj)[k as string] = x; changed(); };
  const nullable = s?.oneOf?.some((x) => x.type === 'null');
  if (nullable) {
    const inner = s!.oneOf!.find((x) => x.type !== 'null');
    const wrap = h('div', 'nullable');
    const on = h('input') as HTMLInputElement;
    on.type = 'checkbox';
    on.checked = v !== null && v !== undefined;
    on.title = '사용';
    on.onchange = () => { set(on.checked ? defaultOf(inner) : null); wrap.replaceWith(field(obj, k, s, changed, depth)); };
    wrap.append(on);
    if (on.checked) wrap.append(field(obj, k, inner, changed, depth));
    return wrap;
  }
  if (s?.oneOf && !nullable) {
    // a rect or a name (floor holes)
    if (typeof v === 'string') return text(v, set);
    return field(obj, k, s.oneOf.find((x) => x.type === 'object') ?? s.oneOf[0], changed, depth);
  }
  const type = s?.type ?? (typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'array' : isObj(v) ? 'object' : 'string');
  if (s?.enum) {
    const sel = h('select') as HTMLSelectElement;
    for (const e of s.enum) { const o = h('option', undefined, String(e)); o.value = JSON.stringify(e); sel.append(o); }
    sel.value = JSON.stringify(v);
    sel.onchange = () => set(JSON.parse(sel.value));
    return sel;
  }
  if (type === 'number' || type === 'integer') return numberInput(v as number, set, type === 'integer');
  if (type === 'boolean') {
    const c = h('input') as HTMLInputElement;
    c.type = 'checkbox';
    c.checked = !!v;
    c.onchange = () => set(c.checked);
    return c;
  }
  if (type === 'string') {
    if (s?.pattern?.includes('#') || (typeof v === 'string' && /^#[0-9a-f]{3,6}$/i.test(v))) {
      const wrap = h('div', 'color');
      const c = h('input') as HTMLInputElement;
      c.type = 'color';
      const full = (x: string) => (x.length === 4 ? `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}` : x);
      c.value = full(String(v ?? '#808080'));
      const t = text(String(v ?? ''), (x) => { set(x); if (/^#[0-9a-f]{3,6}$/i.test(x)) c.value = full(x); });
      c.oninput = () => { set(c.value); (t as HTMLInputElement).value = c.value; };
      wrap.append(c, t);
      return wrap;
    }
    return text(String(v ?? ''), set);
  }
  if (type === 'array') {
    const arr = (Array.isArray(v) ? v : []) as unknown[];
    if (!Array.isArray(v)) (obj as Obj)[k as string] = arr;
    // fixed-length numbers ([x, y, z], [w, h]): inline
    if ((s?.items?.type === 'number' || (!s && arr.every((x) => typeof x === 'number'))) && arr.length <= 4) {
      const wrap = h('div', 'vec');
      arr.forEach((_, i) => wrap.append(numberInput(arr[i] as number, (x) => { arr[i] = x; changed(); })));
      return wrap;
    }
    if (arr.every((x) => typeof x === 'string') && s?.items?.enum) {
      const wrap = h('div', 'tags');
      const tags = arr as unknown[];
      for (const e of s.items.enum) {
        const c = h('label', 'tag');
        const cb = h('input') as HTMLInputElement;
        cb.type = 'checkbox';
        cb.checked = tags.includes(e);
        cb.onchange = () => { const i = tags.indexOf(e); if (cb.checked && i < 0) tags.push(e); if (!cb.checked && i >= 0) tags.splice(i, 1); changed(); };
        c.append(cb, String(e));
        wrap.append(c);
      }
      return wrap;
    }
    return list(arr, s?.items, changed, depth);
  }
  if (type === 'object') {
    const o = (isObj(v) ? v : {}) as Obj;
    if (!isObj(v)) (obj as Obj)[k as string] = o;
    const d = h('details', 'obj');
    d.open = depth > 0;
    const sum = h('summary', undefined, s?.description ? s.description : '');
    d.append(sum, fields(o, s, changed, depth - 1));
    return d;
  }
  return text(JSON.stringify(v), (x) => { try { set(JSON.parse(x)); } catch { /* not JSON yet */ } });
}

function list(arr: unknown[], s: Schema | undefined, changed: () => void, depth: number): HTMLElement {
  const wrap = h('div', 'list');
  const redraw = () => wrap.replaceWith(list(arr, s, changed, depth));
  arr.forEach((item, i) => {
    const d = h('details', 'item');
    const sum = h('summary', undefined, itemName(item, i));
    const tools = h('span', 'tools');
    const up = h('button', undefined, '↑'); up.title = '위로';
    up.onclick = (e) => { e.preventDefault(); if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; changed(); redraw(); } };
    const dup = h('button', undefined, '⧉'); dup.title = '복제';
    dup.onclick = (e) => { e.preventDefault(); arr.splice(i + 1, 0, structuredClone(item)); changed(); redraw(); };
    const del = h('button', undefined, '×'); del.title = '삭제';
    del.onclick = (e) => { e.preventDefault(); arr.splice(i, 1); changed(); redraw(); };
    tools.append(up, dup, del);
    sum.append(tools);
    d.append(sum);
    d.addEventListener('toggle', () => { if (d.open && d.children.length === 1) d.append(isObj(item) ? fields(item, s, () => { sum.firstChild!.textContent = itemName(item, i); changed(); }, depth - 1) : field(arr, i, s, changed, depth - 1)); });
    wrap.append(d);
  });
  const add = h('button', 'add', '+ 추가');
  add.onclick = () => { arr.push(arr.length ? structuredClone(arr[arr.length - 1]) : defaultOf(s)); changed(); redraw(); };
  wrap.append(add);
  return wrap;
}

function numberInput(v: number, set: (x: number) => void, integer = false): HTMLElement {
  const n = h('input') as HTMLInputElement;
  n.type = 'number';
  n.step = integer ? '1' : 'any';
  n.value = String(v ?? 0);
  n.oninput = () => { const x = Number(n.value); if (n.value !== '' && Number.isFinite(x)) set(integer ? Math.round(x) : x); };
  // wheel / arrow keys: ±0.001 (Shift ×10, Alt ×0.1)
  n.onkeydown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' || integer) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.01 : e.altKey ? 0.0001 : 0.001) * (e.key === 'ArrowUp' ? 1 : -1);
    const x = Math.round((Number(n.value) + step) * 1e6) / 1e6;
    n.value = String(x);
    set(x);
  };
  return n;
}

function text(v: string, set: (x: string) => void): HTMLElement {
  const t = h('input') as HTMLInputElement;
  t.type = 'text';
  t.value = v;
  t.oninput = () => set(t.value);
  return t;
}
