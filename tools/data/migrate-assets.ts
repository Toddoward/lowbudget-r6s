// One-off: writes data/weapons, data/operators from the current TypeScript tables (values unchanged).
import { mkdirSync, writeFileSync } from 'node:fs';
import { WEAPONS, weaponSpec } from '../../src/game/weapons.ts';
import { OPERATORS } from '../../src/game/operators.ts';
import { formatJson } from '../../src/data/format.ts';
import manifest from '../../public/assets/models/manifest.json' with { type: 'json' };

const out = (dir: string, id: string, v: unknown) => { mkdirSync(`data/${dir}`, { recursive: true }); writeFileSync(`data/${dir}/${id}.json`, formatJson(v)); };
const assets = (manifest as { assets: Record<string, { file: string; handmade?: boolean }> }).assets;

Object.values(WEAPONS).forEach((w, order) => {
  const spec = weaponSpec(w.id);
  const a = spec.anchors!;
  const st = w.style;
  out('weapons', w.id, {
    $schema: '../schema/weapon.schema.json',
    id: w.id, name: w.name, class: w.cls, order,
    damage: { base: w.damage, pellets: w.pellets, falloffStart: w.falloff[0], falloffEnd: w.falloff[1], min: w.minDamage },
    fire: { rpm: w.rpm, mode: w.mode, suppressed: w.suppressed },
    ammo: { mag: w.mag, reserve: w.reserve, reload: w.reload, reloadEmpty: w.reloadEmpty },
    spread: { hip: w.hipSpread, ads: w.adsSpread },
    recoil: { vertical: w.recoil.v, horizontal: w.recoil.h, recover: w.recoil.recover },
    penetration: { budget: w.pen, wallDamage: w.wallDmg },
    optic: st.optic,
    model: {
      glb: assets[spec.id]?.handmade ? assets[spec.id].file : undefined,
      eyeRelief: w.cls === 'Pistol' ? 0.2 : undefined,
      anchors: { sight: a.sight, lens: a.lens, muzzle: a.muzzle, grip: a.grip, fore: a.fore },
      procedural: { layout: st.layout, body: st.body, accent: st.accent, length: st.length, suppressor: st.suppressor, curvedMag: st.curvedMag, foldStock: st.foldStock },
    },
  });
});

Object.values(OPERATORS).forEach((o, order) => {
  out('operators', o.id, {
    $schema: '../schema/operator.schema.json',
    id: o.id, name: o.name, order, team: o.team, unit: o.unit, roles: o.roles,
    armor: o.armor, speed: o.speed,
    loadout: { primary: o.primary, secondary: o.secondary, gadget: o.gadget, gadgetName: o.gadgetName, gadgetCount: o.gadgetCount, universal: o.universal, universalCount: o.universalCount, shield: o.shield },
    description: { en: o.desc, ko: o.descKo },
    look: { headgear: o.headgear, cloth: o.cloth, accent: o.accent },
    model: {},
  });
});
console.log(`weapons ${Object.keys(WEAPONS).length}, operators ${Object.keys(OPERATORS).length}`);
