# 04 — The vision loop: how I actually see the art

This is the heart of the engine. Everything else is support for this loop:

```
author pixels  →  render for my eyes  →  I judge  →  audit measures  →  I fix  →  repeat
```

If the render is wrong, the loop is blind, and the output is whatever a model guesses. Phase 0 measured exactly what my vision can and cannot do here, so the render system is built to those measurements rather than to optimism.

---

## 1. Hard constraints measured on this machine

| Constraint | Measured value | Consequence |
|---|---|---|
| Images are re-encoded before I see them | resized to max **1568×1568**, max **512 KB**, **JPEG quality 75** | JPEG is hostile to pixel art: 4:2:0 chroma subsampling smears hue across hard 1px edges, and ringing pollutes flat ramps. Every inspection render must be *designed to survive it*. |
| 1× pixel art | unreadable at 8×8/64px | Never render art at 1× for inspection. |
| Working zoom regime | **Z = 8–40**, nearest-neighbour integer upscale | Each art pixel becomes an 8–40px screen block. Hue and edges survive. |
| Guides/labels | 1px lines get eaten | Grid separators and glyphs are **≥2px thick** in screen space. |
| Glyph legibility | 5×7 font at 4× scale: **E and F read as 5** | Label font at scale ≥5, disambiguated glyph set, and labels are never the only addressing channel. |
| Unlabelled spatial addressing | **misread** (reported a cream cell where the pixel was near-black) | Coordinates must be burned into every render. |
| Labelled spatial addressing | **8/8 exact** on the same grid | With labels, I can name and fix a single pixel. |
| Defect detection | found one orphan pixel in a flat ramp field, correct location | With the right render, I am a reliable mechanical reviewer too. |

### The zoom policy

`view` picks zoom automatically from sprite size and requested region, targeting a render of roughly 400–900px on a side:

| Art size | Default Z | Render |
|---|---|---|
| 16×16 | 40 | 640×640 |
| 16×24 | 32 | 512×768 |
| 24×32 | 24 | 576×768 |
| 32×32 | 24 | 768×768 |
| 48×48 | 16 | 768×768 |
| 64×64 | 12 | 768×768 |
| 128×128 region | 6 | 768×768 |
| full 32×24 tile scene | 4 | 512×384 (context view, not detail view) |

Never bilinear, never fractional, never a resize the engine did not choose.

---

## 2. The dual channel: image + text, always together

`view` never returns an image alone. Every call returns:

1. **the image** — upscaled, labelled, gridded, with a palette legend;
2. **the coordinate-addressed text grid** — the same pixels as `row: col→index` tokens, which is the channel I write back through;
3. **metrics + audit** — colour count, silhouette area, bbox, centroid, ramp conformance, violations with coordinates.

The image answers *"does this look right?"* The text answers *"which pixel is wrong?"* Phase 0 showed I am strong on the first and only reliable on the second when coordinates are present. Both channels, every time, is the fix.

---

## 3. The eleven render modes

| Mode | What it shows | Why it exists |
|---|---|---|
| **`view`** | art at Z, 4px grid separators, A–H/1–N axis labels, palette legend with index numbers and swatches | The default. Addressable, fixable. |
| **`chunk`** | a sub-region at high Z (e.g. 12×12 art px at Z=48) | Detail work on a face or a hand without burning a full-sprite render. The main lever for context budget. |
| **`diff`** | before/after side by side, changed pixels flagged, plus a text list of changed coordinates and counts bucketed as *silhouette entered/left*, *repainted inside*, *alpha only* | Proves an edit did what I asked. `expect=` turns it into an assertion. |
| **`contact`** | N frames in a row (or a direction × frame grid), frame labels, per-frame delta stats | The animation review unit. One look instead of eight. |
| **`onion`** | current frame with neighbours ghosted — previous warm-tinted, next cool-tinted | Finds the one-pixel jump between poses. |
| **`silhouette`** | everything flattened to fill-vs-background, two colours only | The honest readability test. If a pose only reads because of colour and detail, it is not a readable pose. |
| **`squint`** | box-filtered 50% downscale, then upscaled back | Simulates distance and game scale. Catches sprites that only work zoomed in. |
| **`game_scale`** | the sprite at 1× composited on a mock tilemap with the game's background palette and light | The only render that answers "does this belong in this game?". A sprite that looks great on a transparent canvas and wrong on the ground is wrong. |
| **`value_map`** | luminance-only grayscale | Checks value structure independent of hue. A colour-correct sprite with a broken value structure looks amateur and hue tweaks will not save it. |
| **`heatmap`** | per-region violation overlay: lone pixels, off-ramp colours, jaggies, dither violations flagged in a loud marker colour | Makes mechanical errors visible spatially instead of as a list I have to cross-reference. |
| **`palette_audit`** | swatch strip with usage counts, ramp ordering, off-ramp colours flagged | Palette discipline at a glance. |

Plus `play`, which is not a still: an animated GIF/APNG at the clip's real fps. Timing faults are invisible in stills.

### Render hygiene (all measured requirements)

- Grid separators **2–3px** in screen space, in a neutral dark that is not in the art palette.
- Axis labels burned in with a tested bitmap font at scale ≥5, disambiguated glyph set (avoid the E/F/5 and B/8/O/0 confusions; prefer digits for rows and skip ambiguous letters where possible).
- Palette legend drawn as labelled swatches, so a colour name maps to a pixel without guessing.
- Inspection renders use a **checkerboard or mid-grey background**, never transparent, because transparency flattens unpredictably through the re-encode.
- A **render stamp** in the corner: sprite id, cel id, zoom, region. So I never review the wrong thing, which is a real failure mode once a project has 128 cels.

---

## 4. Context budget — the unglamorous constraint that shapes everything

An image render costs roughly **600–1,200 tokens** of my context. A full character is hundreds of renders. Left unmanaged, the project dies of context exhaustion rather than of bad art.

Built-in policy:

1. **`chunk` by default for fixes.** After a 3-pixel correction, re-render the 8×8 region around it, not the whole sprite.
2. **Render only what changed.** `diff` is cheaper than `view` and answers the actual question.
3. **Contact sheets over individual frames.** 8 facings in one render is one image, not eight.
4. **Text-first iteration.** Many fixes are fully specified by the audit's coordinates and need no image at all. Image renders are spent on *judgement*, not on *verification*.
5. **Cache by content hash.** Re-rendering an unchanged cel is refused; the engine returns the cached path.
6. **Escalating review cadence.** Pixel-level renders while composing; `silhouette`/`squint`/`game_scale` at milestones. Judgement renders are scheduled, not spammed.

Budgeted cost of real work:

| Asset | Renders | Tool calls | Approx. context |
|---|---|---|---|
| 16×16 prop (potion) | 6–10 | 15–25 | ~10k tokens |
| 32×32 detailed prop | 15–25 | 30–50 | ~25k |
| 16×24 character, 4-way 4-frame walk | 40–70 | 150–300 | ~55k |
| 8-way, 6 clips, ~128 cels | 250–400 | 900–1,500 | ~300k, across multiple sessions |

Which is why `art/` is git-tracked text: a character is not one session's work, and a session must be able to resume cold.

---

## 5. MCP image delivery — the one unverified link

Verified today: engine writes a PNG → `read` → I see it. That path works and the plan never depends on anything else.

Not yet verified on this machine: whether a `direct`-exposure MCP tool's image content block reaches me as an image. Phase 1's first task is a 60-line spike to settle it.

- If yes → `view` returns image + grid + audit in one round trip. Best case, and the round-trip savings in `docs/01-architecture.md` apply.
- If no → `view` returns grid + audit + a file path, and `read` supplies the image. Two calls instead of one. The engine, the formats and the workflow are unchanged.

Either way the loop closes. That is deliberate: the design must not hinge on an untested transport.
