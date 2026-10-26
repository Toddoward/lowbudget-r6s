# AGENT_CONTEXT — R6S: TEMU (low-budget web tactical FPS)

You are an AI agent joining a browser tactical FPS. You perceive **only what your operator could perceive in first person** and you act through the **same input pipeline as a human** (same movement physics, recoil, collision and a 540°/s turn-rate cap). This file is the complete contract. It is also shown in-game under **AI agent guide (WebMCP)**.

## 1. Joining — local or cloud

Any agent that can drive a browser can play: a local process, a cloud container, or an LLM tool-calling loop. There is nothing to install in the game.

| Where the agent runs | How it joins |
| --- | --- |
| **Cloud / remote** (container, CI, hosted LLM with a browser tool) | open `https://<site>/?room=R6-8492&nick=MyAgent&agent=1` in a headless Chromium → it joins room `R6-8492` through the Cloudflare Durable Object like any player. Ready-made: `node tools/agents/webmcp-playwright-agent.mjs --url https://<site> --room R6-8492 --nick MyAgent` |
| **Local** (same machine as the human) | same URL against `http://localhost:5173`, or from the page console: `await webmcp.join({ nickname: 'MyAgent', roomCode: 'R6-8492' })` |
| **In-page WebMCP host** (`navigator.modelContext`) | the game registers the `r6_*` tools (§7); call `r6_join_room` |
| Solo practice | `webmcp.startTerroristHunt({ difficulty: 'Normal', mission: 'random' })` — or `?th=1&difficulty=Hard&mission=bomb` |
| Lobby loadout | `webmcp.selectLoadout({ squad: 'B', operator: 'thermite', spawn: 'docks', ready: true })` |

Room codes are `R6-` + 4 digits. Everyone (humans and agents) typing the same code lands in the same room. The host (first member) presses *Start match*; agents can `selectLoadout({ ready: true })`.

QA builds (`develop` branch, `VITE_QA=1`) also offer *local agent slots* (built-in agents you can take over with `webmcp.act(action, 'agent1')`) and same-browser rooms (`mode: 'local'`). Production builds don't.

## 2. Game rules (2015 launch rules, condensed)

- **Attackers**: Sledge, Ash (breachers), Thermite (hard breacher), Thatcher, Fuze (support), Montagne, Blitz (shields), IQ (intel). **Defenders**: Smoke, Mute, Castle, Pulse, Jäger, Bandit, Kapkan (trapper), Tachanka (anchor). Terrorist Hunt: you attack AI "White Masks".
- **Round**: random **mission** (Hostage / Secure Area / Bomb; TH also Classic elimination), random **site** and random **time of day** every round.
- **Phases**: Preparation 45 s (PvP; TH 20 s) — attackers drive a **drone**, defenders reinforce & barricade → Action 3:00 (TH 6:00). PvP: first squad to 3 wins, sides swap every round.
- **Win**: eliminate the other team, or the objective. Hostage: escort to any spawn zone; killing the hostage loses the round for the shooter's team. Secure Area: attackers in the room with no defenders for 10 s. Bomb (PvP): plant the defuser (hold interact 4 s), protect it 30 s; defenders disable it (4 s). Bomb (TH): disarm both bombs (6 s each).
- **Damage**: headshot = kill. Torso ×1, legs ×0.75, armour 1/2/3 → ×1.0/0.9/0.8. Rounds lose 35 % per soft surface and 40 % through soft walls. Ballistic shields (Montagne, Blitz) stop rounds.
- **Friendly fire** is ON in PvP.

## 3. Map knowledge (public — what a human who knows House knows)

`webmcp.getMapKnowledge()` returns rooms (floor rectangles, objective spots), stairs, hatches, openings (doors, windows, vents) and spawn zones. Axes: **+X East, +Y Up, +Z South (North = −Z)**. Floors: **B y = −3.5, 1F y = 0, 2F y = 3.5, roof y = 7** (3.2 m ceilings, 0.3 m slabs). The house is scaled 1:1 from the original model: doors 1.1–1.8 m wide × 2.2–2.4 m high, your capsule is 1.8 m tall (eyes 1.65 / 1.05 crouched / 0.4 prone).

- **Front (North)**: porch + front door into the Lobby; the 2F open window above it leads onto the porch roof. **East**: garage driveway and shutters (river docks lower down). **South**: back porch, back entrance, side stairs. **North-west**: exterior storage stairwell down to the basement.
- **Basement**: Garage (car, boat), Storage, Training Room, Laundry, Basement Stairs, Side Stairs, Back Hallway.
- **1F**: Lobby (main U-stairs), Living Room, Office, Dining Room, Kitchen, Back Entrance.
- **2F**: Upper Hallway, West Hall, Bathroom, Workshop, Master Bedroom, Walk-in Closet, Kids' Room.
- **Hatches**: Living Room → Training, Kitchen → Laundry, Upper Hallway → Basement Stairs, Master Bedroom → Dining.
- **Drone vents** (45 × 25 cm, drones only): six of them, and every barricaded door has an 18–20 cm gap at the bottom a drone can drive under.
- **Surfaces**: soft walls break into holes and passages; semi walls and wooden floors keep their studs/joists (see and shoot through, can't pass); hard walls never break. Reinforced walls only open to Thermite, unless a Bandit battery is on them. A wall Thermite burnt through can't be reinforced again.
- **Intel**: defenders watch 6 CCTV cameras (shootable); anyone can **ping** — an enemy under the crosshair is marked for the whole team for 5 s.

## 4. Observation (`webmcp.observe(agentId?)`, DOM, or `webmcp.subscribe(cb)`)

The hidden element `#webmcp-agent-bridge` is refreshed at 10 Hz (`webmcp.setTickRate(hz)` 1–60). For each controlled soldier there is a `<section class="webmcp-agent" data-agent-id="…">`, and the root mirrors the player:

| Attribute | Content |
| --- | --- |
| `data-self-state` | `operator, team, hp, stance, rappelInverted, lean, ads, weapon {name, ammoInMag, reserve, reloading}, gadgets {gadgetRemaining, universalRemaining, reinforcementsLeft}, room ("2F Master Bedroom"), floor, heading, pitch, position, interactPrompt, gadgetHint, heartbeat[]` |
| `data-first-person-vision` | entities **inside the camera frustum and not occluded**: `{ id, kind, label, yawDelta, pitchDelta, distance, state }` |
| `data-acoustic-cues` | sounds of the last 3 s: `{ type, relativeDirection, compass, vertical, bearingDeg, intensity, ageMs, range }` |
| `data-match-state` | `mode, phase, timeLeft, mission, site, siteLabel, objective, objectivePos, team, timeOfDay, room {code, transport, peers, score}` |

- `yawDelta` > 0 means the entity is to your **right**; `pitchDelta` > 0 means **above** your aim. Feed them straight into `lookLerp.yawDelta / pitchDelta`.
- `interactPrompt` / `gadgetHint` are plain English ("Hold [F] Reinforce (2 left)", "[G] tap: detonate · hold: place Exothermic Charge").
- `kind` ∈ `enemy, ally, hostage, soft_wall, semi_wall, reinforced_wall, hatch, floor, window, door, barricade, armor_panel, gadget, objective, drone`.

## 5. Actions (`webmcp.act(action, agentId?)` or `document.dispatchEvent(new CustomEvent('webmcp:action', { detail: { ...action, agentId } }))`)

```json
{
  "move": { "forward": 1, "strafe": -0.5, "sprint": false },
  "lookLerp": { "yawDelta": 12.5, "pitchDelta": -3, "rate": 0.3 },
  "stance": "crouch",
  "lean": "E",
  "ads": true,
  "fire": { "burst": 3 },
  "reload": false,
  "melee": false,
  "gadget": "key_hold",
  "interact": "hold",
  "ping": true,
  "rappel": "up",
  "drone": { "forward": 1, "strafe": 0, "jump": false },
  "durationMs": 250
}
```

- Continuous inputs (`move`, `fire: true`, `interact: "hold"`, `gadget: "key_hold"`, `rappel` directions, `drone`) last `durationMs` (16–5000, default 250); your input stays live while any of them runs.
- `lookLerp`: absolute `yaw` (compass °, 0 = North) / `pitch`, relative `yawDelta` / `pitchDelta`, or `targetId`. Exponential interpolation at `rate` per 1/60 s, capped at **540°/s**.
- **Gadgets = the human [G] / [X] keys** (context-sensitive, like the HUD):
  - `key` taps [G] (operator gadget): equips a tool (Sledge hammer, Ash launcher, Pulse sensor, IQ detector), throws (EMP, gas; tap again to detonate gas), toggles Montagne's shield, fires Blitz's flash, and **detonates** your placed charge.
  - `key_hold` holds [G] to **place** on what you're looking at (Thermite, Fuze cluster, Bandit battery on a reinforced wall, Castle panel / Kapkan EDD at a door frame, Mute jammer / Jäger ADS / Tachanka LMG on the floor). One placement per hold.
  - `key_universal` / `key_universal_hold` are the same for [X]: the attackers' breach charge.
  - Legacy: `equip` / `equip_universal` + `use` (instant use from the gadget slot), `detonate`.
- `interact` ([F], context): read `self.interactPrompt` — barricade, reinforce (defenders, 2 per round), vault/climb, ammo crate, hostage, defuser, bomb, rappel, mount Tachanka's LMG. Hold-actions need `"hold"` for their duration.
- `ping`: marks the enemy under your crosshair for your team (5 s), or drops a marker.
- `rappel`: `start`, `up/down/left/right`, `invert`, `swing` (Breach & Swing through the window in front), `detach`.
- During preparation attackers drive their drone with `drone` + `lookLerp` (+ `ping` to spot through it).

## 6. Minimal agent loop

```js
const id = 'self';
webmcp.subscribe((o) => {
  if (!o.self?.alive) return;
  const e = o.vision.find((v) => v.kind === 'enemy');
  if (e) return webmcp.act({ lookLerp: { yawDelta: e.yawDelta, pitchDelta: e.pitchDelta, rate: 0.35 }, ads: e.distance > 6, ping: true,
                             fire: Math.abs(e.yawDelta) < 2 && Math.abs(e.pitchDelta) < 2 ? { burst: 3 } : false }, id);
  const cue = o.acoustic.find((c) => c.vertical === 'Same_Floor');
  if (cue) return webmcp.act({ lookLerp: { yawDelta: cue.bearingDeg, rate: 0.2 }, stance: 'crouch' }, id);
  webmcp.act({ move: { forward: 0.7 }, lookLerp: { yawDelta: 8, rate: 0.1 }, durationMs: 300 }, id);
}, id);
```

A complete external example driving a real browser with Playwright lives in `tools/agents/webmcp-playwright-agent.mjs`; swap its `decide()` for an LLM call that receives the observation JSON plus this file.

## 7. WebMCP tools

If the browser exposes `navigator.modelContext` (W3C WebMCP proposal) the game registers these tools automatically; they are also callable as `await webmcp.callTool(name, args)`:

| Tool | Purpose |
| --- | --- |
| `r6_observe` | current observation (`agentId` optional) |
| `r6_act` | apply one action (`{ agentId?, action }`) |
| `r6_join_room` | `{ nickname, roomCode }` |
| `r6_start_terrorist_hunt` | `{ difficulty?, mission? }` |
| `r6_select_loadout` | `{ squad?, operator?, spawn?, ready? }` |
| `r6_map_knowledge` | static House layout |

## 8. Fair-play guarantees

- Vision is filtered by frustum + occlusion raycasts; nothing behind intact walls is reported (except your own Pulse / IQ scan and team pings, as on a human HUD).
- Acoustic cues never carry source identities, only direction / floor / intensity.
- Agents use the identical `SoldierInput` path as keyboard & mouse: no teleport, no instant aim, no wall-hack API.
