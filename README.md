# Rainbow Six Siege: Original 2015 Edition — Web Tactical FPS

A fan-made, non-commercial tribute that runs **instantly in the browser** (no install): first-person
tactical destruction on a reconstruction of the original 2015 **House**, Terrorist Hunt against FSM
bots, room-code PvP over **Cloudflare Durable Objects + WebRTC**, and a **WebMCP** bridge that lets
LLM/AI agents join matches through a first-person-legal DOM context.

```
npm install
npm run dev            # http://localhost:5173  (Terrorist Hunt + local multi-tab PvP work without a server)
npm run dev:worker     # optional: Durable Object room server on :8787 (vite proxies /api → it)
npm run build          # typecheck (client + worker) + production build → dist/
npm test               # unit tests (room state machine, destruction cells, hitboxes, spread)
npm run test:e2e       # browser smoke test against `vite preview` (Playwright, SwiftShader WebGL)
```

## Feature map (brief → implementation)

| # | Brief | Where |
|---|---|---|
| 1 | Tactical Low-Poly art, sharp weapon/operator silhouettes | `src/assets/weaponModels.ts` (receiver, rail, optic: holo/ACOG/reflex, suppressor, mag bone), `src/assets/operatorModels.ts` (helmets, carriers, unique gadget silhouettes), `src/render/Rig.ts` |
| 1 | E3 2014 chiaroscuro lighting, day/night, dynamic shadows, volumetric dust | `src/render/Lighting.ts` (hard low key light + PCF shadows, interior exposure falloff shader patch in `palette.ts`, swept-window light shafts, street lamps, police lights, interior practicals, weapon flashlight), `src/render/Effects.ts` (smoke, dust motes, debris, sparks, toxic gas), bloom + grade pass in `Game.ts` |
| 1 | **CLI-Anything** 3D pipeline | `tools/cli-anything/` — specs → `cli-anything-blender` commands → Blender → `public/assets/models/*.glb` (+ `commands.sh` transcripts), loaded at runtime by `src/assets/library.ts` |
| 2 | Original House (B / 1F / 2F / roof) + 4 exterior spawns | `src/map/houseLayout.ts` (walls, openings, floors, stairs, hatches, rooms), `src/map/houseProps.ts` (cover), `src/map/Suburb.ts` (Construction Site, River Docks, APC Area, Side Street, police cruisers, neighbour silhouettes) |
| 3 | Soft / semi-breach / solid surfaces, wallbangs, murder holes, breaches | `src/world/Destruction.ts` (0.25 m cells, greedy-merged meshes **and** Rapier colliders, studs/joists, reinforcement, commutative damage) + `src/game/Combat.ts` (penetrating hitscan) |
| 3 | Rappel (vertical/lateral, invert, Breach & Swing), barricades, reinforcement ×2 | `src/game/Soldier.ts` (rappel state machine), `src/game/Interactions.ts` |
| 4 | Random day/night + mission (Hostage / Secure / Bomb) + site per round, prep → action | `shared/roomLogic.ts` (PvP), `Game.startTH` (TH), `src/game/Objectives.ts` |
| 4 | 11 launch operators & gadgets | `src/game/operators.ts`, `src/game/Gadgets.ts` (hammer, CREM rounds, thermite, EMP, cluster charge, gas, jammer, armor panel, heartbeat, ADS, shock wire, breach charges, drones) |
| 4 | Lean Q/E, ADS, crouch/prone, recoil, one-shot headshots | `src/game/Soldier.ts`, `src/game/Actor.ts` (head sphere + capsules), `src/render/ViewModel.ts` |
| 5 | Terrorist Hunt: FSM bots, lerp aim, Gaussian/linear spread | `src/ai/Bot.ts` (PATROL / ALERT / ATTACK / COVER), `src/ai/NavGraph.ts` (breach-aware A*) |
| 6 | Nickname + 6-char room code (`R6-8492`), DO routing, WebRTC + WS hybrid | `worker/src/index.ts` (RoomDO), `functions/api/room/[code].ts`, `src/net/RoomClient.ts`, `src/net/Transport.ts` |
| 7 | WebMCP DOM bridge + `window.webmcp` + `AGENT_CONTEXT.md` + lobby modal + local agent slots | `src/webmcp/*`, `AGENT_CONTEXT.md`, `tools/agents/webmcp-playwright-agent.mjs` |
| 8 | `wrangler.toml` (Pages + DO binding), GitHub Actions deploy | `wrangler.toml`, `worker/wrangler.toml`, `.github/workflows/deploy.yml`, `.github/workflows/assets.yml` |

## Architecture

```
 Browser (Cloudflare Pages: static Vite build)                       Cloudflare
 ┌──────────────────────────────────────────────────────────┐      ┌──────────────────────────────────┐
 │ Three.js renderer ── Lighting / Effects / ViewModel / HUD │      │ Pages Function /api/room/:code   │
 │ Game loop (60 Hz fixed step)                              │ WS   │   └─ env.ROOMS (script_name =    │
 │  ├─ World: Soldiers · Bots(FSM) · Gadgets · Objectives    │◀────▶│      r6-matchmaker)              │
 │  ├─ Rapier3D WASM: char controllers, raycasts, colliders  │      │ Worker r6-matchmaker             │
 │  ├─ DestructionSystem: cell grids → meshes + colliders    │      │   RoomDO (idFromName(R6-8492))   │
 │  ├─ RoomClient: WS events  ⇄  WebRTC DataChannel mesh ◀───┼──P2P─┼─▶ shared/roomLogic.ts:          │
 │  └─ WebMcpBridge: #webmcp-agent-bridge + window.webmcp    │      │   members, rounds, timers,       │
 └──────────────────────────────────────────────────────────┘      │   win rules, destruction log     │
                                                                    └──────────────────────────────────┘
```

* **Authority model** — every client simulates its own characters (player, its agent slots, TH bots).
  The shooter is authoritative for hits and wall damage, the owner for its own death, the placer for
  gadgets; the Durable Object is authoritative for membership, round generation (random mission, site,
  day/night), phase timers and round outcomes.
* **Destruction sync** — damage is `(panelId, cellIndices[], dmg)`; HP subtraction is commutative, so
  any ordering converges. The DO keeps the round's cell/barricade/reinforcement log for late joiners.
* **Snapshots** — 20 Hz over unordered/unreliable DataChannels (`maxRetransmits: 0`); peers without a
  channel (strict NAT, no TURN) automatically fall back to the WS relay. Remote characters render
  ~100 ms in the past (snapshot interpolation).
* **Offline rooms** — choose *Local* transport: tabs of the same browser share a room over
  `BroadcastChannel`; the first tab (Web Lock) runs the exact same `RoomLogic` as the DO.

## The House (2015) reconstruction

Axes: **+X East, +Y Up, +Z South**. Front porch/lobby faces **West** (main road, APC area), the
garage's two shutters face **East** (lower driveway → River Docks), the back entrance + exterior side
stairs face **South** (Side Street), the Construction Site is **North**. Floors: B `y=-3`, 1F `y=0`,
2F `y=3`, roof `y=6`.

* **Basement** — Garage (2 shutters, central load-bearing pillar, sedan + boat cover), Storage (NW
  exterior door + stairwell), Training, Laundry, basement hallway; stairs up to the Living Room and the
  Kitchen; ceiling hatches from the Office and the Pantry.
* **1F** — Lobby (front door) + main stairs, Living Room (2 W + 2 N windows), Office (porch, 3 windows),
  Dining, Kitchen, Pantry, Back Entrance.
* **2F** — Upper Hallway with the non-barricadeable open window above the front door (→ porch / lobby
  roof), Master Bedroom + bullet-proof Walk-in Closet + floor hatch to Dining, Bathroom (shower cover),
  Kids' Room (4 windows on 3 sides, soft front wall), Workshop (N/E windows), hallway hatch onto the
  kitchen stairs; flat roof with chimney/AC cover, porch + back roofs.

Press **T** in game for the tier X-ray (red soft · yellow semi · white solid).

The layout was reconstructed from knowledge of the launch map and the brief's room list; the referenced
video/Sketchfab model could not be loaded from this build environment, so proportions are approximate.

## CLI-Anything asset pipeline

```
npm run assets:spec                      # TS specs → tools/cli-anything/build/specs/*.json (103 assets)
python3 tools/cli-anything/pipeline.py   # clones HKUDS/CLI-Anything, installs cli-anything-blender in a venv,
                                         # issues scene/material/object/render-script commands per asset,
                                         # runs Blender headless, writes public/assets/models/*.glb + manifest.json
python3 tools/cli-anything/pipeline.py --mode shell --only weapon_   # spawn the real binary per command
```

Each asset leaves a reproducible transcript, e.g. `tools/cli-anything/build/work/weapon_l85a2/commands.sh`:

```bash
cli-anything-blender --json scene new --name weapon_l85a2 --engine EEVEE --output …/weapon_l85a2.blend-cli.json
cli-anything-blender --json --project … material create --name M_2c2f2a --color=0.025,0.028,0.023,1 --roughness 0.85
cli-anything-blender --json --project … object add cube --name body__0 --location=0,0.05,0.06 --rotation=0,0,0 --scale=0.058,0.5,0.085 -p size=1
cli-anything-blender --json --project … material assign 0 0
cli-anything-blender --json --project … render script out.png     # generated bpy → + join-per-bone + GLB export
```

The game loads the GLBs (weapons, operator rigs per bone, gadgets) when `manifest.json` is present and
otherwise builds the identical meshes procedurally from the same specs.

## AI agents (WebMCP)

Read **[AGENT_CONTEXT.md](AGENT_CONTEXT.md)** (also in-game: **[AI Agent WebMCP 접속 가이드 & 스키마 보기]**).

```js
await webmcp.join({ nickname: 'Claude-Agent', roomCode: 'R6-8492' });
webmcp.subscribe((o) => {
  const e = o.vision.find((v) => v.kind === 'enemy');
  if (e) webmcp.act({ lookLerp: { yawDelta: e.yawDelta, pitchDelta: e.pitchDelta, rate: 0.35 }, fire: { burst: 3 } });
});
```

* `#webmcp-agent-bridge` → `data-self-state`, `data-first-person-vision` (frustum + occlusion raycasts),
  `data-acoustic-cues` (3 s, relative 16-point direction / `Above_Floor` / `Below_Floor`), `data-match-state`.
* Actions go through the same `SoldierInput` as keyboard/mouse (540°/s turn cap, lerped look).
* Lobby / TH menu: **+ 로컬 WebMCP AI 에이전트 슬롯 추가** spawns built-in agents (`src/webmcp/LocalAgent.ts`)
  that only use the observation JSON; external agents can take a slot over with `webmcp.act(action, id)`.
* External example: `node tools/agents/webmcp-playwright-agent.mjs --url <site> --room R6-8492`.
* URL automation: `?room=R6-8492&nick=Agent&agent=1[&mode=local]`, `?th=1&difficulty=Hard&mission=bomb&agents=2`.

## Deploy

1. Cloudflare API token with *Workers Scripts*, *Durable Objects* and *Pages* edit rights.
2. GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
3. Push to `main` → `.github/workflows/deploy.yml`: typecheck + build + unit + browser e2e →
   `wrangler deploy -c worker/wrangler.toml` (RoomDO) → `wrangler pages deploy dist` (root `wrangler.toml`
   binds `ROOMS` to the worker's DO class through `script_name`).

Manual: `npx wrangler login && npm run deploy`. To point a static build at a separately hosted worker,
build with `VITE_SIGNAL_URL=wss://r6-matchmaker.<account>.workers.dev`.

## Controls

WASD move · Shift sprint · C crouch · Z prone · Q/E lean · LMB fire · RMB ADS · R reload · V melee ·
F context (barricade / reinforce / vault / hostage / defuser / rappel) · G remote detonate · 1–4 slots ·
Space vault / detach rope · L flashlight · T tier X-ray · B WebMCP overlay · Tab scoreboard · H help ·
Enter skip TH drone phase.

Rappel: face an exterior wall (ground) or a roof edge and press **F** · W/S climb · A/D traverse ·
Shift fast descent · C invert · F Breach & Swing through the window in front · Space push off.

---
Not affiliated with Ubisoft. "Rainbow Six Siege" and operator names belong to their owners; this is a
non-commercial fan tribute with original low-poly assets.
