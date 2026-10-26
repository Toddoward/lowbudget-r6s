import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts';
import { RoomLogic } from '../../shared/roomLogic.ts';

export interface Transport {
  send(msg: ClientMessage): void;
  close(): void;
  onMessage: (msg: ServerMessage) => void;
  onClose: (reason: string) => void;
  onOpen: () => void;
  readonly kind: 'online' | 'local';
}

/** WebSocket to the Durable Object room (Pages Function /api/room/:code or a direct worker URL). */
export class WsTransport implements Transport {
  readonly kind = 'online' as const;
  private ws: WebSocket;
  onMessage: (msg: ServerMessage) => void = () => {};
  onClose: (reason: string) => void = () => {};
  onOpen: () => void = () => {};
  private queue: string[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      for (const q of this.queue) this.ws.send(q);
      this.queue = [];
      this.onOpen();
    };
    this.ws.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data as string) as ServerMessage); } catch { /* ignore */ }
    };
    // error is usually followed by close: report once
    let done = false;
    const fin = (r: string) => { if (!done) { done = true; this.onClose(r); } };
    this.ws.onclose = (e) => fin(e.reason || `socket closed (${e.code})`);
    this.ws.onerror = () => fin('websocket error — is the r6s-temu-matchmaker worker deployed / `npm run dev:worker` running?');
  }

  send(msg: ClientMessage) {
    const s = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(s);
  }

  close() { try { this.ws.close(); } catch { /* */ } }
}

/**
 * Serverless fallback: rooms shared between tabs/windows of the same browser
 * via BroadcastChannel. The first tab to grab the Web Lock for the room code
 * hosts the same RoomLogic the Durable Object runs. Great for testing PvP,
 * WebRTC and WebMCP agents locally with zero infrastructure.
 */
export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  onMessage: (msg: ServerMessage) => void = () => {};
  onClose: (reason: string) => void = () => {};
  onOpen: () => void = () => {};
  private client: BroadcastChannel;
  private hostChan: BroadcastChannel | null = null;
  readonly connId = `L${Math.random().toString(36).slice(2, 9)}`;
  private hb: number;
  private releaseLock: (() => void) | null = null;
  private closed = false;

  constructor(private code: string) {
    this.client = new BroadcastChannel(`r6room:${code}`);
    this.client.onmessage = (e) => {
      const m = e.data as { kind: string; to?: string; except?: string; msg: ServerMessage };
      if (m.kind !== 's2c') return;
      if (m.to && m.to !== this.connId) return;
      if (m.except && m.except === this.connId) return;
      this.onMessage(m.msg);
    };
    this.tryHost();
    this.hb = window.setInterval(() => this.post({ type: 'ping', t: Date.now() }), 2000);
    window.addEventListener('beforeunload', () => this.close());
    setTimeout(() => { this.post({ type: 'ping', t: Date.now() }); this.onOpen(); }, 150);
  }

  private tryHost() {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    const become = () => {
      if (this.closed) return;
      const chan = new BroadcastChannel(`r6room:${this.code}`);
      this.hostChan = chan;
      const lastSeen = new Map<string, number>();
      const logic = new RoomLogic(this.code, {
        send: (id, msg) => chan.postMessage({ kind: 's2c', to: id, msg }),
        broadcast: (msg, except) => chan.postMessage({ kind: 's2c', except, msg }),
        now: () => Date.now(),
        setTimer: (ms, fn) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
        random: () => Math.random(),
      });
      chan.onmessage = (e) => {
        const m = e.data as { kind: string; from: string; msg: import('../../shared/protocol.ts').ClientMessage | { type: 'bye' } };
        if (m.kind !== 'c2s') return;
        if (m.msg.type === 'bye') { if (lastSeen.delete(m.from)) logic.onDisconnect(m.from); return; }
        if (!lastSeen.has(m.from)) logic.onConnect(m.from);
        lastSeen.set(m.from, Date.now());
        logic.onMessage(m.from, m.msg);
      };
      let lastCheck = Date.now();
      window.setInterval(() => {
        const now = Date.now();
        // this tab itself stalled (a long frame, a background tab): its peers' silence is ours — give them a fresh
        // window instead of dropping everyone, our own seat included (which reset the room to the lobby)
        if (now - lastCheck > 4000) for (const id of lastSeen.keys()) lastSeen.set(id, now);
        lastCheck = now;
        for (const [id, t] of lastSeen) if (now - t > 7000) { lastSeen.delete(id); logic.onDisconnect(id); }
      }, 2000);
    };
    if (locks) {
      locks.request(`r6host:${this.code}`, { ifAvailable: false }, () => new Promise<void>((res) => { this.releaseLock = res; become(); }));
    } else become();
  }

  private post(msg: unknown) {
    if (!this.closed) this.client.postMessage({ kind: 'c2s', from: this.connId, msg });
  }

  send(msg: ClientMessage) { this.post(msg); }

  close() {
    if (this.closed) return;
    this.post({ type: 'bye' });
    this.closed = true;
    window.clearInterval(this.hb);
    this.client.close();
    this.hostChan?.close();
    this.releaseLock?.();
  }
}
