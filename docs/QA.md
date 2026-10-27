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
| 1.10 | A full-height wall "closing the void under the basement steps" cut the flight in half (the stair test only checked that both ends were reachable — they were, by other routes); another B wall poked 6 cm above the top steps | walls under a flight stop at its underside (`WallDef.h`) | `walk.test.ts` every flight walks end to end; `drone.test.ts` | ✅ |
| 1.12 | Ground-floor windows you couldn't vault: the living-room north window was blocked from the yard by an invisible 0.6 m box (the drone-vent shaft's clip), the west window by a sofa on both sides, the office window from inside by a bookcase | the shaft clip is a flush lid; furniture moved; ground-floor outer windows get clearance zones (0.9 m each side) | `vault.test.ts` (every 1F outer window, both sides you can stand at); `props.test.ts` | ✅ |
| 1.11 | Bottomless holes: a 0.6 m trench outside the living-room wall, slits at the bay, under every outdoor stair slope (a surface, no volume), the training room's west floor strip, the garage vent opening into earth, a pocket under every floor-level opening in an outer wall | yard runs up to the House; foundation under every cut-out; stair slopes filled below; B slab strip; a vent well at the garage; thresholds | `walk.test.ts` no bottomless holes (a 17 cm ball dropped next to every reachable floor lands) | ✅ |

Manual: walk every room in each stance; the walk maps (`tools/level/walkmap.ts`) show what the grid thinks — green reached, yellow crouch/prone only, black solid, grey body margin, red unreachable floor.

## 2. Outdoors (terrain.ts + the House datamap's forms)

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 2.1 | Outdoor context missing | forms from `HOUSE_DATAMAP_512_B64` (positions and heights above their ground): zones, spawn pads, lifts, treehouse, CCTV A/B, 11 police cruisers, APC, gazebo, pergola, sailboats, container, SW neighbour house, roof vents — each stood on the terrain | `walk.test.ts` (spawns connect, no traps); screenshots | ✅ |
| 2.2 | The ground was boxes per datamap level ("voxel"), levels wrong, cliffs between them | `terrain.ts`: one surface from the agreed levels (`YARD`) laid out on the top view — hard areas at their level (roads, sidewalks, terraces, drive, yards, lots), every step between them inside a kerb / retaining wall / flight's cheek walls / quay wall / pit wall, the rest a Laplace solve limited to 15°; drawn and collided as the same triangles, solid fill under it | `terrain.test.ts` (levels, gentle: nothing over 40°, 97 % under 15°), `walk.test.ts`, `zfight.test.ts` (grounds included) | ✅ |
| 2.3 | Garage drive was a 2 m ramp; the user: flush with the road | the east road falls gently (< 5°) from the corner to the basement level at the drive; drive = garage floor = road, dropped kerbs; retaining walls either side | `terrain.test.ts` (drive flush, grade) | ✅ |
| 2.4 | Front yard: the user's screenshots — two terraces with short flights, a porch so high nobody on the ground in front is seen from the 1F windows | road −2.4 → sidewalk −2.25 → 3 steps → lower terrace −1.8 → 4 steps → upper terrace −1.2 → 7 porch steps → porch 0; stone walls with pillars, cheek pedestals | `terrain.test.ts` (levels; road → front door walked upright; head on the terrace below the 1F sill) | ✅ |
| 2.5 | Players stuck in the APC on its spawn (R3) | APC parked at the west end of its lot; bollards, lamps, cruisers off the spawns | `walk.test.ts`: every walkable spot within 3.5 m of a spawn centre is standing room reached upright | ✅ |
| 2.6 | Callouts outdoors | zone names from the datamap (`B >> 4`) | manual: HUD location while walking outside | 🟡 |

## 3. Rendering: Z-fighting and depth

| # | Rule | Where | Status |
|---|---|---|---|
| 3.1 | 1F_0 west-wall vertices above z_local 0.0359 clamped | `tools/level/glb_extract.py` (390 glTF vertices) | ✅ |
| 3.2 | soft walls: polygonOffset −1 / −2 (drawn at their true size) | `Destruction.ts` panel mesh | ✅ `zfight.test.ts` |
| 3.3 | hatches: ± 0.015 m thicker, polygonOffsetFactor −3 | `Destruction.ts` | ✅ `zfight.test.ts` |
| 3.4 | logarithmic depth buffer, near 0.15, far 250 | `Game.ts`; custom shaders (sky, light shafts, particles) carry the log-depth chunks | 🟡 |
| 3.5 | nothing coplanar by construction: one wall owns each joint (pass-through line › outer › thicker › X-running), the others stop at its face — no overlaps, no notches; bands under the outer walls (B: footing) and the frieze under the eaves, with the slabs stopping at them; frames 4 mm proud of the cut faces; baseboards into the floor; props' boxes that share a face plane pulled 2 mm apart | `MapBuilder.ts` `wallReach`, `sliceWall`, `frameOpening`, `apart` | ✅ `zfight.test.ts`: every mesh of the House read back from the scene in world space, no two same-facing faces in one plane overlapping where they can be seen |

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
| 6.2 | Inverted rappel: the mouse was inverted on both axes | mouse look follows the view too (`viewLook`): right turns toward screen-right, up toward screen-up | `rules.test.ts` (the game's camera, projected before / after; fails on the old code) | ✅ |
| 6.3 | Slopes and stairs slowed walking to ~55 %, crouch / prone could stall | grounded motion follows the surface (lift from the ground normal), pressed into it along the normal | `locomotion.test.ts` (15° / 33° slopes, 18 cm steps, every stance ≥ 90 % / 85 % of the flat; downhill stays grounded) | ✅ |

## 7. Rules: destruction, missions, round state

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 7.1 | Soft walls & hatches vanished under punches / bullets | the wooden stud frame stays after melee and bullets (bullets pass between studs, bodies don't); only explosives, sledge, shotgun and breach charges break it | `destruction.test.ts` | ✅ |
| 7.2 | Terrorist Hunt had Secure Area and no defense mission | attack: Elimination, Bomb (plant the defuser, White Masks rush and cut it, progress is kept, two bombs or elimination wins), Hostage Rescue; defense: Hostage Protection (White Masks grab the hostage and run for an extraction) | `missions.test.ts` (rules + bots from all 10 rooms reach a planted defuser on the real map) | ✅ |
| 7.4 | TH: every enemy dead did not end Hostage Rescue; the round ended when the player died even with a defuser running | the match decides, not the player: every White Mask down wins (Elimination, Bomb before a plant, Rescue); a running defuser holds the round until it completes or is cut (not enemies dying, not operators dying, not the timer); the camera watches the defuser | `missions.test.ts`; E2E state cycles: to do (`docs/HANDOFF.md` §4.3) | 🟡 |
| 7.3 | Round state was silent | banner + SFX for defuser planted / cut / resumed, bomb defused, hostage picked up / taken / dropped / down, enemies left, round won / lost; HUD progress bar for the defuser | `missions.test.ts` (announcement keys); manual: listen | 🟡 |

## 8. Drone, ping, scan

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 8.1 | The drone moved by axis raycasts: a sloped stair stopped it dead (hop up every step) | rolls with a character controller (slides along walls, climbs ≤ 50°, snaps down; 4 mm skin so it still fits a 19 cm barricade gap) | `drone.test.ts`: up and down every flight without hopping, under every door barricade, through every vent both ways | ✅ |
| 8.2 | Vents blocked by furniture (kitchen fridge + dining sideboard, storage shelves) | vent clearance zones (0.6 m each side) for props | `props.test.ts` | ✅ |
| 8.3 | One key press pinged twice (UI action + input sample) | both sources merged into one ping per frame (agents ping through the input sample) | `e2e-scenarios` intel · ping | ✅ |
| 8.4 | Ping missed anyone whose chest was behind cover; cone fixed in degrees | one resolver: head / chest / hips / knees, cone = the body's size at that range, nearest to the crosshair wins | `spotting.test.ts` | ✅ |
| 8.5 | No drone / camera scan | hold the reticle on an enemy 0.5 s: identified (operator name), spotted for the team, refreshed while held; ring + label on the feed; jammed drones don't scan | `spotting.test.ts`; manual: watch the ring fill | ✅ |
| 8.6 | Spot markers floated 2 m up whatever the stance, labelled "SPOTTED" | above the head, labelled with the operator | manual | 🟡 |

## 9. Shield operators

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 9.1 | Montagne / Blitz: pistol in slot 1 *and* slot 2, no shield in first person | shield + one pistol: both slots are the same pistol, [1] slings the shield on the back / raises it (short transition), the pistol never leaves the hand | `shield.test.ts` | ✅ |
| 9.2 | No ADS with the shield | RMB swings the shield out to the left (turned 65°, still covers the left flank) and aims the pistol past its edge; one-handed hipfire is wider | `shield.test.ts` (collider front / aside / back against rays) | ✅ |
| 9.3 | Extend / flash regardless of where the shield is | only with the shield in front; no shooting while extended | `shield.test.ts` | ✅ |
| 9.4 | First person: no shield | shield in view (front: lower left · ADS: out of view to the left · extended: across the view with an open viewport slit · back: gone), left hand on the handle; the plate is built round a real slit (see-through in 1P and 3P) | manual: screenshots of the four poses | 🟡 |
| 9.5 | Peers saw the shield only in front | pose synced (`sb` + ADS + `sr` sprint), rig and collider follow it | code | 🟡 |
| 9.6 | The shield was drawn lower-left while its collider stopped rounds in front | one placement (`Soldier.shieldPlace`) for collider, 3P and 1P: in front the viewport slit is on the eye line (crosshair in it); sprinting it is carried on the left and covers only the left; 1P warped to the world fov | `shield.test.ts` (3P plate = collider; 1P screen IoU > 0.9; rounds front / sprint); browser: front ✅, sprint pose to re-check (`HANDOFF.md` §4.1) | 🟡 |
| 9.7 | Third-person arms bent behind the back while the gun pointed forward | upper arm + forearm with two-bone IK onto the grip / handguard / shield handle; ADS, sprint low-ready, reload; crouch leans forward | `rig.test.ts` (hands within 3 cm of their holds, in front of the shoulders, gun along the aim, every stance / pitch) | ✅ |

## 10. Interactions, first person, corpses

| # | Problem | Fix | Verified by | Status |
|---|---|---|---|---|
| 10.1 | [F] found things by distance alone: the hostage, a bomb, an ammo crate through a wall; a doorway in the next room offered for barricading | per kind (`src/game/Reach.ts`): objects need reach + the crosshair on them + a clear line (at your feet counts); doorways need the body at them facing them in sight; surfaces the aim ray; movement the body probes. The thing nearest the crosshair wins | `interact.test.ts` | ✅ |
| 10.2 | ADS: the right forearm rose toward the camera and covered a third of the screen ("the shoulder") | forearms run back, down and out from the hands | `viewmodel.test.ts` (projected: no forearm in the sight picture, none floating in view) — [before / after](viewmodel_before_after.jpg) | ✅ |
| 10.3 | One hip pose for everything: the pistol hung below the frame, the sledgehammer and devices half off-screen | a hold per item (rifle, pistol two-handed, launcher, sledgehammer head-up, held devices) with its own left-hand placement | `viewmodel.test.ts` (every item on screen at the hip) | ✅ |
| 10.4 | Corpses kept the pose they died in (mid-stride legs, crouched knees, upside down from a rope) | the body falls away from the shot (face down if shot from behind or prone), legs straight, arms out, head turned, gun dropped | `corpse.test.ts` (flat below 0.55 m for every pose, back / front) | ✅ |
| 10.5 | Bodies in the way | no body / shield collider once dead (the shield goes down the same frame) | `corpse.test.ts` | ✅ |
