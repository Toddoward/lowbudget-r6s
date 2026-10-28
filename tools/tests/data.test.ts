// The data files (data/**): each one valid against its JSON Schema (data/schema/), and the links between them hold —
// loadouts name existing weapons and gadgets, weapons name existing optics, linked models exist on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { FILES } from '../../src/data/files.node.ts';
import { OPTICS, WEAPONS } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';
import { GADGETS } from '../../src/game/Gadgets.ts';

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const f of readdirSync('data/schema')) ajv.addSchema(JSON.parse(readFileSync(join('data/schema', f), 'utf8')), f);

test('every data file names a schema and is valid against it', () => {
  assert.ok(Object.keys(FILES).length > 50);
  for (const [path, v] of Object.entries(FILES)) {
    const ref = (v as { $schema?: string }).$schema;
    assert.ok(ref, `data/${path}: no $schema`);
    const name = ref!.split('/').pop()!;
    const validate = ajv.getSchema(name);
    assert.ok(validate, `data/${path}: unknown schema ${ref}`);
    assert.ok(validate!(v), `data/${path}: ${ajv.errorsText(validate!.errors, { separator: '\n  ' })}`);
  }
});

test('ids match file names, and the links between files hold', () => {
  for (const [path, v] of Object.entries(FILES)) {
    const id = (v as { id?: string }).id;
    if (id !== undefined) assert.equal(id, path.split('/').pop()!.replace(/\.json$/, ''), `data/${path}: id`);
  }
  for (const w of Object.values(WEAPONS)) assert.ok(OPTICS[w.style.optic], `${w.id}: optic ${w.style.optic}`);
  for (const o of Object.values(OPERATORS)) {
    assert.ok(WEAPONS[o.primary] && WEAPONS[o.secondary], `${o.id}: weapons ${o.primary} / ${o.secondary}`);
    assert.ok(o.gadget === 'none' || GADGETS[o.gadget], `${o.id}: gadget ${o.gadget}`);
  }
  for (const [path, v] of Object.entries(FILES)) {
    const glb = (v as { model?: { glb?: string } }).model?.glb;
    if (glb) assert.ok(existsSync(join('public/assets/models', glb)), `data/${path}: model ${glb} missing`);
  }
});
