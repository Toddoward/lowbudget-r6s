/**
 * House outdoor datamap — the pre-baked 512×512 RGBA top view of the original
 * House (1 px = 0.133333 m, 68.27 m square, registered 1:1 to the official top
 * view and the .glb), used as is: the constant, the police cruiser list and the
 * 20-line runtime decoder below are the supplied ones (TypeScript types added).
 *
 * Legend
 *  - u, v ∈ [0, 511] ⟷ world X = (u − 243.0) · 0.133333 (W → E), Z = (v − 292.8) · 0.133333 (N → S)
 *  - R → H_ground = R / 255 · 7 − 5 (−5 … +2 m): ground, roads, ramps, stairs, river surface
 *  - G → H_upper  = G / 255 · 10 (0 … 10 m; 0 = nothing above): height of roofs, lifts, treehouse,
 *    gazebo, vehicles … above their ground
 *  - B >> 4 → zone id (1 … 14), B & 0x0F → form id (props, vents, spawn pads)
 */

// [1] pre-baked 512×512 RGBA datamap + police cruisers (u, v, yaw → world X, Z)
export const HOUSE_DATAMAP_512_B64 =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdo" +
  "dD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc2hhcGVtcmVuZGVyaW5nPSJjcmlzcEVkZ2Vz" +
  "Ij4gPHJlY3QgeD0iMDAwIiAgeT0iMDAwIiB3aWR0aD0iNTEyIiAgIGhlaWdodD0iNTEyIiBmaWxs" +
  "PSJyZ2IoMTI3ICwgMDAwICwgMDMyKSIvPiAgPHJlY3QgeD0iNDMyIiAgeT0iMDAwIiB3aWR0aD0i" +
  "MDgwIiAgIGhlaWdodD0iNTEyIiBmaWxsPSJyZ2IoMDI5ICwgMDAwICwgMDQ4KSIvPiAgPHJlY3Qg" +
  "eD0iMzk2IiAgeT0iMDAwIiB3aWR0aD0iMDM2IiAgIGhlaWdodD0iMzE4IiBmaWxsPSJyZ2IoMDkx" +
  "ICwgMDAwICwgMDMyKSIvPiAgPHJlY3QgeD0iMzk4IiAgeT0iMzE4IiB3aWR0aD0iMDM0IiAgIGhl" +
  "aWdodD0iMTk0IiBmaWxsPSJyZ2IoMDczICwgMDAwICwgMDY0KSIvPiAgPHJlY3QgeD0iMTM1IiAg" +
  "eT0iMDAwIiB3aWR0aD0iMjEwIiAgIGhlaWdodD0iMTA2IiBmaWxsPSJyZ2IoMTM1ICwgMDAwICwg" +
  "MDE2KSIvPiAgPHJlY3QgeD0iMjEyIiAgeT0iMDA1IiB3aWR0aD0iMDc0IiAgIGhlaWdodD0iMDUz" +
  "IiBmaWxsPSJyZ2IoMTE3ICwgMDAwICwgMDE2KSIvPiAgPHJlY3QgeD0iMjQyIiAgeT0iMDUxIiB3" +
  "aWR0aD0iMDM0IiAgIGhlaWdodD0iMDM0IiBmaWxsPSJyZ2IoMTM4ICwgMDAwICwgMDMxKSIvPiAg" +
  "PHJlY3QgeD0iMzA0IiAgeT0iMDI0IiB3aWR0aD0iMDE4IiAgIGhlaWdodD0iMDQyIiBmaWxsPSJy" +
  "Z2IoMTM1ICwgMDcxICwgMDI4KSIvPiAgPHJlY3QgeD0iMDAwIiAgeT0iMzE4IiB3aWR0aD0iMDU4" +
  "IiAgIGhlaWdodD0iMTI0IiBmaWxsPSJyZ2IoMTI3ICwgMTQwICwgMjI0KSIvPiAgPHJlY3QgeD0i" +
  "MDU1IiAgeT0iMTY0IiB3aWR0aD0iMDgxIiAgIGhlaWdodD0iMTkxIiBmaWxsPSJyZ2IoMTY0ICwg" +
  "MDAwICwgMTI4KSIvPiAgPHJlY3QgeD0iMTM2IiAgeT0iMTc2IiB3aWR0aD0iMjAwIiAgIGhlaWdo" +
  "dD0iMDYwIiBmaWxsPSJyZ2IoMTgyICwgMDAwICwgMTEyKSIvPiAgPHJlY3QgeD0iMTQ0IiAgeT0i" +
  "MTY0IiB3aWR0aD0iMTg0IiAgIGhlaWdodD0iMDE0IiBmaWxsPSJyZ2IoMTU1ICwgMDAwICwgMTEy" +
  "KSIvPiAgPHJlY3QgeD0iMTM2IiAgeT0iMjM1IiB3aWR0aD0iMDM2IiAgIGhlaWdodD0iMTEwIiBm" +
  "aWxsPSJyZ2IoMTgyICwgMDAwICwgMTI4KSIvPiAgPHJlY3QgeD0iMTYyIiAgeT0iMjAyIiB3aWR0" +
  "aD0iMDIyIiAgIGhlaWdodD0iMDE2IiBmaWxsPSJyZ2IoMTE4ICwgMDAwICwgMTc2KSIvPiAgPHJl" +
  "Y3QgeD0iMTYyIiAgeT0iMjE4IiB3aWR0aD0iMDIyIiAgIGhlaWdodD0iMDI0IiBmaWxsPSJyZ2Io" +
  "MDU1ICwgMDAwICwgMTc2KSIvPiAgPHJlY3QgeD0iMzE3IiAgeT0iMjYyIiB3aWR0aD0iMDA4IiAg" +
  "IGhlaWdodD0iMDYwIiBmaWxsPSJyZ2IoMDU1ICwgMDAwICwgMTQ0KSIvPiAgPHJlY3QgeD0iMzI1" +
  "IiAgeT0iMjYyIiB3aWR0aD0iMDA4IiAgIGhlaWdodD0iMDYwIiBmaWxsPSJyZ2IoMDc5ICwgMDAw" +
  "ICwgMTQ0KSIvPiAgPHJlY3QgeD0iMzMzIiAgeT0iMjYyIiB3aWR0aD0iMDA4IiAgIGhlaWdodD0i" +
  "MDYwIiBmaWxsPSJyZ2IoMTAzICwgMDAwICwgMTQ0KSIvPiAgPHJlY3QgeD0iMzQxIiAgeT0iMjYy" +
  "IiB3aWR0aD0iMDA4IiAgIGhlaWdodD0iMDYwIiBmaWxsPSJyZ2IoMTIwICwgMDAwICwgMTQ0KSIv" +
  "PiAgPHJlY3QgeD0iMTM2IiAgeT0iMzQ0IiB3aWR0aD0iMjAwIiAgIGhlaWdodD0iMDM4IiBmaWxs" +
  "PSJyZ2IoMTY5ICwgMDAwICwgMTYwKSIvPiAgPHJlY3QgeD0iMTg1IiAgeT0iMzgyIiB3aWR0aD0i" +
  "MTQ1IiAgIGhlaWdodD0iMDQ2IiBmaWxsPSJyZ2IoMTU4ICwgMDAwICwgMTYwKSIvPiAgPHJlY3Qg" +
  "eD0iMTM2IiAgeT0iNDI4IiB3aWR0aD0iMjAwIiAgIGhlaWdodD0iMDI0IiBmaWxsPSJyZ2IoMTQy" +
  "ICwgMDAwICwgMTYwKSIvPiAgPHJlY3QgeD0iMTg3IiAgeT0iNDQ5IiB3aWR0aD0iMDM0IiAgIGhl" +
  "aWdodD0iMDM0IiBmaWxsPSJyZ2IoMTI3ICwgMDAwICwgMDk1KSIvPiAgPHJlY3QgeD0iMzI4IiAg" +
  "eT0iNDYzIiB3aWR0aD0iMDM0IiAgIGhlaWdodD0iMDM0IiBmaWxsPSJyZ2IoMTI3ICwgMDAwICwg" +
  "MTExKSIvPiAgPHJlY3QgeD0iMzk4IiAgeT0iMzI4IiB3aWR0aD0iMDM0IiAgIGhlaWdodD0iMDM0" +
  "IiBmaWxsPSJyZ2IoMDczICwgMDAwICwgMDc5KSIvPiAgPHJlY3QgeD0iMjIyIiAgeT0iMjI0IiB3" +
  "aWR0aD0iMDc2IiAgIGhlaWdodD0iMDExIiBmaWxsPSJyZ2IoMTgyICwgMDg5ICwgMjA4KSIvPiAg" +
  "PHJlY3QgeD0iMjI0IiAgeT0iMzM2IiB3aWR0aD0iMDU0IiAgIGhlaWdodD0iMDEwIiBmaWxsPSJy" +
  "Z2IoMTgyICwgMDg5ICwgMjA4KSIvPiAgPHJlY3QgeD0iMTg0IiAgeT0iMjM1IiB3aWR0aD0iMTMw" +
  "IiAgIGhlaWdodD0iMTAyIiBmaWxsPSJyZ2IoMTgyICwgMTc5ICwgMTkyKSIvPiAgPHJlY3QgeD0i" +
  "MTcyIiAgeT0iMjkyIiB3aWR0aD0iMDMyIiAgIGhlaWdodD0iMDMwIiBmaWxsPSJyZ2IoMTgyICwg" +
  "MTkxICwgMTkyKSIvPiAgPHJlY3QgeD0iMTcyIiAgeT0iMzAxIiB3aWR0aD0iMDMyIiAgIGhlaWdo" +
  "dD0iMDEyIiBmaWxsPSJyZ2IoMTgyICwgMjE3ICwgMTkyKSIvPiAgPHJlY3QgeD0iMTkyIiAgeT0i" +
  "MjQ0IiB3aWR0aD0iMDI2IiAgIGhlaWdodD0iMDQ2IiBmaWxsPSJyZ2IoMTgyICwgMjA0ICwgMTky" +
  "KSIvPiAgPHJlY3QgeD0iMTk5IiAgeT0iMjUwIiB3aWR0aD0iMDEyIiAgIGhlaWdodD0iMDM2IiBm" +
  "aWxsPSJyZ2IoMTgyICwgMjE5ICwgMTkyKSIvPiAgPHJlY3QgeD0iMjA0IiAgeT0iMjg0IiB3aWR0" +
  "aD0iMDk4IiAgIGhlaWdodD0iMDQ0IiBmaWxsPSJyZ2IoMTgyICwgMjA0ICwgMTkyKSIvPiAgPHJl" +
  "Y3QgeD0iMjEwIiAgeT0iMjk0IiB3aWR0aD0iMDg0IiAgIGhlaWdodD0iMDI2IiBmaWxsPSJyZ2Io" +
  "MTgyICwgMjE3ICwgMTkyKSIvPiAgPHJlY3QgeD0iMjE2IiAgeT0iMzAyIiB3aWR0aD0iMDcwIiAg" +
  "IGhlaWdodD0iMDEyIiBmaWxsPSJyZ2IoMTgyICwgMjMwICwgMTkyKSIvPiAgPHJlY3QgeD0iMTMw" +
  "IiAgeT0iMTUyIiB3aWR0aD0iMDE2IiAgIGhlaWdodD0iMDEyIiBmaWxsPSJyZ2IoMTI3ICwgMDc3" +
  "ICwgMDMzKSIvPiAgPHJlY3QgeD0iMTMxIiAgeT0iMzEyIiB3aWR0aD0iMDE4IiAgIGhlaWdodD0i" +
  "MDE0IiBmaWxsPSJyZ2IoMTgyICwgMTE1ICwgMTMwKSIvPiAgPHJlY3QgeD0iMzY3IiAgeT0iMzAx" +
  "IiB3aWR0aD0iMDE1IiAgIGhlaWdodD0iMDE0IiBmaWxsPSJyZ2IoMTI3ICwgMDc3ICwgMDM1KSIv" +
  "PiAgPHJlY3QgeD0iMTI2IiAgeT0iMjczIiB3aWR0aD0iMDI0IiAgIGhlaWdodD0iMDI0IiBmaWxs" +
  "PSJyZ2IoMTgyICwgMTA3ICwgMTMyKSIvPiAgPHJlY3QgeD0iMTUwIiAgeT0iMTg2IiB3aWR0aD0i" +
  "MDA4IiAgIGhlaWdodD0iMDA4IiBmaWxsPSJyZ2IoMTgyICwgMDgyICwgMTE3KSIvPiAgPHJlY3Qg" +
  "eD0iMzQxIiAgeT0iMzg1IiB3aWR0aD0iMDA4IiAgIGhlaWdodD0iMDA4IiBmaWxsPSJyZ2IoMTU4" +
  "ICwgMDgyICwgMTY2KSIvPiAgPHJlY3QgeD0iMjMwIiAgeT0iMzg0IiB3aWR0aD0iMDM4IiAgIGhl" +
  "aWdodD0iMDQwIiBmaWxsPSJyZ2IoMTU4ICwgMDc5ICwgMTY5KSIvPiAgPHJlY3QgeD0iMTM4IiAg" +
  "eT0iMzU0IiB3aWR0aD0iMDMwIiAgIGhlaWdodD0iMDMwIiBmaWxsPSJyZ2IoMTY5ICwgMDY2ICwg" +
  "MTcwKSIvPiAgPHJlY3QgeD0iMTgyIiAgeT0iNDQ4IiB3aWR0aD0iMDIwIiAgIGhlaWdodD0iMDI4" +
  "IiBmaWxsPSJyZ2IoMTI3ICwgMDYxICwgMDg4KSIvPiAgPHJlY3QgeD0iNDc2IiAgeT0iMDE2IiB3" +
  "aWR0aD0iMDI0IiAgIGhlaWdodD0iMDY0IiBmaWxsPSJyZ2IoMDI5ICwgMDU2ICwgMDU5KSIvPiAg" +
  "PHJlY3QgeD0iNDYwIiAgeT0iNDM2IiB3aWR0aD0iMDI0IiAgIGhlaWdodD0iMDY0IiBmaWxsPSJy" +
  "Z2IoMDI5ICwgMDU2ICwgMDU5KSIvPiAgPHJlY3QgeD0iMzE1IiAgeT0iMjcwIiB3aWR0aD0iMDA0" +
  "IiAgIGhlaWdodD0iMDA0IiBmaWxsPSJyZ2IoMDU1ICwgMDA2ICwgMjA2KSIvPiAgPHJlY3QgeD0i" +
  "MTgyIiAgeT0iMjMzIiB3aWR0aD0iMDA0IiAgIGhlaWdodD0iMDA0IiBmaWxsPSJyZ2IoMDU1ICwg" +
  "MDA2ICwgMjA2KSIvPiAgPHJlY3QgeD0iMjc2IiAgeT0iMjMzIiB3aWR0aD0iMDA0IiAgIGhlaWdo" +
  "dD0iMDA0IiBmaWxsPSJyZ2IoMTgyICwgMDg5ICwgMjA2KSIvPiAgPHJlY3QgeD0iMjAzIiAgeT0i" +
  "MzQyIiB3aWR0aD0iMDA0IiAgIGhlaWdodD0iMDA0IiBmaWxsPSJyZ2IoMTgyICwgMTc5ICwgMjA2" +
  "KSIvPiAgPHJlY3QgeD0iMjE2IiAgeT0iMjY2IiB3aWR0aD0iMDA0IiAgIGhlaWdodD0iMDA0IiBm" +
  "aWxsPSJyZ2IoMTgyICwgMTc5ICwgMjA2KSIvPiAgPHJlY3QgeD0iMjI2IiAgeT0iMzAzIiB3aWR0" +
  "aD0iMDA0IiAgIGhlaWdodD0iMDA0IiBmaWxsPSJyZ2IoMTgyICwgMjMwICwgMjA2KSIvPiAgPC9z" +
  "dmc+";

// 탑뷰 회전 각도(yaw)가 포함된 경찰차 11대 정밀 배치 좌표 (u, v -> 월드 X, Z 자동 변환용)
export const HOUSE_POLICE_CRUISERS = [
  { u: 100, v: 123, yawDeg: -18, y: -1.5 }, { u: 90,  v: 145, yawDeg: +42, y: -1.5 },
  { u: 135, v: 121, yawDeg: +30, y: -1.5 }, { u: 209, v: 129, yawDeg: +22, y: -1.5 },
  { u: 264, v: 132, yawDeg: -35, y: -1.5 }, { u: 42,  v: 232, yawDeg: +35, y: -1.5 },
  { u: 89,  v: 319, yawDeg: +35, y: -1.2 }, { u: 342, v: 251, yawDeg: -32, y: -1.6 },
  { u: 332, v: 294, yawDeg: +45, y: -2.1 }, { u: 374, v: 376, yawDeg: +32, y: -1.5 },
  { u: 359, v: 434, yawDeg: +28, y: -1.5 }
];

/** what a datamap pixel says about that spot of the world */
export interface DatamapSample { x: number; z: number; hGround: number; hUpper: number; zoneId: number; formId: number }
export interface HouseDatamap { sample(u: number, v: number): DatamapSample }

export const DATAMAP_PX = 0.133333;
export const DATAMAP_U0 = 243.0;
export const DATAMAP_V0 = 292.8;
export const uToX = (u: number) => (u - DATAMAP_U0) * DATAMAP_PX;
export const vToZ = (v: number) => (v - DATAMAP_V0) * DATAMAP_PX;
export const xToU = (x: number) => x / DATAMAP_PX + DATAMAP_U0;
export const zToV = (z: number) => z / DATAMAP_PX + DATAMAP_V0;

/** B >> 4 */
export const DATAMAP_ZONES: Record<number, string> = {
  1: 'Construction Site', 2: 'Asphalt Road', 3: 'River Water', 4: 'River Docks', 5: 'APC Area', 6: 'Side Street', 7: 'Front Yard',
  8: 'Treehouse Alley', 9: 'Garage Entrance Ramp', 10: 'Back Alley Patio', 11: 'NW Basement Stairs', 12: 'House Main Footprint', 13: 'Porch Roof', 14: 'Neighbor House SW',
};
export const ZONE = { construction: 1, road: 2, water: 3, docks: 4, apc: 5, sideStreet: 6, frontYard: 7, treehouseAlley: 8, garageRamp: 9, backPatio: 10, nwStairs: 11, house: 12, porchRoof: 13, neighbor: 14 } as const;
/** B & 0x0F */
export const DATAMAP_FORMS: Record<number, string> = {
  0: 'Terrain', 1: 'Scissor Lift 1 (NW)', 2: 'Scissor Lift 2 (West)', 3: 'Scissor Lift 3 (East)', 4: 'Treehouse (West)', 5: 'CCTV Cam A (NW)', 6: 'CCTV Cam B (SE)',
  7: 'Police Cruiser', 8: 'SWAT APC', 9: 'Back Gazebo', 10: 'West Pergola', 11: 'River Sailboat', 12: 'Construction Container', 14: 'Drone Vent', 15: 'Attacker Spawn Pad Center',
};
export const FORM = { lift1: 1, lift2: 2, lift3: 3, treehouse: 4, camA: 5, camB: 6, cruiser: 7, apc: 8, gazebo: 9, pergola: 10, sailboat: 11, container: 12, vent: 14, spawnPad: 15 } as const;

/** the decoded map the running game uses (set once by the outdoor builder) — zone names for callouts */
let active: HouseDatamap | null = null;
export function setActiveDatamap(m: HouseDatamap) { active = m; }
export function datamapZoneAt(x: number, z: number): string | null {
  if (!active) return null;
  return DATAMAP_ZONES[active.sample(xToU(x), zToV(z)).zoneId] ?? null;
}

// [2] runtime decoder (browser): the 512×512 RGBA buffer straight from the data URI — no files generated
export async function decodeHouseDatamap512(): Promise<HouseDatamap> {
  const img = new Image();
  img.src = HOUSE_DATAMAP_512_B64;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, 512, 512);
  const { data } = ctx.getImageData(0, 0, 512, 512); // 512 * 512 * 4 Uint8ClampedArray

  return {
    sample(u: number, v: number) {
      const cu = Math.max(0, Math.min(511, Math.round(u)));
      const cv = Math.max(0, Math.min(511, Math.round(v)));
      const i = (cv * 512 + cu) * 4;
      return {
        x: (cu - 243.0) * 0.133333,
        z: (cv - 292.8) * 0.133333,
        hGround: (data[i] / 255.0) * 7.0 - 5.0,
        hUpper: (data[i + 1] / 255.0) * 10.0,
        zoneId: data[i + 2] >> 4,
        formId: data[i + 2] & 0x0F
      };
    }
  };
}
/**
 * The same sampler without a browser (node tests, headless tools): the data
 * URI is an SVG of integer-aligned filled rects painted in order, so reading
 * the rects gives exactly the pixels the canvas decoder above reads.
 */
export function decodeHouseDatamap512Headless(): HouseDatamap {
  const b64 = HOUSE_DATAMAP_512_B64.slice(HOUSE_DATAMAP_512_B64.indexOf(',') + 1);
  const svg = atob(b64);
  const data = new Uint8ClampedArray(512 * 512 * 4);
  const re = /<rect x="(\d+)"\s+y="(\d+)" width="(\d+)"\s+height="(\d+)" fill="rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)"/g;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    const [x, y, w, h, r, g, b] = m.slice(1).map(Number);
    for (let v = y; v < Math.min(512, y + h); v++) {
      for (let u = x; u < Math.min(512, x + w); u++) {
        const i = (v * 512 + u) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
  }
  return {
    sample(u: number, v: number) {
      const cu = Math.max(0, Math.min(511, Math.round(u)));
      const cv = Math.max(0, Math.min(511, Math.round(v)));
      const i = (cv * 512 + cu) * 4;
      return { x: (cu - 243.0) * 0.133333, z: (cv - 292.8) * 0.133333, hGround: (data[i] / 255.0) * 7.0 - 5.0, hUpper: (data[i + 1] / 255.0) * 10.0, zoneId: data[i + 2] >> 4, formId: data[i + 2] & 0x0F };
    },
  };
}
