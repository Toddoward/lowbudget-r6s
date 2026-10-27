import * as THREE from 'three';
import type { Physics, SurfaceMaterial } from '../core/Physics.ts';
import { G_CLIP } from '../core/Physics.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { DestructionSystem, type Panel, type PanelKind } from '../world/Destruction.ts';
import { PAL, vcMaterial } from '../render/palette.ts';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  CCTVS, DIAG_WALLS, FLOORS, openingDims, MAIN_LANDING, STAIR_HOLES, FLOOR_LABEL, FLOOR_Y, HATCHES, LANDINGS, PANEL_MAX_W, ROOF_Y, ROOFS, ROOMS, SLAB_T, STAIRS, WALLS, WALL_H, roofPoints,
  exteriorZoneName, type FloorId, type OpeningKind, type RoomDef, type Rect, type StairDef, type SurfaceTier, type WallDef,
  DECK_STEPS,
} from './houseLayout.ts';
import { P } from './plan.ts';
import { PROPS, type PropDef } from './houseProps.ts';
import { subtractRects, inRect } from './geometry.ts';
import { HOUSE_HOLES, NW_PIT_WALLS, rimPieces, terrainY } from './terrain.ts';

export interface Opening {
  id: number;
  kind: OpeningKind;
  label: string;
  center: THREE.Vector3;
  w: number;
  h: number;
  /** wall run axis: 'x' → normal along Z ('d' = diagonal wall, see `normal`) */
  run: 'x' | 'z' | 'd';
  /** wall plane coordinate (axis-aligned walls) */
  c: number;
  /** horizontal unit normal of the wall plane */
  normal: THREE.Vector3;
  floor: FloorId;
  floorY: number;
  exterior: boolean;
  barricadeable: boolean;
  /** barricade bottom gap (doors: drones roll under, prone players see feet) */
  gap: number;
  thickness: number;
  rooms: [string | null, string | null];
  /** active barricade / armor panel id */
  barricadePanel: number | null;
  barricadeKind: 'wood' | 'castle' | 'none';
  barricadeGen: number;
}

export interface LampDef { pos: THREE.Vector3; room: string }
export interface CameraDef { id: string; label: string; pos: THREE.Vector3; yaw: number; exterior: boolean; mesh: THREE.Object3D; alive: boolean; collider: unknown }

export interface HouseWorld {
  openings: Opening[];
  stairs: StairDef[];
  lamps: LampDef[];
  props: PropDef[];
  wallPanels: Panel[];
  cameras: CameraDef[];
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
  if (y < -1.4) return -1;
  if (y < 2.9) return 0;
  return 1;
}

const thicknessOf = (w: WallDef) => w.t ?? (w.ext ? 0.3 : w.tier === 'solid' && !(w.spans ?? []).length ? 0.25 : 0.2);
const KIND_LABEL: Record<OpeningKind, string> = {
  open_window: 'Open Window', window: 'Window', french: 'French Window', shutter: 'Garage Shutter', exterior_door: 'Door', arch: 'Archway', door: 'Doorway', vent: 'Drone Vent',
};

export function buildHouse(physics: Physics, destruction: DestructionSystem, scene: THREE.Scene): HouseWorld {
  const stat = new BoxBatch();
  const trim = new BoxBatch();
  /** roof solids (convex hulls, flat-shaded) */
  const roof = new BoxBatch();
  const openings: Opening[] = [];
  const wallPanels: Panel[] = [];
  const lamps: LampDef[] = [];
  const cameras: CameraDef[] = [];
  const addStatic = (min: number[], max: number[], color: THREE.Color, mat: SurfaceMaterial, exterior = false, side?: THREE.Color, axis = -1) => {
    stat.box(min, max, color, side ?? color, axis);
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat, exterior });
  };
  const clip = (min: number[], max: number[]) =>
    physics.addBox((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2, (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2, { kind: 'static', mat: 'wood' }, undefined, G_CLIP);
  const box = (run: 'x' | 'z', c: number, t: number, u0: number, u1: number, v0: number, v1: number): [number[], number[]] =>
    run === 'x' ? [[u0, v0, c - t / 2], [u1, v1, c + t / 2]] : [[c - t / 2, v0, u0], [c + t / 2, v1, u1]];

  /** footprints of the bands along the outer walls (floor lines) and of the frieze under the eaves, per slab level: the
   *  slabs at that level stop at them instead of running into them (overlapping coplanar faces flicker) */
  const bands = new Map<number, Rect[]>();
  const bandAt = (y: number, wall: WallDef, t: number, u0: number, u1: number) => {
    const [mn, mx] = box(wall.run, wall.c, t, u0, u1, 0, 0);
    (bands.get(y) ?? bands.set(y, []).get(y)!).push({ x0: mn[0], z0: mn[2], x1: mx[0], z1: mx[2] });
  };

  /* ------------------------------------------------------------- walls */
  for (const wall of WALLS) sliceWall(wall);
  // a frieze along the top of every 2F outer wall, up to the eaves (closes the strip between the wall top and the roof)
  for (const w of WALLS) {
    if (!w.ext || w.floor !== 1) continue;
    const a = w.from - wallReach(w, w.from), b = w.to + wallReach(w, w.to);
    addStatic(...box(w.run, w.c, thicknessOf(w), a, b, FLOOR_Y[1] + WALL_H, ROOF_Y), PAL.solidExt, 'concrete', true);
    bandAt(ROOF_Y, w, thicknessOf(w), a, b);
  }

  function tierAt(wall: WallDef, u: number): SurfaceTier {
    for (const s of wall.spans ?? []) if (u >= s.from - 1e-4 && u <= s.to + 1e-4) return s.tier;
    return wall.tier;
  }

  /**
   * How far a wall reaches past one of its ends (+) or stops short of it (−), so walls meet without overlapping (coplanar
   * faces flicker) and without notches. One wall owns each joint and runs over it to the far face of the walls across; the
   * others stop at its face (or, on its own line, where it ends). The owner is a line that runs on through the joint (two
   * walls of the same make end to end), else an outer wall over an inner one, a thicker over a thinner, an X-running over a
   * Z-running one. Without walls across: walls on one line abut; a parallel wall offset by less than the walls are thick
   * (a jog in an outer line) — the one nearer the origin runs to the other's far side; a free end of an outer wall covers
   * half its thickness.
   */
  function wallReach(wall: WallDef, end: number): number {
    const near = (p: number, q: number) => Math.abs(p - q) < 0.03;
    const t = thicknessOf(wall);
    const alike = (a: WallDef, b: WallDef) => thicknessOf(a) === thicknessOf(b) && !!a.ext === !!b.ext;
    const endsAt = (v: WallDef, u: number) => near(v.from, u) || near(v.to, u);
    const same = WALLS.filter((v) => v !== wall && v.floor === wall.floor);
    const partners = same.filter((v) => v.run === wall.run && near(v.c, wall.c) && endsAt(v, end));
    const across = same.filter((v) => v.run !== wall.run && near(v.c, end) && wall.c > Math.min(v.from, v.to) - 0.03 && wall.c < Math.max(v.from, v.to) + 0.03);
    if (!across.length) {
      if (partners.length) return 0;
      const jog = same.find((v) => v.run === wall.run && !near(v.c, wall.c) && Math.abs(v.c - wall.c) < (t + thicknessOf(v)) / 2 && endsAt(v, end));
      if (jog) return wall.c < jog.c ? t / 2 : -thicknessOf(jog) / 2;
      return wall.ext ? t / 2 : 0;
    }
    const tAcross = Math.max(...across.map(thicknessOf));
    const oursRunsOn = partners.some((v) => alike(v, wall));
    const theirsRunsOn = across.some((v) => !endsAt(v, wall.c)) || across.some((a) => across.some((b) => a !== b && alike(a, b)));
    if (theirsRunsOn && !oursRunsOn) return -tAcross / 2;
    if (oursRunsOn) return 0;
    const rank = (v: WallDef) => (v.ext ? 4 : 0) + thicknessOf(v) + (v.run === 'x' ? 0.001 : 0);
    const owner = [wall, ...partners, ...across].reduce((a, b) => (rank(b) > rank(a) ? b : a));
    if (owner === wall) return tAcross / 2;
    if (owner.run === wall.run) return -tAcross / 2;
    return -thicknessOf(owner) / 2;
  }

  function sliceWall(wall: WallDef) {
    const fy = FLOOR_Y[wall.floor];
    const t = thicknessOf(wall);
    const wh = wall.h ?? WALL_H;
    const a = wall.from - wallReach(wall, wall.from);
    const b = wall.to + wallReach(wall, wall.to);
    // outer walls: a band through the slab line under them (on B the footing) — the slabs stop at its faces, so nothing
    // overlaps, and where a stairwell has no slab there is no slot; just under the floor line where a doorway shows its threshold
    if (wall.ext) {
      const sills = (wall.openings ?? []).filter((o) => openingDims(o).y0 < 0.05).map((o) => [o.at - o.w / 2, o.at + o.w / 2]).sort((p, q) => p[0] - q[0]);
      let u = a;
      const col = wall.floor === -1 ? PAL.concrete : PAL.solidExt;
      const band = (u0: number, u1: number, top: number) => { if (u1 - u0 > 1e-3) addStatic(...box(wall.run, wall.c, t, u0, u1, fy - SLAB_T, top), col, 'concrete', true); };
      for (const [s0, s1] of sills) { band(u, s0, fy); band(Math.max(u, s0), s1, fy - 0.004); u = Math.max(u, s1); }
      band(u, b, fy);
      bandAt(fy, wall, t, a, b);
      if (wall.floor === 0) foundation(wall, t, a, b, fy - SLAB_T);
    }
    const ops = [...(wall.openings ?? [])].sort((p, q) => p.at - q.at);
    type R4 = { u0: number; u1: number; v0: number; v1: number; full: boolean };
    const rects: R4[] = [];
    let cur = a;
    const nrm = wall.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    for (const o of ops) {
      const d = openingDims(o);
      const u0 = o.at - o.w / 2;
      const u1 = o.at + o.w / 2;
      if (u0 > cur + 1e-3) rects.push({ u0: cur, u1: u0, v0: fy, v1: fy + wh, full: true });
      if (d.y0 > 0.001) rects.push({ u0, u1, v0: fy, v1: fy + d.y0, full: false });
      if (d.y0 + d.h < wh - 1e-3) rects.push({ u0, u1, v0: fy + d.y0 + d.h, v1: fy + wh, full: false });
      cur = u1;
      const center = wall.run === 'x' ? new THREE.Vector3(o.at, fy + d.y0 + d.h / 2, wall.c) : new THREE.Vector3(wall.c, fy + d.y0 + d.h / 2, o.at);
      const sideA = roomAt(TMP.copy(center).addScaledVector(nrm, -0.6).setY(fy + 0.2));
      const sideB = roomAt(TMP.copy(center).addScaledVector(nrm, 0.6).setY(fy + 0.2));
      const labelRoom = sideA?.name ?? sideB?.name ?? 'Exterior';
      openings.push({
        id: openings.length, kind: o.kind, label: `${FLOOR_LABEL[wall.floor]} ${labelRoom} ${KIND_LABEL[o.kind]}`, center, w: o.w, h: d.h, run: wall.run, c: wall.c, normal: nrm.clone(),
        floor: wall.floor, floorY: fy, exterior: !!wall.ext, barricadeable: d.barricade, gap: d.gap, thickness: t,
        rooms: [sideA?.id ?? null, sideB?.id ?? null], barricadePanel: null, barricadeKind: 'none', barricadeGen: 0,
      });
      const prev = ops[ops.indexOf(o) - 1], next = ops[ops.indexOf(o) + 1];
      const reachL = prev ? (u0 - (prev.at + prev.w / 2)) / 2 : Infinity;
      const reachR = next ? (next.at - next.w / 2 - u1) / 2 : Infinity;
      frameOpening(wall.run, wall.c, t, o.kind, u0, u1, fy + d.y0, fy + d.y0 + d.h, reachL, reachR);
      if (o.kind === 'shutter') {
        // shutter = three reinforceable metal sections
        const n = 3;
        for (let i = 0; i < n; i++) {
          const s0 = u0 + ((u1 - u0) * i) / n;
          const s1 = u0 + ((u1 - u0) * (i + 1)) / n;
          const [mn, mx] = box(wall.run, wall.c, 0.08, s0, s1, fy + d.y0, fy + d.y0 + d.h);
          const p = destruction.add({ kind: 'shutter', min: mn as [number, number, number], max: mx as [number, number, number], nAx: wall.run === 'x' ? 2 : 0, label: `B Garage Shutter ${o.at < 0 ? 'B' : 'A'} §${i + 1}`, exterior: true, reinforceable: true, rooms: ['garage', null] });
          wallPanels.push(p);
        }
      }
    }
    if (b > cur + 1e-3) rects.push({ u0: cur, u1: b, v0: fy, v1: fy + wh, full: true });

    const extColor = wall.floor === -1 ? PAL.concrete : PAL.solidExt;
    for (const r0 of rects) {
      // split each piece where the tier changes
      const cuts = [r0.u0, ...(wall.spans ?? []).flatMap((s) => [s.from, s.to]).filter((u) => u > r0.u0 + 1e-3 && u < r0.u1 - 1e-3), r0.u1].sort((p, q) => p - q);
      for (let k = 0; k < cuts.length - 1; k++) {
        const r = { ...r0, u0: cuts[k], u1: cuts[k + 1] };
        if (r.u1 - r.u0 < 0.02) continue;
        const tier = tierAt(wall, (r.u0 + r.u1) / 2);
        if (tier === 'solid') {
          const col = wall.ext ? extColor : PAL.solidWall;
          const [mn, mx] = box(wall.run, wall.c, t, r.u0, r.u1, r.v0, r.v1);
          addStatic(mn, mx, col, 'concrete', !!wall.ext, PAL.concreteDark, wall.run === 'x' ? 2 : 0);
          continue;
        }
        // reinforcement-sized panels
        const width = r.u1 - r.u0;
        const n = r.full ? Math.max(1, Math.ceil(width / PANEL_MAX_W - 1e-6)) : 1;
        for (let i = 0; i < n; i++) {
          const s0 = r.u0 + (width * i) / n;
          const s1 = r.u0 + (width * (i + 1)) / n;
          const kind: PanelKind = tier === 'semi' ? 'wall_semi' : 'wall_soft';
          const tierLbl = tier === 'semi' ? 'Semi-breach Wall' : 'Soft Wall';
          const spec = wallPanelSpec(wall, t, s0, s1, r.v0, r.v1, kind, r.full && tier === 'soft' && s1 - s0 >= 0.6);
          const nameA = ROOMS.find((x) => x.id === spec.rooms[0])?.name;
          const nameB = ROOMS.find((x) => x.id === spec.rooms[1])?.name;
          spec.label = `${FLOOR_LABEL[wall.floor]} ${tierLbl} (${[nameA ?? 'Exterior', nameB ?? 'Exterior'].join(' | ')})`;
          const p = destruction.add(spec);
          wallPanels.push(p);
          // baseboard: the visual cue that this wall is breakable (it goes when the wall goes)
          if (r.full && r.v0 === fy) {
            const bb = new BoxBatch();
            // (the Z-running ones 4 mm lower: two meeting at a corner don't share their top)
            const [mn, mx] = box(wall.run, wall.c, t + 0.035, s0 + 0.01, s1 - 0.01, fy - 0.002, fy + (wall.run === 'x' ? 0.11 : 0.106));
            bb.box(mn, mx, tier === 'semi' ? PAL.studDark : PAL.baseboard);
            const m = new THREE.Mesh(bb.build(), vcMaterial());
            m.receiveShadow = true;
            p.details.push(m);
            destruction.group.add(m);
          }
        }
      }
    }
  }

  /**
   * The frame lines the opening: jambs, head and sill stand 4 mm proud of the cut faces of the wall (flush, the two would
   * share a plane and flicker), the jambs stop under the head and above the sill, and a frame never reaches past the middle
   * of the pier to the next opening (`reachL` / `reachR`).
   */
  /**
   * Under a 1F outer wall with no basement below it (its line outside the House's below-grade footprint) and yard ground
   * beside it: a foundation from the band down into the ground, so there is no open slot under the floor line. (Not over
   * the garage drive: there the band is the beam over the carport.)
   */
  function foundation(wall: WallDef, t: number, a: number, b: number, top: number) {
    const pt = (u: number, off: number): [number, number] => (wall.run === 'x' ? [u, wall.c + off] : [wall.c + off, u]);
    const inHole = ([x, z]: [number, number]) => HOUSE_HOLES.some((r) => x > r.x0 + 1e-3 && x < r.x1 - 1e-3 && z > r.z0 + 1e-3 && z < r.z1 - 1e-3);
    const STEP = 0.25;
    const n = Math.max(1, Math.round((b - a) / STEP));
    const ground: number[] = [];
    for (let k = 0; k < n; k++) {
      const u = a + ((k + 0.5) * (b - a)) / n;
      if (inHole(pt(u, 0))) { ground.push(NaN); continue; }
      const beside = [-(t / 2 + 0.15), t / 2 + 0.15].map((o) => pt(u, o)).filter((p) => !inHole(p)).map(([x, z]) => terrainY(x, z));
      const g = beside.length ? Math.min(...beside) : NaN;
      ground.push(g >= -2.5 ? g : NaN);
    }
    for (let k = 0; k < n; ) {
      if (Number.isNaN(ground[k])) { k++; continue; }
      let e = k;
      while (e < n && !Number.isNaN(ground[e])) e++;
      const u0 = a + (k * (b - a)) / n, u1 = a + (e * (b - a)) / n;
      const bottom = Math.min(...ground.slice(k, e)) - 0.15;
      if (top - bottom > 0.05) addStatic(...box(wall.run, wall.c, t, u0, u1, bottom, top), PAL.concrete, 'concrete', true);
      k = e;
    }
  }

  function frameOpening(run: 'x' | 'z', c: number, t: number, kind: OpeningKind, u0: number, u1: number, y0: number, y1: number, reachL = Infinity, reachR = Infinity) {
    const frameC = kind === 'shutter' ? new THREE.Color('#3a3d42') : kind === 'vent' ? PAL.darkMetal : new THREE.Color('#3b2f24');
    const ft = kind === 'vent' ? 0.025 : 0.05;
    const e = 0.004;
    const fl = Math.min(ft, reachL), fr_ = Math.min(ft, reachR);
    const fr = (a0: number, a1: number, v0: number, v1: number, extra = 0.02) => {
      const [mn, mx] = box(run, c, t + extra * 2, a0, a1, v0, v1);
      trim.box(mn, mx, frameC);
    };
    const sill = y0 > FLOOR_Y[floorOf(y0)] + 0.01;
    const j0 = sill ? y0 + e : y0;
    fr(u0 - fl, u0 + e, j0, y1 - e);
    fr(u1 - e, u1 + fr_, j0, y1 - e);
    fr(u0 - fl, u1 + fr_, y1 - e, y1 + ft);
    if (sill) fr(u0 - fl, u1 + fr_, y0 - ft, y0 + e, 0.06);
    if (kind === 'vent') {
      // grille bars: visual only — drones and grenades pass, bodies can't fit anyway
      for (let k = 1; k < 5; k++) {
        const u = u0 + ((u1 - u0) * k) / 5;
        const [mn, mx] = box(run, c, 0.02, u - 0.008, u + 0.008, y0, y1);
        trim.box(mn, mx, PAL.darkMetal);
      }
    }
  }

  function wallPanelSpec(wall: WallDef, t: number, u0: number, u1: number, v0: number, v1: number, kind: PanelKind, reinforceable: boolean) {
    const [mn, mx] = box(wall.run, wall.c, t, u0, u1, v0, v1);
    const nrm = wall.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const mid = new THREE.Vector3((mn[0] + mx[0]) / 2, FLOOR_Y[wall.floor] + 0.3, (mn[2] + mx[2]) / 2);
    const ra = roomAt(TMP.copy(mid).addScaledVector(nrm, -0.6))?.id ?? null;
    const rb = roomAt(TMP.copy(mid).addScaledVector(nrm, 0.6))?.id ?? null;
    return { kind, min: mn as [number, number, number], max: mx as [number, number, number], nAx: (wall.run === 'x' ? 2 : 0) as 0 | 2, label: '', exterior: !!wall.ext, reinforceable, rooms: [ra, rb] as [string | null, string | null] };
  }

  /* ------------------------------------------------------------- diagonal walls (bay, NE chamfer) */
  for (const dw of DIAG_WALLS) {
    const fy = FLOOR_Y[dw.floor];
    const A = new THREE.Vector2(...dw.a);
    const B = new THREE.Vector2(...dw.b);
    const len = A.distanceTo(B);
    const dir = B.clone().sub(A).normalize();
    const yaw = Math.atan2(-dir.y, dir.x);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const t = 0.3;
    const col = dw.floor === -1 ? PAL.concrete : PAL.solidExt;
    // (the wall's own ends reach 7.5 cm into the walls they meet; pieces between them meet edge to edge — overlapping
    // coplanar pieces flicker)
    const piece = (s0: number, s1: number, v0: number, v1: number) => {
      const e0 = s0 <= 1e-6 ? 0.075 : 0, e1 = s1 >= len - 1e-6 ? 0.075 : 0;
      const m = (s0 - e0 + s1 + e1) / 2;
      const L = s1 + e1 - (s0 - e0);
      const c = new THREE.Vector3(A.x + dir.x * m, fy + (v0 + v1) / 2, A.y + dir.y * m);
      const mat = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
      stat.tbox(mat, L, v1 - v0, t, col);
      physics.addBox(c.x, c.y, c.z, L / 2, (v1 - v0) / 2, t / 2, { kind: 'static', mat: 'concrete', exterior: true }, q);
    };
    if (dw.floor >= 0) piece(0, len, -SLAB_T, 0); // the band through the slab under it (as for the straight outer walls)
    if (!dw.window) piece(0, len, 0, WALL_H);
    else {
      const w = dw.window.w;
      const mid = dw.window.at * len;
      const d = openingDims({ kind: 'window', ...dw.window });
      piece(0, mid - w / 2, 0, WALL_H);
      piece(mid + w / 2, len, 0, WALL_H);
      piece(mid - w / 2, mid + w / 2, 0, d.y0);
      piece(mid - w / 2, mid + w / 2, d.y0 + d.h, WALL_H);
      const center = new THREE.Vector3(A.x + dir.x * mid, fy + d.y0 + d.h / 2, A.y + dir.y * mid);
      const normal = new THREE.Vector3(-dir.y, 0, dir.x);
      const sideA = roomAt(TMP.copy(center).addScaledVector(normal, -0.6).setY(fy + 0.2));
      const sideB = roomAt(TMP.copy(center).addScaledVector(normal, 0.6).setY(fy + 0.2));
      openings.push({
        id: openings.length, kind: 'window', label: `${FLOOR_LABEL[dw.floor]} ${sideA?.name ?? sideB?.name ?? 'Exterior'} Bay Window`, center, w, h: d.h, run: 'd', c: 0, normal,
        floor: dw.floor, floorY: fy, exterior: true, barricadeable: false, gap: 0, thickness: t,
        rooms: [sideA?.id ?? null, sideB?.id ?? null], barricadePanel: null, barricadeKind: 'none', barricadeGen: 0,
      });
    }
  }

  /* ------------------------------------------------------------- floors */
  for (const f of FLOORS) {
    const y1 = f.y;
    const y0 = f.y - (f.t ?? SLAB_T);
    if (f.tier === 'semi') {
      // one panel per piece around the holes: the pieces end exactly at a hatch / stairwell edge
      // (void cells of a single grid stop up to half a cell short and leave a crack to the floor below)
      for (const r of subtractRects(f.rect, [...(f.holes ?? []), ...(bands.get(f.y) ?? [])])) {
        destruction.add({ kind: 'floor_semi', min: [r.x0, y0, r.z0], max: [r.x1, y1, r.z1], nAx: 1, label: f.label ?? f.id, exterior: f.kind === 'roof' });
      }
      continue;
    }
    const color = f.kind === 'roof' ? PAL.roof : f.kind === 'wood' || f.kind === 'deck' ? PAL.woodFloor : f.y < -1 ? PAL.concreteDark : PAL.concrete;
    for (const r of subtractRects(f.rect, [...(f.holes ?? []), ...(bands.get(f.y) ?? [])])) addStatic([r.x0, y0, r.z0], [r.x1, y1, r.z1], color, f.kind === 'wood' || f.kind === 'deck' ? 'wood' : 'concrete', f.kind === 'roof' || f.kind === 'deck', PAL.concreteDark, 1);
  }
  for (const l of LANDINGS) addStatic([l.rect.x0, l.y - 0.25, l.rect.z0], [l.rect.x1, l.y, l.rect.z1], PAL.woodFloor, 'wood', false, PAL.woodDark, 1);
  for (const h of HATCHES) {
    const p = destruction.add({ kind: 'hatch', min: [h.rect.x0, h.y - SLAB_T, h.rect.z0], max: [h.rect.x1, h.y, h.rect.z1], nAx: 1, label: h.label, reinforceable: true, rooms: [h.below, h.above] });
    // lattice frame (stays) + recessed handle (goes with the hatch) — reads "this floor opens"
    const r = h.rect;
    const fr = new THREE.Color('#3b2f24');
    trim.box([r.x0 - 0.06, h.y - 0.02, r.z0 - 0.06], [r.x1 + 0.06, h.y + 0.012, r.z0], fr);
    trim.box([r.x0 - 0.06, h.y - 0.02, r.z1], [r.x1 + 0.06, h.y + 0.012, r.z1 + 0.06], fr);
    trim.box([r.x0 - 0.06, h.y - 0.02, r.z0], [r.x0, h.y + 0.012, r.z1], fr);
    trim.box([r.x1, h.y - 0.02, r.z0], [r.x1 + 0.06, h.y + 0.012, r.z1], fr);
    const d = new BoxBatch();
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    for (const k of [-0.25, 0, 0.25]) d.box([r.x0 + 0.04, h.y + 0.001, cz + k - 0.02], [r.x1 - 0.04, h.y + 0.006, cz + k + 0.02], PAL.woodDark);
    d.box([cx - 0.12, h.y + 0.001, r.z1 - 0.2], [cx + 0.12, h.y + 0.025, r.z1 - 0.16], PAL.metal);
    const hm = new THREE.Mesh(d.build(), vcMaterial());
    p.details.push(hm);
    destruction.group.add(hm);
  }

  /* ------------------------------------------------------------- roof, porch, decks */
  // the pitched roof: one convex solid per part, the hull is both the mesh and the collider
  for (const r of ROOFS) {
    const pts = roofPoints(r);
    roof.geom(new ConvexGeometry(pts.map((p) => new THREE.Vector3(...p))), new THREE.Matrix4(), PAL.roof);
    // (the eaves' slab: what lies on the 2F ceiling under the hull is hidden)
    roof.occlude([pts[0][0] + 0.05, pts[0][1], pts[0][2] + 0.05], [pts[2][0] - 0.05, pts[0][1] + 0.028, pts[2][2] - 0.05]);
    physics.addConvexHull(new Float32Array(pts.flat()), { kind: 'static', mat: 'concrete', exterior: true });
  }
  // chimney through the north-west wing's slope, up past its ridge
  {
    const cx = P(-6.4), cz = P(-6.75);
    addStatic([cx - 0.5, ROOF_Y - 0.1, cz - 0.45], [cx + 0.5, ROOF_Y + 2.4, cz + 0.45], new THREE.Color('#7a5446'), 'concrete', true);
  }
  // porch: posts, rail, steps (front = north)
  const porchZ = P(-6.85);
  for (const x of [-1.55, 1.3, 4.2]) addStatic([P(x) - 0.1, 0, porchZ - 0.1], [P(x) + 0.1, 3.2, porchZ + 0.1], PAL.solidExt, 'wood', true);
  // (the porch stands 1.2 m over the yard: rails along its open edges, the steps' gap in line with the door)
  for (const [x0, x1] of [[-1.6, -1.0], [1.2, 5.3]]) {
    trim.box([P(x0), 0.85, porchZ - 0.07], [P(x1) - (x1 > 5 ? 0.14 : 0), 0.95, porchZ + 0.07], PAL.solidExt);
    clip([P(x0), 0, porchZ - 0.07], [P(x1), 0.95, porchZ + 0.07]);
  }
  {
    const x = P(5.3) - 0.07, z1 = P(-5.15) - 0.15;
    trim.box([x - 0.07, 0.85, porchZ - 0.07], [x + 0.07, 0.95, z1], PAL.solidExt);
    addStatic([x - 0.07, 0, porchZ - 0.07], [x + 0.07, 0.85, porchZ + 0.07], PAL.solidExt, 'wood', true);
    clip([x - 0.07, 0, porchZ - 0.07], [x + 0.07, 0.95, z1]);
  }
  // back porch: posts under the kids' room overhang and along the south porch roof, steps down to the yard
  // (14 cm posts, set back 2 cm from the overhang's edge)
  for (const x of [-7.1, -4.3, -1.95]) addStatic([P(x) - 0.07, 0, P(6.6) - 0.16], [P(x) + 0.07, 3.2, P(6.6) - 0.02], PAL.solidExt, 'wood', true);
  for (const x of [0.3, 2.3, 4.35]) addStatic([P(x) - 0.07, 0, P(6.6) - 0.16], [P(x) + 0.07, 3.25, P(6.6) - 0.02], PAL.solidExt, 'wood', true);
  for (const r of DECK_STEPS) addStatic([r.x0, -0.7, r.z0], [r.x1, -0.18, r.z1], PAL.woodFloor, 'wood', true, PAL.woodDark, 1);
  // the porch roofs' fascia (a lip at the edge, low enough to step over, a hand-hold for rappel)
  for (const f of FLOORS.filter((q) => q.id === 'roof_porch_s')) trim.box([f.rect.x0 - 0.01, f.y - 0.3, f.rect.z1 - 0.04], [f.rect.x1 + 0.01, f.y + 0.06, f.rect.z1 + 0.01], PAL.solidExt);
  // NW basement stairs: guard rails on the pit walls round the stairwell (terrain.ts), piece by piece at the walls' tops;
  // open at the top of the flight (north) and against the House (storage W wall)
  {
    // one post per spot where pieces meet (from the lower piece's top to the higher one's rail), the rail between the posts
    const posts = new Map<string, [number, number, number, number]>();
    const post = (x: number, y: number, z: number) => {
      const k = `${x.toFixed(2)},${z.toFixed(2)}`;
      const p = posts.get(k);
      posts.set(k, p ? [x, Math.min(p[1], y), Math.max(p[2], y), z] : [x, y, y, z]);
    };
    for (const wall of NW_PIT_WALLS) {
      for (const { r, top } of rimPieces(wall)) {
        const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
        const c = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
        const a = alongX ? r.x0 : r.z0, b = alongX ? r.x1 : r.z1;
        const at = (u: number): [number, number] => (alongX ? [u, c] : [c, u]);
        trim.box(alongX ? [a + 0.025, top + 0.88, c - 0.03] : [c - 0.03, top + 0.88, a + 0.025], alongX ? [b - 0.025, top + 0.95, c + 0.03] : [c + 0.03, top + 0.95, b - 0.025], PAL.darkMetal);
        post(at(a)[0], top, at(a)[1]);
        post(at(b)[0], top, at(b)[1]);
        clip(alongX ? [a, top, c - 0.05] : [c - 0.05, top, a], alongX ? [b, top + 1.0, c + 0.05] : [c + 0.05, top + 1.0, b]);
      }
    }
    for (const [x, y0, y1, z] of posts.values()) trim.box([x - 0.025, y0, z - 0.025], [x + 0.025, y1 + 0.95, z + 0.025], PAL.darkMetal);
  }

  /* ------------------------------------------------------------- stairs */
  for (const s of STAIRS) buildStair(s);
  function buildStair(s: StairDef) {
    const r = s.rect;
    const along = s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
    const width = s.axis === 'x' ? r.z1 - r.z0 : r.x1 - r.x0;
    const rise = s.yMax - s.yMin;
    const steps = s.steps ?? Math.max(4, Math.round(Math.abs(rise) / 0.19));
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
  // banisters: turned balusters stop bodies but let sight & bullets through (spec: lobby stair rail = semi-transparent)
  // (one baluster per spot where two rails meet; the Z-running hand rails sit 4 mm lower, so the two at a corner don't
  // share their top and bottom)
  const balusters: [number, number, number][] = [];
  const rail = (x0: number, z0: number, x1: number, z1: number, y: number, h = 0.95) => {
    const dy = x1 - x0 < z1 - z0 ? -0.004 : 0;
    trim.box([x0, y + h - 0.07 + dy, z0], [x1, y + h + dy, z1], PAL.woodDark);
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(L / 0.16));
    for (let k = 0; k <= n; k++) {
      const px = x0 + ((x1 - x0) * k) / n;
      const pz = z0 + ((z1 - z0) * k) / n;
      if (balusters.some(([bx, by, bz]) => Math.abs(bx - px) < 0.05 && Math.abs(bz - pz) < 0.05 && by === y)) continue;
      balusters.push([px, y, pz]);
      trim.box([px - 0.022, y, pz - 0.022], [px + 0.022, y + h - 0.05, pz + 0.022], PAL.woodDark);
    }
    clip([x0 - 0.03, y, z0 - 0.03], [x1 + 0.03, y + h, z1 + 0.03]);
  };
  /** a banister up the open side of a flight (balusters on the treads, the hand rail along the pitch), and the clip that
   *  keeps bodies on the flight: one segment per tread, from its tread up past the rail */
  const banister = (s: StairDef, side: 0 | 1, h = 0.95) => {
    const r = s.rect;
    const along = s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
    const c = s.axis === 'x' ? (side ? r.z1 : r.z0) : side ? r.x1 : r.x0;
    const at = (u: number, y: number) => (s.axis === 'x' ? new THREE.Vector3(r.x0 + u, y, c) : new THREE.Vector3(c, y, r.z0 + u));
    const yAt = (u: number) => s.yMin + ((s.yMax - s.yMin) * u) / along;
    const steps = Math.max(4, Math.round(Math.abs(s.yMax - s.yMin) / 0.19));
    const tread = (i: number) => s.yMin + (s.yMax - s.yMin) * ((s.yMax > s.yMin ? i + 1 : i) / steps);
    for (let i = 0; i < steps; i++) {
      const u = ((i + 0.5) * along) / steps;
      const p = at(u, tread(i));
      trim.box([p.x - 0.022, p.y, p.z - 0.022], [p.x + 0.022, yAt(u) + h - 0.05, p.z + 0.022], PAL.woodDark);
      const a = at((i * along) / steps, 0), b = at(((i + 1) * along) / steps, 0);
      const lo = Math.min(yAt((i * along) / steps), yAt(((i + 1) * along) / steps));
      clip([Math.min(a.x, b.x) - 0.03, lo, Math.min(a.z, b.z) - 0.03], [Math.max(a.x, b.x) + 0.03, lo + Math.abs(s.yMax - s.yMin) / steps + h, Math.max(a.z, b.z) + 0.03]);
    }
    const L = Math.hypot(along, s.yMax - s.yMin);
    const theta = Math.atan2(s.yMax - s.yMin, along);
    const q = s.axis === 'x' ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -theta);
    const m = new THREE.Matrix4().compose(at(along / 2, (s.yMin + s.yMax) / 2 + h - 0.035), q, new THREE.Vector3(1, 1, 1));
    if (s.axis === 'x') trim.tbox(m, L, 0.07, 0.05, PAL.woodDark);
    else trim.tbox(m, 0.05, 0.07, L, PAL.woodDark);
  };
  /** nobody crawls under a flight where it is lower than a body: a clip under each tread, its top under the walking surface */
  const underFlight = (s: StairDef, headroom = 2.0) => {
    const r = s.rect;
    const along = s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
    const steps = Math.max(4, Math.round(Math.abs(s.yMax - s.yMin) / 0.19));
    const fy = Math.min(s.yMin, s.yMax);
    const yAt = (u: number) => s.yMin + ((s.yMax - s.yMin) * u) / along;
    for (let i = 0; i < steps; i++) {
      const u0 = (i * along) / steps, u1 = ((i + 1) * along) / steps;
      const top = Math.min(yAt(u0), yAt(u1)) - 0.24; // under the step block and the ramp under the tread's lower edge
      if (top - fy < 0.1 || top - fy > headroom) continue;
      if (s.axis === 'x') clip([r.x0 + u0, fy, r.z0], [r.x0 + u1, top, r.z1]);
      else clip([r.x0, fy, r.z0 + u0], [r.x1, top, r.z0 + u1]);
    }
  };
  // lobby stairs: banisters on the open sides of the L, the gallery round the well on 2F, nothing to crawl under
  {
    const a = STAIRS.find((s) => s.id === 'stairs_main_a')!, b = STAIRS.find((s) => s.id === 'stairs_main_b')!;
    banister(a, 1); // flight a's south side, over the lobby
    banister(b, 0); // flight b's west side
    underFlight(a);
    underFlight(b);
    const l = MAIN_LANDING;
    clip([l.x0, 0, l.z0], [l.x1, 1.4 - 0.27, l.z1]); // under the landing
    // newel posts: the foot of the L, its turn, the head on 2F
    for (const [x, z, top] of [[a.rect.x0, a.rect.z1, 1.0], [b.rect.x0, b.rect.z0, 1.4 + 1.0], [b.rect.x0, b.rect.z1, 3.5 + 1.0]]) {
      trim.box([x - 0.045, 0, z - 0.045], [x + 0.045, top, z + 0.045], PAL.woodDark);
    }
    // (rails 1.5 cm inside the well's edge, 2 cm thick)
    const w = STAIR_HOLES.main;
    const zN = w.z0 + 0.015, xW = w.x0 + 0.015, zS = w.z1 - 0.015;
    rail(w.x0, zN - 0.01, w.x1 - 0.1, zN + 0.01, 3.5); // along the strip by the front wall, up to the workshop wall's face
    rail(xW - 0.01, w.z0, xW + 0.01, w.z1, 3.5); // west
    rail(w.x0, zS - 0.01, b.rect.x0, zS + 0.01, 3.5); // south, up to where flight b arrives
  }
  // back stairs: the wall between the climbing and the descending half of the switchback, B floor to a parapet on 2F
  addStatic([P(-7.95), FLOOR_Y[-1], P(2.25) - 0.06], [P(-5.5), FLOOR_Y[1] + 1.0, P(2.25) + 0.06], PAL.solidWall, 'concrete', false, PAL.solidWall, 1);

  /* ------------------------------------------------------------- props */
  const propBatch = new BoxBatch();
  for (const p of PROPS) buildProp(p);
  function buildProp(p: PropDef) {
    const fy = FLOOR_Y[p.floor] + (p.lift ?? 0);
    const [sx, sy, sz] = p.size;
    const c = new THREE.Color(p.color);
    const dark = c.clone().multiplyScalar(0.6);
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.25);
    // rot90: the model is authored with its long axis along local Z; lay it along world X
    // every visible box is also its collider: bullets, sight and bodies stop exactly where the model is
    const parts: [number[], number[]][] = [];
    const drawn: [number[], number[], THREE.Color][] = [];
    const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col = c) => {
      const mn = p.rot90 ? [p.x + Math.min(z0, z1), fy + y0, p.z + Math.min(-x0, -x1)] : [p.x + x0, fy + y0, p.z + z0];
      const mx = p.rot90 ? [p.x + Math.max(z0, z1), fy + y1, p.z + Math.max(-x0, -x1)] : [p.x + x1, fy + y1, p.z + z1];
      drawn.push([[...mn], [...mx], col]);
      parts.push([mn, mx]);
    };
    model();
    for (const [mn, mx, col] of apart(drawn)) propBatch.box(mn, mx, col);
    if (p.style === 'shower' || p.style === 'cylinder') return; // their own colliders
    if (sy <= 0.08) return; // rugs and mats: walked over, shot through
    for (const [mn, mx] of parts) {
      // decals (head lights, stencil bands, handles) are part of the box they sit on
      if (Math.min(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) < 0.025) continue;
      physics.addBox((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, (mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2, { kind: 'static', mat: p.mat });
    }
    function model() {
    const hx = (p.rot90 ? sz : sx) / 2, hz = (p.rot90 ? sx : sz) / 2;
    switch (p.style) {
      case 'sofa': {
        const backZ = sz > sx; // long axis along z → back on the x side
        B(-hx, 0.1, -hz, hx, 0.45, hz);
        if (backZ) { B(-hx, 0.45, -hz, -hx + 0.22, sy, hz, dark); B(-hx, 0.45, -hz, hx, 0.65, -hz + 0.2, dark); B(-hx, 0.45, hz - 0.2, hx, 0.65, hz, dark); }
        else { B(-hx, 0.45, hz - 0.22, hx, sy, hz, dark); B(-hx, 0.45, -hz, -hx + 0.2, 0.65, hz, dark); B(hx - 0.2, 0.45, -hz, hx, 0.65, hz, dark); }
        B(-hx + 0.22, 0.45, -hz + 0.2, hx - 0.22, 0.58, hz - 0.22, light);
        break;
      }
      case 'bed':
        B(-hx, 0.0, -hz, hx, 0.3, hz, new THREE.Color('#4f3a26')); B(-hx + 0.05, 0.3, -hz + 0.05, hx - 0.05, sy, hz - 0.05, light);
        B(-hx, 0, -hz, hx, 1.05, -hz + 0.08, new THREE.Color('#4f3a26')); B(-hx + 0.15, sy, -hz + 0.1, hx - 0.15, sy + 0.12, -hz + 0.5, new THREE.Color('#e8e4da'));
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
        B(-hx, 0, -hz, hx, sy, -hz + 0.1, c); B(-hx, 0, -hz, -hx + 0.1, sy, hz, c); B(hx - 0.1, 0, -hz, hx, sy, hz, c);
        trim.box([p.x - hx + 0.1, fy + 1.0, p.z + hz - 0.02], [p.x + hx - 0.1, fy + sy, p.z + hz], new THREE.Color('#bcd6dd'));
        // the booth partitions are bulletproof: three solid colliders, open front
        physics.addBox(p.x, fy + sy / 2, p.z - hz + 0.05, hx, sy / 2, 0.05, { kind: 'static', mat: 'concrete' });
        physics.addBox(p.x - hx + 0.05, fy + sy / 2, p.z, 0.05, sy / 2, hz, { kind: 'static', mat: 'concrete' });
        physics.addBox(p.x + hx - 0.05, fy + sy / 2, p.z, 0.05, sy / 2, hz, { kind: 'static', mat: 'concrete' });
        return;
      case 'tub':
        B(-hx, 0, -hz, hx, sy, hz, c); B(-hx + 0.08, 0.2, -hz + 0.08, hx - 0.08, sy + 0.001, hz - 0.08, new THREE.Color('#bcd6dd'));
        break;
      case 'bunk':
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(lx * hx - 0.04, 0, lz * hz - 0.04, lx * hx + 0.04, sy, lz * hz + 0.04, dark);
        B(-hx, 0.25, -hz, hx, 0.45, hz, new THREE.Color('#d8d2c2'));
        for (let k = 0; k <= 8; k++) { const x = -hx + (sx * k) / 8; B(x - 0.015, 0.45, -hz, x + 0.015, sy, -hz + 0.03, c); B(x - 0.015, 0.45, hz - 0.03, x + 0.015, sy, hz, c); }
        break;
      case 'bag':
        B(-hx * 0.8, 0, -hz * 0.8, hx * 0.8, sy, hz * 0.8, c); trim.box([p.x - 0.01, fy + sy, p.z - 0.01], [p.x + 0.01, FLOOR_Y[p.floor] + WALL_H, p.z + 0.01], PAL.darkMetal);
        break;
      case 'pillar':
        B(-hx, 0, -hz, hx, sy, hz, c);
        B(-hx - 0.04, sy - 0.25, -hz - 0.04, hx + 0.04, sy, hz + 0.04, dark);
        break;
      case 'cylinder':
        propBatch.geom(new THREE.CylinderGeometry(hx, hx, sy, 10), new THREE.Matrix4().makeTranslation(p.x, fy + sy / 2, p.z), c);
        physics.addCylinder(p.x, fy + sy / 2, p.z, sy / 2, hx, { kind: 'static', mat: p.mat });
        return;
      case 'chair':
        B(-hx, 0, -hz, hx, sy * 0.48, hz, c); B(-hx, sy * 0.48, hz - 0.08, hx, sy, hz, dark);
        break;
      case 'bench':
        B(-hx, sy - 0.08, -hz, hx, sy, hz, c); B(-hx + 0.05, 0, -hz + 0.05, hx - 0.05, sy - 0.08, hz - 0.05, dark);
        break;
      case 'ammo':
        B(-hx, 0, -hz, hx, sy, hz, c);
        B(-hx - 0.01, sy * 0.3, -hz - 0.01, hx + 0.01, sy * 0.36, hz + 0.01, dark);
        B(-hx * 0.5, sy, -hz * 0.5, hx * 0.5, sy + 0.02, hz * 0.5, new THREE.Color('#d9b23a'));
        // stencil-ish yellow band so you can spot it across a room
        B(-hx - 0.012, sy * 0.55, -hz * 0.6, hx + 0.012, sy * 0.75, hz * 0.6, new THREE.Color('#d9b23a'));
        break;
      default:
        B(-hx, 0, -hz, hx, sy, hz, c);
        if (p.style === 'appliance') B(-hx + 0.05, sy * 0.55, -hz - 0.005, hx - 0.05, sy * 0.58, -hz, dark);
        if (p.style === 'box') B(-hx - 0.005, sy * 0.45, -hz - 0.005, hx + 0.005, sy * 0.55, hz + 0.005, new THREE.Color('#c8b28a'));
    }
    }
  }
  /**
   * Boxes of one model that overlap and share a face plane on the same side (a shelf board through an upright, a band
   * round a crate) flicker there: the smaller one is pulled 2 mm in on that side. Colliders keep the authored sizes.
   */
  function apart(bs: [number[], number[], THREE.Color][]) {
    const vol = (b: [number[], number[], unknown]) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]) * (b[1][2] - b[0][2]);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const [a, b] = vol(bs[i]) < vol(bs[j]) ? [bs[j], bs[i]] : [bs[i], bs[j]];
          if (![0, 1, 2].every((k) => Math.min(a[1][k], b[1][k]) - Math.max(a[0][k], b[0][k]) > 1e-4)) continue;
          for (let k = 0; k < 3; k++) {
            if (Math.abs(a[0][k] - b[0][k]) < 1e-4) b[0][k] += 0.002;
            if (Math.abs(a[1][k] - b[1][k]) < 1e-4) b[1][k] -= 0.002;
          }
        }
      }
    }
    return bs;
  }

  /* ------------------------------------------------------------- CCTV cameras */
  for (const cdef of CCTVS) {
    const g = new BoxBatch();
    const body = new THREE.Color('#d9d9d4');
    g.box([-0.07, -0.07, -0.18], [0.07, 0.07, 0.12], body);
    g.box([-0.05, -0.05, -0.2], [0.05, 0.05, -0.18], new THREE.Color('#111'));
    g.box([-0.02, 0.07, -0.02], [0.02, 0.2, 0.02], PAL.darkMetal);
    const mesh = new THREE.Mesh(g.build(), vcMaterial());
    // (an exterior camera's y is its height over the ground: its pole stands on the terrain)
    const pos = new THREE.Vector3(...cdef.pos);
    if (cdef.exterior) pos.y += terrainY(pos.x, pos.z);
    mesh.position.copy(pos);
    mesh.rotation.y = cdef.yaw;
    mesh.rotation.x = -0.35;
    mesh.castShadow = true;
    scene.add(mesh);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }));
    led.position.set(0.04, 0.03, -0.19);
    mesh.add(led);
    if (cdef.exterior) {
      // pole
      addStatic([pos.x - 0.07, pos.y - cdef.pos[1], pos.z - 0.07], [pos.x + 0.07, pos.y + 0.2, pos.z + 0.07], PAL.darkMetal, 'metal', true);
    }
    const collider = physics.addBox(pos.x, pos.y, pos.z, 0.09, 0.09, 0.16, { kind: 'gadget', gadgetId: `cctv:${cdef.id}` });
    cameras.push({ id: cdef.id, label: cdef.label, pos, yaw: cdef.yaw, exterior: cdef.exterior, mesh, alive: true, collider });
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
  trimMesh.name = 'house_trim';
  const roofMesh = new THREE.Mesh(roof.build(), vcMaterial());
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  roofMesh.name = 'house_roof';
  scene.add(roofMesh);
  const propMesh = new THREE.Mesh(propBatch.build(), vcMaterial());
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  propMesh.name = 'house_props';
  scene.add(statMesh, trimMesh, propMesh, destruction.group);

  return { openings, stairs: STAIRS, lamps, props: PROPS, wallPanels, cameras, roomAt, locationName, floorOf };
}
