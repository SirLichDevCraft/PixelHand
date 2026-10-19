# PIXELHAND — an engine for hand-placed 2D pixel art, directed by an LLM

**Status:** the engine is built and tested — **136 tools** in the shared registry, exposed through the CLI and MCP, with **265 passing tests** (27 smoke + 238 integration). Phases 1–6 exist as running code; Phase 1's gate is **passed**, Phase 2's mechanical gate is **passed with one claim failing honestly**, and Phase 6's gate — including perspective depth — is **passed on all fourteen claims** (`bench/gate6-scene.js`, `out/gate6-report.txt`). Art exists: Phase 4's weapon family is measured and authored, Phase 3's character and walk still await visual review, and Phase 5's eight-direction set remains draft. Phase 7 has a runner but no recorded result. Phase 8 authoring is underway: modules for T1, T3, T4, T6–T9 are present, and the saved T1 run reports 6/6 machine-checked claims. The full T1–T12 gate and human visual approval remain incomplete. See §5A for the evidence and limits.
**Split of labour:** the agent owns taste, style, pose and every pixel. The engine owns state, rendering, measurement and enforcement.
**Quality bar:** clear silhouettes, deliberate pixel clusters, cohesive palettes, readable motion, and consistent presentation at game scale — see `docs/07-provenance.md`.
**Provenance policy:** every pixel is authored in this repo. No third-party assets enter the pipeline.

### Documents

| File | Contents |
|---|---|
| `PLAN.md` (this) | verdict, measured evidence, architecture decision, build phases, open questions |
| `docs/01-architecture.md` | engine layout, cel format, the full MCP/CLI tool surface |
| `docs/02-style-system.md` | style bibles, palette/ramp engine, materials, the per-game art-direction ritual |
| `docs/03-animation.md` | rigs, key poses, direction sets, timing, loop validation |
| `docs/04-vision-loop.md` | the 11 render modes, zoom policy, label font, context budget |
| `docs/05-qa-and-risks.md` | audit rules, test harness, cost model, risk register |
| `docs/07-provenance.md` | **originality policy**: no third-party assets, gated import, per-asset provenance metadata |
| `docs/08-coverage-matrix.md` | **the style space**: 9 axes, their value domains, impossible-combination rules, asset taxonomy, T1–T12 coverage tests, style derivation |
| `docs/06-environments.md` | tilesets, autotiling, seamless edges, constrained variants, multi-tile structures, scene light and ambient re-derivation, contact grounding |
| `docs/09-craft-doctrine.md` | **the design layer the architecture forgot**: the pistol experiment, silhouette-first, negative space, feature budget, exaggeration, shape families, quality tiers, part libraries, scene coherence, juice |
| `docs/10-honest-assessment.md` | **is this the best way?** confidence levels, what the plan gets right, the 10 things it got wrong, alternatives weighed, realistic ceiling, decisive next experiment |
| `docs/11-collaboration.md` | **the art-direction loop**: convergence by reaction not description, option rounds, shared craft vocabulary, review packs, taste memory, your own pixels and sketches, who decides what, style signature |
| `probe/` | Phase 0 code and images — runnable evidence, not claims |

---

## 1. The short answer

Yes, I am up to it — and not because a model is clever at drawing. Because the loop can be built so that I **see** what I drew, **measure** what I drew, and am **forced to fix it** until it is right.

Three things must all be true at once, and today each one was verified rather than assumed:

1. I can generate a pixel image and **look at it accurately**.
2. I can address it **by coordinate**, not just gestalt, so I can fix one pixel instead of redrawing a sprite.
3. The engine can **catch the two hundred mechanical errors per sprite** (lone pixels, off-ramp colours, jaggies, anchor drift) so my attention is spent only on form, light and pose.

Strip any one of those out and the output collapses into the smooth, monotone, obviously-generated mush that pixel art is most prone to.

And a fourth, which is what makes this an engine rather than a good pipeline: **the loop must work at every point in the style space, not at one point.** All projections, all art scales, all palette magnitudes, all moods, every asset class, every target engine. That space is specified in `docs/08-coverage-matrix.md`, and a project is just a coordinate chosen inside it.

And a fifth, which is what makes it *your* art rather than generated art: **the coordinate must be converged from your reactions, not declared by me.** People cannot describe a visual style, but they can recognise one — so the engine presents small concrete option sets, you react, and every reaction is recorded as a constraint. `docs/11-collaboration.md` is that mechanism, and it is how the style gets populated in the first place.

---

## 2. What Phase 0 proved (measured, not assumed)

All of it was run in `probe/` on this machine. The code is in the repo.

| # | Test | Result | Design consequence |
|---|---|---|---|
| 1 | Zero-dependency PNG encode **and** decode in plain Node (`zlib` only) | **Works.** Round-trip verified byte-identical. Colour types 0/2/3/4/6, all five filter types, PLTE/tRNS. No `sharp`, `canvas` or `pngjs` installed or needed. | Engine core stays dependency-free. Indexed PNG both ways, so reference art can be imported and quantised. |
| 2 | Can I see a PNG the engine generates? | **Yes**, accurately, via `read` on a generated file. | The vision loop is real. Everything else builds on it. |
| 3 | 1× art (8×8, 64px) vs integer-upscaled | 1× is unusable. Nearest-neighbour at **Z = 8–40** is the working regime. | Every inspection render is integer-upscaled. Bilinear never. |
| 4 | Find one wrong pixel in a 24×24 magenta ramp (orphan cyan at art px 17,6) | **Found it**, correct location. | Mechanical defect detection by eye works. The engine's job is to make defects *visible*. |
| 5 | Read an 8×8 colour grid **without** labels | **Misread cell A1** — reported cream, actually near-black. | Unlabelled renders are unreliable for spatial addressing. |
| 6 | Same grid **with** burned-in A–H / 1–8 axis labels | **8/8 exact**, including the cell I got wrong before. | **Decisive.** Every render must carry burned-in coordinates. Labels turn my vision from gestalt into addressable. |
| 7 | 5×7 bitmap font at 4× through the image pipeline | Readable, but **E and F were confused with 5**. | Engine needs a tested label font: scale ≥ 5, disambiguated glyphs, and never labels without a paired text grid. |
| 8 | My own procedural "walk cycle" (4 frames, leg offsets + binary bob) | **Garbage.** Legs teleported as rigid columns; frame 4 merged both legs into one block; torso detached from legs; no arms, no counter-swing, no knee, no weight shift. | Animation cannot be generated geometrically. It must be **authored pose-first** and verified frame by frame. Post-mortem in §3. |
| 9 | Codec round-trip testing | Found two silent bugs: `out.copy(line,…)` copied the wrong direction; `upscaleNearest` dropped its row offset. Both fatal, both invisible. | The engine ships with a codec/round-trip harness on day one. Silent data corruption is the #1 risk in a pixel engine. |
| 10 | Automated critic models (`models.getAvailableOfType`) | **0 classifiers, 0 image models** available here. | No off-the-shelf visual critic. The critic stack is deterministic audit + my eyes. |
| 11 | Prior art studied: an existing headless pixel-art MCP server (163 tools) | Cloned, read, studied, **then deleted from disk**. It had independently reached the same conclusion as my test 8: an agent given a long coordinate list does not write considered pixels, it writes a formula, and formulas produce the smooth monotone surfaces that make generated art look generated. Its answer was the same primitive I needed — a character grid that can be written down and read back. | Confirms the core primitive and the measure-what-you-drew philosophy. Needs Aseprite, which is **not installed** here. Its design lessons are absorbed; none of its code or art is in this repo. |
| 12 | Quality bar observed at 8× zoom on that project's output, before removal | A 64×64 subject in 37 colours: warm stone lit from top-left with **shadows hue-shifted toward cool violet**, a selective near-black outline, 2–3px texture clusters, and a glowing core as the focal point. Its 8-direction sheet held a stable silhouette across all eight facings with consistent light direction, hue-shifted greens, dithered mid→shadow transitions, edge anti-aliasing, and eyes correctly hidden in the rear facing. | Proves an agent-through-MCP pipeline reaches commercial indie craft — so the plan targets it explicitly instead of hoping for it. **The images themselves were deleted** (see `docs/07-provenance.md` §5); the bar is now expressed as measurable properties plus our own golden corpus. |

---

## 3. Post-mortem of my own bad walk cycle — the most useful failure

I generated four "walk frames" procedurally. They are not walk frames. Each failure becomes an engine requirement.

| What went wrong | Root cause | Becomes |
|---|---|---|
| Legs slid sideways as rigid 2px columns | Offsetting a shape ≠ stepping. No knee, no ankle, no foot lift. | **Rig + pose authoring.** Limbs are posed, not translated. |
| Frame 4 merged both legs into one 4px column | No silhouette check between frames. | `loop_validate` reports per-frame silhouette delta and flags disjoint parts that collide. |
| Torso lifted, legs stayed anchored → body detached | Bob applied to some cels and not others. | Cel offsets are **per part**, with a locked **foot baseline**; engine reports anchor drift per frame. |
| No arms, so no counter-swing | I animated legs only. Arm swing is the most legible signal of a walk. | Clip templates carry a **mandatory motion set** per body region; a walk with no opposing arm motion fails audit. |
| Binary bob (0, −1, 0, −1) | Real vertical rhythm is a curve: lowest at contact, highest at passing. | Pose templates encode **contact → down → passing → up** and their height relationship, not a sine. |
| Looked smooth and monotone | Formula-generated surfaces. | **No procedural drawing primitives for organic form.** Shapes are scaffolding only; the pixels come from me as a grid. |

### Craft doctrine adopted (from research, and consistent with my own failure)

- **The pose is the animation.** Block key poses first; in-betweens are the route between them.
- **Frame budgets that work:** idle 2–4, walk 4–8, run 4–6, attack 3–6, jump 2–3. Past 12 is rarely worth the redraw.
- **Timing is a first-class asset.** An 8-frame walk at 12 fps reads as a stride; the same art at 24 fps reads as a shuffle. Durations are authored, never defaulted.
- **Hold frames** sell weight and cost no new art.
- **Cardinal views are authored and approved before any diagonal exists.** Diagonals derive from two approved anchors, then get hand-corrected — never a front pose with the eyes nudged sideways.
- **One shared rhythm across every direction.** Same frame count, same contact timing, or direction switching feels uneven even when each loop looks fine alone.
- **Pixel art is authored, not rendered.**

---

## 4. Architecture decision: is MCP needed?

**Yes — as a thin, stateful accelerator over a deterministic engine that is also a plain CLI. Disk is the source of truth; MCP is the fast loop.**

Why MCP earns its place:

1. **Round-trip economics.** The tightest loop here is *draw → look → fix*. Without MCP that is two calls (bash to run the engine, `read` to see the PNG). With a `direct`-exposure MCP tool, `view` returns the image **and** the text grid **and** the audit in one call. Across one 8-direction character that is roughly 1,500 round trips versus 800.
2. **Warm state.** Undo/redo, onion-skin buffers, render cache and the live selection live in the process. Rebuilding them per CLI call is pure waste.
3. **Schema-validated arguments.** Tool schemas stop me emitting a malformed cel by hand. A CLI accepts anything and half-succeeds.
4. **`structuredContent`.** MCP results can carry the machine-readable grid and metrics *alongside* the image — exactly the dual channel tests 5/6 proved I need.

Why the CLI mirror is non-negotiable:

- A crashed MCP process must lose nothing. Disk is authoritative.
- Every capability must be reachable without MCP, because one link is still unverified on this machine: whether a `direct` MCP tool's image content block reaches the model as an image. The `read`-a-generated-PNG path **is** verified. The plan never depends on the unverified one.
- Git-diffable text cels make the art reviewable, revertible and resumable across sessions.

**The Phase 1 spike was built first** (`src/spike-mcp.js`): a minimal MCP server whose one tool returns a single image block. Outcome: the server speaks JSON-RPC 2.0 over stdio and the engine's full surface now sits behind it. The one link still unverified on this machine is whether a `direct` tool's image block reaches the model as an image — so every render tool also writes its PNG to disk, and the `read` path is the fallback. The engine is identical either way. That is the point of doing the spike first.

**Rejected:** driving Aseprite headlessly. Excellent prior art, its design lessons absorbed as technique, but Aseprite is not installed, is a paid licence, adds Python plus a Lua codegen layer, and is explicitly designed for an agent that *cannot see*. I can see — that inverts the design. The engine instead **exports** an Aseprite-compatible sheet layout so the user can polish in whatever editor they choose. That is output-format interoperability only: no third-party code, assets or palettes enter the project.

---

## 5A. Build status — what exists and what does not

Measured by `npm test` (27 smoke + 238 integration), `node bench/benchmark.js`, and `npm run gates` (gate1, gate2, gate3, gate3-walk, gate4, gate6), not by intention.

**Engine: built.**

| Layer | Files | State |
|---|---|---|
| Cel core | `src/core/cel.js` | Int16Array palette indices, text-grid persistence, diff/patch, RLE, undo stack |
| Palette & ramps | `src/core/palette.js` | ramp roles, weighted nearest-colour, ramp adjacency |
| Hand-placement ops | `src/core/ops.js` | 31 primitives. No brightness/hue/saturation filters anywhere |
| Style | `src/core/style.js` | 9 required axes, impossible-combination rules, negative space, feature budget |
| Rig & clip | `src/core/rig.js`, `src/core/clip.js` | 8 directions, mirror pairs, skin/pose/compose, timing, smear, hit-flash, squash |
| Craft measurement | `src/craft.js` | form modelling, light coherence, value structure, blob index, outline usage, grounding, focal accent, silhouette complexity, part separation, cluster stats |
| Author model | `src/author.js` | one authored-pixel pipeline used by every authored set: each region lit across its own filled extent rather than its bounding box, focal accents placed as declared clusters, ground sole darkening, seam bridging where two regions meet, singleton repair, edge policy that outlines only where a form opens on the shadow side |
| Audit | `src/audit.js` | rules, each violation carrying coordinates **and the tool that fixes it** |
| Render | `src/render.js` | 12 modes, integer zoom 8–40, burned labels, dual channel (image + coordinate grid) |
| Codec | `src/codec/png.js`, `gif.js` | indexed PNG (colourType 3) and GIF, zero dependencies beyond `zlib` |
| Tiles / structures | `src/core/tiles.js` | 47-tile blob autotiling, seam material breaks, variant lint, multi-tile footprints |
| Parts / families / tiers | `src/core/parts.js` | part library, assembly, 4 measured shape families, hero/support/background/system budgets |
| Perspective / POV depth | `src/core/depth.js` | a declared camera (horizon row, vanishing point, focal length, eye height), projection maths, ramp-step band allocation per distance band, light+face recipes, and five independent audits: convergence, foreshortening, value monotonicity, ground/horizon agreement, occlusion order |
| Scenes | `src/core/scene.js` | 6 light states, ambient re-derivation of the **palette**, dependency-free playtest harness |
| Provenance | `src/core/project.js` | computed from edit history; import is quarantined and never counts as authored |
| Regression | `src/core/regression.js` | golden corpus of our own approved output, 8 craft target scales, export gate |
| Adapters | `src/adapters.js` | godot / phaser / tiled / aseprite / html5-canvas / generic. Output formats only |
| Surfaces | `src/tools.js`, `src/cli.js`, `src/mcp.js` | 136 tools in one registry; CLI mirrors it; MCP returns images inline for the hot tools |

**Tests: 265 passing, 0 failing** (27 smoke + 238 integration). The integration suite asserts the refusals, not just the successes: scaling is refused, alpha is refused, off-palette maps are refused whole, a shape-dominated sprite is flagged, an export gate blocks a non-conforming clip, provenance is computed rather than asserted.

It also asserts **metric integrity** — that the measurements themselves are not lying: a plain rectangle scores 0 on `blobIndex` (it used to score 0.956, higher than either authored pistol), `silhouetteComplexity` scores a disc the same at 12px and 24px (perimeter-over-area did not), negative space is a scored component and a solid cut-out scores 0 on it while the same cut-out with a hole outscores it, and `compare` refuses to report a 16px drawing and an 8px drawing as "the same".

**Art: draft.** The Keeper benchmark composes 64 cels from 25 authored parts across 8 directions × 2 clips, and the audit reports **0 of 64 clean**, with **23 of 64** conforming to their declared style. That is the expected state for draft art and the reason the audit exists — but it means Phase 3's gate (a character with personality that *reads*) is not yet passed.

**Gates run so far:**

| Gate | Result | Evidence |
|---|---|---|
| Phase 1 — 16×16 potion, ≤25 calls, audit clean | **PASS** — 13 calls, 0 findings, `assert_style` conforms, craft 0.838 | `bench/gate1-potion.js`, `out/gate1-report.txt` |
| Phase 2 — three distant coordinates, impossible ones refused | **PASS on the mechanical half**; the pistol-metric claim **fails** (draft 2 has no enclosed negative space) | `bench/gate2-style.js`, `out/gate2-report.txt` |
| Phase 3 — character with personality | **STAGE 1 + STAGE 2 AUTHORED** — 17 parts, 4 facings × 4 frames, `loop_validate` 4/4 clean, `export_gate` would allow export; **awaiting your silhouette + playback review** | `bench/gate3-character.js`, `bench/gate3-walk.js`, `out/gate3-stage1.txt`, `out/gate3-stage2.txt` |
| Keeper (draft art, not a gate) | 64 cels from 25 parts, **0/64 audit-clean** | `bench/benchmark.js` |
| Phase 4 — ten members of one weapon family | **PASS — all 7 claims** — one declared coordinate (`arsenal-plate`: side view, art_scale 32, complementary-shadow temperature, selective-dark edges, ramp-lit shading) carries all ten; `family_audit` over `framed_mechanical` reads them as one family: corners chamfered on all ten, mass distribution `even` on all ten (ratios 0.80–1.18 measured from each declared grip anchor), straight-run share 0.64–0.66; ten distinct declared exaggerations; negative space and feature budget pass on all ten; audit clean on all ten; craft 0.771–0.869 (two hero, eight support); contact sheets for view / squint / silhouette / value_map; committed grids re-authored byte-identical on a clean run (zero drift); chamfers that would have broken a member apart were refused rather than dropped | `bench/gate4-weapons.js`, `out/gate4-report.txt`, `art/weapons/*.grid` |
| Phase 6 — tiles, props, scene coherence + POV depth | **PASS — all 14 claims** — corner house: edges converge on the declared VP (off by 0.3 px and 1.6 px at 96 %/100 % coverage); far wall drawn **51 %** of the near face where the camera demands **50 %**; every material descends its own ramp monotonically across four distance bands (`plaster` steps 7.2 → 4.5 → 2.5 → 0.54); contact rows read back as z=5.608 wanting 96.3 px against 97 px drawn (0.7 % off); occlusion order correct. Five deliberate controls were refused: a parallel building wearing a perspective label, a non-converging edge, repeated windows held the same size, a nearer cart drawn under the building, and a light vector outranking the declared atmosphere. Pavement: three variants built from one fixed bag of colours, seamless under a 4×4 repeat (h break 0.0, v break ≤0.016), mean-luma spread exactly 0. Three light states re-keyed with no redraw (grid hash identical) | `bench/gate6-scene.js`, `out/gate6-report.txt` |
| Phase 7 — volume economics | **RUNNER EXISTS, NOT RUN** — the part/assembly machinery and `bench/gate7-volume.js` exist; no gate report yet proves the 20-NPC and asset-#400 economics claims | `bench/gate7-volume.js`; running it clears `out/gate7` and writes generated assets under `art/parts/npc` and `art/parts/crew` |
| Phase 8 — coverage matrix | **AUTHORING UNDERWAY; GATE INCOMPLETE** — modules exist for T1, T3, T4, T6–T9. The saved T1 report has 6/6 automated claims, but no human visual approval is recorded and the other coordinates have no aggregate result. `coverage_report`'s 38/38 figure measures implemented techniques, not visual coverage. | `bench/coverage/`, `bench/gate8-coverage.js`, `out/gate8-report.txt`, `docs/08-coverage-matrix.md` §4 |


**Not yet done:** the complete T1–T12 coverage gate; the Phase 7 volume-economics run; visual approval of the Phase 3 character and animation; a golden corpus captured from approved art (Keeper sits at 0 of 64 audit-clean and 23 of 64 style-conforming); review of Phase 5's draft eight-direction art and timing; and a playtest inside Godot or Phaser rather than only the bundled HTML5 harness. The current coverage modules and T1 report are work in progress, not evidence that the full coverage gate passed.**

---

## 5. Build phases, each with a pass/fail gate

Every phase ends in something that is *looked at* and *measured*, not declared complete.

### Phase 0 — feasibility — **DONE**
Codec, vision loop, defect detection, coordinate addressing, prior art, quality bar. Evidence in `probe/`.

### Phase 0.5 — can I actually draw? — **DONE**
No engine required: one 32×32 pistol drawn twice with only the probe codec.
> **Result:** draft 1 passed every mechanical metric (12 on-palette colours, walked ramps, correct light direction, 7 lone pixels) and **read as a lump** — no negative space, grip too wide, frame merged into the slide, no readable muzzle. Draft 2 changed only the *design intent* and **reads as a pistol**. Conclusion: **the loop converges, and design — not plumbing — is the binding constraint.** Full analysis in `docs/09-craft-doctrine.md` §1.

### Phase 1 — the body: buffer, codec, `pixel_map`, `view` — **DONE, gate PASSED**
Indexed cel buffer, text grid format, the `draw_pixel_map` / `get_pixel_map` pair, the labelled `view` renderer, undo, disk persistence, CLI, MCP spike.
> **Gate:** I draw a 16×16 potion from a blank canvas, in ≤ 25 tool calls, that (a) passes `audit` with zero violations and (b) survives review at game scale. No shape primitives for the bottle body — only considered pixels.
> **Result (`node bench/gate1-potion.js`):** 114 pixels placed in **13 tool calls**, **0 audit findings on the first round**, `assert_style` conforms, craft score **0.838 (support)**. Zero shape primitives. The cel is on disk as `out/gate1/art/sprites/potion/cels/base.grid` (342 bytes of git-diffable text).
>
> The gate is not decoration — it caught three real design errors before it passed. The first draft was lit from the wrong side (the audit's `light_direction` named the glass region as lit opposite the declared vector). The second had no focal accent placed and 20 lone pixels. The third was clean under `audit` and still **refused by `assert_style`: `no_negative_space` — an object with zero enclosed air is a cut-out, not an object.** The fix was a design decision, not a filter: a twine loop tied below the cork that encloses six pixels of air, closed by the shoulder. That is the pistol lesson from Phase 0.5 arriving through the engine rather than around it.

### Phase 2 — craft rules *before* style presets — **machinery DONE, mechanical gate PASSED, one claim FAILS honestly**
Implement the `docs/09` craft metrics — `negative_space_index`, `feature_budget`, `exaggeration_axis`, `shape_family`, `focal_accent`, the four quality tiers — **alongside** the nine-axis space from `docs/08`, so craft and style are enforced together from the start rather than bolted on later. Plus ramp generation with hue shifting, gradient mapping, `assert_style`, coordinate validation that refuses impossible combinations at declaration — **and the collaboration loop from `docs/11`** (`style_options`, `style_pick`, `style_reject`, `review_pack`, `style_signature`, `taste_read`/`taste_write`), because the coordinate is populated through those tools rather than authored by me.
> **Gate:** the *same* potion drawn under three maximally distant coordinates — `warm-topdown` (16×16, 24 colours, selective outline), `flat-noir-highcontrast` (16×16, 16 colours, no outline, flat), `monochrome-value` (8×8, 2 colours, value-driven). Each visibly belongs to its style, each passes its own audit, a blind comparison names the style from the art alone, the engine refuses at least three impossible coordinates with a clear reason, **and** the craft metrics correctly flag draft 1 of the pistol as a design failure while passing draft 2.
> **Result (`node bench/gate2-style.js`):**
> - All three coordinates pass their own `audit` and their own `assert_style`: 12 colours / 114px / 6 enclosed air / craft 0.838; 10 colours / 113px / 6 enclosed air / craft 0.902; 2 colours / 32px / 2 enclosed air / craft 0.940.
> - **5 impossible coordinates refused at declaration**, before a pixel exists: `outline-2px-on-tiny`, `hyper-detail-on-small`, `sculpted-needs-room`, `iso-needs-room`, `sculpted-needs-palette`, `mono-contradicts-multi-material`, `sub-asset-needs-scale`. The `style_create` tool refuses the same coordinate with the inconsistent fields named.
> - The engine also refused its own first attempt at the noir palette: `glass.0 → glass.1` jumped 0.559 in value. **`shading: "flat"` means the drawing skips mid-tones; it does not license a palette to jump value.** Flat noir is now step 3 against step 1 — a hard split that is still legal on the ramp.
> - **The claim that fails, stated plainly:** the craft metrics do *not* pass draft 2. Draft 2 has **zero enclosed negative space** — its trigger guard was reshaped but never closed, so the pocket leaks to the outside through one pixel. And the aggregate score ranks draft 1 **above** draft 2 (0.772 vs 0.769): the sub-metric that matches the diagnosis (`blob`) favours draft 2, but four other components are saturated at 1.0 for both and carry no information. Both drafts also score **0 on focal accent** — neither palette declares an accent colour, so neither drawing has anything declared as the thing to look at. The Phase 0.5 conclusion survives, narrowed: design was the binding constraint, and **my own judgement about whether a fix worked was not reliable enough to be the measurement.** Full sub-metric table in `out/gate2-report.txt`.
> - Fixing that exposed three metric bugs, now corrected: `blobIndex` computed row-width variety and then ignored it, so a **rectangle scored 0.956** — higher than either pistol. `silhouetteComplexity` used perimeter-over-area, which is scale-dependent and scored both drafts near zero; rewritten as perimeter-over-√area, which exposed a second problem (it saturated at 1.0 for every character), so it is now a **band** with a thin-run penalty: a checkerboard scores 0, a 1px bar scores 0, a disc scores 1 at any size. And **negative space was not part of `craftScore` at all** — a design failure of exactly this kind went unmeasured. It is now a weighted component.
> - Blind style naming: **awaiting human review.** That half of the gate is yours, not the engine's.

### Phase 3 — the hard test, early: a character with personality — **stage 1 authored and measured; BLOCKED ON YOUR SILHOUETTE REVIEW**
Rig with per-direction joint anchors, key-pose templates, skinning, cel offsets, foot baseline, `loop_validate`, contact sheets, GIF preview — applied to the hardest case, not the easiest.
> **Gate:** a 16×32 character with a **declared personality**, 4 directions × 4-frame walk. Reviewed **by you** twice: once at the unshaded silhouette stage, once at playback. Contact sheet shows stable silhouette and stable foot anchor; playback reads as walking, not sliding; arm swing opposes leg swing; `loop_validate` reports no merged silhouettes and no anchor drift. **This is the decisive experiment in `docs/10` §7 — it should run before the engine is considered finished, not after.**
> **Stage 1 (`node bench/gate3-character.js`):** **Pim, the late courier** — personality declared before any pixel (apologetic, flustered, permanently in a hurry; a body too small for the equipment it carries; primary read "a head on top of a bag, with boots underneath"; exaggerated satchel and two-sizes-too-big boots; focal accent the brass buckle; family `organic_tapered`). Three silhouettes authored in one colour at 16×32 — front, right, back — with the fourth facing derived by the engine's mirror rather than drawn a second time. All three conform to `assert_style` for a `character` at 32px; enclosed negative space 19 / 11 / 18 px; no orphans; blob 0.908 / 0.975 / 0.911; shape 0.746 / 1.0 / 0.762.
>
> **What the measurement is complaining about, and what it is asking you:** the front and back silhouettes score visibly lower on shape than the side view, and the reason is measurable — both sit at compactness ≈ 10.6, driven by the **one-pixel-wide columns of air that separate the arms from the torso**. Those slits are what make the arm read as an arm at 16px wide, and they are also what makes the silhouette fragile at 1×. Widening them costs body width this character does not have. That is a design call, not a mechanical one, so it is yours.
>
> Stage 2 — four walk frames per facing, joint anchors, timing, `loop_validate`, playback GIF — **did not start until the silhouette had been measured and its defects written down**, because shading is how a wrong silhouette hides. It has now been built, and two structural defects were found in it that no metric had caught. See below.
>
> **Stage 2 (`node bench/gate3-walk.js`):** 17 authored part cels (679 px) across three authored facings, the fourth derived by the engine's own mirror; four poses (`contact` / `down` / `passing` / `up`) authored once and reused across every facing, with the per-facing stride in `dirMods`; 16 composed frames; timing 38/28/18/43 ms, a 127 ms cycle at 8 fps — a hold is a longer duration, never a duplicated frame. **`loop_validate` passes all four facings** (foot baseline spread 0 everywhere, anchor spread ≤ 1 px, no collisions). **`export_gate` would allow export.** Contact sheets in silhouette and colour, plus a playback GIF at real fps.
>
> **Two design calls made from the stage-1 measurement, recorded rather than quietly applied.** The front view's satchel and right arm were one mass, so he had no visible right arm — the bag moved below the hand and the arm kept its own column of air. The back view adopted variant B (bag on the back): it measured higher (shape 0.802 vs 0.762, blob 0.954 vs 0.911) and it answers "what is he carrying?" from behind. Variant A stays in the record as a rejected option.
>
> **What stage 2 actually caught, in order, because it is the useful part:**
>
> 1. **Shading each part inside its own bounding box creates seams when the rig moves it.** An arm lit from its own left edge landed beside a torso dark on that side: `ramp_jump`, a 3-step split between two neighbours of one material, appearing only in the moved frames. Fixed by modelling each *region* across its own extent and then bridging part boundaries on the composed frame — the audit's own prescribed fix, applied where the seam exists rather than pre-compensating every part for every pose it could be put into. 97 seam pixels re-stepped across 16 frames.
> 2. **A 52 px leg modelled in 2 of 3 boot values.** `flat_mass`. The cause was measuring a ramp across the region's *bounding box*: a leg two columns wide for most of its height sits in the middle of that box and never reaches either end of its ramp. Fixed by measuring each row across its own filled extent.
> 3. **A figure with six rows of nothing between it and its boots.** The torso ended at row 19; the legs started at row 26. **It audited clean.** `detached_speck` only looked at 1–2 px specks, so 24 px of floating leg passed. I only found it by reading the composed frame — which is exactly the expensive human attention this whole layer exists to spend elsewhere. So the audit gained a rule: `disconnected_mass` — any mass over 2 px that is not 4-connected to the main silhouette is a refusal, exempt only for background and system tiers. Tests assert it fires on a detached limb, on a diagonal-only touch, and not on the same figure with the limb joined.
> 4. **That new rule then refused 4 of 16 frames, and named the wrong suspect first.** The satchel left the body when it swung. Then the diagnostic printed the components and it was not the bag at all: it was **both legs** — the side-view stride (`dx -2 / +2`) moved each leg's entire top edge outside the four columns of hip the coat hem covers. A leg detaches from a body by an animation offset, not by a drawing error, and no still frame shows it. Fixed by bounding the stride to what keeps each leg's top row inside the hip columns in every frame, and by giving the front-facing bag a whole top edge on the belt row instead of a one-column strap (which `cross_material_aa` correctly refused: one column of leather between two columns of cloth is how anti-aliasing looks).
>
> **What is still weak, stated before asking:** the **front facing is measurably the worst of the four** — shape 0.43–0.52 against 0.82–1.0 for the side and 1.0 for the back, blob 0.82–0.91. It is the widest silhouette (14 of 16 columns) and the most rectangular. The side view is the one that reads as carrying something; the front reads as a coat with boots under it. The front and back strides swing the arms *vertically* rather than sideways, because a horizontal arm swing at the front fills the air column that separates arm from torso and fuses the two masses — so the front walk is a bob, not a swing.

### Phase 4 — illustrative design: a weapon family — **DONE, gate PASSED (measured)**
Ten weapons in one declared shape family, each with a stated exaggerated feature and focal accent, at 32×32. The test is whether the set has clear design variety inside a consistent language.
> **Gate:** all ten read at `squint`, all ten pass `negative_space_index` and `feature_budget`, all ten are recognisably one family, and no two exaggerate the same feature.
> 
> **Result: all seven claims passed.** One declared coordinate carries the whole set: `arsenal-plate`
> (side view, art_scale 32, complementary-shadow temperature, selective-dark edges, ramp-lit shading,
> light vector shared with the Phase 6 street so the two sets sit in one world). Ten members:
> spring maul (collar size), rivet driver (shank reach), breach hammer (head mass), gibbet saw (tooth count),
> cage brace (wall thickness), ember wrench (jaw span), pulley crossbow (winch bulk), slot bayonet (blade length),
> lantern clamp (fastener density), great maul (grip scale). Each exaggeration is answered inside the family
> language instead of left as a distortion: an oversized head gets a socket forged as deep as it is wide; an
> over-long blade gets a socket barely deeper than its own collar; a fifteen-cell grip gets a thirteen-cell head.
> Measured on the authored pixels: corners chamfered on all ten, mass distribution `even` on all ten with ratios
> 0.80–1.18 from each declared grip anchor, straight-run share 0.64–0.66, craft 0.771–0.869 (breach hammer and
> spring maul at hero, the rest support), negative space and feature budget passing on all ten, audit clean on all
> ten, contact sheets for view / squint / silhouette / value_map over the set, and committed grids under
> `art/weapons/` re-authored byte-identical by the engine on a clean run. Readable letter-form previews of every
> member are in `out/gate4/preview/*.txt`; per-member sub-metric tables are in `out/gate4-report.txt`. The review
> step is still yours: the family has been measured, not looked at by you yet.
> 
> **What this family is measurably weak at:** cluster character is the worst sub-metric on every one of the ten
> (0.039–0.30 against 0.63–1.0 elsewhere) — an exposed mechanism breaks a silhouette into small clusters rather than
> slabs, which is exactly what `cluster_character` penalises; four members also sit at or below ~0.55 on focal
> accent because their only accent is a bolt row rather than a plate. Neither fails a claim today, both are where
> a reviewer should look first.
> 
> **Two decisions this phase made, recorded rather than buried.** Weapons do not wear the Phase 6 street
> coordinate: style rules refuse perspective projection at art_scale 32, so this family declares its own side-view
> coordinate and shares only the light vector and the brass accent with the street. And machined members are
> authored as declared dimensions — wall thicknesses, collar widths, chamfer lists, fastener rows in one file per
> member under `bench/data/weapons/` — because hand-declared rectangles *are* how a machined object is designed,
> while organic assets stay cell-authored through `src/pim.js`. Every committed grid came out of those declarations
> through `src/author.js`; nothing was imported.

### Phase 5 — animation depth: 8 directions, full clip set, juice — **machinery DONE, art DRAFT**
8-way direction set derived from approved cardinals, idle / walk / run / attack / hurt / death, timing curves, event markers, hit-flash palettes, smear frames, impact squash. Timing is reviewed **at playback**, never defaulted.
> **Gate:** all 8 facings on one shared baseline in one contact sheet; switching direction mid-walk keeps pivot, height and phase; every clip shares frame count and timing; you approve the playback feel of at least two clips.

### Phase 6 — the world: tiles, props, scene coherence — **machinery DONE, gate PASSED (measured)**
16×16 tileset with autotiling (47-tile blob), seamless edges, constrained variants, multi-tile structures with footprints, global light palettes, per-scene ambient re-derivation, time-of-day and season ramps, contact-grounding rules — plus a **real playtest harness** (Godot or Phaser test scene) rather than a mock background.
> **Gate:** a 32×24 tile scene seamless under tiling and readable at squint; one authored character shown under three scene light states with no redraw; the asset running at 1× in the actual engine.

> **Result: all fourteen claims passed**, and the gate is what forced the point-of-view layer to exist. The corner house was designed in metres (a 4.9 m shop front, a wall receding from z=5.6 to z=14) and drawn *through* a declared camera — horizon row 150, vanishing point (300,150), focal 90, eye 1.62 m — then measured five ways against that camera by routes independent of the ones used to draw it: pixel extremes per column versus the projection formula, mean ramp step per distance band per material, edge intersections with the horizon, contact rows inverted back into z, and draw order derived from contact rows rather than from the order things happened to be painted. Shading is not a filter here: `faces_declare` compiles a light vector plus a face list into **ramp-step bands** (plaster's nine steps spend 6.5 of themselves on recession and leave two for form), and `face_shade` models each face across its own extent along both axes of the light.
>
> **The measurement had to bite, so five things were drawn wrong on purpose.** A parallel-projection version of the same building was refused (`flat_perspective`: far face 100 % where geometry demands 40 %); an edge that does not converge; repeated windows held at one size across three bays; a nearer cart drawn under the building; and a declaration where the light outranks the atmosphere (`lightWeight=1` put the *farther* face higher up the ramp). Each refusal named its rule.
>
> **Running this gate found six engine defects, all now fixed and pinned by tests:** `ops.glow` allocated the *darkest* step of a light ramp at a lamp's core and its brightest at the rim (every lamp in this engine had a hollow centre); `saveRender` did not create the directory implied by a grouped render name; `depthMonotonic` failed a material that appears at only one distance, which is not a comparison; `faceRecipe` silently ignored the distance each face declared unless a separate bands array was passed; `groundConvention` clamped its sample rows at the declared near row, which hid the entire scale drift it exists to report (it now reports 4.05× disagreement at the foreground edge instead of hiding it); and `structure_floats` could not compare ground contact with the horizon for a placed cel because there was no way to move the camera into the cel's own coordinates — hence `localCamera`.
>
> **What this gate does NOT claim, stated rather than hidden:** only 2 of 47 autotile blob slots are authored (the field tiles plus one boundary tile), so `tileset_audit` reports the set as incomplete and it stays reported; there is no skyline above the horizon row, so the scene's far plane is currently camera maths rather than art; the corner house misses the published craft bar for silhouette complexity at art_scale 128 (0.04 against 3) because a flat-faced building has no silhouette variety yet — no roof mass, no parapet, window surrounds still unbuilt; and I shrank the drawn ground from the gate's written 32×24 to **32×16 tiles**, because past five tiles below the meeting row a fixed 16 px tile disagrees with this camera by up to nine times per world unit. That deviation is a design decision made from a measurement, recorded here.

### Phase 7 — volume: prove the economics — **machinery DONE, gate not yet run**
Part library (heads, hair, torsos, limbs, footwear assembled into characters), material library, family templates, batch re-lint, tiered quality budgets.
> **Gate:** twenty NPCs assembled from the part library, and **asset #400 costs measurably less than asset #1**. If it does not, the engine has failed at the thing engines are for.

### Phase 8 — coverage completion: the space, proven not claimed — **AUTHORING UNDERWAY, GATE INCOMPLETE**
Work through the T1–T12 acceptance coordinates in `docs/08-coverage-matrix.md`, deliberately chosen to be as far apart as possible: 8×8 monochrome side-scroller, 16×16 warm top-down, 32×32 console-grade 8-way, 64×64 sculpted, 128×128 isometric with a full autotile set, an icon kit, spell FX, a 96×96 multi-part boss, a portrait, a bitmap font with emotes, a full UI kit, and one asset re-lit under three scene ambients. Related phases provide reusable machinery and partial examples; they do not substitute for a coordinate's full acceptance test.
> **Gate:** all twelve pass their own audit, have `silhouette` / `squint` / `value_map` renders inspected and approved by a human reviewer, and at least three are produced with no preset at all, purely by declaring a coordinate. Automated metric verdicts and saved renders are preflight evidence; they do not count as human visual approval. Presets are a convenience; coverage means the space works, not that a handful of saved coordinates work.

> **Current evidence:** modules are present for T1, T3, T4, T6–T9; the saved T1 run reports 6/6 automated claims. T2, T5, T10, T11 and T12 are not yet represented by coverage modules. No coordinate is marked visually approved in the coverage report, so no T-coordinate has passed the complete gate yet. T3, T4 and T8 do not count as covered merely because adjacent phases exercised some related machinery.

### Phase 9 — prove the advantage — **NOT STARTED**
Run the same small set of art tasks through PixelHand and a documented baseline (direct grid editing with the same model, plus an established editor workflow when available). Freeze prompts, style briefs and time/tool budgets before the run. Preserve every output and measure tool calls, elapsed authoring time, repair rounds, mechanical defects, export correctness, and blind visual ratings from reviewers who do not know which workflow made each result.
> **Gate:** PixelHand must produce outputs reviewers prefer at comparable effort, or reach comparable visual quality with less authoring and repair effort, across more than one style coordinate. Report failures and per-task results; do not turn a single aggregate score into a “best” claim. If it does not beat the baseline, use the results to simplify or redirect the product.

---

## 6. What I need from you to start

**Nothing about a game.** The build order is defined by the coverage matrix, and the first assets are *test coordinates* chosen because they are as far apart as possible — an 8×8 monochrome sprite and a 128×128 isometric structure, not two sprites from the same project. A game is only ever a coordinate declared inside a space that already works.

What I do need:

1. **Approval of the build order** — Phases 1→9 as above, ending with both the T1–T12 coverage gate and a comparative evaluation rather than stopping at internal claims.
2. **MCP install — DONE.** PixelHand replaces Texel in Zed's global `context_servers`; Zed forwards it to ACP external agents, including DSH and Pi. `project_open` switches to an existing game's PixelHand project without overwriting it. If an existing Zed thread does not show the tools yet, start a fresh thread or reload its MCP servers.
3. **A mood, not a style.** You do not need to know what the art should look like — that is the part we converge on together through option rounds. What actually helps is the part only you can supply: what the game should *feel* like. "Cozy but a bit melancholy" is usable input; "16-bit warm palette with selective outlining" is a decision the loop will produce.
4. **Which coverage test to run first.** My recommendation is T2 (16×16 warm top-down, 4-way walk) because it exercises shading, direction and animation cheaply — then T1 (8×8 monochrome) immediately after, because it is the coordinate where a weak engine is exposed fastest.
5. **Approval of the collaboration loop in `docs/11`.** Specifically: option rounds of ≤ 3 variants varying one axis each, ≤ 2 questions per asset, a plain-language style signature you confirm before the bible freezes, and `art/taste.json` persisting your accepted/rejected patterns across sessions. If you would rather review more often, or less, or in a different format, that is a design input to the review surfaces and I would rather hear it now than after 400 sprites.

### The one thing I would do before building any of it

`docs/10` §7: **draw one 16×32 character with a declared personality, 4-way walk, reviewed by you at the silhouette stage and again at playback.** It needs no engine — the probe codec is enough. If it comes out genuinely good with your direction, the plan is validated and the rest is engineering. If it comes out correct-but-lifeless even with review, the honest conclusion is that this engine is an excellent *consistency and volume* tool and a mediocre *author*, and the right plan becomes **agent-directs-a-human** rather than **agent-replaces-one**. That test costs hours, not a build, and it decides which product we are actually building.

---

## 7. Honest limits

- The first sprites will be **good, not perfect**. The system is built to converge: render → audit → correct → re-render. It converges because the loop is tight and the errors are measurable. It does not converge if you skip the renders.
- My spatial reading is reliable **with coordinates burned in** and unreliable without them. That is a measured property of my vision here, not a mood. The engine is designed around it.
- There is no automated visual critic available on this setup (0 classifier/image models). Quality judgement is me plus deterministic rules. That is workable, and it is why the render modes in `docs/04-vision-loop.md` are the heart of the design rather than an afterthought.
- Style drift over a long project is the classic failure mode of generated art. Mitigation is structural: a locked bible per game plus `assert_style` on every asset, so drift is a build failure rather than a surprise at the end.
- **Self-review is the weakest link in the system.** The model that made the error reviews its own error. Draft 1 of the pistol looked acceptable until it was forced through a critical pass. Human review at cheap checkpoints (one silhouette contact sheet per design decision, one playback per clip) is a gate, not a courtesy.
- **The quality bar must not be circular.** Our own golden corpus can only ever be as good as our own standard. The bar has to be external and measurable: craft targets expressed as numbers, plus measurement-only analysis of reference art *you own*, quarantined from the asset tree.
- **“Best” is not established by passing our own gates.** Coverage and craft gates show that the engine meets its declared requirements; they do not show it beats a simpler workflow. Phase 9 is the comparative test required before making that claim.
- **This engine will not reliably invent a distinctive visual identity.** It can execute a design language you define, amplify it, and keep 400 assets consistent with it. The novel design decision — the one that makes an art director say "that's a look" — is where it is weakest. That gap remains a central design challenge, separate from mechanical correctness and consistency.
- **Originality is an engineering property here, not a promise.** No third-party sprite, palette or reference image is stored in this repo; `import_png` requires declared provenance and quarantines what it imports; per-asset provenance metadata is computed from edit history and travels in every export manifest. Full policy: `docs/07-provenance.md`.
