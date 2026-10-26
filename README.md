<div align="center">

[![English](https://img.shields.io/badge/lang-English-2b6cb0?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-c53030?style=for-the-badge)](README.kr.md)

# 🛒 R6S: TEMU

### *Rainbow Six Siege (2015), as delivered by Temu. Now with the parts that fell off in shipping glued back on.*

Original House, rebuilt to scale. Walls that break the way they should. Rappelling, drones, CCTV.<br>
Terrorist Hunt. Room-code PvP. AI agents that join from your laptop or the cloud. **No install.** It's a website.

![few-shot build](https://img.shields.io/badge/build-few--shot-2f855a)
![three.js](https://img.shields.io/badge/three.js-r186-000000?logo=threedotjs)
![Rapier3D](https://img.shields.io/badge/physics-Rapier3D%20WASM-e57f2c)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Durable%20Objects-f38020?logo=cloudflare&logoColor=white)
![WebMCP](https://img.shields.io/badge/AI%20agents-WebMCP-2c7a7b)
![i18n](https://img.shields.io/badge/UI-%ED%95%9C%EA%B5%AD%EC%96%B4%20%2F%20English-805ad5)

<img src="docs/screenshots/hero_day.jpg" alt="The House at sunrise from the north-east" width="900">

</div>

> **What is this?** A fan-made, non-commercial tribute to launch-era Siege in a browser tab. This is the
> **few-shot** follow-up to [lowbudget-r6s-oneshot](https://github.com/Toddoward/lowbudget-r6s-oneshot),
> the version built from a single prompt. The one-shot worked, and it also had 27 things wrong with it, plus a
> few more we found. This repository fixes them. The one-shot's README lists every problem and shows how it
> was built in one go.

---

## 📦 Contents

- [What changed since the one-shot](#-what-changed-since-the-one-shot)
- [Screenshots](#-screenshots)
- [Game modes](#-game-modes)
- [Controls](#%EF%B8%8F-controls)
- [Operators](#-operators)
- [The House](#-the-house)
- [AI agents (local or cloud)](#-ai-agents-local-or-cloud)
- [Run it locally](#-run-it-locally)
- [Branches, QA builds and tests](#-branches-qa-builds-and-tests)
- [Deploy to Cloudflare](#%EF%B8%8F-deploy-to-cloudflare)
- [How it works](#-how-it-works)
- [Known limitations](#-known-limitations)

---

## 🔧 What changed since the one-shot

| Area | One-shot | Few-shot |
|---|---|---|
| **Browser shortcuts** | Crouch was <kbd>Ctrl</kbd>, so <kbd>Ctrl</kbd>+<kbd>W</kbd> closed the tab mid-fight | No modifier keys anywhere. Fullscreen + Keyboard Lock captures the rest (optional) |
| **Cursor** | Pointer lock never let go (death, menus, results) | A state machine: <kbd>Esc</kbd> pauses; death, round end, lobby and menus free the cursor; "click to take control" comes back on its own |
| **Map** | Rebuilt from memory, off-scale | Traced from the actual House model: ×2.85 scale, B −3.5 / 1F 0 / 2F 3.5 / roof 7 m, 3.2 m ceilings, 1.8 m capsule. Hard, soft and semi walls read differently. Door bottom gaps (19 cm), 6 drone vents, ammo crates, 6 CCTVs |
| **Lean & optics** | Gun rolled with the lean, sights didn't line up. Optics blocked by the receiver | ADS pivots on the sight. Optics are hollow. Red dot / holo / ACOG reticles are **collimated** (drawn at infinity along the bore, the round goes where the dot is). Pistols get a glowing front post and a clear rear notch |
| **Vaulting** | Windows only | Anything up to 1.3 m: over thin things (sills, rails, breach lips), onto deep ones (counters, crates) |
| **Reinforcing** | Not on damaged walls | Shot-up or breached soft walls can still be reinforced. Walls Thermite burnt through can't |
| **Drone** | Weak hop, no vents, can't ping, pitch black at night | Higher hop, drives under door gaps and through vents, pings enemies for the team, auto-exposed feed with a small LED at night |
| **Bots** | First shot always hit | Acquisition error that decays over about a second, plus wild first shots. First-shot hit rate on Normal went from 70 % to about 0–10 %. Bots can be flashed |
| **UI** | English only, cramped, unexplained | Korean / English. The main menu is one level deep. Operators are grouped by role, with an info card. The HUD has a team roster, world markers (spots, pings, objective) and context-sensitive key hints. <kbd>F1</kbd> shows the full keymap. Every key can be rebound |
| **Gadgets** | Number keys 3/4 + click | <kbd>G</kbd> operator gadget, <kbd>X</kbd> breach charge. **Hold to place, tap to detonate** (even while you're still looking at the wall). Sparks and hums when Bandit's wire fires |
| **Operators** | 11 | 16, adding **IQ, Montagne, Blitz, Kapkan and Tachanka** |
| **Debug tools** | Shipped to everyone | QA-only: local agent slots, same-browser rooms, X-ray, overlay. They're in the `develop` preview, not in production |
| **Network** | A dropped socket meant you were gone | Reconnect with **seat resume**: the server keeps your seat for 20 s, the client retries with a token and gets back the same id, agents and the destruction it missed. A heartbeat catches half-open sockets |
| **Tests** | Smoke test | Plus a **35-scenario UX suite**: menu→play, state handling, every attack and defense role, and online reconnect. It found 8 real bugs on the way |

---

## 📸 Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/menu.jpg" alt="Main menu"></td>
<td width="50%"><img src="docs/screenshots/th_setup.jpg" alt="Terrorist Hunt setup, operators by role"></td>
</tr>
<tr>
<td><b>One-level menu.</b> Quick Play, Terrorist Hunt, Multiplayer, Settings, Controls. Korean or English, picked from your browser.</td>
<td><b>Operators by role:</b> breacher, hard breacher, shield, support, intel and so on, with armor and speed pips, the gadget's key, and a description.</td>
</tr>
<tr>
<td><img src="docs/screenshots/hud_lobby.jpg" alt="In-game HUD"></td>
<td><img src="docs/screenshots/ads_holo.jpg" alt="Holographic sight, collimated reticle"></td>
</tr>
<tr>
<td><b>HUD:</b> objective and site, timer, compass, spotted-enemy and ping markers, gadget slots with their key caps, context-sensitive hints.</td>
<td><b>Collimated optics.</b> The reticle sits at infinity along the bore and the glass is clear. Leaning no longer throws off your aim.</td>
</tr>
<tr>
<td><img src="docs/screenshots/drone_day.jpg" alt="Drone feed"></td>
<td><img src="docs/screenshots/cctv.jpg" alt="CCTV feed"></td>
</tr>
<tr>
<td><b>Drone</b> during prep. It fits under door gaps and through vents. <kbd>B</kbd> pings what you see for the whole team.</td>
<td><b>Defender CCTV</b> (<kbd>3</kbd>). Click to cycle cameras. Attackers can shoot them out.</td>
</tr>
<tr>
<td><img src="docs/screenshots/night_front.jpg" alt="The House at night"></td>
<td><img src="docs/screenshots/destruction.jpg" alt="Breached walls"></td>
</tr>
<tr>
<td><b>Night</b> that you can actually play: moonlight, street lamps, lit windows.</td>
<td><b>Destruction:</b> breach charges, Sledge, Ash and plain bullets eat soft walls cell by cell.</td>
</tr>
<tr>
<td><img src="docs/screenshots/controls.jpg" alt="Rebinding keys"></td>
<td><img src="docs/screenshots/result.jpg" alt="Result screen"></td>
</tr>
<tr>
<td><b>Every key is rebindable.</b> Hold or toggle for crouch, lean and aim. Conflicts are resolved for you.</td>
<td><b>Result screen</b> with kills, time, accuracy and headshots. Redeploy, change operator, or go back to the menu.</td>
</tr>
</table>

---

## 🎮 Game modes

| Mode | What happens |
|---|---|
| **Quick Play** | One click: Terrorist Hunt with your last operator, random mission, Normal difficulty. |
| **Terrorist Hunt** | You against 12–16 White Masks on Normal / Hard / Realistic. Missions: **Classic** (eliminate), **Disarm Bomb**, **Hostage Rescue**, **Secure Area**. A 20 s drone phase (<kbd>Enter</kbd> skips it), then 6:00. |
| **Multiplayer** | Enter a nickname and a code like `R6-8492`, or **Create room** and share the code. Each round randomly picks Hostage / Secure Area / Bomb, a site, and morning or night. 45 s prep + 3:00 action, sides swap every round, first to 3 wins. Change your operator from the pause menu during prep. |
| **AI agents** | Any agent that can open a web page can join a room. See [below](#-ai-agents-local-or-cloud). |

---

## ⌨️ Controls

The keymap is compact, everything sits around <kbd>WASD</kbd>, and none of it uses <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>⌘</kbd>. The bottom of the HUD only shows the keys that matter right now. <kbd>F1</kbd> shows all of them. **Settings → Controls** rebinds anything.

| Key | Action | Key | Action |
|---|---|---|---|
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Move | <kbd>Shift</kbd> | Sprint |
| <kbd>C</kbd> | Crouch (tap) · prone (hold) | <kbd>Z</kbd> | Prone |
| <kbd>Q</kbd> / <kbd>E</kbd> | Lean | <kbd>Space</kbd> | Vault / climb · let go of the rope |
| <kbd>LMB</kbd> / <kbd>RMB</kbd> | Fire / aim | <kbd>R</kbd> · <kbd>V</kbd> | Reload · melee |
| <kbd>1</kbd> / <kbd>2</kbd> | Primary / secondary | <kbd>F</kbd> | **Context:** barricade, reinforce, rappel, ammo crate, hostage, bomb, mount LMG |
| <kbd>G</kbd> | **Operator gadget:** tap = equip / throw / toggle / detonate, hold = place | <kbd>X</kbd> | **Breach charge:** hold = place, tap = detonate |
| <kbd>3</kbd> | Drone (attackers) / CCTV (defenders) | <kbd>B</kbd> / <kbd>MMB</kbd> | Ping / spot |
| <kbd>T</kbd> | Flashlight | <kbd>Tab</kbd> · <kbd>F1</kbd> | Scoreboard · all controls |

**On the rope:** <kbd>W</kbd>/<kbd>S</kbd> climb · <kbd>A</kbd>/<kbd>D</kbd> traverse · <kbd>C</kbd> invert · <kbd>F</kbd> Breach &amp; Swing · <kbd>Space</kbd> let go.

---

## 🪖 Operators

| Attackers | Role | Gadget | | Defenders | Role | Gadget |
|---|---|---|---|---|---|---|
| **Sledge** | Breacher | Breaching hammer | | **Smoke** | Support | Remote gas grenades |
| **Ash** | Breacher | Breaching rounds | | **Mute** | Anti-gadget | Signal disruptor |
| **Thermite** | Hard breacher | Exothermic charge (opens reinforced walls) | | **Castle** | Anchor | Armor panels |
| **Thatcher** | Support | EMP grenades | | **Pulse** | Intel | Cardiac sensor |
| **Fuze** | Support | Cluster charge | | **Jäger** | Anti-gadget | ADS (shoots down projectiles) |
| **Montagne** 🆕 | Shield | Le Roc: extends to full-body cover | | **Bandit** | Anti-gadget | Shock wire (sparks, hum, fries Thermite) |
| **Blitz** 🆕 | Shield | Flash shield (blinds 6 m / 60°) | | **Kapkan** 🆕 | Trapper | Entry Denial Device (door/window laser) |
| **IQ** 🆕 | Intel | Spectre: sees enemy electronics through walls | | **Tachanka** 🆕 | Anchor | Mounted shielded LMG |

---

## 🏠 The House

The layout is traced from a 3D model of the original House. The pipeline is in [`tools/level`](tools/level/README.md). The plan is scaled ×2.85 so a 1.8 m operator, 2.2–2.4 m doors and 3.2 m ceilings come out right. The model's exploded floors are restacked at B −3.5 / 1F 0 / 2F 3.5 / roof 7 m.

| | |
|---|---|
| **Walls** | Hard (never breaks) · soft (holes, murder holes, 1.8 × 2.2 m breaches, rounds lose 40 %) · semi (studs and joists every 25 cm stay, so you can see and shoot through but not pass). Baseboards and colors make each kind readable at a glance. |
| **Openings** | Doors keep an 18–20 cm gap under the barricade for drones. There are 6 drone vents (45 × 25 cm), 4 hatches with frames and handles, the open 2F window over the porch, and garage shutters. |
| **Rooms** | **B:** Garage, Storage, Training, Laundry, Basement & Side Stairs, Back Hallway · **1F:** Lobby, Living, Office, Dining, Kitchen, Back Entrance · **2F:** Upper Hallway, West Hall, Bathroom, Workshop, Master Bedroom, Walk-in Closet, Kids' Room |
| **Outside** | Front porch (north), garage driveway (east), back porch & side stairs (south), exterior storage stairwell (north-west). Spawns: Construction Site, River Docks, APC Area, Side Street. |

---

## 🤖 AI agents (local or cloud)

Agents are full players. They read the `#webmcp-agent-bridge` DOM element or call `window.webmcp`, and they act through **the same input pipeline as you**: same physics, same recoil, a 540°/s turn cap, and the same <kbd>G</kbd>/<kbd>X</kbd>/<kbd>F</kbd> context keys. They can't see through walls, because vision is filtered by the camera frustum plus occlusion raycasts.

| Where the agent runs | How it joins |
|---|---|
| **Cloud** (container, CI, hosted LLM with a browser tool) | Open `https://r6s-temu.pages.dev/?room=R6-8492&nick=MyAgent&agent=1` in headless Chromium, or run `node tools/agents/webmcp-playwright-agent.mjs --url https://r6s-temu.pages.dev --room R6-8492` |
| **Local** | The same, against `http://localhost:5173`. Or run `await webmcp.join({ nickname: 'MyAgent', roomCode: 'R6-8492' })` in the page |
| **WebMCP host** | If the browser has `navigator.modelContext`, the `r6_*` tools register themselves |

```js
webmcp.subscribe((o) => {
  const enemy = o.vision.find((v) => v.kind === 'enemy');
  if (enemy) webmcp.act({ lookLerp: { yawDelta: enemy.yawDelta, pitchDelta: enemy.pitchDelta, rate: 0.35 },
                          ads: true, ping: true, fire: Math.abs(enemy.yawDelta) < 2 ? { burst: 3 } : false });
});
webmcp.act({ gadget: 'key_hold', durationMs: 1800 });   // hold [G]: place Thermite on the wall you're looking at
webmcp.act({ gadget: 'key' });                          // tap  [G]: detonate it
```

📖 The full contract is in **[AGENT_CONTEXT.md](AGENT_CONTEXT.md)**. The same text is in the game under **AI agent guide (WebMCP)**.

---

## 🚀 Run it locally

```bash
npm install
npm run dev            # http://localhost:5173 (dev = QA tools on)
npm run dev:worker     # optional: the Durable Object room server on :8787 (vite proxies /api)
npm run build          # typecheck (client + worker) + production build → dist/
```

URL shortcuts: `?th=1&difficulty=Hard&mission=bomb` · `?room=R6-8492&nick=Bot&agent=1` · `?lang=ko|en`

---

## 🧪 Branches, QA builds and tests

| Branch | Build | Deployed to |
|---|---|---|
| `main` | Production: QA tools are compiled out | `r6s-temu.pages.dev` |
| `develop` | `VITE_QA=1`: local agent slots, same-browser rooms, wall-tier X-ray (<kbd>K</kbd>), WebMCP overlay (<kbd>O</kbd>), QA hooks | `develop.r6s-temu.pages.dev` |

```bash
npm test                                          # unit: room state machine, destruction, hitboxes, spread
VITE_QA=1 npx vite build --outDir dist-qa && npx vite preview --outDir dist-qa --port 4173 &
npm run test:e2e                                  # smoke: boot, WebMCP, destruction, rappel, 2-tab PvP over WebRTC
npm run dev:worker &                              # local Durable Object for S5
E2E_ONLINE=1 npm run test:scenarios               # 35 UX scenarios (below)
```

**`test:scenarios`** plays the game the way a player clicks or an agent acts, and checks game state rather than pixels:

- **S1 menu → play:** home, operator by role, deploy, drone prep → action, death frees the cursor without pausing, result screen and stats, redeploy, language switch, key rebinding with conflicts, no <kbd>Ctrl</kbd> bindings.
- **S2 attack:** Sledge, Ash and breach charges (hold to place, tap to detonate). Thermite: tap-detonate while still facing the wall, and no re-reinforcing after. Thatcher, Fuze, Montagne (the shield stops rounds), Blitz (flashes a bot), IQ, ping, vault.
- **S3 defense:** reinforce, barricade, Castle, Kapkan, Tachanka (place, then mount), Mute, Bandit, Pulse, Jäger, Smoke, CCTV.
- **S4 PvP state:** two tabs, lobby, round start, attackers start in the drone and defenders in their body.
- **S5 online reconnect** (with the Worker): the socket drops, the seat is marked away, the client reconnects to the same id, and destruction done meanwhile is replayed.

---

## ☁️ Deploy to Cloudflare

This deploy is separate from the one-shot. It uses its own names:

| Piece | Name |
|---|---|
| Pages project | `r6s-temu` |
| Worker + Durable Object | `r6s-temu-matchmaker` (`RoomDO`, SQLite-backed, Free plan OK) |

1. Add two repository secrets: `CLOUDFLARE_API_TOKEN` (permissions: *Workers Scripts: Edit* and *Cloudflare Pages: Edit*) and `CLOUDFLARE_ACCOUNT_ID`.
2. Push to `main`. CI typechecks, builds, runs the unit tests and both browser suites, then deploys the Worker and the Pages site.
   A push to `develop` deploys the QA preview.
3. Without the secrets, CI still builds and tests, and skips the deploy.

Manual deploy: `npx wrangler login && npm run deploy`.

---

## 🧠 How it works

```
 Browser tab (Cloudflare Pages)                               Cloudflare
 ┌─────────────────────────────────────────────┐    WS     ┌──────────────────────────────┐
 │ three.js render · HUD · i18n · keymap       │◀─────────▶│ Pages Function /api/room/:id │
 │ 60 Hz sim: soldiers · bots · gadgets        │           │   └─▶ Durable Object         │
 │ Rapier3D WASM: controllers, raycasts        │           │       one per room code      │
 │ Destruction: 0.25 m cell grids → mesh+coll. │           │       rounds · timers · log  │
 │ WebMCP bridge: DOM + window.webmcp          │           └──────────────────────────────┘
 └──────────────────────┬──────────────────────┘
                        │ WebRTC DataChannel (P2P): snapshots + shots
                        ▼ other players (and agents)
```

- **Who decides what:** the shooter decides hits and wall damage, which includes peers' shields. Each client decides its own death. The Durable Object decides rounds, timers and winners.
- **Destruction sync:** a hit is sent as `(panel, cells, damage)`. Damage just adds up, so every client ends up with the same wall regardless of arrival order.
- **Optics:** the viewmodel draws a stencil-masked lens, and the reticle sits at infinity on the bore line. The shooter's ADS ray is fed the same bore offset, so the round lands where the dot is.

<details>
<summary><b>Repository layout</b></summary>

```
src/map/        House layout (traced), props, suburb, map builder
src/world/      destruction panels (cells → mesh + colliders)
src/game/       soldier, combat, gadgets, interactions, objectives, operators
src/ai/         FSM bots, navigation graph
src/net/        room client (WS + WebRTC), transports, remote players
src/webmcp/     perception, DOM bridge, agent controller, built-in agent
src/render/     lighting, effects, viewmodel (collimated optics), rigs
src/ui/         HUD, i18n (KO/EN)          src/core/  input, keybinds, audio, physics
shared/         protocol + room logic (Durable Object and local rooms)
worker/         Cloudflare Worker + Durable Object      functions/  Pages Functions
tools/          level pipeline, CLI-Anything assets, tests, agent example
```
</details>

---

## 🩹 Known limitations

- The House is traced from a fan-made tactical model, not from Ubisoft's data, so small details differ.
- The screenshots come from a software renderer (SwiftShader, no GPU). Real GPUs look better, and weaker ones drop quality automatically.
- Mouse and keyboard only, so no mobile. Keyboard Lock (which captures <kbd>Ctrl</kbd>+<kbd>W</kbd> and friends) only works in Chromium-based browsers in fullscreen.

---

<div align="center">
<sub>House model reference: "Rainbow Six Siege - House Map" by crusader1291 (Sketchfab). It isn't redistributed here.<br>
Not affiliated with Ubisoft. "Rainbow Six Siege" and the operator names belong to their owners.
This is a non-commercial fan tribute with original low-poly assets. Please don't send us to customs. 📦</sub>
</div>
