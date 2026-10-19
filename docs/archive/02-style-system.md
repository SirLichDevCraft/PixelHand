# 02 — The style system: one engine, every style, controlled per game

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


This is the part that answers "an engine that covers all styles of art, which the LLM controls on a per-game basis."

**A style is not a filter applied to finished art. It is a constraint set the engine enforces plus a derivation recipe the agent uses while drawing.** That distinction is the whole idea: a filter can make two sprites *look similar*; a constraint set makes them *be* a style, and makes deviation a build failure.

A bible is one **coordinate** in the nine-axis space specified in `docs/archive/08-coverage-matrix.md`. The examples below are coordinates, not a library.

---

## 1. Style bible schema

```jsonc
// art/styles/warm-topdown.json — warm, saturated, soft-edged top-down
{
  "id": "warm-topdown",
  "signature": "warm, soft-edged, saturated; chunky 2-3px clusters; no outline except against background",

  "canvas": { "tile": 16, "character": [16, 24], "frame": [64, 64], "baseline_row": 23 },

  "palette": {
    "size_cap": 24,
    "hue_shift": {
      "shadow":     "+18deg toward violet",
      "highlight":  "-12deg toward yellow",
      "rule": "raise saturation as value falls; never desaturate into grey"
    },
    "ramp": { "steps": 4, "value_curve": "compress darks", "min_step_delta": 6 }
  },

  "light": { "direction": "top-left 45deg", "ambient": "bounce from below at 30%", "rim": false },

  "outline": {
    "policy": "selective-dark", "thickness": 1,
    "color_role": "darkest ramp step, value -10",
    "forbidden_on": ["interior detail", "face features"]
  },

  "clusters": { "min_size": 2, "max_run": 6, "no_lone_pixels": true, "no_diagonal_only_joins": true },

  "dither": {
    "policy": "gradients-only", "patterns": ["2x2-bayer", "stochastic-15"],
    "forbidden_on": ["silhouette edge", "face", "1px details"]
  },

  "aa": {
    "policy": "ramp-adjacent-only", "max_per_edge": 1,
    "forbidden_on": ["1px details", "crosses a hue family", "concave corners"]
  },

  "detail_budget": { "max_colors_per_sprite": 14, "max_detail_px_per_16x16": 18 },

  "materials": {
    "skin":    { "ramp": 4, "hue_shift": "+6 toward red in shadow", "specular": "single 1px, cheek or nose only" },
    "cloth":   { "ramp": 3, "edge": "1px lighter top edge", "dither": "allowed" },
    "wood":    { "ramp": 4, "grain": "1px dark runs, max length 5, never parallel" },
    "stone":   { "ramp": 4, "hue_shift": "+20 toward violet in shadow", "texture": "2-3px clusters, on-ramp" },
    "foliage": { "ramp": 4, "hue_shift": "+10 toward yellow in highlight", "clusters": 3 },
    "metal":   { "ramp": 5, "specular": "hard 1px line, one per face", "hue_shift": "toward blue in shadow" },
    "water":   { "ramp": 4, "dither": "encouraged", "caustics": "2px light clusters" }
  },

  "motion": { "fps_default": 12, "walk_frames": 4, "bob_amplitude": 1, "subpixel": true }
}
```

```jsonc
// art/styles/flat-noir-highcontrast.json — flat planes, hard edges, silhouette-driven
{
  "id": "flat-noir-highcontrast",
  "signature": "flat planes, hard edges, high value contrast, no outlines, silhouette-driven",
  "palette": { "size_cap": 16, "hue_shift": "shadow to the complementary cool family", "no_dither": true },
  "outline": { "policy": "none" },
  "aa": { "policy": "silhouette-edge-only" },
  "clusters": { "min_size": 3 },
  "light": { "direction": "flat", "min_value_contrast": 45 },
  "detail_budget": { "max_colors_per_sprite": 8 },
  "motion": { "fps_default": 10, "walk_frames": 6 }
}
```

```jsonc
// art/styles/crisp-16bit.json — crisp 16-bit console look
{
  "id": "crisp-16bit",
  "signature": "crisp 32x32, 5-step ramps, hard specular lines, dithered skies, dark 1px edge",
  "canvas": { "tile": 16, "character": [24, 32], "frame": [48, 48] },
  "palette": { "size_cap": 32, "ramp": { "steps": 5, "value_curve": "linear" } },
  "outline": { "policy": "dark-edge", "thickness": 1 },
  "dither": { "policy": "encouraged-in-large-flats", "patterns": ["4x4-bayer"] },
  "motion": { "fps_default": 8, "walk_frames": 4 }
}
```

```jsonc
// art/styles/sculpted-large.json — sculpted, atmospheric, larger sprites
{
  "id": "sculpted-large",
  "signature": "64x64 subjects, 20+ colours, sculpted form, atmospheric depth",
  "canvas": { "character": [48, 64], "frame": [64, 64] },
  "palette": { "size_cap": 40, "ramp": { "steps": 6 } },
  "detail_budget": { "max_colors_per_sprite": 26 },
  "light": { "direction": "custom per sprite", "rim": true }
}
```

Four example coordinates ship initially, chosen because they are far apart. New ones are authored per project and then **frozen**. There is no closed set: any point in the nine-axis space is expressible, and `docs/08` lists the points that must work for the engine to be called complete.

**These are original constraint sets assembled from general technique.** Each is named for what it *does*, never for what it resembles, and every palette in them is derived from declared base hues rather than sampled from any existing game. See `docs/archive/07-provenance.md`.

---

## 2. What the engine enforces

`assert_style` fails an asset. Not warns — fails. Each failure carries coordinates and the fix tool.

| Rule | Catches |
|---|---|
| `off_ramp_colour` | a colour that is not in the declared palette/ramp |
| `ramp_collapse` | two adjacent ramp steps that resolved to the same RGB |
| `lone_pixel` | a pixel with no same-colour neighbour |
| `diagonal_only_join` | two regions touching only at a corner — reads as a break |
| `cluster_min` / `max_run` | detail too noisy, or a flat run too long for the style |
| `jaggies` | a diagonal whose step pattern breaks the style's slope policy |
| `aa_across_hue_family` | anti-aliasing that muddies two materials |
| `dither_on_edge` | dithering on a silhouette or a face |
| `palette_cap` | too many colours in one sprite |
| `detail_budget` | a small sprite trying to be a large sprite |
| `anchor_drift` | the sprite's foot baseline moved between frames |
| `silhouette_delta` | a frame whose silhouette jumped unexpectedly |
| `light_direction` | shading whose brightest cluster is not on the declared light side |

The last three are the ones that separate a good still sprite from a good *animation*, and they are exactly the failures my Phase 0 walk cycle committed.

---

## 3. Palette and ramp engine

**Hue shifting is the single highest-leverage craft rule in pixel art.** Shadows desaturating toward grey is what makes generated pixel art look dead. The engine makes the good version the easy version:

- `create_ramp(base, steps, hue_shift, value_curve)` walks hue *and* value together. A warm-topdown stone ramp goes warm mid → violet-shifted dark, never brown → grey.
- `min_step_delta` refuses a ramp where two steps are visually identical — a ramp that looks like 4 steps but is really 3 is a silent quality loss.
- `quantise_to_palette` maps imported or filtered art onto the declared ramps and reports the worst-case delta, rather than silently inventing colours.
- `gradient_map` re-keys existing art onto a ramp. This is how a palette swap or a per-game re-skin is done without redrawing.
- **No brightness/hue/saturation filters.** A filter moves every pixel off the palette. `paint_form`, `specular_pass`, `contact_shadow`, `cast_shadow` and `glow` all move pixels *along* ramps instead — which is why a glow in this engine is built from ramp steps arranged in space rather than from blended alpha, and a shadow is ramp steps rather than multiplied alpha.

---

## 4. The coordinate declaration ritual (per project)

This is how "the LLM controls style per project" actually plays out. It is a fixed procedure, and it is short. But note the ownership: **the coordinate is populated by your decisions, not by my guess.** `docs/archive/11-collaboration.md` is the mechanism; this section is where it plugs into the pipeline.

**Step 1 — Converge on a coordinate.** Nine axes from `docs/08`: projection, art scale, palette magnitude, temperature model, edge policy, shading model, detail density, motion model, mood. A project may supply some of them. For the rest, `style_options` presents **three concrete variants along one axis** and you pick or reject — because people cannot describe a style, but they can recognise one. Each pick or rejection is recorded as a delta. 3–6 rounds, one axis per round, then the coordinate is yours. Answers become `art/project.json` and `art/taste.json`.

**Step 2 — Validate the coordinate.** The engine refuses impossible combinations up front (2px outline on 8×8, dither under 2-value shading, hyper-detail on a 16×16 subject) rather than letting 300 cels be drawn into a contradiction. Anything the engine refuses is a signal that the coordinate needs a decision, not a workaround.

**Step 3 — Candidate coordinates.** Where the coordinate is not already pinned by the project, I author 2–3 candidate bibles, each with a palette, ramps, light model and material recipes — derived from declared base hues, never sampled from an existing game. They are presented to you as an option set, not as a recommendation.

**Step 4 — Calibration trio.** For each candidate I draw the same three test assets:
1. a **lit cube and a lit sphere** — proves the ramp and light model,
2. a **foliage clump and a stone** — proves the material recipes and texture policy,
3. a **character head + torso** — proves skin, cloth, hair and the face-detail budget.

**Step 5 — Four renders per candidate.** `view` (labelled), `silhouette` (is it readable as a shape?), `squint` (downscaled 50% — does it survive game scale?), `value_map` (grayscale — is the *value* structure correct independent of hue?). A candidate that fails `silhouette` or `value_map` is dead regardless of how pretty the colour is.

**Step 6 — You choose; I translate.** Each candidate is presented as a `review_pack`: one image, ≤ 3 options, ≤ 2 questions, on the calibration assets, at silhouette *and* game scale. I report what the measurements say is wrong in each (ramp conformance, silhouette stability, negative space, detail budget, anchor drift) so your choice is informed rather than vibes-based — but the choice is yours. Vague feedback ("make it pop") is translated into 2–3 concrete candidate changes and put back to you; it is never guessed at. Maximum six rounds total, then it locks.

**Step 6b — Style signature.** Before freezing, `style_signature` writes the style in plain language — not JSON — and you confirm or correct it. If the paragraph does not read like the game in your head, the coordinate is wrong, and fixing it here costs nothing compared to fixing it after 400 sprites.

**Step 7 — Freeze.** The chosen bible is locked, along with `art/taste.json` — the accepted and rejected patterns that got us there, so a future session resumes with the style established instead of re-deriving it. `assert_style` runs on every asset from then on. Adding a colour to the palette requires an explicit amendment, which re-runs `regression_check` across existing assets. This is the defence against the slow style drift that ruins long generated projects.

**Step 8 — One animation smoke test.** Before any production asset is drawn, a 4-frame walk on the calibration character runs through `loop_validate`. Style that only works on stills is not a style.

---

## 5. Style portability

Because cels are palette-indexed and styles are declarative:

- **Re-skin is cheap.** Swap the palette and re-key the ramps with `gradient_map`; the authored pixel intent is preserved. Same sprite, different game.
- **Scale migration is explicit, not automatic.** Moving a 16×16 design to 32×32 is a *redraw* with a higher detail budget, not a resize. The engine refuses to upscale art and says why.
- **A style is a file.** Two games in one repo share the engine and carry different bibles. Assets declare which bible they belong to, so a cross-style mistake is caught rather than shipped.
