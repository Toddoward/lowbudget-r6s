import type { AssetSpec } from '../assets/spec.ts';
import { gunSpec, type GunStyle } from '../assets/weaponModels.ts';
import { HANDMADE_ANCHORS } from '../assets/handmade.ts';

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
  adsFov: number;
  style: GunStyle;
}

const W = (d: Omit<WeaponDef, 'pen' | 'wallDmg'> & Partial<Pick<WeaponDef, 'pen' | 'wallDmg'>>): WeaponDef => ({ pen: 2, wallDmg: 1, ...d });

export const WEAPONS: Record<string, WeaponDef> = {
  l85a2: W({ id: 'l85a2', name: 'L85A2', cls: 'AR', damage: 47, rpm: 670, mode: 'auto', mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.1, falloff: [25, 45], minDamage: 0.6, hipSpread: 2.3, adsSpread: 0.25, recoil: { v: 0.55, h: 0.22, recover: 7 }, adsFov: 40, style: { layout: 'bullpup', body: '#2c2f2a', accent: '#3a3d36', length: 0.75, optic: 'acog' } }),
  r4c: W({ id: 'r4c', name: 'R4-C', cls: 'AR', damage: 39, rpm: 860, mode: 'auto', mag: 30, reserve: 150, reload: 2.2, reloadEmpty: 2.9, falloff: [25, 40], minDamage: 0.6, hipSpread: 2.4, adsSpread: 0.28, recoil: { v: 0.62, h: 0.3, recover: 7 }, adsFov: 50, style: { layout: 'ar', body: '#2a2b2e', accent: '#33353a', length: 0.8, optic: 'holo' } }),
  '556xi': W({ id: '556xi', name: '556xi', cls: 'AR', damage: 47, rpm: 690, mode: 'auto', mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.0, falloff: [25, 42], minDamage: 0.6, hipSpread: 2.3, adsSpread: 0.26, recoil: { v: 0.6, h: 0.26, recover: 7 }, adsFov: 48, style: { layout: 'ar', body: '#7d6f52', accent: '#2e2f31', length: 0.82, optic: 'holo' } }),
  ar33: W({ id: 'ar33', name: 'AR33', cls: 'AR', damage: 41, rpm: 749, mode: 'auto', mag: 25, reserve: 150, reload: 2.3, reloadEmpty: 2.9, falloff: [25, 42], minDamage: 0.6, hipSpread: 2.3, adsSpread: 0.26, recoil: { v: 0.5, h: 0.22, recover: 7.5 }, adsFov: 48, style: { layout: 'ar', body: '#2b2c2f', accent: '#232427', length: 0.72, optic: 'reflex' } }),
  ak12: W({ id: 'ak12', name: 'AK-12', cls: 'AR', damage: 45, rpm: 850, mode: 'auto', mag: 30, reserve: 150, reload: 2.5, reloadEmpty: 3.2, falloff: [25, 42], minDamage: 0.6, hipSpread: 2.5, adsSpread: 0.3, recoil: { v: 0.7, h: 0.32, recover: 6.5 }, adsFov: 48, style: { layout: 'ak', body: '#26272a', accent: '#2d2e31', length: 0.85, optic: 'holo', curvedMag: true } }),
  fmg9: W({ id: 'fmg9', name: 'FMG-9', cls: 'SMG', damage: 34, rpm: 800, mode: 'auto', mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.6, falloff: [12, 25], minDamage: 0.55, hipSpread: 1.8, adsSpread: 0.45, recoil: { v: 0.45, h: 0.28, recover: 8 }, pen: 1, wallDmg: 0.8, adsFov: 55, style: { layout: 'smg', body: '#222326', accent: '#2c2d30', length: 0.42, optic: 'reflex', foldStock: true } }),
  mp5k: W({ id: 'mp5k', name: 'MP5K', cls: 'SMG', damage: 30, rpm: 800, mode: 'auto', mag: 30, reserve: 180, reload: 2.1, reloadEmpty: 2.7, falloff: [12, 25], minDamage: 0.55, hipSpread: 1.7, adsSpread: 0.42, recoil: { v: 0.38, h: 0.24, recover: 8.5 }, pen: 1, wallDmg: 0.8, adsFov: 55, style: { layout: 'smg', body: '#1f2022', accent: '#28292c', length: 0.4, optic: 'reflex', foldStock: true } }),
  ump45: W({ id: 'ump45', name: 'UMP45', cls: 'SMG', damage: 38, rpm: 600, mode: 'auto', mag: 25, reserve: 175, reload: 2.2, reloadEmpty: 2.8, falloff: [12, 25], minDamage: 0.55, hipSpread: 1.8, adsSpread: 0.42, recoil: { v: 0.42, h: 0.22, recover: 8 }, pen: 1, wallDmg: 0.85, adsFov: 55, style: { layout: 'smg', body: '#262729', accent: '#2f3033', length: 0.5, optic: 'holo' } }),
  '416c': W({ id: '416c', name: '416-C Carbine', cls: 'AR', damage: 43, rpm: 740, mode: 'auto', mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.9, falloff: [22, 40], minDamage: 0.6, hipSpread: 2.2, adsSpread: 0.28, recoil: { v: 0.52, h: 0.25, recover: 7.5 }, adsFov: 50, style: { layout: 'ar', body: '#2a2b2d', accent: '#35373b', length: 0.68, optic: 'holo' } }),
  mp7: W({ id: 'mp7', name: 'MP7', cls: 'SMG', damage: 32, rpm: 1000, mode: 'auto', mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.6, falloff: [12, 25], minDamage: 0.55, hipSpread: 1.7, adsSpread: 0.45, recoil: { v: 0.4, h: 0.3, recover: 8.5 }, pen: 1, wallDmg: 0.75, adsFov: 55, style: { layout: 'smg', body: '#1e1f21', accent: '#272829', length: 0.38, optic: 'reflex', foldStock: true, suppressor: true } }),
  p226: W({ id: 'p226', name: 'P226 Mk25', cls: 'Pistol', damage: 50, rpm: 420, mode: 'semi', mag: 15, reserve: 60, reload: 1.8, reloadEmpty: 2.2, falloff: [12, 25], minDamage: 0.5, hipSpread: 1.4, adsSpread: 0.5, recoil: { v: 0.9, h: 0.25, recover: 9 }, pen: 1, wallDmg: 0.8, adsFov: 62, style: { layout: 'pistol', body: '#1f2023', accent: '#26272a', length: 0.2, optic: 'iron' } }),
  p12: W({ id: 'p12', name: 'P12', cls: 'Pistol', damage: 44, rpm: 450, mode: 'semi', mag: 16, reserve: 64, reload: 1.8, reloadEmpty: 2.2, falloff: [12, 25], minDamage: 0.5, hipSpread: 1.4, adsSpread: 0.5, recoil: { v: 0.85, h: 0.22, recover: 9 }, pen: 1, wallDmg: 0.8, adsFov: 62, style: { layout: 'pistol', body: '#222326', accent: '#2a2b2e', length: 0.2, optic: 'iron', suppressor: true } }),
  pmm: W({ id: 'pmm', name: 'PMM', cls: 'Pistol', damage: 61, rpm: 380, mode: 'semi', mag: 8, reserve: 48, reload: 1.7, reloadEmpty: 2.1, falloff: [12, 25], minDamage: 0.5, hipSpread: 1.5, adsSpread: 0.55, recoil: { v: 1.1, h: 0.3, recover: 9 }, pen: 1, wallDmg: 0.8, adsFov: 62, style: { layout: 'pistol', body: '#2a2b2e', accent: '#3a3022', length: 0.18, optic: 'iron' } }),
  usg57: W({ id: 'usg57', name: '5.7 USG', cls: 'Pistol', damage: 42, rpm: 460, mode: 'semi', mag: 20, reserve: 80, reload: 1.8, reloadEmpty: 2.2, falloff: [12, 25], minDamage: 0.5, hipSpread: 1.4, adsSpread: 0.5, recoil: { v: 0.75, h: 0.2, recover: 9 }, pen: 1, wallDmg: 0.8, adsFov: 62, style: { layout: 'pistol', body: '#1c1d20', accent: '#2a2b2e', length: 0.2, optic: 'iron' } }),
  aug_a2: W({ id: 'aug_a2', name: 'AUG A2', cls: 'AR', damage: 42, rpm: 720, mode: 'auto', mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 3.0, falloff: [25, 42], minDamage: 0.6, hipSpread: 2.2, adsSpread: 0.24, recoil: { v: 0.5, h: 0.2, recover: 7.5 }, adsFov: 50, style: { layout: 'bullpup', body: '#3b4134', accent: '#2a2d26', length: 0.72, optic: 'holo' } }),
  vsn9: W({ id: 'vsn9', name: '9x19VSN', cls: 'SMG', damage: 34, rpm: 750, mode: 'auto', mag: 30, reserve: 180, reload: 2.1, reloadEmpty: 2.7, falloff: [12, 25], minDamage: 0.55, hipSpread: 1.8, adsSpread: 0.44, recoil: { v: 0.42, h: 0.26, recover: 8 }, pen: 1, wallDmg: 0.8, adsFov: 55, style: { layout: 'smg', body: '#24262a', accent: '#3a2f25', length: 0.48, optic: 'reflex' } }),
  p9: W({ id: 'p9', name: 'P9', cls: 'Pistol', damage: 45, rpm: 440, mode: 'semi', mag: 16, reserve: 64, reload: 1.8, reloadEmpty: 2.2, falloff: [12, 25], minDamage: 0.5, hipSpread: 1.3, adsSpread: 0.5, recoil: { v: 0.8, h: 0.22, recover: 9 }, pen: 1, wallDmg: 0.8, adsFov: 62, style: { layout: 'pistol', body: '#1d1e21', accent: '#25262a', length: 0.2, optic: 'iron' } }),
  lfp586: W({ id: 'lfp586', name: 'LFP586', cls: 'Pistol', damage: 78, rpm: 240, mode: 'semi', mag: 6, reserve: 36, reload: 2.6, reloadEmpty: 2.6, falloff: [15, 28], minDamage: 0.55, hipSpread: 1.4, adsSpread: 0.4, recoil: { v: 1.8, h: 0.35, recover: 7 }, pen: 1, wallDmg: 1, adsFov: 62, style: { layout: 'pistol', body: '#2a2b2e', accent: '#3a3022', length: 0.24, optic: 'iron' } }),
  rp46: W({ id: 'rp46', name: 'RP-46 (mounted)', cls: 'AR', damage: 60, rpm: 600, mode: 'auto', mag: 100, reserve: 0, reload: 4, reloadEmpty: 4, falloff: [30, 50], minDamage: 0.7, hipSpread: 0.9, adsSpread: 0.35, recoil: { v: 0.28, h: 0.12, recover: 9 }, pen: 3, wallDmg: 1.2, adsFov: 45, style: { layout: 'ak', body: '#2b2e33', accent: '#3a3d33', length: 1.0, optic: 'iron' } }),
  ak47t: W({ id: 'ak47t', name: 'AK-47 (White Masks)', cls: 'AR', damage: 41, rpm: 600, mode: 'auto', mag: 30, reserve: 600, reload: 2.6, reloadEmpty: 3.2, falloff: [25, 40], minDamage: 0.6, hipSpread: 2.6, adsSpread: 0.4, recoil: { v: 0.7, h: 0.35, recover: 6 }, adsFov: 55, style: { layout: 'ak', body: '#2a2a2a', accent: '#6b4a2b', length: 0.85, optic: 'iron', curvedMag: true } }),
  spas12t: W({ id: 'spas12t', name: 'SPAS-12 (White Masks)', cls: 'Shotgun', damage: 22, rpm: 70, mode: 'semi', mag: 7, reserve: 600, reload: 3.5, reloadEmpty: 4, falloff: [5, 15], minDamage: 0.3, hipSpread: 4.5, adsSpread: 3.2, recoil: { v: 2.4, h: 0.6, recover: 5 }, pellets: 8, pen: 1, wallDmg: 0.6, adsFov: 60, style: { layout: 'shotgun', body: '#232323', accent: '#2f2f2f', length: 0.85, optic: 'iron' } }),
};
// the same L85A2 with the hand-made model whose lens caps (body_glow) are empty — Thatcher carries it so both models can be compared
WEAPONS.l85a2_noglow = { ...WEAPONS.l85a2, id: 'l85a2_noglow' };

const specCache = new Map<string, AssetSpec>();
export function weaponSpec(id: string): AssetSpec {
  let s = specCache.get(id);
  if (!s) {
    const def = WEAPONS[id];
    const style = def.style.layout === 'shotgun' ? { ...def.style, layout: 'ak' as const } : def.style;
    s = gunSpec(`weapon_${id}`, style);
    const hand = HANDMADE_ANCHORS[s.id];
    if (hand) s = { ...s, anchors: { ...s.anchors, ...hand } };
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
