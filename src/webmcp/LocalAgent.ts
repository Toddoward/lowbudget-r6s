import * as THREE from 'three';
import type { NavGraph } from '../ai/NavGraph.ts';
import type { AgentAction } from './AgentController.ts';
import type { Observation } from './Bridge.ts';

/**
 * Built-in simulated WebMCP agent ("test agent slot"). It is deliberately
 * written as an *external* agent would be: it only reads the Observation
 * JSON (self / vision / acoustic / match — the same data an LLM gets from the
 * DOM) plus the public map knowledge, and only acts through AgentAction.
 */
export class LocalAgent {
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private replanT = 0;
  private goalKey = '';
  private strafe = 1;
  private strafeT = 0;
  private investigate: { bearing: number; until: number } | null = null;
  private lastEnemyHeading: { h: number; t: number } | null = null;
  private holdYaw = 0;

  constructor(private nav: NavGraph, readonly name: string) {}

  think(o: Observation, dt: number): AgentAction | null {
    const s = o.self;
    if (!s || !s.alive) return null;
    const now = performance.now();
    const m = o.match as { phase?: string; objectivePos?: [number, number, number]; team?: string };
    const weapon = s.weapon as { ammoInMag?: number; magSize?: number; reserve?: number; reloading?: boolean };
    const act: AgentAction = { durationMs: 260 };
    if (s.weapon.slot !== 'primary' && s.weapon.slot !== 'secondary') act.switchWeapon = 'primary';

    // 1) visible enemy → engage
    const enemy = o.vision.filter((v) => v.kind === 'enemy').sort((a, b) => a.distance - b.distance)[0];
    if (enemy) {
      const yd = enemy.yawDelta;
      const pd = enemy.pitchDelta;
      act.lookLerp = { yawDelta: yd, pitchDelta: pd, rate: 0.32 };
      const on = Math.abs(yd) < Math.max(1.6, 40 / enemy.distance) && Math.abs(pd) < Math.max(1.8, 40 / enemy.distance);
      act.ads = enemy.distance > 6;
      act.fire = on ? { burst: enemy.distance > 15 ? 3 : 5 } : false;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.7 + Math.random(); this.strafe = -this.strafe; }
      act.move = { forward: 0, strafe: enemy.distance > 4 ? this.strafe * 0.6 : 0 };
      act.stance = enemy.distance > 12 ? 'crouch' : 'stand';
      if ((weapon.ammoInMag ?? 1) === 0) act.reload = true;
      this.lastEnemyHeading = { h: s.heading + yd, t: now };
      return act;
    }
    if ((weapon.ammoInMag ?? 99) < (weapon.magSize ?? 30) * 0.35 && (weapon.reserve ?? 0) > 0 && !weapon.reloading) act.reload = true;

    // 2) fresh acoustic cue → turn and investigate
    const cue = o.acoustic.find((c) => c.ageMs < 1200 && c.intensity > 0.12 && (c.type.includes('gunshot') || c.type === 'footstep' || c.type === 'wall_breach' || c.type === 'explosion'));
    if (cue && cue.vertical === 'Same_Floor' && (!this.investigate || now > this.investigate.until)) this.investigate = { bearing: s.heading + cue.bearingDeg, until: now + 2200 };
    if (this.investigate && now < this.investigate.until) {
      act.lookLerp = { yaw: this.investigate.bearing, pitch: 0, rate: 0.2 };
      act.stance = 'crouch';
      act.move = { forward: 0.35 };
      return act;
    }
    if (this.lastEnemyHeading && now - this.lastEnemyHeading.t < 3000) {
      act.lookLerp = { yaw: this.lastEnemyHeading.h, pitch: 0, rate: 0.2 };
      act.stance = 'crouch';
      return act;
    }

    // 3) prep phase: defenders reinforce what they can see; attackers wait
    if (m.phase === 'prep') {
      if (s.team === 'defend') {
        const wall = o.vision.find((v) => (v.kind === 'soft_wall' || v.kind === 'hatch') && v.distance < 1.7 && !(v.state as { reinforced?: boolean }).reinforced);
        if (wall && s.gadgets.reinforcementsLeft > 0) {
          act.lookLerp = { yawDelta: wall.yawDelta, pitchDelta: wall.pitchDelta, rate: 0.3 };
          if (s.interactPrompt?.includes('Reinforce')) act.interact = 'hold';
          act.durationMs = 600;
          return act;
        }
      } else return act;
    }

    // 4) navigate toward the objective (public knowledge) using the static map
    const goal = m.objectivePos ? new THREE.Vector3(...m.objectivePos) : null;
    if (!goal) return act;
    const me = new THREE.Vector3(s.position.x, s.position.y, s.position.z);
    const key = goal.toArray().map((v) => v.toFixed(1)).join(',');
    this.replanT -= dt;
    if (key !== this.goalKey || this.replanT <= 0 || !this.path.length) {
      this.goalKey = key;
      this.replanT = 3;
      this.path = this.nav.path(me, goal) ?? [];
      this.pathIdx = 0;
    }
    while (this.pathIdx < this.path.length && Math.hypot(this.path[this.pathIdx].x - me.x, this.path[this.pathIdx].z - me.z) < 0.6) this.pathIdx++;
    const wp = this.path[this.pathIdx];
    if (!wp || me.distanceTo(goal) < 1.2) {
      // hold the objective: slow scan
      this.holdYaw += dt * 25;
      act.lookLerp = { yaw: s.heading + Math.sin(this.holdYaw * 0.05) * 30, pitch: 0, rate: 0.05 };
      act.stance = 'crouch';
      act.interact = s.interactPrompt?.startsWith('Hold') ? 'hold' : undefined;
      if (s.interactPrompt?.startsWith('Hold')) act.durationMs = 800;
      return act;
    }
    const hdg = THREE.MathUtils.radToDeg(Math.atan2(wp.x - me.x, -(wp.z - me.z)));
    const diff = THREE.MathUtils.euclideanModulo(hdg - s.heading + 180, 360) - 180;
    act.lookLerp = { yaw: hdg, pitch: wp.y > me.y + 0.5 ? 12 : wp.y < me.y - 0.5 ? -12 : 0, rate: 0.22 };
    act.move = { forward: Math.abs(diff) < 50 ? 1 : 0.2, sprint: Math.abs(diff) < 20 && me.distanceTo(goal) > 10 };
    act.stance = 'stand';
    return act;
  }
}
