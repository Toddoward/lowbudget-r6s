/// <reference types="node" />
// The same `data/**/*.json` for Node (unit tests, asset tools), read from disk at import.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../data/', import.meta.url));
// (data/schema/ holds the JSON Schemas, not data)
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'schema' ? [] : walk(join(dir, e.name))) : e.name.endsWith('.json') ? [join(dir, e.name)] : []));
export const FILES: Record<string, unknown> = Object.fromEntries(walk(root).map((f) => [relative(root, f).split('\\').join('/'), JSON.parse(readFileSync(f, 'utf8'))]));
