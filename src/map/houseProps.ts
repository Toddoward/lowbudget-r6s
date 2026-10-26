import type { SurfaceMaterial } from '../core/Physics.ts';

/**
 * Furniture / cover. [x, z] = centre on the room floor, size = [sx, sy, sz].
 * `mat` decides bullet behaviour: fabric/wood props are penetrable (wallbang
 * through sofas), metal/vehicle/concrete stop rounds and are true hard cover.
 */
export interface PropDef {
  type: string;
  floor: -1 | 0 | 1;
  x: number;
  z: number;
  size: [number, number, number];
  mat: SurfaceMaterial;
  color: string;
  /** visual-only detail style */
  style?: 'ammo' | 'sofa' | 'bed' | 'table' | 'shelf' | 'car' | 'boat' | 'counter' | 'appliance' | 'shower' | 'tub' | 'bunk' | 'box' | 'bag' | 'pillar' | 'cylinder' | 'chair' | 'bench' | 'rack' | 'desk';
  /** raise off the floor (e.g. punching bag) */
  lift?: number;
  /** vehicles: lay the model's long axis along X (size is given in world X/Y/Z either way) */
  rot90?: boolean;
}

const P = (type: string, floor: -1 | 0 | 1, x: number, z: number, size: [number, number, number], mat: SurfaceMaterial, color: string, style?: PropDef['style'], lift?: number): PropDef =>
  ({ type, floor, x, z, size, mat, color, style, lift });

export const PROPS: PropDef[] = [
  // Every prop keeps the clearance zones in src/map/clearance.ts free (doorways ±1.2 m,
  // stair ends, hatches) — enforced by tools/tests/props.test.ts and the walk E2E.
  // ---------------- Basement: Storage (shelving along the walls, aisle to both doors)
  P('Metal Shelves', -1, -4.9, -7.15, [1.6, 2.0, 0.5], 'metal', '#7d8186', 'rack'),
  P('Metal Shelves', -1, -2.5, -7.1, [1.4, 2.0, 0.5], 'metal', '#7d8186', 'rack'),
  P('Metal Shelves', -1, -2.0, -5.6, [0.5, 2.0, 1.4], 'metal', '#7d8186', 'rack'),
  P('Boxes', -1, -3.65, -6.95, [0.8, 0.8, 0.8], 'wood', '#9b7f57', 'box'),
  P('Boxes', -1, -6.6, -5.15, [0.9, 0.6, 0.6], 'wood', '#9b7f57', 'box'),
  // Training Room: bench press, punching bags, mats
  P('Bench Press', -1, -5.6, -3.6, [0.7, 0.55, 1.7], 'metal', '#2c2f33', 'bench'),
  P('Weight Rack', -1, -0.4, -4.3, [1.4, 1.2, 0.5], 'metal', '#3a3d42', 'rack'),
  P('Punching Bag', -1, -1.6, -2.1, [0.4, 1.1, 0.4], 'fabric', '#7b2f2b', 'bag', 0.85),
  P('Punching Bag', -1, -6.6, -1.6, [0.4, 1.1, 0.4], 'fabric', '#7b2f2b', 'bag', 0.85),
  P('Floor Mat', -1, -4.0, -1.9, [2.4, 0.04, 1.6], 'fabric', '#2f4f6a'),
  P('Treadmill', -1, -7.1, -3.8, [0.8, 1.2, 1.8], 'metal', '#2c2f33', 'appliance'),
  // Garage: black sedan nosed at shutter B + white boat on a trailer (the two big hard covers)
  { ...P('Sedan', -1, 3.4, -2.6, [4.6, 1.45, 1.9], 'vehicle', '#141619', 'car'), rot90: true },
  P('Boat on Trailer', -1, 4.6, 2.1, [2.1, 1.7, 5.0], 'vehicle', '#e7e3d8', 'boat'),
  P('Shelves', -1, 1.4, -4.4, [1.6, 2.0, 0.5], 'metal', '#7d8186', 'rack'),
  P('Workbench', -1, 8.3, 4.45, [2.0, 0.9, 0.7], 'wood', '#6b4f33', 'desk'),
  P('Oil Drums', -1, 2.4, 1.2, [0.6, 0.9, 0.6], 'metal', '#3e5a7a', 'cylinder'),
  // Laundry Room: washer, dryer, folding table, shelf
  P('Washer', -1, -3.05, 1.2, [0.65, 0.9, 0.65], 'metal', '#e8e8e4', 'appliance'),
  P('Dryer', -1, -3.05, 1.95, [0.65, 0.9, 0.65], 'metal', '#dcdcd6', 'appliance'),
  P('Folding Table', -1, 0.95, 1.2, [1.6, 0.9, 0.9], 'wood', '#8a7350', 'table'),
  P('Laundry Shelf', -1, 1.6, 2.6, [0.5, 1.8, 0.8], 'wood', '#6d5a40', 'shelf'),
  P('Laundry Basket', -1, -2.0, 0.85, [0.6, 0.45, 0.45], 'fabric', '#b9b2a4', 'box'),
  // Side Stairs: ammo crate under the stairs
  P('Ammo Crate', -1, -7.8, 3.15, [0.75, 0.45, 0.45], 'wood', '#4b5a37', 'ammo'),
  P('Boxes', -1, -6.5, 3.35, [0.7, 0.7, 0.7], 'wood', '#9b7f57', 'box'),
  // Back Hallway
  P('Water Heater', -1, 1.4, 6.0, [0.55, 1.7, 0.55], 'metal', '#c9c6bd', 'cylinder'),
  P('Boxes', -1, -4.8, 6.0, [0.9, 0.7, 0.7], 'wood', '#9b7f57', 'box'),
  P('Bike', -1, -2.6, 6.1, [1.6, 0.9, 0.3], 'metal', '#8a2d2d'),

  // ---------------- 1F: Living Room (sofa + side sofa facing the TV, path to the arch and both french windows)
  P('Sofa', 0, -5.4, -1.2, [2.6, 0.85, 0.95], 'fabric', '#5a6a7a', 'sofa'),
  P('Sofa', 0, -6.3, -3.4, [0.95, 0.85, 1.9], 'fabric', '#5a6a7a', 'sofa'),
  P('Coffee Table', 0, -5.2, -2.0, [1.2, 0.45, 0.65], 'wood', '#5a4330', 'table'),
  P('TV Stand', 0, -5.1, -5.0, [2.0, 0.55, 0.45], 'wood', '#3a2c20', 'counter'),
  P('TV', 0, -5.1, -5.05, [1.4, 0.8, 0.08], 'metal', '#111214', undefined, 0.55),
  P('Armchair', 0, -2.6, -6.4, [0.9, 0.9, 0.9], 'fabric', '#7a5a45', 'chair'),
  P('Bookshelf', 0, -6.95, -6.4, [0.4, 2.0, 1.4], 'wood', '#5a4330', 'shelf'),
  // Lobby
  P('Console Table', 0, -1.5, -1.6, [0.4, 0.85, 1.2], 'wood', '#4f3a26', 'table'),
  // Office (desk + bookcases)
  P('Desk', 0, 6.1, -3.1, [1.7, 0.76, 0.85], 'wood', '#5a4330', 'desk'),
  P('Office Chair', 0, 6.1, -2.25, [0.6, 1.0, 0.6], 'fabric', '#1f2124', 'chair'),
  P('Bookcase', 0, 4.65, -3.6, [0.45, 2.1, 1.6], 'wood', '#4f3a26', 'shelf'),
  P('Bookcase', 0, 8.05, -2.8, [0.45, 2.1, 1.6], 'wood', '#4f3a26', 'shelf'),
  P('Filing Cabinet', 0, 7.95, -1.45, [0.5, 1.3, 0.6], 'metal', '#6b6f75', 'appliance'),
  // Dining Room: four-seat table (clear of the arch and the master-bedroom hatch above) + ammo crate
  P('Dining Table', 0, 6.6, 2.6, [2.0, 0.78, 1.15], 'wood', '#6b4a2b', 'table'),
  ...[6.1, 7.1].flatMap((x) => [
    P('Chair', 0, x, 1.55, [0.48, 0.95, 0.48], 'wood', '#4f3a26', 'chair'),
    P('Chair', 0, x, 3.65, [0.48, 0.95, 0.48], 'wood', '#4f3a26', 'chair'),
  ]),
  P('Sideboard', 0, 5.4, 4.5, [1.8, 0.9, 0.5], 'wood', '#4f3a26', 'counter'),
  P('Ammo Crate', 0, 9.2, 4.3, [0.75, 0.45, 0.45], 'wood', '#4b5a37', 'ammo'),
  // Kitchen: island, fridge, counters + stove along the south wall
  P('Kitchen Island', 0, 0.6, 2.6, [2.2, 0.92, 1.0], 'concrete', '#d9d4c8', 'counter'),
  P('Fridge', 0, -1.5, 4.45, [0.8, 1.9, 0.7], 'metal', '#c9cbcd', 'appliance'),
  P('Counter', 0, -0.2, 4.55, [1.6, 0.92, 0.6], 'concrete', '#d9d4c8', 'counter'),
  P('Stove', 0, 1.0, 4.55, [0.75, 0.92, 0.6], 'metal', '#2c2f33', 'appliance'),
  P('Counter', 0, 2.5, 4.55, [2.2, 0.92, 0.6], 'concrete', '#d9d4c8', 'counter'),
  // Back Entrance
  P('Shoe Bench', 0, -7.6, 3.45, [1.2, 0.5, 0.4], 'wood', '#5a4330', 'bench'),
  P('Umbrella Stand', 0, -8.3, 0.9, [0.3, 0.7, 0.3], 'metal', '#2c2f33', 'cylinder'),
  // Front porch
  P('Porch Bench', 0, -1.4, -6.6, [0.5, 0.5, 1.4], 'wood', '#6b4f33', 'bench'),
  P('Planter', 0, 3.8, -6.7, [0.6, 0.7, 0.6], 'concrete', '#7a6a58', 'box'),

  // ---------------- 2F: Bathroom (shower booth = bulletproof partitions, in the NE corner)
  P('Shower Booth', 1, -2.35, -6.75, [1.25, 2.2, 1.3], 'concrete', '#e8e4da', 'shower'),
  P('Bathtub', 1, -6.85, -6.45, [0.8, 0.6, 1.7], 'concrete', '#efece4', 'tub'),
  P('Vanity Sink', 1, -4.4, -7.1, [1.2, 0.86, 0.5], 'concrete', '#d9d4c8', 'counter'),
  P('Toilet', 1, -3.4, -7.05, [0.45, 0.75, 0.65], 'concrete', '#f2f0ea', 'appliance'),
  // West Hall
  P('Dresser', 1, -7.0, -1.0, [0.5, 1.1, 1.5], 'wood', '#5a4330', 'counter'),
  P('Bench', 1, -5.2, 1.7, [1.4, 0.45, 0.45], 'wood', '#6b4f33', 'bench'),
  P('Plant', 1, -7.6, 0.2, [0.45, 1.2, 0.45], 'fabric', '#3f5a2e', 'cylinder'),
  // Upper Hallway
  P('Hall Table', 1, -0.8, -5.1, [1.2, 0.8, 0.4], 'wood', '#4f3a26', 'table'),
  // Workshop: workbench, tool shelf, table saw, ammo crate
  P('Workbench', 1, 6.0, -4.65, [2.2, 0.95, 0.8], 'wood', '#6b4f33', 'desk'),
  P('Tool Shelf', 1, 8.0, -3.0, [0.5, 1.9, 1.4], 'metal', '#5d6268', 'rack'),
  P('Table Saw', 1, 6.2, -2.4, [1.1, 0.9, 0.8], 'metal', '#3e5a7a', 'appliance'),
  P('Ammo Crate', 1, 7.8, -0.95, [0.75, 0.45, 0.45], 'wood', '#4b5a37', 'ammo'),
  // Master Bedroom: king bed, nightstands, cupboard, ammo crate
  P('King Bed', 1, 5.6, 3.3, [2.0, 0.62, 2.2], 'fabric', '#c9c2b2', 'bed'),
  P('Nightstand', 1, 4.25, 4.4, [0.5, 0.55, 0.45], 'wood', '#4f3a26', 'box'),
  P('Nightstand', 1, 6.95, 4.4, [0.5, 0.55, 0.45], 'wood', '#4f3a26', 'box'),
  P('Cupboard', 1, 3.6, 0.85, [1.6, 1.15, 0.55], 'wood', '#5a4330', 'counter'),
  P('Armchair', 1, 9.0, 0.0, [0.9, 0.9, 0.9], 'fabric', '#7a5a45', 'chair'),
  P('Ammo Crate', 1, 9.2, 4.35, [0.75, 0.45, 0.45], 'wood', '#4b5a37', 'ammo'),
  // Walk-in Closet
  P('Clothes Rack', 1, -1.45, 3.5, [0.5, 1.8, 2.0], 'fabric', '#6a5a7a', 'rack'),
  P('Clothes Rack', 1, 0.3, 4.55, [1.6, 1.8, 0.45], 'fabric', '#7a5a5a', 'rack'),
  // Kids' Room: crib, toy shelf, small desk
  P('Crib', 1, -6.4, 4.4, [1.3, 1.0, 0.7], 'wood', '#e0d6c2', 'bunk'),
  P('Toy Shelf', 1, -2.45, 6.3, [1.2, 1.2, 0.4], 'wood', '#c25b4a', 'shelf'),
  P('Kids Desk', 1, -4.4, 6.0, [1.0, 0.65, 0.6], 'wood', '#6aa0c8', 'desk'),
  P('Toy Box', 1, -5.0, 2.55, [0.7, 0.5, 0.5], 'wood', '#d9b23a', 'box'),
];

/** ammo crates = resupply points (interact) */
export const AMMO_CRATES = PROPS.filter((p) => p.style === 'ammo');
