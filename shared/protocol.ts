import type { MissionType, OperatorId, RoomPhase, SiteId, SpawnId, Squad, Team, TimeOfDay } from './constants.ts';

export interface MemberInfo {
  id: string;
  nickname: string;
  squad: Squad;
  operator: OperatorId;
  spawn: SpawnId;
  ready: boolean;
  /** true for WebMCP agents (external browser agents or local simulated slots) */
  isAgent: boolean;
  /** connection that simulates this member (agents spawned by a tab are owned by that tab) */
  ownerId: string;
  alive: boolean;
  kills: number;
  deaths: number;
}

export interface RoundInfo {
  index: number;
  seed: number;
  mission: MissionType;
  site: SiteId;
  timeOfDay: TimeOfDay;
  attackSquad: Squad;
  /** server epoch ms */
  startedAt: number;
  prepEndsAt: number;
  actionEndsAt: number;
  /** set when a defuser is planted (bomb) — the round is extended until it completes */
  defuserEndsAt?: number;
  winner?: Squad;
  reason?: string;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  members: MemberInfo[];
  round: RoundInfo | null;
  score: Record<Squad, number>;
  serverTime: number;
}

/* ---------------------------------------------------------------- game events
 * Reliable, ordered events relayed by the room (WebSocket). Every event is
 * produced by the client that is authoritative for it (the shooter for hits &
 * destruction, the owner for its own death, the placer for gadgets). Cell
 * damage is commutative so replaying the log in any order converges.
 */
export type GameEvent =
  | { t: 'cells'; panel: number; cells: number[]; dmg: number; src?: string }
  | { t: 'fire'; actor: string; o: number[]; d: number[]; w: string; sup?: boolean }
  | { t: 'hit'; target: string; attacker: string; dmg: number; head: boolean }
  | { t: 'death'; actor: string; killer: string; head: boolean }
  | { t: 'barricade'; opening: number; kind: 'wood' | 'castle' | 'none' }
  | { t: 'reinforce'; panel: number; by: string }
  | { t: 'gadget'; op: 'spawn'; g: NetGadget }
  | { t: 'gadget'; op: 'remove'; id: string }
  | { t: 'gadget'; op: 'trigger'; id: string; p?: number[] }
  | { t: 'explosion'; p: number[]; r: number; kind: string; by: string }
  | { t: 'emp'; p: number[]; r: number; by: string }
  | { t: 'objective'; kind: ObjectiveEventKind; actor: string; data?: Record<string, unknown> }
  | { t: 'spot'; target: string; by: string; team?: string; p?: number[] }
  | { t: 'flash'; p: number[]; d: number[]; by: string };

export type ObjectiveEventKind =
  | 'defuser_planted'
  | 'defuser_disabled'
  | 'defuser_complete'
  | 'secure_complete'
  | 'hostage_pickup'
  | 'hostage_drop'
  | 'hostage_extracted'
  | 'hostage_killed';

export interface NetGadget {
  id: string;
  type: string;
  owner: string;
  p: number[];
  n?: number[];
  v?: number[];
  data?: Record<string, unknown>;
}

/** High-frequency actor snapshot (WebRTC DataChannel, falls back to WS relay). */
export interface ActorSnapshot {
  id: string;
  /** sender clock ms */
  t: number;
  p: [number, number, number];
  v: [number, number, number];
  yaw: number;
  pitch: number;
  /** 0 stand 1 crouch 2 prone 3 rappel 4 rappel-inverted 5 drone */
  st: number;
  lean: number;
  w: number;
  hp: number;
  alive: boolean;
  ads: boolean;
  /** drone position while droning (prep phase) */
  dr?: [number, number, number];
}

/* ------------------------------------------------------------ client → server */
export type ClientMessage =
  | { type: 'hello'; nickname: string; isAgent: boolean; version: number }
  | { type: 'add_agent'; nickname: string }
  | { type: 'remove_agent'; id: string }
  | { type: 'loadout'; actor: string; squad?: Squad; operator?: OperatorId; spawn?: SpawnId; ready?: boolean }
  | { type: 'start_match' }
  | { type: 'rtc'; to: string; data: RtcSignal }
  | { type: 'relay'; snaps: ActorSnapshot[]; fast?: FastEvent[] }
  | { type: 'event'; ev: GameEvent }
  | { type: 'ping'; t: number };

/** low-latency, loss-tolerant events (DataChannel first, WS relay fallback, de-duplicated by `n`) */
export interface FastEvent { n: number; ev: GameEvent }

export type RtcSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateLike };

export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

/* ------------------------------------------------------------ server → client */
export type ServerMessage =
  | { type: 'welcome'; selfId: string; state: RoomState; log: GameEvent[] }
  | { type: 'state'; state: RoomState }
  | { type: 'rtc'; from: string; data: RtcSignal }
  | { type: 'relay'; from: string; snaps: ActorSnapshot[]; fast?: FastEvent[] }
  | { type: 'event'; from: string; ev: GameEvent }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; message: string };

export function teamOf(member: Pick<MemberInfo, 'squad'>, round: RoundInfo | null): Team {
  if (!round) return member.squad === 'A' ? 'attack' : 'defend';
  return member.squad === round.attackSquad ? 'attack' : 'defend';
}
