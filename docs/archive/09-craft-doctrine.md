# 09 — Craft doctrine: the layer the architecture plan forgot

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


## 1. The experiment that exposed the gap

I drew a 32×32 pistol twice with the tooling that already exists (`probe/png.js`), no engine required.

**Draft 1** (`probe/draw-pistol.js`, `probe/draw_pistol_32.png`): 382 silhouette px, 12 colours, **7 lone pixels**, ramps on-palette, light direction correct, outline generated. Every mechanical metric was healthy.

It read as a lump. Specifically:

- **No negative space.** A pistol reads because of the *air* between grip, trigger guard and the underside of the barrel. Draft 1 filled it. Filling the air is what turns a gun into a brick.
- **Grip too wide and too vertical** — 8–10px wide, hanging straight down. A pistol grip is ~6–7px and angled back ~20°.
- **Frame merged into the slide**, producing one 8px-tall brick instead of two legible parts.
- **Sights read as blobs** — 3×2 blocks with outline thickening them into dark columns.
- **No readable muzzle.** A rounded end is not a barrel. A barrel needs a face and a bore.
- **Trigger guard was a solid mass** with no loop and no hole.

**Draft 2** (`probe/draw-pistol-v2.js`, `probe/draw_pistol_v2.png`): 348 silhouette px, 12 colours, bbox 26×20, 67% fill of its own bounding box. Same palette, same tools, same rules. The only thing that changed was **design intent**: one clean horizontal slide mass, a 7px grip angled back, a thin frame, a guard loop separated from the grip by 3px of air, a muzzle face with a bore, 1px sight nubs.

It reads as a pistol.

**What this proves, precisely:**

| Claim | Verdict |
|---|---|
| The loop works | **Yes.** Diagnose → correct → re-render produced a large, legible improvement in one iteration. |
| The mechanical layer works | **Yes.** Palette discipline, ramp shading, light direction, outline generation were correct in *both* drafts. |
| The bottleneck is plumbing | **No.** It never was. Draft 1 passed every mechanical test and still looked wrong. |
| The bottleneck is design | **Yes.** Silhouette, negative space, proportion, part legibility. My architecture plan said nothing about any of them. |
| One iteration reaches the bar | **No.** Draft 2 is *decent* — clean, readable, coherent. It remains generic where a stronger design would use a distinctive silhouette and focal feature. |

## 2. What a strong pixel-art game style requires

"High quality" is not one thing. The craft targets are:

- **Cohesion at volume** — palette, material, lighting and animation rules stay consistent across many assets.
- **Restraint** — a limited palette and clean clusters keep silhouettes legible in motion and at game scale.
- **Illustrative design** — exaggerated silhouettes and focal details make each object recognizable at a glance.

The architecture addressed rendering and consistency. It did not address design. Draft 1 proved that is where it would have failed.

## 3. Design doctrine — the missing layer, made operational

### 3.1 Silhouette first, always
Before a single shaded pixel exists, the **two-colour silhouette** must read as the thing. `silhouette` render is not a review step at the end; it is the *first* render, on an unshaded draft. If the silhouette is wrong, shading is decoration on a broken shape.

### 3.2 Negative space is a design material
The engine should measure it, because it is the thing draft 1 got wrong:
- `negative_space_index` — the proportion of the subject's bounding box that is *air inside or between its parts*.
- For objects with functional anatomy (guns, tools, vehicles, mechanisms), a low index is a **hard failure**: no air means no legible function.
- For silhouettes with no function to convey (a blob, a potion), a low index is fine.

This is measurable, and it is exactly the axis that separates "lump" from "reads as a gun".

### 3.3 Proportion and feature budget per scale
At 32×32 you get roughly **three legible features**. Choose them deliberately; everything else is texture. Draft 1 had six competing features and therefore none.

Declared per asset: `primary_read` (what it must be recognised as in one glance), `features: [max 3]`, `texture_budget`. The audit flags an asset whose distinct feature clusters exceed its budget for its scale.

### 3.4 Exaggeration is a rule, not a style preference
Illustrative pixel art exaggerates the *identifying* feature and simplifies everything else: oversized muzzle, oversized hammer, stubby barrel, huge grip. Draft 2 is proportionally correct and characterlessly generic. Correct proportions are the *safe* choice, and safe is why generated art looks like stock assets.

`exaggeration_axis` per asset: which feature is amplified, and by how much. The engine should warn when a subject's proportions are merely accurate.

### 3.5 Shape language and families
Assets in one game must share a family: corner treatment (all rounded, all chamfered, all hard), line weight, taper behaviour, and how ends terminate. Consistent terminal shapes help an item set read as one world. Add `shape_family` to the bible: `corner`, `terminal`, `taper`, `mass_distribution`.

### 3.6 Focal accent
One accent colour cluster per hero asset, placed at the identifying detail. Draft 2's brass trigger is the right instinct, wrongly placed — the accent should sit on the thing that identifies the object.

### 3.7 Readability triage
Not every asset deserves the same effort, and pretending otherwise is how projects die of over-polishing:

| Tier | Assets | Iteration budget | Audit strictness |
|---|---|---|---|
| **Hero** | player, signature weapons, bosses, key UI | 6–12 renders, 3+ design passes | full rule set + human review |
| **Support** | enemies, common items, prominent props | 3–6 renders | full rule set |
| **Background** | tiles, decor, filler props | 1–3 renders | structure + palette only |
| **System** | icons, cursors, fonts | 1–2 renders | `squint` legibility only |

Common props can use a smaller detail budget than signature characters. That is a production decision, and the engine should encode it rather than pretend every sprite needs equal effort.

## 4. Volume: how hundreds of assets become possible

Craft is worthless if the engine can only make ten sprites.

- **Part library.** Authored, reusable body parts — heads, hair, torsos, limbs, footwear — assembled into characters, with per-part cel linking so a fix propagates. (The *modularity technique* is public method; the parts themselves are authored here, per `docs/07`.) This is what makes 40 NPCs tractable instead of 40 full rigs.
- **Material library.** Authored ramp recipes per material, shared across every asset that names that material. This is the main engine of coherence.
- **Family templates.** A weapon family shares corner treatment, mass distribution and accent placement; individual weapons differ in their exaggerated feature.
- **Batch re-lint.** Changing a material re-runs every asset through `assert_style` and reports which ones drifted.

## 5. Scene coherence — a world-level craft requirement

Per-sprite quality is not what makes a game look good. What makes it look good is:

- **Global light palettes** per biome/area, with per-scene ambient tinting that re-derives shadows rather than re-drawing sprites.
- **Time-of-day and season ramps**: the same authored sprite under four declared light states, no redraw. (This is coverage test T12.)
- **Shared atmospheric rules**: how distance desaturates, how fog reads, how a torch falls off.
- **Contact grounding**: every asset has a contact shadow rule, or the world looks like stickers on a floor.

## 6. Motion "juice" is art, not code

Animation gets much of its feel from authored frame tricks:

- **Hit flash palette** — a declared light step used for 1 frame on impact. Not a shader.
- **Smear frames** — a fast limb drawn along its own path, stepping down a ramp so it stays on palette.
- **Impact frames** — a squash on contact, a stretch on release, one-pixel scale changes with volume preserved.
- **Anticipation held longer than the action** — where weight actually reads.
- **Recoil and recovery offsets** as cel metadata, not redraws.

## 7. What this changes about the plan

The build order gains a gate before any engine-building is allowed to matter:

> **Phase 0.5 — can I actually draw?** Executed today, no engine required. Draft 1 failed on design while passing every mechanical test; draft 2 fixed it through diagnosis alone. **Result: the loop converges, and design — not plumbing — is the binding constraint.**

Consequences:

1. `docs/09` doctrine becomes enforceable: `negative_space_index`, `feature_budget`, `exaggeration_axis`, `shape_family`, `focal_accent`, quality tiers.
2. **Design passes come before rendering passes.** A draft is reviewed as a silhouette before it is ever shaded.
3. **Human review is a gate, not a courtesy.** Self-review by the model that made the mistake is the weakest link in the whole system (see `docs/10`).
4. Reference *measurement* replaces reference *assets*: craft targets expressed as numbers (colours per scale, ramp step counts, cluster statistics, silhouette complexity), so the bar is external and measurable without borrowing anyone's art.
