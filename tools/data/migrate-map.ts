// One-off: writes data/maps/house/*.json from src/map/houseLayout.ts + houseProps.ts (world metres, values unchanged; the
// source comments become `note` / `group` fields).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as L from '../../src/map/houseLayout.ts';
import { PROPS } from '../../src/map/houseProps.ts';
import { formatJson } from '../../src/data/format.ts';

const DIR = 'data/maps/house';
mkdirSync(DIR, { recursive: true });
const out = (name: string, schema: string, v: Record<string, unknown>) => writeFileSync(`${DIR}/${name}.json`, formatJson({ $schema: `../../schema/${schema}.schema.json`, ...v }));
const deg = (r: number) => (r * 180) / Math.PI;

/** the comments of a top-level array literal, per element: trailing `// …` → note, comment lines before it → group */
function comments(file: string, start: string): { note?: string; group?: string }[] {
  const src = readFileSync(file, 'utf8').split('\n');
  let i = src.findIndex((l) => l.startsWith(start));
  const res: { note?: string; group?: string }[] = [];
  let pending: string[] = [];
  let spread = 0;
  let inner: { note?: string; group?: string }[] = [];
  for (i++; i < src.length && !src[i].startsWith(']'); i++) {
    const l = src[i];
    if (/^ {2}\/\//.test(l)) { pending.push(l.trim().replace(/^\/\/\s?/, '').replace(/[-=]{3,}\s*/g, '').trim()); continue; }
    if (/^ {2}\/\*/.test(l)) { pending = []; continue; }
    // a spread (`...[a, b].flatMap(… => [prop(…), prop(…)])`): its inner element lines are the elements
    if (/^ {2}\.\.\./.test(l)) { spread = (l.match(/\[([^\]]*)\]/)?.[1].split(',').length ?? 1); inner = []; continue; }
    if (spread && /^ {2}\]/.test(l)) { for (let k = 0; k < spread; k++) res.push(...inner); spread = 0; continue; }
    if (spread ? /^ {4}\S/.test(l) : /^ {2}\S/.test(l)) {
      const m = l.match(/\/\/\s?(.*)$/);
      (spread ? inner : res).push({ ...(m ? { note: m[1].trim() } : {}), ...(pending.length ? { group: pending.join(' ') } : {}) });
      pending = [];
    }
  }
  return res;
}
const withNotes = <T extends object>(items: T[], c: { note?: string; group?: string }[]) => {
  if (c.length !== items.length) throw new Error(`comments ${c.length} ≠ items ${items.length}`);
  return items.map((x, i) => ({ ...(c[i].group ? { group: c[i].group } : {}), ...x, ...(c[i].note ? { note: c[i].note } : {}) }));
};
const wall = (w: L.WallDef) => ({ floor: w.floor, run: w.run, c: w.c, from: w.from, to: w.to, tier: w.tier, ext: w.ext || undefined, t: w.t, h: w.h, openings: w.openings?.length ? w.openings : undefined, spans: w.spans });

out('map', 'map', {
  name: 'House', note: 'World metres: +X east, +Y up, +Z south (north = −Z). Floors B = −1, 1F = 0, 2F = 1.',
  floors: { '-1': { label: 'B', y: L.FLOOR_Y[-1] }, '0': { label: '1F', y: L.FLOOR_Y[0] }, '1': { label: '2F', y: L.FLOOR_Y[1] } },
  wallHeight: L.WALL_H, slab: L.SLAB_T, roofY: L.ROOF_Y, lowerGroundY: L.LOWER_GROUND_Y, cell: L.CELL, panelMaxWidth: L.PANEL_MAX_W,
  roofPitch: deg(L.ROOF_PITCH), roofOverhang: L.ROOF_OVERHANG,
  yard: L.YARD, openings: L.OPENING_DIMS,
  bounds: L.MAP_BOUNDS, houseRect: L.HOUSE_RECT, driveway: L.DRIVEWAY, ventShaft: L.VENT_SHAFT, garageVentWell: L.GARAGE_VENT_WELL, deckSteps: L.DECK_STEPS,
});
out('walls', 'walls', { walls: withNotes(L.WALLS.map(wall), comments('src/map/houseLayout.ts', 'export const WALLS')), diagonal: L.DIAG_WALLS });
const hatchOf = new Map(L.HATCHES.map((h) => [h.rect, h.id]));
const holeName = new Map<L.Rect, string>([[L.STAIR_HOLES.main, 'stairs:main'], [L.STAIR_HOLES.basement, 'stairs:basement']]);
out('floors', 'floors', {
  floors: withNotes(L.FLOORS.map((f) => ({ ...f, holes: f.holes?.map((h) => hatchOf.get(h) ?? holeName.get(h) ?? h) })), comments('src/map/houseLayout.ts', 'export const FLOORS')),
  roofs: L.ROOFS,
  hatches: L.HATCHES,
});
out('stairs', 'stairs', {
  stairs: withNotes(L.STAIRS, comments('src/map/houseLayout.ts', 'export const STAIRS')),
  landings: L.LANDINGS, mainLanding: L.MAIN_LANDING, backStairwell: L.BACK_STAIRWELL, nwStairwellPit: L.NW_STAIRWELL_PIT, holes: L.STAIR_HOLES,
});
out('rooms', 'rooms', { rooms: withNotes(L.ROOMS, comments('src/map/houseLayout.ts', 'export const ROOMS: RoomDef[] = (')) });
out('spawns', 'spawns', { spawns: L.SPAWN_ZONES, cameras: L.CCTVS.map(({ yaw, ...c }) => ({ ...c, yawDeg: deg(yaw) })) });
out('props', 'props', { props: withNotes(PROPS, comments('src/map/houseProps.ts', 'export const PROPS')) });
console.log('map written');
