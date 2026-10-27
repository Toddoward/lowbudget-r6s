/**
 * Original House (2015) — rebuilt from the Sketchfab tactical model
 * ("Rainbow Six Siege - House Map" by crusader1291) plus the Rogue-9 map guide.
 *
 * How the numbers were made (tools/level/README.md has the full pipeline):
 *  - every wall face of 1F_0/1F_1, 2F_0/2F_1 and B1_0/B1_1 was sliced at door
 *    height and opposite faces were paired into wall slabs (the model's shells
 *    are not closed per mesh, so face pairing beats polygon filling);
 *  - plan coordinates were multiplied by 2.85 (≈32.4 × the model's local units,
 *    building ≈ 19.3 × 14.3 m) and the exploded floors were restacked at
 *    B = −3.5 m, 1F = 0, 2F = +3.5 m, roof = +7.0 m (3.2 m ceilings + 0.3 m slabs);
 *  - `_0` meshes → HARD walls, `_1` meshes → SOFT walls (the model calls that
 *    material "hard_barricade", but those are the breakable panels), and the
 *    spec's semi-breach list overrides both;
 *  - Cube…Cube.003 are the four hatches, Cylinder… the six CCTV cameras,
 *    Cube.004/.011/.014 the barricade positions. The two barricades whose
 *    bottom edge floats above the floor in the model are the two exterior
 *    doors (front door N, back door S) — the model already encodes the door
 *    barricade bottom gap. The unboardable open window sits right above the
 *    front door, exactly as in the guide.
 *
 * World axes: +X = East, +Y = Up, +Z = South (North = −Z). 1 unit = 1 m.
 *
 *  1F (y = 0)               N (−Z)  front porch + front door, Construction Site
 *   ┌──────────┐
 *   │  LIVING  │   ┌───────── LOBBY ─────────┬─────── OFFICE ──╮
 *   │  (hatch) │   │ main stairs ▲ (semi→)   │ (semi west wall)  ╲
 *   │          ├───┤ basement stairs ▼       ├─────────────────┐ │
 *   │          │   │                          │     DINING      │ (E: River Docks)
 *   ├──back────┼───┴─── KITCHEN (hatch) ─────┤ (hatch above)  │
 *   │ entrance │                              │                 │
 *   │ & side ▼ │                              │                 │
 *   └──stairs──┴────── S (+Z) back door, Side Street ───────────┘
 */
import { datamapZoneAt } from './houseDatamap.ts';
import { P } from './plan.ts';

export type FloorId = -1 | 0 | 1;
export const FLOOR_Y: Record<FloorId, number> = { [-1]: -3.5, 0: 0, 1: 3.5 };
export const FLOOR_LABEL: Record<FloorId, string> = { [-1]: 'B', 0: '1F', 1: '2F' };
/** floor → ceiling */
export const WALL_H = 3.2;
export const SLAB_T = 0.3;
/** exterior grade around the house: the front yard / treehouse alley level of the datamap (R = 182 → 0.0 m, level with the 1F floor) */
export const GROUND_Y = 0;
/** basement level outside: the garage driveway bay and the NW stairwell pit (datamap R = 55 → −3.5 m) */
export const LOWER_GROUND_Y = -3.5;
export const ROOF_Y = 7.0;
export const CELL = 0.25;
/** reinforcement-sized soft wall sections (the model's soft walls come in ~1.1–1.4 m panels) */
export const PANEL_MAX_W = 1.45;

export type SurfaceTier = 'solid' | 'soft' | 'semi';
export type OpeningKind = 'door' | 'exterior_door' | 'window' | 'french' | 'open_window' | 'arch' | 'shutter' | 'vent';

export interface OpeningDef {
  /** centre along the wall's run axis */
  at: number;
  w: number;
  kind: OpeningKind;
  /** overrides of the kind's sill height / height above the wall's floor, and whether it can be barricaded */
  y0?: number;
  h?: number;
  barricade?: boolean;
}
export interface SpanDef { from: number; to: number; tier: SurfaceTier }
export interface WallDef {
  floor: FloorId;
  /** 'x' = wall runs along X at constant z=c ; 'z' = wall runs along Z at constant x=c */
  run: 'x' | 'z';
  c: number;
  from: number;
  to: number;
  tier: SurfaceTier;
  ext?: boolean;
  openings?: OpeningDef[];
  /** sub-ranges with a different tier (e.g. a soft section inside a hard wall) */
  spans?: SpanDef[];
  /** thickness override */
  t?: number;
  /** height override (default WALL_H) */
  h?: number;
}
/** non-axis-aligned exterior walls (bay window, NE chamfer) — always solid */
export interface DiagWallDef { floor: FloorId; a: [number, number]; b: [number, number]; window?: { at: number; w: number; y0?: number; h?: number; barricade?: boolean } }

export interface OpeningDims { y0: number; h: number; barricade: boolean; /** barricade starts this high (door bottom gap for drones / prone) */ gap: number }
/** an opening's dimensions: its kind's, with the opening's own overrides */
export function openingDims(o: { kind: OpeningKind; y0?: number; h?: number; barricade?: boolean }): OpeningDims {
  const d = OPENING_DIMS[o.kind];
  return { ...d, y0: o.y0 ?? d.y0, h: o.h ?? d.h, barricade: o.barricade ?? d.barricade };
}
export const OPENING_DIMS: Record<OpeningKind, OpeningDims> = {
  door: { y0: 0, h: 2.3, barricade: true, gap: 0.19 },
  exterior_door: { y0: 0, h: 2.35, barricade: true, gap: 0.19 },
  arch: { y0: 0, h: 2.5, barricade: false, gap: 0 },
  window: { y0: 0.95, h: 1.4, barricade: true, gap: 0 },
  french: { y0: 0.05, h: 2.3, barricade: true, gap: 0 },
  open_window: { y0: 0.95, h: 1.4, barricade: false, gap: 0 },
  shutter: { y0: 0, h: 2.9, barricade: false, gap: 0 },
  vent: { y0: 0.0, h: 0.25, barricade: false, gap: 0 },
};

// every constructor below takes traced plan coordinates and stores world metres (× PLAN, see plan.ts)
const W = (floor: FloorId, run: 'x' | 'z', c: number, from: number, to: number, tier: SurfaceTier, openings: OpeningDef[] = [], ext = false, spans?: SpanDef[]): WallDef =>
  ({ floor, run, c: P(c), from: P(from), to: P(to), tier, openings, ext, spans });
const E = (floor: FloorId, run: 'x' | 'z', c: number, from: number, to: number, openings: OpeningDef[] = []): WallDef => W(floor, run, c, from, to, 'solid', openings, true);
const door = (at: number, w = 1.0): OpeningDef => ({ at: P(at), w: P(w), kind: 'door' });
const xdoor = (at: number, w = 1.1): OpeningDef => ({ at: P(at), w: P(w), kind: 'exterior_door' });
const win = (at: number, w = 1.0): OpeningDef => ({ at: P(at), w: P(w), kind: 'window' });
const french = (at: number, w = 0.9): OpeningDef => ({ at: P(at), w: P(w), kind: 'french' });
const arch = (at: number, w = 1.5): OpeningDef => ({ at: P(at), w: P(w), kind: 'arch' });
/** drone vents keep their size (45 × 25 cm) */
const vent = (at: number): OpeningDef => ({ at: P(at), w: 0.45, kind: 'vent' });
const shutter = (at: number, w: number): OpeningDef => ({ at: P(at), w: P(w), kind: 'shutter' });
const openWin = (at: number, w: number): OpeningDef => ({ at: P(at), w: P(w), kind: 'open_window' });
const S = (from: number, to: number, tier: SurfaceTier): SpanDef => ({ from: P(from), to: P(to), tier });
/**
 * The back stairwell's bay windows (three faces): at the 1F → 2F half landing, not at 1F — sill 2.0 m over 1F, so nobody on the
 * ground outside is seen from inside or sees in — and a row of upper windows above them (2F), unboardable, through which 2F is
 * seen from rappel or watchtower height.
 */
const BAY_LOW = { y0: 2.0, h: 1.15 };
const BAY_HIGH = { y0: 0.35, h: 0.9, barricade: false };

export const WALLS: WallDef[] = [
  /* ============================== BASEMENT (−3.5) ============================== */
  // exterior (underground concrete) — the garage façade is the only one above grade
  E(-1, 'x', -7.4, -7.25, -1.7, [vent(-4.5)]), // storage N (+ vent from the yard shaft)
  E(-1, 'z', -7.25, -7.4, -2.45, [vent(-7.05), xdoor(-6.25, 1.0)]), // storage W → exterior NW stairwell (+ the datamap's B-level drone vent at the NW corner)
  E(-1, 'x', -2.45, -7.95, -7.25),
  E(-1, 'z', -7.95, -2.45, 0.55),
  E(-1, 'x', 0.55, -8.65, -7.95),
  E(-1, 'z', -8.65, 0.55, 1.1),
  E(-1, 'z', -9.45, 1.75, 2.65),
  E(-1, 'z', -8.65, 3.25, 3.7),
  E(-1, 'x', 3.7, -8.65, -5.45),
  E(-1, 'z', -5.45, 3.7, 6.45),
  E(-1, 'x', 6.45, -5.45, 2.05),
  E(-1, 'z', 2.05, 4.85, 6.45),
  E(-1, 'x', 4.85, 2.05, 9.7),
  // garage shutter A (3 reinforceable sections) + drone vent beside it
  E(-1, 'z', 9.7, -0.6, 4.85, [shutter(2.0, 3.6), vent(4.35)]),
  E(-1, 'x', -0.6, 7.2, 9.7), // hard pillar wall between the two shutters
  E(-1, 'z', 7.2, -4.8, -0.6, [shutter(-2.7, 3.2)]), // garage shutter B
  E(-1, 'x', -4.8, -1.7, 7.2),
  E(-1, 'z', -1.7, -7.4, -4.8),
  // interior
  W(-1, 'x', -4.8, -7.25, -1.7, 'soft', [door(-3.6)]), // storage | training — fully soft (wallbang city)
  W(-1, 'z', 0.35, -4.8, -0.95, 'soft'), // training | garage
  W(-1, 'x', -0.95, -2.35, 1.95, 'solid'), // training & garage | basement stairs
  { ...W(-1, 'z', 1.95, -0.95, 0.55, 'solid'), h: 2.85 }, // basement stairs | garage — under the top steps, up to their underside
  // closes the void under the upper basement steps (model) — only up to the steps' underside, the flight runs over it
  { ...W(-1, 'z', 0.26, -0.95, 0.55, 'solid'), h: 1.65 },
  W(-1, 'x', -0.6, 5.83, 7.2, 'solid'), // garage: stub wall west of the shutter pillar (model)
  W(-1, 'x', 0.55, -7.95, -5.28, 'solid'), // training | side stairs: the model's wall, open east of x −5.28
  W(-1, 'x', 0.55, -3.6, 1.95, 'solid', [], false, [S(-3.6, -2.15, 'soft')]), // training (NW part soft) & stairs | laundry
  W(-1, 'z', -3.6, 0.55, 3.7, 'soft'), // side stairs | laundry (no door in the model)
  W(-1, 'z', 1.95, 0.55, 4.85, 'soft', [door(4.25, 0.9)], false, [S(3.7, 4.85, 'solid')]), // laundry & back hall | garage
  W(-1, 'x', 3.7, -5.45, -3.6, 'solid', [door(-4.5)]), // side stairs | back hall
  // laundry ↔ back hall: one open space in the model (no wall)

  /* ================================ 1F (0) ================================== */
  // exterior: windows ×10 + front door + back door (matches the guide)
  E(0, 'x', -7.4, -7.25, -1.7, [win(-4.5, 1.25)]), // living N
  E(0, 'z', -7.25, -7.4, -2.45, [win(-3.25), vent(-4.4)]), // living W (+ drone vent from the west yard)
  E(0, 'x', -2.45, -7.95, -7.25),
  E(0, 'z', -7.95, -2.45, 0.55, [french(-1.4), french(-0.45)]), // living W french windows
  E(0, 'x', 0.55, -8.65, -7.95),
  E(0, 'z', -8.65, 0.55, 1.1),
  E(0, 'z', -9.45, 1.75, 2.65, [{ ...win(2.2, 0.8), ...BAY_LOW }]), // back stairwell bay: the half-landing window
  E(0, 'z', -8.65, 3.25, 3.75),
  E(0, 'x', 3.75, -8.65, -5.45),
  E(0, 'z', -5.45, 3.75, 4.85),
  E(0, 'x', 4.85, -5.45, 9.7, [xdoor(-4.3, 1.1)]), // south façade: back door (Side Street)
  E(0, 'z', 9.7, -0.6, 4.85, [win(0.95, 1.4)]), // dining E
  E(0, 'x', -0.6, 8.1, 9.7),
  E(0, 'z', 8.1, -2.45, -0.6),
  E(0, 'z', 8.3, -4.1, -2.45, [win(-3.4, 0.9)]), // office E
  E(0, 'x', -5.15, 4.35, 7.25, [french(6.6, 0.8), vent(4.8)]), // office N french window + porch→office drone vent
  E(0, 'z', 4.35, -5.15, -4.9),
  E(0, 'x', -4.9, -1.7, 4.35, [xdoor(0.1, 1.8)]), // FRONT DOOR (double)
  E(0, 'z', -1.7, -7.4, -4.9),
  // interior
  W(0, 'z', -1.75, -4.9, 0.6, 'semi', [arch(-3.55, 1.6)]), // living | lobby — semi (studs stay)
  W(0, 'x', 0.6, -7.95, 2.3, 'solid', [door(-3.85, 0.9)], false, [S(-5.4, -4.3, 'soft')]), // living | back entrance / kitchen | basement stairs
  W(0, 'x', -0.95, -1.75, 2.3, 'solid'), // lobby | basement stairs
  W(0, 'z', 4.3, -4.9, 4.85, 'soft', [arch(2.15, 2.5), vent(4.35)], false, [S(-4.9, -0.6, 'semi')]), // lobby|office (semi) · landing|dining · kitchen|dining
  W(0, 'x', -0.6, 4.3, 8.1, 'soft', [door(6.35, 0.9)]), // office | dining
  W(0, 'z', -3.15, 0.6, 4.85, 'semi', [arch(4.05, 1.5)]), // back entrance | kitchen (semi section on the kitchen's west side)
  W(0, 'x', 3.28, -3.15, -1.58, 'solid'), // kitchen pantry nook behind the back-entrance arch (model)

  /* ================================ 2F (3.5) ================================== */
  // exterior: windows ×12 + the unboardable open window
  E(1, 'x', -7.4, -7.25, -1.7, [win(-4.5, 1.25)]), // bathroom N
  E(1, 'z', -1.7, -7.4, -5.5, [win(-6.35)]), // bathroom E → porch roof
  E(1, 'x', -5.5, -1.7, 4.35, [openWin(-0.1, 1.6)]), // OPEN WINDOW over the front door
  E(1, 'z', 4.35, -5.5, -5.15),
  E(1, 'x', -5.15, 4.35, 7.25, [win(6.6, 0.9)]), // workshop N
  E(1, 'z', 8.3, -4.1, -2.45, [win(-3.4, 0.9)]), // workshop E
  E(1, 'z', 8.1, -2.45, -0.6),
  E(1, 'x', -0.6, 8.1, 9.7),
  E(1, 'z', 9.7, -0.6, 4.85),
  E(1, 'x', 4.85, -1.8, 9.7, [win(3.6, 1.2)]), // master S
  E(1, 'z', -1.8, 4.85, 6.6, [win(5.72, 0.9)]), // kids E
  E(1, 'x', 6.6, -7.25, -1.8, [win(-5.6), win(-3.1)]), // kids S ×2
  E(1, 'z', -7.25, 3.75, 6.6, [win(5.1, 1.2)]), // kids W
  E(1, 'x', 3.75, -8.65, -7.25),
  E(1, 'z', -8.65, 3.25, 3.75),
  E(1, 'z', -9.45, 1.75, 2.65, [{ ...win(2.2, 0.8), ...BAY_HIGH }]), // back stairwell bay: upper window
  E(1, 'z', -8.65, 0.55, 1.1),
  E(1, 'x', 0.55, -8.65, -7.95),
  E(1, 'z', -7.95, -2.45, 0.55),
  E(1, 'x', -2.45, -7.95, -7.25),
  E(1, 'z', -7.25, -7.4, -2.45),
  // interior — almost everything up here is soft (the guide's key point)
  W(1, 'x', -5.5, -7.25, -3.15, 'soft', [door(-5.2)]), // bathroom | west hall
  W(1, 'z', -3.15, -5.5, 2.2, 'soft', [door(-4.6), door(1.4, 1.2)]), // hall annex & upper hall | west hall
  W(1, 'x', -2.5, -3.15, -1.7, 'soft', [door(-2.43, 0.9)]), // hall annex | upper hall
  W(1, 'x', -5.5, -3.15, -1.7, 'soft'), // bathroom | hall annex (model)
  W(1, 'x', 0.55, -7.95, -4.48, 'soft'), // west hall partition (model): north part | south part, open east of x −4.48
  W(1, 'z', -1.7, -5.5, -2.5, 'soft', [vent(-4.6)]), // hall annex | upper hall (+ drone vent)
  W(1, 'z', 4.35, -5.15, 0.55, 'soft', [door(-0.08, 0.95)]), // upper hall | workshop · vestibule (the model's door is the vestibule's)
  W(1, 'x', -0.6, 4.35, 8.1, 'soft', [door(5.12, 1.0), door(6.55, 1.0)]), // workshop | vestibule · master (model: two doors)
  W(1, 'z', 5.85, -0.6, 0.55, 'soft'), // vestibule | master
  W(1, 'x', 0.55, 1.25, 5.85, 'soft', [door(2.0)]), // upper hall · vestibule | master
  W(1, 'z', 1.25, 0.55, 2.2, 'soft', [door(1.2, 1.0)]), // upper hall (south arm) | master
  W(1, 'x', 2.2, -5.55, 1.25, 'soft', [door(-2.55, 0.9)], false, [S(-1.8, 1.25, 'semi')]), // kids | halls · walk-in closet north (semi)
  W(1, 'z', -1.8, 2.2, 4.85, 'solid'), // kids | walk-in closet (bulletproof)
  W(1, 'z', 1.25, 2.2, 4.85, 'solid', [door(3.6, 0.9)]), // walk-in closet | master (bulletproof)
  W(1, 'z', -5.55, 2.2, 3.75, 'soft'), // kids | west hall
  W(1, 'x', 3.75, -7.25, -5.55, 'soft'), // kids | west hall
];

/** bay window + NE chamfer (the model's diagonal walls) */
export const DIAG_WALLS: DiagWallDef[] = (
  [
    ...([-1, 0, 1] as FloorId[]).flatMap((floor) => {
      const window = floor === 0 ? { at: 0.5, w: 0.8, ...BAY_LOW } : floor === 1 ? { at: 0.5, w: 0.8, ...BAY_HIGH } : undefined;
      return [{ floor, a: [-8.65, 1.1], b: [-9.45, 1.75], window } as DiagWallDef, { floor, a: [-9.45, 2.65], b: [-8.65, 3.25], window } as DiagWallDef];
    }),
    { floor: 0, a: [7.25, -5.15], b: [8.3, -4.1], window: { at: 0.5, w: 0.95 } },
    { floor: 1, a: [7.25, -5.15], b: [8.3, -4.1], window: { at: 0.5, w: 0.95 } },
  ] as DiagWallDef[]
).map((d) => ({ ...d, a: [P(d.a[0]), P(d.a[1])], b: [P(d.b[0]), P(d.b[1])], window: d.window && { at: d.window.at, w: P(d.window.w) } }));

/* ------------------------------------------------------------------ floors */
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type FloorKind = 'concrete' | 'wood' | 'hatch' | 'roof' | 'deck';
export interface FloorDef {
  id: string;
  /** top surface y */
  y: number;
  rect: Rect;
  tier: SurfaceTier;
  kind: FloorKind;
  /** void rectangles (stair wells, hatches) */
  holes?: Rect[];
  label?: string;
  /** slab thickness override */
  t?: number;
}
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0: P(x0), z0: P(z0), x1: P(x1), z1: P(z1) });

export interface StairDef {
  id: string;
  label: string;
  rect: Rect;
  axis: 'x' | 'z';
  /** y at the min-coordinate end and the max-coordinate end */
  yMin: number;
  yMax: number;
  exterior?: boolean;
}
export const STAIRS: StairDef[] = [
  // main stairs (blueprint 1F / the source model): an L in the lobby's north-east corner — from beside the front door east
  // along the front wall to a landing in the corner, then south along the office wall up to 2F (both flights against the
  // walls' inner faces)
  { id: 'stairs_main_a', label: 'Lobby Stairs', rect: R(1.2, -4.78, 2.8, -3.6), axis: 'x', yMin: 0, yMax: 1.4 },
  { id: 'stairs_main_b', label: 'Lobby Stairs', rect: R(2.8, -3.6, 4.22, -1.2), axis: 'z', yMin: 1.4, yMax: 3.5 },
  // basement stairs: 1F lobby landing → B (westwards, under the 2F upper-hallway hatch)
  { id: 'stairs_basement', label: 'Basement Stairs', rect: R(-2.3, -0.85, 2.3, 0.5), axis: 'x', yMin: -3.5, yMax: 0 },
  // back stairs (the source model's back-entrance stairwell): a switchback stacked B → 1F → 2F in the west bay — on every
  // floor the lower flight climbs west along the south half to a half landing in the bay, the upper flight climbs east
  // along the north half to the next floor; both start from the east end (x −5.5), a wall runs between them
  { id: 'stairs_back_b1', label: 'Back Stairs', rect: R(-7.95, 2.3, -5.5, 3.6), axis: 'x', yMin: -1.75, yMax: -3.5 },
  { id: 'stairs_back_b2', label: 'Back Stairs', rect: R(-7.95, 0.75, -5.5, 2.2), axis: 'x', yMin: -1.75, yMax: 0 },
  { id: 'stairs_back_11', label: 'Back Stairs', rect: R(-7.95, 2.3, -5.5, 3.6), axis: 'x', yMin: 1.75, yMax: 0 },
  { id: 'stairs_back_12', label: 'Back Stairs', rect: R(-7.95, 0.75, -5.5, 2.2), axis: 'x', yMin: 1.75, yMax: 3.5 },
  // NW basement stairs (datamap zone 11): a flight down from the front yard, south to the pit at the storage door
  // (the datamap's 2.1 m flight is lengthened to 4.1 m: 40° instead of 58°, walkable and in step with the House's other stairs)
  { id: 'stairs_storage_ext', label: 'NW Basement Stairs', rect: R(-10.8, -12.11, -7.87, -8.0), axis: 'z', yMin: GROUND_Y, yMax: -3.5, exterior: true },
];
/** the lobby stairs' corner landing (between the two flights of the L) */
export const MAIN_LANDING = R(2.8, -4.78, 4.22, -3.6);
/** the back stairs' half landing: across the west end of the flights and into the bay (two rects inside its octagon) */
const BACK_LANDING = [R(-8.65, 0.75, -7.95, 3.6), R(-9.05, 1.45, -8.65, 2.95), R(-9.45, 1.75, -9.05, 2.65)];
export const LANDINGS: { rect: Rect; y: number; label: string }[] = [
  { rect: MAIN_LANDING, y: 1.4, label: 'Lobby Stairs Landing' },
  ...BACK_LANDING.map((rect) => ({ rect, y: -1.75, label: 'Back Stairs Landing' })),
  ...BACK_LANDING.map((rect) => ({ rect, y: 1.75, label: 'Back Stairs Landing' })),
];
/** the back stairwell: open from the basement to the 2F ceiling (landings at the half levels) */
export const BACK_STAIRWELL = R(-9.45, 0.55, -5.5, 3.75);
/** the landing at the bottom of the NW basement stairs, up to the storage door (x −7.25) */
export const NW_STAIRWELL_PIT = R(-10.8, -8.0, -7.25, -5.7);
export const STAIR_HOLES = {
  // the lobby stairs' well: over both flights and the landing, from the gallery's west rail to the workshop wall (a strip
  // of 2F floor stays along the front wall, over the porch)
  main: R(1.2, -4.9, 4.35, -1.2),
  basement: R(-1.75, -0.95, 2.3, 0.6),
};

export interface HatchDef { id: string; label: string; rect: Rect; y: number; below: string; above: string }
export const HATCHES: HatchDef[] = [
  { id: 'hatch_living', label: 'Living Room → Training Room Hatch', rect: R(-4.05, -3.8, -3.05, -2.8), y: 0, below: 'training', above: 'living' },
  { id: 'hatch_kitchen', label: 'Kitchen → Laundry Hatch', rect: R(-2.4, 1.45, -1.4, 2.45), y: 0, below: 'laundry', above: 'kitchen' },
  { id: 'hatch_hallway', label: 'Upper Hallway → Basement Stairs Hatch', rect: R(0.1, -0.7, 1.1, 0.3), y: 3.5, below: 'bstairs', above: 'hallway2' },
  { id: 'hatch_master', label: 'Master Bedroom → Dining Room Hatch', rect: R(7.9, 1.25, 8.9, 2.25), y: 3.5, below: 'dining', above: 'master' },
];

/** six default cameras (exterior ones on poles at the datamap's CCTV Cam A / B: centre, ground + H_upper 3.22 m) */
export const CCTVS: { id: string; label: string; pos: [number, number, number]; yaw: number; exterior: boolean; ground?: number }[] = ([
  { id: 'cam_ext_se', label: 'Exterior Camera B (Back Patio)', pos: [13.6, -0.66 + 3.22, 12.83], ground: -0.66, yaw: Math.atan2(13.6, 12.83), exterior: true },
  { id: 'cam_ext_nw', label: 'Exterior Camera A (Front Yard)', pos: [-11.87, 3.22, -13.71], ground: 0, yaw: Math.atan2(-11.87, -13.71), exterior: true },
  { id: 'cam_kitchen', label: '1F Kitchen Camera', pos: [1.35, 3.0, 4.6], yaw: Math.PI, exterior: false },
  { id: 'cam_hallway', label: '2F Upper Hallway Camera', pos: [3.65, 6.5, -5.2], yaw: 0, exterior: false },
  { id: 'cam_garage', label: 'B Garage Camera', pos: [2.75, -0.5, -4.55], yaw: 0, exterior: false },
  { id: 'cam_training', label: 'B Training Room Camera', pos: [-7.7, -0.5, -0.25], yaw: -Math.PI / 2, exterior: false },
] as { id: string; label: string; pos: [number, number, number]; yaw: number; exterior: boolean; ground?: number }[]).map((c) => ({ ...c, pos: [P(c.pos[0]), c.pos[1], P(c.pos[2])] as [number, number, number] }));

export const FLOORS: FloorDef[] = [
  // basement floor (ground-bearing concrete)
  { id: 'slab_b_a', y: -3.5, rect: R(-7.25, -7.4, 7.2, -0.6), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_w', y: -3.5, rect: R(-7.95, -2.45, -7.25, -0.6), tier: 'solid', kind: 'concrete' }, // training room's west strip
  { id: 'slab_b_b', y: -3.5, rect: R(-9.45, -0.6, 9.7, 3.7), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_c', y: -3.5, rect: R(-5.45, 3.7, 2.05, 6.45), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_d', y: -3.5, rect: R(2.05, 3.7, 9.7, 4.85), tier: 'solid', kind: 'concrete' },
  { id: 'pit_storage', y: -3.5, rect: NW_STAIRWELL_PIT, tier: 'solid', kind: 'concrete', label: 'NW Basement Stairs' },
  // 1F floor — wooden joists (semi-breach): shoot down into the basement
  { id: 'wood_1f_nw', y: 0, rect: R(-7.25, -7.4, -1.75, -2.45), tier: 'semi', kind: 'wood', holes: [HATCHES[0].rect], label: '1F Living Room Floor' },
  { id: 'wood_1f_w', y: 0, rect: R(-7.95, -2.45, -1.75, 0.6), tier: 'semi', kind: 'wood', label: '1F Living Room Floor (S)' },
  { id: 'wood_1f_lobby', y: 0, rect: R(-1.75, -4.9, 4.3, -0.95), tier: 'semi', kind: 'wood', label: '1F Lobby Floor' },
  { id: 'wood_1f_landing', y: 0, rect: R(2.3, -0.95, 4.3, 0.6), tier: 'semi', kind: 'wood', label: '1F Lobby Landing Floor' },
  { id: 'wood_1f_office', y: 0, rect: R(4.3, -5.15, 8.3, -0.6), tier: 'semi', kind: 'wood', label: '1F Office Floor' },
  { id: 'wood_1f_dining', y: 0, rect: R(4.3, -0.6, 9.7, 4.85), tier: 'semi', kind: 'wood', label: '1F Dining Room Floor' },
  { id: 'wood_1f_kitchen', y: 0, rect: R(-3.15, 0.6, 4.3, 4.85), tier: 'semi', kind: 'wood', holes: [HATCHES[1].rect], label: '1F Kitchen Floor' },
  { id: 'wood_1f_back', y: 0, rect: R(-5.5, 0.6, -3.15, 3.75), tier: 'semi', kind: 'wood', label: '1F Back Entrance Floor' },
  { id: 'wood_1f_back2', y: 0, rect: R(-5.45, 3.75, -3.15, 4.85), tier: 'semi', kind: 'wood', label: '1F Back Entrance Floor (S)' },
  // 2F floor — wooden, mostly penetrable
  { id: 'wood_2f_bath', y: 3.5, rect: R(-7.25, -7.4, -1.7, -5.5), tier: 'semi', kind: 'wood', label: '2F Bathroom Floor' },
  { id: 'wood_2f_west', y: 3.5, rect: R(-7.25, -5.5, -3.15, -2.45), tier: 'semi', kind: 'wood', label: '2F West Hall Floor (N)' },
  { id: 'wood_2f_west2', y: 3.5, rect: R(-7.95, -2.45, -3.15, 2.2), tier: 'semi', kind: 'wood', holes: [R(-7.95, 0.55, -5.5, 2.2)], label: '2F West Hall Floor' },
  { id: 'wood_2f_hall', y: 3.5, rect: R(-3.15, -5.5, 4.35, 0.55), tier: 'semi', kind: 'wood', holes: [STAIR_HOLES.main, HATCHES[2].rect], label: '2F Upper Hallway Floor' },
  { id: 'wood_2f_hall_s', y: 3.5, rect: R(-3.15, 0.55, 1.25, 2.2), tier: 'semi', kind: 'wood', label: '2F Upper Hallway Floor (S)' },
  { id: 'wood_2f_workshop', y: 3.5, rect: R(4.35, -5.15, 8.3, -0.6), tier: 'semi', kind: 'wood', label: '2F Workshop Floor' },
  { id: 'wood_2f_master', y: 3.5, rect: R(1.25, -0.6, 9.7, 4.85), tier: 'semi', kind: 'wood', holes: [HATCHES[3].rect, R(1.25, -0.6, 4.35, 0.55)], label: '2F Master Bedroom Floor' },
  { id: 'wood_2f_closet', y: 3.5, rect: R(-1.8, 2.2, 1.25, 4.85), tier: 'semi', kind: 'wood', label: '2F Walk-in Closet Floor' },
  { id: 'wood_2f_kids', y: 3.5, rect: R(-5.55, 2.2, -1.8, 3.75), tier: 'semi', kind: 'wood', label: "2F Kids' Room Floor (N)" },
  { id: 'wood_2f_kids2', y: 3.5, rect: R(-7.25, 3.75, -1.8, 6.6), tier: 'semi', kind: 'wood', label: "2F Kids' Room Floor" },
  // front porch roof (walkable: bathroom window, open window, rappel)
  { id: 'roof_porch', y: 3.5, rect: R(-1.7, -7.0, 4.35, -5.5), tier: 'solid', kind: 'roof', label: 'Porch Roof' },
  // decks
  { id: 'porch_deck', y: 0, rect: R(-1.7, -7.0, 4.35, -4.9), tier: 'solid', kind: 'deck', label: 'Front Porch', t: 0.25 },
  // the back deck along the whole south side (blueprint 1F): covered by the Kids' Room in the west, by the south porch
  // roof east of it, steps down to the yard on the west and the south
  { id: 'back_deck', y: 0, rect: R(-7.25, 4.85, -1.8, 6.7), tier: 'solid', kind: 'deck', label: 'Back Porch', t: 0.25 },
  { id: 'back_deck_w', y: 0, rect: R(-7.25, 3.75, -5.45, 4.85), tier: 'solid', kind: 'deck', label: 'Back Porch', t: 0.25 },
  { id: 'back_deck2', y: 0, rect: R(-1.8, 4.85, 5.15, 6.7), tier: 'solid', kind: 'deck', label: 'Back Porch', t: 0.25 },
  // the south porch roof over it (blueprint 2F / roof): walkable, from the Kids' Room east window to the Master Bedroom's
  { id: 'roof_porch_s', y: 3.5, rect: R(-1.8, 4.85, 5.15, 6.85), tier: 'solid', kind: 'roof', label: 'Back Porch Roof', t: 0.25 },
  // main roof (flat, low parapet)
  { id: 'roof_main_n', y: ROOF_Y, rect: R(-7.25, -7.4, -1.7, -5.5), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_c', y: ROOF_Y, rect: R(-7.95, -5.5, 8.3, -2.45), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_c2', y: ROOF_Y, rect: R(-7.95, -2.45, 8.3, -0.6), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_c3', y: ROOF_Y, rect: R(-7.95, -0.6, 9.7, 0.55), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_s', y: ROOF_Y, rect: R(-8.65, 0.55, 9.7, 3.75), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_s2', y: ROOF_Y, rect: R(-7.25, 3.75, 9.7, 4.85), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_main_kids', y: ROOF_Y, rect: R(-7.25, 4.85, -1.8, 6.6), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_bay', y: ROOF_Y, rect: R(-9.45, 1.1, -8.65, 3.25), tier: 'solid', kind: 'roof', label: 'Roof' },
];

/* ------------------------------------------------------------------- roof */
/**
 * The pitched roof (blueprint roof plan): a hipped main block with a flat walkable top, hips over the north-west wing,
 * the Kids' Room wing, the east strip and the west bay. Every part is a convex solid on the 2F walls (eaves at ROOF_Y,
 * overhang ROOF_OVERHANG), its collider the same hull. Wings reach into the main block so their inner hip ends sink into
 * its slope.
 */
export interface RoofDef { id: string; rect: Rect; /** 'flat' = hip up to a flat top `rise` above the eaves; 'hip' = a ridge along the longer side */ ridge: 'flat' | 'hip'; rise?: number }
export const ROOF_PITCH = (30 * Math.PI) / 180;
export const ROOF_OVERHANG = 0.35;
export const ROOFS: RoofDef[] = [
  { id: 'roof_main', rect: R(-7.95, -5.5, 8.3, 4.85), ridge: 'flat', rise: 2.3 },
  { id: 'roof_nw', rect: R(-7.25, -7.4, -1.7, -3.0), ridge: 'hip' },
  { id: 'roof_kids', rect: R(-7.25, 2.35, -1.8, 6.6), ridge: 'hip' },
  { id: 'roof_east', rect: R(6.0, -0.6, 9.7, 4.85), ridge: 'hip' },
  { id: 'roof_bay', rect: R(-9.45, 1.1, -6.5, 3.25), ridge: 'hip' },
];

/** the corner points of a roof part (world), for its hull */
export function roofPoints(r: RoofDef): [number, number, number][] {
  const o = ROOF_OVERHANG;
  const x0 = r.rect.x0 - o, x1 = r.rect.x1 + o, z0 = r.rect.z0 - o, z1 = r.rect.z1 + o;
  const y0 = ROOF_Y - 0.02;
  const t = Math.tan(ROOF_PITCH);
  const base: [number, number, number][] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
  if (r.ridge === 'flat') {
    const d = (r.rise ?? 2) / t;
    const y1 = y0 + (r.rise ?? 2);
    return [...base, [x0 + d, y1, z0 + d], [x1 - d, y1, z0 + d], [x1 - d, y1, z1 - d], [x0 + d, y1, z1 - d]];
  }
  // a hip: the ridge runs along the long side, half the short side in from each end (a pyramid if square) — every face at the pitch
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const h = half * t;
  const yR = y0 + h;
  if (alongX) {
    const cz = (z0 + z1) / 2;
    const a = Math.min(x0 + half, (x0 + x1) / 2), b = Math.max(x1 - half, (x0 + x1) / 2);
    return [...base, [a, yR, cz], [b, yR, cz]];
  }
  const cx = (x0 + x1) / 2;
  const a = Math.min(z0 + half, (z0 + z1) / 2), b = Math.max(z1 - half, (z0 + z1) / 2);
  return [...base, [cx, yR, a], [cx, yR, b]];
}

/* ------------------------------------------------------------------- rooms */
export interface RoomDef {
  id: string;
  name: string;
  floor: FloorId;
  rects: Rect[];
  /** a stairwell: named for callouts, but nobody spawns, patrols or gets an objective there */
  transit?: boolean;
  /** default objective spot (hostage / container / bomb) – x,z on the room floor, reachable upright (tools/tests/walk.test.ts) */
  spot: [number, number];
}
export const ROOMS: RoomDef[] = ([
  // basement
  { id: 'storage', name: 'Storage Room', floor: -1, rects: [R(-7.25, -7.4, -1.7, -4.8)], spot: [-3.35, -5.6] },
  { id: 'training', name: 'Training Room', floor: -1, rects: [R(-7.95, -4.8, 0.35, -0.95), R(-7.95, -0.95, -2.35, 0.55)], spot: [-3.6, -2.9] },
  // the flight's footprint only: east of x 0.75 is the closed-off void under the upper steps
  { id: 'bstairs', name: 'Basement Stairs', floor: -1, transit: true, rects: [R(-2.35, -0.95, 0.26, 0.55)], spot: [-2.3, -0.15] },
  { id: 'garage', name: 'Garage', floor: -1, rects: [R(0.35, -4.8, 7.2, -0.6), R(1.95, -0.6, 9.7, 4.85)], spot: [6.6, 1.6] },
  { id: 'laundry', name: 'Laundry Room', floor: -1, rects: [R(-3.6, 0.55, 1.95, 3.7)], spot: [-0.65, 2.85] },
  { id: 'sidestairs_b', name: 'Side Stairs', floor: -1, rects: [R(-8.65, 0.55, -3.6, 3.7), R(-9.45, 1.1, -8.65, 3.25)], spot: [-5.15, 2.7] },
  { id: 'backhall_b', name: 'Back Hallway', floor: -1, rects: [R(-5.45, 3.7, 1.95, 6.45)], spot: [-1.5, 5.2] },
  // 1F
  { id: 'living', name: 'Living Room', floor: 0, rects: [R(-7.25, -7.4, -1.75, -2.45), R(-7.95, -2.45, -1.75, 0.6)], spot: [-5.6, -6.05] },
  { id: 'lobby', name: 'Lobby', floor: 0, rects: [R(-1.75, -4.9, 4.3, -0.95), R(1.8, -0.95, 4.3, 0.6)], spot: [-0.4, -3.4] },
  { id: 'office', name: 'Office', floor: 0, rects: [R(4.3, -5.15, 8.3, -0.6)], spot: [6.2, -4.15] },
  { id: 'dining', name: 'Dining Room', floor: 0, rects: [R(4.3, -0.6, 9.7, 4.85)], spot: [8.5, 3.35] },
  { id: 'kitchen', name: 'Kitchen', floor: 0, rects: [R(-3.15, 0.6, 4.3, 4.85)], spot: [0.6, 3.7] },
  { id: 'backentry', name: 'Back Entrance', floor: 0, rects: [R(-5.5, 0.6, -3.15, 3.75), R(-5.45, 3.75, -3.15, 4.85)], spot: [-4.3, 3.0] },
  { id: 'backstairs', name: 'Back Stairs', floor: 0, transit: true, rects: [R(-8.65, 0.6, -5.5, 3.75), R(-9.45, 1.1, -8.65, 3.25)], spot: [-5.62, 2.95] },
  // 2F
  { id: 'bathroom', name: 'Bathroom', floor: 1, rects: [R(-7.25, -7.4, -1.7, -5.5)], spot: [-5.6, -6.5] },
  { id: 'westhall', name: 'West Hall', floor: 1, rects: [R(-7.25, -5.5, -3.15, -2.45), R(-7.95, -2.45, -3.15, 0.55), R(-5.5, 0.55, -3.15, 2.2)], spot: [-5.4, -1.0] },
  { id: 'hallway2', name: 'Upper Hallway', floor: 1, rects: [R(-1.7, -5.5, 4.35, 0.55), R(-3.15, -2.5, -1.7, 0.55), R(-3.15, 0.55, 1.25, 2.2), R(-3.15, -5.5, -1.7, -2.5), R(4.35, -0.6, 5.85, 0.55)], spot: [-0.6, -3.2] },
  { id: 'workshop', name: 'Workshop', floor: 1, rects: [R(4.35, -5.15, 8.3, -0.6)], spot: [6.4, -3.45] },
  { id: 'master', name: 'Master Bedroom', floor: 1, rects: [R(1.25, 0.55, 9.7, 4.85), R(5.85, -0.6, 9.7, 0.55)], spot: [3.75, 3.0] },
  { id: 'closet', name: 'Walk-in Closet', floor: 1, rects: [R(-1.8, 2.2, 1.25, 4.85)], spot: [-0.3, 3.45] },
  { id: 'kids', name: "Kids' Room", floor: 1, rects: [R(-7.25, 3.75, -1.8, 6.6), R(-5.55, 2.2, -1.8, 3.75)], spot: [-4.4, 4.85] },
] as RoomDef[]).map((r) => ({ ...r, spot: [P(r.spot[0]), P(r.spot[1])] as [number, number] }));

/* ---------------------------------------------------------------- exterior */
export interface SpawnZoneDef {
  id: 'construction' | 'docks' | 'apc' | 'sidestreet';
  label: string;
  center: [number, number, number];
  radius: number;
  /** extraction area for hostage mode */
  extract: Rect;
}
// the datamap's four Attacker Spawn Pad Centers (form 15): pad centre, pad ground (H_ground), extraction around it
export const SPAWN_ZONES: SpawnZoneDef[] = ([
  { id: 'construction', label: 'Construction Site', center: [2.13, -1.21, -29.97], radius: 1.8, extract: R(-3.5, -35.5, 7.5, -25.5) },
  { id: 'docks', label: 'River Docks', center: [22.93, -3.0, 6.96], radius: 1.8, extract: R(20.6, 3.4, 25.2, 12.5) },
  { id: 'apc', label: 'APC Area', center: [-5.2, -1.51, 23.1], radius: 1.8, extract: R(-10.5, 19.5, -1, 27.5) },
  { id: 'sidestreet', label: 'Side Street', center: [13.6, -1.51, 24.96], radius: 1.8, extract: R(9, 20.5, 18.5, 29.2) },
] as SpawnZoneDef[]).map((z) => ({ ...z, center: [P(z.center[0]), z.center[1], P(z.center[2])] as [number, number, number] }));

/** the datamap's extent: u, v ∈ [0, 512) → X −32.4 … 35.87, Z −39.04 … 29.23 */
export const MAP_BOUNDS = { x0: P(-32.4), x1: P(35.87), z0: P(-39.04), z1: P(29.23) };
/** house footprint (outer faces) — for exterior naming / suburb cut-outs */
export const HOUSE_RECT = R(-9.6, -7.55, 9.85, 6.75);
/** sunken garage driveway at basement level: the carport under the office (shutter B) and the apron at the foot of the datamap's Garage Entrance Ramp (shutter A) */
/** the back deck's steps down to the yard (top at half the deck's height) */
export const DECK_STEPS = [R(-7.6, 3.9, -7.25, 6.7), R(-7.6, 6.7, 5.15, 6.95)];
export const DRIVEWAY = R(7.05, -4.95, 10.93, 3.89);
/** the datamap's Garage Entrance Ramp (zone 9): climbs east from the apron to the road */
export const GARAGE_RAMP = { x0: P(10.93), x1: P(14.13), z0: P(-4.11), z1: P(3.89), y0: -3.49, y1: -1.51 };
/** drone vent shaft from the north yard down to the storage room (grille at grade) */
export const VENT_SHAFT = R(-4.85, -8.05, -4.15, -7.55);
/** a well outside the garage's B-level drone vent (x 9.7, z 4.35), open to the driveway apron on its south side */
export const GARAGE_VENT_WELL = R(9.85, 3.85, 10.6, 4.85);

/** Simple outdoor zone naming for HUD / WebMCP when not inside a room. */
export function exteriorZoneName(x: number, y: number, z: number): string {
  const inHouse = x > HOUSE_RECT.x0 && x < HOUSE_RECT.x1 && z > HOUSE_RECT.z0 && z < HOUSE_RECT.z1;
  if (y > 6.6 && inHouse) return 'Roof';
  if (y > 2.9 && y < 4.6 && x > P(-1.8) && x < P(4.45) && z > P(-7.1) && z < P(-5.4)) return 'Porch Roof';
  if (y > 2.9 && y < 4.6 && x > P(-1.8) && x < P(5.2) && z > P(4.8) && z < P(6.9)) return 'Back Porch Roof';
  if (y > -0.6 && y < 1.5) {
    if (x > P(-1.8) && x < P(4.45) && z > P(-7.1) && z < P(-4.8)) return 'Front Porch';
    if (x > P(-7.6) && x < P(5.2) && z > P(3.7) && z < P(7.0)) return 'Back Porch';
  }
  if (x > DRIVEWAY.x0 && x < DRIVEWAY.x1 && z > DRIVEWAY.z0 && z < DRIVEWAY.z1 && y < -2.5) return 'Garage Driveway';
  // everything else: the datamap's zone label at that spot
  const zone = datamapZoneAt(x, z);
  return zone && zone !== 'House Main Footprint' ? zone : 'Exterior';
}
