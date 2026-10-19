# 05 — Measurement, testing, export, risk register

## 1. The audit rule set (deterministic critic)

No automated visual critic exists on this setup — `models.getAvailableOfType` returned **0 classifiers and 0 image models**. So the critic stack is exactly two things, and both are load-bearing:

1. **`audit`** — deterministic rules, run by the engine, every write.
2. **Me** — judgement renders (`silhouette`, `squint`, `game_scale`, `value_map`, `contact`, `play`).

Rules, grouped. Each violation returns coordinates **and the tool that fixes it**.

### Structure
`lone_pixel` · `diagonal_only_join` · `cluster_min` · `max_run` · `disconnected_region` · `transparent_hole` · `jaggies` · `edge_run_length`

### Colour
`off_ramp_colour` · `ramp_collapse` · `palette_cap` · `aa_across_hue_family` · `dither_on_edge` · `dither_in_flat` · `light_direction` (brightest cluster must sit on the declared light side) · `value_contrast_min`

### Style conformance
`outline_policy` · `aa_policy` · `detail_budget` · `material_recipe` (a material drawn without its declared ramp/texture signature)

### Sprite
`bbox_drift` · `anchor_drift` · `pivot_offset` · `canvas_overflow` · `symmetry_violation` (for parts declared symmetric)

### Animation
`silhouette_delta` · `silhouette_merge` · `centroid_jump` · `wrap_frame_duplicate` · `pose_held_by_duplication` · `placeholder_timing` · `missing_opposing_motion` · `frame_count_mismatch_across_directions` · `phase_offset`

### Pipeline integrity
`edit_noop` (`changed.pixels: 0` is a failure, not a success) · `region_out_of_bounds` · `selection_excluded_everything` · `scoping_collided` (a colour-distance scope caught a neighbouring material)

---

## 2. Test harness — because Phase 0 found two silent codec bugs

Round-trip testing caught a wrong-direction `Buffer.copy` and a dropped row offset in the upscale. Both were invisible in normal use and both would have corrupted every asset. The engine ships with these tests before it ships with features.

| Test | Asserts |
|---|---|
| **codec round-trip** | encode→decode is byte-identical for colour types 0/2/3/4/6, all five filter types, indexed palettes with `tRNS`, 1×1 and non-square canvases |
| **indexed fidelity** | a cel written, exported to indexed PNG, re-imported, and quantised returns the identical palette indices |
| **upscale correctness** | every screen block equals its source art pixel exactly; no bleed at block boundaries |
| **celformat round-trip** | grid text → buffer → grid text is identical, including transparent rows and trailing whitespace |
| **audit fixtures** | a corpus of deliberately bad sprites (the Phase 0 walk cycle is one) each producing the expected violations |
| **golden renders** | frozen renders of **our own approved assets** — the bar is internal, never a borrowed picture; a diff is a reviewable change, never a surprise |
| **loop fixtures** | known-bad cycles: merged legs, detached torso, duplicated wrap frame, uniform timing |
| **style fixtures** | the same sprite validated against three bibles; each must pass its own and fail the others' distinctive rules |

The bad-sprite corpus matters as much as the good one. A rule that never fires on a known-bad input is not a rule.

---

## 3. Export

### Sprite sheet
Rows = directions in the frozen declared order. Columns = frames in clip order. Padding, spacing and origin configurable per target engine.

```jsonc
// art/export/hero.json
{
  "image": "hero.png",
  "frame": { "w": 16, "h": 24 },
  "directions": ["S","SE","E","NE","N","NW","W","SW"],
  "clips": {
    "walk":   { "fps": 12, "rows": { "S": [0,1,2,3], "E": [8,9,10,11] },
                "events": { "1": "footstep", "3": "footstep" } },
    "idle":   { "fps": 10, "rows": { "S": [0,1], "E": [2,3] } },
    "attack1":{ "fps": 15, "rows": { "S": [0,1,2,3,4] },
                "events": { "2": "hitbox_active" } }
  },
  "anchor": { "x": 8, "y": 23 },
  "subpixel": true,
  "style": "warm-topdown",
  "palette": "cozy-24"
}
```

Targets: **Godot** (SpriteFrames), **Phaser** (frames + animations), **Tiled** (tileset TSJSON), **Aseprite-compatible** sheet layout (so the user can open and polish in whatever editor they choose), and a plain generic manifest. Plus GIF/APNG previews for review, and indexed PNG for the engine itself. These are output *formats* only — no third-party code, assets or palettes enter the project because we can export to them.

Every manifest carries the computed `provenance` block from `docs/07-provenance.md`: authored_by, directed_by, engine version, style bible, palette file and origin, `imported_pixels`, `generative_model_used`, and the source list. `export_sheet` refuses to include a quarantined cel unless `allow_imported: true` is passed explicitly.

Export is gated: a clip that fails `loop_validate` or `assert_style` cannot be exported. The gate is the point — it is what stops a long project from shipping its own drift.

---

## 4. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **Silent data corruption in the codec/renderer** | High — already happened twice in Phase 0 | Round-trip + golden tests from day one. Never trust a render that has not been round-tripped. |
| **JPEG re-encode destroys fine detail** | High | Zoom policy (Z 8–40), ≥2px guides, mid-grey/checkerboard backgrounds, limited palette in inspection renders, `chunk` views for fine work. |
| **My spatial addressing without labels** | High — measured failure | Burned-in coordinates on every render, plus the paired text grid. Never ask myself to name a cell from an unlabelled image. |
| **Formula-generated art that looks generated** | High — the defining failure mode | `draw_pixel_map` as the primary authoring primitive; `draw_shape` warns when it covers too much of a sprite; audit flags smooth monotone surfaces. |
| **Animation collapsing into sliding rigid shapes** | High — my own Phase 0 attempt | Rig + key poses, mandatory opposing motion, `loop_validate` as an export gate, silhouette contact sheets. |
| **Style drift across a long project** | Medium-High | Locked bible per game, `assert_style` on every asset, palette amendments are explicit and trigger `regression_check`. |
| **Context exhaustion** | Medium-High | Chunked re-renders, diff-over-view, contact sheets, text-first iteration, render cache by content hash, assets split across sessions with git-tracked text cels. |
| **MCP image transport unverified** | Medium | Spike first; verified `read`-the-PNG fallback; engine identical either way. |
| **No automated visual critic available** | Medium | Deterministic audit carries the mechanical load; judgement renders carry the aesthetic load. Re-check model availability periodically. |
| **MCP process dies mid-session** | Low | Disk is the source of truth; every cel is a text file; undo history is reconstructible from snapshots. |
| **Windows path / encoding quirks** | Low | Absolute paths, forward slashes in JSON, UTF-8, no shell interpolation of grid text (grids go through tool args, never heredocs). |
| **Third-party art contaminating the asset set** | High for publishing | `docs/07-provenance.md`: no third-party assets stored in the repo at all; `import_png` requires declared provenance and quarantines; provenance metadata computed from edit history and shipped in every manifest; palettes derived from declared base hues, never sampled. |

---

## 5. Immediate next actions, in order

1. **Spike (30 min).** 60-line MCP server returning one image block. Add to `mcp.json`, `/reload`, call it. Settles the transport question.
2. **Codec + tests.** Promote `probe/png.js` to `src/codec/png.js`, add the full round-trip suite. It already works; it needs coverage so it stays working.
3. **Buffer + celformat + `get_pixel_map` / `draw_pixel_map`.** The core pair.
4. **`view` with labels, grid, legend, render stamp.** Reuse the probe's label renderer and fix the font scale.
5. **`audit` v1** — structure + colour rules only. Enough to gate Phase 1.
6. **Phase 1 gate:** the 16×16 potion, ≤25 calls, zero violations, survives my own `game_scale` review.
7. **Then style bibles** (Phase 2), because the potion proves the body and the three-style version proves the brain.
