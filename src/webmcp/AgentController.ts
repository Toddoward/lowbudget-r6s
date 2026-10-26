import * as THREE from 'three';
import { emptyInput, type Soldier, type SoldierInput } from '../game/Soldier.ts';
import { Stance } from '../game/types.ts';
import { headingDeg, wrap180 } from './Perception.ts';
import type { World } from '../game/World.ts';

export interface AgentAction {
  move?: { forward?: number; strafe?: number; sprint?: boolean };
  lookLerp?: { yaw?: number; pitch?: number; yawDelta?: number; pitchDelta?: number; targetId?: string; rate?: number };
  stance?: 'stand' | 'crouch' | 'prone';
  lean?: 'left' | 'right' | 'none' | 'Q' | 'E';
  fire?: boolean | { burst?: number };
  ads?: boolean;
  reload?: boolean;
  melee?: boolean;
  switchWeapon?: 'primary' | 'secondary' | 'gadget' | 'universal';
  gadget?: 'use' | 'detonate' | 'equip' | 'equip_universal' | 'key' | 'key_hold' | 'key_universal' | 'key_universal_hold';
  /** ping: spot the enemy under the crosshair / mark the spot (team-wide) */
  ping?: boolean;
  interact?: boolean | 'press' | 'hold';
  rappel?: 'start' | 'up' | 'down' | 'left' | 'right' | 'stop' | 'invert' | 'swing' | 'detach';
  drone?: { forward?: number; strafe?: number; jump?: boolean };
  durationMs?: number;
}

/** Max angular speed an agent may turn — same budget as a fast human flick. */
export const MAX_TURN_DEG_PER_S = 540;

/**
 * Converts WebMCP actions into the very same SoldierInput a keyboard/mouse
 * produces, so agents obey identical physics, collision, recoil and turn-rate
 * limits. Look targets are approached by exponential lerp (rate per 1/60 s)
 * capped at MAX_TURN_DEG_PER_S.
 */
export class AgentController {
  private move = { f: 0, r: 0, sprint: false, until: 0 };
  private look: { yaw: number; pitch: number; rate: number; targetId?: string; until: number } | null = null;
  private fireUntil = 0;
  private burst = 0;
  private burstMag = -1;
  private ads = false;
  private lean: -1 | 0 | 1 = 0;
  private stance: Stance | null = null;
  private interactUntil = 0;
  private gKey = { op: 0, uni: 0 };
  private pulses = { reload: false, melee: false, interact: false, alt: false, invert: false, jump: false, firePressed: false, slot: null as number | null, gadget: false, gadget2: false, ping: false };
  private rappelMove = { f: 0, r: 0, until: 0 };
  private drone = { f: 0, r: 0, jump: false, until: 0 };
  lastActionAt = -1e9;
  actions = 0;

  constructor(private world: World, private s: Soldier) {}

  apply(a: AgentAction): { ok: boolean; warnings: string[] } {
    const now = performance.now();
    const dur = THREE.MathUtils.clamp(a.durationMs ?? 250, 16, 5000);
    const warnings: string[] = [];
    this.lastActionAt = now;
    this.actions++;
    if (a.move) this.move = { f: clamp1(a.move.forward ?? 0), r: clamp1(a.move.strafe ?? 0), sprint: !!a.move.sprint, until: now + dur };
    if (a.lookLerp) {
      const L = a.lookLerp;
      const curH = headingDeg(this.s.yaw);
      const curP = THREE.MathUtils.radToDeg(this.s.pitch);
      let yaw = L.yaw ?? curH;
      let pitch = L.pitch ?? curP;
      if (L.yawDelta !== undefined) yaw = curH + L.yawDelta;
      if (L.pitchDelta !== undefined) pitch = curP + L.pitchDelta;
      this.look = { yaw, pitch: THREE.MathUtils.clamp(pitch, -85, 85), rate: THREE.MathUtils.clamp(L.rate ?? 0.25, 0.01, 1), targetId: L.targetId, until: now + Math.max(dur, 600) };
    }
    if (a.stance) this.stance = a.stance === 'crouch' ? Stance.Crouch : a.stance === 'prone' ? Stance.Prone : Stance.Stand;
    if (a.lean) this.lean = a.lean === 'left' || a.lean === 'Q' ? -1 : a.lean === 'right' || a.lean === 'E' ? 1 : 0;
    if (a.ads !== undefined) this.ads = a.ads;
    if (a.fire !== undefined) {
      if (typeof a.fire === 'object') { this.burst = THREE.MathUtils.clamp(a.fire.burst ?? 1, 1, 30); this.burstMag = this.s.weapon?.mag ?? -1; this.fireUntil = now + 4000; this.pulses.firePressed = true; }
      else if (a.fire) { this.fireUntil = now + dur; this.pulses.firePressed = true; this.burst = 0; }
      else { this.fireUntil = 0; this.burst = 0; }
    }
    if (a.reload) this.pulses.reload = true;
    if (a.melee) this.pulses.melee = true;
    if (a.switchWeapon) this.pulses.slot = { primary: 0, secondary: 1, gadget: 2, universal: 3 }[a.switchWeapon];
    if (a.gadget === 'equip') this.pulses.slot = 2;
    if (a.gadget === 'equip_universal') this.pulses.slot = 3;
    if (a.gadget === 'use') { this.pulses.firePressed = true; this.fireUntil = Math.max(this.fireUntil, now + 120); if (this.s.slot < 2) warnings.push('gadget:use while a firearm is equipped fires the gun — send gadget:"equip" first'); }
    if (a.gadget === 'detonate') this.pulses.alt = true;
    // the human context keys: [G] operator gadget, [X] secondary (tap = use/toggle/throw, hold = place)
    if (a.gadget === 'key') this.pulses.gadget = true;
    if (a.gadget === 'key_universal') this.pulses.gadget2 = true;
    if (a.gadget === 'key_hold') { this.pulses.gadget = true; this.gKey.op = now + Math.max(dur, 1600); }
    if (a.gadget === 'key_universal_hold') { this.pulses.gadget2 = true; this.gKey.uni = now + Math.max(dur, 1600); }
    if (a.ping) this.pulses.ping = true;
    if (a.interact !== undefined) {
      if (a.interact === 'hold') this.interactUntil = now + Math.max(dur, 3000);
      else if (a.interact === true || a.interact === 'press') { this.pulses.interact = true; this.interactUntil = now + dur; }
      else this.interactUntil = 0;
    }
    if (a.rappel) {
      switch (a.rappel) {
        case 'start': case 'swing': this.pulses.interact = true; break;
        case 'invert': this.pulses.invert = true; break;
        case 'detach': this.pulses.jump = true; break;
        case 'up': this.rappelMove = { f: 1, r: 0, until: now + dur }; break;
        case 'down': this.rappelMove = { f: -1, r: 0, until: now + dur }; break;
        case 'left': this.rappelMove = { f: 0, r: -1, until: now + dur }; break;
        case 'right': this.rappelMove = { f: 0, r: 1, until: now + dur }; break;
        case 'stop': this.rappelMove.until = 0; break;
      }
      if (a.rappel === 'start' && this.s.side !== 'attack') warnings.push('only attackers can rappel');
    }
    if (a.drone) this.drone = { f: clamp1(a.drone.forward ?? 0), r: clamp1(a.drone.strafe ?? 0), jump: !!a.drone.jump, until: now + dur };
    return { ok: true, warnings };
  }

  /** Produce this frame's input (call once per simulation step). */
  input(dt: number): SoldierInput {
    const now = performance.now();
    const inp = emptyInput();
    const s = this.s;
    if (now < this.move.until) { inp.moveF = this.move.f; inp.moveR = this.move.r; inp.sprint = this.move.sprint; }
    if (now < this.rappelMove.until) { inp.moveF = this.rappelMove.f; inp.moveR = this.rappelMove.r; }
    if (this.look && now < this.look.until) {
      let { yaw, pitch } = this.look;
      if (this.look.targetId) {
        const a = this.world.actors.get(this.look.targetId);
        if (a && a.alive) {
          const d = a.hitboxes().torso.b.clone().lerp(a.hitboxes().torso.a, 0.4).sub(s.eye());
          yaw = THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
          pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y / d.length(), -1, 1)));
        }
      }
      const curH = headingDeg(s.yaw);
      const curP = THREE.MathUtils.radToDeg(s.pitch);
      const k = 1 - Math.pow(1 - this.look.rate, dt * 60);
      const maxStep = MAX_TURN_DEG_PER_S * dt;
      const dy = THREE.MathUtils.clamp(wrap180(yaw - curH) * k, -maxStep, maxStep);
      const dp = THREE.MathUtils.clamp((pitch - curP) * k, -maxStep, maxStep);
      // heading is clockwise; internal yaw is counter-clockwise
      inp.lookDYaw = -THREE.MathUtils.degToRad(dy);
      inp.lookDPitch = THREE.MathUtils.degToRad(dp);
    }
    if (this.burst > 0) {
      const mag = s.weapon?.mag ?? 0;
      if (this.burstMag >= 0 && mag < this.burstMag) { this.burst -= this.burstMag - mag; this.burstMag = mag; }
      inp.fire = this.burst > 0 && now < this.fireUntil;
      if (!inp.fire) this.burst = 0;
      // semi-auto weapons need trigger releases between shots
      if (s.weapon?.def.mode === 'semi' && Math.floor(now / 90) % 2 === 0) inp.fire = false;
    } else inp.fire = now < this.fireUntil;
    inp.firePressed = this.pulses.firePressed;
    inp.ads = this.ads;
    inp.lean = this.lean;
    inp.stance = this.stance;
    inp.interact = now < this.interactUntil;
    inp.interactPressed = this.pulses.interact;
    inp.reload = this.pulses.reload;
    inp.melee = this.pulses.melee;
    inp.alt = this.pulses.alt;
    inp.invert = this.pulses.invert;
    inp.jump = this.pulses.jump;
    inp.slot = this.pulses.slot;
    inp.gadget = this.pulses.gadget;
    inp.gadget2 = this.pulses.gadget2;
    inp.gadgetHeld = now < this.gKey.op || this.pulses.gadget;
    inp.gadget2Held = now < this.gKey.uni || this.pulses.gadget2;
    inp.ping = this.pulses.ping;
    this.pulses = { reload: false, melee: false, interact: false, alt: false, invert: false, jump: false, firePressed: false, slot: null, gadget: false, gadget2: false, ping: false };
    return inp;
  }

  droneInput(): { f: number; r: number; jump: boolean } {
    return performance.now() < this.drone.until ? this.drone : { f: 0, r: 0, jump: false };
  }
}

const clamp1 = (v: number) => THREE.MathUtils.clamp(Number(v) || 0, -1, 1);
