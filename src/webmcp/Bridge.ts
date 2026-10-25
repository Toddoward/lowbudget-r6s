import type { Soldier } from '../game/Soldier.ts';
import type { World } from '../game/World.ts';
import { Perception, type AcousticCue, type VisionEntry } from './Perception.ts';
import type { AgentAction, AgentController } from './AgentController.ts';
import { ACTION_SCHEMA, OBSERVATION_SCHEMA, TOOLS, WEBMCP_VERSION } from './schema.ts';

export interface Observation {
  tick: number;
  agentId: string;
  t: number;
  /** simulation clock (s) */
  gameTime: number;
  self: ReturnType<Perception['self']> | null;
  vision: VisionEntry[];
  acoustic: AcousticCue[];
  match: Record<string, unknown>;
}

export interface BridgeHooks {
  soldier(agentId: string): Soldier | null;
  controller(agentId: string): AgentController | null;
  agents(): { id: string; nickname: string; kind: 'player' | 'local-slot'; policy: string }[];
  match(agentId: string): Record<string, unknown>;
  join(nickname: string, roomCode: string, mode: 'online' | 'local'): Promise<string>;
  startTH(opts: { difficulty?: string; mission?: string }): void;
  loadout(opts: { squad?: 'A' | 'B'; operator?: string; spawn?: string; ready?: boolean }): void;
  mapKnowledge(): unknown;
  aspect(): number;
  fov(): number;
  contextDoc(): string;
  onExternalControl(agentId: string): void;
}

/**
 * WebMCP-style DOM bridge.
 *
 * #webmcp-agent-bridge (hidden; [B] shows it as a debug overlay) carries, for
 * the player and for every local agent slot, a <section data-agent-id> with:
 *   [data-self-state]           own HUD state, room name, stance, lean, ammo, gadgets
 *   [data-first-person-vision]  frustum + raycast-occlusion filtered entities with yawDelta/pitchDelta/distance
 *   [data-acoustic-cues]        last 3 s of sounds: relative 16-point direction or Above/Below_Floor, intensity
 *   [data-match-state]          mode / phase / timer / mission / site / score
 * plus human-readable <li> children. window.webmcp exposes observe/act/subscribe
 * and WebMCP tool descriptors; `webmcp:action` CustomEvents on document are
 * routed to act(); every tick dispatches `webmcp:observation` on the root.
 */
export class WebMcpBridge {
  readonly root: HTMLElement;
  private perception: Perception;
  private tickN = 0;
  private hz = 10;
  private acc = 0;
  private subs = new Set<{ cb: (o: Observation) => void; agentId?: string }>();
  private last = new Map<string, Observation>();
  private overlay = false;

  constructor(private world: World, private hooks: BridgeHooks) {
    this.perception = new Perception(world);
    this.root = document.getElementById('webmcp-agent-bridge') ?? Object.assign(document.createElement('div'), { id: 'webmcp-agent-bridge' });
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'WebMCP first-person agent context');
    this.root.dataset.webmcpVersion = WEBMCP_VERSION;
    const schema = document.createElement('script');
    schema.type = 'application/json';
    schema.id = 'webmcp-schema';
    schema.textContent = JSON.stringify({ version: WEBMCP_VERSION, action: ACTION_SCHEMA, observation: OBSERVATION_SCHEMA, tools: TOOLS });
    this.root.appendChild(schema);
    this.installGlobal();
    document.addEventListener('webmcp:action', (e) => {
      const d = (e as CustomEvent).detail as AgentAction & { agentId?: string };
      if (d) this.act(d, d.agentId);
    });
  }

  private installGlobal() {
    const self = this;
    const api = {
      version: WEBMCP_VERSION,
      schema: { action: ACTION_SCHEMA, observation: OBSERVATION_SCHEMA },
      tools: TOOLS,
      observe: (agentId = 'self') => self.observe(agentId),
      act: (action: AgentAction, agentId = 'self') => self.act(action, agentId),
      subscribe: (cb: (o: Observation) => void, agentId?: string) => {
        const s = { cb, agentId };
        self.subs.add(s);
        return () => self.subs.delete(s);
      },
      listAgents: () => self.hooks.agents(),
      join: (opts: { nickname: string; roomCode: string; mode?: 'online' | 'local' }) => self.hooks.join(opts.nickname, opts.roomCode, opts.mode ?? 'online'),
      startTerroristHunt: (opts: { difficulty?: string; mission?: string } = {}) => self.hooks.startTH(opts),
      selectLoadout: (opts: { squad?: 'A' | 'B'; operator?: string; spawn?: string; ready?: boolean }) => self.hooks.loadout(opts),
      getMapKnowledge: () => self.hooks.mapKnowledge(),
      getContextDoc: () => self.hooks.contextDoc(),
      setTickRate: (hz: number) => { self.hz = Math.max(1, Math.min(60, hz)); return self.hz; },
      showOverlay: (on = true) => self.setOverlay(on),
      /** generic WebMCP tool invocation */
      callTool: async (name: string, args: Record<string, unknown> = {}) => self.callTool(name, args),
    };
    (window as unknown as { webmcp: typeof api }).webmcp = api;
    // W3C WebMCP proposal (navigator.modelContext) — register tools when the browser supports it
    const mc = (navigator as unknown as { modelContext?: { provideContext?: (c: unknown) => void; registerTool?: (t: unknown) => void } }).modelContext;
    if (mc) {
      const tools = TOOLS.map((t) => ({ ...t, execute: (args: Record<string, unknown>) => self.callTool(t.name, args) }));
      try {
        if (mc.provideContext) mc.provideContext({ tools });
        else if (mc.registerTool) for (const t of tools) mc.registerTool(t);
      } catch (err) { console.warn('[webmcp] modelContext registration failed', err); }
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'r6_observe': return this.observe((args.agentId as string) ?? 'self');
      case 'r6_act': return this.act((args.action ?? {}) as AgentAction, (args.agentId as string) ?? 'self');
      case 'r6_join_room': return this.hooks.join(String(args.nickname ?? 'WebMCP-Agent'), String(args.roomCode ?? ''), (args.mode as 'online' | 'local') ?? 'online');
      case 'r6_start_terrorist_hunt': this.hooks.startTH(args as { difficulty?: string; mission?: string }); return { ok: true };
      case 'r6_select_loadout': this.hooks.loadout(args as { squad?: 'A' | 'B'; operator?: string }); return { ok: true };
      case 'r6_map_knowledge': return this.hooks.mapKnowledge();
    }
    throw new Error(`unknown tool ${name}`);
  }

  act(action: AgentAction, agentId = 'self') {
    const c = this.hooks.controller(agentId);
    if (!c) return { ok: false, warnings: [`no controllable soldier "${agentId}" (not in a match yet?)`] };
    this.hooks.onExternalControl(agentId);
    return c.apply(action);
  }

  observe(agentId = 'self'): Observation {
    const s = this.hooks.soldier(agentId);
    const match = this.hooks.match(agentId);
    if (!s) return { tick: this.tickN, agentId, t: performance.now(), gameTime: this.world.time, self: null, vision: [], acoustic: [], match };
    const isSelf = agentId === 'self';
    return {
      tick: this.tickN, agentId, t: Math.round(performance.now()), gameTime: Math.round(this.world.time * 1000) / 1000,
      self: this.perception.self(s),
      vision: s.alive ? this.perception.vision(s, isSelf ? this.hooks.aspect() : 16 / 9, isSelf ? this.hooks.fov() : 75) : [],
      acoustic: s.alive ? this.perception.acoustic(s) : [],
      match,
    };
  }

  setOverlay(on: boolean) {
    this.overlay = on;
    this.root.classList.toggle('debug', on);
    return on;
  }
  toggleOverlay() { return this.setOverlay(!this.overlay); }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < 1 / this.hz) return;
    this.acc = 0;
    this.tickN++;
    const agents = this.hooks.agents();
    const ids = new Set(agents.map((a) => a.id));
    for (const sec of [...this.root.querySelectorAll<HTMLElement>('section.webmcp-agent')]) if (!ids.has(sec.dataset.agentId!)) sec.remove();
    for (const a of agents) {
      const obs = this.observe(a.id);
      this.last.set(a.id, obs);
      this.writeDom(a.id, a.nickname, a.policy, obs);
      for (const s of this.subs) if (!s.agentId || s.agentId === a.id) { try { s.cb(obs); } catch (err) { console.warn(err); } }
    }
    const main = this.last.get('self');
    if (main) {
      this.root.dataset.selfState = JSON.stringify(main.self);
      this.root.dataset.firstPersonVision = JSON.stringify(main.vision);
      this.root.dataset.acousticCues = JSON.stringify(main.acoustic);
      this.root.dataset.matchState = JSON.stringify(main.match);
      this.root.dataset.tick = String(this.tickN);
      this.root.dispatchEvent(new CustomEvent('webmcp:observation', { detail: main, bubbles: true }));
    }
  }

  lastObservation(id: string) { return this.last.get(id); }

  private writeDom(id: string, nick: string, policy: string, o: Observation) {
    let sec = this.root.querySelector<HTMLElement>(`section.webmcp-agent[data-agent-id="${CSS.escape(id)}"]`);
    if (!sec) {
      sec = document.createElement('section');
      sec.className = 'webmcp-agent';
      sec.dataset.agentId = id;
      sec.innerHTML = `<h3></h3><div class="wm-self" data-self-state></div><ul class="wm-vision" data-first-person-vision></ul><ul class="wm-acoustic" data-acoustic-cues></ul><div class="wm-match" data-match-state></div>`;
      this.root.appendChild(sec);
    }
    sec.dataset.policy = policy;
    sec.querySelector('h3')!.textContent = `${nick} (${id}) · ${policy}`;
    const selfEl = sec.querySelector<HTMLElement>('.wm-self')!;
    const vis = sec.querySelector<HTMLElement>('.wm-vision')!;
    const ac = sec.querySelector<HTMLElement>('.wm-acoustic')!;
    const mt = sec.querySelector<HTMLElement>('.wm-match')!;
    selfEl.dataset.selfState = JSON.stringify(o.self);
    vis.dataset.firstPersonVision = JSON.stringify(o.vision);
    ac.dataset.acousticCues = JSON.stringify(o.acoustic);
    mt.dataset.matchState = JSON.stringify(o.match);
    if (!this.overlay && this.tickN % 5 !== 0) return; // keep DOM text cheap when hidden
    const sf = o.self;
    selfEl.textContent = sf ? `${sf.operator} HP ${sf.hp} · ${sf.stance}${sf.lean !== 'None' ? ' lean ' + sf.lean : ''} · ${sf.weapon.name} ${'ammoInMag' in sf.weapon ? `${sf.weapon.ammoInMag}/${sf.weapon.reserve}` : ''} · ${sf.room} · hdg ${sf.heading}°` : 'no soldier';
    vis.replaceChildren(...o.vision.slice(0, 14).map((v) => {
      const li = document.createElement('li');
      li.dataset.kind = v.kind;
      li.dataset.entityId = v.id;
      li.dataset.yawDelta = String(v.yawDelta);
      li.dataset.pitchDelta = String(v.pitchDelta);
      li.dataset.distance = String(v.distance);
      li.textContent = `${v.kind} · ${v.label} · Δyaw ${v.yawDelta}° Δpitch ${v.pitchDelta}° · ${v.distance} m`;
      return li;
    }));
    ac.replaceChildren(...o.acoustic.slice(0, 8).map((c) => {
      const li = document.createElement('li');
      li.dataset.type = c.type;
      li.dataset.direction = c.relativeDirection;
      li.textContent = `${c.type} · ${c.relativeDirection} (${c.bearingDeg}°) · ${c.intensity} · ${c.ageMs} ms`;
      return li;
    }));
    const m = o.match as Record<string, unknown>;
    mt.textContent = `${m.mode} · ${m.phase} · ${m.timeLeft}s · ${m.mission} @ ${m.siteLabel}`;
  }
}
