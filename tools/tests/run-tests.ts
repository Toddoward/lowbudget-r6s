// `npm test` → node --test over tools/tests/*.test.ts (type-stripping incl. enums)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.ts')).map((f) => join(here, f));
const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
