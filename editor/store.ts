import { FILES } from '../src/data/index.ts';
import type { Schema } from './form.ts';

/**
 * The editor's state: the game's own loaded data objects (edited in place, so every preview built from the game's
 * modules sees the change), what is on disk (for "unsaved"), an undo history, and saving through the dev server.
 */
export const files = FILES as Record<string, Record<string, unknown>>;
const schemaFiles = import.meta.glob<Schema>('../data/schema/*.json', { eager: true, import: 'default' });
const SCHEMAS = Object.fromEntries(Object.entries(schemaFiles).map(([k, v]) => [k.split('/').pop()!, v]));
export const schemaOf = (path: string): Schema | undefined => SCHEMAS[String(files[path]?.$schema ?? '').split('/').pop()!];
export const schemaByName = (name: string): Schema | undefined => SCHEMAS[`${name}.schema.json`];

const onDisk = new Map<string, string>(Object.entries(files).map(([k, v]) => [k, JSON.stringify(v)]));
export const isDirty = (path: string) => JSON.stringify(files[path]) !== onDisk.get(path);
export const dirtyPaths = () => Object.keys(files).filter(isDirty);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** make `target` equal to `source` without replacing the objects / arrays other modules hold */
export function assignDeep(target: Record<string, unknown> | unknown[], source: Record<string, unknown> | unknown[]) {
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = 0;
    target.push(...structuredClone(source));
    return;
  }
  const t = target as Record<string, unknown>, s = source as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!(k in s)) delete t[k];
  for (const [k, v] of Object.entries(s)) {
    if ((isObj(t[k]) && isObj(v)) || (Array.isArray(t[k]) && Array.isArray(v))) assignDeep(t[k] as Record<string, unknown>, v as Record<string, unknown>);
    else t[k] = structuredClone(v);
  }
}

/* undo: the file as it was before each burst of edits (a burst: edits to one file less than 0.8 s apart) */
const history: { path: string; before: string }[] = [];
const shadow = new Map(onDisk);
let lastTouch = { path: '', t: 0 };
/** call after every edit of a file */
export function edited(path: string) {
  const now = performance.now();
  if (!(lastTouch.path === path && now - lastTouch.t < 800)) {
    history.push({ path, before: shadow.get(path) ?? JSON.stringify(files[path]) });
    if (history.length > 200) history.shift();
  }
  lastTouch = { path, t: now };
  shadow.set(path, JSON.stringify(files[path]));
}
/** the last edit burst's file, restored; null when there is nothing to undo */
export function undo(): string | null {
  const h = history.pop();
  if (!h) return null;
  assignDeep(files[h.path], JSON.parse(h.before));
  shadow.set(h.path, h.before);
  lastTouch = { path: '', t: 0 };
  return h.path;
}

export async function save(path: string): Promise<void> {
  const res = await fetch(`/__editor/data/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(files[path]) });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  onDisk.set(path, JSON.stringify(files[path]));
}

/** a new data file (duplicated entity): added to the loaded data, written on save */
export function addFile(path: string, value: Record<string, unknown>) {
  files[path] = value;
  onDisk.set(path, '');
  shadow.set(path, JSON.stringify(value));
}

/** upload a GLB to public/assets/models/handmade/<name>; returns its path under public/assets/models/ */
export async function uploadModel(name: string, data: ArrayBuffer): Promise<string> {
  const res = await fetch(`/__editor/model/${name}`, { method: 'PUT', body: data });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j.glb as string;
}
