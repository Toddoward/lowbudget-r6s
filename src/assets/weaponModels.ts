import { barrel, box, cyl, type AssetSpec, type PartSpec } from './spec.ts';

/**
 * Low-poly firearm silhouettes (≈ 20–40 parts each): receiver, rail, handguard,
 * barrel, muzzle device / suppressor, grip, magazine (bone 'mag' so the reload
 * animation can drop it), stock and the optic. Origin = pistol grip, barrel
 * points -Z. Anchors: muzzle, sight (the point ADS aligns to the eye axis).
 */
export type Optic = 'iron' | 'holo' | 'reflex' | 'acog';
export interface GunStyle {
  layout: 'ar' | 'bullpup' | 'smg' | 'pistol' | 'ak' | 'shotgun';
  body: string;
  accent: string;
  length: number;
  optic: Optic;
  suppressor?: boolean;
  curvedMag?: boolean;
  foldStock?: boolean;
}

const MET = '#24262a';

export function gunSpec(id: string, st: GunStyle): AssetSpec {
  const P: PartSpec[] = [];
  const L = st.length;
  const top = 0.115;
  let sightZ = -0.12;
  let muzzleZ = -L;
  if (st.layout === 'pistol') {
    P.push(box([0, 0.055, -0.07], [0.034, 0.045, 0.2], st.body)); // slide
    P.push(box([0, 0.02, -0.06], [0.03, 0.03, 0.17], st.accent)); // frame
    P.push(box([0, -0.045, 0.005], [0.03, 0.1, 0.045], st.accent, { r: [-12, 0, 0] })); // grip
    P.push(box([0, -0.05, 0.005], [0.026, 0.11, 0.035], MET, { bone: 'mag', r: [-12, 0, 0] }));
    P.push(box([0, 0.0, -0.035], [0.006, 0.02, 0.04], MET)); // trigger guard
    P.push(box([0, 0.083, -0.15], [0.006, 0.012, 0.008], MET)); // front post
    P.push(box([0, 0.083, 0.02], [0.022, 0.012, 0.008], MET)); // rear notch
    P.push(barrel([0, 0.055, -0.18], 0.007, 0.02, MET));
    if (st.suppressor) P.push(barrel([0, 0.055, -0.25], 0.017, 0.13, '#1b1c1f'));
    return { id, category: 'weapon', parts: P, anchors: { muzzle: [0, 0.055, st.suppressor ? -0.32 : -0.19], sight: [0, 0.088, -0.05], grip: [0, -0.03, 0] } };
  }
  const bull = st.layout === 'bullpup';
  const recLen = bull ? 0.5 : st.layout === 'smg' ? 0.26 : 0.34;
  const recZ = bull ? 0.05 : -0.1;
  P.push(box([0, 0.06, recZ], [0.058, 0.085, recLen], st.body)); // receiver
  P.push(box([0, 0.105, recZ - 0.02], [0.036, 0.018, recLen * 0.9], st.accent)); // upper / dust cover
  P.push(box([0, top, recZ - 0.03], [0.024, 0.012, recLen * 0.8], MET)); // picatinny
  for (let i = 0; i < 5; i++) P.push(box([0, top + 0.008, recZ - recLen * 0.35 + i * recLen * 0.16], [0.028, 0.006, 0.012], MET));
  P.push(box([0.031, 0.075, recZ - 0.02], [0.006, 0.02, 0.06], MET)); // ejection port
  P.push(box([-0.034, 0.07, recZ + 0.02], [0.012, 0.012, 0.03], MET)); // charging handle
  // handguard
  const hgLen = st.layout === 'smg' ? 0.14 : 0.27;
  const hgZ = recZ - recLen / 2 - hgLen / 2 + 0.01;
  if (st.layout === 'ak') {
    P.push(box([0, 0.05, hgZ], [0.056, 0.06, hgLen], st.accent));
    P.push(box([0, 0.092, hgZ + 0.03], [0.04, 0.025, hgLen * 0.7], st.accent));
  } else {
    P.push(box([0, 0.06, hgZ], [0.054, 0.066, hgLen], st.accent));
    P.push(box([0, 0.06, hgZ], [0.06, 0.012, hgLen * 0.9], MET)); // side rails
    P.push(box([0, 0.023, hgZ - 0.02], [0.02, 0.012, hgLen * 0.7], MET)); // bottom rail
    if (st.layout !== 'smg') P.push(box([0, -0.015, hgZ - 0.04], [0.026, 0.06, 0.03], MET)); // vertical grip
  }
  const barrelStart = hgZ - hgLen / 2;
  const bl = Math.max(0.05, L + barrelStart);
  P.push(barrel([0, 0.065, barrelStart - bl / 2 + 0.01], 0.011, bl, MET));
  P.push(box([0, 0.105, barrelStart + 0.02], [0.012, 0.03, 0.012], MET)); // gas block / front post
  muzzleZ = barrelStart - bl;
  if (st.suppressor) {
    P.push(barrel([0, 0.065, muzzleZ - 0.08], 0.022, 0.17, '#1b1c1f'));
    P.push(barrel([0, 0.065, muzzleZ - 0.17], 0.018, 0.012, MET));
    muzzleZ -= 0.17;
  } else {
    P.push(barrel([0, 0.065, muzzleZ - 0.025], 0.016, 0.05, MET));
    muzzleZ -= 0.05;
  }
  // grip + trigger
  P.push(box([0, -0.035, bull ? -0.12 : 0.0], [0.036, 0.1, 0.048], MET, { r: [-16, 0, 0] }));
  P.push(box([0, 0.0, bull ? -0.16 : -0.045], [0.006, 0.022, 0.05], MET));
  // magazine
  const magZ = bull ? 0.1 : st.layout === 'smg' ? -0.07 : -0.13;
  if (st.curvedMag) {
    P.push(box([0, -0.04, magZ], [0.034, 0.1, 0.065], '#3a2f25', { bone: 'mag', r: [8, 0, 0] }));
    P.push(box([0, -0.12, magZ - 0.03], [0.032, 0.08, 0.06], '#3a2f25', { bone: 'mag', r: [24, 0, 0] }));
  } else {
    const ml = st.layout === 'smg' ? 0.15 : 0.16;
    P.push(box([0, 0.0 - ml / 2 + 0.03, magZ], [0.03, ml, 0.062], st.layout === 'smg' ? MET : '#2f2f2f', { bone: 'mag', r: [6, 0, 0] }));
  }
  // stock
  if (!bull) {
    if (st.foldStock) {
      P.push(box([0.03, 0.05, 0.12], [0.012, 0.05, 0.2], MET));
    } else {
      P.push(box([0, 0.06, recZ + recLen / 2 + 0.1], [0.04, 0.05, 0.2], st.accent));
      P.push(box([0, 0.03, recZ + recLen / 2 + 0.21], [0.045, 0.11, 0.03], st.body)); // butt pad
      P.push(box([0, 0.088, recZ + recLen / 2 + 0.12], [0.03, 0.02, 0.14], st.body)); // cheek riser
    }
  } else {
    P.push(box([0, 0.035, 0.32], [0.05, 0.11, 0.035], st.body)); // bullpup butt
  }
  // optic
  const oy = top + 0.012;
  sightZ = recZ - 0.05;
  if (st.optic === 'acog') {
    P.push(box([0, oy + 0.012, sightZ], [0.03, 0.024, 0.07], MET));
    P.push(barrel([0, oy + 0.045, sightZ], 0.022, 0.13, '#202226'));
    P.push(barrel([0, oy + 0.045, sightZ - 0.075], 0.027, 0.025, '#202226'));
    P.push(box([0, oy + 0.075, sightZ], [0.016, 0.012, 0.02], '#35583d'));
    P.push(barrel([0, oy + 0.045, sightZ - 0.088], 0.018, 0.002, '#ff3a2a', { emissive: true }));
  } else if (st.optic === 'holo') {
    P.push(box([0, oy + 0.012, sightZ], [0.042, 0.024, 0.08], MET));
    P.push(box([0.021, oy + 0.045, sightZ - 0.02], [0.006, 0.05, 0.05], MET));
    P.push(box([-0.021, oy + 0.045, sightZ - 0.02], [0.006, 0.05, 0.05], MET));
    P.push(box([0, oy + 0.072, sightZ - 0.02], [0.048, 0.006, 0.05], MET));
    P.push(box([0, oy + 0.045, sightZ - 0.03], [0.004, 0.004, 0.002], '#ff4030', { emissive: true }));
  } else if (st.optic === 'reflex') {
    P.push(box([0, oy + 0.01, sightZ], [0.03, 0.02, 0.05], MET));
    P.push(box([0, oy + 0.035, sightZ - 0.012], [0.03, 0.03, 0.006], '#262626'));
    P.push(box([0, oy + 0.035, sightZ - 0.01], [0.003, 0.003, 0.002], '#ff3030', { emissive: true }));
  } else {
    P.push(box([0, oy + 0.02, sightZ + 0.08], [0.03, 0.03, 0.012], MET)); // rear aperture
  }
  const sightY = st.optic === 'acog' ? oy + 0.045 : st.optic === 'holo' ? oy + 0.045 : st.optic === 'reflex' ? oy + 0.035 : oy + 0.03;
  return { id, category: 'weapon', parts: P, anchors: { muzzle: [0, 0.065, muzzleZ], sight: [0, sightY, sightZ], grip: [0, -0.03, 0], fore: [0, 0.03, hgZ] } };
}

/* gadgets held in hands */
export function hammerSpec(): AssetSpec {
  return {
    id: 'sledge_hammer', category: 'gadget',
    parts: [
      cyl([0, 0.05, -0.3], 0.018, 0.95, '#3b3226', { r: [80, 0, 0] }),
      box([0, 0.12, -0.75], [0.09, 0.09, 0.26], '#4b4f55', { r: [80, 0, 0] }),
      box([0, 0.12, -0.75], [0.1, 0.1, 0.05], '#2a2c30', { r: [80, 0, 0] }),
      box([0, -0.03, 0.05], [0.04, 0.14, 0.04], '#202020'),
    ],
    anchors: { head: [0, 0.12, -0.75] },
  };
}

export function launcherSpec(): AssetSpec {
  return {
    id: 'ash_m120', category: 'gadget',
    parts: [
      barrel([0, 0.07, -0.25], 0.032, 0.42, '#3d3f36'),
      box([0, 0.03, -0.05], [0.07, 0.07, 0.2], '#2a2c30'),
      box([0, -0.04, 0], [0.035, 0.1, 0.045], '#202020', { r: [-15, 0, 0] }),
      box([0, 0.11, -0.12], [0.03, 0.03, 0.05], '#24262a'),
      barrel([0, 0.07, -0.48], 0.036, 0.04, '#24262a'),
      box([0, 0.04, 0.17], [0.03, 0.06, 0.18], '#2a2c30'),
    ],
    anchors: { muzzle: [0, 0.07, -0.5], sight: [0, 0.13, -0.12] },
  };
}

export function throwableSpec(id: string, color: string, tall = false): AssetSpec {
  return {
    id, category: 'gadget',
    parts: tall
      ? [cyl([0, 0.05, -0.1], 0.03, 0.13, color), cyl([0, 0.13, -0.1], 0.012, 0.03, '#222')]
      : [box([0, 0.04, -0.1], [0.07, 0.07, 0.07], color), cyl([0, 0.09, -0.1], 0.01, 0.04, '#222')],
  };
}

export function chargeSpec(id: string, color: string, w = 0.3, h = 0.4): AssetSpec {
  return {
    id, category: 'gadget',
    parts: [
      box([0, 0.05, -0.12], [w, h, 0.05], color),
      box([0, 0.05, -0.09], [w * 0.6, h * 0.2, 0.03], '#1e1e1e'),
      box([w * 0.3, 0.05 + h * 0.35, -0.09], [0.02, 0.02, 0.02], '#ff3030', { emissive: true }),
    ],
  };
}

export function deviceSpec(id: string, color: string, light = '#3aff7a'): AssetSpec {
  return {
    id, category: 'gadget',
    parts: [
      box([0, 0.05, -0.12], [0.11, 0.08, 0.14], color),
      cyl([0.03, 0.12, -0.12], 0.005, 0.1, '#222'),
      box([0, 0.095, -0.1], [0.03, 0.01, 0.03], light, { emissive: true }),
    ],
  };
}

export function pulseSensorSpec(): AssetSpec {
  return {
    id: 'pulse_sensor', category: 'gadget',
    parts: [
      box([0, 0.06, -0.14], [0.1, 0.16, 0.03], '#2b2e33'),
      box([0, 0.08, -0.155], [0.08, 0.1, 0.004], '#3aff9a', { emissive: true }),
      box([0, -0.03, -0.12], [0.035, 0.08, 0.035], '#202020'),
    ],
  };
}

export function droneSpec(): AssetSpec {
  return {
    id: 'drone', category: 'gadget',
    parts: [
      box([0, 0.09, 0], [0.16, 0.07, 0.12], '#2b2e33'),
      cyl([0.12, 0.09, 0], 0.085, 0.03, '#1d1f22', { r: [0, 0, 90], seg: 10 }),
      cyl([-0.12, 0.09, 0], 0.085, 0.03, '#1d1f22', { r: [0, 0, 90], seg: 10 }),
      box([0, 0.12, -0.06], [0.03, 0.02, 0.02], '#ff2a2a', { emissive: true }),
      cyl([0, 0.17, 0.04], 0.004, 0.1, '#111'),
    ],
  };
}
