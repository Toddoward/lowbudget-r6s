# R6S: TEMU — QA review

A step-by-step review of what the game lacked, each item with how it is verified.
Verification is by **unit / graph tests** (`npm test`, no play-through), **tools**
(`tools/level/*`), or **manual** (for human play-testers: what to do, what to expect).

Status: ✅ fixed and covered by a test · 🟡 fixed, manual check only · ⏳ open

## 1. Map, movement, navigation

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 1.1 | Interior impassable: furniture placed with guessed coordinates blocked 13 doorways | Props re-placed; every doorway, stair end and hatch has a clearance zone | `props.test.ts` (clearance zones, inside room, no overlaps) | ✅ |
| 1.2 | "E2E verified" meant teleporting players, never walking | Walkability by graph search: a 10 cm clearance grid of the built colliders per stance (stand 1.82 m / crouch 1.22 m / prone 0.72 m, r 0.36 m), BFS from every spawn | `walk.test.ts` (11 checks) | ✅ |
| 1.3 | Whole 2F unreachable (seam between lobby stairs and landing) | found by 1.2; the grid steps over seams the capsule spans | `walk.test.ts` rooms reached upright | ✅ |
| 1.4 | Bots spawned inside walls / the void under the basement stairs | Bot nav rebuilt on the same grid; unreachable pockets dropped; "Basement Stairs" is a transit room | `walk.test.ts` nav nodes on reachable floor, spawn spots per room | ✅ |
| 1.5 | Nav graph split in pieces (furniture broke raycast links; docks cut off) | Nav edges are straight walks on the grid; A* entry is the nearest node you can walk to | `walk.test.ts` A* spawn → every room | ✅ |
| 1.6 | Layout differed from the source model (2F doors 1–1.5 m off, missing walls/openings) | Audited against the .glb wall slices; 19 openings + 16 walls fixed, 6 reviewed exceptions listed | `tools/level/glb_walkcheck.ts` (0 differences) | ✅ |
| 1.7 | Traps: pits you can fall into and not leave | no-trap check (fall in → walk/vault out); two pits fixed (living-room French windows, back of the house) | `walk.test.ts` no traps | ✅ |
| 1.8 | Outdoor stairs had step edges (drones / smooth walking) | stepped visuals, one sloped triangle-mesh collider per flight | `walk.test.ts`; manual: drive the drone up the sidewalk steps | 🟡 |
| 1.9 | Objective spots under furniture | spots moved onto free floor, enforced | `walk.test.ts` objective spots | ✅ |

Manual: walk every room in each stance; the walk maps (`tools/level/walkmap.ts`) show what the grid thinks — green reached, yellow crouch/prone only, black solid, grey body margin, red unreachable floor.

## 2. Outdoors (House datamap)

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 2.1 | Outdoor context missing | `HOUSE_DATAMAP_512_B64` + decoder used as supplied; terrain, zones, spawn pads, lifts, treehouse, CCTV A/B, 11 police cruisers, APC, gazebo, pergola, sailboats, container, SW neighbour house, roof vents | `walk.test.ts` (spawns connect, no traps); manual fly-over | ✅ |
| 2.2 | Level differences ≤ 1.6 m between zones were cliffs | stairs generated along the lower side of each edge (0.17 m risers) | `walk.test.ts` | ✅ |
| 2.3 | Seams between the datamap's House outline and the traced House became trenches | road-level slivers < 2 m between higher zones take the lower side's level | walk maps | 🟡 |
| 2.4 | Callouts outdoors | zone names from the datamap (`B >> 4`) | manual: HUD location while walking outside | 🟡 |

## 3. Rendering: Z-fighting and depth

| # | Rule | Where | Status |
|---|---|---|---|
| 3.1 | 1F_0 west-wall vertices above z_local 0.0359 clamped | `tools/level/glb_extract.py` (390 glTF vertices) | ✅ |
| 3.2 | soft walls: polygonOffset −1 / −2, height × 0.995 | `Destruction.ts` panel mesh (visual only) | 🟡 |
| 3.3 | hatches: ± 0.015 m thicker, polygonOffsetFactor −3 | `Destruction.ts` | 🟡 |
| 3.4 | logarithmic depth buffer, near 0.15, far 250 | `Game.ts`; custom shaders (sky, light shafts, particles) carry the log-depth chunks | 🟡 |

Manual: look along the 2F west wall, soft walls next to hard walls and the hatches from a distance — no flicker.

## 4. Combat visibility and colliders

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 4.1 | During drone prep the attacker's body stood at the spawn: bots saw it, shot it, HP dropped | attackers are not deployed during prep: no collider, not drawn, not targetable, no damage | `rules.test.ts` | ✅ |
| 4.2 | Bullets stopped by invisible bounding boxes (trees, cars, furniture) | every prop / vehicle / outdoor object collides with exactly the boxes it is drawn with; foliage has no collider | manual: shoot past a car's hood, under a table, through a tree canopy | 🟡 |
| 4.3 | Bots seeing through props | vision uses the same colliders (4.2); full bounding boxes are gone | manual | 🟡 |

## 5. Performance

| # | Problem | Fix | Status |
|---|---|---|---|
| 5.1 | Flashlight toggle froze the game (a shadow-casting light added/removed → every material recompiled) | flashlight removed; the drone's night headlight is permanent, only its intensity changes | 🟡 |

## 6. Controls

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 6.1 | Inverted rappel: W/S reversed | controls follow the view: inverted, W descends, S climbs, A/D mirror | `rules.test.ts` | ✅ |

## 7. Rules: destruction, missions, round state

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 7.1 | Soft walls & hatches vanished under punches / bullets | the wooden stud frame stays after melee and bullets (bullets pass between studs, bodies don't); only explosives, sledge, shotgun and breach charges break it | `destruction.test.ts` | ✅ |
| 7.2 | Terrorist Hunt had Secure Area and no defense mission | attack: Elimination, Bomb (plant the defuser, White Masks rush and cut it, progress is kept, two bombs or elimination wins), Hostage Rescue; defense: Hostage Protection (White Masks grab the hostage and run for an extraction) | `missions.test.ts` (rules + bots from all 10 rooms reach a planted defuser on the real map) | ✅ |
| 7.3 | Round state was silent | banner + SFX for defuser planted / cut / resumed, bomb defused, hostage picked up / taken / dropped / down, enemies left, round won / lost; HUD progress bar for the defuser | `missions.test.ts` (announcement keys); manual: listen | 🟡 |

## 8. Open items (in progress, in this order)

| # | Item | Status |
|---|---|---|
| 8.1 | Shield operators: slot 1 shield front ↔ back, pistol always in hand, RMB turns the shield sideways and aims | ⏳ |
| 8.2 | Ping and drone scan rework | ⏳ |
| 8.3 | Interaction detection per type (door/window barricade, hatch, hostage, defuser, gadget pickup) | ⏳ |
| 8.4 | First-person arms per item (hands on the grip/handguard, shoulder out of view), gadget / interaction viewmodels | ⏳ |
| 8.5 | Corpses: proper death pose, no walking pose, not blocking movement | ⏳ |
