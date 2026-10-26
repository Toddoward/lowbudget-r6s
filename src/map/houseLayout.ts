/**
 * Original House (2015 launch version) — data-driven reconstruction.
 *
 * World axes: +X = East, +Y = Up, +Z = South (so North = -Z). 1 unit = 1 m.
 * The front facade (porch + lobby + front door) faces WEST onto the main road
 * and the APC area; the garage shutters open EAST to the lower driveway that
 * runs down to the River Docks (the lot slopes ~3 m toward the river, which is
 * why the basement garage is at ground level on the east side only). The back
 * entrance and the exterior side stairs are on the SOUTH (Side Street) side;
 * the Construction Site is NORTH.
 *
 *   Level      floor top   walls          slab under next level
 *   Basement   y = -3      -3.0 .. -0.2   -0.2 .. 0.0  (concrete)
 *   1F         y =  0       0.0 ..  2.8    2.8 .. 3.0  (wooden joists → semi-breach)
 *   2F         y =  3       3.0 ..  5.8    5.8 .. 6.0  (roof, concrete)
 *
 *                     N (-Z)  Construction Site
 *      x=-8     -3      2.5       8
 *   z=-7 ┌───────┬───────┬────────┐      Basement: Storage(NW, ext. door N) /
 *        │  W-N  │  C-N  │  E-N   │                Laundry(W) / Training(C) /
 *   z=-2 ├───────┼───────┼────────┤                Hall(C-S) / Garage(E, 2 shutters)
 *  (W)   │  W-M  │  C-M  │  E-M   │ (E) Docks
 *   z= 2 ├───────┼───────┼────────┤      1F: Living / Lobby / Office / Dining /
 *        │  W-S  │  C-S  │  E-S   │          Stair Hall / Kitchen / Back Hall / Pantry
 *   z= 7 └───────┴───────┴────────┘      2F: Bathroom / Master+Walk-in / Workshop /
 *                     S (+Z)  Side Street      Upper Hallway (open window W) / Kids' Room
 *
 * Walls are listed as axis-aligned lines; the builder slices them into
 * destructible panels (0.25 m cells) according to their tier:
 *   soft  (red)    – wallbang holes, melee murder holes, breach/sledge/ash passage
 *   semi  (yellow) – studs/joists stay: see & shoot through, cannot pass
 *   solid (white)  – indestructible concrete / exterior / bulletproof closet
 */

export type FloorId = -1 | 0 | 1;
export const FLOOR_Y: Record<FloorId, number> = { [-1]: -3, 0: 0, 1: 3 };
export const FLOOR_LABEL: Record<FloorId, string> = { [-1]: 'B', 0: '1F', 1: '2F' };
export const WALL_H = 2.8;
export const SLAB_T = 0.2;
export const GROUND_Y = -0.2;
export const LOWER_GROUND_Y = -3;
export const ROOF_Y = 6;
export const CELL = 0.25;

export type SurfaceTier = 'solid' | 'soft' | 'semi';
export type OpeningKind = 'door' | 'window' | 'open_window' | 'arch' | 'exterior_door' | 'shutter';

export interface OpeningDef {
  /** centre along the wall's run axis */
  at: number;
  w: number;
  kind: OpeningKind;
}
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
}

export const OPENING_DIMS: Record<OpeningKind, { y0: number; h: number; barricade: boolean }> = {
  door: { y0: 0, h: 2.25, barricade: true },
  exterior_door: { y0: 0, h: 2.25, barricade: true },
  arch: { y0: 0, h: 2.5, barricade: false },
  window: { y0: 1.0, h: 1.25, barricade: true },
  open_window: { y0: 0.75, h: 1.5, barricade: false },
  shutter: { y0: 0, h: 2.5, barricade: false },
};

const W = (floor: FloorId, run: 'x' | 'z', c: number, from: number, to: number, tier: SurfaceTier, openings: OpeningDef[] = [], ext = false): WallDef =>
  ({ floor, run, c, from, to, tier, openings, ext });
const door = (at: number, w = 1): OpeningDef => ({ at, w, kind: 'door' });
const win = (at: number, w = 1): OpeningDef => ({ at, w, kind: 'window' });

export const WALLS: WallDef[] = [
  /* ============================== BASEMENT (-3) ============================== */
  // exterior (underground concrete)
  W(-1, 'x', -7, -8, 8, 'solid', [{ at: -5.5, w: 1, kind: 'exterior_door' }], true), // storage door → NW stairwell
  W(-1, 'z', -8, -7, 7, 'solid', [], true),
  W(-1, 'x', 7, -8, 8, 'solid', [], true),
  W(-1, 'z', 8, -7, 7, 'solid', [{ at: -3.5, w: 3, kind: 'shutter' }, { at: 3.5, w: 3, kind: 'shutter' }], true), // 2 garage shutters
  // interior
  W(-1, 'x', -4, -8, -3, 'soft', [door(-5.5)]), // storage | laundry
  W(-1, 'z', -3, -7, -4, 'soft'), // storage | training
  W(-1, 'z', -3, -4, 7, 'soft', [door(-1), door(4)]), // laundry | training / hall
  W(-1, 'x', 1, -3, 2.5, 'soft', [door(-0.75)]), // training | basement hall
  W(-1, 'z', 2.5, -7, 1, 'semi'), // training | garage (studs stay)
  W(-1, 'z', 2.5, 1, 7, 'soft', [door(4)]), // hall | garage

  /* ================================ 1F (0) ================================== */
  // exterior
  W(0, 'z', -8, -7, -2, 'soft', [win(-5.75), win(-3.75)], true), // living W (2 windows)
  W(0, 'z', -8, -2, 2, 'soft', [{ at: 0, w: 1.25, kind: 'exterior_door' }], true), // lobby front door
  W(0, 'z', -8, 2, 7, 'soft', [win(3.5), win(5.5)], true), // office W (porch)
  W(0, 'x', -7, -8, -3, 'soft', [win(-6.5), win(-4.5)], true), // living N (2 windows)
  W(0, 'x', -7, -3, 2.5, 'soft', [win(-0.25)], true), // dining N
  W(0, 'x', -7, 2.5, 8, 'solid', [win(5.25)], true), // kitchen N
  W(0, 'z', 8, -7, 2.5, 'solid', [win(-4.5), win(-0.5)], true), // kitchen E
  W(0, 'z', 8, 2.5, 7, 'soft', [win(4.5)], true), // pantry E
  W(0, 'x', 7, -8, -3, 'soft', [win(-5.5)], true), // office S (3rd office window)
  W(0, 'x', 7, -3, 2.5, 'soft', [{ at: -0.25, w: 1, kind: 'exterior_door' }], true), // back entrance
  W(0, 'x', 7, 2.5, 8, 'solid', [win(5.25)], true), // pantry S
  // interior
  W(0, 'x', -2, -8, -3, 'soft', [door(-3.5, 0.9)]), // living | lobby (east of the living-room stair well)
  W(0, 'x', 2, -8, -3, 'soft', [door(-4)]), // lobby | office
  W(0, 'z', -3, -7, -2, 'soft', [door(-5.5)]), // living | dining
  W(0, 'z', -3, -2, 2, 'soft', [{ at: -0.5, w: 2.5, kind: 'arch' }]), // lobby | stair hall
  W(0, 'z', -3, 2, 7, 'soft', [door(4.5)]), // office | back hall
  W(0, 'x', -2, -3, 2.5, 'soft', [door(2)]), // dining | stair hall
  W(0, 'z', 2.5, -7, -2, 'semi', [door(-4.5)]), // dining | kitchen
  W(0, 'z', 2.5, -2, 2, 'soft', [door(1.5)]), // stair hall | kitchen (onto the kitchen-stairs landing)
  W(0, 'z', 2.5, 2, 2.5, 'soft'), // short return between the stair hall door and the pantry wall
  W(0, 'x', 2, -3, 2.5, 'soft', [{ at: -0.25, w: 1.5, kind: 'arch' }]), // stair hall | back hall
  W(0, 'z', 2.5, 2, 7, 'soft', [door(4.5)]), // back hall | pantry
  W(0, 'x', 2.5, 2.5, 8, 'soft', [door(6)]), // kitchen | pantry (0.9 m landing in front of the kitchen stairs)

  /* ================================ 2F (3) ================================== */
  // exterior
  W(1, 'z', -8, -7, -2, 'soft', [win(-4.5)], true), // bathroom W
  W(1, 'x', -2, -8, -6, 'solid', [], true), // bathroom S face over lobby roof
  W(1, 'z', -6, -2, 2, 'solid', [{ at: 0, w: 1.25, kind: 'open_window' }], true), // upper hallway OPEN WINDOW above front door
  W(1, 'x', 2, -8, -6, 'soft', [win(-7)], true), // kids N window → lobby/porch roof
  W(1, 'z', -8, 2, 7, 'soft', [win(3.5), win(5.5)], true), // kids W (2)
  W(1, 'x', 7, -8, -3, 'soft', [win(-5.5)], true), // kids S
  W(1, 'z', -3, 2, 7, 'soft', [], true), // kids E (faces back roof)
  W(1, 'x', -7, -8, -3, 'solid', [win(-5.5)], true), // bathroom N
  W(1, 'x', -7, -3, 2.5, 'soft', [win(1)], true), // master N
  W(1, 'x', -7, 2.5, 8, 'solid', [win(5.25)], true), // workshop N
  W(1, 'z', 8, -7, -2, 'soft', [win(-4.5)], true), // workshop E
  W(1, 'z', 8, -2, 2, 'solid', [win(0)], true), // hallway E
  W(1, 'x', 2, -3, 8, 'soft', [win(0), win(5)], true), // hallway S → back roof
  // interior
  W(1, 'x', -2, -6, -3, 'soft', [door(-4.5)]), // bathroom | hallway
  W(1, 'x', 2, -6, -3, 'soft', [door(-4.5)]), // kids | hallway — kids' front soft wall
  W(1, 'z', -3, -7, -5, 'solid'), // bathroom | walk-in (bulletproof)
  W(1, 'z', -3, -5, -2, 'soft'), // bathroom | master
  W(1, 'z', -1, -7, -5, 'solid', [door(-6)]), // walk-in closet E (bulletproof)
  W(1, 'x', -5, -3, -1, 'solid'), // walk-in closet S (bulletproof)
  W(1, 'x', -2, -3, 2.5, 'soft', [door(2)]), // master | hallway
  W(1, 'z', 2.5, -7, -2, 'semi', [door(-6)]), // master | workshop
  W(1, 'x', -2, 2.5, 8, 'soft', [door(5.25)]), // workshop | hallway
];

/* ------------------------------------------------------------------ floors */
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type FloorKind = 'concrete' | 'wood' | 'hatch' | 'roof';
export interface FloorDef {
  id: string;
  /** top surface y */
  y: number;
  rect: Rect;
  tier: SurfaceTier;
  kind: FloorKind;
  /** void rectangles (stair wells) */
  holes?: Rect[];
  label?: string;
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
  { id: 'stairs_living', label: 'Living Room Stairs', rect: R(-7.6, -3.25, -4, -2.1), axis: 'x', yMin: -3, yMax: 0 },
  { id: 'stairs_kitchen', label: 'Kitchen Stairs', rect: R(2.75, -2.5, 4, 1.5), axis: 'z', yMin: -3, yMax: 0 },
  { id: 'stairs_main', label: 'Main Stairs', rect: R(-2.5, -1.75, 1.5, -0.5), axis: 'x', yMin: 0, yMax: 3 },
  { id: 'stairs_storage_ext', label: 'Storage Stairwell', rect: R(-6, -11.5, -5, -7.15), axis: 'z', yMin: GROUND_Y, yMax: -3, exterior: true },
  { id: 'stairs_side', label: 'Side Stairs', rect: R(0.5, 7.15, 8.15, 9.3), axis: 'x', yMin: GROUND_Y, yMax: LOWER_GROUND_Y, exterior: true },
];
export const STAIR_HOLES = {
  living: R(-7.6, -3.25, -4, -2.1),
  kitchen: R(2.75, -2.5, 4, 1.5),
  main: R(-2.5, -1.75, 1.5, -0.5),
};

export interface HatchDef { id: string; label: string; rect: Rect; y: number; below: string; above: string }
export const HATCHES: HatchDef[] = [
  { id: 'hatch_garage', label: 'Pantry → Garage Hatch', rect: R(5, 4, 6, 5), y: 0, below: 'garage', above: 'pantry' },
  { id: 'hatch_laundry', label: 'Office → Laundry Hatch', rect: R(-6, 4, -5, 5), y: 0, below: 'laundry', above: 'office' },
  { id: 'hatch_master', label: 'Master Bedroom → Dining Hatch', rect: R(0, -5, 1, -4), y: 3, below: 'dining', above: 'master' },
  { id: 'hatch_hallway', label: 'Upper Hallway → Kitchen Stairs Hatch', rect: R(3, 0, 4, 1), y: 3, below: 'kitchen', above: 'hallway2' },
];

export const FLOORS: FloorDef[] = [
  // basement floor (ground-bearing concrete)
  { id: 'slab_b', y: -3, rect: R(-8.15, -7.15, 8.15, 7.15), tier: 'solid', kind: 'concrete' },
  // 1F floor = basement ceiling (concrete; hatches + living/kitchen stair wells)
  { id: 'slab_1f', y: 0, rect: R(-8.15, -7.15, 8.15, 7.15), tier: 'solid', kind: 'concrete', holes: [STAIR_HOLES.living, STAIR_HOLES.kitchen, HATCHES[0].rect, HATCHES[1].rect] },
  // 2F floor (wooden joists — semi-breach) split per room above
  { id: 'wood_bath', y: 3, rect: R(-8, -7, -3, -2), tier: 'semi', kind: 'wood', label: '2F Bathroom Floor' },
  { id: 'wood_master', y: 3, rect: R(-3, -7, 2.5, -2), tier: 'semi', kind: 'wood', holes: [HATCHES[2].rect], label: '2F Master Bedroom Floor' },
  { id: 'wood_workshop', y: 3, rect: R(2.5, -7, 8, -2), tier: 'semi', kind: 'wood', label: '2F Workshop Floor' },
  { id: 'wood_hall_w', y: 3, rect: R(-6, -2, -3, 2), tier: 'semi', kind: 'wood', label: '2F Upper Hallway Floor (W)' },
  { id: 'wood_hall_c', y: 3, rect: R(-3, -2, 2.5, 2), tier: 'semi', kind: 'wood', holes: [STAIR_HOLES.main], label: '2F Upper Hallway Floor (C)' },
  { id: 'wood_hall_e', y: 3, rect: R(2.5, -2, 8, 2), tier: 'semi', kind: 'wood', holes: [HATCHES[3].rect], label: '2F Upper Hallway Floor (E)' },
  { id: 'wood_kids', y: 3, rect: R(-8, 2, -3, 7), tier: 'semi', kind: 'wood', label: "2F Kids' Room Floor" },
  { id: 'roof_back', y: 3, rect: R(-3, 2, 8.15, 7.15), tier: 'semi', kind: 'roof', label: 'Back Roof' },
  { id: 'roof_lobby', y: 3, rect: R(-8.15, -2, -6, 2), tier: 'solid', kind: 'roof', label: 'Lobby Roof' },
  { id: 'roof_porch', y: 3, rect: R(-10.75, -2.5, -8.15, 7.15), tier: 'solid', kind: 'roof', label: 'Porch Roof' },
  // edge strips so 2F slab meets the exterior walls' outer faces
  { id: 'edge_n2', y: 3, rect: R(-8.15, -7.15, 8.15, -7), tier: 'solid', kind: 'roof' },
  { id: 'edge_w2a', y: 3, rect: R(-8.15, -7, -8, -2), tier: 'solid', kind: 'roof' },
  { id: 'edge_w2b', y: 3, rect: R(-8.15, 2, -8, 7.15), tier: 'solid', kind: 'roof' },
  { id: 'edge_e2', y: 3, rect: R(8, -7, 8.15, 2), tier: 'solid', kind: 'roof' },
  { id: 'edge_s2', y: 3, rect: R(-8, 7, -3, 7.15), tier: 'solid', kind: 'roof' },
  // main roof (flat, low parapet) over the 2F footprint
  { id: 'roof_n', y: ROOF_Y, rect: R(-8.15, -7.15, 8.15, -2), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_m', y: ROOF_Y, rect: R(-6.15, -2, 8.15, 2), tier: 'solid', kind: 'roof', label: 'Roof' },
  { id: 'roof_s', y: ROOF_Y, rect: R(-8.15, 2, -2.85, 7.15), tier: 'solid', kind: 'roof', label: 'Roof' },
  // porch deck
  { id: 'porch_deck', y: 0, rect: R(-10.75, -2.5, -8.15, 7.15), tier: 'solid', kind: 'wood', label: 'Front Porch' },
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
  { id: 'storage', name: 'Storage Room', floor: -1, rects: [R(-8, -7, -3, -4)], spot: [-4.5, -5.5] },
  { id: 'laundry', name: 'Laundry Room', floor: -1, rects: [R(-8, -4, -3, 7)], spot: [-5.5, 2.5] },
  { id: 'training', name: 'Training Room', floor: -1, rects: [R(-3, -7, 2.5, 1)], spot: [-0.5, -4.5] },
  { id: 'hallway_b', name: 'Basement Hallway', floor: -1, rects: [R(-3, 1, 2.5, 7)], spot: [-0.25, 4] },
  { id: 'garage', name: 'Garage', floor: -1, rects: [R(2.5, -7, 8, 7)], spot: [4, 4.75] },
  // 1F
  { id: 'living', name: 'Living Room', floor: 0, rects: [R(-8, -7, -3, -2)], spot: [-6.8, -4.2] },
  { id: 'lobby', name: 'Lobby', floor: 0, rects: [R(-8, -2, -3, 2)], spot: [-5.5, 0.5] },
  { id: 'office', name: 'Office', floor: 0, rects: [R(-8, 2, -3, 7)], spot: [-6, 3] },
  { id: 'dining', name: 'Dining Room', floor: 0, rects: [R(-3, -7, 2.5, -2)], spot: [-1.5, -3] },
  { id: 'stairhall', name: 'Stair Hall', floor: 0, rects: [R(-3, -2, 2.5, 2)], spot: [0.5, 0.6] },
  { id: 'kitchen', name: 'Kitchen', floor: 0, rects: [R(2.5, -7, 8, 2.5)], spot: [6.5, -1] },
  { id: 'backhall', name: 'Back Entrance', floor: 0, rects: [R(-3, 2, 2.5, 7)], spot: [-0.25, 4.5] },
  { id: 'pantry', name: 'Pantry', floor: 0, rects: [R(2.5, 2.5, 8, 7)], spot: [4, 3.4] },
  // 2F
  { id: 'bathroom', name: 'Bathroom', floor: 1, rects: [R(-8, -7, -3, -2)], spot: [-5.5, -4] },
  { id: 'master', name: 'Master Bedroom', floor: 1, rects: [R(-1, -7, 2.5, -2), R(-3, -5, -1, -2)], spot: [-0.3, -6.2] },
  { id: 'closet', name: 'Walk-in Closet', floor: 1, rects: [R(-3, -7, -1, -5)], spot: [-2, -6] },
  { id: 'workshop', name: 'Workshop', floor: 1, rects: [R(2.5, -7, 8, -2)], spot: [5.6, -4] },
  { id: 'hallway2', name: 'Upper Hallway', floor: 1, rects: [R(-6, -2, 8, 2)], spot: [-3.5, 0.5] },
  { id: 'kids', name: "Kids' Room", floor: 1, rects: [R(-8, 2, -3, 7)], spot: [-5, 4.25] },
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
  { id: 'construction', label: 'Construction Site', center: [-2, GROUND_Y, -36], radius: 6, extract: R(-12, -46, 8, -28) },
  { id: 'docks', label: 'River Docks', center: [37, -2.8, 2], radius: 5, extract: R(30, -12, 44, 16) },
  { id: 'apc', label: 'APC Area', center: [-36, GROUND_Y, 30], radius: 6, extract: R(-46, 20, -26, 40) },
  { id: 'sidestreet', label: 'Side Street', center: [0, GROUND_Y, 34], radius: 6, extract: R(-12, 28, 8, 42) },
];

export const MAP_BOUNDS = { x0: -58, x1: 58, z0: -58, z1: 58 };

/** Simple outdoor zone naming for HUD / WebMCP when not inside a room. */
export function exteriorZoneName(x: number, y: number, z: number): string {
  if (y > 5.5 && x > -8.5 && x < 8.5 && z > -7.5 && z < 7.5) return 'Roof';
  if (y > 2.5 && y < 4.5) {
    if (x < -8 && x > -11 && z > -2.6 && z < 7.3) return 'Porch Roof';
    if (x < -6 && x > -8.2 && z > -2 && z < 2) return 'Lobby Roof';
    if (x > -3 && x < 8.3 && z > 2 && z < 7.3) return 'Back Roof';
  }
  if (x < -8 && x > -11 && z > -2.6 && z < 7.3) return 'Front Porch';
  if (z < -20) return 'Construction Site';
  if (x > 26) return 'River Docks';
  if (x < -24 && z > 14) return 'APC Area';
  if (z > 20) return 'Side Street';
  if (x > 8) return 'Driveway (East)';
  if (x < -11) return 'Front Yard';
  if (z < -7) return 'North Yard';
  if (z > 7) return 'South Yard';
  return 'Exterior';
}
