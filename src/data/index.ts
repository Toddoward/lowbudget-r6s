import { FILES } from '#data-files';

/**
 * The game's data (data/ at the repository root, one JSON file per weapon, optic, operator, gadget, map part …; see
 * docs/DATA.md). Each file carries a `$schema` for editor validation; it is dropped here.
 */
const strip = <T>(v: unknown): T => {
  if (v && typeof v === 'object' && !Array.isArray(v) && '$schema' in v) {
    const { $schema: _s, ...rest } = v as Record<string, unknown>;
    return rest as T;
  }
  return v as T;
};

/** one file, by its path under data/ (e.g. `rig/skeleton.json`) */
export function dataFile<T>(path: string): T {
  if (!(path in FILES)) throw new Error(`data/${path} is missing`);
  return strip<T>(FILES[path]);
}

/** every file of a folder (e.g. `weapons`) keyed by file name, in `order` then name order */
export function dataDir<T>(dir: string): Record<string, T> {
  const pre = `${dir}/`;
  const items = Object.keys(FILES)
    .filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
    .map((k) => [k.slice(pre.length, -5), strip<T & { order?: number }>(FILES[k])] as const);
  items.sort((a, b) => (a[1].order ?? 1e9) - (b[1].order ?? 1e9) || a[0].localeCompare(b[0]));
  return Object.fromEntries(items) as Record<string, T>;
}
