// Constants shared by the browser client and the Cloudflare Durable Object.

export const PROTOCOL_VERSION = 5;

export type Squad = 'A' | 'B';
export type Team = 'attack' | 'defend';
export type MissionType = 'hostage' | 'secure' | 'bomb';
export type TimeOfDay = 'day' | 'night';
export type RoomPhase = 'lobby' | 'prep' | 'action' | 'roundEnd' | 'matchEnd';

/** Objective sites of the original (2015) House. ids are used on the wire. */
export const SITES = [
  { id: 'garage', label: 'B Garage', bombPair: 'training' },
  { id: 'laundry', label: 'B Laundry Room', bombPair: 'training' },
  { id: 'training', label: 'B Training Room', bombPair: 'garage' },
  { id: 'living', label: '1F Living Room', bombPair: 'lobby' },
  { id: 'kitchen', label: '1F Kitchen', bombPair: 'dining' },
  { id: 'dining', label: '1F Dining Room', bombPair: 'kitchen' },
  { id: 'master', label: '2F Master Bedroom', bombPair: 'workshop' },
  { id: 'kids', label: "2F Kids' Room", bombPair: 'hallway2' },
  { id: 'workshop', label: '2F Workshop', bombPair: 'master' },
] as const;
export type SiteId = (typeof SITES)[number]['id'];

export const MISSIONS: MissionType[] = ['hostage', 'secure', 'bomb'];

export const ATTACK_SPAWNS = [
  { id: 'construction', label: 'Construction Site (N)' },
  { id: 'docks', label: 'River Docks (E)' },
  { id: 'apc', label: 'APC Area (SW)' },
  { id: 'sidestreet', label: 'Side Street (S)' },
] as const;
export type SpawnId = (typeof ATTACK_SPAWNS)[number]['id'];

export const ATTACKERS = ['sledge', 'ash', 'thermite', 'thatcher', 'fuze', 'montagne', 'blitz', 'iq'] as const;
export const DEFENDERS = ['smoke', 'mute', 'castle', 'pulse', 'jager', 'bandit', 'kapkan', 'tachanka'] as const;
export type AttackerId = (typeof ATTACKERS)[number];
export type DefenderId = (typeof DEFENDERS)[number];
export type OperatorId = AttackerId | DefenderId | 'terrorist' | 'recruit' | 'hostage';

export const PVP_TIMINGS = { prepMs: 45_000, actionMs: 180_000, roundEndMs: 7_000, winsToMatch: 3 };
export const MAX_ROOM_MEMBERS = 10;

/** Room codes look like `R6-8492`: prefix + 4 digits = 6 significant characters. */
export const ROOM_CODE_RE = /^R6-\d{4}$/;
export function normalizeRoomCode(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '');
  const digits = s.replace(/^R6-?/, '');
  if (!/^\d{4}$/.test(digits)) return null;
  return `R6-${digits}`;
}
export function randomRoomCode(rand: () => number = Math.random): string {
  return `R6-${String(Math.floor(rand() * 10000)).padStart(4, '0')}`;
}
export function sanitizeNickname(input: string): string {
  return input.replace(/[^\p{L}\p{N}_\-. ]/gu, '').trim().slice(0, 16) || 'Recruit';
}
