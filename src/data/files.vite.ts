/** Every `data/**\/*.json`, bundled at build time (no fetch at run time). In dev an edited file hot-reloads the page. */
const raw = import.meta.glob<unknown>(['../../data/**/*.json', '!../../data/schema/**'], { eager: true, import: 'default' });
export const FILES: Record<string, unknown> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/^.*?\/data\//, ''), v]));
