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

export type FloorId = -1 | 0 | 1;
export const FLOOR_Y: Record<FloorId, number> = { [-1]: -3.5, 0: 0, 1: 3.5 };
export const FLOOR_LABEL: Record<FloorId, string> = { [-1]: 'B', 0: '1F', 1: '2F' };
/** floor → ceiling */
export const WALL_H = 3.2;
export const SLAB_T = 0.3;
/** exterior grade around the house (one step below the 1F floor) */
export const GROUND_Y = -0.25;
/** river-level yard / garage driveway on the east */
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
}
/** non-axis-aligned exterior walls (bay window, NE chamfer) — always solid */
export interface DiagWallDef { floor: FloorId; a: [number, number]; b: [number, number]; window?: { at: number; w: number } }

export interface OpeningDims { y0: number; h: number; barricade: boolean; /** barricade starts this high (door bottom gap for drones / prone) */ gap: number }
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

const W = (floor: FloorId, run: 'x' | 'z', c: number, from: number, to: number, tier: SurfaceTier, openings: OpeningDef[] = [], ext = false, spans?: SpanDef[]): WallDef =>
  ({ floor, run, c, from, to, tier, openings, ext, spans });
const E = (floor: FloorId, run: 'x' | 'z', c: number, from: number, to: number, openings: OpeningDef[] = []): WallDef => W(floor, run, c, from, to, 'solid', openings, true);
const door = (at: number, w = 1.0): OpeningDef => ({ at, w, kind: 'door' });
const xdoor = (at: number, w = 1.1): OpeningDef => ({ at, w, kind: 'exterior_door' });
const win = (at: number, w = 1.0): OpeningDef => ({ at, w, kind: 'window' });
const french = (at: number, w = 0.9): OpeningDef => ({ at, w, kind: 'french' });
const arch = (at: number, w = 1.5): OpeningDef => ({ at, w, kind: 'arch' });
const vent = (at: number): OpeningDef => ({ at, w: 0.45, kind: 'vent' });
const S = (from: number, to: number, tier: SurfaceTier): SpanDef => ({ from, to, tier });

export const WALLS: WallDef[] = [
  /* ============================== BASEMENT (−3.5) ============================== */
  // exterior (underground concrete) — the garage façade is the only one above grade
  E(-1, 'x', -7.4, -7.25, -1.7, [vent(-4.5)]), // storage N (+ vent from the yard shaft)
  E(-1, 'z', -7.25, -7.4, -2.45, [xdoor(-6.25, 1.0)]), // storage W → exterior NW stairwell
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
  E(-1, 'z', 9.7, -0.6, 4.85, [{ at: 2.0, w: 3.6, kind: 'shutter' }, vent(4.35)]),
  E(-1, 'x', -0.6, 7.2, 9.7), // hard pillar wall between the two shutters
  E(-1, 'z', 7.2, -4.8, -0.6, [{ at: -2.7, w: 3.2, kind: 'shutter' }]), // garage shutter B
  E(-1, 'x', -4.8, -1.7, 7.2),
  E(-1, 'z', -1.7, -7.4, -4.8),
  // interior
  W(-1, 'x', -4.8, -7.25, -1.7, 'soft', [door(-3.6)]), // storage | training — fully soft (wallbang city)
  W(-1, 'z', 0.35, -4.8, -0.95, 'soft'), // training | garage
  W(-1, 'x', -0.95, -2.35, 1.95, 'solid'), // training & garage | basement stairs
  W(-1, 'z', 1.95, -0.95, 0.55, 'solid'), // basement stairs | garage
  W(-1, 'x', 0.55, -3.6, 1.95, 'solid', [], false, [S(-3.6, -2.15, 'soft')]), // training (NW part soft) & stairs | laundry
  W(-1, 'z', -3.6, 0.55, 3.7, 'soft', [door(3.05, 0.9)]), // side stairs | laundry
  W(-1, 'z', 1.95, 0.55, 4.85, 'soft', [door(4.25, 0.9)], false, [S(3.7, 4.85, 'solid')]), // laundry & back hall | garage
  W(-1, 'x', 3.7, -5.45, -3.6, 'solid', [door(-4.5)]), // side stairs | back hall
  W(-1, 'x', 3.7, -3.6, 1.95, 'solid', [door(-1.0, 1.1)]), // laundry | back hall

  /* ================================ 1F (0) ================================== */
  // exterior: windows ×10 + front door + back door (matches the guide)
  E(0, 'x', -7.4, -7.25, -1.7, [win(-4.5, 1.25)]), // living N
  E(0, 'z', -7.25, -7.4, -2.45, [win(-3.25), vent(-4.4)]), // living W (+ drone vent from the west yard)
  E(0, 'x', -2.45, -7.95, -7.25),
  E(0, 'z', -7.95, -2.45, 0.55, [french(-1.4), french(-0.45)]), // living W french windows
  E(0, 'x', 0.55, -8.65, -7.95),
  E(0, 'z', -8.65, 0.55, 1.1),
  E(0, 'z', -9.45, 1.75, 2.65, [win(2.2, 0.8)]), // back entrance bay window W
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

  /* ================================ 2F (3.5) ================================== */
  // exterior: windows ×12 + the unboardable open window
  E(1, 'x', -7.4, -7.25, -1.7, [win(-4.5, 1.25)]), // bathroom N
  E(1, 'z', -1.7, -7.4, -5.5, [win(-6.35)]), // bathroom E → porch roof
  E(1, 'x', -5.5, -1.7, 4.35, [{ at: -0.1, w: 1.6, kind: 'open_window' }]), // OPEN WINDOW over the front door
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
  E(1, 'z', -9.45, 1.75, 2.65, [win(2.2, 0.8)]),
  E(1, 'z', -8.65, 0.55, 1.1),
  E(1, 'x', 0.55, -8.65, -7.95),
  E(1, 'z', -7.95, -2.45, 0.55),
  E(1, 'x', -2.45, -7.95, -7.25),
  E(1, 'z', -7.25, -7.4, -2.45),
  // interior — almost everything up here is soft (the guide's key point)
  W(1, 'x', -5.5, -7.25, -3.15, 'soft', [door(-5.2)]), // bathroom | west hall
  W(1, 'z', -3.15, -5.5, 2.2, 'soft', [door(-4.6), door(-0.1)]), // bathroom annex & upper hall | west hall
  W(1, 'x', -2.5, -3.15, -1.7, 'soft'), // bathroom annex | upper hall
  W(1, 'z', -1.7, -5.5, -2.5, 'soft', [door(-3.05, 0.9), vent(-4.6)]), // bathroom annex | upper hall (+ drone vent)
  W(1, 'z', 4.35, -5.15, 0.55, 'soft', [door(-1.4)]), // upper hall | workshop · master
  W(1, 'x', -0.6, 4.35, 8.1, 'soft'), // workshop | master
  W(1, 'x', 0.55, 1.25, 4.35, 'soft', [door(2.0)]), // upper hall | master
  W(1, 'z', 1.25, 0.55, 2.2, 'soft'), // upper hall (south arm) | master
  W(1, 'x', 2.2, -5.55, 1.25, 'soft', [door(-2.55, 0.9)], false, [S(-1.8, 1.25, 'semi')]), // kids | halls · walk-in closet north (semi)
  W(1, 'z', -1.8, 2.2, 4.85, 'solid'), // kids | walk-in closet (bulletproof)
  W(1, 'z', 1.25, 2.2, 4.85, 'solid', [door(3.6, 0.9)]), // walk-in closet | master (bulletproof)
  W(1, 'z', -5.55, 2.2, 3.75, 'soft'), // kids | west hall
  W(1, 'x', 3.75, -7.25, -5.55, 'soft'), // kids | west hall
];

/** bay window + NE chamfer (the model's diagonal walls) */
export const DIAG_WALLS: DiagWallDef[] = [
  ...([-1, 0, 1] as FloorId[]).flatMap((floor) => [
    { floor, a: [-8.65, 1.1], b: [-9.45, 1.75], window: floor === -1 ? undefined : { at: 0.5, w: 0.8 } } as DiagWallDef,
    { floor, a: [-9.45, 2.65], b: [-8.65, 3.25] } as DiagWallDef,
  ]),
  { floor: 0, a: [7.25, -5.15], b: [8.3, -4.1], window: { at: 0.5, w: 0.95 } },
  { floor: 1, a: [7.25, -5.15], b: [8.3, -4.1], window: { at: 0.5, w: 0.95 } },
];

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
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

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
  // main stairs: U-turn in the lobby (east flight up to a north landing, west flight on up to 2F)
  { id: 'stairs_main_a', label: 'Lobby Stairs', rect: R(2.85, -3.95, 4.15, -1.2), axis: 'z', yMin: 1.75, yMax: 0 },
  { id: 'stairs_main_b', label: 'Lobby Stairs', rect: R(1.45, -3.95, 2.75, -1.2), axis: 'z', yMin: 1.75, yMax: 3.5 },
  // basement stairs: 1F lobby landing → B (westwards, under the 2F upper-hallway hatch)
  { id: 'stairs_basement', label: 'Basement Stairs', rect: R(-2.3, -0.85, 2.3, 0.5), axis: 'x', yMin: -3.5, yMax: 0 },
  // side stairs: back entrance → B side stairs
  { id: 'stairs_side', label: 'Side Stairs', rect: R(-8.4, 0.85, -3.75, 2.05), axis: 'x', yMin: -3.5, yMax: 0 },
  // exterior stairwell down to the storage door (NW)
  { id: 'stairs_storage_ext', label: 'Storage Stairwell', rect: R(-13.6, -7.3, -8.85, -5.7), axis: 'x', yMin: GROUND_Y, yMax: -3.5, exterior: true },
];
export const LANDINGS: { rect: Rect; y: number; label: string }[] = [
  { rect: R(1.45, -4.85, 4.15, -3.95), y: 1.75, label: 'Lobby Stairs Landing' },
];
export const STAIR_HOLES = {
  main: R(1.4, -4.9, 4.2, -1.2),
  basement: R(-1.75, -0.95, 2.3, 0.6),
  side: R(-8.4, 0.85, -3.75, 2.05),
};

export interface HatchDef { id: string; label: string; rect: Rect; y: number; below: string; above: string }
export const HATCHES: HatchDef[] = [
  { id: 'hatch_living', label: 'Living Room → Training Room Hatch', rect: R(-4.05, -3.8, -3.05, -2.8), y: 0, below: 'training', above: 'living' },
  { id: 'hatch_kitchen', label: 'Kitchen → Laundry Hatch', rect: R(-2.4, 1.45, -1.4, 2.45), y: 0, below: 'laundry', above: 'kitchen' },
  { id: 'hatch_hallway', label: 'Upper Hallway → Basement Stairs Hatch', rect: R(0.1, -0.7, 1.1, 0.3), y: 3.5, below: 'bstairs', above: 'hallway2' },
  { id: 'hatch_master', label: 'Master Bedroom → Dining Room Hatch', rect: R(7.9, 1.25, 8.9, 2.25), y: 3.5, below: 'dining', above: 'master' },
];

/** six default cameras (the model's cylinders; exterior ones on poles) */
export const CCTVS: { id: string; label: string; pos: [number, number, number]; yaw: number; exterior: boolean }[] = [
  { id: 'cam_ext_se', label: 'Exterior Camera (Side Street)', pos: [13.5, 3.6, 12.7], yaw: Math.atan2(13.5, 12.7), exterior: true },
  { id: 'cam_ext_nw', label: 'Exterior Camera (Construction)', pos: [-11.7, 3.6, -13.6], yaw: Math.atan2(-11.7, -13.6), exterior: true },
  { id: 'cam_kitchen', label: '1F Kitchen Camera', pos: [1.35, 3.0, 4.6], yaw: Math.PI, exterior: false },
  { id: 'cam_hallway', label: '2F Upper Hallway Camera', pos: [3.65, 6.5, -5.2], yaw: 0, exterior: false },
  { id: 'cam_garage', label: 'B Garage Camera', pos: [2.75, -0.5, -4.55], yaw: 0, exterior: false },
  { id: 'cam_training', label: 'B Training Room Camera', pos: [-7.7, -0.5, -0.25], yaw: -Math.PI / 2, exterior: false },
];

export const FLOORS: FloorDef[] = [
  // basement floor (ground-bearing concrete)
  { id: 'slab_b_a', y: -3.5, rect: R(-7.25, -7.4, 7.2, -0.6), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_b', y: -3.5, rect: R(-9.45, -0.6, 9.7, 3.7), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_c', y: -3.5, rect: R(-5.45, 3.7, 2.05, 6.45), tier: 'solid', kind: 'concrete' },
  { id: 'slab_b_d', y: -3.5, rect: R(2.05, 3.7, 9.7, 4.85), tier: 'solid', kind: 'concrete' },
  { id: 'pit_storage', y: -3.5, rect: R(-8.85, -7.3, -7.25, -5.7), tier: 'solid', kind: 'concrete', label: 'Storage Stairwell' },
  // 1F floor — wooden joists (semi-breach): shoot down into the basement
  { id: 'wood_1f_nw', y: 0, rect: R(-7.25, -7.4, -1.75, -2.45), tier: 'semi', kind: 'wood', holes: [HATCHES[0].rect], label: '1F Living Room Floor' },
  { id: 'wood_1f_w', y: 0, rect: R(-7.95, -2.45, -1.75, 0.6), tier: 'semi', kind: 'wood', label: '1F Living Room Floor (S)' },
  { id: 'wood_1f_lobby', y: 0, rect: R(-1.75, -4.9, 4.3, -0.95), tier: 'semi', kind: 'wood', label: '1F Lobby Floor' },
  { id: 'wood_1f_landing', y: 0, rect: R(2.3, -0.95, 4.3, 0.6), tier: 'semi', kind: 'wood', label: '1F Lobby Landing Floor' },
  { id: 'wood_1f_office', y: 0, rect: R(4.3, -5.15, 8.3, -0.6), tier: 'semi', kind: 'wood', label: '1F Office Floor' },
  { id: 'wood_1f_dining', y: 0, rect: R(4.3, -0.6, 9.7, 4.85), tier: 'semi', kind: 'wood', label: '1F Dining Room Floor' },
  { id: 'wood_1f_kitchen', y: 0, rect: R(-3.15, 0.6, 4.3, 4.85), tier: 'semi', kind: 'wood', holes: [HATCHES[1].rect], label: '1F Kitchen Floor' },
  { id: 'wood_1f_back', y: 0, rect: R(-8.65, 0.6, -3.15, 3.75), tier: 'semi', kind: 'wood', holes: [STAIR_HOLES.side], label: '1F Back Entrance Floor' },
  { id: 'wood_1f_back2', y: 0, rect: R(-5.45, 3.75, -3.15, 4.85), tier: 'semi', kind: 'wood', label: '1F Back Entrance Floor (S)' },
  { id: 'bay_1f', y: 0, rect: R(-9.45, 1.1, -8.65, 3.25), tier: 'solid', kind: 'wood' },
  // 2F floor — wooden, mostly penetrable
  { id: 'wood_2f_bath', y: 3.5, rect: R(-7.25, -7.4, -1.7, -5.5), tier: 'semi', kind: 'wood', label: '2F Bathroom Floor' },
  { id: 'wood_2f_west', y: 3.5, rect: R(-7.25, -5.5, -3.15, -2.45), tier: 'semi', kind: 'wood', label: '2F West Hall Floor (N)' },
  { id: 'wood_2f_west2', y: 3.5, rect: R(-7.95, -2.45, -3.15, 2.2), tier: 'semi', kind: 'wood', label: '2F West Hall Floor' },
  { id: 'wood_2f_west3', y: 3.5, rect: R(-8.65, 2.2, -5.55, 3.75), tier: 'semi', kind: 'wood', label: '2F West Hall Floor (S)' },
  { id: 'bay_2f', y: 3.5, rect: R(-9.45, 1.1, -8.65, 3.25), tier: 'solid', kind: 'wood' },
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
  { id: 'back_deck', y: 0, rect: R(-7.25, 4.85, -1.8, 6.6), tier: 'solid', kind: 'deck', label: 'Back Porch', t: 0.25 },
  { id: 'back_deck2', y: 0, rect: R(-1.8, 4.85, 2.05, 6.45), tier: 'solid', kind: 'deck', label: 'Back Yard Deck', t: 0.25 },
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

/* ------------------------------------------------------------------- rooms */
export interface RoomDef {
  id: string;
  name: string;
  floor: FloorId;
  rects: Rect[];
  /** default objective spot (hostage / container / bomb) – x,z on the room floor */
  spot: [number, number];
}
export const ROOMS: RoomDef[] = [
  // basement
  { id: 'storage', name: 'Storage Room', floor: -1, rects: [R(-7.25, -7.4, -1.7, -4.8)], spot: [-3.2, -6.4] },
  { id: 'training', name: 'Training Room', floor: -1, rects: [R(-7.95, -4.8, 0.35, -0.95), R(-7.95, -0.95, -2.35, 0.55)], spot: [-3.6, -2.9] },
  { id: 'bstairs', name: 'Basement Stairs', floor: -1, rects: [R(-2.35, -0.95, 1.95, 0.55)], spot: [1.5, -0.2] },
  { id: 'garage', name: 'Garage', floor: -1, rects: [R(0.35, -4.8, 7.2, -0.6), R(1.95, -0.6, 9.7, 4.85)], spot: [4.2, 1.6] },
  { id: 'laundry', name: 'Laundry Room', floor: -1, rects: [R(-3.6, 0.55, 1.95, 3.7)], spot: [-0.6, 2.9] },
  { id: 'sidestairs_b', name: 'Side Stairs', floor: -1, rects: [R(-8.65, 0.55, -3.6, 3.7), R(-9.45, 1.1, -8.65, 3.25)], spot: [-6.0, 3.0] },
  { id: 'backhall_b', name: 'Back Hallway', floor: -1, rects: [R(-5.45, 3.7, 1.95, 6.45)], spot: [-1.6, 5.4] },
  // 1F
  { id: 'living', name: 'Living Room', floor: 0, rects: [R(-7.25, -7.4, -1.75, -2.45), R(-7.95, -2.45, -1.75, 0.6)], spot: [-5.6, -5.8] },
  { id: 'lobby', name: 'Lobby', floor: 0, rects: [R(-1.75, -4.9, 4.3, -0.95), R(1.8, -0.95, 4.3, 0.6)], spot: [-0.4, -3.4] },
  { id: 'office', name: 'Office', floor: 0, rects: [R(4.3, -5.15, 8.3, -0.6)], spot: [6.2, -3.0] },
  { id: 'dining', name: 'Dining Room', floor: 0, rects: [R(4.3, -0.6, 9.7, 4.85)], spot: [7.0, 3.4] },
  { id: 'kitchen', name: 'Kitchen', floor: 0, rects: [R(-3.15, 0.6, 4.3, 4.85)], spot: [-0.4, 3.8] },
  { id: 'backentry', name: 'Back Entrance', floor: 0, rects: [R(-8.65, 0.6, -3.15, 3.75), R(-5.45, 3.75, -3.15, 4.85), R(-9.45, 1.1, -8.65, 3.25)], spot: [-6.4, 3.0] },
  // 2F
  { id: 'bathroom', name: 'Bathroom', floor: 1, rects: [R(-7.25, -7.4, -1.7, -5.5), R(-3.15, -5.5, -1.7, -2.5)], spot: [-5.6, -6.5] },
  { id: 'westhall', name: 'West Hall', floor: 1, rects: [R(-7.25, -5.5, -3.15, -2.45), R(-7.95, -2.45, -3.15, 2.2), R(-8.65, 2.2, -5.55, 3.75), R(-9.45, 1.1, -8.65, 3.25)], spot: [-5.4, -1.0] },
  { id: 'hallway2', name: 'Upper Hallway', floor: 1, rects: [R(-1.7, -5.5, 4.35, 0.55), R(-3.15, -2.5, -1.7, 0.55), R(-3.15, 0.55, 1.25, 2.2)], spot: [-0.6, -3.2] },
  { id: 'workshop', name: 'Workshop', floor: 1, rects: [R(4.35, -5.15, 8.3, -0.6)], spot: [6.4, -2.4] },
  { id: 'master', name: 'Master Bedroom', floor: 1, rects: [R(1.25, 0.55, 9.7, 4.85), R(4.35, -0.6, 9.7, 0.55)], spot: [5.4, 3.0] },
  { id: 'closet', name: 'Walk-in Closet', floor: 1, rects: [R(-1.8, 2.2, 1.25, 4.85)], spot: [-0.3, 3.6] },
  { id: 'kids', name: "Kids' Room", floor: 1, rects: [R(-7.25, 3.75, -1.8, 6.6), R(-5.55, 2.2, -1.8, 3.75)], spot: [-4.4, 5.2] },
];

/* ---------------------------------------------------------------- exterior */
export interface SpawnZoneDef {
  id: 'construction' | 'docks' | 'apc' | 'sidestreet';
  label: string;
  center: [number, number, number];
  radius: number;
  /** extraction area for hostage mode */
  extract: Rect;
}
export const SPAWN_ZONES: SpawnZoneDef[] = [
  { id: 'construction', label: 'Construction Site', center: [0, GROUND_Y, -38], radius: 6, extract: R(-10, -48, 10, -30) },
  { id: 'docks', label: 'River Docks', center: [38, LOWER_GROUND_Y, 0], radius: 5, extract: R(31, -12, 45, 14) },
  { id: 'apc', label: 'APC Area', center: [-36, GROUND_Y, 28], radius: 6, extract: R(-46, 18, -26, 38) },
  { id: 'sidestreet', label: 'Side Street', center: [0, GROUND_Y, 34], radius: 6, extract: R(-12, 28, 10, 42) },
];

export const MAP_BOUNDS = { x0: -58, x1: 58, z0: -58, z1: 58 };
/** house footprint (outer faces) — for exterior naming / suburb cut-outs */
export const HOUSE_RECT = R(-9.6, -7.55, 9.85, 6.75);
/** where the east driveway drops to river level (in front of the garage shutters) */
export const DRIVEWAY = R(7.05, -6.5, 12.0, 6.5);
/** drone vent shaft from the north yard down to the storage room (grille at grade) */
export const VENT_SHAFT = R(-4.85, -8.05, -4.15, -7.55);

/** Simple outdoor zone naming for HUD / WebMCP when not inside a room. */
export function exteriorZoneName(x: number, y: number, z: number): string {
  const inHouse = x > HOUSE_RECT.x0 && x < HOUSE_RECT.x1 && z > HOUSE_RECT.z0 && z < HOUSE_RECT.z1;
  if (y > 6.6 && inHouse) return 'Roof';
  if (y > 2.9 && y < 4.6 && x > -1.8 && x < 4.45 && z > -7.1 && z < -5.4) return 'Porch Roof';
  if (y > -0.6 && y < 1.5) {
    if (x > -1.8 && x < 4.45 && z > -7.1 && z < -4.8) return 'Front Porch';
    if (x > -7.4 && x < 2.1 && z > 4.8 && z < 6.8) return 'Back Porch';
  }
  if (x > -13.8 && x < -8.7 && z > -7.4 && z < -5.6 && y < -0.5) return 'Storage Stairwell';
  if (x > DRIVEWAY.x0 && x < DRIVEWAY.x1 && z > DRIVEWAY.z0 && z < DRIVEWAY.z1 && y < -1.5) return 'Garage Driveway';
  if (z < -24) return 'Construction Site';
  if (x > 26) return 'River Docks';
  if (x < -24 && z > 14) return 'APC Area';
  if (z > 22) return 'Side Street';
  if (z < -7.5) return 'Front Yard';
  if (x > 9.8) return 'East Yard';
  if (x < -9.6) return 'West Yard';
  if (z > 6.7) return 'Back Yard';
  return 'Exterior';
}
