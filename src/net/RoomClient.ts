import { PROTOCOL_VERSION } from '../../shared/constants.ts';
import type { ActorSnapshot, ClientMessage, FastEvent, GameEvent, RoomState, RtcSignal, ServerMessage } from '../../shared/protocol.ts';
import { LocalTransport, WsTransport, type Transport } from './Transport.ts';

/** retry schedule after a dropped socket — sums to < RESUME_GRACE_MS (20 s) */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 6000];

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  open: boolean;
  pendingIce: RTCIceCandidateInit[];
}

/**
 * Hybrid room networking:
 *  - WebSocket (Durable Object): lobby/room state, WebRTC signaling, reliable
 *    ordered game events (destruction cell deltas, gadgets, barricades,
 *    reinforcements, objectives, hits/deaths) + the destruction log replayed
 *    to late joiners.
 *  - WebRTC DataChannel mesh (unordered, maxRetransmits 0): 20 Hz actor
 *    snapshots (position / rotation / stance / lean / weapon). If a channel
 *    cannot be established (strict NAT, no TURN) snapshots for that peer
 *    transparently fall back to the WebSocket relay.
 */
export class RoomClient {
  private t: Transport;
  selfId = '';
  state: RoomState | null = null;
  private peers = new Map<string, Peer>();
  private welcomed = false;
  private helloTimer = 0;
  clockOffset = 0;
  rtt = 0;
  private pingTimer = 0;
  onState: (s: RoomState) => void = () => {};
  onWelcome: (log: GameEvent[]) => void = () => {};
  onSnapshots: (from: string, snaps: ActorSnapshot[]) => void = () => {};
  onEvent: (from: string, ev: GameEvent) => void = () => {};
  private fastSeq = 0;
  private fastSeen = new Map<string, number>();
  onError: (msg: string) => void = () => {};
  onClosed: (msg: string) => void = () => {};
  /** the socket dropped and we're retrying (attempt n of RECONNECT_DELAYS.length) */
  onReconnecting: (attempt: number, reason: string) => void = () => {};
  /** back in the same seat (member id, actor id and agents preserved) */
  onReconnected: () => void = () => {};
  /** successful resumes so far (diagnostics / tests) */
  reconnects = 0;
  private resumeToken = '';
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer = 0;
  private readonly wsUrl: string;

  constructor(readonly code: string, private nickname: string, private isAgent: boolean, mode: 'online' | 'local', url?: string) {
    const base = url || (import.meta.env.VITE_SIGNAL_URL as string | undefined) || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    this.wsUrl = `${base.replace(/\/$/, '')}/api/room/${encodeURIComponent(code)}`;
    this.t = mode === 'local' ? new LocalTransport(code) : new WsTransport(this.wsUrl);
    this.wire();
  }

  private wire() {
    const t = this.t;
    this.lastHeard = Date.now();
    // events from a transport we already replaced (half-open socket finally closing) are ignored
    t.onMessage = (m) => { if (t === this.t) { this.lastHeard = Date.now(); this.handle(m); } };
    t.onClose = (r) => { if (t === this.t) this.dropped(r); };
    t.onOpen = () => { if (t === this.t) { this.attempt = 0; this.hello(); } };
  }
  private lastHeard = Date.now();

  /** WS dropped: reconnect with the resume token inside the server's grace window */
  private dropped(reason: string) {
    if (this.closedByUser) return;
    const old = this.t;
    old.onClose = () => {};
    old.onMessage = () => {};
    if (this.t.kind !== 'online' || !this.resumeToken || this.attempt >= RECONNECT_DELAYS.length) { this.onClosed(reason); return; }
    const delay = RECONNECT_DELAYS[this.attempt++];
    this.welcomed = false;
    window.clearInterval(this.pingTimer);
    this.onReconnecting(this.attempt, reason);
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.closedByUser) return;
      this.t = new WsTransport(this.wsUrl);
      this.wire();
    }, delay);
  }

  get kind() { return this.t.kind; }

  private hello() {
    const resume = this.resumeToken && this.selfId ? { id: this.selfId, token: this.resumeToken } : undefined;
    this.send({ type: 'hello', nickname: this.nickname, isAgent: this.isAgent, version: PROTOCOL_VERSION, resume });
    window.clearTimeout(this.helloTimer);
    this.helloTimer = window.setTimeout(() => { if (!this.welcomed) this.hello(); }, 1500);
  }

  send(msg: ClientMessage) { this.t.send(msg); }

  sendEvent(ev: GameEvent) { this.send({ type: 'event', ev }); }

  /** server clock (ms) estimate */
  serverNow() { return Date.now() + this.clockOffset; }

  private handle(m: ServerMessage) {
    switch (m.type) {
      case 'welcome':
        this.welcomed = true;
        if (m.resume) this.resumeToken = m.resume;
        if (m.resumed) { this.reconnects++; this.onReconnected(); }
        this.selfId = m.selfId;
        this.state = m.state;
        this.clockOffset = m.state.serverTime - Date.now();
        this.onWelcome(m.log);
        this.onState(m.state);
        this.syncPeers();
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          // watchdog: a half-open socket never fires 'close' — 3 missed pongs means it's gone
          if (this.t.kind === 'online' && Date.now() - this.lastHeard > 9000) { const old = this.t; this.dropped('connection timed out'); old.close(); return; }
          this.send({ type: 'ping', t: Date.now() });
        }, 3000);
        break;
      case 'state':
        this.state = m.state;
        this.syncPeers();
        this.onState(m.state);
        break;
      case 'rtc':
        void this.onSignal(m.from, m.data);
        break;
      case 'relay':
        this.onSnapshots(m.from, m.snaps);
        if (m.fast) this.acceptFast(m.from, m.fast);
        break;
      case 'event':
        this.onEvent(m.from, m.ev);
        break;
      case 'pong': {
        const now = Date.now();
        this.rtt = now - m.t;
        const off = m.serverTime - (m.t + now) / 2;
        this.clockOffset = this.clockOffset * 0.7 + off * 0.3;
        break;
      }
      case 'error':
        this.onError(m.message);
        break;
    }
  }

  /* ------------------------------------------------------------ WebRTC mesh */
  private connIds(): string[] {
    if (!this.state) return [];
    return [...new Set(this.state.members.map((m) => m.ownerId))].filter((id) => id !== this.selfId);
  }

  private syncPeers() {
    if (typeof RTCPeerConnection === 'undefined') return;
    const want = new Set(this.connIds());
    for (const [id, p] of this.peers) if (!want.has(id)) { p.pc.close(); this.peers.delete(id); }
    for (const id of want) {
      if (this.peers.has(id)) continue;
      const peer = this.makePeer(id);
      // deterministic initiator: lexicographically smaller id makes the offer
      if (this.selfId < id) {
        peer.dc = peer.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
        this.wireDc(peer, peer.dc);
        void (async () => {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.send({ type: 'rtc', to: id, data: { kind: 'offer', sdp: offer.sdp ?? '' } });
        })();
      }
    }
  }

  private makePeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer: Peer = { id, pc, dc: null, open: false, pendingIce: [] };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'rtc', to: id, data: { kind: 'ice', candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } } });
    };
    pc.ondatachannel = (e) => { peer.dc = e.channel; this.wireDc(peer, e.channel); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') peer.open = false; };
    this.peers.set(id, peer);
    return peer;
  }

  private wireDc(peer: Peer, dc: RTCDataChannel) {
    dc.onopen = () => { peer.open = true; };
    dc.onclose = () => { peer.open = false; };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { s?: ActorSnapshot[]; f?: FastEvent[] };
        if (msg.s?.length) this.onSnapshots(peer.id, msg.s);
        if (msg.f?.length) this.acceptFast(peer.id, msg.f);
      } catch { /* */ }
    };
  }

  private async onSignal(from: string, data: RtcSignal) {
    let peer = this.peers.get(from);
    if (!peer) peer = this.makePeer(from);
    const pc = peer.pc;
    try {
      if (data.kind === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.send({ type: 'rtc', to: from, data: { kind: 'answer', sdp: ans.sdp ?? '' } });
        for (const c of peer.pendingIce) await pc.addIceCandidate(c);
        peer.pendingIce = [];
      } else if (data.kind === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        for (const c of peer.pendingIce) await pc.addIceCandidate(c);
        peer.pendingIce = [];
      } else if (data.kind === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      }
    } catch (err) {
      console.warn('[rtc]', err);
    }
  }

  /** fast events arrive via DataChannel and/or WS relay → apply each (sender, n) once */
  private acceptFast(from: string, evs: FastEvent[]) {
    const last = this.fastSeen.get(from) ?? -1;
    let max = last;
    for (const f of evs) {
      if (f.n <= last) continue;
      max = Math.max(max, f.n);
      this.onEvent(from, f.ev);
    }
    this.fastSeen.set(from, max);
  }

  /**
   * Low-latency path: 20 Hz actor snapshots + shot events (tracers / muzzle / sound).
   * DataChannel where open (unordered, no retransmits); one WS relay for peers without one.
   */
  sendFast(snaps: ActorSnapshot[], events: GameEvent[] = []) {
    if (!snaps.length && !events.length) return;
    const fast: FastEvent[] = events.map((ev) => ({ n: ++this.fastSeq, ev }));
    const data = JSON.stringify({ s: snaps, f: fast });
    let needRelay = false;
    for (const id of this.connIds()) {
      const p = this.peers.get(id);
      if (p?.open && p.dc?.readyState === 'open') {
        try { p.dc.send(data); } catch { needRelay = true; }
      } else needRelay = true;
    }
    if (needRelay) this.send({ type: 'relay', snaps, fast: fast.length ? fast : undefined });
  }

  sendSnapshots(snaps: ActorSnapshot[]) { this.sendFast(snaps); }

  peerPaths(): { id: string; path: 'webrtc' | 'ws-relay' }[] {
    return this.connIds().map((id) => ({ id, path: this.peers.get(id)?.open ? 'webrtc' : 'ws-relay' }));
  }

  close() {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.helloTimer);
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.t.close();
  }
}
