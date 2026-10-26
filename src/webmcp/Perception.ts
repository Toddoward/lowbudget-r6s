import * as THREE from 'three';
import { tEn } from '../ui/i18n.ts';
import { G_WORLD } from '../core/Physics.ts';
import type { World } from '../game/World.ts';
import type { Soldier } from '../game/Soldier.ts';
import { STANCE_NAME, Stance } from '../game/types.ts';
import { FLOOR_LABEL } from '../map/houseLayout.ts';
import { locationName, floorOf } from '../map/MapBuilder.ts';
import { WEAPONS } from '../game/weapons.ts';

/**
 * Builds the legal first-person observation for one soldier: only what a
 * human in that body could perceive — camera frustum + occlusion raycasts for
 * vision, attenuated 3-second acoustic memory, own HUD state.
 */
export interface VisionEntry {
  id: string;
  kind: 'enemy' | 'ally' | 'hostage' | 'soft_wall' | 'semi_wall' | 'reinforced_wall' | 'hatch' | 'floor' | 'window' | 'door' | 'barricade' | 'armor_panel' | 'gadget' | 'objective' | 'drone';
  label: string;
  yawDelta: number;
  pitchDelta: number;
  distance: number;
  state: Record<string, unknown>;
}
export interface AcousticCue {
  type: string;
  relativeDirection: string;
  compass: string;
  vertical: 'Same_Floor' | 'Above_Floor' | 'Below_Floor';
  bearingDeg: number;
  intensity: number;
  ageMs: number;
  range: 'near' | 'mid' | 'far';
}

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const headingDeg = (yaw: number) => THREE.MathUtils.euclideanModulo(-THREE.MathUtils.radToDeg(yaw), 360);
export const wrap180 = (d: number) => THREE.MathUtils.euclideanModulo(d + 180, 360) - 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

export class Perception {
  private cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 80);
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();

  constructor(private world: World) {}

  private setupCamera(s: Soldier, aspect: number, fov: number) {
    const eye = s.eye();
    this.cam.fov = fov;
    this.cam.aspect = aspect;
    this.cam.position.copy(eye);
    this.cam.rotation.set(s.pitch, s.yaw, s.cameraRoll, 'YXZ');
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
    this.m.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    return eye;
  }

  private rel(eye: THREE.Vector3, s: Soldier, p: THREE.Vector3) {
    const d = p.clone().sub(eye);
    const dist = d.length();
    const hdg = THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
    const yawDelta = wrap180(hdg - headingDeg(s.yaw));
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y / Math.max(dist, 1e-3), -1, 1)));
    return { yawDelta: r1(yawDelta), pitchDelta: r1(pitch - THREE.MathUtils.radToDeg(s.pitch)), distance: r1(dist) };
  }

  vision(s: Soldier, aspect = 16 / 9, fov = 75): VisionEntry[] {
    const w = this.world;
    const eye = this.setupCamera(s, aspect, fov);
    const out: VisionEntry[] = [];
    const visibleFrom = (pt: THREE.Vector3, ignorePanel?: number) => {
      if (!this.frustum.containsPoint(pt)) return false;
      const d = pt.clone().sub(eye);
      const len = d.length();
      if (len < 0.05) return true;
      const hit = w.physics.raycast(eye, d.normalize(), len - 0.04, G_WORLD, (t) => (t?.kind === 'panel' && t.panelId === ignorePanel));
      return !hit;
    };
    // characters
    for (const a of w.actors.values()) {
      if (a.id === s.id || !w.targetable(a)) continue;
      const hb = a.hitboxes();
      const parts: string[] = [];
      if (visibleFrom(hb.head.c)) parts.push('head');
      if (visibleFrom(hb.torso.a.clone().lerp(hb.torso.b, 0.5))) parts.push('torso');
      if (visibleFrom(hb.legs.a.clone().lerp(hb.legs.b, 0.5))) parts.push('legs');
      if (!parts.length) continue;
      const aim = parts.includes('torso') ? hb.torso.a.clone().lerp(hb.torso.b, 0.55) : parts.includes('head') ? hb.head.c : hb.legs.b;
      const r = this.rel(eye, s, aim);
      const head = this.rel(eye, s, hb.head.c);
      const kind = a.side === 'hostage' ? 'hostage' : a.side === s.side ? 'ally' : 'enemy';
      const theirFwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
      const toMe = eye.clone().sub(a.pos).setY(0).normalize();
      out.push({
        id: a.id, kind, label: kind === 'ally' ? a.name : kind === 'hostage' ? 'Hostage' : r.distance < 30 ? `Enemy ${a.operator}` : 'Enemy',
        ...r,
        state: { visibleParts: parts, stance: STANCE_NAME[a.stance as Stance] ?? 'Stand', headYawDelta: head.yawDelta, headPitchDelta: head.pitchDelta, facingMe: theirFwd.dot(toMe) > 0.85, moving: a.vel.lengthSq() > 0.5, operator: r.distance < 30 ? a.operator : undefined },
      });
    }
    // destructible surfaces near the viewer
    for (const p of w.destruction.panelsNear(eye, 9)) {
      if (p.destroyed) continue;
      const c = p.center;
      // nearest point on the panel face toward the eye
      const q = new THREE.Vector3(THREE.MathUtils.clamp(eye.x, p.min.x, p.max.x), THREE.MathUtils.clamp(eye.y, p.min.y, p.max.y), THREE.MathUtils.clamp(eye.z, p.min.z, p.max.z));
      const probe = q.distanceTo(eye) < 0.6 ? c : q.lerp(c, 0.35);
      if (!visibleFrom(probe, p.id)) continue;
      const kind: VisionEntry['kind'] = p.kind === 'hatch' ? 'hatch' : p.kind === 'barricade' ? 'barricade' : p.kind === 'castle' ? 'armor_panel' : p.reinforced ? 'reinforced_wall' : p.kind === 'floor_semi' ? 'floor' : p.kind === 'wall_semi' ? 'semi_wall' : 'soft_wall';
      out.push({ id: `panel:${p.id}`, kind, label: p.label, ...this.rel(eye, s, probe), state: { tier: p.tier, damagePct: Math.round(p.brokenFraction * 100), passable: p.passable, reinforced: p.reinforced, electrified: p.electrified > 0, exterior: p.exterior } });
    }
    // openings
    for (const op of w.house.openings) {
      const d = op.center.distanceTo(eye);
      if (d > 16) continue;
      if (!visibleFrom(op.center, op.barricadePanel ?? undefined)) continue;
      out.push({ id: `opening:${op.id}`, kind: op.kind === 'window' || op.kind === 'open_window' ? 'window' : 'door', label: op.label, ...this.rel(eye, s, op.center), state: { opening: op.kind, barricade: op.barricadeKind, barricadeable: op.barricadeable, exterior: op.exterior } });
    }
    // gadgets & drones
    for (const g of w.gadgets.all()) {
      if (g.pos.distanceTo(eye) > 20 || !visibleFrom(g.pos)) continue;
      out.push({ id: `gadget:${g.id}`, kind: g.type === 'drone' ? 'drone' : 'gadget', label: g.type, ...this.rel(eye, s, g.pos), state: { type: g.type, friendly: g.team === s.side, armed: g.state } });
    }
    // objectives
    const o = w.objectives;
    for (const b of o.bombs) if (visibleFrom(b.pos.clone().add(new THREE.Vector3(0, 0.3, 0)))) out.push({ id: `bomb:${b.id}`, kind: 'objective', label: 'Bomb', ...this.rel(eye, s, b.pos), state: { objective: 'bomb', status: b.state } });
    if (o.container && visibleFrom(o.container.pos.clone().add(new THREE.Vector3(0, 0.6, 0)))) out.push({ id: 'container', kind: 'objective', label: 'Biohazard Container', ...this.rel(eye, s, o.container.pos), state: { objective: 'secure', progress: Math.round(o.secureProgress * 10) } });
    if (o.defuser && visibleFrom(o.defuser.pos)) out.push({ id: 'defuser', kind: 'objective', label: 'Defuser', ...this.rel(eye, s, o.defuser.pos), state: { objective: 'defuser' } });
    out.sort((a, b) => (a.kind === 'enemy' ? -1 : 0) - (b.kind === 'enemy' ? -1 : 0) || a.distance - b.distance);
    return out.slice(0, 36);
  }

  acoustic(s: Soldier): AcousticCue[] {
    const w = this.world;
    const eye = s.eye();
    const out: AcousticCue[] = [];
    const myFloor = floorOf(s.pos.y + 0.2);
    for (const e of w.sounds) {
      if (e.source === s.id) continue;
      const d = e.pos.distanceTo(eye);
      const floors = Math.abs(floorOf(e.pos.y + 0.2) - myFloor);
      const r = e.radius * Math.pow(0.65, floors);
      if (d > r) continue;
      const age = (w.time - (e.t ?? w.time)) * 1000;
      if (age > 3000) continue;
      const rel = wrap180(THREE.MathUtils.radToDeg(Math.atan2(e.pos.x - eye.x, -(e.pos.z - eye.z))) - headingDeg(s.yaw));
      const compass = COMPASS16[Math.round(THREE.MathUtils.euclideanModulo(rel, 360) / 22.5) % 16];
      const fl = floorOf(e.pos.y + 0.2);
      const vertical = fl > myFloor ? 'Above_Floor' : fl < myFloor ? 'Below_Floor' : 'Same_Floor';
      out.push({
        type: e.type === 'suppressed' ? 'suppressed_gunshot' : e.type === 'breach' ? 'wall_breach' : e.type === 'barricade' ? `barricade_${e.label ?? 'event'}` : e.type,
        relativeDirection: vertical === 'Same_Floor' ? compass : vertical,
        compass, vertical, bearingDeg: Math.round(rel),
        intensity: Math.round(e.intensity * (1 - d / r) * 100) / 100,
        ageMs: Math.round(age),
        range: d < 6 ? 'near' : d < 18 ? 'mid' : 'far',
      });
    }
    return out.sort((a, b) => b.intensity - a.intensity).slice(0, 24);
  }

  self(s: Soldier) {
    const w = s.weapon;
    const op = s.op;
    return {
      id: s.id, nickname: s.name, team: s.side, operator: op.name, operatorId: op.id,
      hp: Math.round(s.hp), alive: s.alive,
      stance: s.mode === 'rappel' ? 'Rappel' : STANCE_NAME[s.stance], rappelInverted: s.mode === 'rappel' && s.inverted,
      lean: s.lean > 0.3 ? 'E' : s.lean < -0.3 ? 'Q' : 'None', ads: s.ads > 0.6,
      weapon: w ? { slot: s.slot === 0 ? 'primary' : 'secondary', name: w.def.name, ammoInMag: w.mag, reserve: w.reserve, magSize: w.def.mag, reloading: s.reloading } : { slot: s.slot === 2 ? 'gadget' : 'universal', name: s.slot === 2 ? op.gadgetName : op.universal },
      loadout: { primary: WEAPONS[op.primary]?.name, secondary: WEAPONS[op.secondary]?.name },
      gadgets: { gadget: op.gadgetName, gadgetRemaining: s.gadgetLeft, universal: op.universal, universalRemaining: op.universal === 'barricade' ? 'unlimited' : s.universalLeft, reinforcementsLeft: s.reinforcementsLeft },
      room: locationName(s.pos), floor: FLOOR_LABEL[floorOf(s.pos.y + 0.2)],
      heading: Math.round(headingDeg(s.yaw)), pitch: Math.round(THREE.MathUtils.radToDeg(s.pitch)),
      position: { x: r1(s.pos.x), y: r1(s.pos.y), z: r1(s.pos.z) },
      interactPrompt: s.interactLabel ? tEn(s.interactLabel) : null, gadgetHint: s.gadgetHint ? tEn(s.gadgetHint) : null, interactProgress: Math.round(s.interactProgress * 100) / 100,
      heartbeat: (this.world.gadgets.isScanning(s) ? this.world.gadgets.heartbeats.get(s.id) ?? [] : []).map((h) => ({ bearingDeg: Math.round(wrap180(THREE.MathUtils.radToDeg(Math.atan2(h.dir.x, -h.dir.z)) - headingDeg(s.yaw))), distance: r1(h.dist), vertical: h.dy > 1.5 ? 'Above_Floor' : h.dy < -1.5 ? 'Below_Floor' : 'Same_Floor' })),
    };
  }
}
