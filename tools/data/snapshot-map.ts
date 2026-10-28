// Dumps the evaluated House map exports (for before/after comparison of a data migration): node … snapshot-map.ts <out.json>
import { writeFileSync } from 'node:fs';
import * as L from '../../src/map/houseLayout.ts';
import * as Pr from '../../src/map/houseProps.ts';
const plain = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v !== 'function'));
writeFileSync(process.argv[2], JSON.stringify({ layout: plain(L), props: plain(Pr), roofPoints: L.ROOFS.map(L.roofPoints), zone: [[0, 5, 0], [3, 3.6, -8.5], [12, -3.4, 0], [-20, -1, -30]].map(([x, y, z]) => L.exteriorZoneName(x, y, z)) }, null, 1));
