import type { AssetSpec } from '../assets/spec.ts';
import { gunSpec, type GunStyle, type Optic } from '../assets/weaponModels.ts';
import { dataDir } from '../data/index.ts';

export type FireMode = 'auto' | 'semi';
export interface WeaponDef {
  id: string;
  name: string;
  cls: 'AR' | 'SMG' | 'Shotgun' | 'Pistol' | 'DMR';
  damage: number;
  rpm: number;
  mode: FireMode;
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  /** metres where damage starts falling off / reaches min */
  falloff: [number, number];
  minDamage: number;
  /** degrees (1σ-ish) */
  hipSpread: number;
  adsSpread: number;
  recoil: { v: number; h: number; recover: number };
  pellets?: number;
  /** bullet penetration budget through soft surfaces */
  pen: number;
  /** wall cell damage per hit */
  wallDmg: number;
  suppressed?: boolean;
  style: GunStyle;
  /** model data: the hand-made GLB (under public/assets/models/), its anchors, an eye-relief override */
  model: WeaponModel;
}

type Vec3 = [number, number, number];
export interface WeaponModel {
  glb?: string;
  eyeRelief?: number;
  anchors: Record<'sight' | 'lens' | 'muzzle' | 'grip' | 'fore', Vec3>;
}

/** data/weapons/<id>.json */
interface WeaponData {
  id: string; name: string; class: WeaponDef['cls'];
  damage: { base: number; pellets?: number; falloffStart: number; falloffEnd: number; min: number };
  fire: { rpm: number; mode: FireMode; suppressed?: boolean };
  ammo: { mag: number; reserve: number; reload: number; reloadEmpty: number };
  spread: { hip: number; ads: number };
  recoil: { vertical: number; horizontal: number; recover: number };
  penetration: { budget: number; wallDamage: number };
  optic: Optic;
  model: WeaponModel & { procedural: Omit<GunStyle, 'optic'> };
}

/** data/optics/<id>.json */
export interface OpticDef {
  id: Optic;
  name: string;
  /** magnification (×): aiming narrows the world view to 2·atan(tan(fov / 2) / zoom) */
  zoom: number;
  /** the eye sits this far behind the `sight` anchor on the bore while aiming (m) */
  eyeRelief: number;
  /** vertical FOV of the first-person weapon camera while aiming (degrees) */
  viewmodelFov: number;
  /** the collimated reticle (at infinity along the bore): texture and its angular width (radians) */
  reticle: { texture: 'dot' | 'holo' | 'acog'; angle: number } | null;
  /** the see-through lens at the `lens` anchor: stencil shape / size (m) and tint */
  lens: { shape: 'circle' | 'rect'; size: [number, number]; tint: string; tintOpacity: number } | null;
}
export const OPTICS = dataDir<OpticDef>('optics') as Record<Optic, OpticDef>;

const fromData = (d: WeaponData): WeaponDef => {
  const { procedural, ...model } = d.model;
  return {
    id: d.id, name: d.name, cls: d.class,
    damage: d.damage.base, ...(d.damage.pellets ? { pellets: d.damage.pellets } : {}), falloff: [d.damage.falloffStart, d.damage.falloffEnd], minDamage: d.damage.min,
    rpm: d.fire.rpm, mode: d.fire.mode, ...(d.fire.suppressed ? { suppressed: true } : {}),
    mag: d.ammo.mag, reserve: d.ammo.reserve, reload: d.ammo.reload, reloadEmpty: d.ammo.reloadEmpty,
    hipSpread: d.spread.hip, adsSpread: d.spread.ads,
    recoil: { v: d.recoil.vertical, h: d.recoil.horizontal, recover: d.recoil.recover },
    pen: d.penetration.budget, wallDmg: d.penetration.wallDamage,
    style: { ...procedural, optic: d.optic },
    model,
  };
};
/** every weapon, from data/weapons/*.json */
export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries(Object.entries(dataDir<WeaponData>('weapons')).map(([id, d]) => [id, fromData(d)]));

/** optic magnification (×) per optic (data/optics/*.json) */
export const OPTIC_ZOOM = Object.fromEntries(Object.values(OPTICS).map((o) => [o.id, o.zoom])) as Record<Optic, number>;
/** the world camera's vertical FOV (degrees) when fully aimed through `optic`, from the player's FOV */
export function adsFovOf(fov: number, optic: Optic): number {
  const h = (fov * Math.PI) / 360;
  return (Math.atan(Math.tan(h) / OPTIC_ZOOM[optic]) * 360) / Math.PI;
}

const specCache = new Map<string, AssetSpec>();
export function weaponSpec(id: string): AssetSpec {
  let s = specCache.get(id);
  if (!s) {
    const def = WEAPONS[id];
    const style = def.style.layout === 'shotgun' ? { ...def.style, layout: 'ak' as const } : def.style;
    // the procedural parts are the fallback mesh; the anchors are the data's (measured on the model)
    s = { ...gunSpec(`weapon_${id}`, style), anchors: { ...def.model.anchors } };
    specCache.set(id, s);
  }
  return s;
}

export function damageAt(def: WeaponDef, dist: number): number {
  const [a, b] = def.falloff;
  if (dist <= a) return def.damage;
  if (dist >= b) return def.damage * def.minDamage;
  return def.damage * (1 - (1 - def.minDamage) * ((dist - a) / (b - a)));
}
