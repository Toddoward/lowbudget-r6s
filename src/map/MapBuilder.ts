import * as THREE from 'three';
import type { Physics, SurfaceMaterial } from '../core/Physics.ts';
import { G_CLIP } from '../core/Physics.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { DestructionSystem, type Panel, type PanelKind } from '../world/Destruction.ts';
import { PAL, vcMaterial } from '../render/palette.ts';
import {
  FLOORS, FLOOR_LABEL, FLOOR_Y, HATCHES, OPENING_DIMS, ROOMS, STAIRS, WALLS, WALL_H, SLAB_T, exteriorZoneName,
  type FloorId, type OpeningKind, type RoomDef, type StairDef, type WallDef,
} from './houseLayout.ts';
import { PROPS, type PropDef } from './houseProps.ts';
import { subtractRects, inRect } from './geometry.ts';

export interface Opening {
  id: number;
  kind: OpeningKind;
  label: string;
  center: THREE.Vector3;
  w: number;
  h: number;
  /** wall run axis: 'x' → normal along Z */
  run: 'x' | 'z';
  /** wall plane coordinate */
  c: number;
  floor: FloorId;
  floorY: number;
  exterior: boolean;
  barricadeable: boolean;
  thickness: number;
  rooms: [string | null, string | null];
  /** active barricade / armor panel id */
  barricadePanel: number | null;
  barricadeKind: 'wood' | 'castle' | 'none';
  barricadeGen: number;
}

export interface LampDef { pos: THREE.Vector3; room: string }

export interface HouseWorld {
  openings: Opening[];
  stairs: StairDef[];
  lamps: LampDef[];
  props: PropDef[];
  wallPanels: Panel[];
  roomAt(p: THREE.Vector3): RoomDef | null;
  locationName(p: THREE.Vector3): string;
  floorOf(y: number): FloorId;
}

const TMP = new THREE.Vector3();

export function roomAt(p: THREE.Vector3): RoomDef | null {
  for (const room of ROOMS) {
    const fy = FLOOR_Y[room.floor];
    if (p.y < fy - 0.7 || p.y > fy + WALL_H + 0.1) continue;
    for (const r of room.rects) if (inRect(r, p.x, p.z)) return room;
  }
  return null;
}

export function stairAt(p: THREE.Vector3): StairDef | null {
  for (const s of STAIRS) if (inRect(s.rect, p.x, p.z, 0.1) && p.y > Math.min(s.yMin, s.yMax) - 0.5 && p.y < Math.max(s.yMin, s.yMax) + 0.5) return s;
  return null;
}

export function locationName(p: THREE.Vector3): string {
  const st = stairAt(p);
  if (st && !st.exterior) return st.label;
  const r = roomAt(p);
  if (r) return `${FLOOR_LABEL[r.floor]} ${r.name}`;
  if (st) return st.label;
  return exteriorZoneName(p.x, p.y, p.z);
}

export function floorOf(y: number): FloorId {
  if (y < -1.2) return -1;
  if (y < 2.2) return 0;
  return 1;
}

export function buildHouse(physics: Physics, destruction: DestructionSystem, scene: THREE.Scene): HouseWorld {
  const stat = new BoxBatch();
  const trim = new BoxBatch();
  const openings: Opening[] = [];
  const wallPanels: Panel[] = [];
  const lamps: LampDef[] = [];
  const addStatic = (min: number[], max: number[], color: THREE.Color, mat: SurfaceMaterial, exterior = false, side?: THREE.Color, axis = -1) => {
    stat.box(min, max, color, side ?? color, axis);
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat, exterior });
  };

  /* ------------------------------------------------------------- walls */
  for (const wall of WALLS) sliceWall(wall);

  function sliceWall(wall: WallDef) {
    const fy = FLOOR_Y[wall.floor];
    const t = wall.ext ? 0.3 : wall.tier === 'solid' ? 0.25 : 0.2;
    const e = wall.ext ? t / 2 : 0;
    const a = wall.from - e;
    const b = wall.to + e;
    const ops = [...(wall.openings ?? [])].sort((p, q) => p.at - q.at);
    type R4 = { u0: number; u1: number; v0: number; v1: number; full: boolean };
    const rects: R4[] = [];
    let cur = a;
    for (const o of ops) {
      const d = OPENING_DIMS[o.kind];
      const u0 = o.at - o.w / 2;
      const u1 = o.at + o.w / 2;
      if (u0 > cur + 1e-3) rects.push({ u0: cur, u1: u0, v0: fy, v1: fy + WALL_H, full: true });
      if (d.y0 > 0) rects.push({ u0, u1, v0: fy, v1: fy + d.y0, full: false });
      if (d.y0 + d.h < WALL_H - 1e-3) rects.push({ u0, u1, v0: fy + d.y0 + d.h, v1: fy + WALL_H, full: false });
      cur = u1;
      // opening record
      const center = wall.run === 'x' ? new THREE.Vector3(o.at, fy + d.y0 + d.h / 2, wall.c) : new THREE.Vector3(wall.c, fy + d.y0 + d.h / 2, o.at);
      const nrm = wall.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const sideA = roomAt(TMP.copy(center).addScaledVector(nrm, -0.6).setY(fy + 0.2));
      const sideB = roomAt(TMP.copy(center).addScaledVector(nrm, 0.6).setY(fy + 0.2));
      const labelRoom = sideA?.name ?? sideB?.name ?? 'Exterior';
      const kindLabel = o.kind === 'open_window' ? 'Open Window' : o.kind === 'window' ? 'Window' : o.kind === 'shutter' ? 'Garage Shutter' : o.kind === 'exterior_door' ? 'Exterior Door' : o.kind === 'arch' ? 'Archway' : 'Door';
      const op: Opening = {
        id: openings.length, kind: o.kind, label: `${FLOOR_LABEL[wall.floor]} ${labelRoom} ${kindLabel}`, center, w: o.w, h: d.h, run: wall.run, c: wall.c,
        floor: wall.floor, floorY: fy, exterior: !!wall.ext, barricadeable: d.barricade, thickness: t,
        rooms: [sideA?.id ?? null, sideB?.id ?? null], barricadePanel: null, barricadeKind: 'none', barricadeGen: 0,
      };
      openings.push(op);
      // frame trims
      const frameC = new THREE.Color(o.kind === 'shutter' ? '#3a3d42' : '#3b2f24');
      const ft = 0.05;
      const fr = (u0: number, u1: number, v0: number, v1: number, extra = 0.02) => {
        if (wall.run === 'x') trim.box([u0, v0, wall.c - t / 2 - extra], [u1, v1, wall.c + t / 2 + extra], frameC);
        else trim.box([wall.c - t / 2 - extra, v0, u0], [wall.c + t / 2 + extra, v1, u1], frameC);
      };
      fr(u0 - ft, u0, fy + d.y0, fy + d.y0 + d.h);
      fr(u1, u1 + ft, fy + d.y0, fy + d.y0 + d.h);
      fr(u0 - ft, u1 + ft, fy + d.y0 + d.h, fy + d.y0 + d.h + ft);
      if (d.y0 > 0) fr(u0 - ft, u1 + ft, fy + d.y0 - ft, fy + d.y0, 0.06);
      if (o.kind === 'shutter') {
        const spec = wallPanelSpec(wall, u0, u1, fy + d.y0, fy + d.y0 + d.h, 0.08, 'shutter', `B Garage Shutter ${o.at < 0 ? 'N' : 'S'}`, false);
        destruction.add(spec);
      }
    }
    if (b > cur + 1e-3) rects.push({ u0: cur, u1: b, v0: fy, v1: fy + WALL_H, full: true });

    const extColor = wall.floor === -1 ? PAL.concrete : PAL.solidExt;
    for (const r of rects) {
      if (wall.tier === 'solid') {
        const col = wall.ext ? extColor : PAL.solidWall;
        if (wall.run === 'x') addStatic([r.u0, r.v0, wall.c - t / 2], [r.u1, r.v1, wall.c + t / 2], col, 'concrete', !!wall.ext, PAL.concreteDark, 2);
        else addStatic([wall.c - t / 2, r.v0, r.u0], [wall.c + t / 2, r.v1, r.u1], col, 'concrete', !!wall.ext, PAL.concreteDark, 0);
        continue;
      }
      // slice into ≤2.5 m panels on the 0.25 grid
      const width = r.u1 - r.u0;
      const n = r.full ? Math.max(1, Math.ceil(width / 2.5 - 1e-6)) : 1;
      for (let i = 0; i < n; i++) {
        let s0 = r.u0 + (width * i) / n;
        let s1 = r.u0 + (width * (i + 1)) / n;
        if (i > 0) s0 = Math.round(s0 * 4) / 4;
        if (i < n - 1) s1 = Math.round(s1 * 4) / 4;
        const kind: PanelKind = wall.tier === 'semi' ? 'wall_semi' : 'wall_soft';
        const tierLbl = wall.tier === 'semi' ? 'Semi-breach Wall' : 'Soft Wall';
        const spec = wallPanelSpec(wall, s0, s1, r.v0, r.v1, t, kind, '', r.full && wall.tier === 'soft' && s1 - s0 >= 0.74);
        const sideA = spec.rooms?.[0];
        const sideB = spec.rooms?.[1];
        const nameA = ROOMS.find((x) => x.id === sideA)?.name;
        const nameB = ROOMS.find((x) => x.id === sideB)?.name;
        spec.label = `${FLOOR_LABEL[wall.floor]} ${tierLbl} (${[nameA ?? 'Exterior', nameB ?? 'Exterior'].join(' | ')})`;
        wallPanels.push(destruction.add(spec));
      }
    }
  }

  function wallPanelSpec(wall: WallDef, u0: number, u1: number, v0: number, v1: number, t: number, kind: PanelKind, label: string, reinforceable: boolean) {
    const min: [number, number, number] = wall.run === 'x' ? [u0, v0, wall.c - t / 2] : [wall.c - t / 2, v0, u0];
    const max: [number, number, number] = wall.run === 'x' ? [u1, v1, wall.c + t / 2] : [wall.c + t / 2, v1, u1];
    const nrm = wall.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const mid = new THREE.Vector3((min[0] + max[0]) / 2, FLOOR_Y[wall.floor] + 0.3, (min[2] + max[2]) / 2);
    const ra = roomAt(TMP.copy(mid).addScaledVector(nrm, -0.6))?.id ?? null;
    const rb = roomAt(TMP.copy(mid).addScaledVector(nrm, 0.6))?.id ?? null;
    return { kind, min, max, nAx: (wall.run === 'x' ? 2 : 0) as 0 | 2, label, exterior: !!wall.ext, reinforceable, rooms: [ra, rb] as [string | null, string | null] };
  }

  /* ------------------------------------------------------------- floors */
  for (const f of FLOORS) {
    const y1 = f.y;
    const y0 = f.y - SLAB_T;
    if (f.tier === 'semi') {
      destruction.add({
        kind: 'floor_semi', min: [f.rect.x0, y0, f.rect.z0], max: [f.rect.x1, y1, f.rect.z1], nAx: 1,
        label: f.label ?? f.id, exterior: f.kind === 'roof',
        voids: (f.holes ?? []).map((h) => ({ u0: h.x0, v0: h.z0, u1: h.x1, v1: h.z1 })),
      });
      continue;
    }
    const color = f.kind === 'roof' ? PAL.roof : f.kind === 'wood' ? PAL.woodFloor : f.y < -1 ? PAL.concreteDark : PAL.concrete;
    for (const r of subtractRects(f.rect, f.holes ?? [])) addStatic([r.x0, y0, r.z0], [r.x1, y1, r.z1], color, f.kind === 'wood' ? 'wood' : 'concrete', f.kind === 'roof', PAL.concreteDark, 1);
  }
  for (const h of HATCHES) {
    destruction.add({ kind: 'hatch', min: [h.rect.x0, h.y - SLAB_T, h.rect.z0], max: [h.rect.x1, h.y, h.rect.z1], nAx: 1, label: h.label, reinforceable: true, rooms: [h.below, h.above] });
  }
  // roof parapet / curb + chimney + AC unit (cover on the roof)
  const curb = (x0: number, z0: number, x1: number, z1: number) => addStatic([x0, 6, z0], [x1, 6.18, z1], PAL.concreteDark, 'concrete', true);
  curb(-8.15, -7.15, 8.15, -7.0); curb(-8.15, -7.0, -8.0, -2); curb(8.0, -7.0, 8.15, 2); curb(-6.15, -2, -6.0, 2); curb(-8.15, 2, -8.0, 7.15); curb(-8.0, 7.0, -2.85, 7.15); curb(-3.0, 2, -2.85, 7.0); curb(-2.85, 1.85, 8.15, 2);
  addStatic([-7.6, 6, -6.9], [-6.6, 7.6, -6.0], new THREE.Color('#7a5446'), 'concrete', true);
  addStatic([3.2, 6, -4.6], [4.6, 6.9, -3.4], new THREE.Color('#9a9b98'), 'metal', true);
  // porch: posts + rails
  for (const z of [-2.35, 7.0]) addStatic([-10.7, 0, z - 0.1], [-10.5, 2.8, z + 0.1], PAL.solidExt, 'wood', true);
  for (const z of [2.3, 4.6]) addStatic([-10.7, 0, z - 0.1], [-10.5, 2.8, z + 0.1], PAL.solidExt, 'wood', true);
  for (const [z0, z1] of [[-2.35, -0.75], [0.75, 7.0]]) {
    trim.box([-10.68, 0.85, z0], [-10.52, 0.95, z1], PAL.solidExt);
    physics.addBox(-10.6, 0.45, (z0 + z1) / 2, 0.06, 0.45, (z1 - z0) / 2, { kind: 'static', mat: 'wood' }, undefined, G_CLIP);
  }

  /* ------------------------------------------------------------- stairs */
  for (const s of STAIRS) buildStair(s);
  function buildStair(s: StairDef) {
    const r = s.rect;
    const along = s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
    const width = s.axis === 'x' ? r.z1 - r.z0 : r.x1 - r.x0;
    const rise = s.yMax - s.yMin;
    const steps = Math.max(4, Math.round(Math.abs(rise) / 0.19));
    const stepColor = s.exterior ? PAL.concrete : PAL.woodFloor;
    for (let i = 0; i < steps; i++) {
      const a0 = (along * i) / steps;
      const a1 = (along * (i + 1)) / steps;
      const yTop = s.yMin + rise * ((rise > 0 ? i + 1 : i) / steps);
      const yb = s.exterior ? Math.min(s.yMin, s.yMax) - 0.05 : yTop - 0.22;
      if (s.axis === 'x') stat.box([r.x0 + a0, yb, r.z0], [r.x0 + a1, yTop, r.z1], stepColor, PAL.woodDark, 1);
      else stat.box([r.x0, yb, r.z0 + a0], [r.x1, yTop, r.z0 + a1], stepColor, PAL.woodDark, 1);
    }
    // ramp collider: top surface from (min end, yMin) to (max end, yMax)
    const theta = Math.atan2(rise, along);
    const L = Math.hypot(along, rise);
    const q = new THREE.Quaternion();
    if (s.axis === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta);
    else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta);
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const cy = (s.yMin + s.yMax) / 2 - 0.1 / Math.cos(theta);
    const hx = s.axis === 'x' ? L / 2 : width / 2;
    const hz = s.axis === 'x' ? width / 2 : L / 2;
    physics.addBox(cx, cy, cz, hx, 0.1, hz, { kind: 'static', mat: s.exterior ? 'concrete' : 'wood' }, q);
    // stringers (visual) on interior stairs
    if (!s.exterior) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, (s.yMin + s.yMax) / 2 - 0.15, cz), q, new THREE.Vector3(1, 1, 1));
      const side = s.axis === 'x' ? new THREE.Vector3(0, 0, width / 2) : new THREE.Vector3(width / 2, 0, 0);
      for (const sg of [1, -1]) {
        const mm = m.clone().premultiply(new THREE.Matrix4().makeTranslation(side.x * sg, 0, side.z * sg));
        if (s.axis === 'x') stat.tbox(mm, L, 0.3, 0.05, PAL.woodDark);
        else stat.tbox(mm, 0.05, 0.3, L, PAL.woodDark);
      }
    }
  }
  // stair-well guard rails (movement clip only: bullets & sight pass)
  const rail = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    trim.box([x0, y + 0.85, z0], [x1, y + 0.92, z1], PAL.woodDark);
    for (let k = 0; k <= 4; k++) {
      const px = x0 + ((x1 - x0) * k) / 4;
      const pz = z0 + ((z1 - z0) * k) / 4;
      trim.box([px - 0.025, y, pz - 0.025], [px + 0.025, y + 0.88, pz + 0.025], PAL.woodDark);
    }
    physics.addBox((x0 + x1) / 2, y + 0.46, (z0 + z1) / 2, Math.max(0.03, (x1 - x0) / 2), 0.46, Math.max(0.03, (z1 - z0) / 2), { kind: 'static', mat: 'wood' }, undefined, G_CLIP);
  };
  rail(-7.6, -3.3, -4.0, -3.25, 0); // living stairs (north side)
  rail(-7.65, -3.3, -7.6, -2.1, 0); // living stairs (west end)
  rail(4.0, -2.5, 4.05, 1.5, 0); // kitchen stairs east side
  rail(2.75, -2.55, 4.05, -2.5, 0); // kitchen stairs north end
  rail(-2.5, -0.5, 1.5, -0.45, 3); // main stairs south side (2F)
  rail(-2.55, -1.75, -2.5, -0.45, 3); // main stairs west end (2F)

  /* ------------------------------------------------------------- props */
  const propBatch = new BoxBatch();
  for (const p of PROPS) buildProp(p);
  function buildProp(p: PropDef) {
    const fy = FLOOR_Y[p.floor] + (p.lift ?? 0);
    const [sx, sy, sz] = p.size;
    const c = new THREE.Color(p.color);
    const dark = c.clone().multiplyScalar(0.6);
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.25);
    const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col = c) => propBatch.box([p.x + x0, fy + y0, p.z + z0], [p.x + x1, fy + y1, p.z + z1], col);
    const hx = sx / 2, hz = sz / 2;
    switch (p.style) {
      case 'sofa':
        B(-hx, 0.1, -hz, hx, 0.45, hz); B(-hx, 0.45, hz - 0.22, hx, sy, hz, dark); B(-hx, 0.45, -hz, -hx + 0.2, 0.65, hz, dark); B(hx - 0.2, 0.45, -hz, hx, 0.65, hz, dark);
        B(-hx + 0.25, 0.45, -hz + 0.05, -0.02, 0.58, hz - 0.22, light); B(0.02, 0.45, -hz + 0.05, hx - 0.25, 0.58, hz - 0.22, light);
        break;
      case 'bed':
        B(-hx, 0.0, -hz, hx, 0.3, hz, new THREE.Color('#4f3a26')); B(-hx + 0.05, 0.3, -hz + 0.05, hx - 0.05, sy, hz - 0.05, light);
        B(-hx, 0, -hz, -hx + 0.08, 1.0, hz, new THREE.Color('#4f3a26')); B(-hx + 0.1, sy, -hz + 0.15, -hx + 0.5, sy + 0.12, hz - 0.15, new THREE.Color('#e8e4da'));
        break;
      case 'table': case 'desk':
        B(-hx, sy - 0.05, -hz, hx, sy, hz);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(lx * (hx - 0.06) - 0.03, 0, lz * (hz - 0.06) - 0.03, lx * (hx - 0.06) + 0.03, sy - 0.05, lz * (hz - 0.06) + 0.03, dark);
        if (p.style === 'desk') B(-0.25, sy, -0.1, 0.25, sy + 0.35, 0.0, new THREE.Color('#1c1c1c'));
        break;
      case 'shelf': case 'rack': {
        const vertical = sx < sz;
        for (const s of [-1, 1]) {
          if (vertical) B(-hx, 0, s * hz - (s > 0 ? 0.04 : 0), hx, sy, s * hz + (s < 0 ? 0.04 : 0), dark);
          else B(s * hx - (s > 0 ? 0.04 : 0), 0, -hz, s * hx + (s < 0 ? 0.04 : 0), sy, hz, dark);
        }
        for (let k = 0; k < 4; k++) {
          const y = 0.1 + (k * (sy - 0.15)) / 3;
          B(-hx, y, -hz, hx, y + 0.03, hz);
          if (k < 3) B(-hx * 0.8, y + 0.03, -hz * 0.7, hx * 0.3, y + 0.28, hz * 0.6, new THREE.Color(k % 2 ? '#8a6f4a' : '#4f5a68'));
        }
        break;
      }
      case 'car': case 'boat': {
        const col = c;
        if (p.style === 'car') {
          B(-hx, 0.25, -hz, hx, 0.85, hz, col); B(-hx + 0.08, 0.85, -hz + 1.0, hx - 0.08, sy, hz - 1.1, dark);
          B(-hx + 0.1, 0.9, -hz + 0.95, hx - 0.1, sy - 0.08, -hz + 1.0, new THREE.Color('#9fc3d0'));
          for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(wx * hx - 0.12 * wx - 0.1, 0, wz * (hz - 0.8) - 0.33, wx * hx - 0.12 * wx + 0.1, 0.62, wz * (hz - 0.8) + 0.33, new THREE.Color('#151515'));
          B(-hx + 0.15, 0.55, -hz - 0.01, -hx + 0.45, 0.7, -hz, new THREE.Color('#fff7d0'));
          B(hx - 0.45, 0.55, -hz - 0.01, hx - 0.15, 0.7, -hz, new THREE.Color('#fff7d0'));
        } else {
          B(-hx * 0.6, 0, -hz, hx * 0.6, 0.35, hz, new THREE.Color('#33373b'));
          B(-hx, 0.35, -hz + 0.3, hx, 1.0, hz, col); B(-hx * 0.5, 0.35, -hz, hx * 0.5, 0.9, -hz + 0.3, col);
          B(-hx + 0.1, 1.0, -hz + 1.0, hx - 0.1, sy, hz - 1.8, new THREE.Color('#2f5a7a'));
        }
        break;
      }
      case 'counter':
        B(-hx, 0, -hz, hx, sy - 0.04, hz, dark); B(-hx - 0.02, sy - 0.04, -hz - 0.02, hx + 0.02, sy, hz + 0.02, c);
        break;
      case 'shower':
        B(-hx, 0, -hz, hx, 0.12, hz, light);
        B(-hx, 0, hz - 0.08, hx, 1.25, hz, c); B(hx - 0.08, 0, -hz, hx, 1.25, hz, c);
        trim.box([p.x - hx, fy + 1.25, p.z + hz - 0.02], [p.x + hx, fy + sy, p.z + hz], new THREE.Color('#bcd6dd'));
        trim.box([p.x + hx - 0.02, fy + 1.25, p.z - hz], [p.x + hx, fy + sy, p.z + hz], new THREE.Color('#bcd6dd'));
        break;
      case 'tub':
        B(-hx, 0, -hz, hx, sy, hz, c); B(-hx + 0.08, 0.2, -hz + 0.08, hx - 0.08, sy + 0.001, hz - 0.08, new THREE.Color('#bcd6dd'));
        break;
      case 'bunk':
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(lx * hx - 0.04, 0, lz * hz - 0.04, lx * hx + 0.04, sy, lz * hz + 0.04, dark);
        B(-hx, 0.25, -hz, hx, 0.45, hz, new THREE.Color('#d8d2c2')); B(-hx, 1.1, -hz, hx, 1.3, hz, new THREE.Color('#c25b4a'));
        break;
      case 'bag':
        B(-hx * 0.8, 0, -hz * 0.8, hx * 0.8, sy, hz * 0.8, c); trim.box([p.x - 0.01, fy + sy, p.z - 0.01], [p.x + 0.01, FLOOR_Y[p.floor] + 2.8, p.z + 0.01], PAL.darkMetal);
        break;
      case 'pillar':
        B(-hx, 0, -hz, hx, sy, hz, c);
        B(-hx - 0.04, sy - 0.25, -hz - 0.04, hx + 0.04, sy, hz + 0.04, dark);
        break;
      case 'cylinder':
        propBatch.geom(new THREE.CylinderGeometry(hx, hx, sy, 10), new THREE.Matrix4().makeTranslation(p.x, fy + sy / 2, p.z), c);
        break;
      case 'chair':
        B(-hx, 0, -hz, hx, sy * 0.48, hz, c); B(-hx, sy * 0.48, hz - 0.08, hx, sy, hz, dark);
        break;
      case 'bench':
        B(-hx, sy - 0.08, -hz, hx, sy, hz, c); B(-hx + 0.05, 0, -hz + 0.05, hx - 0.05, sy - 0.08, hz - 0.05, dark);
        break;
      default:
        B(-hx, 0, -hz, hx, sy, hz, c);
        if (p.style === 'appliance') B(-hx + 0.05, sy * 0.55, -hz - 0.005, hx - 0.05, sy * 0.58, -hz, dark);
        if (p.style === 'box') B(-hx - 0.005, sy * 0.45, -hz - 0.005, hx + 0.005, sy * 0.55, hz + 0.005, new THREE.Color('#c8b28a'));
    }
    if (sy > 0.08) physics.addBox(p.x, fy + sy / 2, p.z, hx, sy / 2, hz, { kind: 'static', mat: p.mat });
  }

  /* ------------------------------------------------------------- lamps (night) */
  for (const room of ROOMS) {
    const r = room.rects[0];
    const pos = new THREE.Vector3((r.x0 + r.x1) / 2, FLOOR_Y[room.floor] + WALL_H - 0.08, (r.z0 + r.z1) / 2);
    lamps.push({ pos, room: room.id });
    trim.box([pos.x - 0.22, pos.y - 0.04, pos.z - 0.22], [pos.x + 0.22, pos.y + 0.08, pos.z + 0.22], new THREE.Color('#d9d2b8'));
  }

  const statMesh = new THREE.Mesh(stat.build(), vcMaterial());
  statMesh.castShadow = true;
  statMesh.receiveShadow = true;
  statMesh.name = 'house_static';
  const trimMesh = new THREE.Mesh(trim.build(), vcMaterial());
  trimMesh.castShadow = true;
  trimMesh.receiveShadow = true;
  const propMesh = new THREE.Mesh(propBatch.build(), vcMaterial());
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  propMesh.name = 'house_props';
  scene.add(statMesh, trimMesh, propMesh, destruction.group);

  return { openings, stairs: STAIRS, lamps, props: PROPS, wallPanels, roomAt, locationName, floorOf };
}
