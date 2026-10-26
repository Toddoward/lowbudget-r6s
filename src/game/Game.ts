import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Physics, G_WORLD } from '../core/Physics.ts';
import { preloadGlbAssets, glbStats } from '../assets/library.ts';
import { Input, type UiAction } from '../core/Input.ts';
import { QA } from '../qa.ts';
import { t, has, localizePlace } from '../ui/i18n.ts';
import { Audio } from '../core/Audio.ts';
import { DestructionSystem } from '../world/Destruction.ts';
import { Effects } from '../render/Effects.ts';
import { Lighting } from '../render/Lighting.ts';
import { ViewModel } from '../render/ViewModel.ts';
import { Rig } from '../render/Rig.ts';
import { buildHouse, locationName, type HouseWorld } from '../map/MapBuilder.ts';
import { buildSuburb, type SuburbWorld } from '../map/Suburb.ts';
import { ROOMS, SPAWN_ZONES, FLOOR_Y, HATCHES, STAIRS, FLOOR_LABEL, HOUSE_RECT, ROOF_Y } from '../map/houseLayout.ts';
import { World } from './World.ts';
import { Combat } from './Combat.ts';
import { Interactions } from './Interactions.ts';
import { Gadgets, type Gadget } from './Gadgets.ts';
import { Objectives, type Mission } from './Objectives.ts';
import { Soldier, emptyInput, type SoldierInput } from './Soldier.ts';
import { OPERATORS } from './operators.ts';
import { WEAPONS } from './weapons.ts';
import { Stance, type Side } from './types.ts';
import { NavGraph } from '../ai/NavGraph.ts';
import { Bot, DIFFICULTY, type BotDifficulty } from '../ai/Bot.ts';
import { RoomClient } from '../net/RoomClient.ts';
import { RemoteActor } from '../net/RemoteActor.ts';
import { WebMcpBridge } from '../webmcp/Bridge.ts';
import { AgentController } from '../webmcp/AgentController.ts';
import { LocalAgent } from '../webmcp/LocalAgent.ts';
import { headingDeg, wrap180 } from '../webmcp/Perception.ts';
import { Hud, esc, type HudState, type HudGadget, type HudHint, type HudMarker, type HudMate } from '../ui/Hud.ts';
import { mulberry32, pick } from '../../shared/rng.ts';
import { ATTACKERS, DEFENDERS, MISSIONS, SITES, type SpawnId, type TimeOfDay } from '../../shared/constants.ts';
import type { ActorSnapshot, GameEvent, MemberInfo, RoomState } from '../../shared/protocol.ts';
import { teamOf } from '../../shared/protocol.ts';
import type { Panel } from '../world/Destruction.ts';

export interface THOptions {
  difficulty: BotDifficulty['name'];
  mission: Mission | 'random';
  operator: string;
  spawn: SpawnId | 'random';
  tod: TimeOfDay | 'random';
  agents: number;
}

interface AgentSlot {
  id: string;
  nickname: string;
  soldier: Soldier;
  ctl: AgentController;
  brain: LocalAgent;
  policy: 'builtin' | 'external';
  thinkT: number;
}

export type Quality = 'low' | 'medium' | 'high';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, sat: { value: 0.88 }, contrast: { value: 1.08 }, grain: { value: 0.012 }, time: { value: 0 }, hurt: { value: 0 }, droneFx: { value: 0 }, night: { value: 0 }, blind: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette, sat, contrast, grain, time, hurt, droneFx, night, blind; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      col = max(col, vec3(0.0));
      float l = dot(col, vec3(0.2126,0.7152,0.0722)); col = max(mix(vec3(l), col, sat), vec3(0.0));
      col = 0.18 * pow(col / 0.18, vec3(contrast)); // linear-HDR contrast pivoting on mid-grey
      float d = distance(vUv, vec2(0.5)); col *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      col = mix(col, vec3(0.55,0.0,0.0), hurt * smoothstep(0.25, 0.75, d));
      if (droneFx > 0.0) {
        // drone / camera feed: auto-exposed (brighter, esp. at night), mono-green tint + scanlines
        float gain = 1.0 + droneFx * (0.9 + night * 1.6);
        col = col * gain + droneFx * (0.02 + night * 0.035);
        float s = sin(vUv.y * 900.0) * 0.03;
        col = mix(col, vec3(dot(col, vec3(0.3,0.6,0.1))) * vec3(0.82,1.0,0.86) + s, droneFx * 0.55);
      }
      col = mix(col, vec3(1.0, 0.99, 0.95), blind);
      col = max(col + (h(vUv * 800.0) - 0.5) * grain * (0.2 + l), vec3(0.0));
      gl_FragColor = vec4(col, c.a); }`,
};

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.04, 700);
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  physics!: Physics;
  destruction!: DestructionSystem;
  effects!: Effects;
  house!: HouseWorld;
  suburb!: SuburbWorld;
  lighting!: Lighting;
  world!: World;
  nav!: NavGraph;
  readonly input: Input;
  readonly audio = new Audio();
  readonly hud = new Hud();
  readonly vm = new ViewModel();
  bridge!: WebMcpBridge;
  mode: 'menu' | 'th' | 'pvp' = 'menu';
  player: Soldier | null = null;
  playerCtl: AgentController | null = null;
  bots: Bot[] = [];
  slots: AgentSlot[] = [];
  private rigs = new Map<string, Rig>();
  remotes = new Map<string, RemoteActor>();
  room: RoomClient | null = null;
  private roundKey = '';
  private phaseEnds = 0;
  private thOpts: THOptions | null = null;
  private thResult: { win: boolean; reason: string } | null = null;
  drone: Gadget | null = null;
  private acc = 0;
  private last = performance.now();
  private snapT = 0;
  private hurtFx = 0;
  paused = false;
  fov = 75;
  quality: Quality = 'high';
  private lookDelta = { x: 0, y: 0 };
  private firedThisFrame = false;
  private prevMag = -1;
  private thKills = 0;
  private spectateIdx = 0;
  private extraLine = '';
  onMenu: () => void = () => {};
  /** UI hook: a match (TH or a PvP round) is starting → hide menus */
  onMatchStart: () => void = () => {};
  readonly stats = { stepMs: 0, renderMs: 0, frames: 0, frameMs: 16 };
  /** auto-downgrade quality on slow GPUs unless the player chose one explicitly */
  autoQuality = true;
  private slowFor = 0;
  onLobby: (s: RoomState, selfId: string) => void = () => {};
  onToast: (msg: string) => void = () => {};
  ready = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.input = new Input(canvas);
    this.input.onUiAction = (a) => this.onUiAction(a);
    window.addEventListener('resize', () => this.resize());
  }

  async init(progress: (msg: string) => void) {
    progress('Initialising Rapier3D WASM physics · loading CLI-Anything/Blender GLB assets…');
    const [physics] = await Promise.all([Physics.create(), preloadGlbAssets()]);
    this.physics = physics;
    this.destruction = new DestructionSystem(this.physics);
    this.effects = new Effects(this.scene);
    progress('Building the original House (2015)…');
    this.house = buildHouse(this.physics, this.destruction, this.scene);
    progress('Building the suburb: Construction Site, River Docks, APC, Side Street…');
    this.suburb = buildSuburb(this.physics, this.scene);
    this.world = new World(this.physics, this.destruction, this.effects, this.house, this.scene);
    this.world.combat = new Combat(this.world);
    this.world.interactions = new Interactions(this.world);
    this.world.gadgets = new Gadgets(this.world);
    this.world.objectives = new Objectives(this.world);
    this.physics.step();
    progress('Baking navigation graph…');
    this.nav = new NavGraph(this.physics, this.destruction);
    this.nav.build(this.house.openings, this.house.wallPanels);
    this.lighting = new Lighting(this.scene, this.renderer, this.suburb, this.house.lamps, this.house.openings);
    this.lighting.apply('day');
    this.setupComposer();
    this.wireWorld();
    this.bridge = new WebMcpBridge(this.world, {
      soldier: (id) => this.soldierFor(id),
      controller: (id) => this.controllerFor(id),
      agents: () => this.agentList(),
      match: (id) => this.matchState(id),
      join: (n, c, m) => this.joinRoom(n, c, m, true),
      startTH: (o) => this.startTH({ ...this.defaultTH(), difficulty: (o.difficulty as BotDifficulty['name']) ?? 'Normal', mission: (o.mission as Mission) ?? 'random' }),
      loadout: (o) => this.setLoadout(this.room?.selfId ?? '', o),
      mapKnowledge: () => this.mapKnowledge(),
      aspect: () => this.camera.aspect,
      fov: () => this.camera.fov,
      contextDoc: () => document.getElementById('agent-context-md')?.textContent ?? '',
      onExternalControl: (id) => { const s = this.slots.find((x) => x.id === id); if (s) s.policy = 'external'; },
    });
    this.resize();
    this.placeMenuCamera();
    this.ready = true;
    progress('Ready.');
    requestAnimationFrame(() => this.frame());
  }

  private setupComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.bloom.enabled = q === 'high';
    this.lighting.flashlightShadows = q === 'high';
    this.renderer.shadowMap.enabled = q !== 'low';
    this.lighting.key.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.lighting.key.shadow.map?.dispose();
    (this.lighting.key.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    this.renderer.setPixelRatio(q === 'low' ? 0.75 : Math.min(window.devicePixelRatio, q === 'high' ? 1.75 : 1.25));
    this.resize();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /* ================================================================ wiring */
  private wireWorld() {
    const w = this.world;
    w.soundListeners.push((s) => {
      const listener = this.camera.position;
      this.audio.play(s, listener, !!this.player && s.source === this.player.id);
    });
    this.audio.occluded = (p) => !this.physics.clearLine(this.camera.position, p);
    w.onLocalHit.push((target, head, killed) => {
      if (this.player && !killed) { this.hud.hitMarker(head, false); this.audio.ui('hit'); }
      if (target.side !== this.player?.side) { this.thStats.hits++; if (head) this.thStats.heads++; }
    });
    w.onKill.push((k) => {
      const kn = w.actors.get(k.killer)?.name ?? k.killer;
      const vn = w.actors.get(k.victim)?.name ?? k.victim;
      const mine = k.killer === this.player?.id;
      this.hud.kill(kn, vn, k.head, k.weapon, mine);
      if (mine) { this.hud.hitMarker(k.head, true); this.audio.ui('kill'); }
      if (this.mode === 'th' && w.actors.get(k.victim)?.side === 'terrorist') this.thKills++;
    });
    w.onHurt.push((victim, attacker) => {
      if (victim !== this.player) return;
      this.hurtFx = 1;
      const a = w.actors.get(attacker);
      if (a && a !== victim) {
        const d = a.pos.clone().sub(victim.pos);
        this.hud.damageFrom(wrap180(THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)) - headingDeg(this.player.yaw)));
      }
    });
    this.destruction.onBroke = (panel, cells) => this.onCellsBroke(panel, cells);
    w.objectives.onResult = (attackWin, reason) => {
      if (this.mode === 'th') this.endTH(attackWin, reason);
    };
  }

  private onCellsBroke(panel: Panel, cells: number[]) {
    const pts = cells.slice(0, 120).map((i) => panel.cellCenter(i));
    const floorY = panel.isWall ? panel.min.y : panel.min.y - 3;
    const imp = new THREE.Vector3();
    if (pts.length) {
      const c = pts[0];
      const away = c.clone().sub(this.camera.position);
      imp.setComponent(panel.nAx, Math.sign(away.getComponent(panel.nAx)) * 2);
    }
    this.effects.breakCells(pts, panel.reinforced ? new THREE.Color('#6f747a') : panel.props.face, panel.props.mat, floorY, imp);
    for (const i of cells) this.effects.clearDecals(`${panel.id}:${i}`);
    if (cells.length > 6) this.world.sound({ type: 'breach', pos: panel.center, radius: 30, source: 'destruction', intensity: Math.min(1, cells.length / 40), label: panel.kind });
  }

  private onUiAction(a: UiAction) {
    if (this.mode === 'menu' || this.paused) return;
    if (a === 'xray' && QA) { this.destruction.setXray(!this.destruction.xray); this.onToast(this.destruction.xray ? 'X-ray ON (red soft · yellow semi · white solid)' : 'X-ray off'); }
    if (a === 'overlay' && QA) { const on = this.bridge.toggleOverlay(); this.onToast(on ? 'WebMCP bridge debug overlay ON' : 'WebMCP overlay off'); }
    if (a === 'flashlight') {
      this.lighting.flashlightOn = !this.lighting.flashlightOn;
      if (this.player) this.player.flashlight = this.lighting.flashlightOn;
      this.onToast(t(this.lighting.flashlightOn ? 'toast.flashOn' : 'toast.flashOff'));
    }
    if (a === 'help') this.onHelp();
    if (a === 'ping') this.pingReq = true;
    if (a === 'observe') this.toggleObserve();
  }

  /** does gameplay want mouse-look right now? (drives the UI's pointer-lock state machine) */
  wantsPointer(): boolean {
    const p = this.player;
    if (this.mode === 'menu' || !p || !p.alive) return false;
    if (this.mode === 'th' && this.thResult) return false;
    return this.world.phase === 'prep' || this.world.phase === 'action';
  }

  /* ================================================================ drone / camera views */
  /** 'body' = first person · 'drone' = attacker drone · 'cam' = defender CCTV */
  view: 'body' | 'drone' | 'cam' = 'body';
  private camIdx = 0;
  private pingReq = false;
  onHelp: () => void = () => {};

  private toggleObserve() {
    const p = this.player;
    if (!p || !p.alive || this.world.phase === 'over') return;
    if (this.view !== 'body') {
      if (this.view === 'drone' && this.world.phase === 'prep' && p.side === 'attack') return; // prep: the drone is all you have
      this.view = 'body';
      return;
    }
    if (p.side === 'attack') {
      if (this.drone && !this.drone.data.destroyed && this.drone.state !== 'done') this.view = 'drone';
      else this.onToast(t('toast.noDrone'));
    } else {
      const live = this.house.cameras.filter((c) => c.alive);
      if (!live.length) { this.onToast(t('toast.noCams')); return; }
      this.view = 'cam';
      this.camIdx = this.house.cameras.indexOf(live[0]);
      this.camLook = { yaw: live[0].yaw, pitch: -0.35 };
    }
  }
  private camLook = { yaw: 0, pitch: -0.35 };

  private nextCam(dir = 1) {
    const cams = this.house.cameras;
    for (let k = 1; k <= cams.length; k++) {
      const i = (this.camIdx + dir * k + cams.length * 4) % cams.length;
      if (cams[i].alive) { this.camIdx = i; this.camLook = { yaw: cams[i].yaw, pitch: -0.35 }; return; }
    }
    this.view = 'body';
  }

  /** what the local player currently looks through: [eye position, forward direction] */
  private viewRay(): [THREE.Vector3, THREE.Vector3] {
    const pos = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return [pos, dir];
  }

  /** ping: spot an enemy under the crosshair (5 s, whole team) or drop a marker */
  private doPing() {
    const p = this.player;
    if (!p) return;
    // body: the soldier's own eye/aim (exact even before the next render); drone/CCTV: what the feed camera sees
    const [o, d] = this.view === 'body' ? [p.eye(), p.aimDir()] : this.viewRay();
    if (this.pingFrom(p, o, d)) this.audio.ui('ping');
  }

  /** shared by the player (camera ray) and agents (their own eyes); returns true when something was marked */
  pingFrom(by: Soldier, o: THREE.Vector3, d: THREE.Vector3): boolean {
    let best: { id: string; ang: number } | null = null;
    for (const a of this.world.actors.values()) {
      if (!a.alive || a.side === by.side || a.side === 'hostage' || a.id === by.id) continue;
      const c = a.pos.clone().add(new THREE.Vector3(0, a.stance === Stance.Prone ? 0.3 : a.stance === Stance.Crouch ? 0.8 : 1.1, 0));
      const to = c.clone().sub(o);
      const dist = to.length();
      if (dist > 70) continue;
      const ang = to.normalize().angleTo(d);
      if (ang > THREE.MathUtils.degToRad(4) + 0.6 / dist) continue;
      if (!this.physics.clearLine(o, c)) continue;
      if (!best || ang < best.ang) best = { id: a.id, ang };
    }
    if (best) {
      this.world.spot(best.id, by.side, 5, true, by.id);
      if (by === this.player) this.onToast(t('hud.spotted'));
      return true;
    }
    const hit = this.physics.raycast(o, d, 80, G_WORLD);
    if (hit) { this.world.ping(hit.point, by.side, by.id); return true; }
    return false;
  }

  /* ================================================================ common setup */
  private resetMap() {
    const w = this.world;
    w.gadgets.clear();
    w.objectives.clear();
    for (const op of this.house.openings) { w.interactions.removeBarricade(op); op.barricadeGen = 0; }
    for (const p of this.destruction.panels.values()) {
      if (p.kind === 'barricade' || p.kind === 'castle') continue;
      p.resetSkin();
      p.reinforced = false;
      p.electrified = 0;
    }
    this.destruction.update();
    this.effects.clearAllDecals();
    for (const b of this.bots) { b.s.dispose(); w.actors.delete(b.s.id); w.soldiers.delete(b.s.id); }
    this.bots = [];
    for (const [id, r] of this.rigs) { this.scene.remove(r.root); r.dispose(); this.rigs.delete(id); }
    for (const s of this.slots) { s.soldier.dispose(); w.actors.delete(s.id); w.soldiers.delete(s.id); }
    this.slots = [];
    w.soundListeners.splice(1);
    w.onHurt.splice(1);
    w.sounds = [];
    this.drone = null;
    this.view = 'body';
    this.physics.step();
  }

  private makeSoldier(id: string, name: string, side: Side, operator: string, kind: 'local' | 'bot' | 'agent', pos: THREE.Vector3, yaw: number): Soldier {
    this.world.gadgets.forgetKeys(id);
    const s = new Soldier(this.world, { id, name, side, operator, kind, pos, yaw });
    this.world.soldiers.set(id, s);
    this.world.actors.set(id, s);
    if (kind !== 'local') {
      const color = side === 'terrorist' ? '#ff6b5a' : side === this.player?.side ? '#7fd0ff' : '#ff6b5a';
      const rig = new Rig(operator, s.weaponId, kind === 'bot' ? undefined : name, color);
      this.scene.add(rig.root);
      this.rigs.set(id, rig);
    }
    return s;
  }

  private spawnPoint(zoneId: SpawnId, rand: () => number): { p: THREE.Vector3; yaw: number } {
    const z = SPAWN_ZONES.find((s) => s.id === zoneId) ?? SPAWN_ZONES[0];
    const a = rand() * Math.PI * 2;
    const r = rand() * z.radius * 0.6;
    const p = new THREE.Vector3(z.center[0] + Math.cos(a) * r, z.center[1] + 1, z.center[2] + Math.sin(a) * r);
    const hit = this.physics.raycast(p, new THREE.Vector3(0, -1, 0), 4, G_WORLD);
    if (hit) p.y = hit.point.y + 0.05;
    const yaw = Math.atan2(p.x, p.z); // face the house (origin)
    return { p, yaw };
  }

  private spawnInRoom(roomId: string, rand: () => number): { p: THREE.Vector3; yaw: number } {
    const n = this.nav.randomNodeIn([roomId], rand) ?? this.nav.randomNodeIn(ROOMS.map((r) => r.id), rand)!;
    return { p: n.pos.clone(), yaw: rand() * Math.PI * 2 };
  }

  private dronePoint(zoneId: SpawnId): THREE.Vector3 {
    const z = SPAWN_ZONES.find((s) => s.id === zoneId) ?? SPAWN_ZONES[0];
    const c = new THREE.Vector3(...z.center);
    const toward = c.clone().multiplyScalar(0.55);
    const hit = this.physics.raycast(toward.clone().add(new THREE.Vector3(0, 4, 0)), new THREE.Vector3(0, -1, 0), 8, G_WORLD);
    if (hit) toward.y = hit.point.y + 0.2;
    return toward;
  }

  /* ================================================================ Terrorist Hunt */
  defaultTH(): THOptions { return { difficulty: 'Normal', mission: 'random', operator: 'ash', spawn: 'random', tod: 'random', agents: 0 }; }

  startTH(opts: THOptions) {
    this.leaveRoom();
    this.resetMap();
    this.disposePlayer();
    this.thOpts = opts;
    this.thResult = null;
    this.thKills = 0;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const rand = mulberry32(seed);
    const mission: Mission = opts.mission === 'random' ? pick<Mission>(['elimination', 'bomb', 'hostage', 'secure'], rand) : opts.mission;
    const site = pick(SITES, rand).id;
    const tod: TimeOfDay = opts.tod === 'random' ? (rand() < 0.5 ? 'day' : 'night') : opts.tod;
    this.applyTod(tod, seed);
    const w = this.world;
    w.mode = 'th';
    w.friendlyFire = false;
    w.objectives.setup(mission, site, 'th');
    w.objectives.authority = true;
    // player
    const zone: SpawnId = opts.spawn === 'random' ? pick(SPAWN_ZONES.map((z) => z.id), rand) : opts.spawn;
    const sp = this.spawnPoint(zone, rand);
    const nick = (localStorage.getItem('r6.nick') ?? 'Recruit');
    this.player = this.makeSoldier('self', nick, 'attack', opts.operator, 'local', sp.p, sp.yaw);
    this.player.flashlight = this.lighting.flashlightOn;
    w.localId = 'self';
    this.playerCtl = new AgentController(w, this.player);
    this.vm.setCloth(this.player.op.cloth);
    // WebMCP agent teammates
    for (let i = 0; i < opts.agents; i++) this.addLocalAgentSlot(`agent${i + 1}`, `WebMCP-Agent-${i + 1}`, 'attack', ATTACKERS[(ATTACKERS.indexOf(opts.operator as never) + i + 1) % ATTACKERS.length], this.spawnPoint(zone, rand));
    // terrorists
    const diff = DIFFICULTY[opts.difficulty];
    const siteRooms = w.objectives.roomOfSite();
    const allRooms = ROOMS.filter((r) => r.id !== 'closet').map((r) => r.id);
    for (let i = 0; i < diff.count; i++) {
      const guard = i < 3;
      const exterior = i === diff.count - 1 || i === diff.count - 2;
      const home = guard ? siteRooms[i % siteRooms.length] : pick(allRooms, rand);
      const homeFloor = ROOMS.find((r) => r.id === home)!.floor;
      const near = ROOMS.filter((r) => r.floor === homeFloor && r.id !== home).map((r) => r.id);
      const patrol = exterior ? ['__ext'] : [home, pick(near, rand), pick(near, rand)];
      const spn = exterior ? { p: this.nav.randomNodeIn(['__ext'], rand)!.pos.clone(), yaw: rand() * 6 } : this.spawnInRoom(home, rand);
      const s = this.makeSoldier(`tango${i}`, `White Mask ${i + 1}`, 'terrorist', 'terrorist', 'bot', spn.p, spn.yaw);
      if (rand() < 0.2) { s.weapons[0] = { def: WEAPONS.spas12t, mag: 7, reserve: 600 }; this.rigs.get(s.id)?.setWeapon('spas12t'); }
      const bot = new Bot(w, this.nav, s, diff, patrol, guard && !exterior);
      bot.isNight = tod === 'night';
      this.bots.push(bot);
    }
    // White Masks fortify: barricades + a few reinforced walls around the site
    for (const op of this.house.openings) if (op.barricadeable && rand() < 0.5) w.interactions.placeBarricade(op, 'wood', false);
    const siteSoft = this.house.wallPanels.filter((p) => p.reinforceable && p.rooms.some((r) => r && siteRooms.includes(r)));
    for (let i = 0; i < Math.min(4, siteSoft.length); i++) w.interactions.reinforce(null, siteSoft[Math.floor(rand() * siteSoft.length)], false);
    for (const h of HATCHES) if (rand() < 0.35) { const p = [...this.destruction.panels.values()].find((x) => x.label === h.label); if (p) w.interactions.reinforce(null, p, false); }
    // drone prep phase
    w.phase = 'prep';
    this.phaseEnds = w.time + 20;
    this.drone = w.gadgets.spawnDrone(this.player, this.dronePoint(zone));
    this.mode = 'th';
    this.input.resetStance();
    this.hud.show(true);
    this.onMatchStart();
    this.view = 'drone';
    this.thStats = { shots: 0, hits: 0, heads: 0, start: w.time };
    this.hud.showBanner(t('banner.th', missionName(mission)), t('banner.thSub', t(tod === 'day' ? 'hud.day' : 'hud.night'), localizePlace(w.objectives.siteLabel()), t(`diff.${diff.name}`)), 5);
    this.audio.ensure();
    this.input.lock();
  }

  private endTH(win: boolean, reason: string) {
    if (this.thResult) return;
    this.thResult = { win, reason };
    this.world.phase = 'over';
    this.view = 'body';
    this.hud.showBanner(t(win ? 'banner.win' : 'banner.lose'), `${reasonText(reason)} · ${t('hud.kills', this.thKills)}`, 3);
    this.audio.ui('round');
    const st = this.thStats;
    this.onResult({
      win, reason: reasonText(reason), kills: this.thKills, time: Math.max(0, this.world.time - st.start),
      accuracy: st.shots ? Math.round((st.hits / st.shots) * 100) : 0, headshots: st.heads, operator: this.player?.op.name ?? '',
    });
  }
  /** TH result stats (shots → accuracy, headshots) */
  private thStats = { shots: 0, hits: 0, heads: 0, start: 0 };
  onResult: (r: { win: boolean; reason: string; kills: number; time: number; accuracy: number; headshots: number; operator: string }) => void = () => {};

  restartTH() { if (this.thOpts) this.startTH(this.thOpts); }

  /** QA / E2E: swap the local player to any operator (defenders included) in place */
  qaSwapOperator(operator: string): Soldier | null {
    const old = this.player;
    if (!old || !QA) return null;
    const side = (OPERATORS[operator]?.team === 'defend' ? 'defend' : 'attack') as Side;
    const pos = old.pos.clone();
    const yaw = old.yaw;
    this.disposePlayer();
    this.player = this.makeSoldier('self', old.name, side, operator, 'local', pos, yaw);
    this.playerCtl = new AgentController(this.world, this.player);
    this.vm.setCloth(this.player.op.cloth);
    this.view = 'body';
    return this.player;
  }

  /* ================================================================ agent slots */
  addLocalAgentSlot(id: string, nickname: string, side: Side, operator: string, sp: { p: THREE.Vector3; yaw: number }): AgentSlot {
    const s = this.makeSoldier(id, nickname, side, operator, 'agent', sp.p, sp.yaw);
    const slot: AgentSlot = { id, nickname, soldier: s, ctl: new AgentController(this.world, s), brain: new LocalAgent(this.nav, nickname), policy: 'builtin', thinkT: Math.random() * 0.2 };
    this.slots.push(slot);
    return slot;
  }

  private soldierFor(id: string): Soldier | null {
    if (id === 'self') return this.player;
    return this.slots.find((s) => s.id === id)?.soldier ?? null;
  }
  private controllerFor(id: string): AgentController | null {
    if (id === 'self') return this.playerCtl;
    return this.slots.find((s) => s.id === id)?.ctl ?? null;
  }
  private agentList() {
    const out: { id: string; nickname: string; kind: 'player' | 'local-slot'; policy: string }[] = [];
    if (this.player) out.push({ id: 'self', nickname: this.player.name, kind: 'player', policy: this.playerCtl?.active() ? 'external' : 'human' });
    for (const s of this.slots) out.push({ id: s.id, nickname: s.nickname, kind: 'local-slot', policy: s.policy });
    return out;
  }

  matchState(agentId = 'self'): Record<string, unknown> {
    const w = this.world;
    const st = w.objectives.status();
    const timeLeft = Math.max(0, Math.round(this.timeLeft()));
    const o = w.objectives;
    const me = this.soldierFor(agentId);
    // objective position (public knowledge): next armed bomb / extraction zone when carrying the hostage / site spot
    let target: THREE.Vector3 | null = null;
    if (this.mode !== 'menu') {
      if (o.mission === 'bomb') {
        const armed = o.bombs.filter((b) => b.state === 'armed');
        target = (me ? armed.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos))[0]?.pos : armed[0]?.pos) ?? o.spotOf(o.site);
        if (o.defuser && me?.side === 'defend') target = o.defuser.pos;
      } else if (o.mission === 'hostage' && o.hostage && me && o.hostage.carrier === me.id) {
        const z = [...SPAWN_ZONES].sort((a, b) => me.pos.distanceTo(new THREE.Vector3(...a.center)) - me.pos.distanceTo(new THREE.Vector3(...b.center)))[0];
        target = new THREE.Vector3(...z.center);
      } else if (o.mission === 'hostage' && o.hostage) target = o.hostage.pos;
      else target = o.container?.pos ?? o.spotOf(o.site);
    }
    const objPos = target ? target.toArray().map((v) => Math.round(v * 10) / 10) : null;
    return {
      mode: this.mode === 'th' ? 'terrorist_hunt' : this.mode === 'pvp' ? 'pvp' : 'menu',
      phase: w.phase, timeLeft, mission: st.mission, site: st.site, siteLabel: st.siteLabel, objective: st.text,
      objectiveProgress: Math.round(st.progress * 100) / 100, objectivePos: objPos,
      team: me?.side ?? this.player?.side ?? null, timeOfDay: this.lighting.tod,
      room: this.room ? { code: this.room.code, transport: this.room.kind, peers: this.room.peerPaths(), score: this.room.state?.score, round: this.room.state?.round?.index } : null,
      enemiesRemaining: this.mode === 'th' ? this.bots.filter((b) => b.s.alive).length : undefined,
      droneActive: !!this.drone && w.phase === 'prep',
      assets: glbStats.source,
    };
  }

  private mapKnowledge() {
    return {
      axes: '+X East, +Y Up, +Z South (North = -Z). Floors: B y=-3.5, 1F y=0, 2F y=3.5, roof y=7. Front door faces North, garage shutters East.',
      rooms: ROOMS.map((r) => ({ id: r.id, name: `${FLOOR_LABEL[r.floor]} ${r.name}`, floor: FLOOR_LABEL[r.floor], floorY: FLOOR_Y[r.floor], rects: r.rects, objectiveSpot: r.spot })),
      stairs: STAIRS.map((s) => ({ id: s.id, label: s.label, rect: s.rect, axis: s.axis, yMin: s.yMin, yMax: s.yMax })),
      hatches: HATCHES,
      openings: this.house.openings.map((o) => ({ id: o.id, kind: o.kind, label: o.label, center: o.center.toArray().map((v) => Math.round(v * 100) / 100), width: o.w, barricadeable: o.barricadeable, exterior: o.exterior })),
      spawns: SPAWN_ZONES.map((z) => ({ id: z.id, label: z.label, center: z.center, extract: z.extract })),
      sites: SITES,
    };
  }

  private timeLeft() {
    if (this.mode === 'pvp' && this.room?.state?.round) {
      const r = this.room.state.round;
      const now = this.room.serverNow();
      if (this.room.state.phase === 'prep') return (r.prepEndsAt - now) / 1000;
      if (this.room.state.phase === 'action') return ((r.defuserEndsAt ?? r.actionEndsAt) - now) / 1000;
      return 0;
    }
    return this.phaseEnds - this.world.time;
  }

  /* ================================================================ PvP */
  async joinRoom(nickname: string, code: string, mode: 'online' | 'local', asAgent = false): Promise<string> {
    this.leaveRoom();
    this.resetMap();
    this.disposePlayer();
    localStorage.setItem('r6.nick', nickname);
    if (!QA) mode = 'online'; // same-browser rooms are a QA tool (spec #24)
    const room = new RoomClient(code, nickname, asAgent, mode);
    this.room = room;
    this.mode = 'pvp';
    this.world.mode = 'pvp';
    this.world.friendlyFire = true;
    this.world.phase = 'lobby';
    // shots go over the low-latency DataChannel path; everything else is reliable & ordered (WS → DO)
    this.world.emit = (ev) => (ev.t === 'fire' ? room.sendFast([], [ev]) : room.sendEvent(ev));
    room.onState = (s) => this.onRoomState(s);
    room.onWelcome = (log) => { for (const ev of log) this.applyEvent('', ev); };
    room.onSnapshots = (from, snaps) => this.onSnapshots(from, snaps);
    room.onEvent = (from, ev) => this.applyEvent(from, ev);
    room.onError = (m) => this.onToast(t('net.error', m));
    room.onClosed = (m) => { if (this.room === room) this.onToast(t('net.disconnected', m)); };
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(room.selfId || 'pending'), 15000);
      const prev = room.onWelcome;
      room.onWelcome = (log) => { prev(log); clearTimeout(t); resolve(room.selfId); };
    });
  }

  leaveRoom() {
    if (!this.room) return;
    this.room.close();
    this.room = null;
    for (const r of this.remotes.values()) { r.dispose(this.scene); this.world.actors.delete(r.id); }
    this.remotes.clear();
    this.world.emit = () => {};
    this.roundKey = '';
  }

  setLoadout(actor: string, o: { squad?: 'A' | 'B'; operator?: string; spawn?: string; ready?: boolean }) {
    if (!this.room) return;
    this.room.send({ type: 'loadout', actor: actor || this.room.selfId, squad: o.squad, operator: o.operator as never, spawn: o.spawn as never, ready: o.ready });
  }

  addRoomAgent() {
    this.room?.send({ type: 'add_agent', nickname: `WebMCP-Agent` });
  }

  private onRoomState(s: RoomState) {
    const room = this.room!;
    this.syncRemotes(s);
    if (s.phase === 'lobby' || s.phase === 'matchEnd') {
      if (s.phase === 'matchEnd' && this.world.phase !== 'over') {
        const me = s.members.find((m) => m.id === room.selfId);
        const won = me ? s.score[me.squad] > s.score[me.squad === 'A' ? 'B' : 'A'] : false;
        this.hud.showBanner(t(won ? 'banner.matchWon' : 'banner.matchLost'), `${s.score.A} : ${s.score.B}`, 10);
      }
      this.world.phase = s.phase === 'lobby' ? 'lobby' : 'over';
      if (s.phase === 'lobby') { this.roundKey = ''; this.hud.show(false); this.view = 'body'; this.input.unlock(); }
      this.onLobby(s, room.selfId);
      return;
    }
    const r = s.round!;
    const key = `${r.index}:${r.seed}`;
    if (key !== this.roundKey) { this.roundKey = key; this.setupPvpRound(s); }
    const prevPhase = this.world.phase;
    this.world.phase = s.phase === 'prep' ? 'prep' : s.phase === 'action' ? 'action' : 'over';
    if (prevPhase === 'prep' && this.world.phase === 'action') this.endDronePhase();
    if (s.phase === 'roundEnd' && r.winner) {
      const me = s.members.find((m) => m.id === room.selfId);
      const won = me?.squad === r.winner;
      this.hud.showBanner(t(won ? 'banner.roundWon' : 'banner.roundLost'), `${reasonText(r.reason ?? '')} · ${s.score.A} : ${s.score.B}`, 6);
      this.audio.ui('round');
    }
    if (r.defuserEndsAt) this.world.objectives.serverClockOffset = room.clockOffset;
    if (r.defuserEndsAt && this.world.objectives.defuser) this.world.objectives.defuser.endsAt = r.defuserEndsAt / 1000;
    this.onLobby(s, room.selfId);
  }

  private setupPvpRound(s: RoomState) {
    const room = this.room!;
    const r = s.round!;
    this.resetMap();
    this.disposePlayer();
    const rand = mulberry32(r.seed);
    this.applyTod(r.timeOfDay, r.seed);
    const w = this.world;
    w.objectives.setup(r.mission, r.site, 'pvp');
    w.objectives.authority = s.hostId === room.selfId;
    w.objectives.hostageLocal = true;
    w.localId = room.selfId;
    const me = s.members.find((m) => m.id === room.selfId);
    if (me) {
      const team = teamOf(me, r);
      const sp = team === 'attack' ? this.spawnPoint(me.spawn, Math.random) : this.spawnInRoom(r.site, Math.random);
      this.player = this.makeSoldier(me.id, me.nickname, team, me.operator, 'local', sp.p, sp.yaw);
      this.playerCtl = new AgentController(w, this.player);
      this.vm.setCloth(this.player.op.cloth);
      if (team === 'attack') this.drone = w.gadgets.spawnDrone(this.player, this.dronePoint(me.spawn));
    }
    // my agent slots
    for (const m of s.members.filter((x) => x.isAgent && x.ownerId === room.selfId && x.id !== room.selfId)) {
      const team = teamOf(m, r);
      const sp = team === 'attack' ? this.spawnPoint(m.spawn, Math.random) : this.spawnInRoom(r.site, Math.random);
      this.addLocalAgentSlot(m.id, m.nickname, team, m.operator, sp);
    }
    for (const ra of this.remotes.values()) { ra.dispose(this.scene); w.actors.delete(ra.id); }
    this.remotes.clear();
    this.syncRemotes(s);
    this.input.resetStance();
    this.hud.show(true);
    this.onMatchStart();
    this.view = this.player?.side === 'attack' && this.drone ? 'drone' : 'body';
    this.hud.showBanner(`${t('hud.round', r.index + 1)} — ${missionName(r.mission)}`, t('banner.roundSub', t(r.timeOfDay === 'day' ? 'hud.day' : 'hud.night'), localizePlace(w.objectives.siteLabel()), t(this.player?.side === 'attack' ? 'hud.attacking' : 'hud.defending')), 5);
    void rand;
  }

  private syncRemotes(s: RoomState) {
    const room = this.room!;
    const ids = new Set<string>();
    for (const m of s.members) {
      if (m.ownerId === room.selfId) continue;
      ids.add(m.id);
      const side = teamOf(m, s.round);
      const ex = this.remotes.get(m.id);
      if (ex && ex.operator === m.operator && ex.side === side) continue;
      if (ex) { ex.dispose(this.scene); this.world.actors.delete(m.id); }
      const me = s.members.find((x) => x.id === room.selfId);
      const friendly = !!me && teamOf(me, s.round) === side;
      const ra = new RemoteActor(m.id, m.nickname, side, m.operator, this.physics, this.scene, friendly);
      ra.alive = m.alive;
      this.remotes.set(m.id, ra);
      this.world.actors.set(m.id, ra);
    }
    for (const [id, r] of this.remotes) if (!ids.has(id)) { r.dispose(this.scene); this.world.actors.delete(id); this.remotes.delete(id); }
  }

  private onSnapshots(_from: string, snaps: ActorSnapshot[]) {
    for (const s of snaps) this.remotes.get(s.id)?.push(s);
  }

  private applyEvent(from: string, ev: GameEvent) {
    const w = this.world;
    switch (ev.t) {
      case 'cells': this.destruction.apply({ panel: ev.panel, cells: ev.cells, dmg: ev.dmg }); break;
      case 'fire': { const a = w.actors.get(ev.actor); if (a) w.combat.remoteFire(a, ev.o, ev.d, ev.w); break; }
      case 'hit': w.applyRemoteHit(ev.target, ev.attacker, ev.dmg, ev.head); break;
      case 'death': {
        const a = w.actors.get(ev.actor);
        if (a && !w.isLocal(ev.actor)) {
          a.alive = false;
          if (a instanceof RemoteActor) a.rig.setDead(true);
          if (w.objectives.hostage && a === w.objectives.hostage) { w.objectives.hostage.alive = false; w.objectives.hostage.rig.setDead(true); }
          for (const k of w.onKill) k({ killer: ev.killer, victim: ev.actor, head: ev.head, weapon: w.lastWeaponOf.get(ev.killer) ?? '' });
        }
        break;
      }
      case 'barricade': w.interactions.remoteBarricade(ev.opening, ev.kind); break;
      case 'reinforce': { const p = this.destruction.get(ev.panel); if (p) w.interactions.reinforce(null, p, false); break; }
      case 'gadget':
        if (ev.op === 'spawn') w.gadgets.remoteSpawn(ev.g);
        else if (ev.op === 'remove') w.gadgets.remoteRemove(ev.id);
        else w.gadgets.remoteTrigger(ev.id, ev.p);
        break;
      case 'explosion': w.gadgets.remoteExplosion(ev.p, ev.r, ev.kind); break;
      case 'emp': w.gadgets.applyEmp(new THREE.Vector3(...ev.p), ev.r, w.actors.get(ev.by)?.side ?? 'attack'); break;
      case 'objective': w.objectives.remote(ev.kind, ev.actor, ev.data); break;
      case 'spot':
        if (ev.p) w.ping(new THREE.Vector3(...(ev.p as [number, number, number])), ev.team ?? w.actors.get(ev.by)?.side ?? '', ev.by, 4, false);
        else if (ev.target) w.spot(ev.target, ev.team ?? w.actors.get(ev.by)?.side ?? '', 5, false, ev.by);
        if (ev.team === this.player?.side) this.audio.ui('ping');
        break;
      case 'flash': {
        const o = new THREE.Vector3(...(ev.p as [number, number, number]));
        this.effects.flashBurst(o.clone().addScaledVector(new THREE.Vector3(...(ev.d as [number, number, number])), 0.6));
        w.gadgets.applyFlash(o, new THREE.Vector3(...(ev.d as [number, number, number])), w.actors.get(ev.by)?.side ?? 'attack');
        break;
      }
    }
    void from;
  }

  private sendSnapshots() {
    if (!this.room) return;
    const snaps: ActorSnapshot[] = [];
    const mk = (s: Soldier): ActorSnapshot => ({
      id: s.id, t: performance.now(), p: [r2(s.pos.x), r2(s.pos.y), r2(s.pos.z)], v: [r2(s.vel.x), r2(s.vel.y), r2(s.vel.z)],
      yaw: r3(s.yaw), pitch: r3(s.pitch), st: s.mode === 'rappel' ? (s.inverted ? 4 : 3) : s.stance, lean: r2(s.lean), w: s.slot, hp: Math.round(s.hp), alive: s.alive, ads: s.ads > 0.5,
      dr: this.drone && s === this.player && this.view === 'drone' ? [r2(this.drone.pos.x), r2(this.drone.pos.y), r2(this.drone.pos.z)] : undefined,
      sx: s.shieldExtended || undefined, mt: s.mounted ? true : undefined,
    });
    if (this.player) snaps.push(mk(this.player));
    for (const s of this.slots) snaps.push(mk(s.soldier));
    this.room.sendSnapshots(snaps);
  }

  /* ================================================================ misc */
  private applyTod(tod: TimeOfDay, seed: number) {
    this.lighting.apply(tod, seed);
    this.vm.setTimeOfDay(tod === 'day');
    // night: tight bloom so lamp glows don't smear an orange haze across the frame
    this.bloom.strength = tod === 'day' ? 0.3 : 0.32;
    this.bloom.radius = tod === 'day' ? 0.5 : 0.25;
    this.bloom.threshold = tod === 'day' ? 0.88 : 0.95;
  }

  private endDronePhase() {
    // the drone stays on the map for the action phase ([3] to drive it again)
    if (this.view !== 'body') this.view = 'body';
    this.hud.showBanner(t('banner.action'), t(this.player?.side === 'attack' ? 'banner.actionAtk' : 'banner.actionDef'), 3);
    this.audio.ui('round');
  }

  private disposePlayer() {
    if (this.player) {
      this.player.dispose();
      this.world.actors.delete(this.player.id);
      this.world.soldiers.delete(this.player.id);
      this.player = null;
      this.playerCtl = null;
    }
  }

  quitToMenu() {
    this.leaveRoom();
    this.resetMap();
    this.disposePlayer();
    this.mode = 'menu';
    this.world.phase = 'lobby';
    this.hud.show(false);
    this.input.unlock();
    this.placeMenuCamera();
    this.onMenu();
  }

  private placeMenuCamera() {
    this.camera.position.set(-26, 7, 18);
    this.camera.lookAt(0, 2, 0);
    this.camera.rotation.order = 'YXZ';
  }

  /* ================================================================ main loop */
  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.ready) return;
    this.stats.frameMs = this.stats.frameMs * 0.95 + dt * 1000 * 0.05;
    if (this.autoQuality && this.mode !== 'menu' && this.quality !== 'low') {
      this.slowFor = this.stats.frameMs > (this.quality === 'high' ? 26 : 38) ? this.slowFor + dt : 0;
      if (this.slowFor > 4) {
        this.slowFor = 0;
        this.setQuality(this.quality === 'high' ? 'medium' : 'low');
        this.onToast(t('toast.quality', t(this.quality === 'medium' ? 'set.qMed' : 'set.qLow')));
      }
    }
    if (this.mode === 'menu') {
      const t = now * 0.00004;
      if (this.freeCam) this.applyFreeCam();
      else {
        this.camera.position.set(Math.sin(t) * 30, 8 + Math.sin(t * 3) * 1.5, Math.cos(t) * 30);
        this.camera.lookAt(0, 1.5, 0);
      }
      this.effects.update(dt);
      this.lighting.update(dt, this.camera, new THREE.Vector3());
      this.destruction.update();
      this.composer.render(dt);
      return;
    }
    const pausedTH = this.mode === 'th' && this.paused;
    if (!pausedTH) {
      this.acc += dt;
      let steps = 0;
      this.firedThisFrame = false;
      const t0 = performance.now();
      while (this.acc >= 1 / 60 && steps < 4) { this.step(1 / 60); this.acc -= 1 / 60; steps++; }
      if (steps === 4) this.acc = 0;
      if (steps) this.stats.stepMs = this.stats.stepMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
    }
    const t1 = performance.now();
    this.render(dt);
    this.stats.renderMs = this.stats.renderMs * 0.9 + (performance.now() - t1) * 0.1;
    this.stats.frames++;
  }

  private step(dt: number) {
    const w = this.world;
    w.time += dt;
    // --- player input (keyboard/mouse merged with WebMCP 'self' actions)
    const p = this.player;
    const rappelling = p?.mode === 'rappel';
    const enterPressed = this.input.wasPressed('Enter') || this.input.wasPressed('NumpadEnter'); // read before sample() flushes edges
    const human = this.input.sample(!!rappelling);
    let inp: SoldierInput = human;
    if (this.playerCtl?.active()) inp = mergeInput(human, this.playerCtl.input(dt));
    this.lookDelta = { x: inp.lookDYaw, y: inp.lookDPitch };
    // --- phase timers (TH)
    if (this.mode === 'th' && !this.thResult) {
      if (w.phase === 'prep' && w.time >= this.phaseEnds) {
        w.phase = 'action';
        this.phaseEnds = w.time + 360;
        this.endDronePhase();
      } else if (w.phase === 'action' && w.time >= this.phaseEnds) this.endTH(false, 'Time expired');
    }
    // --- views: drone (attackers; forced during prep) · CCTV (defenders) · body
    if (this.mode === 'th' && w.phase === 'prep' && enterPressed) this.phaseEnds = w.time;
    if (p && !p.alive && inp.jump) this.spectateIdx++;
    if (p) {
      if (this.view === 'drone' && (!this.drone || this.drone.data.destroyed || this.drone.state === 'done')) {
        this.view = 'body';
        this.hud.showBanner(t('hud.droneDestroyed'), '', 2);
      }
      if (this.view !== 'body' && !p.alive) this.view = 'body';
      if (this.pingReq) { this.pingReq = false; if (p.alive) this.doPing(); }
      if (inp.ping) this.doPing();
      if (this.view === 'drone' && this.drone) {
        const dinp = { ...inp };
        if (this.playerCtl?.active()) {
          const d = this.playerCtl.droneInput();
          if (d.f || d.r) { dinp.moveF = d.f; dinp.moveR = d.r; }
          if (d.jump) dinp.jump = true;
        }
        w.gadgets.updateDrone(this.drone, dt, dinp);
        p.update(dt, emptyInput());
      } else if (this.view === 'cam') {
        const cam = this.house.cameras[this.camIdx];
        if (!cam?.alive) this.nextCam(1);
        this.camLook.yaw += inp.lookDYaw;
        this.camLook.pitch = THREE.MathUtils.clamp(this.camLook.pitch + inp.lookDPitch, -1.1, 0.3);
        if (cam) { const d = THREE.MathUtils.euclideanModulo(this.camLook.yaw - cam.yaw + Math.PI, Math.PI * 2) - Math.PI; this.camLook.yaw = cam.yaw + THREE.MathUtils.clamp(d, -1.3, 1.3); }
        const wheel = this.input.consumeWheel();
        if (inp.firePressed || wheel > 0) this.nextCam(1);
        if (wheel < 0) this.nextCam(-1);
        p.update(dt, emptyInput());
      } else {
        this.prevMag = p.weapon?.mag ?? -1;
        p.update(dt, inp);
        if (p.weapon && p.weapon.mag < this.prevMag) { this.firedThisFrame = true; this.thStats.shots++; }
      }
    }
    // --- agent slots (built-in policy unless an external agent is driving)
    for (const s of this.slots) {
      if (s.policy === 'external' && performance.now() - s.ctl.lastActionAt > 2500) s.policy = 'builtin';
      if (s.policy === 'builtin') {
        s.thinkT -= dt;
        if (s.thinkT <= 0) {
          s.thinkT = 1 / 6;
          const a = s.brain.think(this.bridge.observe(s.id), 1 / 6);
          if (a) { s.ctl.apply(a); s.ctl.lastActionAt = -1e9; }
        }
      }
      const sinp = s.ctl.input(dt);
      if (sinp.ping && s.soldier.alive) this.pingFrom(s.soldier, s.soldier.eye(), s.soldier.aimDir());
      if (w.phase === 'prep' && s.soldier.side === 'attack') s.soldier.update(dt, emptyInput());
      else s.soldier.update(dt, sinp);
    }
    // --- bots
    for (const b of this.bots) b.s.update(dt, b.update(dt));
    // --- systems
    w.gadgets.update(dt);
    w.objectives.update(dt);
    w.interactions.sweep();
    this.destruction.update();
    this.physics.step();
    for (const r of this.remotes.values()) r.update(dt);
    // --- win/lose (TH)
    if (this.mode === 'th' && !this.thResult && w.phase === 'action') {
      const alive = this.bots.filter((b) => b.s.alive).length;
      w.objectives.checkElimination(alive);
      const attackersAlive = (p?.alive ? 1 : 0) + this.slots.filter((s) => s.soldier.alive).length;
      if (attackersAlive === 0) this.endTH(false, 'All operators down');
    }
    // --- net
    this.snapT -= dt;
    if (this.snapT <= 0 && this.room) { this.snapT = 0.05; this.sendSnapshots(); }
    this.bridge.update(dt);
    w.pruneSounds();
  }

  private render(dt: number) {
    const w = this.world;
    const p = this.player;
    // local non-player rigs
    for (const [id, rig] of this.rigs) {
      const s = w.soldiers.get(id);
      if (!s) continue;
      rig.root.position.copy(s.pos);
      rig.root.rotation.y = s.yaw;
      if (rig.dead !== !s.alive) rig.setDead(!s.alive);
      rig.setShieldExtended(s.shieldExtended);
      rig.pose(dt, s.mode === 'rappel' ? Stance.Rappel : s.stance, s.pitch, s.lean, Math.hypot(s.vel.x, s.vel.z), s.mode === 'rappel' && s.inverted);
    }
    // camera
    for (const r of this.remotes.values()) r.rig.root.visible = true;
    let camSoldier: Soldier | null = p;
    let spectating = '';
    const inDrone = !!(this.drone && this.view === 'drone' && p);
    const inCam = !!(this.view === 'cam' && p);
    if (this.drone) this.drone.mesh.visible = !inDrone;
    if (inDrone) {
      const d = this.drone!;
      this.camera.position.copy(d.pos).add(new THREE.Vector3(0, 0.05, 0));
      this.camera.rotation.set(d.data.pitch as number, d.data.yaw as number, 0, 'YXZ');
      this.camera.fov = 88;
      camSoldier = null;
    } else if (inCam) {
      const c = this.house.cameras[this.camIdx];
      this.camera.position.copy(c.pos).add(new THREE.Vector3(-Math.sin(this.camLook.yaw) * 0.22, -0.06, -Math.cos(this.camLook.yaw) * 0.22));
      this.camera.rotation.set(this.camLook.pitch, this.camLook.yaw, 0, 'YXZ');
      this.camera.fov = 82;
      camSoldier = null;
    } else if (p && !p.alive) {
      const mates = [...this.slots.map((s) => s.soldier)].filter((s) => s.alive);
      if (mates.length) {
        camSoldier = mates[this.spectateIdx % mates.length];
        spectating = `SPECTATING ${camSoldier.name} (WebMCP agent view)`;
      } else camSoldier = null;
      if (!camSoldier) {
        // PvP: watch a living remote teammate through their eyes
        const remoteMates = [...this.remotes.values()].filter((r) => r.alive && r.side === p.side);
        if (remoteMates.length) {
          const r = remoteMates[this.spectateIdx % remoteMates.length];
          r.rig.root.visible = false;
          this.camera.position.copy(r.eye());
          this.camera.rotation.set(r.pitch, r.yaw, -r.lean * 0.21, 'YXZ');
          this.camera.fov = this.fov;
          spectating = `SPECTATING ${r.name}`;
        } else {
          this.camera.position.lerp(p.pos.clone().add(new THREE.Vector3(2.5, 3, 2.5)), Math.min(1, dt * 2));
          this.camera.lookAt(p.pos);
        }
      }
    }
    if (camSoldier && !inDrone && !inCam) {
      this.camera.position.copy(camSoldier.eye());
      this.camera.rotation.set(camSoldier.pitch + camSoldier.recoilP, camSoldier.yaw + camSoldier.recoilY, camSoldier.cameraRoll, 'YXZ');
      const adsFov = camSoldier.weapon ? camSoldier.weapon.def.adsFov : this.fov;
      this.camera.fov = THREE.MathUtils.lerp(this.fov, Math.min(this.fov, adsFov + 20), camSoldier.ads);
    }
    if (this.freeCam) { this.applyFreeCam(); camSoldier = null; }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.audio.setListener(this.camera);
    // FX & lighting
    this.lighting.update(dt, this.camera, this.camera.position);
    // body flashlight, or the drone's own headlight at night so the feed is never black (spec #9/#22)
    const droneLamp = inDrone && this.lighting.tod === 'night';
    if ((this.lighting.flashlightOn && camSoldier) || droneLamp) this.lighting.aimFlashlight(this.camera);
    this.lighting.flashlight.visible = (!!camSoldier && this.lighting.flashlightOn) || droneLamp;
    this.effects.ambient(this.camera.position, dt);
    this.effects.update(dt);
    // hide own body rig when viewing through someone
    for (const [id, rig] of this.rigs) rig.root.visible = !(camSoldier && id === camSoldier.id);
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.5);
    this.grade.uniforms.hurt.value = this.hurtFx * 0.6 + (p && p.alive && p.hp < 30 ? 0.25 : 0);
    this.grade.uniforms.time.value = w.time;
    this.grade.uniforms.droneFx.value = inDrone ? 1 : inCam ? 0.75 : 0;
    this.grade.uniforms.night.value = this.lighting.tod === 'night' ? 1 : 0;
    this.grade.uniforms.blind.value = p && p.alive ? THREE.MathUtils.clamp((p.blindUntil - w.time) / 1.5, 0, 1) : 0;
    this.renderer.autoClear = true;
    this.composer.render(dt);
    // view model
    if (camSoldier && camSoldier.alive && !inDrone && !inCam && camSoldier.mode !== 'swing' && camSoldier.mode !== 'vault') {
      const cp = this.camera.position;
      const inside = cp.x > HOUSE_RECT.x0 && cp.x < HOUSE_RECT.x1 && cp.z > HOUSE_RECT.z0 && cp.z < HOUSE_RECT.z1 && cp.y < ROOF_Y - 0.2;
      const dim = inside ? (this.lighting.tod === 'day' ? 0.6 : 0.45) : this.lighting.tod === 'day' ? 1 : 0.5;
      const sprint = Math.hypot(camSoldier.vel.x, camSoldier.vel.z) > 4.5;
      this.vm.update(dt, camSoldier, this.lookDelta, this.firedThisFrame && camSoldier === p, sprint, this.camera.aspect, dim);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.clearStencil();
      this.renderer.render(this.vm.scene, this.vm.camera);
      if (camSoldier === p) { p.boreYaw = this.vm.boreYaw; p.borePitch = this.vm.borePitch; }
      this.renderer.autoClear = true;
    }
    if (p) this.updateHud(dt, camSoldier ?? p, inDrone, spectating, inCam);
  }

  /** QA / screenshot free camera (null in normal play) */
  freeCam: { p: [number, number, number]; yaw: number; pitch: number; fov?: number } | null = null;
  private applyFreeCam() {
    const f = this.freeCam!;
    this.camera.position.set(...f.p);
    this.camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    this.camera.fov = f.fov ?? this.fov;
    this.camera.updateProjectionMatrix();
  }

  private updateHud(dt: number, s: Soldier, inDrone: boolean, spectating: string, inCam: boolean) {
    const w = this.world;
    const st = w.objectives.status();
    const wpn = s.weapon;
    const p = this.player!;
    const cap = (a: string) => this.input.binds.cap(a);
    const phase = w.phase === 'prep' ? t(s.side === 'attack' ? 'hud.phasePrepAtk' : 'hud.phasePrepDef') : w.phase === 'action' ? t('hud.phaseAction') : w.phase === 'over' ? t('hud.phaseOver') : t('hud.phaseLobby');
    const scanning = w.gadgets.isScanning(s) ? (w.gadgets.heartbeats.get(s.id) ?? []).map((h) => ({ bearing: wrap180(THREE.MathUtils.radToDeg(Math.atan2(h.dir.x, -h.dir.z)) - headingDeg(s.yaw)), dist: h.dist, vertical: h.dy > 1.5 ? 'Above' : h.dy < -1.5 ? 'Below' : 'Same_Floor' })) : [];
    let score = '';
    if (this.mode === 'th') score = `${t('hud.enemiesLeft', this.bots.filter((b) => b.s.alive).length)} · ${t('hud.kills', this.thKills)}`;
    else if (this.room?.state) {
      const me = this.room.state.members.find((m) => m.id === this.room!.selfId);
      score = `A ${this.room.state.score.A} : ${this.room.state.score.B} B${me ? ` · ${t('hud.squad')} ${me.squad}` : ''} · ${this.room.kind === 'local' ? 'LOCAL' : t('lobby.online')} ${this.room.code}`;
    }
    const objText = t(st.key, ...st.args.map((a) => a.split(' / ').map(localizePlace).join(' / '))) + (st.defuserEndsIn !== undefined ? ` · ${t('obj.defuserIn', Math.ceil(st.defuserEndsIn))}` : '');
    const gname = (g: string, fallback: string) => (has(`gname.${g}`) ? t(`gname.${g}`) : fallback);
    // gadget slots: [G] operator gadget · [X] universal (breach charge / barricades) · reinforcements
    const gadgets: HudGadget[] = [];
    if (s.op.gadget !== 'none') gadgets.push({ cap: cap('gadget'), name: gname(s.op.gadget, s.op.gadgetName), left: s.op.gadget === 'heartbeat' || s.op.gadget === 'scanner' || s.op.gadget === 'shield_ext' ? '∞' : `×${s.gadgetLeft}`, active: s.slot === 2 });
    if (s.op.universal === 'breach') gadgets.push({ cap: cap('gadget2'), name: t('gname.breach'), left: `×${s.universalLeft}`, active: s.slot === 3 });
    if (s.op.universal === 'barricade') gadgets.push({ cap: cap('interact'), name: t('gname.barricade'), left: '∞', active: false });
    if (s.side === 'defend') gadgets.push({ cap: cap('interact'), name: t('gname.reinforce'), left: `×${s.reinforcementsLeft}`, active: false });
    // stance + flags
    const stance = s.mode === 'rappel' ? t(s.inverted ? 'hud.rappelInv' : 'hud.rappel') : [t('hud.stand'), t('hud.crouch'), t('hud.prone'), t('hud.rappel')][s.stance];
    const lean = s.lean < -0.3 ? ` · ${t('hud.leanL')}` : s.lean > 0.3 ? ` · ${t('hud.leanR')}` : '';
    const flags = [t(this.lighting.tod === 'day' ? 'hud.day' : 'hud.night'), this.destruction.xray ? t('hud.xray') : '', w.gadgets.isScanning(s) ? t('hud.scan') : '', w.gadgets.isIqScanning(s) ? t('hud.iqScan') : '', s.shieldExtended ? t('hud.shieldExt') : '', this.extraLine].filter(Boolean).join(' · ');
    // view (drone / CCTV) labels
    let viewTitle = '';
    let viewHelp = '';
    let location = localizePlace(locationName(s.pos));
    let heading = headingDeg(s.yaw);
    if (inDrone && this.drone) {
      viewTitle = `${t('hud.drone')} · ${localizePlace(locationName(this.drone.pos))}`;
      viewHelp = w.phase === 'prep' && p.side === 'attack' ? `${t('hud.dronePrepHelp')} · ${t('hud.droneHelp', cap('forward'), cap('left'), cap('back'), cap('right'), cap('vault'), cap('ping'), cap('observe'))}` : t('hud.droneHelp', cap('forward'), cap('left'), cap('back'), cap('right'), cap('vault'), cap('ping'), cap('observe'));
      location = viewTitle;
      heading = headingDeg(this.drone.data.yaw as number);
    } else if (inCam) {
      const c = this.house.cameras[this.camIdx];
      viewTitle = `${t('hud.cam')} ${this.camIdx + 1}/${this.house.cameras.length} · ${c ? localizePlace(c.label) : ''}`;
      viewHelp = t('hud.camHelp', cap('fire'), cap('ping'), cap('observe'));
      location = viewTitle;
      heading = headingDeg(this.camLook.yaw);
    }
    const hs: HudState = {
      hp: s.hp, operator: s.op.name.toUpperCase(), unit: s.op.unit, opColor: s.op.cloth,
      weapon: wpn ? wpn.def.name : s.slot === 2 ? gname(s.op.gadget, s.op.gadgetName) : t('gname.breach'),
      mag: wpn?.mag ?? 0, magMax: wpn?.def.mag ?? 1, reserve: wpn?.reserve ?? 0, reloading: s.reloading, reloadCap: cap('reload'), slot: s.slot, gadgets,
      location, heading, phase, timer: this.timeLeft(), urgent: w.phase === 'action' && this.timeLeft() <= 30,
      objective: objText, objectiveProgress: st.progress, site: `${t(`missionShort.${st.mission}`)} · ${st.siteLabel.split(' / ').map(localizePlace).join(' / ')}`,
      prompt: s.interactLabel ? t(s.interactLabel) : this.gadgetHintText(s.gadgetHint), progress: s.interactProgress,
      spread: (wpn ? THREE.MathUtils.lerp(wpn.def.hipSpread, wpn.def.adsSpread, s.ads) : 1) + Math.hypot(s.vel.x, s.vel.z) * 0.3,
      ads: s.ads, stance: stance + lean, flags, score,
      view: inDrone ? 'drone' : inCam ? 'cam' : 'body', viewTitle, viewHelp,
      droneJammed: inDrone && !!(this.drone?.data.jammed), scanning, dead: !p.alive && !this.thResult, spectating,
      markers: this.hudMarkers(p), team: this.hudTeam(p), hints: this.hudHints(p, inDrone, inCam),
    };
    this.hud.update(hs, dt);
    if (this.input.down('score')) this.hud.scoreboard(true, this.scoreboardHtml());
    else this.hud.scoreboard(false);
  }

  /** "gadget.place|G|Exothermic Charge" → "[G] Place Exothermic Charge" with the real key cap & localized name */
  private gadgetHintText(h: string): string {
    // equip/throw/fire are always available and already shown in the gadget slots — only surface actionable context
    if (!h || /^gadget\.(equip|throw|fire)\|/.test(h)) return '';
    const parts = h.split('|');
    const key = parts[1] === 'G' ? this.input.binds.cap('gadget') : parts[1] === 'X' ? this.input.binds.cap('gadget2') : parts[1] ?? '';
    const raw = parts[2] ?? '';
    const gid = raw === 'gadgetName.breach' ? 'breach' : Object.values(OPERATORS).find((o) => o.gadgetName === raw)?.gadget ?? '';
    const name = gid && has(`gname.${gid}`) ? t(`gname.${gid}`) : raw;
    return t(parts[0], key, name);
  }

  private hudTeam(p: Soldier): HudMate[] {
    const out: HudMate[] = [];
    const add = (a: { name: string; operator: string; hp: number; alive: boolean }, me: boolean, agent: boolean) => {
      const op = OPERATORS[a.operator];
      out.push({ name: a.name, op: op?.name ?? a.operator, hp: a.alive ? a.hp : 0, alive: a.alive, me, agent, color: op?.cloth ?? '#555' });
    };
    add(p, true, false);
    for (const s of this.slots) if (s.soldier.side === p.side) add(s.soldier, false, true);
    for (const r of this.remotes.values()) if (r.side === p.side) add(r, false, !!this.room?.state?.members.find((m) => m.id === r.id)?.isAgent);
    return out.length > 1 ? out.slice(0, 5) : [];
  }

  private markerTmp = new THREE.Vector3();
  private project(pos: THREE.Vector3, kind: HudMarker['kind'], label: string, clampOff = true): HudMarker | null {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const v = this.markerTmp.copy(pos).project(this.camera);
    const dist = pos.distanceTo(this.camera.position);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * W;
    let y = (-v.y * 0.5 + 0.5) * H;
    let off = behind || x < 24 || x > W - 24 || y < 24 || y > H - 24;
    if (off) {
      if (!clampOff) return null;
      // pin to an ellipse at the screen edge, pointing toward the target
      let dx = v.x;
      let dy = -v.y;
      if (behind) { dx = -dx; dy = -dy; if (Math.abs(dy) < 0.05) dy = 0.6; }
      const a = Math.atan2(dy, dx);
      x = W / 2 + Math.cos(a) * (W / 2 - 40);
      y = H / 2 + Math.sin(a) * (H / 2 - 40);
      off = true;
    }
    return { x, y, kind, label, dist, off };
  }

  private hudMarkers(p: Soldier): HudMarker[] {
    const w = this.world;
    const out: HudMarker[] = [];
    const push = (m: HudMarker | null) => { if (m) out.push(m); };
    // spotted enemies (team-shared, 5 s)
    for (const [id, sp] of w.spots) {
      if (sp.until < w.time || sp.team !== p.side) continue;
      const a = w.actors.get(id);
      if (!a || !a.alive) continue;
      push(this.project(a.pos.clone().add(new THREE.Vector3(0, 2.05, 0)), 'spot', t('hud.spotted')));
    }
    for (const pg of w.pings) if (pg.until > w.time && pg.team === p.side) push(this.project(pg.pos, 'ping', w.actors.get(pg.by)?.name ?? ''));
    // IQ: enemy electronics through walls
    for (const c of w.gadgets.iqContacts.get(p.id) ?? []) if (w.gadgets.isIqScanning(p)) push(this.project(c, 'iq', '', false));
    // objective
    const o = w.objectives;
    let obj: THREE.Vector3 | null = null;
    if (o.mission === 'bomb') obj = o.defuser?.pos ?? o.bombs.find((b) => b.state === 'armed')?.pos ?? null;
    else if (o.mission === 'hostage' && o.hostage?.alive) obj = o.hostage.carrier === p.id ? null : o.hostage.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    else if (o.mission === 'secure') obj = o.spotOf(o.site);
    if (obj && p.alive && this.view === 'body' && obj.distanceTo(p.pos) > 3) push(this.project(obj, 'obj', t(`missionShort.${o.mission}`)));
    // teammates out of sight: small name tags
    for (const s of this.slots) if (s.soldier.alive && s.soldier.side === p.side) push(this.project(s.soldier.pos.clone().add(new THREE.Vector3(0, 2, 0)), 'mate', s.nickname, false));
    for (const r of this.remotes.values()) if (r.alive && r.side === p.side) push(this.project(r.pos.clone().add(new THREE.Vector3(0, 2, 0)), 'mate', r.name, false));
    return out.slice(0, 24);
  }

  /** compact, context-sensitive key hints (full keymap: F1) */
  private hudHints(p: Soldier, inDrone: boolean, inCam: boolean): HudHint[] {
    const cap = (a: string) => this.input.binds.cap(a);
    const w = this.world;
    if (!p.alive) return [{ cap: cap('vault'), label: t('hint.nextMate') }, { cap: cap('score'), label: t('key.score') }];
    if (inDrone) return [];
    if (inCam) return [];
    const h: HudHint[] = [];
    if (w.phase === 'prep' && this.mode === 'th') h.push({ cap: 'Enter', label: t('hint.skipPrep') });
    if (p.side === 'attack' && this.drone && !this.drone.data.destroyed && this.drone.state !== 'done') h.push({ cap: cap('observe'), label: t('hint.drone') });
    if (p.side === 'defend' && this.house.cameras.some((c) => c.alive)) h.push({ cap: cap('observe'), label: t('hint.cams') });
    h.push({ cap: cap('ping'), label: t('hint.ping') });
    if (this.lighting.tod === 'night') h.push({ cap: cap('flashlight'), label: t('key.flashlight') });
    h.push({ cap: cap('help'), label: t('hint.allKeys') });
    return h;
  }

  private scoreboardHtml(): string {
    const rows: string[] = [];
    if (this.room?.state) {
      for (const sq of ['A', 'B'] as const) {
        rows.push(`<h4>Squad ${sq} — ${this.room.state.score[sq]}</h4>`);
        for (const m of this.room.state.members.filter((x: MemberInfo) => x.squad === sq)) rows.push(`<div class="sb-row ${m.alive ? '' : 'dead'}"><span>${esc(m.nickname)}${m.isAgent ? ' 🤖' : ''}</span><span>${esc(OPERATORS[m.operator]?.name ?? m.operator)}</span><span>${m.kills} / ${m.deaths}</span></div>`);
      }
    } else {
      rows.push('<h4>Rainbow</h4>');
      if (this.player) rows.push(`<div class="sb-row ${this.player.alive ? '' : 'dead'}"><span>${esc(this.player.name)}</span><span>${this.player.op.name}</span><span>${this.thKills} kills</span></div>`);
      for (const s of this.slots) rows.push(`<div class="sb-row ${s.soldier.alive ? '' : 'dead'}"><span>${esc(s.nickname)} 🤖</span><span>${s.soldier.op.name}</span><span>${s.policy}</span></div>`);
      rows.push(`<h4>White Masks — ${this.bots.filter((b) => b.s.alive).length} alive</h4>`);
      for (const b of this.bots) rows.push(`<div class="sb-row ${b.s.alive ? '' : 'dead'}"><span>${esc(b.s.name)}</span><span>${b.state}</span><span>${esc(b.reason)}</span></div>`);
    }
    return rows.join('');
  }
}

function mergeInput(a: SoldierInput, b: SoldierInput): SoldierInput {
  return {
    moveF: THREE.MathUtils.clamp(a.moveF + b.moveF, -1, 1), moveR: THREE.MathUtils.clamp(a.moveR + b.moveR, -1, 1), sprint: a.sprint || b.sprint,
    fire: a.fire || b.fire, firePressed: a.firePressed || b.firePressed, ads: a.ads || b.ads, reload: a.reload || b.reload, melee: a.melee || b.melee,
    stance: b.stance ?? a.stance, lean: b.lean || a.lean, interact: a.interact || b.interact, interactPressed: a.interactPressed || b.interactPressed,
    slot: b.slot ?? a.slot, alt: a.alt || b.alt, invert: a.invert || b.invert, jump: a.jump || b.jump, lookDYaw: a.lookDYaw + b.lookDYaw, lookDPitch: a.lookDPitch + b.lookDPitch,
    gadget: a.gadget || b.gadget, gadgetHeld: a.gadgetHeld || b.gadgetHeld, gadget2: a.gadget2 || b.gadget2, gadget2Held: a.gadget2Held || b.gadget2Held, ping: a.ping || b.ping,
  };
}

export function missionName(m: string) {
  return has(`missionShort.${m}`) ? t(`missionShort.${m}`) : m.toUpperCase();
}

const REASON_KEYS: Record<string, string> = {
  'Time expired': 'reason.timeout', 'All operators down': 'reason.allDown', 'All hostiles eliminated': 'reason.eliminated', 'Bombs disarmed': 'reason.bombs',
  'Hostage extracted': 'reason.extracted', 'Area secured': 'reason.secured', 'Hostage killed by attackers': 'reason.hostageKilledAtk', 'Hostage killed by defenders': 'reason.hostageKilledDef',
  'Defuser disabled': 'reason.defuserDisabled', 'Bomb defused': 'reason.bombDefused', 'Defuser completed': 'reason.defuserDone', 'Attackers eliminated': 'reason.atkDead', 'Defenders eliminated': 'reason.defDead',
};
/** objective / server reasons are English (agents read them); show them localized */
export function reasonText(r: string) { return REASON_KEYS[r] ? t(REASON_KEYS[r]) : r; }

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
export { ATTACKERS, DEFENDERS, MISSIONS };
