import * as THREE from 'three';
import type { Physics } from '../core/Physics.ts';
import type { DestructionSystem } from '../world/Destruction.ts';
import type { Effects } from '../render/Effects.ts';
import type { HouseWorld } from '../map/MapBuilder.ts';
import type { GameEvent } from '../../shared/protocol.ts';
import type { Actor } from './Actor.ts';
import type { Soldier } from './Soldier.ts';
import type { Combat } from './Combat.ts';
import type { Interactions } from './Interactions.ts';
import type { Gadgets } from './Gadgets.ts';
import type { Objectives } from './Objectives.ts';

export type SoundType = 'gunshot' | 'suppressed' | 'explosion' | 'footstep' | 'breach' | 'barricade' | 'gadget' | 'impact' | 'voice';
export interface SoundEvent {
  type: SoundType;
  pos: THREE.Vector3;
  radius: number;
  source: string;
  intensity: number;
  label?: string;
  t?: number;
}

export interface KillInfo { killer: string; victim: string; head: boolean; weapon: string }

/**
 * Shared simulation context. `soldiers` are the characters this client
 * simulates authoritatively (local player, local WebMCP agents, bots);
 * `actors` additionally contains remote peers and the hostage.
 */
export class World {
  time = 0;
  readonly actors = new Map<string, Actor>();
  readonly soldiers = new Map<string, Soldier>();
  sounds: SoundEvent[] = [];
  combat!: Combat;
  interactions!: Interactions;
  gadgets!: Gadgets;
  objectives!: Objectives;
  mode: 'th' | 'pvp' = 'th';
  phase: 'prep' | 'action' | 'over' | 'lobby' = 'lobby';
  friendlyFire = true;
  localId = '';
  /** network sink (no-op offline) */
  emit: (ev: GameEvent) => void = () => {};
  soundListeners: ((s: SoundEvent) => void)[] = [];
  onKill: ((k: KillInfo) => void)[] = [];
  onLocalHit: ((target: Actor, head: boolean, killed: boolean) => void)[] = [];
  onHurt: ((victim: Actor, attacker: string, dmg: number) => void)[] = [];
  lastWeaponOf = new Map<string, string>();
  /** spotted enemies (actor id → visible-to-team until world time) */
  readonly spots = new Map<string, { until: number; team: string }>();
  /** world pings (drone / camera / player marks) */
  pings: { pos: THREE.Vector3; until: number; team: string; by: string }[] = [];

  constructor(readonly physics: Physics, readonly destruction: DestructionSystem, readonly effects: Effects, readonly house: HouseWorld, readonly scene: THREE.Scene) {}

  sound(s: SoundEvent) {
    s.t = this.time;
    this.sounds.push(s);
    for (const l of this.soundListeners) l(s);
  }

  pruneSounds() {
    const cutoff = this.time - 3.2;
    if (this.sounds.length && this.sounds[0].t! < cutoff) this.sounds = this.sounds.filter((s) => s.t! >= cutoff);
  }

  spot(target: string, team: string, secs = 5, broadcast = true, by = '') {
    this.spots.set(target, { until: this.time + secs, team });
    if (broadcast) this.emit({ t: 'spot', target, by, team });
  }

  ping(pos: THREE.Vector3, team: string, by: string, secs = 4, broadcast = true) {
    this.pings = this.pings.filter((p) => p.until > this.time && p.by !== by);
    this.pings.push({ pos: pos.clone(), until: this.time + secs, team, by });
    if (broadcast) this.emit({ t: 'spot', target: '', by, team, p: [pos.x, pos.y, pos.z] });
  }

  isLocal(id: string) { return this.soldiers.has(id) || (this.objectives?.hostage?.id === id && this.objectives.hostageLocal); }

  /**
   * Authoritative damage entry point (called by the shooter's client).
   * Local targets take damage immediately; remote targets get a `hit` event.
   */
  damageActor(target: Actor, amount: number, attackerId: string, head: boolean, dir?: THREE.Vector3) {
    if (!target.alive) return;
    const attacker = this.actors.get(attackerId);
    if (attacker && attacker !== target && attacker.side === target.side && !this.friendlyFire) return;
    if (this.isLocal(target.id) && target.damage) {
      const killed = target.damage(amount, attackerId, head, dir);
      for (const h of this.onHurt) h(target, attackerId, amount);
      if (this.soldiers.has(attackerId)) for (const l of this.onLocalHit) l(target, head, killed);
      if (killed) this.reportKill(target.id, attackerId, head);
    } else {
      this.emit({ t: 'hit', target: target.id, attacker: attackerId, dmg: amount, head });
      if (this.soldiers.has(attackerId)) for (const l of this.onLocalHit) l(target, head, false);
    }
  }

  /** remote shooter says one of our actors got hit */
  applyRemoteHit(target: string, attacker: string, dmg: number, head: boolean) {
    const a = this.actors.get(target);
    if (!a || !this.isLocal(target) || !a.damage) return;
    const killed = a.damage(dmg, attacker, head);
    for (const h of this.onHurt) h(a, attacker, dmg);
    if (killed) this.reportKill(target, attacker, head);
  }

  reportKill(victim: string, killer: string, head: boolean) {
    const info = { killer, victim, head, weapon: this.lastWeaponOf.get(killer) ?? '' };
    for (const k of this.onKill) k(info);
    this.emit({ t: 'death', actor: victim, killer, head });
  }
}
