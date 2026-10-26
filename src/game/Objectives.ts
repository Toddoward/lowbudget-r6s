import * as THREE from 'three';
import { G_WORLD } from '../core/Physics.ts';
import { ROOMS, SPAWN_ZONES, FLOOR_Y, type Rect } from '../map/houseLayout.ts';
import { inRect } from '../map/geometry.ts';
import { SITES, type SiteId } from '../../shared/constants.ts';
import { computeHitboxes, type Actor, type Hitboxes } from './Actor.ts';
import { Stance } from './types.ts';
import { Rig } from '../render/Rig.ts';
import { buildAsset } from '../assets/build.ts';
import { box } from '../assets/spec.ts';
import type { Soldier } from './Soldier.ts';
import type { World } from './World.ts';

export type Mission = 'hostage' | 'secure' | 'bomb' | 'elimination';

/** The hostage NPC: kneels until an attacker picks them up, then follows the carrier. */
export class Hostage implements Actor {
  id = 'hostage';
  name = 'Hostage';
  side = 'hostage' as const;
  kind = 'hostage' as const;
  operator = 'hostage';
  alive = true;
  hp = 100;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance = Stance.Crouch;
  lean = 0;
  inverted = false;
  weaponId = null;
  carrier: string | null = null;
  rig: Rig;
  constructor(scene: THREE.Scene) {
    this.rig = new Rig('hostage', null, 'HOSTAGE', '#ffd54a');
    scene.add(this.rig.root);
  }
  eye(out = new THREE.Vector3()) { return out.copy(this.pos).add(new THREE.Vector3(0, this.stance === Stance.Crouch ? 1.1 : 1.6, 0)); }
  hitboxes(): Hitboxes { return computeHitboxes(this.pos, this.yaw, this.stance, 0, false); }
  damage(amount: number) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) { this.alive = false; this.rig.setDead(true); return true; }
    return false;
  }
}

interface Bomb { id: number; pos: THREE.Vector3; room: string; state: 'armed' | 'defused'; mesh: THREE.Object3D }

export interface ObjectiveStatus {
  mission: Mission;
  site: string;
  siteLabel: string;
  text: string;
  /** i18n key + args (args are English place names → localizePlace) */
  key: string;
  args: string[];
  progress: number;
  defuserEndsIn?: number;
}

/**
 * Mission logic for both Terrorist Hunt (local, `onResult`) and PvP
 * (events → Durable Object decides the round). Positions come from the site
 * room's objective spot in houseLayout.
 */
export class Objectives {
  mission: Mission = 'elimination';
  site: SiteId = 'garage';
  mode: 'th' | 'pvp' = 'th';
  hostage: Hostage | null = null;
  hostageLocal = true;
  bombs: Bomb[] = [];
  container: { pos: THREE.Vector3; room: string; mesh: THREE.Object3D } | null = null;
  defuser: { bomb: number; pos: THREE.Vector3; endsAt: number; mesh: THREE.Object3D } | null = null;
  secureProgress = 0;
  secureContested = false;
  /** PvP: this client computes secure-area progress (room host) */
  authority = true;
  onResult?: (attackWin: boolean, reason: string) => void;
  private group = new THREE.Group();
  private done = false;
  private hold = new Map<string, { key: string; t: number }>();
  serverClockOffset = 0;

  constructor(private world: World) {
    world.scene.add(this.group);
    world.onKill.push((k) => {
      if (this.hostage && k.victim === this.hostage.id) {
        const killer = world.actors.get(k.killer);
        const byAttacker = !killer || killer.side === 'attack';
        if (this.mode === 'pvp') world.emit({ t: 'objective', kind: 'hostage_killed', actor: k.killer });
        this.finish(!byAttacker, byAttacker ? 'Hostage killed by attackers' : 'Hostage killed by defenders');
      }
    });
  }

  hostageIds() { return this.hostage ? [this.hostage.id] : []; }

  siteLabel(id: string = this.site) {
    return SITES.find((s) => s.id === id)?.label ?? ROOMS.find((r) => r.id === id)?.name ?? id;
  }

  /** nav-backed resolver (set by Game): nearest free floor point in a room */
  freeSpot?: (roomId: string, near: THREE.Vector3) => THREE.Vector3 | null;

  spotOf(roomId: string): THREE.Vector3 {
    const room = ROOMS.find((r) => r.id === roomId) ?? ROOMS[0];
    const y = FLOOR_Y[room.floor];
    const p = new THREE.Vector3(room.spot[0], y + 1.2, room.spot[1]);
    const hit = this.world.physics.raycast(p, new THREE.Vector3(0, -1, 0), 2, G_WORLD);
    p.y = hit ? hit.point.y : y;
    // the authored spot may be under furniture: use the nearest free floor point in the room
    if (Math.abs(p.y - y) > 0.12 || this.world.physics.overlapsWorld(p.clone().setY(y + 0.5), 0.4)) {
      const alt = this.freeSpot?.(roomId, p);
      if (alt) return alt;
    }
    return p;
  }

  setup(mission: Mission, site: SiteId, mode: 'th' | 'pvp') {
    this.clear();
    this.mission = mission;
    this.site = site;
    this.mode = mode;
    this.done = false;
    if (mission === 'hostage') {
      this.hostage = new Hostage(this.world.scene);
      this.hostage.pos.copy(this.spotOf(site));
      this.world.actors.set(this.hostage.id, this.hostage);
    } else if (mission === 'bomb') {
      const pair = SITES.find((s) => s.id === site)?.bombPair ?? 'training';
      [site, pair].forEach((room, i) => {
        const mesh = buildAsset({ id: 'bomb', category: 'prop', parts: [box([0, 0.2, 0], [0.55, 0.4, 0.4], '#2b2e33'), box([0, 0.42, 0], [0.3, 0.04, 0.2], '#c83a2a', { emissive: true }), box([0.18, 0.3, -0.21], [0.12, 0.08, 0.02], '#3aff7a', { emissive: true })] });
        const pos = this.spotOf(room);
        mesh.position.copy(pos);
        this.group.add(mesh);
        this.bombs.push({ id: i, pos, room, state: 'armed', mesh });
      });
    } else if (mission === 'secure') {
      const mesh = buildAsset({ id: 'biohazard', category: 'prop', parts: [box([0, 0.45, 0], [0.7, 0.9, 0.7], '#c9b23a'), box([0, 0.92, 0], [0.5, 0.06, 0.5], '#222'), box([0, 0.5, -0.36], [0.3, 0.3, 0.02], '#141414')] });
      const pos = this.spotOf(site);
      mesh.position.copy(pos);
      this.group.add(mesh);
      this.container = { pos, room: site, mesh };
      this.world.physics.addBox(pos.x, pos.y + 0.45, pos.z, 0.35, 0.45, 0.35, { kind: 'static', mat: 'metal' });
    }
  }

  clear() {
    if (this.hostage) {
      this.world.scene.remove(this.hostage.rig.root);
      this.world.actors.delete(this.hostage.id);
      this.hostage = null;
    }
    this.group.clear();
    this.bombs = [];
    this.container = null;
    this.defuser = null;
    this.secureProgress = 0;
    this.hold.clear();
  }

  private finish(attackWin: boolean, reason: string) {
    if (this.done) return;
    this.done = true;
    this.onResult?.(attackWin, reason);
  }

  roomOfSite(): string[] {
    if (this.mission === 'bomb') return this.bombs.map((b) => b.room);
    return [this.site];
  }

  inRoom(p: THREE.Vector3, roomId: string) {
    const r = ROOMS.find((x) => x.id === roomId);
    if (!r) return false;
    const y = FLOOR_Y[r.floor];
    return p.y > y - 0.5 && p.y < y + 2.9 && r.rects.some((rc) => inRect(rc, p.x, p.z));
  }

  inExtraction(p: THREE.Vector3): boolean {
    return SPAWN_ZONES.some((z) => inRect(z.extract as Rect, p.x, p.z));
  }

  /* -------------------------------------------------------------- interact */
  candidate(s: Soldier): { key: string; label: string; hold: number; run: () => void } | null {
    const attack = s.side === 'attack';
    const defend = s.side === 'defend';
    if (this.hostage && this.hostage.alive && attack) {
      if (this.hostage.carrier === s.id) return { key: 'drop', label: 'action.putDownHostage', hold: 0, run: () => this.setCarrier(null, true) };
      if (!this.hostage.carrier && this.hostage.pos.distanceTo(s.pos) < 1.6) return { key: 'pick', label: 'action.secureHostage', hold: 1.2, run: () => this.setCarrier(s.id, true) };
    }
    if (this.mission === 'bomb') {
      for (const b of this.bombs) {
        if (b.state !== 'armed' || b.pos.distanceTo(s.pos) > 1.7) continue;
        if (this.mode === 'th' && attack) return { key: `dis${b.id}`, label: 'action.disarmBomb', hold: 6, run: () => this.disarmTH(b) };
        if (this.mode === 'pvp' && attack && !this.defuser) return { key: `plant${b.id}`, label: 'action.plantDefuser', hold: 4, run: () => this.plantDefuser(b.id, s.id, true) };
      }
      if (this.mode === 'pvp' && defend && this.defuser && this.defuser.pos.distanceTo(s.pos) < 1.7) {
        return { key: 'disable', label: 'action.disableDefuser', hold: 4, run: () => { this.world.emit({ t: 'objective', kind: 'defuser_disabled', actor: s.id }); this.removeDefuser(); } };
      }
    }
    return null;
  }

  setCarrier(id: string | null, broadcast: boolean) {
    if (!this.hostage) return;
    this.hostage.carrier = id;
    this.hostage.stance = id ? Stance.Stand : Stance.Crouch;
    if (broadcast) this.world.emit({ t: 'objective', kind: id ? 'hostage_pickup' : 'hostage_drop', actor: id ?? '', data: { p: this.hostage.pos.toArray() } });
  }

  private disarmTH(b: Bomb) {
    b.state = 'defused';
    const glow = b.mesh.getObjectByName('_glow');
    if (glow) glow.visible = false;
    this.world.sound({ type: 'voice', pos: b.pos.clone(), radius: 80, source: 'bomb', intensity: 1, label: 'bomb_disarmed' });
    if (this.bombs.every((x) => x.state === 'defused')) this.finish(true, 'Bombs disarmed');
  }

  plantDefuser(bombId: number, actor: string, broadcast: boolean, endsAt?: number) {
    const b = this.bombs[bombId];
    if (!b || this.defuser) return;
    const mesh = buildAsset({ id: 'defuser', category: 'gadget', parts: [box([0, 0.08, 0], [0.25, 0.16, 0.18], '#2a2c30'), box([0, 0.17, 0], [0.12, 0.02, 0.08], '#ff2020', { emissive: true })] });
    mesh.position.copy(b.pos).add(new THREE.Vector3(0.45, 0, 0));
    this.group.add(mesh);
    this.defuser = { bomb: bombId, pos: mesh.position.clone(), endsAt: endsAt ?? this.world.time + 30, mesh };
    this.world.sound({ type: 'voice', pos: b.pos.clone(), radius: 80, source: actor, intensity: 1, label: 'defuser_planted' });
    if (broadcast) this.world.emit({ t: 'objective', kind: 'defuser_planted', actor, data: { bomb: bombId } });
  }

  removeDefuser() {
    if (this.defuser) this.group.remove(this.defuser.mesh);
    this.defuser = null;
  }

  /** PvP: apply objective events from peers */
  remote(kind: string, actor: string, data?: Record<string, unknown>) {
    if (kind === 'hostage_pickup') this.setCarrier(actor, false);
    else if (kind === 'hostage_drop') { this.setCarrier(null, false); if (data?.p && this.hostage) this.hostage.pos.fromArray(data.p as number[]); }
    else if (kind === 'defuser_planted') this.plantDefuser((data?.bomb as number) ?? 0, actor, false);
    else if (kind === 'defuser_disabled') this.removeDefuser();
  }

  /* -------------------------------------------------------------- update */
  update(dt: number) {
    const w = this.world;
    const h = this.hostage;
    if (h) {
      const carrier = h.carrier ? w.actors.get(h.carrier) : null;
      if (carrier && (!carrier.alive)) h.carrier = null;
      if (h.carrier && carrier) {
        const back = new THREE.Vector3(Math.sin(carrier.yaw), 0, Math.cos(carrier.yaw)).multiplyScalar(0.7);
        const target = carrier.pos.clone().add(back);
        h.pos.lerp(target, Math.min(1, dt * 6));
        h.yaw = carrier.yaw;
        h.stance = carrier.stance === Stance.Prone ? Stance.Crouch : carrier.stance === Stance.Crouch ? Stance.Crouch : Stance.Stand;
        if (this.inExtraction(h.pos) && w.isLocal(h.carrier)) {
          if (this.mode === 'pvp') w.emit({ t: 'objective', kind: 'hostage_extracted', actor: h.carrier });
          this.finish(true, 'Hostage extracted');
        }
      }
      h.rig.root.position.copy(h.pos);
      h.rig.root.rotation.y = h.yaw;
      h.rig.pose(dt, h.stance, 0, 0, h.carrier ? 2 : 0);
    }
    if (this.mission === 'secure' && this.container && this.authority && !this.done) {
      let atk = 0;
      let def = 0;
      for (const a of w.actors.values()) {
        if (!w.targetable(a) || !this.inRoom(a.pos, this.container.room)) continue;
        if (a.side === 'attack') atk++;
        else if (a.side === 'defend' || a.side === 'terrorist') def++;
      }
      this.secureContested = atk > 0 && def > 0;
      if (atk > 0 && def === 0) this.secureProgress += dt;
      else if (atk === 0) this.secureProgress = Math.max(0, this.secureProgress - dt * 0.5);
      if (this.secureProgress >= 10) {
        if (this.mode === 'pvp') w.emit({ t: 'objective', kind: 'secure_complete', actor: w.localId });
        this.finish(true, 'Area secured');
      }
    }
    if (this.defuser) this.defuser.mesh.rotation.y += dt;
    for (const b of this.bombs) {
      const glow = b.state === 'armed' ? b.mesh.getObjectByName('_glow') : undefined;
      if (glow) glow.visible = Math.floor(w.time * 2) % 2 === 0;
    }
  }

  status(): ObjectiveStatus {
    const label = this.siteLabel();
    switch (this.mission) {
      case 'hostage': {
        const h = this.hostage;
        const text = !h ? '' : !h.alive ? 'Hostage KIA' : h.carrier ? 'Escort the hostage to an extraction zone' : `Locate & secure the hostage — ${label}`;
        const key = !h ? '' : !h.alive ? 'obj.hostageKia' : h.carrier ? 'obj.escort' : 'obj.locateHostage';
        return { mission: 'hostage', site: this.site, siteLabel: label, text, key, args: [label], progress: 0 };
      }
      case 'bomb': {
        const left = this.bombs.filter((b) => b.state === 'armed').length;
        if (this.mode === 'pvp') {
          const defIn = this.defuser ? Math.max(0, this.defuser.endsAt - (Date.now() + this.serverClockOffset) / 1000) : undefined;
          return { mission: 'bomb', site: this.site, siteLabel: `${label} / ${this.siteLabel(this.bombs[1]?.room)}`, text: this.defuser ? 'Defuser planted — protect it!' : 'Plant the defuser on a bomb', key: this.defuser ? 'obj.protectDefuser' : 'obj.plantDefuser', args: [], progress: 0, defuserEndsIn: defIn };
        }
        return { mission: 'bomb', site: this.site, siteLabel: `${label} / ${this.siteLabel(this.bombs[1]?.room)}`, text: `Disarm the bombs (${left} left)`, key: 'obj.disarm', args: [String(left)], progress: 0 };
      }
      case 'secure':
        return { mission: 'secure', site: this.site, siteLabel: label, text: this.secureContested ? 'CONTESTED — clear the room' : `Secure the biohazard container — ${label}`, key: this.secureContested ? 'obj.contested' : 'obj.secure', args: [label], progress: this.secureProgress / 10 };
      default:
        return { mission: 'elimination', site: this.site, siteLabel: label, text: 'Eliminate all White Masks', key: 'obj.eliminate', args: [], progress: 0 };
    }
  }

  checkElimination(enemiesAlive: number) {
    if (this.mission === 'elimination' && enemiesAlive === 0) this.finish(true, 'All hostiles eliminated');
  }

  get finished() { return this.done; }
}
