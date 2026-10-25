import { box, cone, cyl, sph, type AssetSpec, type PartSpec } from './spec.ts';
import type { OperatorDef } from '../game/operators.ts';

/**
 * Low-poly operator rig: bones hips/torso/head/armL/armR/legL/legR, each in
 * its own pivot frame (see Rig.ts). Helmets, armour carriers and the unique
 * gadget silhouettes (hammer on the back, M120 launcher, thermite pack …)
 * are kept chunky so operators read at a distance.
 */
const SKIN = '#c49a7a';
const BOOT = '#1d1c1a';
const GLOVE = '#26241f';

function headgear(kind: string, accent: string): PartSpec[] {
  const H = 'head';
  const p: PartSpec[] = [box([0, 0.11, 0], [0.17, 0.2, 0.19], SKIN, { bone: H })];
  const dark = '#1e1f21';
  switch (kind) {
    case 'balaclava':
      p.push(box([0, 0.12, 0], [0.18, 0.21, 0.2], '#232421', { bone: H }), box([0, 0.15, -0.1], [0.15, 0.04, 0.03], '#3a3d33', { bone: H }), box([0, 0.15, -0.115], [0.12, 0.03, 0.01], '#7da0a8', { bone: H }));
      break;
    case 'cap':
      p.push(box([0, 0.22, 0.01], [0.19, 0.06, 0.2], accent, { bone: H }), box([0, 0.2, -0.12], [0.16, 0.015, 0.09], accent, { bone: H }), box([0, 0.15, -0.1], [0.14, 0.03, 0.02], dark, { bone: H }));
      break;
    case 'cap_headset':
      p.push(box([0, 0.22, 0.01], [0.19, 0.06, 0.2], '#283038', { bone: H }), box([0, 0.2, -0.12], [0.16, 0.015, 0.09], '#283038', { bone: H }), box([0.1, 0.12, 0], [0.04, 0.08, 0.08], dark, { bone: H }), box([-0.1, 0.12, 0], [0.04, 0.08, 0.08], dark, { bone: H }));
      break;
    case 'helmet_goggles':
      p.push(box([0, 0.21, 0.01], [0.22, 0.1, 0.24], accent, { bone: H }), box([0, 0.17, -0.12], [0.2, 0.04, 0.03], dark, { bone: H }), box([0, 0.26, -0.08], [0.16, 0.035, 0.05], '#4e6a70', { bone: H }), box([0, 0.06, -0.09], [0.15, 0.08, 0.04], dark, { bone: H }));
      break;
    case 'gasmask_beanie':
      p.push(box([0, 0.22, 0.01], [0.19, 0.08, 0.2], '#3b3a32', { bone: H }), box([0, 0.09, -0.1], [0.16, 0.14, 0.05], '#2a2b2a', { bone: H }), cyl([0.07, 0.05, -0.13], 0.035, 0.05, '#555', { bone: H, r: [90, 0, 0] }), box([0, 0.14, -0.13], [0.12, 0.04, 0.01], '#7b9aa3', { bone: H }));
      break;
    case 'gasmask_hood':
      p.push(box([0, 0.15, 0.02], [0.21, 0.26, 0.23], '#2a3038', { bone: H }), box([0, 0.09, -0.11], [0.16, 0.14, 0.05], '#1f2022', { bone: H }), cyl([0, 0.04, -0.15], 0.04, 0.06, '#5a5f66', { bone: H, r: [90, 0, 0] }), box([0, 0.15, -0.14], [0.13, 0.04, 0.01], '#a8c1c9', { bone: H }));
      break;
    case 'mask_comms':
      p.push(box([0, 0.21, 0.01], [0.21, 0.09, 0.23], '#22272d', { bone: H }), box([0, 0.08, -0.1], [0.16, 0.1, 0.04], '#15171a', { bone: H }), box([0.11, 0.13, 0], [0.04, 0.09, 0.09], dark, { bone: H }), cyl([0.11, 0.25, 0.02], 0.004, 0.12, '#111', { bone: H }));
      break;
    case 'castle_helmet':
      p.push(box([0, 0.2, 0.01], [0.23, 0.12, 0.25], '#1d2228', { bone: H }), box([0, 0.1, -0.12], [0.2, 0.14, 0.03], '#2c333c', { bone: H }), box([0, 0.15, -0.135], [0.15, 0.03, 0.01], '#0e0f10', { bone: H }));
      break;
    case 'helmet_headset':
      p.push(box([0, 0.21, 0.01], [0.22, 0.1, 0.24], '#3a3f37', { bone: H }), box([0.115, 0.12, 0], [0.05, 0.09, 0.09], dark, { bone: H }), box([-0.115, 0.12, 0], [0.05, 0.09, 0.09], dark, { bone: H }), box([0, 0.27, -0.06], [0.16, 0.035, 0.06], '#5a6a50', { bone: H }));
      break;
    case 'beanie_goggles':
      p.push(box([0, 0.22, 0.01], [0.19, 0.08, 0.2], '#2a2622', { bone: H }), box([0, 0.08, -0.08], [0.18, 0.12, 0.06], '#222', { bone: H }), box([0, 0.15, -0.105], [0.17, 0.045, 0.02], '#d9792a', { bone: H }));
      break;
    case 'altyn':
      p.push(box([0, 0.2, 0.01], [0.25, 0.16, 0.27], '#4b5340', { bone: H }), box([0, 0.12, -0.14], [0.22, 0.14, 0.03], '#3a4232', { bone: H }), box([0, 0.12, -0.155], [0.08, 0.04, 0.01], '#0d0d0d', { bone: H }), box([0, 0.12, -0.145], [0.24, 0.02, 0.02], '#2b3024', { bone: H }));
      break;
    case 'whitemask':
      p.push(box([0, 0.13, -0.02], [0.18, 0.21, 0.19], '#e9e6df', { bone: H }), box([0.04, 0.15, -0.115], [0.04, 0.025, 0.01], '#0d0d0d', { bone: H }), box([-0.04, 0.15, -0.115], [0.04, 0.025, 0.01], '#0d0d0d', { bone: H }), box([0, 0.23, 0.02], [0.19, 0.06, 0.2], '#3a352c', { bone: H }));
      break;
    case 'civilian':
      p.push(box([0, 0.22, 0.02], [0.18, 0.05, 0.2], '#3b2a1d', { bone: H }));
      break;
  }
  return p;
}

function gadgetSilhouette(gadget: string): PartSpec[] {
  const T = 'torso';
  switch (gadget) {
    case 'hammer':
      return [cyl([0.05, 0.25, 0.17], 0.018, 0.85, '#3b3226', { bone: T, r: [0, 0, 35] }), box([0.27, 0.58, 0.17], [0.22, 0.09, 0.09], '#4b4f55', { bone: T, r: [0, 0, 35] })];
    case 'ash_round':
      return [cyl([-0.08, 0.3, 0.18], 0.04, 0.5, '#3d3f36', { bone: T, r: [0, 0, -25] }), box([-0.08, 0.3, 0.15], [0.08, 0.12, 0.05], '#2a2c30', { bone: T })];
    case 'thermite':
      return [box([0, 0.3, 0.19], [0.32, 0.38, 0.1], '#7a6a48', { bone: T }), box([0, 0.3, 0.25], [0.22, 0.25, 0.02], '#ff5a1f', { bone: T, emissive: true })];
    case 'emp':
      return [cyl([0.08, 0.28, -0.15], 0.03, 0.1, '#2c5c8a', { bone: T }), cyl([0.0, 0.28, -0.15], 0.03, 0.1, '#2c5c8a', { bone: T }), cyl([-0.08, 0.28, -0.15], 0.03, 0.1, '#2c5c8a', { bone: T })];
    case 'cluster':
      return [box([0, 0.3, 0.2], [0.34, 0.4, 0.14], '#4a4f3a', { bone: T }), cyl([0, 0.3, 0.28], 0.1, 0.03, '#2a2c22', { bone: T, r: [90, 0, 0] })];
    case 'gas':
      return [cyl([0.13, -0.02, -0.1], 0.035, 0.11, '#6a6f2a', { bone: T }), cyl([-0.13, -0.02, -0.1], 0.035, 0.11, '#6a6f2a', { bone: T })];
    case 'jammer':
      return [box([0.08, 0.3, -0.15], [0.09, 0.07, 0.05], '#1b1d20', { bone: T }), cyl([0.11, 0.4, -0.15], 0.004, 0.12, '#111', { bone: T })];
    case 'castle':
      return [box([0, 0.3, 0.2], [0.36, 0.5, 0.06], '#3d4a3c', { bone: T }), box([0, 0.3, 0.24], [0.3, 0.44, 0.02], '#2c362b', { bone: T })];
    case 'heartbeat':
      return [box([-0.09, 0.3, -0.15], [0.08, 0.12, 0.03], '#2b2e33', { bone: T }), box([-0.09, 0.31, -0.165], [0.06, 0.08, 0.004], '#3aff9a', { bone: T, emissive: true })];
    case 'ads':
      return [cyl([0.14, -0.03, 0], 0.045, 0.06, '#3c4136', { bone: T }), sph([0.14, 0.01, 0], 0.035, '#2a2d27', { bone: T })];
    case 'battery':
      return [box([0.08, 0.27, -0.15], [0.08, 0.11, 0.05], '#d9792a', { bone: T }), box([-0.08, 0.27, -0.15], [0.08, 0.11, 0.05], '#d9792a', { bone: T })];
  }
  return [];
}

export function operatorSpec(def: OperatorDef): AssetSpec {
  const cloth = def.cloth;
  const vest = def.team === 'attack' ? '#3e4131' : def.team === 'defend' ? '#1f252c' : def.team === 'hostage' ? '#5d7a95' : '#4a4234';
  const P: PartSpec[] = [
    // hips frame (pivot at pelvis)
    box([0, 0, 0], [0.3, 0.16, 0.18], cloth, { bone: 'hips' }),
    box([0, 0.05, 0], [0.31, 0.04, 0.19], '#1c1c1c', { bone: 'hips' }),
    // torso (pivot at pelvis, extends to neck ~0.5)
    box([0, 0.27, 0], [0.34, 0.42, 0.2], cloth, { bone: 'torso' }),
    box([0, 0.3, -0.02], [0.36, 0.34, 0.23], vest, { bone: 'torso' }),
    box([0, 0.24, -0.13], [0.26, 0.12, 0.04], def.accent, { bone: 'torso' }), // pouches
    box([0.1, 0.36, -0.14], [0.06, 0.08, 0.03], def.accent, { bone: 'torso' }),
    box([-0.1, 0.36, -0.14], [0.06, 0.08, 0.03], def.accent, { bone: 'torso' }),
    box([0, 0.47, 0], [0.12, 0.06, 0.12], SKIN, { bone: 'torso' }), // neck
    box([0.17, 0.45, 0], [0.09, 0.06, 0.18], vest, { bone: 'torso' }), // shoulder pads
    box([-0.17, 0.45, 0], [0.09, 0.06, 0.18], vest, { bone: 'torso' }),
    // arms (pivot at shoulder) – hang down & forward
    box([0, -0.15, 0], [0.09, 0.3, 0.1], cloth, { bone: 'armR' }),
    box([0, -0.38, -0.06], [0.08, 0.22, 0.08], cloth, { bone: 'armR', r: [30, 0, 0] }),
    box([0, -0.5, -0.14], [0.08, 0.08, 0.08], GLOVE, { bone: 'armR' }),
    box([0, -0.15, 0], [0.09, 0.3, 0.1], cloth, { bone: 'armL' }),
    box([0, -0.38, -0.06], [0.08, 0.22, 0.08], cloth, { bone: 'armL', r: [30, 0, 0] }),
    box([0, -0.5, -0.14], [0.08, 0.08, 0.08], GLOVE, { bone: 'armL' }),
    // legs (pivot at hip joint)
    box([0, -0.22, 0], [0.13, 0.44, 0.15], cloth, { bone: 'legR' }),
    box([0, -0.27, -0.08], [0.1, 0.1, 0.04], '#24241f', { bone: 'legR' }), // knee pad
    box([0, -0.68, 0], [0.12, 0.42, 0.13], cloth, { bone: 'legR' }),
    box([0, -0.9, -0.04], [0.13, 0.09, 0.24], BOOT, { bone: 'legR' }),
    box([0, -0.22, 0], [0.13, 0.44, 0.15], cloth, { bone: 'legL' }),
    box([0, -0.27, -0.08], [0.1, 0.1, 0.04], '#24241f', { bone: 'legL' }),
    box([0, -0.68, 0], [0.12, 0.42, 0.13], cloth, { bone: 'legL' }),
    box([0, -0.9, -0.04], [0.13, 0.09, 0.24], BOOT, { bone: 'legL' }),
    ...headgear(def.headgear, def.accent),
    ...gadgetSilhouette(def.gadget),
  ];
  if (def.team === 'hostage') {
    // civilian: no vest, cuffed hands
    P.splice(3, 3);
  }
  if (def.team !== 'hostage' && def.team !== 'terrorist') P.push(cone([0, 0.62, 0.05], 0.02, 0.04, '#111', { bone: 'torso' }));
  return { id: `operator_${def.id}`, category: 'operator', parts: P };
}
