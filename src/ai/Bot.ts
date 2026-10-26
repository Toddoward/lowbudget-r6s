import * as THREE from 'three';
import { G_WORLD } from '../core/Physics.ts';
import type { Actor } from '../game/Actor.ts';
import { emptyInput, type Soldier, type SoldierInput } from '../game/Soldier.ts';
import type { SoundEvent, World } from '../game/World.ts';
import { Stance } from '../game/types.ts';
import type { NavGraph } from './NavGraph.ts';

/**
 * Terrorist Hunt bot — Finite State Machine.
 *
 *            hear gunshot / breach / footsteps, ally hit, partial sighting
 *   PATROL ───────────────────────────────────────────────▶ ALERT (investigate)
 *     ▲  calm 12 s, nothing found                             │ spotted (awareness ≥ 1)
 *     └──────────────────────── ALERT ◀── lost > 6 s ── ATTACK (engage / suppress / chase)
 *                                                          │ ▲ reloaded / healed
 *                                    mag empty / HP < 35 % ▼ │
 *                                                         COVER
 *
 * Perception runs at 10 Hz (staggered): FOV cone + Rapier raycasts (only
 * what is really visible through intact geometry, holes included), hearing
 * radius per sound type with floor attenuation, ally-hurt broadcasts.
 *
 * Aim never snaps: aimDir = normalize(lerp(aimDir, targetDir, turnSpeed·dt))
 * then a per-difficulty max angular rate. Shots fire only once the residual
 * aim error < fireCone and the reaction delay elapsed; each round gets an
 * extra Gaussian (or linear-disc) spread scaled by distance, motion and the
 * current residual error.
 */
export enum BotState { Patrol = 'PATROL', Alert = 'ALERT', Attack = 'ATTACK', Cover = 'COVER', Dead = 'DEAD' }

export interface BotDifficulty {
  name: 'Normal' | 'Hard' | 'Realistic';
  turnSpeed: number;
  maxTurnRate: number;
  reaction: number;
  fireCone: number;
  spread: number;
  spreadModel: 'gaussian' | 'linear';
  headAim: number;
  awareness: number;
  hearing: number;
  burst: [number, number];
  count: number;
}
export const DIFFICULTY: Record<BotDifficulty['name'], BotDifficulty> = {
  Normal: { name: 'Normal', turnSpeed: 3.2, maxTurnRate: 4.5, reaction: 0.65, fireCone: 6, spread: 1.15, spreadModel: 'linear', headAim: 0.08, awareness: 1.7, hearing: 0.8, burst: [3, 6], count: 12 },
  Hard: { name: 'Hard', turnSpeed: 4.8, maxTurnRate: 6.5, reaction: 0.42, fireCone: 3.5, spread: 0.75, spreadModel: 'gaussian', headAim: 0.2, awareness: 2.4, hearing: 1.0, burst: [4, 8], count: 14 },
  Realistic: { name: 'Realistic', turnSpeed: 6.5, maxTurnRate: 9, reaction: 0.26, fireCone: 2.5, spread: 0.45, spreadModel: 'gaussian', headAim: 0.35, awareness: 3.2, hearing: 1.2, burst: [5, 10], count: 16 },
};

let perceptionSlot = 0;

export class Bot {
  state = BotState.Patrol;
  readonly s: Soldier;
  private aim = new THREE.Vector3(0, 0, -1);
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private pathGoal = new THREE.Vector3();
  private repathT = 0;
  private stuckT = 0;
  private lastProgressPos = new THREE.Vector3();
  private patrolRooms: string[];
  private waitT = 0;
  private scanT = 0;
  private scanYaw = 0;
  private alertT = 0;
  private investigate: THREE.Vector3 | null = null;
  private ambushT = 0;
  target: Actor | null = null;
  private lastSeen = new THREE.Vector3();
  private lastSeenT = -99;
  private visibleNow = false;
  private awareness = new Map<string, number>();
  private reactT = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private strafeT = 0;
  private strafeDir = 1;
  private strafeSlow = false;
  private crouchPref = false;
  private coverGoal: THREE.Vector3 | null = null;
  private coverT = 0;
  private suppressT = 0;
  private slot = perceptionSlot++ % 6;
  private tick = 0;
  private trackErr = new THREE.Vector3();
  /** initial misjudgment on (re)acquiring a target: decays over ~1 s, so the first shot isn't a laser (spec #10) */
  private acquireErr = new THREE.Vector3();
  private acquiredAt = -99;
  readonly guard: boolean;
  /** human-readable debug of the last transition */
  reason = 'spawn';

  constructor(private world: World, private nav: NavGraph, soldier: Soldier, private diff: BotDifficulty, rooms: string[], guard: boolean) {
    this.s = soldier;
    this.patrolRooms = rooms;
    this.guard = guard;
    this.aim.set(-Math.sin(soldier.yaw), 0, -Math.cos(soldier.yaw));
    soldier.spreadModel = diff.spreadModel;
    world.soundListeners.push((e) => this.hear(e));
    world.onHurt.push((victim, attacker) => this.allyHurt(victim, attacker));
  }

  /* ================================================================ perception */
  private hear(e: SoundEvent) {
    if (!this.s.alive || e.source === this.s.id) return;
    const src = this.world.actors.get(e.source);
    if (src && src.side === this.s.side) return; // ignore own team noise
    if ((e.type === 'gunshot' || e.type === 'suppressed') && src) this.shotLog.set(src.id, this.world.time);
    const d = e.pos.distanceTo(this.s.pos);
    const floors = Math.round(Math.abs(e.pos.y - this.s.pos.y) / 3);
    const eff = e.radius * this.diff.hearing * Math.pow(0.6, floors);
    if (d > eff) return;
    const err = d * (e.type === 'footstep' ? 0.25 : 0.12);
    const guess = e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * err, 0, (Math.random() - 0.5) * err));
    if (this.state === BotState.Patrol || (this.state === BotState.Alert && e.type !== 'footstep')) {
      this.toAlert(guess, `heard ${e.type}${e.label ? `:${e.label}` : ''} ${d.toFixed(0)}m`);
    } else if (this.state === BotState.Attack && !this.visibleNow && (e.type === 'gunshot' || e.type === 'footstep')) {
      // keep tracking the enemy we lost
      if (src && src === this.target) { this.lastSeen.copy(guess); this.lastSeenT = this.world.time - 1; }
    }
  }

  private allyHurt(victim: Actor, attacker: string) {
    if (!this.s.alive) return;
    const a = this.world.actors.get(attacker);
    if (victim === this.s) {
      // got shot: turn toward the shooter immediately (partial awareness)
      if (a) {
        this.awareness.set(a.id, Math.max(this.awareness.get(a.id) ?? 0, 0.7));
        if (this.state !== BotState.Attack) this.toAlert(a.pos.clone(), 'took fire');
        this.lastSeen.copy(a.pos);
        this.lastSeenT = this.world.time;
      }
      return;
    }
    if (victim.side !== this.s.side || victim.pos.distanceTo(this.s.pos) > 18) return;
    if (this.state === BotState.Patrol || this.state === BotState.Alert) this.toAlert((a ?? victim).pos.clone(), 'ally hit');
  }

  private see(dt: number) {
    // flashed (Blitz): blind — no new contacts, keep shooting where the target was last
    if (this.s.blindUntil > this.world.time) { this.visibleNow = false; return; }
    const eye = this.s.eye();
    const fwd = this.aim;
    let best: Actor | null = null;
    let bestScore = -1;
    this.visibleNow = false;
    for (const a of this.world.actors.values()) {
      if (!a.alive || a.side === this.s.side || a.side === 'hostage' || a.ghost) continue;
      const to = a.eye().sub(eye);
      const d = to.length();
      if (d > 48) continue;
      const dir = to.clone().divideScalar(d);
      const horiz = Math.acos(THREE.MathUtils.clamp(new THREE.Vector2(dir.x, dir.z).normalize().dot(new THREE.Vector2(fwd.x, fwd.z).normalize()), -1, 1));
      const close = d < 2.2;
      if (!close && (horiz > THREE.MathUtils.degToRad(58) || Math.abs(dir.y) > 0.75)) { this.decay(a.id, dt); continue; }
      const hb = a.hitboxes();
      const vis = [hb.head.c, hb.torso.b.clone().lerp(hb.torso.a, 0.5), hb.legs.b].some((pt) => this.world.physics.clearLine(eye, pt));
      if (!vis) { this.decay(a.id, dt); continue; }
      // awareness gain: distance, stance, motion, light, gunfire
      let gain = this.diff.awareness * THREE.MathUtils.clamp(1.8 - d / 22, 0.25, 1.8);
      if (a.stance === Stance.Crouch) gain *= 0.75;
      if (a.stance === Stance.Prone) gain *= 0.45;
      if (a.vel.lengthSq() > 1) gain *= 1.35;
      if (this.world.time - (this.lastShotOf(a.id)) < 1.5) gain *= 2.2;
      if (this.isNight && d > 12 && !a.flashlight) gain *= 0.5;
      if (horiz > THREE.MathUtils.degToRad(35)) gain *= 0.6; // peripheral
      const aw = Math.min(1.5, (this.awareness.get(a.id) ?? 0) + gain * dt * 2.5);
      this.awareness.set(a.id, aw);
      if (aw >= 1) {
        const score = 100 - d + (a === this.target ? 20 : 0);
        if (score > bestScore) { bestScore = score; best = a; }
      } else if (aw > 0.35 && this.state === BotState.Patrol) {
        this.toAlert(a.pos.clone(), 'glimpse');
      }
    }
    if (best) {
      if (this.state !== BotState.Attack && this.state !== BotState.Cover) {
        this.reactT = 0;
        this.setState(BotState.Attack, `spotted ${best.name}`);
      }
      if (this.target !== best) this.reactT = Math.min(this.reactT, this.diff.reaction * 0.5);
      if (this.target !== best || this.world.time - this.lastSeenT > 1.2) this.acquire(best);
      this.target = best;
      this.visibleNow = true;
      this.lastSeen.copy(best.pos);
      this.lastSeenT = this.world.time;
      this.world.sound({ type: 'voice', pos: this.s.pos.clone(), radius: 14, source: this.s.id, intensity: 0.5, label: 'contact' });
    }
  }

  private acquire(t: Actor) {
    const d = t.pos.distanceTo(this.s.pos);
    // 0.35..0.9 m off at Normal, less at higher difficulty; random direction, mostly sideways
    const mag = (0.35 + this.diff.spread * 0.5) * THREE.MathUtils.clamp(0.6 + d / 20, 0.6, 1.6);
    const a = Math.random() * Math.PI * 2;
    this.acquireErr.set(Math.cos(a) * mag, Math.sin(a) * mag * 0.55, Math.sin(a + 1.3) * mag);
    this.acquiredAt = this.world.time;
    this.trackErr.set(0, 0, 0);
  }

  private shotLog = new Map<string, number>();
  private lastShotOf(id: string) { return this.shotLog.get(id) ?? -99; }
  noteShot(id: string) { this.shotLog.set(id, this.world.time); }
  isNight = false;

  private decay(id: string, dt: number) {
    const v = this.awareness.get(id);
    if (v) this.awareness.set(id, Math.max(0, v - dt * 0.35));
  }

  /* ================================================================ transitions */
  private setState(s: BotState, why: string) {
    if (this.state === s) return;
    this.state = s;
    this.reason = why;
    this.path = [];
  }

  private toAlert(p: THREE.Vector3, why: string) {
    if (this.state === BotState.Attack || this.state === BotState.Cover) return;
    this.investigate = p;
    this.alertT = 12;
    this.scanT = 0;
    this.ambushT = 0;
    this.setState(BotState.Alert, why);
    // use cover near the noise instead of walking straight into it
    if (Math.random() < 0.4) {
      const c = this.nav.nearest(p, (n) => n.cover && n.pos.distanceTo(p) < 5 && n.pos.distanceTo(this.s.pos) < 9);
      if (c) { this.investigate = c.pos.clone(); this.ambushT = 5 + Math.random() * 4; this.reason += ' → ambush cover'; }
    }
  }

  /* ================================================================ update */
  update(dt: number): SoldierInput {
    const inp = emptyInput();
    if (!this.s.alive) { this.state = BotState.Dead; return inp; }
    this.tick++;
    if ((this.tick + this.slot) % 6 === 0) this.see(dt * 6);
    const s = this.s;
    let lookTarget: THREE.Vector3 | null = null;
    let wantStance: Stance = Stance.Stand;
    let moveTo: THREE.Vector3 | null = null;
    let fire = false;
    const w = s.weapon;
    this.strafeSlow = false;

    switch (this.state) {
      case BotState.Patrol: {
        if (this.guard) {
          this.waitT -= dt;
          if (this.waitT <= 0) { this.waitT = 3 + Math.random() * 3; this.scanYaw = s.yaw + (Math.random() - 0.5) * 2.4; }
          lookTarget = s.eye().add(new THREE.Vector3(-Math.sin(this.scanYaw), 0, -Math.cos(this.scanYaw)));
          wantStance = Math.random() < 0.002 ? Stance.Crouch : s.stance === Stance.Crouch ? Stance.Crouch : Stance.Stand;
          break;
        }
        if (this.waitT > 0) {
          this.waitT -= dt;
          lookTarget = s.eye().add(new THREE.Vector3(-Math.sin(this.scanYaw), 0, -Math.cos(this.scanYaw)));
          if (Math.random() < dt * 0.5) this.scanYaw += (Math.random() - 0.5) * 2;
        } else {
          if (!this.path.length) {
            const n = this.nav.randomNodeIn(this.patrolRooms);
            if (n) this.planTo(n.pos);
          }
          moveTo = this.followPath(dt);
          if (!moveTo) { this.waitT = 2 + Math.random() * 3; this.scanYaw = s.yaw; }
        }
        break;
      }
      case BotState.Alert: {
        this.alertT -= dt;
        if (this.investigate) {
          if (this.path.length === 0 || this.pathGoal.distanceTo(this.investigate) > 1) this.planTo(this.investigate);
          moveTo = this.followPath(dt);
          wantStance = Stance.Crouch;
          if (!moveTo) { this.investigate = null; this.scanT = this.ambushT > 0 ? this.ambushT : 4; this.scanYaw = s.yaw; }
        } else {
          this.scanT -= dt;
          wantStance = this.ambushT > 0 ? Stance.Crouch : Stance.Stand;
          if (Math.random() < dt * 0.9) this.scanYaw += (Math.random() - 0.5) * 2.6;
          lookTarget = s.eye().add(new THREE.Vector3(-Math.sin(this.scanYaw), 0, -Math.cos(this.scanYaw)));
          if (this.scanT <= 0 && this.alertT <= 0) { this.ambushT = 0; this.setState(BotState.Patrol, 'calm'); }
        }
        break;
      }
      case BotState.Attack: {
        const t = this.target;
        if (!t || !t.alive) { this.target = null; this.toAlertForce(this.lastSeen.clone(), 'target down'); break; }
        const sinceSeen = this.world.time - this.lastSeenT;
        if (w && (w.mag === 0 || (w.mag < w.def.mag * 0.25 && !this.visibleNow)) && w.reserve > 0) { this.goCover('reload'); break; }
        if (s.hp < 35 && this.visibleNow && t.pos.distanceTo(s.pos) > 6 && Math.random() < dt * 0.6) { this.goCover('wounded'); break; }
        if (this.visibleNow) {
          const hb = t.hitboxes();
          const settled = this.world.time - this.acquiredAt > 1.2;
          const aimAtHead = settled && Math.random() < this.diff.headAim * 0.02;
          const pt = (aimAtHead ? hb.head.c : hb.torso.a.clone().lerp(hb.torso.b, 0.55)).clone().addScaledVector(t.vel, 0.08);
          // drifting tracking error (random walk), scaled by difficulty
          this.trackErr.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5)).multiplyScalar(dt * 0.9));
          this.trackErr.clampLength(0, 0.12 + this.diff.spread * 0.05);
          // acquisition error decays exponentially (faster on harder difficulties)
          this.acquireErr.multiplyScalar(Math.exp(-dt * (0.8 + this.diff.turnSpeed * 0.1)));
          lookTarget = pt.add(this.trackErr).add(this.acquireErr);
          this.reactT += dt;
          // strafe / stance
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.5; this.strafeDir = Math.random() < 0.45 ? 0 : Math.random() < 0.5 ? -1 : 1; this.crouchPref = Math.random() < 0.35 && t.pos.distanceTo(s.pos) > 6; }
          wantStance = this.crouchPref ? Stance.Crouch : Stance.Stand;
          const right = new THREE.Vector3(-this.aim.z, 0, this.aim.x).normalize();
          // slow side-steps while shooting (the bot's own motion must stay trackable by its lerped aim)
          moveTo = this.strafeDir ? s.pos.clone().addScaledVector(right, this.strafeDir * 1.2) : null;
          this.strafeSlow = true;
          if (moveTo && t.pos.distanceTo(s.pos) > 16) moveTo.addScaledVector(new THREE.Vector3(this.aim.x, 0, this.aim.z).normalize(), 1.5);
          fire = this.reactT >= this.diff.reaction;
          this.suppressT = 1.2;
        } else if (sinceSeen < 1.6 && this.suppressT > 0 && this.throughSoftWall(this.lastSeen)) {
          // suppressive fire through the soft wall the target vanished behind
          this.suppressT -= dt;
          lookTarget = this.lastSeen.clone().add(new THREE.Vector3(0, 1.1, 0));
          fire = true;
          wantStance = Stance.Crouch;
        } else if (sinceSeen < 7) {
          if (!this.path.length || this.pathGoal.distanceTo(this.lastSeen) > 1.5) this.planTo(this.lastSeen);
          moveTo = this.followPath(dt);
          lookTarget = this.lastSeen.clone().add(new THREE.Vector3(0, 1.3, 0));
          if (!moveTo) this.toAlertForce(this.lastSeen.clone(), 'lost target');
        } else this.toAlertForce(this.lastSeen.clone(), 'lost target');
        break;
      }
      case BotState.Cover: {
        this.coverT -= dt;
        if (this.coverGoal) {
          if (!this.path.length) this.planTo(this.coverGoal);
          moveTo = this.followPath(dt);
          if (!moveTo) this.coverGoal = null;
          inp.sprint = true;
        }
        wantStance = Stance.Crouch;
        if (w && w.mag < w.def.mag && !s.reloading) inp.reload = true;
        lookTarget = this.lastSeen.clone().add(new THREE.Vector3(0, 1.2, 0));
        if (this.coverT <= 0 && !s.reloading) { this.setState(BotState.Attack, 'peek'); this.reactT = this.diff.reaction * 0.6; }
        if (this.visibleNow && w && w.mag > 0 && this.coverGoal === null) { fire = true; lookTarget = this.target?.eye() ?? lookTarget; }
        break;
      }
    }

    // ---- aim: linear interpolation toward the target direction (no snapping)
    let targetDir: THREE.Vector3;
    if (lookTarget) targetDir = lookTarget.clone().sub(s.eye()).normalize();
    else if (moveTo) targetDir = moveTo.clone().sub(s.pos).setY(0).normalize();
    else targetDir = this.aim.clone();
    if (!Number.isFinite(targetDir.x) || targetDir.lengthSq() < 0.5) targetDir = this.aim.clone();
    const prev = this.aim.clone();
    this.aim.lerp(targetDir, THREE.MathUtils.clamp(this.diff.turnSpeed * dt, 0, 1)).normalize();
    const turned = prev.angleTo(this.aim);
    const maxTurn = this.diff.maxTurnRate * dt;
    if (turned > maxTurn) this.aim.copy(prev).lerp(this.aim, maxTurn / turned).normalize();
    const desiredYaw = Math.atan2(-this.aim.x, -this.aim.z);
    const desiredPitch = Math.asin(THREE.MathUtils.clamp(this.aim.y, -1, 1));
    // compensate recoil like a human pulling down: effective aim (view + recoil) = desired
    inp.lookDYaw = wrap(desiredYaw - (s.yaw + s.recoilY));
    inp.lookDPitch = desiredPitch - (s.pitch + s.recoilP);

    // ---- fire control: only when residual aim error is inside the cone
    const err = THREE.MathUtils.radToDeg(this.aim.angleTo(targetDir));
    const dist = this.target ? this.target.pos.distanceTo(s.pos) : 10;
    const fresh = Math.exp(-(this.world.time - this.acquiredAt) / 1.2); // first shots after acquiring are wild
    const blind = s.blindUntil > this.world.time ? 6 : 0;
    s.extraSpread = this.diff.spread * (1 + dist / 30) * (s.vel.lengthSq() > 1 ? 1.25 : 1) * (this.target && this.target.vel.lengthSq() > 1 ? 1.15 : 1) + err * 0.35 + fresh * (2.6 + this.diff.spread * 2.6) + blind;
    if (fire && err < this.diff.fireCone && w) {
      if (this.burstPause > 0) this.burstPause -= dt;
      else {
        if (this.burstLeft <= 0) this.burstLeft = this.diff.burst[0] + Math.floor(Math.random() * (this.diff.burst[1] - this.diff.burst[0]));
        inp.fire = true;
        inp.ads = dist > 6;
        if (s.fireCd <= 0.0001) {
          this.burstLeft--;
          if (this.burstLeft <= 0) this.burstPause = 0.18 + Math.random() * 0.4;
        }
      }
    }

    // ---- locomotion: world-space goal → local move axes
    if (moveTo) {
      const d = moveTo.clone().sub(s.pos).setY(0);
      if (d.lengthSq() > 0.0025) {
        d.normalize();
        const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        inp.moveF = d.dot(fwd);
        inp.moveR = d.dot(right);
        if (this.state === BotState.Patrol) { inp.moveF *= 0.55; inp.moveR *= 0.55; }
        if (this.strafeSlow) { inp.moveF *= 0.35; inp.moveR *= 0.35; }
      }
    }
    inp.stance = wantStance;
    return inp;
  }

  private toAlertForce(p: THREE.Vector3, why: string) {
    this.state = BotState.Patrol;
    this.toAlert(p, why);
  }

  private goCover(why: string) {
    const from = this.lastSeen;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const n of this.nav.nodes) {
      if (!n.cover || n.kind === 'ext') continue;
      const d = n.pos.distanceTo(this.s.pos);
      if (d > 7 || d < 1) continue;
      // hidden from the threat at crouch height
      if (this.world.physics.clearLine(from.clone().add(new THREE.Vector3(0, 1.3, 0)), n.pos.clone().add(new THREE.Vector3(0, 0.8, 0)))) continue;
      if (d < bestD) { bestD = d; best = n.pos.clone(); }
    }
    this.coverGoal = best;
    this.coverT = 2.5 + Math.random() * 1.5;
    this.setState(BotState.Cover, why);
  }

  private throughSoftWall(p: THREE.Vector3): boolean {
    const eye = this.s.eye();
    const tgt = p.clone().add(new THREE.Vector3(0, 1.1, 0));
    const d = tgt.clone().sub(eye);
    const len = d.length();
    const hit = this.world.physics.raycast(eye, d.normalize(), len, G_WORLD);
    if (!hit || hit.tag?.kind !== 'panel') return false;
    const panel = this.world.destruction.get(hit.tag.panelId);
    return !!panel && panel.props.penetrable && !panel.reinforced;
  }

  /* ================================================================ pathing */
  private planTo(goal: THREE.Vector3) {
    this.pathGoal.copy(goal);
    const p = this.nav.path(this.s.pos, goal);
    this.path = p ?? [];
    this.pathIdx = 0;
    this.repathT = 3;
    this.stuckT = 0;
    this.lastProgressPos.copy(this.s.pos);
  }

  private followPath(dt: number): THREE.Vector3 | null {
    if (!this.path.length) return null;
    this.repathT -= dt;
    while (this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const dxz = Math.hypot(wp.x - this.s.pos.x, wp.z - this.s.pos.z);
      if (dxz < 0.45 && Math.abs(wp.y - this.s.pos.y) < 1.3) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.path.length) { this.path = []; return null; }
    // stuck detection → repath
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (this.s.pos.distanceTo(this.lastProgressPos) < 0.25) { this.planTo(this.pathGoal); if (!this.path.length) return null; }
      this.stuckT = 0;
      this.lastProgressPos.copy(this.s.pos);
    }
    return this.path[this.pathIdx];
  }
}

function wrap(a: number) {
  return THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
}
