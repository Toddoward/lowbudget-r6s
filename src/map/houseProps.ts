import type { SurfaceMaterial } from '../core/Physics.ts';
import { dataFile } from '../data/index.ts';

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
  note?: string;
  group?: string;
}

/** data/maps/house/props.json (world metres; sizes [x, y, z] in metres) */
export const PROPS: PropDef[] = dataFile<{ props: PropDef[] }>('maps/house/props.json').props;

/** ammo crates = resupply points (interact) */
export const AMMO_CRATES = PROPS.filter((p) => p.style === 'ammo');
