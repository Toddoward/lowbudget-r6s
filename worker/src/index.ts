/**
 * r6-matchmaker — Cloudflare Worker + Durable Object.
 *
 *   GET /api/room/R6-1234  (Upgrade: websocket)  → RoomDO instance "R6-1234"
 *   GET /api/health
 *
 * Every 6-character room code maps (idFromName) to exactly one Durable Object,
 * so everyone typing the same code lands in the same in-memory room. The DO is
 * the WebSocket hub: room state, WebRTC signaling (offer/answer/ICE), snapshot
 * relay fallback for peers whose DataChannel could not be established and the
 * reliable game-event stream (destruction bitmask deltas, gadgets, objectives).
 */
import { normalizeRoomCode } from '../../shared/constants.ts';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts';
import { RoomLogic } from '../../shared/roomLogic.ts';

export interface Env {
  ROOMS: DurableObjectNamespace;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/health') return Response.json({ ok: true, service: 'r6-matchmaker' }, { headers: CORS });
    const m = url.pathname.match(/^\/api\/room\/([^/]+)$/);
    if (m) {
      const code = normalizeRoomCode(decodeURIComponent(m[1]));
      if (!code) return new Response('invalid room code (expected R6-0000)', { status: 400, headers: CORS });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const fwd = new Request(new URL(`/room/${code}`, url.origin), req);
      return stub.fetch(fwd);
    }
    return new Response('r6-matchmaker: use /api/room/<R6-0000>', { status: 404, headers: CORS });
  },
};

export class RoomDO {
  private logic: RoomLogic | null = null;
  private sockets = new Map<string, WebSocket>();
  private seq = 0;

  constructor(_ctx: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop() ?? 'R6-0000';
    if (req.headers.get('Upgrade') !== 'websocket') {
      return Response.json({ code, members: this.logic?.state.members.length ?? 0, phase: this.logic?.state.phase ?? 'empty' }, { headers: CORS });
    }
    if (!this.logic) {
      this.logic = new RoomLogic(code, {
        send: (id, msg) => this.send(id, msg),
        broadcast: (msg, except) => {
          const data = JSON.stringify(msg);
          for (const [id, ws] of this.sockets) if (id !== except) this.safeSend(ws, data);
        },
        now: () => Date.now(),
        setTimer: (ms, fn) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as number),
        random: () => Math.random(),
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const connId = `p${Date.now().toString(36)}${(++this.seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    this.sockets.set(connId, server);
    const logic = this.logic;
    logic.onConnect(connId);
    server.addEventListener('message', (e) => {
      try {
        const raw = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
        if (raw.length > 256_000) return;
        logic.onMessage(connId, JSON.parse(raw) as ClientMessage);
      } catch (err) {
        this.send(connId, { type: 'error', message: `bad message: ${(err as Error).message}` });
      }
    });
    const close = () => {
      if (!this.sockets.has(connId)) return;
      this.sockets.delete(connId);
      logic.onDisconnect(connId);
      if (this.sockets.size === 0) this.logic = null;
    };
    server.addEventListener('close', close);
    server.addEventListener('error', close);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(id: string, msg: ServerMessage) {
    const ws = this.sockets.get(id);
    if (ws) this.safeSend(ws, JSON.stringify(msg));
  }

  private safeSend(ws: WebSocket, data: string) {
    try { ws.send(data); } catch { /* socket closing */ }
  }
}
