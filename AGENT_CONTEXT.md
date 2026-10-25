# AGENT_CONTEXT — Rainbow Six Siege: Original 2015 Edition (Web Tactical FPS)

You are an AI agent joining a browser tactical FPS. You perceive **only what your operator could perceive in first person** and you act through the **same input pipeline as a human** (same movement physics, recoil, collision and a 540°/s turn-rate cap). This file is the complete contract. It is also shown in-game under **[AI Agent WebMCP 접속 가이드 & 스키마 보기]**.

## 1. Joining

| Goal | How |
| --- | --- |
| PvP room (online) | open the game URL, then `await webmcp.join({ nickname: 'MyAgent', roomCode: 'R6-8492' })` — or open `?room=R6-8492&nick=MyAgent&agent=1` |
| PvP room (same browser, no server) | `webmcp.join({ nickname, roomCode, mode: 'local' })` — tabs of one browser share the room over BroadcastChannel |
| Loadout in lobby | `webmcp.selectLoadout({ squad: 'B', operator: 'thermite', spawn: 'docks', ready: true })` |
| Solo Terrorist Hunt | `webmcp.startTerroristHunt({ difficulty: 'Normal', mission: 'random' })` — or `?th=1&difficulty=Hard&mission=bomb&agents=2` |
| Test agent slots | lobby / TH menu button **+ 로컬 WebMCP AI 에이전트 슬롯 추가** spawns built-in agents; `webmcp.listAgents()` lists ids; `webmcp.act(action, 'agent1')` takes one over (it returns to the built-in policy 2.5 s after your last action) |

Room codes are 6 significant characters: `R6-` + 4 digits. Everyone (humans and agents) typing the same code lands in the same Cloudflare Durable Object instance.

## 2. Game rules (2015 launch rules, condensed)

- **Teams**: Attackers (Sledge, Ash, Thermite, Thatcher, Fuze) vs Defenders (Smoke, Mute, Castle, Pulse, Jäger, Bandit). Terrorist Hunt: you (+ agent teammates) attack AI "White Masks".
- **Round**: random **mission** (Hostage / Secure Area / Bomb; TH also Classic elimination), random **site** room in House and random **time of day** (morning / night) every round.
- **Phases**: Preparation 45 s (PvP; TH 20 s) — attackers drive a **drone** (`drone` action), defenders reinforce & barricade → Action 3:00 (TH 6:00). PvP: first squad to 3 round wins, sides swap every round.
- **Win**: eliminate the other team, or the mission objective. Hostage: escort the hostage (hold F to pick up) to any spawn zone; killing the hostage loses the round for the shooter's team. Secure Area: attackers in the room with no defenders for 10 s. Bomb (PvP): plant the defuser (hold F 4 s) and protect it 30 s; defenders disable it (hold F 4 s). Bomb (TH): disarm both bombs (hold F 6 s each).
- **Damage**: headshot = instant kill for every weapon. Torso ×1, legs ×0.75, armour 1/2/3 → ×1.0/0.9/0.8. Bullets penetrate soft & semi surfaces and barricades (−35 % per wall).
- **Friendly fire** is ON in PvP.

## 3. Map knowledge (public — same as a human who knows House)

`webmcp.getMapKnowledge()` returns rooms (with floor rectangles and objective spots), stairs, hatches, every door/window opening and the spawn zones. Axes: **+X East, +Y Up, +Z South (North = −Z)**. Floors: Basement y = −3, 1F y = 0, 2F y = 3, roof y = 6. The front porch/lobby faces **West**, garage shutters face **East** (river docks, lower ground), back entrance + side stairs are **South**, the construction site is **North**.

- **Basement**: Garage (E, 2 shutters, central pillar, car, boat), Storage (NW, exterior door), Training, Laundry, basement hallway; stairs up to Living Room and Kitchen; 2 ceiling hatches (Laundry ← Office, Garage ← Pantry).
- **1F**: Lobby (front door W), Living Room (4 windows W/N), Office (3 windows, porch), Dining, Stair Hall (main stairs), Kitchen, Pantry, Back Entrance (S door).
- **2F**: Upper Hallway (non-barricadeable **open window** above the front door → porch roof), Master Bedroom (+ bullet-proof Walk-in Closet, floor hatch → Dining), Bathroom (shower stall cover), Kids' Room (4 windows on 3 sides, soft front wall), Workshop (N/E windows); hallway floor hatch → kitchen stairs.
- **Surfaces**: soft walls (red) break into holes/passages; semi-breach walls & wooden floors (yellow) keep studs/joists — you can see and shoot through but not pass; solid (white) never break. Reinforced (grey steel) only opens with Thermite (unless a Bandit battery is on it).

## 4. Observation (`webmcp.observe(agentId?)`, DOM, or `webmcp.subscribe(cb)`)

The hidden element `#webmcp-agent-bridge` is refreshed at 10 Hz (`webmcp.setTickRate(hz)` 1–60). For each controlled soldier there is a `<section class="webmcp-agent" data-agent-id="…">` and the root mirrors the player:

| Attribute | Content |
| --- | --- |
| `data-self-state` | `operator, team, hp, stance (Stand/Crouch/Prone/Rappel), rappelInverted, lean (Q/E/None), ads, weapon {name, ammoInMag, reserve, reloading}, gadgets {gadgetRemaining, universalRemaining, reinforcementsLeft}, room ("2F Master Bedroom"), floor, heading (° compass), pitch, position, interactPrompt, heartbeat[]` |
| `data-first-person-vision` | array of entities that are **inside the camera frustum and not occluded** (Rapier raycast from the eye; holes in walls count as see-through): `{ id, kind, label, yawDelta, pitchDelta, distance, state }` |
| `data-acoustic-cues` | sounds of the last 3 s: `{ type, relativeDirection, compass, vertical, bearingDeg, intensity, ageMs, range }` |
| `data-match-state` | `mode, phase, timeLeft, mission, site, siteLabel, objective, objectivePos, team, timeOfDay, room {code, transport, peers, score}` |

- `yawDelta` > 0 means the entity is to your **right**; `pitchDelta` > 0 means **above** your aim. Feeding them straight into `lookLerp.yawDelta / pitchDelta` aims at it.
- `kind` ∈ `enemy, ally, hostage, soft_wall, semi_wall, reinforced_wall, hatch, floor, window, door, barricade, armor_panel, gadget, objective, drone`.
- Enemy `state`: `visibleParts (head/torso/legs), stance, headYawDelta, headPitchDelta, facingMe, moving, operator (≤ 30 m)`.
- Surface `state`: `tier, damagePct, passable, reinforced, electrified, exterior`. Opening `state`: `opening, barricade (wood/castle/none), barricadeable`.
- Acoustic `relativeDirection` is a 16-point compass **relative to your facing** (`N` = straight ahead, `E` = right, `S` = behind) or `Above_Floor` / `Below_Floor` when the source is on another floor. `type` ∈ `gunshot, suppressed_gunshot, explosion, footstep, wall_breach, barricade_place, barricade_break, gadget, impact, voice`.

The DOM also contains readable `<li data-kind data-yaw-delta data-pitch-delta data-distance>` items. Press **B** to see the bridge as a debug overlay.

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
  "switchWeapon": "gadget",
  "gadget": "use",
  "interact": "hold",
  "rappel": "up",
  "drone": { "forward": 1, "strafe": 0, "jump": false },
  "durationMs": 250
}
```

- Continuous inputs (`move`, `fire: true`, `interact: "hold"`, `rappel: up/down/left/right`, `drone`) last `durationMs` (16–5000, default 250) — re-send every tick to keep going.
- `lookLerp`: absolute `yaw` (compass °, 0 = North, 90 = East) / `pitch`, or relative `yawDelta` / `pitchDelta`, or `targetId` (track a visible entity). Rotation is exponential interpolation with `rate` per 1/60 s, capped at **540°/s** — exactly the human limit, no snapping.
- `fire: { burst: n }` fires n rounds; `fire: true` holds the trigger. Semi-auto pistols get trigger resets automatically.
- `gadget`: `equip` (slot 3, operator gadget), `equip_universal` (slot 4: breach charge / barricade), `use` (fire the equipped gadget once: place charge, throw EMP/gas, launch Ash round, swing Sledge hammer, deploy jammer/ADS/battery), `detonate` ([G] remote detonation: breach charges, Thermite ignition, Smoke canisters). Pulse: hold `fire` with the sensor equipped to scan; results appear in `self.heartbeat`.
- `interact`: context action **[F]** — `self.interactPrompt` tells you what it will do (barricade a door/window, reinforce a soft wall/hatch (defenders, 2 per round), vault a window, pick up / drop the hostage, plant / disable the defuser, disarm a bomb, hook a rappel rope). Hold-actions need `"hold"` for their full duration (see `interactProgress`).
- `rappel`: `start` (face an exterior wall from the ground or stand at a roof edge facing out), `up/down/left/right`, `invert` (upside-down peek), `swing` (Breach & Swing through the window in front; smashes a wooden barricade), `detach`.
- During the preparation phase attackers control their drone with `drone` + `lookLerp`.

## 6. Minimal agent loop

```js
const id = 'self';
webmcp.subscribe((o) => {
  if (!o.self?.alive) return;
  const e = o.vision.find((v) => v.kind === 'enemy');
  if (e) return webmcp.act({ lookLerp: { yawDelta: e.yawDelta, pitchDelta: e.pitchDelta, rate: 0.35 }, ads: e.distance > 6,
                             fire: Math.abs(e.yawDelta) < 2 && Math.abs(e.pitchDelta) < 2 ? { burst: 3 } : false }, id);
  const cue = o.acoustic.find((c) => c.vertical === 'Same_Floor');
  if (cue) return webmcp.act({ lookLerp: { yawDelta: cue.bearingDeg, rate: 0.2 }, stance: 'crouch' }, id);
  webmcp.act({ move: { forward: 0.7 }, lookLerp: { yawDelta: 8, rate: 0.1 }, durationMs: 300 }, id);
}, id);
```

A complete external example driving a real browser with Playwright lives in `tools/agents/webmcp-playwright-agent.mjs`.

## 7. WebMCP tools

If the browser exposes `navigator.modelContext` (W3C WebMCP proposal) the game registers these tools automatically; they are also callable as `await webmcp.callTool(name, args)`:

| Tool | Purpose |
| --- | --- |
| `r6_observe` | current observation (`agentId` optional) |
| `r6_act` | apply one action (`{ agentId?, action }`) |
| `r6_join_room` | `{ nickname, roomCode, mode? }` |
| `r6_start_terrorist_hunt` | `{ difficulty?, mission? }` |
| `r6_select_loadout` | `{ squad?, operator?, spawn?, ready? }` |
| `r6_map_knowledge` | static House layout |

## 8. Fair-play guarantees

- Vision is filtered by frustum + occlusion raycasts; nothing behind intact walls is reported (except your own Pulse scan, as on a human HUD).
- Acoustic cues never carry source identities, only direction / floor / intensity.
- Agents use the identical `SoldierInput` path as keyboard & mouse; there is no teleport, no instant aim and no wall-hacking API.
