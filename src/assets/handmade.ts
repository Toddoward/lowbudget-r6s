import type { AssetSpec } from './spec.ts';

/**
 * Hand-modelled GLBs (public/assets/models/handmade/, manifest entries marked `handmade`): made in Blender by hand, so
 * the Blender pipeline never rebakes them. Their anchors are measured on the model and override the procedural spec's
 * (the procedural parts stay only as the fallback when the GLB can't load).
 *
 * Gun models carry `body` + `mag` + `body_glow` (the optic's lens caps). `body_glow` is drawn in third person only: the
 * view model draws these GLBs in first person without their `_glow` parts (the caps would close the sight line); the
 * collimated reticle and the tinted lens are drawn over them as for every optic.
 */
type Anchors = NonNullable<AssetSpec['anchors']>;

// L85A2 with ACOG: the sight axis runs at y 0.172 through the hollow scope, the objective lens cap at z −0.064
// (tube Ø 44 mm), the eyepiece end at z +0.066 (Ø 29 mm); the bore leaves the muzzle at z −0.569. Grip / fore stay the procedural ones until the hands are fitted to the hand-made models.
const L85A2: Anchors = { sight: [0, 0.172, 0.066], lens: [0, 0.172, -0.062], muzzle: [0, 0.078, -0.569] };

export const HANDMADE_ANCHORS: Record<string, Anchors> = {
  weapon_l85a2: L85A2,
};

export const isHandmade = (specId: string): boolean => specId in HANDMADE_ANCHORS;
