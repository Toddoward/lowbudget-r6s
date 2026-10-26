import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomLogic, type RoomIO } from '../../shared/roomLogic.ts';
import { normalizeRoomCode, PROTOCOL_VERSION, PVP_TIMINGS } from '../../shared/constants.ts';
import type { ServerMessage } from '../../shared/protocol.ts';

function harness() {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let tid = 0;
  const inbox = new Map<string, ServerMessage[]>();
  const conns = new Set<string>();
  const io: RoomIO = {
    send: (id, m) => { inbox.get(id)?.push(m); },
    broadcast: (m, except) => { for (const c of conns) if (c !== except) inbox.get(c)!.push(m); },
    now: () => now,
    setTimer: (ms, fn) => { const t = { at: now + ms, fn, id: ++tid }; timers.push(t); return t.id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    random: () => 0.42,
  };
  const room = new RoomLogic('R6-1234', io);
  const join = (id: string, nick: string) => { conns.add(id); inbox.set(id, []); room.onConnect(id); room.onMessage(id, { type: 'hello', nickname: nick, isAgent: false, version: PROTOCOL_VERSION }); };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > now) break;
      timers.shift();
      t.fn();
    }
  };
  return { room, join, advance, inbox };
}

test('room codes normalise to R6-0000', () => {
  assert.equal(normalizeRoomCode('r6-8492'), 'R6-8492');
  assert.equal(normalizeRoomCode(' 8492 '), 'R6-8492');
  assert.equal(normalizeRoomCode('R68492'), 'R6-8492');
  assert.equal(normalizeRoomCode('R6-84'), null);
});

test('join balances squads, dedupes nicknames, agents are owned by their connection', () => {
  const h = harness();
  h.join('a', 'Ash');
  h.join('b', 'Ash');
  const st = h.room.state;
  assert.deepEqual(st.members.map((m) => m.nickname), ['Ash', 'Ash2']);
  assert.deepEqual(st.members.map((m) => m.squad), ['A', 'B']);
  assert.equal(st.hostId, 'a');
  h.room.onMessage('a', { type: 'add_agent', nickname: 'Bot' });
  const agent = h.room.state.members.find((m) => m.isAgent)!;
  assert.equal(agent.ownerId, 'a');
  assert.ok(agent.id.startsWith('a#agent'));
  h.room.onDisconnect('a');
  assert.equal(h.room.state.members.length, 1, 'agents leave with their owner');
  assert.equal(h.room.state.hostId, 'b', 'host migrates');
});

test('match flow: random round → prep → action → elimination → swap sides → match end', () => {
  const h = harness();
  h.join('a', 'Alpha');
  h.join('b', 'Bravo');
  h.room.onMessage('a', { type: 'start_match' });
  let st = h.room.state;
  assert.equal(st.phase, 'prep');
  assert.ok(['hostage', 'secure', 'bomb'].includes(st.round!.mission));
  assert.ok(['day', 'night'].includes(st.round!.timeOfDay));
  assert.equal(st.round!.attackSquad, 'A');
  assert.equal(st.members.find((m) => m.id === 'a')!.operator, 'sledge', 'attacker gets an attacker operator');
  assert.equal(st.members.find((m) => m.id === 'b')!.operator, 'smoke', 'defender gets a defender operator');
  h.advance(PVP_TIMINGS.prepMs + 1);
  assert.equal(h.room.state.phase, 'action');
  // defender dies → attackers win round 1
  h.room.onMessage('a', { type: 'event', ev: { t: 'death', actor: 'b', killer: 'a', head: true } });
  st = h.room.state;
  assert.equal(st.phase, 'roundEnd');
  assert.equal(st.score.A, 1);
  assert.equal(st.members.find((m) => m.id === 'a')!.kills, 1);
  h.advance(PVP_TIMINGS.roundEndMs + 1);
  assert.equal(h.room.state.round!.attackSquad, 'B', 'sides swap every round');
  // time out → defenders (A) win
  for (let r = 0; r < 4 && h.room.state.phase !== 'matchEnd'; r++) {
    h.advance(PVP_TIMINGS.prepMs + PVP_TIMINGS.actionMs + 2);
    h.advance(PVP_TIMINGS.roundEndMs + 1);
  }
  assert.equal(h.room.state.phase, 'matchEnd');
  assert.ok(h.room.state.score.A >= 3 || h.room.state.score.B >= 3);
});

test('bomb: planted defuser extends the round and completes for attackers', () => {
  const h = harness();
  h.join('a', 'Alpha');
  h.join('b', 'Bravo');
  h.room.onMessage('a', { type: 'start_match' });
  h.room.state.round!.mission = 'bomb';
  h.advance(PVP_TIMINGS.prepMs + 1);
  h.advance(PVP_TIMINGS.actionMs - 5000);
  h.room.onMessage('a', { type: 'event', ev: { t: 'objective', kind: 'defuser_planted', actor: 'a', data: { bomb: 0 } } });
  assert.ok(h.room.state.round!.defuserEndsAt);
  h.advance(10_000); // past the normal action end, still running
  assert.equal(h.room.state.phase, 'action');
  h.advance(30_000);
  assert.equal(h.room.state.phase, 'roundEnd');
  assert.equal(h.room.state.round!.winner, 'A');
});

test('hostage killed by an attacker loses the round for attackers; destruction is logged for late joiners', () => {
  const h = harness();
  h.join('a', 'Alpha');
  h.join('b', 'Bravo');
  h.room.onMessage('a', { type: 'start_match' });
  h.advance(PVP_TIMINGS.prepMs + 1);
  h.room.onMessage('a', { type: 'event', ev: { t: 'cells', panel: 7, cells: [1, 2, 3], dmg: 999 } });
  h.join('c', 'Charlie');
  const welcome = h.inbox.get('c')!.find((m) => m.type === 'welcome');
  assert.ok(welcome && welcome.type === 'welcome' && welcome.log.length === 1, 'late joiner receives the destruction log');
  h.room.onMessage('a', { type: 'event', ev: { t: 'objective', kind: 'hostage_killed', actor: 'a' } });
  assert.equal(h.room.state.round!.winner, 'B');
});
