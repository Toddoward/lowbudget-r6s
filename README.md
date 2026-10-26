<div align="center">

[![English](https://img.shields.io/badge/lang-English-2b6cb0?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-c53030?style=for-the-badge)](README.kr.md)

# 🛒 R6S: Lowbudget Edition

### *Rainbow Six Siege (2015), as delivered by Temu.*

Original House. Breakable walls. Rappelling. Terrorist Hunt. Room-code PvP.<br>
AI agents that play by reading the DOM. **No install.** It's a website.

![one-shot build](https://img.shields.io/badge/build-one--shot-6b46c1)
![three.js](https://img.shields.io/badge/three.js-r186-000000?logo=threedotjs)
![Rapier3D](https://img.shields.io/badge/physics-Rapier3D%20WASM-e57f2c)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Durable%20Objects-f38020?logo=cloudflare&logoColor=white)
![WebMCP](https://img.shields.io/badge/AI%20agents-WebMCP-2c7a7b)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

<img src="docs/screenshots/hero_day.jpg" alt="The House at sunrise, seen from the river-side driveway" width="900">

</div>

> **What is this?** A fan-made, non-commercial tribute to launch-era Siege, squeezed into a browser tab:
> a low-poly reconstruction of the original 2015 **House**, real-time wall destruction, rappelling,
> Terrorist Hunt bots, PvP rooms you join with a nickname and a code like `R6-8492`, and a WebMCP
> bridge so LLM agents can join a match and play with the same inputs you have.
> Same recipe, fewer polygons, suspiciously low price.

---

## 📦 Contents

- [What's in the box](#-whats-in-the-box)
- [Game modes](#-game-modes)
- [Controls](#-controls)
- [Operators](#-operators)
- [The House](#-the-house-2015)
- [AI agents (WebMCP)](#-ai-agents-webmcp)
- [Run it locally](#-run-it-locally)
- [Deploy to Cloudflare](#-deploy-to-cloudflare)
- [How it works](#-how-it-works)
- [Known limitations](#-known-limitations)

---

## 🧰 What's in the box

<table>
<tr>
<td width="50%"><img src="docs/screenshots/destruction.jpg" alt="Breached and shot-up soft walls"></td>
<td width="50%"><img src="docs/screenshots/xray_tiers.jpg" alt="Destruction tier X-ray"></td>
</tr>
<tr>
<td><b>Real-time destruction.</b> Walls are 0.25 m cell grids. Rounds go through soft walls and leave
holes, a melee punches a murder hole, and breach charges, Sledge's hammer and Ash's rounds open
real passages. What you see is exactly what blocks bullets, eyes and bodies.</td>
<td><b>Three wall tiers</b> (press <kbd>T</kbd>). 🟥 Soft: breakable. 🟨 Semi-breach walls and wooden
floors: the studs stay, so you can see and shoot through but not walk through. ⬜ Solid: never.
Defenders reinforce soft walls and hatches with steel (2 each per round); only Thermite gets through.</td>
</tr>
<tr>
<td><img src="docs/screenshots/rappel.jpg" alt="Rappelling up the north facade"></td>
<td><img src="docs/screenshots/night_front.jpg" alt="The House at night"></td>
</tr>
<tr>
<td><b>Rappel anywhere</b> on the exterior. Climb, traverse, flip upside-down to peek, then
<b>Breach &amp; Swing</b> through a window and smash its barricade. You can also hook on from the roof edge.</td>
<td><b>E3 2014 mood lighting.</b> Morning or night is picked at random every round: a hard low sun or
a cold moon, real-time shadows, dark interiors, light shafts through windows, street lamps,
police lights, and a weapon flashlight at night.</td>
</tr>
<tr>
<td><img src="docs/screenshots/day_lobby.jpg" alt="A White Mask on the main stairs"></td>
<td><img src="docs/screenshots/night_kitchen.jpg" alt="Kitchen at night"></td>
</tr>
<tr>
<td><b>Terrorist Hunt bots</b> that patrol, hear gunshots and breaches through floors, investigate,
take cover to reload, lay down suppressive fire through soft walls, and aim with smooth
interpolation instead of aimbot snaps.</td>
<td><b>Gunplay basics:</b> Q/E lean, ADS, crouch and prone, recoil you have to pull down,
wallbangs, and a one-shot kill on every headshot.</td>
</tr>
<tr>
<td><img src="docs/screenshots/drone.jpg" alt="Drone phase"></td>
<td><img src="docs/screenshots/webmcp_overlay.jpg" alt="WebMCP debug overlay"></td>
</tr>
<tr>
<td><b>Prep phase:</b> attackers drive drones while defenders barricade, reinforce and set up gadgets.
Then the action phase starts.</td>
<td><b>WebMCP bridge</b> (press <kbd>B</kbd>): AI agents get only what a first-person player could know.
That means what's on screen and not behind walls, sounds from the last 3 s, and their own HUD.</td>
</tr>
</table>

---

## 🎮 Game modes

| Mode | What happens |
|---|---|
| **Terrorist Hunt** (solo) | You, plus optional AI teammates, against 12–16 "White Masks" on Normal / Hard / Realistic. Missions: **Classic** (eliminate), **Disarm Bomb**, **Hostage Rescue**, **Secure Area**. 20 s drone phase, then 6:00. |
| **PvP** (room code) | Enter a nickname and a code like `R6-8492`. Everyone with the same code lands in the same room. Each round randomly rolls **Hostage / Secure Area / Bomb**, a site, and morning/night. 45 s prep + 3:00 action, sides swap every round, first to 3 wins. |
| **Local PvP** (no server) | Choose the *Local* transport and the room is shared between tabs of the same browser. Good for testing. |
| **AI agents** | Add built-in agent slots from the lobby or TH menu (**+ 로컬 WebMCP AI 에이전트 슬롯 추가**), or let an external agent join through `window.webmcp`. |

<div align="center">
<img src="docs/screenshots/menu.jpg" alt="Main menu" width="49%">
<img src="docs/screenshots/lobby.jpg" alt="PvP lobby with agent slots" width="49%">
</div>

---

## ⌨️ Controls

| Key | Action | Key | Action |
|---|---|---|---|
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Move | <kbd>Shift</kbd> | Sprint |
| <kbd>C</kbd> / <kbd>Z</kbd> | Crouch / Prone | <kbd>Q</kbd> / <kbd>E</kbd> | Lean left / right |
| <kbd>LMB</kbd> / <kbd>RMB</kbd> | Fire / Aim down sights | <kbd>R</kbd> | Reload |
| <kbd>V</kbd> | Melee (murder holes!) | <kbd>F</kbd> | Context: barricade, reinforce, vault, hostage, defuser, rappel |
| <kbd>G</kbd> | Remote detonate | <kbd>1</kbd>–<kbd>4</kbd> | Primary, secondary, operator gadget, breach charge / barricade |
| <kbd>Space</kbd> | Vault / let go of the rope | <kbd>L</kbd> | Flashlight |
| <kbd>T</kbd> | Wall-tier X-ray | <kbd>B</kbd> | WebMCP overlay |
| <kbd>Tab</kbd> | Scoreboard | <kbd>Enter</kbd> | Skip the TH drone phase |

**On the rope:** <kbd>W</kbd>/<kbd>S</kbd> climb · <kbd>A</kbd>/<kbd>D</kbd> traverse · <kbd>Shift</kbd> fast descent · <kbd>C</kbd> invert · <kbd>F</kbd> Breach &amp; Swing · <kbd>Space</kbd> push off.

---

## 🪖 Operators

The 2015 launch roster, gadgets included, no season pass.

| Attackers | Gadget | | Defenders | Gadget |
|---|---|---|---|---|
| **Sledge** | Breaching hammer: soft walls, floors, hatches | | **Smoke** | Remote gas canisters |
| **Ash** | M120 CREM breaching rounds (ranged) | | **Mute** | Signal jammer (stops drones and breach charges) |
| **Thermite** | Exothermic charge: opens reinforced walls | | **Castle** | Bullet-proof armor panels |
| **Thatcher** | EMP grenades (kill enemy electronics) | | **Pulse** | Heartbeat sensor, works through walls |
| **Fuze** | Cluster charge (mind the hostage 😬) | | **Jäger** | ADS, shoots down grenades and rounds |
| | | | **Bandit** | Shock wire: fries Thermite charges |

---

## 🏠 The House (2015)

A data-driven reconstruction of the launch version: three floors, a roof, and four exterior spawns.

| Floor | Rooms |
|---|---|
| **Basement** | Garage (2 shutters, center pillar, car + boat cover) · Storage (NW exterior door) · Training · Laundry · stairs up to the Living Room and Kitchen · 2 ceiling hatches |
| **1F** | Lobby (front door) + main stairs · Living Room (4 windows) · Office (porch, 3 windows) · Dining · Kitchen · Pantry · Back Entrance + side stairs |
| **2F + roof** | Upper Hallway with the famous **open window** · Master Bedroom + bullet-proof walk-in closet · Bathroom (shower cover) · Kids' Room (4 windows, 3 sides) · Workshop · 2 floor hatches · porch roof and roof access |
| **Outside** | Construction Site (N) · River Docks (E) · APC Area (SW) · Side Street (S) with police cruisers |

<div align="center"><img src="docs/screenshots/day_front.jpg" alt="Front porch and lobby side" width="900"></div>

---

## 🤖 AI agents (WebMCP)

Agents are first-class players. They read the `#webmcp-agent-bridge` DOM element (or call
`window.webmcp`) and act through the **same input pipeline as a human**: same physics, same
recoil, and a 540°/s turn-rate cap with interpolated aiming. No wallhacks: vision is filtered
by the camera frustum plus occlusion raycasts.

```js
await webmcp.join({ nickname: 'Temu-Thermite', roomCode: 'R6-8492' });

webmcp.subscribe((o) => {
  const enemy = o.vision.find((v) => v.kind === 'enemy');
  if (enemy) webmcp.act({
    lookLerp: { yawDelta: enemy.yawDelta, pitchDelta: enemy.pitchDelta, rate: 0.35 },
    ads: true,
    fire: Math.abs(enemy.yawDelta) < 2 ? { burst: 3 } : false,
  });
});
```

| DOM attribute | What it holds |
|---|---|
| `data-self-state` | Operator, HP, stance, lean, weapon/ammo, gadgets, room name (e.g. `2F Master Bedroom`) |
| `data-first-person-vision` | Visible enemies, allies, walls, hatches, windows, gadgets and objectives with `yawDelta` / `pitchDelta` / `distance` |
| `data-acoustic-cues` | Sounds from the last 3 s: direction relative to you (`NNE`, `Below_Floor`, …) and intensity |
| `data-match-state` | Mode, phase, timer, mission, site, score |

📖 The full contract is in **[AGENT_CONTEXT.md](AGENT_CONTEXT.md)**. It's also in the game under **[AI Agent WebMCP 접속 가이드 & 스키마 보기]**.
An example of an external agent driving a real browser is in `tools/agents/webmcp-playwright-agent.mjs`.

<div align="center"><img src="docs/screenshots/agent_guide.jpg" alt="In-game agent guide" width="900"></div>

---

## 🚀 Run it locally

```bash
npm install
npm run dev            # http://localhost:5173 (TH + local multi-tab PvP work without a server)
npm run dev:worker     # optional: the Durable Object room server on :8787 (vite proxies /api)
npm run build          # typecheck (client + worker) + production build → dist/
npm test               # unit tests: room state machine, destruction, hitboxes, spread
npm run test:e2e       # browser smoke test against `vite preview`
```

URL shortcuts: `?th=1&difficulty=Hard&mission=bomb&agents=2` · `?room=R6-8492&nick=Bot&agent=1`

---

## ☁️ Deploy to Cloudflare

1. Add two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Push to `main`. `.github/workflows/deploy.yml` runs typecheck, build, unit tests and the browser
   e2e test. It then deploys the room Worker + Durable Object (`worker/wrangler.toml`) and then the
   Pages site (`wrangler.toml`, which binds `ROOMS` to the Worker's Durable Object).
3. Without the secrets, CI still builds and tests, and skips the deploy.

Manual deploy: `npx wrangler login && npm run deploy`.

---

## 🔧 How it works

```
 Browser tab (Cloudflare Pages)                               Cloudflare
 ┌─────────────────────────────────────────────┐    WS     ┌──────────────────────────────┐
 │ three.js render · lighting · FX · HUD       │◀─────────▶│ Pages Function /api/room/:id │
 │ 60 Hz sim: soldiers · bots · gadgets        │           │   └─▶ Durable Object         │
 │ Rapier3D WASM: controllers, raycasts        │           │       one per room code      │
 │ Destruction: cell grids → mesh + colliders  │           │       rounds · timers · log  │
 │ WebMCP bridge: DOM + window.webmcp          │           └──────────────────────────────┘
 └──────────────────────┬──────────────────────┘
                        │ WebRTC DataChannel (P2P): snapshots + shots
                        ▼ other players
```

- **Who decides what.** The shooter decides hits and wall damage, each client decides its own
  death, and the Durable Object decides rounds (random mission, site and time of day), timers and
  winners.
- **Two lanes.** Position snapshots and shots go over unreliable WebRTC DataChannels, with a WS
  relay fallback for peers that can't connect. Everything that must arrive (hits, destruction
  deltas, gadgets, objectives) goes over the WebSocket.
- **Destruction sync.** A hit is sent as `(panel, cells, damage)`. Because damage just adds up,
  every client ends up with the same wall no matter what order the events arrive in. Late joiners
  get the round's log replayed.
- **Assets.** Weapons, operators and gadgets are described as specs. Those specs are turned into
  GLBs through [CLI-Anything](https://github.com/HKUDS/CLI-Anything)'s `cli-anything-blender`
  (`python3 tools/cli-anything/pipeline.py`), and the game falls back to building the same meshes
  in the browser.

<details>
<summary><b>Repository layout</b></summary>

```
src/map/        House layout, furniture/cover, suburb, map builder
src/world/      destruction panels (cells → mesh + colliders)
src/game/       soldier (movement, lean, rappel), combat, gadgets, objectives
src/ai/         FSM bots, navigation graph
src/net/        room client (WS + WebRTC), transports, remote players
src/webmcp/     perception, DOM bridge, agent controller, built-in agent
src/render/     lighting, effects, viewmodel, rigs
shared/         protocol + room logic (used by the Durable Object and local rooms)
worker/         Cloudflare Worker + Durable Object
functions/      Pages Functions (/api/room/:code)
tools/          CLI-Anything asset pipeline, tests, agent example
```
</details>

---

## 🩹 Known limitations

- The House layout was rebuilt from the room list and memory of the original, so proportions are
  approximate. The reference video and Sketchfab model weren't available while building this.
- The screenshots come from a software renderer with no GPU, so treat them as a preview.
  Weaker GPUs automatically drop quality (High → Medium → Low).
- Mouse and keyboard only. Pointer lock is required, so there's no mobile support.
- Durable Objects on Cloudflare's **free** plan need a SQLite-backed migration. The current
  migration in `worker/wrangler.toml` expects the Workers Paid plan.

---

<div align="center">
<sub>Not affiliated with Ubisoft. "Rainbow Six Siege" and the operator names belong to their owners.
This is a non-commercial fan tribute with original low-poly assets. Please don't send us to customs. 📦</sub>
</div>
