import { barrel, box, cyl, type AssetSpec } from './spec.ts';

/**
 * Gadgets added for the few-shot operators (IQ, Montagne, Blitz, Kapkan,
 * Tachanka). Same spec format as everything else, so the CLI-Anything →
 * Blender pipeline can bake them too.
 */
export function extraGadgetSpec(key: string): AssetSpec | null {
  switch (key) {
    case 'scanner': // IQ — RED Mk III "Spectre" electronics detector (worn on the wrist, held up to read)
      return {
        id: 'iq_scanner', category: 'gadget',
        parts: [
          box([0, 0.03, -0.16], [0.13, 0.09, 0.025], '#22252a'),
          box([0, 0.035, -0.174], [0.105, 0.065, 0.004], '#3a9dff', { emissive: true }),
          box([0, -0.02, -0.12], [0.06, 0.04, 0.07], '#1b1d20'),
          cyl([0.05, 0.08, -0.16], 0.004, 0.05, '#111'),
        ],
      };
    case 'shield_ext': // Montagne — Le Roc extendable shield
    case 'shield':
      return {
        id: 'montagne_shield', category: 'gadget',
        parts: [
          ...shieldPlate(0.55, 0.95, 0.2, 0.32, 0.07, '#2b2f33', '#3c4248'),
          box([-0.12, -0.25, -0.44], [0.45, 0.04, 0.01], '#e8e2c4'), // POLICE band
          box([0.15, 0.0, -0.42], [0.03, 0.95, 0.04], '#1c1e20'),
          box([-0.12, -0.02, -0.39], [0.08, 0.14, 0.05], '#1d1f22'), // handle
        ],
      };
    case 'flash_shield': // Blitz — G52-Tactical flash shield
      return {
        id: 'blitz_shield', category: 'gadget',
        parts: [
          ...shieldPlate(0.5, 0.85, 0.22, 0.3, 0.06, '#2a2d30', '#3a3e42'),
          ...[-0.3, -0.12, 0.06].map((x) => box([x, -0.1, -0.44], [0.07, 0.07, 0.02], '#fff6d8', { emissive: true })),
          box([-0.12, -0.02, -0.39], [0.08, 0.14, 0.05], '#1d1f22'),
        ],
      };
    case 'edd': // Kapkan — Entry Denial Device (frame-mounted tripwire charge)
      return {
        id: 'kapkan_edd', category: 'gadget',
        parts: [
          box([0, 0.05, -0.12], [0.06, 0.12, 0.05], '#3b4031'),
          box([0, 0.09, -0.095], [0.02, 0.02, 0.01], '#ff2020', { emissive: true }),
          box([0, 0.0, -0.12], [0.07, 0.03, 0.06], '#24262a'),
        ],
      };
    case 'turret': // Tachanka — RP-46 deployable LMG
      return {
        id: 'tachanka_turret', category: 'gadget',
        parts: [
          cyl([0, 0.25, 0], 0.03, 0.5, '#2b2e33'),
          box([0, 0.02, 0], [0.5, 0.04, 0.5], '#2b2e33'), // tripod base
          box([0, 0.55, 0.05], [0.12, 0.12, 0.45], '#3a3d33'), // receiver
          barrel([0, 0.57, -0.38], 0.022, 0.55, '#1c1d1f'),
          cyl([0, 0.66, 0.0], 0.14, 0.04, '#4b4a3c'), // pan magazine
          box([0, 0.75, -0.35], [0.76, 0.56, 0.05], '#3f4636'), // shield plate
          box([0, 0.86, -0.355], [0.22, 0.06, 0.06], '#1c1d1f'), // gun slot
          box([0.06, 0.5, 0.32], [0.04, 0.12, 0.05], '#222'), // grips
          box([-0.06, 0.5, 0.32], [0.04, 0.12, 0.05], '#222'),
        ],
        anchors: { sight: [0, 0.66, 0.25], muzzle: [0, 0.57, -0.66], grip: [0.06, 0.5, 0.32] },
      };
  }
  return null;
}

/**
 * A ballistic shield plate (centre (-0.12, 0, -0.42), 3 cm thick) built around an open viewport slit
 * at height `wy` — you actually see through it, from behind (first person) and from the front.
 */
function shieldPlate(w: number, h: number, wy: number, ww: number, wh: number, c: string, rim: string) {
  const cx = -0.12, z = -0.42, t = 0.03;
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = -h / 2, y1 = h / 2;
  const sy0 = wy - wh / 2, sy1 = wy + wh / 2, sx0 = cx - ww / 2, sx1 = cx + ww / 2;
  const at = (a0: number, a1: number, b0: number, b1: number, col = c) => box([(a0 + a1) / 2, (b0 + b1) / 2, z], [a1 - a0, b1 - b0, t], col);
  return [
    at(x0, x1, y0, sy0), // below the slit
    at(x0, x1, sy1, y1), // above it
    at(x0, sx0, sy0, sy1), // either side
    at(sx1, x1, sy0, sy1),
    // a rim round the slit
    box([cx, sy1 + 0.008, z + 0.018], [ww + 0.02, 0.016, 0.012], rim),
    box([cx, sy0 - 0.008, z + 0.018], [ww + 0.02, 0.016, 0.012], rim),
  ];
}
