// Aiming magnifies by the optic, not by the weapon: the world view narrows to 2·atan(tan(fov / 2) / zoom) and the look
// sensitivity follows the same ratio (the same mouse travel moves the view by the same share of the screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPTIC_ZOOM, WEAPONS, adsFovOf } from '../../src/game/weapons.ts';

const D = Math.PI / 360;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.05, `${what}: ${a.toFixed(2)}, want ${b}`);

test('per-optic magnification from the default 75°: irons 75°, red dot / holo ×1.1 = 69.8°, ACOG ×2.5 = 34.1°', () => {
  near(adsFovOf(75, 'iron'), 75, 'irons');
  near(adsFovOf(75, 'reflex'), 69.8, 'red dot');
  near(adsFovOf(75, 'holo'), 69.8, 'holo');
  near(adsFovOf(75, 'acog'), 34.13, 'ACOG');
});

test('the zoom is the ratio of the view tangents at any player FOV, and the same optic zooms the same on every gun', () => {
  for (const fov of [60, 75, 90]) {
    for (const [optic, zoom] of Object.entries(OPTIC_ZOOM)) {
      const ads = adsFovOf(fov, optic as keyof typeof OPTIC_ZOOM);
      near(Math.tan(fov * D) / Math.tan(ads * D), zoom, `${optic} at ${fov}°`);
    }
  }
  for (const w of Object.values(WEAPONS)) assert.ok(w.style.optic in OPTIC_ZOOM, `${w.id}: optic ${w.style.optic}`);
});
