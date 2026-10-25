import {
  ATTACKERS, DEFENDERS, MAX_ROOM_MEMBERS, MISSIONS, PROTOCOL_VERSION, PVP_TIMINGS, SITES,
  sanitizeNickname, type OperatorId, type Squad,
} from './constants.ts';
import type { ClientMessage, GameEvent, MemberInfo, RoomState, RoundInfo, ServerMessage } from './protocol.ts';
import { teamOf } from './protocol.ts';
import { mulberry32, pick } from './rng.ts';

/**
 * Transport-agnostic authoritative room logic.
 *
 * Runs inside the Cloudflare Durable Object (one instance per 6-char room code)
 * and, for offline/LAN testing, inside the "host" browser tab of the
 * BroadcastChannel loopback transport. It owns: membership, squads/loadouts,
 * round generation (random mission + site + day/night), phase timers,
 * win conditions and the destruction log replayed to late joiners.
 */
export interface RoomIO {
  send(connId: string, msg: ServerMessage): void;
  broadcast(msg: ServerMessage, exceptConn?: string): void;
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
  random(): number;
}

const MAX_LOG = 6000;

export class RoomLogic {
  readonly state: RoomState;
  private conns = new Set<string>();
  private log: GameEvent[] = [];
  private timer: unknown = null;
  private agentCounter = 0;

  constructor(code: string, private io: RoomIO) {
    this.state = { code, phase: 'lobby', hostId: '', members: [], round: null, score: { A: 0, B: 0 }, serverTime: io.now() };
  }

  get connectionCount() { return this.conns.size; }

  onConnect(connId: string) {
    this.conns.add(connId);
  }

  onDisconnect(connId: string) {
    this.conns.delete(connId);
    this.state.members = this.state.members.filter((m) => m.ownerId !== connId);
    if (this.state.hostId === connId) this.state.hostId = this.state.members.find((m) => !m.isAgent)?.id ?? '';
    if (this.state.members.length === 0) this.resetToLobby();
    this.checkElimination();
    this.pushState();
  }

  onMessage(connId: string, msg: ClientMessage) {
    switch (msg.type) {
      case 'hello': {
        if (msg.version !== PROTOCOL_VERSION) {
          this.io.send(connId, { type: 'error', message: `protocol mismatch (server ${PROTOCOL_VERSION}, client ${msg.version}) — hard refresh` });
          return;
        }
        if (this.state.members.length >= MAX_ROOM_MEMBERS) {
          this.io.send(connId, { type: 'error', message: 'room is full' });
          return;
        }
        const nickname = this.uniqueNick(sanitizeNickname(msg.nickname));
        const squad = this.smallerSquad();
        const member: MemberInfo = {
          id: connId, nickname, squad, operator: this.defaultOperator(squad), spawn: 'construction',
          ready: false, isAgent: msg.isAgent, ownerId: connId, alive: this.state.phase === 'lobby', kills: 0, deaths: 0,
        };
        // join mid-round as dead spectator
        if (this.state.phase !== 'lobby') member.alive = false;
        this.state.members.push(member);
        if (!this.state.hostId) this.state.hostId = connId;
        this.io.send(connId, { type: 'welcome', selfId: connId, state: this.snapshot(), log: this.log });
        this.pushState(connId);
        return;
      }
      case 'add_agent': {
        if (!this.member(connId)) return;
        if (this.state.members.length >= MAX_ROOM_MEMBERS) {
          this.io.send(connId, { type: 'error', message: 'room is full' });
          return;
        }
        const id = `${connId}#agent${++this.agentCounter}`;
        const squad = this.smallerSquad();
        this.state.members.push({
          id, nickname: this.uniqueNick(sanitizeNickname(msg.nickname || 'WebMCP-Agent')), squad,
          operator: this.defaultOperator(squad), spawn: 'docks', ready: true, isAgent: true, ownerId: connId,
          alive: this.state.phase === 'lobby', kills: 0, deaths: 0,
        });
        this.pushState();
        return;
      }
      case 'remove_agent': {
        this.state.members = this.state.members.filter((m) => !(m.id === msg.id && m.ownerId === connId && m.isAgent));
        this.pushState();
        return;
      }
      case 'loadout': {
        const m = this.member(msg.actor);
        if (!m || m.ownerId !== connId) return;
        if (msg.squad && this.state.phase === 'lobby') {
          m.squad = msg.squad;
          m.operator = this.defaultOperator(msg.squad);
        }
        if (msg.operator) m.operator = msg.operator;
        if (msg.spawn) m.spawn = msg.spawn;
        if (msg.ready !== undefined) m.ready = msg.ready;
        this.pushState();
        return;
      }
      case 'start_match': {
        if (connId !== this.state.hostId || this.state.phase !== 'lobby') return;
        this.state.score = { A: 0, B: 0 };
        for (const m of this.state.members) { m.kills = 0; m.deaths = 0; }
        this.startRound(0);
        return;
      }
      case 'rtc': {
        if (this.conns.has(msg.to)) this.io.send(msg.to, { type: 'rtc', from: connId, data: msg.data });
        return;
      }
      case 'relay': {
        this.io.broadcast({ type: 'relay', from: connId, snaps: msg.snaps, fast: msg.fast }, connId);
        return;
      }
      case 'event': {
        this.handleEvent(connId, msg.ev);
        return;
      }
      case 'ping': {
        this.io.send(connId, { type: 'pong', t: msg.t, serverTime: this.io.now() });
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ events */
  private handleEvent(connId: string, ev: GameEvent) {
    if (ev.t === 'cells' || ev.t === 'barricade' || ev.t === 'reinforce') {
      if (this.log.length < MAX_LOG) this.log.push(ev);
    }
    this.io.broadcast({ type: 'event', from: connId, ev }, connId);

    const round = this.state.round;
    if (!round || (this.state.phase !== 'action' && this.state.phase !== 'prep')) return;

    if (ev.t === 'death') {
      const victim = this.member(ev.actor);
      if (victim && victim.alive) {
        victim.alive = false;
        victim.deaths++;
        const killer = this.member(ev.killer);
        if (killer && killer.id !== victim.id) killer.kills++;
        this.checkElimination();
        this.pushState();
      }
      return;
    }
    if (ev.t !== 'objective') return;
    const actor = this.member(ev.actor);
    const actorTeam = actor ? teamOf(actor, round) : 'attack';
    const atk = round.attackSquad;
    const def: Squad = atk === 'A' ? 'B' : 'A';
    switch (ev.kind) {
      case 'defuser_planted':
        if (round.mission === 'bomb' && !round.defuserEndsAt) {
          round.defuserEndsAt = this.io.now() + 30_000;
          this.schedulePhase();
          this.pushState();
        }
        break;
      case 'defuser_disabled':
        if (round.defuserEndsAt) this.endRound(def, 'Defuser disabled');
        break;
      case 'defuser_complete':
        if (round.defuserEndsAt) this.endRound(atk, 'Bomb defused');
        break;
      case 'secure_complete':
        this.endRound(atk, 'Area secured');
        break;
      case 'hostage_extracted':
        this.endRound(atk, 'Hostage extracted');
        break;
      case 'hostage_killed':
        this.endRound(actorTeam === 'attack' ? def : atk, actorTeam === 'attack' ? 'Hostage killed by attackers' : 'Hostage killed by defenders');
        break;
    }
  }

  /* ------------------------------------------------------------------ rounds */
  private startRound(index: number) {
    const now = this.io.now();
    const seed = Math.floor(this.io.random() * 2 ** 31);
    const rand = mulberry32(seed);
    const mission = pick(MISSIONS, rand);
    const site = pick(SITES, rand).id;
    const timeOfDay = rand() < 0.5 ? 'day' : 'night';
    const attackSquad: Squad = index % 2 === 0 ? 'A' : 'B';
    const round: RoundInfo = {
      index, seed, mission, site, timeOfDay, attackSquad, startedAt: now,
      prepEndsAt: now + PVP_TIMINGS.prepMs, actionEndsAt: now + PVP_TIMINGS.prepMs + PVP_TIMINGS.actionMs,
    };
    this.state.round = round;
    this.state.phase = 'prep';
    this.log = [];
    for (const m of this.state.members) {
      m.alive = true;
      const team = teamOf(m, round);
      const valid = team === 'attack' ? (ATTACKERS as readonly string[]) : (DEFENDERS as readonly string[]);
      if (!valid.includes(m.operator)) m.operator = this.defaultOperator(m.squad, round);
    }
    this.schedulePhase();
    this.pushState();
  }

  private schedulePhase() {
    if (this.timer) this.io.clearTimer(this.timer);
    const r = this.state.round;
    if (!r) return;
    const now = this.io.now();
    let at = 0;
    if (this.state.phase === 'prep') at = r.prepEndsAt;
    else if (this.state.phase === 'action') at = r.defuserEndsAt ?? r.actionEndsAt;
    else if (this.state.phase === 'roundEnd') at = now + PVP_TIMINGS.roundEndMs;
    if (!at) return;
    this.timer = this.io.setTimer(Math.max(0, at - now), () => this.onPhaseTimer());
  }

  private onPhaseTimer() {
    const r = this.state.round;
    if (!r) return;
    if (this.state.phase === 'prep') {
      this.state.phase = 'action';
      this.schedulePhase();
      this.pushState();
    } else if (this.state.phase === 'action') {
      const def: Squad = r.attackSquad === 'A' ? 'B' : 'A';
      if (r.defuserEndsAt) this.endRound(r.attackSquad, 'Defuser completed');
      else this.endRound(def, 'Time expired');
    } else if (this.state.phase === 'roundEnd') {
      const wins = PVP_TIMINGS.winsToMatch;
      if (this.state.score.A >= wins || this.state.score.B >= wins) {
        this.state.phase = 'matchEnd';
        this.timer = this.io.setTimer(12_000, () => { this.resetToLobby(); this.pushState(); });
        this.pushState();
      } else this.startRound(r.index + 1);
    }
  }

  private endRound(winner: Squad, reason: string) {
    const r = this.state.round;
    if (!r || this.state.phase === 'roundEnd' || this.state.phase === 'matchEnd') return;
    r.winner = winner;
    r.reason = reason;
    this.state.score[winner]++;
    this.state.phase = 'roundEnd';
    this.schedulePhase();
    this.pushState();
  }

  private checkElimination() {
    const r = this.state.round;
    if (!r || (this.state.phase !== 'action' && this.state.phase !== 'prep')) return;
    const atk = this.state.members.filter((m) => m.squad === r.attackSquad);
    const def = this.state.members.filter((m) => m.squad !== r.attackSquad);
    if (atk.length === 0 || def.length === 0) return; // solo testing room — never auto-end
    const atkAlive = atk.some((m) => m.alive);
    const defAlive = def.some((m) => m.alive);
    const defSquad: Squad = r.attackSquad === 'A' ? 'B' : 'A';
    if (!atkAlive && !r.defuserEndsAt) this.endRound(defSquad, 'Attackers eliminated');
    else if (!defAlive) this.endRound(r.attackSquad, 'Defenders eliminated');
  }

  private resetToLobby() {
    if (this.timer) this.io.clearTimer(this.timer);
    this.timer = null;
    this.state.phase = 'lobby';
    this.state.round = null;
    this.log = [];
    for (const m of this.state.members) { m.alive = true; m.ready = m.isAgent; }
  }

  /* ----------------------------------------------------------------- helpers */
  private member(id: string) { return this.state.members.find((m) => m.id === id); }

  private smallerSquad(): Squad {
    const a = this.state.members.filter((m) => m.squad === 'A').length;
    const b = this.state.members.length - a;
    return a <= b ? 'A' : 'B';
  }

  private defaultOperator(squad: Squad, round: RoundInfo | null = this.state.round): OperatorId {
    const team = teamOf({ squad }, round);
    const pool = team === 'attack' ? ATTACKERS : DEFENDERS;
    const taken = new Set(this.state.members.map((m) => m.operator));
    return (pool.find((o) => !taken.has(o)) ?? pool[0]) as OperatorId;
  }

  private uniqueNick(n: string): string {
    const names = new Set(this.state.members.map((m) => m.nickname.toLowerCase()));
    if (!names.has(n.toLowerCase())) return n;
    for (let i = 2; i < 100; i++) if (!names.has(`${n}${i}`.toLowerCase())) return `${n}${i}`;
    return `${n}${Math.floor(this.io.random() * 1e4)}`;
  }

  private snapshot(): RoomState {
    this.state.serverTime = this.io.now();
    return JSON.parse(JSON.stringify(this.state));
  }

  private pushState(_extra?: string) {
    this.io.broadcast({ type: 'state', state: this.snapshot() });
  }
}
