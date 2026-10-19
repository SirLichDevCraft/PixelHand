# 01 — Architecture, data model, tool surface

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


## 1. Layout

```
PixelHand/
  probe/                      # Phase 0 evidence (exists, runnable)
  src/
    codec/png.js              # verified zero-dep PNG encode/decode (indexed + RGBA + all filters)
    core/buffer.js            # palette-indexed cel: Int16Array, -1 = transparent
    core/celformat.js         # text grid <-> buffer, RLE, diff, patch, undo
    core/palette.js           # palettes, ramps, hue shift, quantise, gradient map
    core/ops.js               # put, pixel_map, fill, line, shape, aa, dither, outline, specular
    core/rig.js               # joints, poses, per-direction anchors, skinning
    core/clip.js              # clips, frames, durations, events, direction rows
    core/audit.js             # rule engine -> violations with coordinates + the tool that fixes them
    core/render.js            # the 11 view modes, label font, guides, legends
    core/export.js            # sheets, manifests, GIF/APNG, indexed PNG
    cli.js                    # every capability, always reachable
    mcp.js                    # thin wrapper; `direct` exposure for the ~12 hot tools
  art/                        # the game art itself — git-tracked text files
    project.json
    styles/<style-id>.json
    palettes/<name>.json
    sprites/<name>/sprite.json
    sprites/<name>/cels/<cel-id>.grid
    rigs/<name>.json
    clips/<name>.json
    export/                   # generated, never hand-edited
  test/
    codec.test.js  audit.test.js  render.test.js
    golden/                   # frozen reference renders
```

**Zero dependencies in the core.** `zlib` is the only Node import the codec needs. The MCP wrapper may use the official `@modelcontextprotocol/sdk` (verified installable here, v1.32.1). If the SDK is ever a problem, the CLI path is complete on its own.

---

## 2. The cel format — the most important decision in the project

Palette-**indexed**, never RGB. A cel is an `Int16Array` of palette indices (`-1` = transparent), persisted as a text grid:

```
# cel: hero/walk/down/f0    16x24    palette: cozy-24    anchor: 8,23
................................
................................
......333333333333333333........
......344444444444444443........
.......4444444444444444.........
.........555555555555...........
........55555555555555..........
................................
```

`.` transparent, `0-9a-z` palette index (base36; two tokens if the palette exceeds 36).

Why this format and not something clever:

- **It is the format I can think in.** 24 rows of 24 characters is a considered sprite. A coordinate list is not — a coordinate list invites a formula, and a formula produces the smooth monotone surfaces that make generated art look generated. This is the single most important lesson from Phase 0, reached here by my own failed walk cycle and independently by prior agent pipelines in this space.
- **It is the same coordinate-addressed channel** that made my spatial reading exact in probe test 6.
- **Git diffs it meaningfully.** A sprite change is reviewable as text.
- **Indexed colour makes palette discipline structural**, not advisory: an off-palette pixel is not expressible in the format.
- **It round-trips to indexed PNG**, which is what game engines actually want.

### Sprite document

```jsonc
// art/sprites/hero/sprite.json
{
  "id": "hero",
  "style": "warm-topdown",
  "palette": "cozy-24",
  "canvas": { "w": 16, "h": 24 },
  "anchor": { "x": 8, "y": 23 },          // foot baseline, locked for every cel
  "layers": [
    { "id": "body",  "z": 0 },
    { "id": "cloth", "z": 1 },
    { "id": "hair",  "z": 2 },
    { "id": "held",  "z": 3 }             // weapon, may pass in front of or behind body
  ],
  "rig": "hero-rig",
  "directions": ["S", "SE", "E", "NE", "N", "NW", "W", "SW"],   // frozen row order
  "clips": ["idle", "walk", "run", "attack1", "hurt", "death"],
  "cels": { "walk/S/f0": "cels/walk-S-f0.grid", "...": "..." }
}
```

Direction row order is **frozen at creation**. Engines do not know what a row means; the manifest and the state code do. Changing it later silently breaks every consumer.

---

## 3. Tool surface

138 tools. Fifteen of them are hot enough to deserve `direct` exposure (marked ★): the ones whose result is an **image I have to look at**, which the MCP server returns inline instead of making me fetch it. The rest are `codemode`-exposed and reachable from scripts, which is the right place for batch edits where the raw output should be filtered before it reaches me — including the authoring pair (`get_pixel_map` / `draw_pixel_map`), whose results are text and cheap.

### Project & style
| Tool | Args | Returns |
|---|---|---|
| `project_init` | `game, style, canvas, directions, fps` | project id, resolved conventions |
| `project_open` | `root` | opens an existing project without overwriting it; resets warm state |
| `style_list / style_load` | `id?` | bibles |
| `style_create` | `id, bible` | validated bible, or the exact fields that are inconsistent |
| `assert_style` | `sprite, cel?, style?` | pass/fail + every violation with coordinates |

### Collaboration — the art-direction loop (`docs/11`)
The hot loop is not draw→audit→draw. It is **propose → you react → record the delta**, and it is how the style coordinate gets populated in the first place.
| Tool | Args | Returns |
|---|---|---|
| ★ `style_options` | `axis, count: 3, subject` | one labelled A/B/C contact sheet + the axis value each option represents |
| `style_pick` | `option: A\|B\|C, note?` | the recorded delta on the coordinate |
| `style_reject` | `option?, reason` | the constraint derived from the rejection |
| `style_translate` | `plain_language: "too muddy"` | the specific rule changes it implies, each demonstrated in a render |
| ★ `review_pack` | `subject, options, stage: silhouette\|shaded\|game_scale\|playback` | one image, ≤ 3 options, ≤ 2 questions answerable in seconds |
| `style_signature` | `style` | the plain-language style description, for you to confirm or correct |
| `taste_read` / `taste_write` | — | the persistent preference record in `art/taste.json` |
| `compare` | `a, b` | side-by-side plus a changed-pixel report |
| `annotate` | `subject, notes: "x,y: too dark"` | applies your notes as authored pixel edits |
| `sketch_analyse` | `path, provenance: user-owned` | measured shape properties — silhouette, negative space, cluster stats. Never a trace |

### Palette & ramps
| Tool | Args | Returns |
|---|---|---|
| `palette_get / set` | `id, colors?` | palette with roles |
| `create_ramp` | `base, steps, hue_shift, value_curve` | ramp; reports `distinct` and warns when two steps collapse to one colour |
| `ramp_between` | `from, to, steps` | ramp |
| `quantise_to_palette` | `source, palette, dither?` | mapping + worst-case delta |
| `palette_audit` | `sprite` | usage counts, off-ramp colours, palette-cap violations |

### Sprite lifecycle
`sprite_create` (`id, w, h, anchor, style, palette, layers`) · `sprite_info` · `sprite_delete` · `resize_canvas` · `layer_add/remove/reorder/opacity`

### Painting — the hand-placement primitives
| Tool | Args | Notes |
|---|---|---|
| `get_pixel_map` | `sprite, layer, region, format: map\|rle\|json` | **the read half of the core pair** |
| `draw_pixel_map` | `sprite, layer, origin, map: [".aa.", ...]` | **the write half.** This is how I author art. A map that overflows the canvas, uses a character outside the charset, or names a colour the cel's palette does not have is refused **whole**: a half-applied map leaves a cel holding indices the palette has never heard of. |
| `put` | `sprite, layer, cells: "x,y,idx;..."` | surgical single-pixel fixes |
| `fill_region` | `sprite, layer, region\|flood, idx` | |
| `draw_line` | `p0, p1, idx, aa?, slope_policy` | slope-aware: 1:1, 2:1, 3:1 with cluster control, so diagonals have no jaggies |
| `draw_shape` / `stroke_shape` | `shape, idx` | **scaffolding only** — audit warns when a shape covers more than N% of a sprite, because organic form must be authored |
| `paint_form` | `sprite, layer, region, ramp, light_dir, form: sphere\|cylinder\|box\|cloth` | lights a flat region **along the ramp**. Never a brightness filter: a filter moves pixels off the palette; this moves them through it |
| `aa_pass` | `sprite, layer, region, policy` | ramp-adjacent pixels only, convex corners only |
| `dither_pass` | `sprite, layer, region, pattern, density` | |
| `outline_pass` | `sprite, layer, policy, color_role` | selective / full / none |
| `specular_pass`, `contact_shadow`, `cast_shadow`, `glow` | region + ramp | all built from ramp steps arranged in space, never from alpha blending |
| `shift_along_ramp`, `replace_color`, `erase` | | |
| `mirror`, `transform` | `axis, region` | side-view mirroring only after an asymmetry audit (a sword on the right hip ends up on the left) |

### Cels, cels, cels
`cel_copy` · `cel_offset` (per part, foot baseline locked) · `cel_link` (share a cel across frames to save work) · `cel_set_opacity` · `undo` / `redo` · `snapshot` / `restore`

### Animation
See `docs/archive/03-animation.md` for the semantics.
`rig_create` · `pose_define` · `skin_pose` · `clip_create` · `clip_set_frames` · `timing_apply` · `direction_derive` · `loop_validate` · `smear_frame` · `hit_flash` · `impact_squash` · `event_add` · `clip_info` · `clip_list`

### Tiles, structures and parts — the volume problem (`docs/06`)
`autotile_index` (47-tile blob set) · `tile_edge_check` (material breaks across a seam) · `variant_lint` (two variants that are secretly identical) · `tileset_audit` · `tile_repeat` · `structure` · `part_add` · `part_list` · `assemble` (parts → composed cel) · `family_audit` (shape families, measured) · `batch_relint` · `tier_policy` (hero / support / background / system budgets)

### Scenes (`docs/06`)
`scene_create` · `scene_place` · `scene_review` · `ambient_rederive` — an ambient re-keys the **palette**, it does not repaint the art. The authored grid is untouched; darker steps are claimed harder than lit ones, which is what keeps a ramp readable under a new light.

### Coverage & meta
`coverage_report` (docs/08: which capability has been exercised on real art) · `tools_list` · `session_stats` (renders used, authored pixels, tool calls) · `provenance` (computed from edit history, never asserted)

### Seeing — the heart
See `docs/archive/04-vision-loop.md` for the full spec of each mode.
`view` ★ · `chunk` ★ · `contact_sheet` ★ · `contact_grid` ★ · `onion` ★ · `play` ★ · `silhouette` ★ · `squint` ★ · `value_map` ★ · `game_scale` ★ · `diff` ★ · `heatmap` ★

`view` is the workhorse and always returns **three things together**: the image, the coordinate-addressed text grid, and the audit/metrics. Never one without the others.

### QA
★ `audit` (`sprite, cel?, rules?` → violations, each with coordinates **and the name of the tool that fixes it**) · `assert_style` · `regression_check`

### Import / export
`import_png` (`path, quantize_to_palette, provenance` — **required**, and the result is quarantined; see `docs/archive/07-provenance.md`) · `export_sheet` (`sprite, layout: rows=direction cols=frame, out`) · `export_manifest` (`engine: godot|phaser|tiled|aseprite|generic`) · `export_gif` · `export_indexed_png` · `export_tileset` · `export_harness`

`export_gate` sits in front of all of them: a clip that fails `loop_validate` or `assert_style` cannot be exported. That gate is the point of having an engine at all — it is what stops a long project from shipping its own drift.

---

## 4. Why the tool results are shaped the way they are

Every result that describes a sprite carries the same top-level keys:

```jsonc
{
  "ok": true,
  "changed": { "pixels": 14, "added": 6, "removed": 2, "repainted": 6 },
  "region": { "x0": 4, "y0": 10, "x1": 11, "y1": 17 },
  "violations": [ { "rule": "lone_pixel", "at": [7, 12], "fix": "put" } ],
  "warnings": [ "draw_shape covered 61% of the sprite; organic form should be authored" ]
}
```

Three rules, each earned by a Phase 0 finding or by prior art's documented pain:

1. **"Nothing changed" is reported loudly.** An edit that hit the wrong layer, fell outside a stale selection, or landed off-canvas looks exactly like an edit that was not needed. `changed.pixels: 0` is a failure signal, not a success.
2. **Every violation names its coordinates and its fix tool.** My attention is the scarce resource; the engine should never make me hunt for an error it already knows about.
3. **Scoping by colour distance is dangerous and must report what it actually touched.** Two materials' ramps are routinely closer than a default tolerance — every step of a gold ramp is within tolerance of a step of a brass one. So any region-scoped op returns `region_bounds` and `region_components`.

---

## 5. MCP wiring

```jsonc
// ~/.pi/agent/mcp.json  (added entry)
"pixelhand": {
  "command": "node",
  "args": ["C:\\path\\to\\PixelHand\\src\\mcp.js"],
  "cwd": "C:\\path\\to\\PixelHand",
  "timeout": 120,
  "exposure": "codemode",
  "description": "Hand-authored pixel art engine: indexed cel canvas, style bibles, labelled inspection renders, animation clips with direction sets, sprite-sheet export.",
  "toolExposure": {
    "view": "direct", "chunk": "direct", "contact_sheet": "direct", "contact_grid": "direct",
    "onion": "direct", "play": "direct", "silhouette": "direct", "squint": "direct",
    "value_map": "direct", "game_scale": "direct", "diff": "direct", "heatmap": "direct",
    "audit": "direct", "style_options": "direct", "review_pack": "direct",
    "get_pixel_map": "codemode", "draw_pixel_map": "codemode", "put": "codemode",
    "paint_form": "codemode", "assert_style": "codemode",
    "clip_create": "codemode", "loop_validate": "codemode", "skin_pose": "codemode",
    "*": "codemode"
  }
}
```

For Zed, add the server under `context_servers` in `%APPDATA%/Zed/settings.json`:

```json
"pixelhand": {
  "command": "node",
  "args": ["C:/path/to/PixelHand/src/mcp.js"],
  "env": {}
}
```

Zed forwards configured MCP servers to ACP external agents, so DSH and Pi started inside Zed can use the same `pixelhand` tools. Use `project_open` with the game repository root before editing an existing project's art; it switches the active workspace without reinitializing or overwriting it.

Two different things are being configured here, and conflating them is how a tool surface drifts away from its spec:

- **`toolExposure` in `mcp.json`** decides whether pi hands the tool to the model directly or only through `codemode`. The 15 marked ★ in §3 are `direct`: they are the ones whose result is a picture I have to look at in the same turn I asked for it.
- **`DIRECT` in `src/mcp.js`** decides which results carry an inline `image` content block. It is the same 15, and the test suite asserts it stays bounded — returning images from all 138 tools would waste the context budget.

The authoring pair is deliberately **not** direct. `get_pixel_map` and `draw_pixel_map` return text, text is cheap, and a script should apply two hundred edits and report only the summary. Making them direct would spend the context budget on the thing that costs least.

**The spike was built** (`probe/spike-mcp.js`, 95 lines) and the engine does not depend on its outcome. What is still unverified on this machine is one specific link: whether a `direct` MCP tool's `image` content block reaches the model as an image. The `read`-a-generated-PNG path **is** verified, and every render tool writes its PNG to disk for exactly that reason. If the direct link fails, MCP carries grid + audit and the image comes from `read`; nothing else in the engine changes.
