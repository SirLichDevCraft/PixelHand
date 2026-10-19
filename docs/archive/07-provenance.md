# 07 — Provenance: everything the engine produces must be publishable

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


**Policy: the engine produces original art only. No third-party assets enter the pipeline, and the tool surface is built so they cannot enter it silently.**

This is not a legal memo. It is an engineering constraint set chosen so that shipping the art never requires untangling where a pixel came from.

---

## 1. What is safe to use, and what is not

The line that matters is **idea vs expression**. Techniques are ideas; sprites are expression.

### Safe (ideas, methods, math)

- Animation doctrine: key poses, frame budgets, hold frames, fps-vs-frame-count, contact/down/passing/up.
- Craft technique: hue-shifting shadows, ramp discipline, cluster minimums, dither patterns, edge anti-aliasing rules, silhouette and squint testing.
- Direction-set conventions (4-way, 6-way 3/4 view, 8-way) and the bitmask math behind 47-tile autotiling.
- File formats and interchange targets (indexed PNG, sprite-sheet layouts, Tiled TSJSON, Godot SpriteFrames, Aseprite-compatible JSON). Format interoperability is not derivative work.
- An **art style** in the abstract. Style is not ownable. "Warm saturated top-down with soft edges and no outlines" is a description of a technique, not a copy of anything.

### Off-limits (expression)

- Importing, tracing, redrawing, or "reinterpreting" any sprite, tile, prop or character from an existing game.
- Lifting a specific game's palette as a palette file.
- Using third-party sprite packs, even openly licensed ones, as reference art inside the project directory. An CC-BY sprite pack is legally fine and still a bad idea here: it makes "which pixels are ours?" a question that has to be answered per asset, forever.
- Building a style bible by sampling a named game's actual colours.

**Reference study happens in my head and in prose, never in the asset directory.** Reading about how animation timing works is not ingestion.

---

## 2. What changed in the engine because of this policy

### 2.1 `import_png` is now gated, not free

The original tool surface had `import_png({path, quantize_to_palette})`. That is a provenance hazard: one careless call and a third-party sprite is in the canvas, quantised, indistinguishable from authored art.

New contract:

```jsonc
import_png({
  path,
  quantize_to_palette,
  provenance: {              // REQUIRED — the call fails without it
    origin: "original | licensed | user-owned | generated",
    licence: "...",          // required when origin === "licensed"
    source_url: "...",       // required when origin === "licensed"
    declared_by: "user"
  }
})
```

Anything imported is **quarantined**:

- the cel is tagged `imported: true` in the sprite document,
- `assert_style` reports it as a distinct finding, not a silent pass,
- `export_sheet` refuses to include a quarantined cel unless `allow_imported: true` is passed explicitly,
- the export manifest lists every quarantined source with its declared provenance.

So an accidental import becomes a loud, greppable fact rather than a pixel that ships.

### 2.2 Every sprite carries provenance metadata

```jsonc
// written automatically into every sprite.json and every export manifest
"provenance": {
  "authored_by": "agent",
  "directed_by": "user",
  "engine": "pixelhand 0.1",
  "style_bible": "warm-topdown",
  "palette_file": "art/palettes/warm-24.json",
  "palette_origin": "derived in-repo from declared base hues",
  "imported_pixels": 0,
  "generative_model_used": null,
  "sources": []
}
```

`imported_pixels: 0` and `generative_model_used: null` are **computed by the engine from the edit history**, not asserted by the caller. A sprite that received an import cannot report zero.

### 2.3 Palettes are derived, never sampled

`create_ramp` builds ramps from base hues declared in the bible. Palette files carry `origin` and the base hues they were derived from. There is no "paste a palette in" path in the style system — a palette is a derivation with a traceable recipe.

### 2.4 No generative image models in the pipeline — and that is an asset

`models.getAvailableOfType` returned **0 image models and 0 classifiers** on this setup. That was a constraint to design around, and it turns out to be a provenance advantage:

**Every pixel in this pipeline is placed by an agent under explicit user direction, from a palette the user authored, into a canvas the user specified. Nothing is sampled from a training distribution.** That is a cleaner and more defensible story than any AI-image-generator pipeline, and it is a property of the architecture rather than a policy I have to keep remembering.

Worth stating plainly for later: purely machine-generated output has unsettled protection in some jurisdictions, and what anchors it is **human authorship** — your choices of style, composition, what the sprite depicts, and your approval or rejection of each iteration. The `art/` directory is git-tracked text cels, so that direction and iteration history is preserved as evidence rather than being a chat transcript. Keep it.

---

## 3. Naming: no borrowed identities

Style bibles are named by their visual properties:

| Style id | Visual properties |
|---|---|
| `warm-topdown` | warm, saturated, soft-edged, selective dark outline |
| `flat-noir-highcontrast` | flat planes, hard edges, no outlines, silhouette-driven |
| `crisp-16bit` | 5-step ramps, hard specular lines, dithered flats |
| `sculpted-large` | 48–64px subjects, 20+ colours, sculpted form |

The four archetypes are **original constraint sets assembled from general technique**. They describe a look; they do not reproduce one.

---

## 4. What was removed from this repo today

| Item | Why it is gone |
|---|---|
| `probe/ref_golem.png`, `probe/ref_item_sheet.png`, `probe/flat_walk8_sheet.png`, `probe/flat_item_sheet.png` | Copies of another project's showcase artwork. Studied, then deleted. Not needed as a bar — see §5. |
| The full third-party repo clone under `C:/tmp/pi-github-repos/` (5.7 MB) | Cloned to read its design. Read, absorbed as technique, deleted. |
| Verbatim quotation of that project's README from `PLAN.md` and `docs/01` | Replaced with a paraphrase. The *finding* is ours now; the sentence is not. |

Every remaining image in this repo was generated by code in this repo. `probe/A…G`, `probe/spike-image.png` — all produced by `probe/png.js` and `probe/spike-mcp.js`.

---

## 5. The quality bar no longer needs anyone else's art

Removing the reference images leaves a real gap: the plan previously pointed at someone else's golem as the target. Replacement, which is better anyway:

1. **Phase 1–3 output becomes the golden corpus.** The potion, the calibration trio, and the first honest 4-direction walk are frozen as golden renders. They are ours, they are measurable, and they are the bar.
2. **The bar is expressed as measurable properties, not as a picture to trace:** silhouette stability across a direction set, ramp conformance percentage, colour count within the detail budget, anchor drift under a threshold, hue-shift direction consistency, and passing `silhouette` / `squint` / `value_map` / `game_scale`.
3. **Technique doctrine stays** (it is public, general, and not ownable). Only the *assets* are gone.

A golden corpus built from our own approved assets has an advantage a borrowed reference never had: it is regression-testable. A borrowed picture can only be looked at.

---

## 6. Standing rules for every future session

1. Nothing enters `art/` except files the engine wrote from authored cels.
2. `import_png` requires declared provenance and quarantines what it imports.
3. No third-party sprite pack, palette file, or reference image is stored in this repo, ever — including openly licensed ones.
4. Style bibles are named for behaviour, and derived from declared base hues.
5. Technique references may be read and cited in prose; they are never copied into assets or palettes.
6. Provenance metadata is computed from edit history and travels in every export manifest.
7. If a future feature ever wants a generative model, it is opt-in, recorded in `generative_model_used`, and quarantined like an import.
