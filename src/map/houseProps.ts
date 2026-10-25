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
  style?: 'sofa' | 'bed' | 'table' | 'shelf' | 'car' | 'boat' | 'counter' | 'appliance' | 'shower' | 'tub' | 'bunk' | 'box' | 'bag' | 'pillar' | 'cylinder' | 'chair' | 'bench' | 'rack' | 'desk';
  /** raise off the floor (e.g. punching bag) */
  lift?: number;
}

const P = (type: string, floor: -1 | 0 | 1, x: number, z: number, size: [number, number, number], mat: SurfaceMaterial, color: string, style?: PropDef['style'], lift?: number): PropDef =>
  ({ type, floor, x, z, size, mat, color, style, lift });

export const PROPS: PropDef[] = [
  // ---------------- Basement
  P('Shelves', -1, -7.0, -6.6, [1.5, 2.0, 0.55], 'wood', '#6d5a40', 'shelf'),
  P('Shelves', -1, -3.9, -6.6, [1.4, 2.0, 0.55], 'wood', '#6d5a40', 'shelf'),
  P('Boxes', -1, -4.2, -5.0, [0.8, 0.8, 0.8], 'wood', '#9b7f57', 'box'),
  P('Boxes', -1, -7.3, -4.75, [0.9, 0.6, 0.6], 'wood', '#9b7f57', 'box'),
  P('Washer', -1, -7.5, 0.5, [0.7, 0.9, 0.7], 'metal', '#d9d9d4', 'appliance'),
  P('Dryer', -1, -7.5, 1.3, [0.7, 0.9, 0.7], 'metal', '#d9d9d4', 'appliance'),
  P('Laundry Table', -1, -5.5, 5.6, [1.6, 0.85, 0.8], 'wood', '#7d6a50', 'table'),
  P('Water Heater', -1, -7.4, 6.4, [0.7, 1.6, 0.7], 'metal', '#b9b9b0', 'cylinder'),
  P('Sink', -1, -7.55, -1.2, [0.6, 0.9, 0.6], 'metal', '#c9c9c4', 'appliance'),
  P('Shelves', -1, -3.4, 6.4, [0.5, 1.8, 1.0], 'wood', '#6d5a40', 'shelf'),
  P('Punching Bag', -1, 1.5, -6.0, [0.5, 1.2, 0.5], 'fabric', '#7a2020', 'bag', 0.8),
  P('Treadmill', -1, -2.3, -6.1, [0.8, 1.2, 1.8], 'metal', '#2a2a2a', 'appliance'),
  P('Weight Rack', -1, 2.0, -1.0, [0.6, 1.2, 1.5], 'metal', '#333', 'rack'),
  P('Bench', -1, -1.8, -2.4, [0.5, 0.5, 1.4], 'fabric', '#222', 'bench'),
  P('Mats', -1, -0.3, -4.0, [2.4, 0.04, 2.4], 'fabric', '#2f4f6f'),
  P('Shelves', -1, 2.05, 6.4, [0.6, 1.8, 1.0], 'wood', '#6d5a40', 'shelf'),
  P('Boxes', -1, -2.4, 6.4, [0.7, 0.7, 0.7], 'wood', '#9b7f57', 'box'),
  P('Sedan', -1, 5.65, -4.4, [1.8, 1.4, 4.4], 'vehicle', '#5a6b7c', 'car'),
  P('Boat', -1, 5.75, 4.3, [1.9, 1.3, 4.6], 'vehicle', '#d8d4c8', 'boat'),
  P('Pillar', -1, 6.0, 0.0, [0.8, 2.8, 0.8], 'concrete', '#8f8c86', 'pillar'),
  P('Workbench', -1, 2.9, -5.5, [0.6, 0.9, 2.0], 'wood', '#6d5a40', 'counter'),
  P('Tool Shelf', -1, 7.6, 0.0, [0.5, 1.8, 1.6], 'metal', '#4b4f55', 'shelf'),
  // ---------------- 1F
  P('Sofa', 0, -5.5, -6.3, [2.2, 0.8, 0.9], 'fabric', '#5b4a3f', 'sofa'),
  P('Coffee Table', 0, -5.5, -5.2, [1.2, 0.45, 0.6], 'wood', '#5e4128', 'table'),
  P('TV Stand', 0, -5.5, -3.95, [1.6, 0.6, 0.45], 'wood', '#2e2b28', 'counter'),
  P('Armchair', 0, -7.4, -5.2, [0.8, 0.85, 0.8], 'fabric', '#6b5444', 'chair'),
  P('Bookcase', 0, -3.35, -4.2, [0.4, 1.8, 0.9], 'wood', '#4f3a26', 'shelf'),
  P('Shoe Cabinet', 0, -7.7, 1.5, [0.4, 1.0, 0.8], 'wood', '#5e4128', 'counter'),
  P('Bench', 0, -6.0, 1.75, [1.2, 0.45, 0.4], 'wood', '#5e4128', 'bench'),
  P('Desk', 0, -4.6, 6.25, [1.6, 0.75, 0.8], 'wood', '#5e4128', 'desk'),
  P('Office Chair', 0, -4.6, 5.45, [0.55, 0.9, 0.55], 'fabric', '#222', 'chair'),
  P('Bookshelf', 0, -7.7, 4.5, [0.4, 1.9, 0.8], 'wood', '#4f3a26', 'shelf'),
  P('Filing Cabinet', 0, -3.35, 3.2, [0.5, 1.3, 0.6], 'metal', '#5b6067', 'appliance'),
  P('Dining Table', 0, -0.25, -4.5, [2.6, 0.75, 1.1], 'wood', '#6b4a2b', 'table'),
  P('Chair', 0, -1.2, -5.35, [0.45, 0.95, 0.45], 'wood', '#5e4128', 'chair'),
  P('Chair', 0, 0.7, -5.35, [0.45, 0.95, 0.45], 'wood', '#5e4128', 'chair'),
  P('Chair', 0, -1.2, -3.65, [0.45, 0.95, 0.45], 'wood', '#5e4128', 'chair'),
  P('Chair', 0, 0.7, -3.65, [0.45, 0.95, 0.45], 'wood', '#5e4128', 'chair'),
  P('China Cabinet', 0, -2.7, -2.9, [0.5, 1.9, 1.2], 'wood', '#4f3a26', 'shelf'),
  P('Console', 0, -2.2, 1.75, [1.0, 0.8, 0.4], 'wood', '#5e4128', 'counter'),
  P('Counter', 0, 5.25, -6.6, [3.9, 0.92, 0.7], 'concrete', '#d6d0c4', 'counter'),
  P('Fridge', 0, 7.6, -6.5, [0.7, 1.9, 0.7], 'metal', '#e1e1dc', 'appliance'),
  P('Stove', 0, 2.95, -6.2, [0.7, 0.92, 0.7], 'metal', '#2a2a2a', 'appliance'),
  P('Kitchen Island', 0, 5.5, -3.5, [2.2, 0.95, 1.0], 'concrete', '#d6d0c4', 'counter'),
  P('Bench', 0, -2.6, 6.0, [0.45, 0.45, 1.2], 'wood', '#5e4128', 'bench'),
  P('Shelves', 0, 2.1, 6.4, [0.6, 1.8, 1.0], 'wood', '#6d5a40', 'shelf'),
  P('Pantry Shelves', 0, 3.3, 6.65, [1.4, 1.9, 0.5], 'wood', '#6d5a40', 'shelf'),
  P('Pantry Shelves', 0, 7.2, 6.65, [1.4, 1.9, 0.5], 'wood', '#6d5a40', 'shelf'),
  P('Freezer', 0, 7.5, 2.8, [0.8, 0.9, 1.2], 'metal', '#e1e1dc', 'appliance'),
  // ---------------- 2F
  P('Shower Stall', 1, -7.25, -6.25, [1.3, 2.1, 1.3], 'concrete', '#c9d6d8', 'shower'),
  P('Bathtub', 1, -4.2, -6.45, [1.6, 0.6, 0.8], 'concrete', '#e8e8e2', 'tub'),
  P('Vanity', 1, -7.65, -3.0, [0.6, 0.9, 1.2], 'wood', '#e0dccf', 'counter'),
  P('Toilet', 1, -3.4, -4.0, [0.5, 0.8, 0.65], 'concrete', '#f0f0ea', 'appliance'),
  P('Bed', 1, -2.0, -3.5, [2.0, 0.6, 1.6], 'fabric', '#7c7a8a', 'bed'),
  P('Nightstand', 1, -2.6, -2.35, [0.45, 0.55, 0.45], 'wood', '#5e4128', 'counter'),
  P('Dresser', 1, 2.12, -3.5, [0.45, 1.1, 1.4], 'wood', '#4f3a26', 'counter'),
  P('Armchair', 1, 1.8, -6.4, [0.8, 0.85, 0.8], 'fabric', '#6b5444', 'chair'),
  P('Clothes Rack', 1, -2.0, -6.7, [1.8, 1.7, 0.4], 'fabric', '#5b5f6a', 'rack'),
  P('Workbench', 1, 5.25, -6.5, [2.4, 0.9, 0.8], 'wood', '#6d5a40', 'counter'),
  P('Tool Cabinet', 1, 7.65, -2.6, [0.5, 1.8, 1.0], 'metal', '#8a2b2b', 'appliance'),
  P('Sawhorse', 1, 4.0, -4.0, [1.6, 0.8, 0.5], 'wood', '#9b7f57', 'table'),
  P('Boxes', 1, 7.3, -6.4, [0.8, 0.8, 0.8], 'wood', '#9b7f57', 'box'),
  P('Console', 1, 6.5, 1.75, [1.0, 0.8, 0.4], 'wood', '#5e4128', 'counter'),
  P('Bunk Bed', 1, -3.5, 5.75, [0.9, 1.6, 2.0], 'wood', '#3f6a8a', 'bunk'),
  P('Toy Chest', 1, -7.6, 2.55, [0.6, 0.5, 0.8], 'wood', '#b04a3a', 'box'),
  P('Kids Desk', 1, -5.5, 6.6, [1.2, 0.75, 0.6], 'wood', '#d0a060', 'desk'),
];
