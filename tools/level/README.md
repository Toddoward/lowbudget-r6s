# House level pipeline (GLB → `src/map/houseLayout.ts`)

The few-shot House is traced from the Sketchfab tactical model
*"Rainbow Six Siege - House Map"* by **crusader1291** (`.glb` / `.blend`, not
redistributed here — download it yourself). That model is an *exploded tactical
diagram*: the floors float apart, interior walls are shorter than exterior
ones and everything is scaled down, so the game does not load it directly.
These scripts turn it into plan data that the hand-annotated layout uses.

| Step | Script | Output |
|---|---|---|
| 1. Flatten the node tree (floor-local transforms, Z-up) | `python3 glb_extract.py house_map.glb` | `tris.json` (triangles per node, per material) |
| 2. Slice every floor at door height and pair opposite wall faces into slabs | `python3 glb_faces.py` | `faces.json` (axis-aligned wall slabs + diagonal segments, hard/soft source) |
| 3. Plot in game coordinates (×2.85, +X east, −Z north) with a 1 m grid | `python3 glb_plot.py 1F` | `real_1F.png` (also `B1`, `2F`) |

Why face pairing: the model's wall shells are not closed per mesh (shared faces
between `_0` hard and `_1` soft meshes are deleted), so polygon filling gives
garbage. Pairing each wall face with the opposite-facing face 1–14 cm (model
units) away recovers clean slabs. B1 and 2F have inverted triangle winding; the
script auto-detects orientation per floor.

## Mapping rules applied in `houseLayout.ts`

- **Scale:** plan × 2.85 (≈ 32.4 × model local units) → building ≈ 19.3 × 14.3 m.
- **Restack:** B −3.5, 1F 0, 2F +3.5, roof +7.0 (3.2 m ceilings + 0.3 m slabs).
- **Materials:** `*_0` (`None`, white) → HARD; `*_1` (`hard_barricade`, brown — misnamed) → SOFT panels.
  The spec's semi-breach list overrides both (lobby side walls, office west wall,
  kitchen west wall, walk-in closet north wall, all 1F/2F wooden floors).
- **Hatches:** `Cube`, `Cube.001` (1F floor) and `Cube.002`, `Cube.003` (2F floor).
- **CCTV:** the six `Cylinder*` nodes become small destructible cameras (exterior ones on poles).
- **Barricades:** `Cube.004/.011/.014` components. The two whose bottom edge floats
  above the floor are the exterior **doors** (front N, back S) — the model
  already encodes the door bottom gap; the rest are windows. 1F: 10 windows +
  2 doors, 2F: 12 windows + 1 unboardable open window (right above the front door).
- **Added (not in the model):** 6 drone vents, door-barricade bottom gaps (19 cm),
  stair flights (the model only has landing blocks), props and ammo crates.
