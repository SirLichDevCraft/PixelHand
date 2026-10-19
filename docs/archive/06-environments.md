# 06 — Environments: tiles, props, scenes

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


Characters get all the attention, but a game is mostly ground, walls and props — and tiles fail in ways sprites do not.

## 1. Tileset construction

- **Base tile size** declared in the bible (16×16 typical; 32×32 for `sculpted-large`).
- **A tile is authored, not generated.** A seeded noise function produces the smooth monotone mush that ruins generated pixel art, so `stamp_pattern` and `fill_gradient` are scaffolding only and the audit warns when they cover more than a declared share of a tile.
- **Seamlessness is a test, not an intention.** `tile_edge_check` compares the right edge column against the left edge column and the bottom row against the top row of a candidate tile and reports the discontinuity in luminance and hue. A tile that "looks seamless" on its own and shows a visible seam when tiled four times is not seamless.
- **Variants are constrained.** 3–5 variants per ground type, differing in texture cluster placement and ramp step, **never** in hue or value mean. Variants whose mean luminance differs are the classic cause of a tiled floor looking like a patchwork.
- **Ramps are shared across the whole set.** One stone ramp, one grass ramp, one dirt ramp, used by every tile that names that material. Per-tile palettes are how a tileset stops looking like one place.

## 2. Autotiling

47-tile blob set (8-bit corner/edge bitmask), generated from authored base tiles plus hand-authored transition tiles, because the transitions are where the craft lives:

- grass→dirt, grass→water, stone→grass edges each get their own authored treatment: which material overhangs which, how the shadow falls, whether the edge gets a 1px lighter lip.
- The engine handles the **bitmask bookkeeping** (which of the 47 tiles a neighbour configuration selects) and I author the **47 tiles**. Getting that division backwards is what makes procedurally generated tilesets look procedural.
- `tileset_audit` checks: all 47 present, each tile's edges match its neighbours, no tile exceeds the palette cap, and the whole set passes `assert_style`.

## 3. Props and structures

- Props are authored at their real canvas size with the same anchor discipline as characters: a tree, a chest and a fence post all declare a **ground contact row**, so a scene can depth-sort them correctly and their contact shadows land on the same baseline.
- **Multi-tile props** (a 3×4 tree, a 2×2 well) are one sprite with a declared footprint, not a pile of tiles. The footprint drives occlusion and depth sorting.
- **Depth sorting is a data problem, not an art problem.** The engine exports footprints and contact rows; the game engine sorts. Getting this wrong in the art is unrecoverable, so it is declared in the manifest.
- **Lighting is authored, not filtered.** A torch does not get a brightness filter over nearby tiles; it gets ramp steps arranged in space — a warm-lit face on the near side of each prop, a cooler ramp step on the far side, and a contact shadow that reads as grounded.

## 4. Scene assembly and review

A scene is a composition of authored parts, and it is reviewed as a whole:

| Render | Question it answers |
|---|---|
| `game_scale` at 1× on the real tile background | does the character belong in this world? |
| `squint` at 50% | does the scene read at play distance? |
| `value_map` | is the scene's value structure coherent, or is it held together by colour? |
| `silhouette` | is the focal subject separable from its background by shape alone? |
| `tile_edge_check` across a 4×4 repeat | is the ground seamless? |

A scene that passes all five is done. A scene that passes only the first is a scene that will look wrong the moment the camera pulls back.

## 5. What a full game art set costs, honestly

For a small, complete, single-style game (one playable area, one character, a handful of enemies and props):

| Deliverable | Volume |
|---|---|
| Tileset | 47 autotile + ~20 variants + ~12 transitions |
| Props | 15–30 sprites |
| Player | 8 directions × 6 clips ≈ 128 cels |
| Enemies | 3–5 × (4–8 directions × 3–4 clips) ≈ 150–300 cels |
| UI/icons | 15–25 sprites |
| **Total** | **~400–600 authored cels** |

That is a multi-session project, which is precisely why the art directory is git-tracked text, why renders are budgeted, and why the audit and the export gate exist: so that asset 400 still matches asset 1.
