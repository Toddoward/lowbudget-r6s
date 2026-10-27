import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BoxBatch } from './BoxBatch.ts';
import { PAL, TIER_XRAY, patchInterior, vcMaterial } from '../render/palette.ts';

/** soft walls: drawn just in front of coplanar hard walls (rule 2: polygonOffset −1 / −2) */
let softMat: THREE.MeshStandardMaterial | null = null;
const SOFT_WALL_MAT = () => (softMat ??= patchInterior(Object.assign(vcMaterial().clone(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
/** hatches: in front of the slab around them (rule 3: polygonOffsetFactor −3) */
let hatchMat: THREE.MeshStandardMaterial | null = null;
const HATCH_MAT = () => (hatchMat ??= patchInterior(Object.assign(vcMaterial().clone(), { polygonOffset: true, polygonOffsetFactor: -3 })));
import type { Physics, SurfaceMaterial } from '../core/Physics.ts';
import { CELL } from '../map/houseLayout.ts';

/**
 * Real-time level destruction.
 *
 * Every breakable surface is a `Panel`: an axis-aligned slab subdivided into a
 * (nu × nv) grid of ~0.25 m cells across its face (u, v axes) with thickness
 * along n. Each cell has a *skin* (plaster / boards / plating, has HP) and may
 * carry a *beam* (wood stud / joist / steel) that never breaks:
 *
 *   soft  : no beams                 → holes become passable
 *   semi  : beam every 3rd column    → 0.5 m gaps: sight + bullets pass, bodies don't
 *   hatch / barricade / castle / shutter : special HP rules
 *
 * After damage a panel is marked dirty and, once per frame, intact skin cells
 * and exposed beams are greedy-merged into rectangles that become BOTH the
 * render boxes and the Rapier cuboid colliders — so what you see is exactly
 * what bullets, eyes (bot FOV raycasts / WebMCP vision) and bodies collide with.
 *
 * Damage is expressed as (panelId, cellIndices[], dmg) and HP subtraction is
 * commutative, so the multiplayer event log converges regardless of ordering.
 */
export type PanelKind = 'wall_soft' | 'wall_semi' | 'floor_semi' | 'hatch' | 'barricade' | 'castle' | 'shutter';
export type ImpactKind = 'bullet' | 'melee' | 'sledge' | 'breach' | 'ash' | 'thermite' | 'frag' | 'swing' | 'cluster';

/** impacts that take soft-wall studs and hatch joists down with the skin */
const HEAVY = new Set<ImpactKind>(['breach', 'thermite', 'sledge', 'ash', 'cluster', 'frag']);

const F_BROKEN = 1;
const F_BEAM = 2;
const F_VOID = 4;

interface KindProps {
  hp: number;
  beamEvery: number;
  mat: SurfaceMaterial;
  face: THREE.Color;
  core: THREE.Color;
  xray: THREE.Color;
  /** fraction of broken cells that makes the remaining skin collapse */
  collapse: number;
  penetrable: boolean;
}
const PROPS: Record<PanelKind, KindProps> = {
  // soft: plaster on a wooden stud frame (stud every 50 cm + top / bottom plates) — punches and bullets open the
  // plaster, the frame stops bodies (not bullets); only heavy hits (explosives, sledge, shotgun, breach) take it down
  wall_soft: { hp: 3, beamEvery: 2, mat: 'plaster', face: PAL.softWall, core: PAL.softCore, xray: TIER_XRAY.soft, collapse: 2, penetrable: true },
  // semi: a thin stud / joist in every 25 cm column — eyes, bullets and grenades pass, bodies never do
  wall_semi: { hp: 3, beamEvery: 1, mat: 'wood', face: PAL.semiWall, core: PAL.semiCore, xray: TIER_XRAY.semi, collapse: 2, penetrable: true },
  floor_semi: { hp: 3, beamEvery: 1, mat: 'wood', face: PAL.woodFloor, core: PAL.semiCore, xray: TIER_XRAY.semi, collapse: 2, penetrable: true },
  // hatch: boards on joists — same rule as soft walls
  hatch: { hp: 6, beamEvery: 2, mat: 'wood', face: PAL.hatch, core: PAL.woodDark, xray: TIER_XRAY.soft, collapse: 0.6, penetrable: true },
  barricade: { hp: 1, beamEvery: 0, mat: 'wood', face: PAL.barricade, core: PAL.woodDark, xray: TIER_XRAY.soft, collapse: 0.45, penetrable: true },
  castle: { hp: 8, beamEvery: 0, mat: 'metal', face: PAL.castle, core: PAL.darkMetal, xray: TIER_XRAY.solid, collapse: 2, penetrable: false },
  shutter: { hp: 4, beamEvery: 0, mat: 'metal', face: PAL.shutter, core: PAL.darkMetal, xray: TIER_XRAY.soft, collapse: 0.7, penetrable: true },
};

export interface PanelSpec {
  kind: PanelKind;
  min: [number, number, number];
  max: [number, number, number];
  /** axis of thickness */
  nAx: 0 | 1 | 2;
  label: string;
  exterior?: boolean;
  /** world-space rects (in u/v plane coordinates) that are permanently void */
  voids?: { u0: number; v0: number; u1: number; v1: number }[];
  openingId?: number;
  reinforceable?: boolean;
  /** room ids on the two sides (for nav breach edges / WebMCP labels) */
  rooms?: [string | null, string | null];
}

export class Panel {
  readonly id: number;
  readonly kind: PanelKind;
  readonly label: string;
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
  readonly nAx: 0 | 1 | 2;
  readonly uAx: 0 | 1 | 2;
  readonly vAx: 0 | 1 | 2;
  readonly nu: number;
  readonly nv: number;
  readonly cu: number;
  readonly cv: number;
  readonly exterior: boolean;
  readonly openingId?: number;
  readonly reinforceable: boolean;
  readonly rooms: [string | null, string | null];
  readonly props: KindProps;
  readonly state: Uint8Array;
  readonly hp: Float32Array;
  reinforced = false;
  /** a reinforced wall that Thermite burnt open can never be reinforced again */
  thermited = false;
  /** visual details that live and die with the panel (baseboard, hatch handle) */
  details: THREE.Object3D[] = [];
  /** Bandit batteries attached */
  electrified = 0;
  destroyed = false;
  passable = false;
  brokenCount = 0;
  dirty = true;
  mesh: THREE.Mesh;
  colliders: RAPIER.Collider[] = [];
  /** the panel's frame as built (restored with the skin) */
  private frameMask: Uint8Array;
  /** soft walls and hatches lose their frame to heavy hits; semi walls / floors keep theirs */
  get frameBreakable() { return this.kind === 'wall_soft' || this.kind === 'hatch'; }
  private totalSkin = 0;

  constructor(id: number, spec: PanelSpec) {
    this.id = id;
    this.kind = spec.kind;
    this.label = spec.label;
    this.min = new THREE.Vector3(...spec.min);
    this.max = new THREE.Vector3(...spec.max);
    this.nAx = spec.nAx;
    // walls: u = horizontal run, v = y ; floors: u = x, v = z
    if (spec.nAx === 1) { this.uAx = 0; this.vAx = 2; } else { this.uAx = spec.nAx === 0 ? 2 : 0; this.vAx = 1; }
    this.exterior = !!spec.exterior;
    this.openingId = spec.openingId;
    this.reinforceable = !!spec.reinforceable;
    this.rooms = spec.rooms ?? [null, null];
    this.props = PROPS[spec.kind];
    const su = this.size(this.uAx);
    const sv = this.size(this.vAx);
    this.nu = Math.max(1, Math.round(su / CELL));
    this.nv = Math.max(1, Math.round(sv / CELL));
    this.cu = su / this.nu;
    this.cv = sv / this.nv;
    this.state = new Uint8Array(this.nu * this.nv);
    this.hp = new Float32Array(this.nu * this.nv).fill(this.props.hp);
    const be = this.props.beamEvery;
    for (let v = 0; v < this.nv; v++) {
      for (let u = 0; u < this.nu; u++) {
        const i = v * this.nu + u;
        if (be > 0) {
          const edge = u === 0 || u === this.nu - 1 || (spec.nAx !== 1 && (v === 0 || v === this.nv - 1));
          if (edge || u % be === (be === 1 ? 0 : 1)) this.state[i] |= F_BEAM;
        }
        if (spec.voids) {
          const cu = this.min.getComponent(this.uAx) + (u + 0.5) * this.cu;
          const cv = this.min.getComponent(this.vAx) + (v + 0.5) * this.cv;
          for (const r of spec.voids) if (cu > r.u0 && cu < r.u1 && cv > r.v0 && cv < r.v1) { this.state[i] = F_VOID | F_BROKEN; }
        }
      }
    }
    for (let i = 0; i < this.state.length; i++) if (!(this.state[i] & F_VOID)) this.totalSkin++;
    this.frameMask = this.state.map((s) => s & F_BEAM);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), spec.kind === 'wall_soft' ? SOFT_WALL_MAT() : spec.kind === 'hatch' ? HATCH_MAT() : vcMaterial());
    // Z-fighting rule 3 (visual only; colliders keep the true size): hatches stick out 0.015 m above and below the slab they
    // sit in. Soft walls are drawn at their true size — walls meet edge to edge and stop at the slabs, nothing coplanar overlaps.
    const midY = (this.min.y + this.max.y) / 2;
    const sy = spec.kind === 'hatch' ? (this.size(1) + 0.03) / this.size(1) : 1;
    if (sy !== 1) { this.mesh.scale.y = sy; this.mesh.position.y = midY * (1 - sy); }
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.panelId = id;
  }

  size(ax: number) { return this.max.getComponent(ax) - this.min.getComponent(ax); }
  get thickness() { return this.size(this.nAx); }
  get center() { return new THREE.Vector3().addVectors(this.min, this.max).multiplyScalar(0.5); }
  get isWall() { return this.nAx !== 1; }
  get tier(): 'soft' | 'semi' | 'solid' {
    if (this.reinforced || this.kind === 'castle') return 'solid';
    return this.props.beamEvery > 0 ? 'semi' : 'soft';
  }
  get brokenFraction() { return this.totalSkin ? this.brokenCount / this.totalSkin : 0; }

  cellCenter(i: number, out = new THREE.Vector3()) {
    const u = i % this.nu;
    const v = Math.floor(i / this.nu);
    out.setComponent(this.uAx, this.min.getComponent(this.uAx) + (u + 0.5) * this.cu);
    out.setComponent(this.vAx, this.min.getComponent(this.vAx) + (v + 0.5) * this.cv);
    out.setComponent(this.nAx, (this.min.getComponent(this.nAx) + this.max.getComponent(this.nAx)) / 2);
    return out;
  }

  cellAt(p: THREE.Vector3): number {
    const u = THREE.MathUtils.clamp(Math.floor((p.getComponent(this.uAx) - this.min.getComponent(this.uAx)) / this.cu), 0, this.nu - 1);
    const v = THREE.MathUtils.clamp(Math.floor((p.getComponent(this.vAx) - this.min.getComponent(this.vAx)) / this.cv), 0, this.nv - 1);
    return v * this.nu + u;
  }

  isSkinIntact(i: number) { return !(this.state[i] & F_BROKEN); }
  isSolidCell(i: number) { return !(this.state[i] & F_BROKEN) || !!(this.state[i] & F_BEAM); }

  /** all live (unbroken, non-void) cell indices */
  liveCells(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.state.length; i++) if (!(this.state[i] & F_BROKEN)) out.push(i);
    return out;
  }

  /** cells in a sphere with skin left (or, with `frames`, also bare frame) */
  cellsInSphere(c: THREE.Vector3, r: number, frames = false): number[] {
    const dn = c.getComponent(this.nAx) - THREE.MathUtils.clamp(c.getComponent(this.nAx), this.min.getComponent(this.nAx), this.max.getComponent(this.nAx));
    if (Math.abs(dn) > r) return [];
    const rr = Math.sqrt(r * r - dn * dn);
    const cu = c.getComponent(this.uAx) - this.min.getComponent(this.uAx);
    const cv = c.getComponent(this.vAx) - this.min.getComponent(this.vAx);
    const u0 = Math.max(0, Math.floor((cu - rr) / this.cu));
    const u1 = Math.min(this.nu - 1, Math.floor((cu + rr) / this.cu));
    const v0 = Math.max(0, Math.floor((cv - rr) / this.cv));
    const v1 = Math.min(this.nv - 1, Math.floor((cv + rr) / this.cv));
    const out: number[] = [];
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        const du = (u + 0.5) * this.cu - cu;
        const dv = (v + 0.5) * this.cv - cv;
        if (du * du + dv * dv <= rr * rr) {
          const i = v * this.nu + u;
          if (!(this.state[i] & F_BROKEN) || (frames && this.state[i] & F_BEAM)) out.push(i);
        }
      }
    }
    return out;
  }

  /** cells whose centre lies in a (u,v) world-space rectangle */
  cellsInRect(u0w: number, v0w: number, u1w: number, v1w: number, frames = false): number[] {
    const out: number[] = [];
    const bu = this.min.getComponent(this.uAx);
    const bv = this.min.getComponent(this.vAx);
    for (let v = 0; v < this.nv; v++) {
      const cv = bv + (v + 0.5) * this.cv;
      if (cv < v0w || cv > v1w) continue;
      for (let u = 0; u < this.nu; u++) {
        const cu = bu + (u + 0.5) * this.cu;
        if (cu < u0w || cu > u1w) continue;
        const i = v * this.nu + u;
        if (!(this.state[i] & F_BROKEN) || (frames && this.state[i] & F_BEAM)) out.push(i);
      }
    }
    return out;
  }

  /** every cell with skin or frame left */
  standingCells(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.state.length; i++) if (!(this.state[i] & F_BROKEN) || this.state[i] & F_BEAM) out.push(i);
    return out;
  }

  /** heavy hit: the frame goes where the skin is gone (soft walls, hatches) */
  breakFrame(cells: number[]): number[] {
    if (!this.frameBreakable) return [];
    const out: number[] = [];
    for (const i of cells) {
      if (i < 0 || i >= this.state.length || !(this.state[i] & F_BROKEN) || !(this.state[i] & F_BEAM)) continue;
      this.state[i] &= ~F_BEAM;
      out.push(i);
    }
    if (out.length) this.dirty = true;
    return out;
  }

  /** Apply HP damage. Returns indices that broke in this call (for debris FX). */
  applyDamage(cells: number[], dmg: number): number[] {
    const broke: number[] = [];
    for (const i of cells) {
      if (i < 0 || i >= this.state.length || this.state[i] & F_BROKEN) continue;
      this.hp[i] -= dmg;
      if (this.hp[i] <= 0.0001) {
        this.state[i] |= F_BROKEN;
        this.brokenCount++;
        broke.push(i);
      }
    }
    if (broke.length) {
      // only Thermite can hurt steel: once it has, this section is lost for good (spec #15)
      if (this.reinforced) this.thermited = true;
      if (this.brokenFraction >= this.props.collapse) {
        for (let i = 0; i < this.state.length; i++) {
          if (!(this.state[i] & F_BROKEN)) { this.state[i] |= F_BROKEN; this.brokenCount++; broke.push(i); }
        }
      }
      if (this.brokenCount >= this.totalSkin) this.destroyed = true;
      this.dirty = true;
    }
    return broke;
  }

  /** Rebuild render mesh + colliders from the cell grid (greedy rectangle merge). */
  rebuild(physics: Physics, xray: boolean) {
    this.dirty = false;
    for (const c of this.colliders) physics.remove(c);
    this.colliders = [];
    const skin = new Uint8Array(this.state.length);
    const beams = new Uint8Array(this.state.length);
    for (let i = 0; i < this.state.length; i++) {
      const s = this.state[i];
      if (!(s & F_BROKEN)) skin[i] = 1;
      else if (s & F_BEAM) beams[i] = 1;
    }
    const batch = new BoxBatch();
    const face = xray ? this.props.xray : this.reinforced ? PAL.reinforced : this.props.face;
    const core = this.reinforced ? PAL.darkMetal : this.props.core;
    const grow = this.reinforced ? 0.03 : 0;
    const n0 = this.min.getComponent(this.nAx);
    const n1 = this.max.getComponent(this.nAx);
    const emit = (rects: number[][], inset: number, fc: THREE.Color, sc: THREE.Color) => {
      for (const [u0, v0, u1, v1] of rects) {
        const mn = new THREE.Vector3();
        const mx = new THREE.Vector3();
        mn.setComponent(this.uAx, this.min.getComponent(this.uAx) + u0 * this.cu);
        mx.setComponent(this.uAx, this.min.getComponent(this.uAx) + u1 * this.cu);
        mn.setComponent(this.vAx, this.min.getComponent(this.vAx) + v0 * this.cv);
        mx.setComponent(this.vAx, this.min.getComponent(this.vAx) + v1 * this.cv);
        mn.setComponent(this.nAx, n0 + inset - grow);
        mx.setComponent(this.nAx, n1 - inset + grow);
        batch.box(mn.toArray(), mx.toArray(), fc, sc, this.nAx);
        const c = mn.clone().add(mx).multiplyScalar(0.5);
        const h = mx.clone().sub(mn).multiplyScalar(0.5);
        this.colliders.push(physics.addBox(c.x, c.y, c.z, h.x, h.y, h.z, { kind: 'panel', panelId: this.id }));
      }
    };
    emit(greedy(skin, this.nu, this.nv), 0, face, core);
    const t = this.thickness;
    // plates (wall top/bottom rows, floor rim columns) stay full width; studs / joists are thin members
    const plates = new Uint8Array(this.state.length);
    const studs = new Uint8Array(this.state.length);
    for (let i = 0; i < beams.length; i++) {
      if (!beams[i]) continue;
      const u = i % this.nu;
      const v = Math.floor(i / this.nu);
      const plate = this.isWall ? v === 0 || v === this.nv - 1 : u === 0 || u === this.nu - 1;
      if (plate) plates[i] = 1; else studs[i] = 1;
    }
    emit(greedy(plates, this.nu, this.nv), t * 0.18, PAL.stud, PAL.stud);
    const STUD_W = 0.06;
    for (let u = 0; u < this.nu; u++) {
      let v = 0;
      while (v < this.nv) {
        if (!studs[v * this.nu + u]) { v++; continue; }
        let v1 = v;
        while (v1 < this.nv && studs[v1 * this.nu + u]) v1++;
        const mn = new THREE.Vector3();
        const mx = new THREE.Vector3();
        const cu = this.min.getComponent(this.uAx) + (u + 0.5) * this.cu;
        mn.setComponent(this.uAx, cu - STUD_W / 2);
        mx.setComponent(this.uAx, cu + STUD_W / 2);
        mn.setComponent(this.vAx, this.min.getComponent(this.vAx) + v * this.cv);
        mx.setComponent(this.vAx, this.min.getComponent(this.vAx) + v1 * this.cv);
        mn.setComponent(this.nAx, n0 + t * 0.15);
        mx.setComponent(this.nAx, n1 - t * 0.15);
        batch.box(mn.toArray(), mx.toArray(), PAL.stud, PAL.studDark, this.uAx);
        const c = mn.clone().add(mx).multiplyScalar(0.5);
        const h = mx.clone().sub(mn).multiplyScalar(0.5);
        this.colliders.push(physics.addBox(c.x, c.y, c.z, h.x, h.y, h.z, { kind: 'panel', panelId: this.id }));
        v = v1;
      }
    }
    batch.build(this.mesh.geometry);
    this.mesh.visible = !batch.empty;
    const intact = this.brokenFraction < 0.5;
    for (const d of this.details) d.visible = intact && !this.reinforced;
    this.passable = this.computePassable();
  }

  /** Can a body pass? walls: ≥0.75 m wide × 1.75 m tall clear window from the bottom; floors: 0.75 m square hole. */
  private computePassable(): boolean {
    const solid = (u: number, v: number) => this.isSolidCell(v * this.nu + u);
    const needU = Math.ceil(0.7 / this.cu);
    const needV = this.isWall ? Math.min(this.nv, Math.ceil(1.7 / this.cv)) : Math.ceil(0.7 / this.cv);
    // walls: the hole may start above a low lip the character controller steps over (autostep 0.36 m)
    const lip = Math.floor(0.3 / this.cv);
    const rowsFrom = this.isWall ? Array.from({ length: lip + 1 }, (_, i) => i) : Array.from({ length: Math.max(1, this.nv - needV + 1) }, (_, i) => i);
    for (const vs of rowsFrom) {
      let run = 0;
      for (let u = 0; u < this.nu; u++) {
        let clear = true;
        for (let v = vs; v < vs + needV && v < this.nv; v++) if (solid(u, v)) { clear = false; break; }
        run = clear ? run + 1 : 0;
        if (run >= needU) return true;
      }
    }
    return false;
  }

  /** Restore all non-void skin (used when a barricade is re-placed). */
  resetSkin() {
    this.thermited = false;
    for (let i = 0; i < this.state.length; i++) {
      if (this.state[i] & F_VOID) continue;
      this.state[i] = (this.state[i] & ~F_BROKEN & ~F_BEAM) | this.frameMask[i];
      this.hp[i] = this.props.hp;
    }
    this.brokenCount = 0;
    this.destroyed = false;
    this.dirty = true;
  }
}

/** Greedy merge of a binary grid into [u0, v0, u1, v1] rectangles (exclusive max). */
export function greedy(grid: Uint8Array, nu: number, nv: number): number[][] {
  const used = new Uint8Array(grid.length);
  const out: number[][] = [];
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const i = v * nu + u;
      if (!grid[i] || used[i]) continue;
      let w = 1;
      while (u + w < nu && grid[i + w] && !used[i + w]) w++;
      let h = 1;
      outer: while (v + h < nv) {
        for (let k = 0; k < w; k++) {
          const j = (v + h) * nu + u + k;
          if (!grid[j] || used[j]) break outer;
        }
        h++;
      }
      for (let dv = 0; dv < h; dv++) for (let k = 0; k < w; k++) used[(v + dv) * nu + u + k] = 1;
      out.push([u, v, u + w, v + h]);
    }
  }
  return out;
}

/** `frame`: a heavy hit (explosive, sledge, shotgun, breach) that also takes out the studs / joists of soft walls and hatches */
export interface CellDamage { panel: number; cells: number[]; dmg: number; frame?: boolean }
export interface ImpactResult { events: CellDamage[]; broke: { panel: Panel; cells: number[] }[]; blocked: boolean }

/**
 * Owns all panels. `impact()` is the authoritative local computation (run by
 * the shooter / gadget owner); its CellDamage events are applied locally and
 * broadcast so every peer calls `apply()` with the same data.
 */
export class DestructionSystem {
  readonly panels = new Map<number, Panel>();
  readonly group = new THREE.Group();
  xray = false;
  private nextId = 1;
  onBroke?: (panel: Panel, cells: number[]) => void;

  constructor(private physics: Physics) {
    this.group.name = 'destructibles';
  }

  add(spec: PanelSpec, forcedId?: number): Panel {
    const id = forcedId ?? this.nextId++;
    const p = new Panel(id, spec);
    this.panels.set(id, p);
    p.mesh.name = spec.kind;
    this.group.add(p.mesh);
    p.rebuild(this.physics, this.xray);
    return p;
  }

  remove(id: number) {
    const p = this.panels.get(id);
    if (!p) return;
    for (const d of p.details) this.group.remove(d);
    for (const c of p.colliders) this.physics.remove(c);
    p.colliders = [];
    this.group.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.panels.delete(id);
  }

  get(id: number) { return this.panels.get(id); }

  /** Apply a (possibly remote) damage event. */
  apply(ev: CellDamage): number[] {
    const p = this.panels.get(ev.panel);
    if (!p) return [];
    const broke = p.applyDamage(ev.cells, ev.dmg);
    const frame = ev.frame ? p.breakFrame(ev.cells) : [];
    if (broke.length || frame.length) this.onBroke?.(p, [...broke, ...frame]);
    return broke.length || frame.length ? [...broke, ...frame] : broke;
  }

  setXray(on: boolean) {
    this.xray = on;
    for (const p of this.panels.values()) p.dirty = true;
  }

  update() {
    for (const p of this.panels.values()) if (p.dirty) p.rebuild(this.physics, this.xray);
  }

  panelsNear(c: THREE.Vector3, r: number): Panel[] {
    const out: Panel[] = [];
    const box = new THREE.Box3();
    for (const p of this.panels.values()) {
      box.set(p.min, p.max);
      if (box.distanceToPoint(c) <= r) out.push(p);
    }
    return out;
  }

  /**
   * Compute (but do not apply) the cell damage an impact produces.
   * `target` is the panel directly hit / the gadget is stuck on.
   */
  /** `heavy`: a bullet with frame-breaking punch (shotgun pellets) */
  impact(kind: ImpactKind, point: THREE.Vector3, target: Panel | null, power = 1, heavy = false): ImpactResult {
    const frames = heavy || HEAVY.has(kind);
    const events: CellDamage[] = [];
    const push = (p: Panel, cells: number[], dmg: number) => { if (cells.length && dmg > 0) events.push({ panel: p.id, cells, dmg }); };
    let blocked = false;
    const immune = (p: Panel) => p.reinforced && kind !== 'thermite';

    if (kind === 'bullet' || kind === 'melee' || kind === 'swing') {
      if (!target) return { events, broke: [], blocked: true };
      if (immune(target)) return { events, broke: [], blocked: true };
      const k = target.kind;
      if (kind === 'bullet') {
        if (k === 'hatch' || k === 'castle') blocked = true;
        else {
          const cell = target.cellAt(point);
          const mul = k === 'shutter' ? 0.25 : 1;
          push(target, [cell], power * mul);
          // splinter neighbours a little so sustained fire opens ragged holes
          const nb = target.cellsInSphere(point, target.cu * 1.1).filter((i) => i !== cell);
          push(target, nb, power * mul * 0.18);
        }
      } else if (kind === 'melee') {
        if (k === 'hatch') push(target, target.liveCells(), 2);
        else if (k === 'castle') push(target, target.liveCells(), 1);
        else if (k === 'barricade') {
          // R6: two melee hits bring a wooden barricade down wherever you strike it
          push(target, target.cellsInSphere(point, 0.5), 10);
          push(target, target.liveCells(), 0.5);
        } else push(target, target.cellsInSphere(point, 0.36), k === 'shutter' ? 2 : 10);
      } else if (kind === 'swing') {
        if (k === 'barricade') push(target, target.liveCells(), 99);
        else blocked = true;
      }
    } else if (kind === 'breach' || kind === 'thermite') {
      if (target && !(kind === 'breach' && target.reinforced) && !(kind === 'thermite' && target.electrified > 0)) {
        // spec: a body-sized 1.8 × 2.2 m passage (Thermite burns slightly taller through steel)
        const w = 1.8;
        const h = kind === 'thermite' ? 2.4 : 2.2;
        if (target.isWall) {
          const pu = point.getComponent(target.uAx);
          const baseV = target.min.getComponent(target.vAx);
          let v0 = point.getComponent(target.vAx) - h / 2;
          if (v0 - baseV < 0.6) v0 = baseV - 0.01;
          push(target, target.cellsInRect(pu - w / 2, v0, pu + w / 2, v0 + h, true), 999);
        } else {
          push(target, target.cellsInSphere(point, kind === 'thermite' ? 0.9 : 0.65, true), 999);
        }
      } else blocked = true;
      if (kind === 'thermite' && target?.reinforced && !blocked) target.thermited = true;
      if (kind === 'breach') for (const p of this.panelsNear(point, 1.2)) {
        if (p === target || immune(p)) continue;
        push(p, p.cellsInSphere(point, 0.9, true), 4);
      }
    } else if ((kind === 'sledge' || kind === 'ash') && target && target.isWall && !immune(target) && (target.kind === 'wall_soft' || target.kind === 'wall_semi')) {
      // spec: hammer / Ash round open a 1.8 × 2.2 m body-sized passage in soft walls (semi keeps its studs)
      const pu = point.getComponent(target.uAx);
      const baseV = target.min.getComponent(target.vAx);
      let v0 = point.getComponent(target.vAx) - 1.1;
      if (v0 - baseV < 0.7) v0 = baseV - 0.01;
      push(target, target.cellsInRect(pu - 0.9, v0, pu + 0.9, v0 + 2.2, true), 999);
      for (const p of this.panelsNear(point, 1.0)) if (p !== target && !immune(p) && p.isWall) push(p, p.cellsInSphere(point, 0.9, true), 60);
    } else {
      const r = kind === 'sledge' ? 0.8 : kind === 'ash' ? 1.05 : kind === 'cluster' ? 0.5 : 0.65;
      const dmg = kind === 'sledge' || kind === 'ash' ? 60 : 4;
      for (const p of this.panelsNear(point, r)) {
        if (immune(p)) { if (p === target) blocked = true; continue; }
        if (p.kind === 'hatch' || p.kind === 'castle' || p.kind === 'barricade') {
          if ((kind === 'sledge' || kind === 'ash') && (p === target || p.cellsInSphere(point, r, true).length)) push(p, p.standingCells(), 999);
          else if (p.kind === 'barricade') push(p, p.cellsInSphere(point, r), dmg);
          continue;
        }
        push(p, p.cellsInSphere(point, r, frames), dmg * power);
      }
    }
    if (frames) for (const e of events) e.frame = true;
    return { events, broke: [], blocked };
  }

  /** impact() + apply() locally. Returns events to broadcast. */
  impactAndApply(kind: ImpactKind, point: THREE.Vector3, target: Panel | null, power = 1, heavy = false): ImpactResult {
    const res = this.impact(kind, point, target, power, heavy);
    for (const ev of res.events) {
      const p = this.panels.get(ev.panel)!;
      const broke = this.apply(ev);
      if (broke.length) res.broke.push({ panel: p, cells: broke });
    }
    return res;
  }
}
