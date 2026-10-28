// Dumps the evaluated game tables (for before/after comparison of a data migration): node … snapshot.ts <out.json>
import { writeFileSync } from 'node:fs';
import { WEAPONS, weaponSpec, OPTIC_ZOOM } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';
import { operatorSpec } from '../../src/assets/operatorModels.ts';
const out: Record<string, unknown> = {
  weapons: WEAPONS,
  weaponSpecs: Object.fromEntries(Object.keys(WEAPONS).map((id) => [id, weaponSpec(id)])),
  opticZoom: OPTIC_ZOOM,
  operators: OPERATORS,
  operatorSpecs: Object.fromEntries(Object.values(OPERATORS).map((o) => [o.id, operatorSpec(o)])),
  order: { weapons: Object.keys(WEAPONS), operators: Object.keys(OPERATORS) },
};
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
