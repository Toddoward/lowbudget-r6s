# Handoff — R6S: TEMU rework (state on 2026-10-27)

> **한국어 요약** — 사용자가 2026-10-27에 요청한 전체 수정 목록(아래 §2)을 기준으로, 이번 세션에서
> ① 테러리스트 헌트 라운드 종료 규칙(해체기 설치 전/후, 플레이어 사망과 무관한 매치 상태),
> ② 레펠 거꾸로 매달림 시 마우스 반전 제거(키·마우스 모두 화면 기준),
> ③ 경사로·계단에서 모든 자세(서기/앉기/엎드리기) 이동 속도 유지,
> ④ 방패(정면 중앙 + 총안구에 크로스헤어, 달리기 시 왼쪽으로, 충돌체 = 그려진 위치),
> ⑤ 3인칭 팔(뒤로 꺾인 팔 버그 수정, 2관절 IK로 손이 총/방패 손잡이에 붙음, Blender로 GLB 재생성)
> 을 끝내고 커밋·푸시했습니다(`1439fe7`, `7c9acb4`). **남은 일**: 집 전체 재구성(청사진 기반, 평면 확대,
> 뒷문 1F→2F 계단, 남쪽 데크+지붕 동선, 차고 차량 주변 통로, 소품 크기, 문↔문 연결, 경사 지붕, 모서리/Z-fight),
> 야외 지형(탑뷰 이미지 기반 매끄러운 하이트필드, 스폰 구역 소품 제거), 그리고 전체 검증·배포(§5–§7).
> 다음 입력에서는 §1 순서대로 환경을 다시 띄우고 §5부터 이어서 진행하면 됩니다.

---

## 1. Resume checklist

| What | Command / place |
|---|---|
| Repo (worktree) | `/home/user/r6s-fewshot`, branch **`claude/adoring-bohr-esh1fj`** (pushed; based on `develop` @ `2aa762c`) |
| Last commits | `7c9acb4` shields + 3P rig · `1439fe7` TH rules, rappel look, slopes · (this file) |
| Release flow | PR `claude/adoring-bohr-esh1fj` → `develop` (CI: typecheck, unit, build, browser e2e + scenarios; deploys `develop.r6s-temu.pages.dev`), then release PR `develop` → `main` (deploys `r6s-temu.pages.dev`). **No PR is open for this work yet.** |
| Unit / graph tests | `npm test` (all `tools/tests/*.test.ts`; 81 pass at `7c9acb4`) · single file: `npx tsx --test tools/tests/<name>.test.ts` |
| Typecheck | `npx tsc --noEmit -p .` |
| QA build + preview | `VITE_QA=1 npx vite build --outDir dist-qa` then `npx vite preview --outDir dist-qa --port 4173 --strictPort` (run in background) |
| Browser suites | `npm run test:e2e`, `npm run test:scenarios` (`E2E_ONLINE=1` also needs `npx wrangler dev` on 8787 for S5) |
| Screenshots | `node tools/tests/shots-rig.mjs <outdir>` (1P Montagne front / sprint / ADS, 3P posed rigs) — preview must be running |
| Asset rebake (Blender) | `npm run assets:spec && python3 tools/cli-anything/pipeline.py --only operator_ --jobs 4` (Blender 4 is at `/usr/bin/blender`; the pipeline clones CLI-Anything into `tools/cli-anything/.cache`) |
| Reference images (this session only) | `/tmp/claude-0/-home-user/c99bd3f1-f9dd-51e9-b22c-c19f7829a53d/scratchpad/reference/` — `3.webp` 1F blueprint, `4.webp` 2F, `5.webp` basement, `6.webp` roof, `7.webp` (= `2.webp`) high-res top view with outdoors, `1.webp` labelled outdoor overview (Korean labels). Not committed (third-party imagery). |
| Source model | `/root/.claude/uploads/c99bd3f1-f9dd-51e9-b22c-c19f7829a53d/52f1d496-rainbow_six_siege_-_house_map.glb` and `…/335b083b-house_map.blend` (see `tools/level/README.md` for the GLB → plan pipeline) |

Environment notes learned the hard way:
- SwiftShader (headless Chromium) renders a few fps: screenshots at **960×540, quality `low`**, `page.setDefaultTimeout(180000)`. A 1280×720 medium shot timed out; one long run got the container killed (exit 137) — keep runs short.
- `webmcp.act` holds are **wall-clock** (`durationMs`); with slow frames they expire before the shot. Use long holds, or drive `Soldier` directly / `sim()` (synchronous `g.step`) as `e2e-scenarios.mjs` does.
- To keep White Masks out of a scripted scene: replace `b.update` with a zero input and `b.s.damage = () => false`. **Don't** teleport them off the map — they die from the fall and the round ends ("All hostiles eliminated"), which is correct behaviour.

---

## 2. The request (2026-10-27), itemised

Original message was in Korean; this is a faithful itemisation. Status: ✅ done & tested · 🟡 done, browser check still open · ⬜ to do.

| # | Requirement | Status |
|---|---|---|
| R1 | Build the map properly (Blender / the GLB & .blend given), not voxel boxes. If the SVG/datamap data is garbage, infer depth from the top-view image yourself (e.g. an image-to-depth model from Hugging Face) | ⬜ §6 |
| R2 | Terrain elevations are wrong; everything outdoors is voxel blocks you can't walk on | ⬜ §6 |
| R3 | No props in spawn zones (players get stuck in the APC). Verify with BFS / nav | ⬜ §6.4 |
| R4 | Many places still can't be walked door → door | ✅ `walk.test.ts` door to door inside the House (every indoor side of every doorway reaches every other upright, never leaving the footprint) |
| R5 | Back entrance: 1F → basement stairs exist but **1F → 2F stairs are missing**; follow the stairs of the GLB / .blend | ✅ `7a23245` |
| R6 | Indoor props are mis-sized and block players; rebuild from the uploaded blueprints, basement to roof | ✅ real-world sizes at the 1.3× plan (sofa 2.6 m, king bed 2.0 × 2.2 m, sedan 4.6 × 1.9 m); `walk.test.ts`: every room entered upright with no sealed pockets, every doorway clear, door to door inside |
| R7 | Kitchen back-door **deck runs long** (as in the blueprint) with a **roof along it**, so on 2F you can walk between the Kid's Bedroom and Master Bedroom windows over that roof | ✅ `932b666` (`vault.test.ts`: Kids → porch roof → Master) |
| R8 | Basement garage: walkable space on all four sides of the car | ✅ `walk.test.ts`: a lane ≥ 0.8 m (plus a body radius) reached upright along every side |
| R9 | House plan is too small: keep the storey height, enlarge the plan | ✅ `66f0843` |
| R10 | Corners look "worm-eaten" (the overlap trimming for Z-fighting) and Z-fighting is still there — fix both | ✅ R10 commit (`zfight.test.ts`, QA §3.5) |
| R11 | Model the level terrain from the high-res top view (depth model or anything that works) | ⬜ §6 |
| R12 | Movement on slopes/stairs: walking lifts the body; speed barely changes on stairs; crouch must climb stairs/slopes | ✅ `1439fe7` |
| R13 | Shield in **front** (viewport for sight), not off to the left while still stopping rounds; sprinting moves it to the **left**, and only that side blocks | ✅ `7c9acb4` + browser scenario (S2 shield step) and screenshots of front / sprint / ADS |
| R14 | 3P arms pulled back while the gun points forward (grotesque); 1P and 3P out of sync | ✅ `7c9acb4` (🟡 front close-up screenshot, §4) |
| R15 | Process: analyse → goals → stepwise plan → apply → verify each step and each cycle → E2E per user/debug scenario; game state cycles must work | ongoing — §7 |
| R16 | TH attack (bomb / hostage): every enemy dead **before** a defuser is planted ends the game | ✅ `1439fe7` |
| R17 | After a plant: ends only when the defuser completes or the defenders cut it — not when every enemy dies | ✅ `1439fe7` |
| R18 | Rappel: keys follow the view; the **mouse must not be inverted** | ✅ `1439fe7` |
| R19 | Match state is served by match conditions, not by the player character: the player dying after planting → the terrorists must still cut the defuser | ✅ `1439fe7` |
| R20 | **Roof is still flat** — must be pitched (roof plan `6.webp`) | ✅ `41835fe` (`roof.test.ts`) |
| N1 | (follow-up, with a screenshot) The lobby stairs are an **L**: from the front entrance along the wall up to 2F — east side, as in the GLB / blueprint (answered) | ✅ L-stairs commit (`walk.test.ts` flights end to end + both ends; screenshots lobby / 2F gallery) |
| N2 | (follow-up) The back stairs run B → 1F → 2F with a half landing per storey; the three-sided bay window is at the **1F → 2F half landing**, not at 1F (nobody on the ground outside is seen from inside), with an upper window above it through which 2F is seen from rappel / watchtower height | ✅ `7a23245` + R10 commit (`BAY_LOW` / `BAY_HIGH`) |
| N3 | (follow-up, 4 screenshots) Outdoors: the garage drive is **flush with the road** (no steep ramp); the front yard rises gently to the high front door — two terraces with gentle two-step flights, the porch deck so high that nobody on the ground is seen from the 1F windows; across the public road a **construction site**. Heights agreed (1F floor = 0): road −2.4 → steps → lower terrace → steps → upper terrace −1.2 → porch stairs (7) → porch 0; the east road falls gently to the river, flush with the garage (−3.5); the site at road level | ⬜ §6 |

Earlier standing instructions still in force: verify with graph search / unit tests, **not** by agent play-throughs; develop on the branch above; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01Ests53BizZeDjYiu8CpRiP`; no model ids in commits/PRs. R1/R11 supersede the earlier "use the Base64 datamap as is / don't write a terrain generation script" instruction — the user now explicitly asks for terrain derived from the top-view image.

---

## 3. Done in this session (with the tests that prove it)

### 3.1 TH round rules — `src/game/Objectives.ts`, `src/game/Game.ts` (R16, R17, R19)
- `Objectives.defuserHolds` (TH bomb + defuser running) gates both `checkElimination(enemiesAlive)` and the new `checkOperators(operatorsAlive)`; Game calls `checkOperators` instead of ending the round itself, and the action timer does not expire while a defuser holds.
- Every White Mask down = win in Elimination, Bomb (pre-plant) and Hostage Rescue (rescue used to keep running); Hostage Protection keeps its inverse.
- With nobody left to spectate, the camera orbits the defuser (`hud.watchDefuser`).
- Tests: `tools/tests/missions.test.ts` — "before a plant…", "once the defuser is planted only it decides…", "Elimination / Hostage Rescue…", protect case.

### 3.2 Rappel look — `src/game/Soldier.ts` `viewLook()` (R18)
- Hanging inverted the camera is rolled 180°, so mouse deltas are negated on both axes; keys were already screen-relative (`rappelAxes`).
- Test: `rules.test.ts` builds the game's camera (YXZ, roll π) and checks on screen that mouse right/up and W/A/S/D move toward screen-right/up/…; fails on the old code.

### 3.3 Walking on slopes and stairs — `Soldier.updateMove` / `moveCollide` (R12)
- The ground normal is taken from the KCC contacts (fallback raycast); grounded motion follows the surface (`groundRise`) and presses into it along its normal (a vertical press slid down the slope).
- Test: `locomotion.test.ts` — 15°/33° slopes and 18 × 28 cm steps, standing/crouched/prone, pace ≥ 90 % (steps ≥ 85 %) of the flat; downhill stays grounded. Before: 54 % standing on 33°.

### 3.4 Shields — `Soldier.shieldPlace / shieldLocal / placeShield`, `gadgetModels.SHIELD_PLATES`, `ViewModel.shieldInView/updateShield`, `Rig` (R13)
- One placement for collider, 3P and 1P. Poses: `front` (slit on the eye line, crosshair in it), `run` (sprinting: left side, turned 80°), `ads` (swung left 60°), `back`, `ext`. No prone behind a raised shield. Snapshot field `sr` (sprinting) for peers.
- 1P: plate in eye space, warped by `k = tan(vmFov/2)/tan(worldFov/2)` (`ViewModel.worldFov` set by Game each frame).
- Tests: `shield.test.ts` — 3P plate = collider (centre < 1 cm, facing, size); 1P screen-rect IoU > 0.9 vs the collider at pitches 0/−0.4/0.3, crosshair inside the slit; rounds: front stops head & chest, sprinting leaves the front open and covers only the left.

### 3.5 Third-person rig — `src/render/Rig.ts`, `src/assets/operatorModels.ts` (R14)
- Root cause: `armR.rotation.x = -1.25 - aim*0.9` swung the arms **behind** the body; crouch lean also tilted the torso backwards.
- Arms = upper arm (`armL/R`) + forearm (`foreL/R`), `ARM_UPPER 0.30`, `ARM_FORE 0.31`; two-bone IK (`solveArm`) with elbows out/down. Gun and shield hang off the root (body frame). Holds: rifle on the shoulder pocket, left hand on the rear of the handguard (≤ 0.27 m ahead of the grip), pistol two-handed, shield pistol + left hand on the handle; ADS raises the sight to the eye; sprint low-ready; reload left hand to the mag well; out-of-reach holds slide back along the aim.
- Game updates each local rig's weapon every frame and passes `{ ads, sprint, reload }`; peers pass `ads`, `sr`.
- Operator GLBs rebaked through the Blender pipeline (new bones `foreL/foreR`; Montagne, Blitz, IQ, Kapkan, Tachanka got GLBs for the first time).
- Tests: `rig.test.ts` — hands within 3 cm of their holds, ≥ 12 cm in front of the shoulders, gun within 2° of the aim, for 4 weapons × 3 stances × 3 pitches × hip/ADS; sprint; shield ops; hostage.

---

## 4. Open checks on the done work (do these first next time)

1. ~~Sprint shield pose in the live game~~ — resolved: it was the screenshot script (agent holds are clamped to 5 s of wall-clock time and the `ads` flag only merges within 2 s of the last action; slow headless frames outlasted both). `shots-rig.mjs` now steps synchronously and freezes the simulation for each capture; `e2e-scenarios.mjs` S2 asserts the slit on the crosshair in front, the plate at the left and the rounds while sprinting.
2. **3P close-ups from the front** (`shots-rig.mjs` writes `3p_rifles.png`, `3p_shields.png`): the camera currently looks at the rigs from behind; turn the rigs toward the camera (`root.rotation.y ≈ 0.18`) and review elbows, hand placement and the shield handle.
3. **TH state-cycle E2E** (R15/R19) in `e2e-scenarios.mjs`: (a) bomb: plant → kill every White Mask → round still on → defuser completes → win; (b) plant → player dies → round still on, camera on the defuser → a White Mask cuts it → loss; (c) hostage rescue: kill all → win; (d) no plant, player dies → loss. Use `sim()` stepping and `window.qa` helpers.
4. Run `npm run test:e2e` and the full `test:scenarios` (with `E2E_ONLINE=1`) on the new build — not yet run after `7c9acb4`.

---

## 5. House rebuild from the blueprints (R4–R10, R20)

### 5.1 Where things live
- `src/map/houseLayout.ts` — rooms, walls (`WallDef`: run axis, line, from/to, kind, floor, `ext`, optional `h`), openings, stairs (`STAIRS`), hatches, floors (`FLOORS`, semi floors built from pieces around holes since `2aa762c`), vents, spawn zones, `HOUSE_RECT`, `DRIVEWAY`, `MAP_BOUNDS`.
- `src/map/MapBuilder.ts` — builds colliders + meshes + destructible panels from the layout (walls, openings, floors, hatches, stairs = ramp colliders + step meshes, banisters, roof/parapets, porch roofs).
- `src/map/houseProps.ts` (furniture), `src/map/clearance.ts` (keep-clear zones: doors, windows, vents), `src/map/walkGrid.ts` + `tools/tests/walk.test.ts` (per-stance clearance grid + BFS), `src/ai/NavGraph.ts`.
- `tools/level/` — GLB → plan tracing (`glb_extract.py`, `glb_faces.py`, `glb_plot.py`) and `walkmap.ts`/`png.ts` (top-down PNG of the walk grid per floor).
- Coordinates: **+X east, +Y up, +Z south (north = −Z)**. Floors: B −3.5, 1F 0, 2F 3.5, roof 7.0 (3.2 m ceilings, 0.3 m slabs). Current footprint `HOUSE_RECT = R(-9.6, -7.55, 9.85, 6.75)` ≈ 19.5 × 14.3 m at plan scale ×2.85 of the GLB.

### 5.2 Scale (R9)
- Keep every Y value (storey height, stairs rise) and scale the plan only. Pick the factor from the blueprints, not by eye: measure in `3.webp` the exterior width (≈ x 215 → 900 px) against door widths (single doors ≈ 25–30 px) and choose the factor that makes a single door ≈ 1.2 m and the main stair flight ≈ 1.2–1.4 m wide (R6S scale). Expect ≈ ×1.25–1.35 on the current plan (→ ≈ 25 × 18.5 m).
- Apply as one transform in the layout (a `PLAN_SCALE` applied to every x/z literal, or re-trace at the new scale) so openings, props, vents, stairs and the outdoor cut-outs (`Outdoor.ts` `HOUSE_HOLES`, `UNDER_FLOORS`, `GARAGE_VENT_WELL`, `DRIVEWAY`, spawn zones untouched) move together. Stair **run** lengths are derived from rise/going, not scaled.

### 5.3 Stairs (R5)
- Inventory needed (compare GLB + blueprints): main lobby U-stairs 1F↔2F; basement stairs from the lobby/kitchen side; NW exterior storage stairwell (B ↔ yard); **back entrance**: blueprint `3.webp` shows the octagonal back entrance (west, x ≈ 165–250, y ≈ 360–480) with flights going down **and** (2F `4.webp`, same spot x ≈ 250–300, y ≈ 360–480) a flight up — the "side stairs" must connect B ↔ 1F ↔ 2F (2F lands in the West Hall next to the Kid's Bedroom). Trace the actual flights from the GLB (`glb_faces.py` slabs on B1/1F/2F under the back entrance) and add the missing 1F → 2F flight + its stairwell hole in `wood_2f_*` floors.
- Verify: `walk.test.ts` "both ends of every staircase are reached upright" + "every flight walks end to end"; add a test that every floor is reachable from every other floor through the back entrance stairs.

### 5.4 South deck + porch roof (R7)
- `3.webp`: the back deck runs along the whole south façade (x ≈ 220 → 720 px, y ≈ 480 → 590 px), steps at its west end (x ≈ 220–245) and south (x ≈ 615–690). `4.webp` / `6.webp`: a porch roof (dark blue band) over it (x ≈ 465–725, y ≈ 520–600) reaching from under the **Kid's Bedroom** window to under the **Master Bedroom** window.
- Build: deck floor at 1F level (walkable, railings with gaps at the steps), posts, porch roof slab at 2F floor level (walkable, low parapet/edge, not a hard wall), the two 2F windows on that side as vaultable openings onto it. Rappel anchors on the roof edge.
- Verify: BFS — from inside the Kid's Bedroom, through its window, over the porch roof, into the Master Bedroom window (crouch/stand) — and from the deck to the kitchen back door.

### 5.5 Rooms and props (R6, R8)
- Re-trace every room from the blueprints at the new scale: B (`5.webp`): Storage, Training Room, Garage (car + boat), Laundry Room, side stairs; 1F (`3.webp`): Living Room, Lobby, Office (octagonal bay NE), Dining Room, Kitchen, Back Entrance (octagonal bay W); 2F (`4.webp`): Workshop, Upper hallway, Bathroom (octagonal bay NE), Kid's Bedroom, Walk-in, Master Bedroom. Wall types from the blueprint colours: red = line-of-sight (soft/semi), orange = breakable floor-trap/hatch areas (hatches: Living Room red square, Kitchen red square, 2F hallway red square, Master Bedroom red square).
- Props: size each from the GLB (`glb_faces.py` gives prop boxes) × the new scale; keep `clearance.ts` zones (doors 0.9 m each side, windows, vents) and add a **garage car clearance**: ≥ 1.0 m walkable on all four sides (R8) — `props.test.ts` should assert it.
- Verify per room with `walk.test.ts` (no sealed pockets, every room entered upright) and a top-down overlay: render the walk grid / colliders per floor with `tools/level/walkmap.ts` and composite it over the blueprint at the same scale (write the composite to the scratchpad and inspect).

### 5.6 Door → door connectivity (R4)
- New graph test: for every pair of doorways/openings on the same floor that the blueprint connects (and all stairs ends), BFS on the walk grid (stand, then crouch) must find a route; print the failing pairs with coordinates. Also every nav edge must exist on the grid (already tested) and every door must have both sides reached (already tested — extend to pairs).

### 5.7 Corners and Z-fighting (R10)
- The current approach trims overlaps where walls meet ("Z-fighting rules" in MapBuilder / `docs/QA.md` §3), which leaves notches at corners. Replace with:
  1. **Corner ownership**: at every L/T junction one wall runs through the corner (full thickness), the other stops at its face — no gaps, no overlaps, no notches. Generate this from the layout (sort walls per junction).
  2. **No coplanar faces by construction**: floor slabs end under walls (or walls sit on slabs, not both at the same top), soft panels are inset 1 cm from hard faces, trims/frames sit proud by ≥ 5 mm.
  3. Keep depth precision sane (`camera.near` 0.05, `logarithmicDepthBuffer` if needed).
- Verify with a test that scans the built meshes for coplanar overlapping faces (same plane within 1 mm, overlapping area > 1 cm², opposite or same normal) and fails on any; plus screenshots of each exterior corner.

### 5.8 Pitched roof (R20)
- `6.webp`: hip roofs — main ridge E–W over the centre, hips at the NW and SW wings, a conical/octagonal cap over the west bay, a small hip over the NE bathroom bay, lower porch roofs (north-east wraparound and the south deck). Build the roof as sloped planes (≈ 30–35°) on top of the 2F walls (eaves overhang 0.3–0.5 m), walkable where the slope allows (Rapier slopes ≤ 52° climbable), with rappel anchors at the eaves. Roof hatches/skylights only where the blueprint shows them (none).
- Verify: rappel from the ground onto the roof and walking along it (existing e2e "rappel from the ground onto the roof" must still pass), and a top-down render compared with `6.webp`.

---

## 6. Outdoors: terrain from the top view (R1–R3, R11)

### 6.1 Current state
- `src/map/Outdoor.ts` + `src/map/houseDatamap.ts` build the outdoors from the 512×512 datamap (`HOUSE_DATAMAP_512_B64`, channel legend + decoder) as **boxes** per cell zone (hence "voxel" terrain), with house cut-outs, garage ramp, vent well, foundation boxes.

### 6.2 Plan
1. **Ground truth from the image** `7.webp` (1600 × 900, north up): segment into classes by colour/texture — asphalt road (dark grey + yellow line), sidewalk/curb (light grey), grass (green), dirt/construction (tan), water (dark teal, right), docks/piers (grey slabs in the water), building roofs, trees (dark green blobs), vehicles. A small k-means / colour-threshold classifier is enough; hand-correct with polygons where needed. Register the image to game coordinates with ≥ 3 known points (house corners from `HOUSE_RECT` at the new scale, road corner, dock corner).
2. **Elevation**: build a height map from constraints, not from the image alone — road and sidewalks flat at their datum, the house yard ~0.3–0.5 m above the road (front steps), the **garage ramp** down to basement level on the east, the waterfront dropping to the docks (river ≈ −3 m), the construction site and the west grass gently varying. A monocular depth model (e.g. *Depth Anything V2 small*, Hugging Face `depth-anything/Depth-Anything-V2-Small-hf`, needs `pip install torch transformers` on CPU) can supply a low-frequency hint, but on an orthographic top view it mostly returns object heights (trees, roofs) — use it only as a hint and say so; the constraints decide. Check Hugging Face reachability through the proxy first (`curl -sS "$HTTPS_PROXY/__agentproxy/status"`).
3. **Geometry**: one smooth `HeightField` collider (Rapier `ColliderDesc.heightfield`) + a matching mesh (vertex colours per class), resolution ≈ 0.5 m; retaining walls / curbs only where the class map has a step; the house, garage ramp and NW stairwell are carved as before (`HOUSE_HOLES`).
4. **Props from the image**: trees, cars, APC, construction scaffolds, fences, boats placed at their image positions with real-size colliders (visual = collider, as `props.test.ts` checks indoors).
5. **Spawn zones free (R3)**: a keep-clear radius around each `SPAWN_ZONES` centre (≥ 4 m) and along the path from each spawn to the house; the APC moves out of the APC spawn's walk area.

### 6.3 Verification
- `walk.test.ts` already BFSes from the spawns; extend: every spawn has ≥ 3 m standing room in every direction, from every spawn the house's every exterior door/window/rappel point is reached, no step > 0.36 m that isn't a deliberate wall, slope ≤ 35° on walkable ground, and the "no bottomless holes" test.
- `locomotion.test.ts` style: walk the road → yard → ramp at constant pace.
- Top-down render of the height map + class map vs `7.webp` in the scratchpad.

---

## 7. Verification cycle and release (R15)

Per step: unit/graph test first (it must fail on the old state), then the change, then `npm test`, then a screenshot or top-down overlay where the result is visual. Per cycle: `npm run test:e2e` + `E2E_ONLINE=1 npm run test:scenarios`, then commit + push. Release: PR into `develop` → green CI → merge; release PR `develop` → `main` → green CI → merge (deploy job publishes `r6s-temu.pages.dev`); check the deployed bundle hash matches a local production build.

State cycles to keep green (E2E): menu → TH setup → prep (drone) → action → result → redeploy / change operator / main menu; TH missions per §4.3; PvP lobby → prep → action → round end → side swap → match end; dropped socket → resume (S5).

---

## 8. Test inventory touched in this session
`missions.test.ts` (round rules) · `rules.test.ts` (rappel view) · `locomotion.test.ts` (new) · `shield.test.ts` (placement, 1P/3P match, rounds) · `rig.test.ts` (new) · `walk.test.ts` (hole-edge cracks, from PR #9).
