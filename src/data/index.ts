import { FILES } from '#data-files';

/**
 * The game's data (data/ at the repository root, one JSON file per weapon, optic, operator, gadget, map part …; see
 * docs/DATA.md). The objects returned are the loaded files themselves (their `$schema` key included), shared by every
 * reader: the editor edits them in place and the game sees the change (values read at use; tables built at load are
 * rebuilt with their module's reload function).
 */
export { FILES };

/** one file, by its path under data/ (e.g. `rig/skeleton.json`) */
export function dataFile<T>(path: string): T {
  if (!(path in FILES)) throw new Error(`data/${path} is missing`);
  return FILES[path] as T;
}

/** every file of a folder (e.g. `weapons`) keyed by file name, in `order` then name order */
export function dataDir<T>(dir: string): Record<string, T> {
  const pre = `${dir}/`;
  const items = Object.keys(FILES)
    .filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
    .map((k) => [k.slice(pre.length, -5), FILES[k] as T & { order?: number }] as const);
  items.sort((a, b) => (a[1].order ?? 1e9) - (b[1].order ?? 1e9) || a[0].localeCompare(b[0]));
  return Object.fromEntries(items) as Record<string, T>;
}
