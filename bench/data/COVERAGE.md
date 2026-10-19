# Coverage authoring contract (Phases 7–8)

How a coverage coordinate is authored, measured and reported in this repo. Read this before
writing any `bench/coverage/tN.js`. Every claim you return must be a number the engine produced.

## 1. The module contract

`bench/coverage/<id>.js` exports one object. The aggregator `bench/gate8-coverage.js` requires
every module in the directory, runs `run()`, prints the claims and writes `out/gate8-report.txt`.

```js
"use strict";
module.exports = {
  id: "T5",                                   // or "P7" for the Phase 7 volume gate
  title: "128x128 isometric structure + full 47-tile autotile set",
  proves: "projection handling and environment scale",   // docs/08 §4 wording
  claims: [                                   // written BEFORE the work, one string per claim
    "the structure converges on the declared vanishing point",
    "all 47 autotile slots are authored and tileset_audit reports the set complete",
  ],
  run,                                        // (ctx) => result
};

function run(ctx) {
  const { T, OUT, say } = ctx;                // T = TOOLS registry, OUT = out/gate8/<id>/
  // ... declare, author, measure, render ...
  return {
    claims: [{ claim: "...", ok: true, evidence: "measured text with numbers" }],
    artifacts: ["art/coverage/t5/...", "out/gate8/t5/..."],
    notes: ["what is weak, stated before someone asks"],
  };
}
```

Rules the aggregator enforces on you:

- Every claim in `claims` must appear in the returned `claims` array with the same wording.
- A claim that did not pass stays `ok: false` with the measurement that says so. **Never delete a
  claim because it failed.** An honest failure outranks a comfortable pass — see PLAN.md Phase 2.
- `run()` must be re-runnable from clean state. It may `fs.rmSync(OUT)` but never anything under
  `art/`. Committed grids are re-authored byte-identical on a clean run: no drift.
- No third-party assets, ever (`docs/07`). `import_png` is quarantined and never counts as authored.

## 2. Declaring a coordinate (no preset)

Each coverage module declares its **own** style id and its own palette. That is what "produced
with no preset, purely by declaring a coordinate" means, and the aggregator checks it: the style
id must be unique to the module and must not exist in `art/styles/` beforehand.

```js
const STYLE = {
  id: "t5-quarry", projection: "iso-21", art_scale: 128, palette_size: 48,
  temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "static", mood: "melancholy", light_vector: [-0.7, -0.7],
  // perspective coordinates must additionally declare horizon + vanishing (+ focal/eye where used):
  // horizon: 150, vanishing: [300, 150], focal: 90, eye: 1.62, depth_cueing: "value",
};
T.project_init.run({ root: OUT, game: "t5", style: STYLE, canvas: { w: 128, h: 128 }, fps: 8 });
T.palette_set.run({ id: "t5", spec: { ramps: {...}, single: {...} } });
```

All nine axes are required and each has a closed domain — `src/core/style.js` L6-18. Impossible
combinations are refused at declaration (L23-52): read that list before choosing, and if the
gate needs an impossible coordinate, prove the refusal on purpose and report it as a control.

Palette spec shape (`bench/gate2-style.js` L40-70 is a worked example):

```js
{ ramps: { steel: { role: "material", colors: ["#1b2430","#33455c","#5d7a95","#8fa9bd"] }, ... },
  single: { glint: { rgb: "#f2e7c9", role: "light" }, outline: { rgb: "#10161d", role: "outline" },
            contact: { rgb: "#241f1c", role: "shadow" }, buckle: { rgb: "#c9922f", role: "accent" } } }
```

A palette ramp with fewer than 3 steps is exempt from `flat_mass` on purpose (a 2-step material
cannot be modelled further) — but craft_targets still wants the declared minimum.

## 3. Authoring pixels

Two legitimate routes, both hand-placed. Nothing procedural for organic form (docs/09 §1).

**A. Authored grid + the shared lighting model** — this is what Phases 3–6 use:

```js
const { authorAsset, padGrid } = require("../../src/author.js");
const rows = [".####.", "#ABBA#"];                    // '.' air, letters mapped to materials, '+' focal accent
const { cel, regions, modelled } = authorAsset(padGrid(rows, W, H, dx, dy), {
  palette, paletteId: "t5", name: "t5.prop", map: { A: "steel", B: "rope" },   // or {material:"steel", role:"accent"}
  light: STYLE.light_vector, soleColor: "contact", outline: { policy: "selective-dark" },
});
```

Each region is lit across its **own filled extent**, seams are bridged, singletons repaired.
`outlineEdge` outlines only where a form opens on the shadow side.

**B. Tool-by-tool authoring** (`sprite_create`, `draw_pixel_map` with a `legend`, `put`,
`fill_region` scaffolding, `paint_form`, `aa_pass`, `outline_pass`, `glow`, `contact_shadow`).
`draw_shape` / `draw_line` are scaffolding: a shape-dominated sprite is flagged as a defect.
Never use brightness/hue/saturation filters — they do not exist in this engine.

Rigged animation (docs/03): `rig_create`, `pose_define`, `skin_define`, `clip_create`,
`clip_set_frames`, `timing_apply`, `direction_derive` (a derived diagonal is a draft, cardinals
are authored), then `loop_validate`. `src/pim.js` + `bench/gate3-walk.js` is the worked example
of authored parts, per-facing stride mods and authored durations. A hold is a longer duration,
never a duplicated frame. `loop_validate` refuses: foot baseline drift >1px, centre shift >3px,
area swing >28%, >10 part collisions, a stuttering loop seam, pixel-identical duplicate frames,
wrong pose order, and a walk with fewer than two moving arm parts.

## 4. Measurement you must run on every asset

```js
T.audit.run({ cel, style: STYLE.id })            // zero findings of severity "error"
T.assert_style.run({ cel, style: STYLE.id, asset_class: "character" })
T.craft_targets.run({ cel, style: STYLE.id })    // the external bar as numbers, src/core/regression.js L82-91
T.view.run({ cel, zoom: 12 }); T.silhouette.run({ cel }); T.squint.run({ cel }); T.value_map.run({ cel })
```

For animation also `contact_grid` (rows = directions), `play` (GIF at real fps) and
`export_gate`. For tiles also `tileset_audit`, `tile_edge_check`, `tile_repeat`, `variant_lint`.
For projected structures also `depth_audit` (all five sub-audits) and `faces_declare`/`face_shade`.

The audit is not decoration: it caught six engine defects in Phase 6 and four design defects in
Phase 3 stage 2. If a rule fires, fix the design or record why the rule is wrong — and if you
find an engine defect, say so in `notes` rather than working around it silently.

## 5. Committing the art

Committed grids go under `art/coverage/<id>/` as `.grid` text files (git-diffable, human-editable).
Renders and reports go under `out/gate8/<id>/`. Report paths in `artifacts`.

## 6. What to report back

Return from `run()` and also write a short summary of: measured numbers per claim, what is weak,
and anything the engine got wrong. "It audited clean and still looked wrong" is a finding worth
more than a clean pass.
