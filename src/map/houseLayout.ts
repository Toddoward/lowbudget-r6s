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
 * The map itself is data: data/maps/house/*.json (map constants, walls, floors / roofs / hatches, stairs, rooms,
 * spawns / cameras, props) in world metres — this module types it, resolves its references and exports it.
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
import { dataFile } from '../data/index.ts';

export type FloorId = -1 | 0 | 1;
export type SurfaceTier = 'solid' | 'soft' | 'semi';
export type OpeningKind = 'door' | 'exterior_door' | 'window' | 'french' | 'open_window' | 'arch' | 'shutter' | 'vent';
export interface Rect { x0: number; z0: number; x1: number; z1: number }

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
  note?: string;
  group?: string;
}
/** non-axis-aligned exterior walls (bay window, NE chamfer) — always solid */
export interface DiagWallDef { floor: FloorId; a: [number, number]; b: [number, number]; window?: { at: number; w: number; y0?: number; h?: number; barricade?: boolean } }
export interface OpeningDims { y0: number; h: number; barricade: boolean; /** barricade starts this high (door bottom gap for drones / prone) */ gap: number }

/* ------------------------------------------------------------------ map constants (data/maps/house/map.json) */
interface MapData {
  floors: Record<'-1' | '0' | '1', { label: string; y: number }>;
  wallHeight: number; slab: number; roofY: number; lowerGroundY: number; cell: number; panelMaxWidth: number;
  roofPitch: number; roofOverhang: number;
  yard: Record<'road' | 'sidewalk' | 'site' | 'lowerTerrace' | 'upperTerrace' | 'garage' | 'westYard' | 'backYard' | 'south' | 'riverBed' | 'water', number>;
  openings: Record<OpeningKind, OpeningDims>;
  bounds: Rect; houseRect: Rect; driveway: Rect; ventShaft: Rect; garageVentWell: Rect; deckSteps: Rect[];
}
const MAP = dataFile<MapData>('maps/house/map.json');
export const FLOOR_Y: Record<FloorId, number> = { [-1]: MAP.floors['-1'].y, 0: MAP.floors['0'].y, 1: MAP.floors['1'].y };
export const FLOOR_LABEL: Record<FloorId, string> = { [-1]: MAP.floors['-1'].label, 0: MAP.floors['0'].label, 1: MAP.floors['1'].label };
/** floor → ceiling */
export const WALL_H = MAP.wallHeight;
export const SLAB_T = MAP.slab;
/**
 * Outdoor levels (1F floor = 0; the agreed heights, terrain.ts builds the ground from them). The House stands on a rise:
 * the front yard climbs from the road in two terraces with short flights to the porch stairs, so high that nobody on the
 * ground in front is seen from the 1F windows; the east road falls gently to the river and is level with the basement
 * where the garage drive leaves it; the west and back yards lie just under the 1F and back-deck level.
 */
export const YARD = MAP.yard;
/** basement level outside: the garage drive and the NW stairwell pit */
export const LOWER_GROUND_Y = MAP.lowerGroundY;
export const ROOF_Y = MAP.roofY;
export const CELL = MAP.cell;
/** reinforcement-sized soft wall sections (the model's soft walls come in ~1.1–1.4 m panels) */
export const PANEL_MAX_W = MAP.panelMaxWidth;
export const OPENING_DIMS: Record<OpeningKind, OpeningDims> = MAP.openings;
/** an opening's dimensions: its kind's, with the opening's own overrides */
export function openingDims(o: { kind: OpeningKind; y0?: number; h?: number; barricade?: boolean }): OpeningDims {
  const d = OPENING_DIMS[o.kind];
  return { ...d, y0: o.y0 ?? d.y0, h: o.h ?? d.h, barricade: o.barricade ?? d.barricade };
}

/* ------------------------------------------------------------------ walls (walls.json) */
const WALL_DATA = dataFile<{ walls: WallDef[]; diagonal: DiagWallDef[] }>('maps/house/walls.json');
export const WALLS: WallDef[] = WALL_DATA.walls.map((w) => ({ openings: [], ext: false, ...w }));
/** bay window + NE chamfer (the model's diagonal walls) */
export const DIAG_WALLS: DiagWallDef[] = WALL_DATA.diagonal;

/* ------------------------------------------------------------------ floors */
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
export interface StairDef {
  id: string;
  label: string;
  rect: Rect;
  axis: 'x' | 'z';
  /** y at the min-coordinate end and the max-coordinate end */
  yMin: number;
  yMax: number;
  exterior?: boolean;
  /** number of steps (default: risers of about 0.19 m) */
  steps?: number;
}
export interface HatchDef { id: string; label: string; rect: Rect; y: number; below: string; above: string }
/**
 * The pitched roof (blueprint roof plan): a hipped main block with a flat walkable top, hips over the north-west wing,
 * the Kids' Room wing, the east strip and the west bay. Every part is a convex solid on the 2F walls (eaves at ROOF_Y,
 * overhang ROOF_OVERHANG), its collider the same hull. Wings reach into the main block so their inner hip ends sink into
 * its slope.
 */
export interface RoofDef { id: string; rect: Rect; /** 'flat' = hip up to a flat top `rise` above the eaves; 'hip' = a ridge along the longer side */ ridge: 'flat' | 'hip'; rise?: number }

/* stairs.json */
const STAIR_DATA = dataFile<{ stairs: StairDef[]; landings: { rect: Rect; y: number; label: string }[]; mainLanding: Rect; backStairwell: Rect; nwStairwellPit: Rect; holes: { main: Rect; basement: Rect } }>('maps/house/stairs.json');
export const STAIRS: StairDef[] = STAIR_DATA.stairs;
/** the lobby stairs' corner landing (between the two flights of the L) */
export const MAIN_LANDING = STAIR_DATA.mainLanding;
export const LANDINGS = STAIR_DATA.landings;
/** the back stairwell: open from the basement to the 2F ceiling (landings at the half levels) */
export const BACK_STAIRWELL = STAIR_DATA.backStairwell;
/** the landing at the bottom of the NW basement stairs, up to the storage door */
export const NW_STAIRWELL_PIT = STAIR_DATA.nwStairwellPit;
/** the lobby stairs' well (over both flights and the landing) and the basement stairs' */
export const STAIR_HOLES = STAIR_DATA.holes;

/* floors.json: slabs (holes name a hatch by id, a stair well as `stairs:<name>`, or give a rect), roof parts, hatches */
const FLOOR_DATA = dataFile<{ floors: (Omit<FloorDef, 'holes'> & { holes?: (Rect | string)[] })[]; roofs: RoofDef[]; hatches: HatchDef[] }>('maps/house/floors.json');
export const HATCHES: HatchDef[] = FLOOR_DATA.hatches;
const holeRect = (h: Rect | string): Rect => {
  if (typeof h !== 'string') return h;
  const r = h.startsWith('stairs:') ? STAIR_HOLES[h.slice(7) as keyof typeof STAIR_HOLES] : HATCHES.find((x) => x.id === h)?.rect;
  if (!r) throw new Error(`floors.json: unknown hole ${h}`);
  return r;
};
export const FLOORS: FloorDef[] = FLOOR_DATA.floors.map((f) => ({ ...f, ...(f.holes ? { holes: f.holes.map(holeRect) } : {}) }) as FloorDef);
export const ROOF_PITCH = (MAP.roofPitch * Math.PI) / 180;
export const ROOF_OVERHANG = MAP.roofOverhang;
export const ROOFS: RoofDef[] = FLOOR_DATA.roofs;

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

/* ------------------------------------------------------------------- rooms (rooms.json) */
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
export const ROOMS: RoomDef[] = dataFile<{ rooms: RoomDef[] }>('maps/house/rooms.json').rooms;

/* ---------------------------------------------------------------- exterior (spawns.json, map.json) */
export interface SpawnZoneDef {
  id: 'construction' | 'docks' | 'apc' | 'sidestreet';
  label: string;
  center: [number, number, number];
  radius: number;
  /** extraction area for hostage mode */
  extract: Rect;
}
const SPAWN_DATA = dataFile<{ spawns: SpawnZoneDef[]; cameras: { id: string; label: string; pos: [number, number, number]; yawDeg: number; exterior: boolean }[] }>('maps/house/spawns.json');
/** the datamap's four Attacker Spawn Pad Centers (form 15): pad centre, its ground (terrain.test checks they agree), extraction */
export const SPAWN_ZONES: SpawnZoneDef[] = SPAWN_DATA.spawns;
/** six default cameras (exterior ones: pos y is the height over the ground under them — MapBuilder stands the pole on the terrain) */
export const CCTVS: { id: string; label: string; pos: [number, number, number]; yaw: number; exterior: boolean }[] =
  SPAWN_DATA.cameras.map(({ yawDeg, ...c }) => ({ ...c, yaw: (yawDeg * Math.PI) / 180 }));

/** the datamap's extent */
export const MAP_BOUNDS = MAP.bounds;
/** house footprint (outer faces) — for exterior naming / suburb cut-outs */
export const HOUSE_RECT = MAP.houseRect;
/** the back deck's step down to the back yard along its south edge */
export const DECK_STEPS = MAP.deckSteps;
/** the garage drive: level with the basement and with the east road it leaves (no ramp) */
export const DRIVEWAY = MAP.driveway;
/** drone vent shaft from the north yard down to the storage room (grille at grade), against the storage's north wall */
export const VENT_SHAFT = MAP.ventShaft;
/** a well outside the garage's B-level drone vent, open to the drive on its north side */
export const GARAGE_VENT_WELL = MAP.garageVentWell;

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
