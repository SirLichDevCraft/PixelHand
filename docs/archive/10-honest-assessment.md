# 10 — Honest assessment: what can this engine do well?

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


**Short answer: the architecture is the right shape, and the vision loop is the correct core. But as originally written this plan would not reach a strong craft bar, because it optimises infrastructure and treats the drawing as if it would just happen. I tested that assumption directly and it failed — informatively.**

Confidence, stated as numbers rather than mood:

| Claim | Confidence |
|---|---|
| The engine architecture (indexed cels, text grids, labelled renders, deterministic audit) is correct | **High.** Verified by measurement, and independently by prior art in this space. |
| The vision loop converges | **High.** Demonstrated: draft 1 → diagnosis → draft 2, one iteration, large improvement. |
| The plan as written reaches commercial-indie quality | **Low.** It has no design layer, and design is where it broke. |
| With the `docs/09` corrections it reaches *good* commercial-indie quality | **Moderate.** Unproven; the corrections are plausible, not measured. |
| It reliably invents a distinctive visual identity fully autonomously | **Low.** Distinctive illustrative design across a large asset set is the hardest thing in the medium. |
| Agent + your art direction can reach a distinctive and cohesive result | **Moderate.** This is the version I would actually bet on. |

## 1. The evidence

`probe/draw-pistol.js` → `probe/draw_pistol_32.png`: 12 colours, all on-palette, ramps walked not filtered, light direction correct, outline generated, only 7 lone pixels. **Every mechanical metric healthy. It read as a lump.** No negative space, grip too wide and too vertical, frame merged into the slide, sights as blobs, no readable muzzle, trigger guard a solid mass.

`probe/draw-pistol-v2.js` → `probe/draw_pistol_v2.png`: same palette, same tools, same rules. Only the **design intent** changed — one clean slide mass, a 7px grip angled back, a thin frame, a guard loop separated from the grip by 3px of air, a muzzle face with a bore, 1px sight nubs. **It reads as a pistol.**

That is the whole finding in two images: the plumbing was never the constraint. Draft 2 is decent, readable, coherent — and still generic. Getting from "correct" to "characterful" is a design jump, and my plan had no mechanism for it.

### 1A. Correction, measured after the Phase 1–2 gates

The paragraph above is slightly overstated, and the engine is the reason I know that.

Running `bench/gate2-style.js` re-measured both pistol drafts with the craft layer rather than with my eyes:

| | draft 1 | draft 2 |
|---|---|---|
| aggregate craft | **0.772** | 0.769 |
| `blob` (lumpiness) | 0.801 | 0.879 |
| `shape` (silhouette complexity) | 1 | 1 |
| `space` (enclosed negative space) | **0** | **0** |
| `focal` (accent actually placed) | **0** | **0** |
| `clusters` | 0.487 | 0.321 |

**Draft 2 has zero enclosed negative space.** Its trigger guard was reshaped but never closed — the pocket between guard and grip connects to the outside through a one-pixel leak, so there is no hole. The thing I claimed draft 2 fixed, draft 2 did not fix. "It reads as a pistol" was true of my reading of it; `negativeSpace` disagrees about the guard.

Three things follow, and all three are now fixed in code rather than in prose:

1. **`negativeSpace` was not part of `craftScore` at all.** A design failure of exactly the kind Phase 0.5 was supposed to have learned about was unmeasured. It is now a weighted component.
2. **`blobIndex` computed row-width variety and then ignored it.** A plain rectangle scored **0.956** — higher than either pistol. A metric that rates a rectangle above a designed object is not measuring what its name says. Variety now counts, and a rectangle scores 0.
3. **`silhouetteComplexity` used perimeter over area**, which is scale-dependent: a large solid mass looks "simple" merely by being large. Both drafts scored ~0.17, so the metric could not discriminate between anything. It is now perimeter over √area, which is scale-invariant (a disc sits at 3.54 at any size), and the two drafts separate cleanly.

The aggregate still ranks draft 1 **above** draft 2, which is the honest answer and not a comfortable one. The sub-metric that matches the diagnosis — `blob`, lumpiness — favours draft 2 by 0.078. But `form`, `light`, `value` and `outline` are saturated at 1.0 for both drafts and therefore carry no information, while `clusters` penalises draft 2 for the 13 lone pixels its added sights and guard introduced (draft 1 had 7). **An aggregate that ranks the worse design higher is not a gate; the sub-metrics are the gate**, and `craft_metrics` now returns the full sub-table so the disagreement is visible instead of averaged away. Weighting the aggregate until it agreed with me would have been fitting the test.

A third finding, unmeasured before this gate ran: **both drafts score 0 on focal accent.** Neither palette declares an accent role, so neither drawing has anything declared as the thing to look at. That is the "correct but generic" problem above, reduced to a number.

The Phase 0.5 conclusion survives, but narrower and truer than I wrote it: design was the binding constraint, and **my own judgement about whether a fix worked was not reliable enough to be the measurement.** That is a stronger argument for the engine than the original claim was.

## 2. What the plan gets right

1. **The vision loop as the core.** Correct, and it is the thing most attempts in this space get wrong.
2. **Hand-authored character grids instead of coordinate lists or formulas.** Verified twice — once by my own failed walk cycle, once by prior art that reached the same conclusion the hard way.
3. **Coordinate-addressed renders.** Measured: unlabelled I misread a cell; labelled I was 8/8 exact. That single fact makes single-pixel correction possible.
4. **Deterministic audit for mechanical errors.** Correct division of labour: rules catch the 200 small mistakes so judgement is spent on the 3 big ones.
5. **Style as an enforced constraint set**, and a nine-axis space rather than a preset library.
6. **Pose-first animation with a rig, direction sets and a shared rhythm**, and `loop_validate` as an export gate. My walk cycle is the counter-example that justifies every one of those.
7. **Provenance gating built into the tool surface**, not bolted on as policy.
8. **Zero-dependency codec, disk as source of truth, CLI fallback.** Boring and correct.

## 3. What the plan gets wrong, or left out

| # | Problem | Why it matters | Fix |
|---|---|---|---|
| 1 | **No design layer at all.** The plan is 14k words of architecture and almost nothing about silhouette, negative space, proportion, exaggeration or shape language. | Draft 1 proved this is the actual failure point. | `docs/09`: silhouette-first review, `negative_space_index`, `feature_budget`, `exaggeration_axis`, `shape_family`, focal accent. |
| 2 | **The quality bar is circular.** I removed third-party reference art (correctly) and said "our own golden corpus becomes the bar." Our own output can never exceed our own standard. | Without an external bar, drift looks like success. | External *measurable* craft targets (colours per scale, ramp step counts, cluster statistics, silhouette complexity) derived from published technique; plus **you may supply art you own** for measurement-only analysis, quarantined from the asset tree. |
| 3 | **Self-review is the weakest link.** The model that made the error reviews its own error. Draft 1 looked fine to me until I was forced to look at it critically. | Unbounded self-review converges on "plausible", not "good". | Human review as a **gate** at cheap checkpoints: one silhouette contact sheet per design decision, one playback per clip. Not optional for Hero-tier assets. |
| 4 | **Volume economics unproven.** I quoted 900–1,500 calls for one 8-way character. A complete game needs *hundreds* of assets. | Without part libraries and tiering, the project dies of cost before it dies of quality. | Part library + material library + family templates + the four-tier quality budget in `docs/09`. Asset #400 must be cheaper than asset #1 or the engine has failed. |
| 5 | **No scene coherence system.** My plan had per-sprite palettes and one ambient axis, with no world-level consistency for light, season, biome or grounding. | A game of individually good sprites in a disjoint world looks bad. | Global light palettes, per-scene ambient re-derivation, time-of-day/season ramps, contact-grounding rules. |
| 6 | **No in-engine validation.** `game_scale` is a mock background. | Art is finally judged at 1×, moving, with lighting and particles and a camera. A mock never catches that. | A real playtest harness (Godot or Phaser test scene) as part of the pipeline, not an export afterthought. |
| 7 | **Timing feel is my weakest sense.** I can measure anchor drift and frame counts. I cannot *feel* whether 12 fps is right. | Animation quality lives in timing. | Expose timing as an explicit tunable you review **at playback**, with a GIF per clip. Never let timing be a default. |
| 8 | **Coverage tests were ordered wrong.** T1–T12 put the hardest things (boss, isometric structure) late. | The hardest thing is a *character with personality* at 16×32 that reads while moving, and illustrative item design. | Run the hard cases early. A generic-but-correct sprite proves nothing; a characterful one proves everything. |
| 9 | **No "juice" vocabulary.** Hit flash, smear frames, impact squash, anticipation longer than action. | Animation feel depends on authored frame tricks as well as code. | Add them as first-class art operations with palette-legal implementations. |
| 10 | **Full autonomy was assumed as the goal.** | It is the *hardest* path, not the best one. | Make **agent authors, you direct** the default mode. Agent gets an asset to 80%, you make the two calls that make it yours. |

## 4. Alternatives, honestly weighed

| Route | Verdict |
|---|---|
| **Build our own engine** (this plan) | **Right choice.** Full control of the seeing loop, style enforcement, provenance, and the authoring primitive. Cost: we build the craft rules ourselves. |
| **Drive Aseprite headlessly** | Mature tool, but paid, not installed, adds a Lua codegen layer, and is explicitly designed for an agent that *cannot see*. We can see; that inverts the design. Keep only the export compatibility. |
| **AI pixel-art generators** (Sprite Fusion, Sprite AI, PerfectPixel and similar) | **Correctly rejected.** They cannot produce hand-placed, style-consistent, directional, animated art on a locked palette — and they destroy the provenance story you just asked for. |
| **Buy asset packs / hire an artist** | Rejected by your premise, and it re-opens the licensing question you closed. |
| **Agent authors, human finishes in Aseprite/Pixelorama** | **The highest-quality path, and the plan should treat it as first-class rather than as a fallback.** Export to an editable format, you polish the 10% that requires a human eye. |

## 5. What this system can and cannot realistically do

**Can do well:** mechanical correctness and consistency at volume; palette and ramp discipline; style coherence across hundreds of assets; readable silhouettes; correct direction sets and shared animation rhythm; legible UI and icons; seamless tilesets; anything where the failure mode is *error* rather than *absence of taste*.

**Can do adequately:** pose-quality animation with rig and key poses; exaggerated silhouettes when the exaggeration is specified; characterful design when given a design brief and review.

**Cannot do, honestly:** it will not reliably invent a distinctive visual identity. It can execute a design language you define, amplify it, and keep 400 assets consistent with it — but the *novel* design decision, the one that makes an art director say "that's a look", is where it is weakest. Distinctive visual identity remains an open design challenge.

## 6. Recommended revised build order

1. **Phase 0.5 — done.** Can I draw? Answer: the loop converges; design is the constraint. Evidence in `probe/`.
2. **Phase 1 — body.** Codec, buffer, `pixel_map`, labelled `view`. Unchanged.
3. **Phase 2 — craft rules before style presets.** Implement `docs/09` metrics (`negative_space_index`, `feature_budget`, `exaggeration_axis`, `shape_family`) *alongside* the axis space, so style and craft are enforced together from the start.
4. **Phase 3 — the hard test, early.** A 16×32 character with a declared personality, 4-way walk, reviewed by you at silhouette stage and at playback. This is the real quality test, and it should come before tilesets, not after.
5. **Phase 4 — item design.** Ten weapons in one family, each with a declared exaggerated feature and focal accent. This tests variety within a shared visual language.
6. **Phase 5 — animation depth.** Full clip matrix, timing review at playback, juice operations.
7. **Phase 6 — world.** Tiles, autotiling, scene lighting, in-engine playtest harness.
8. **Phase 7 — volume.** Part library, material library, tiered quality budgets; prove asset #400 is cheaper than asset #1.
9. **Phase 8 — coverage.** T1–T12 from `docs/08`, with the hard cases already covered by Phases 3–4.

## 7. What would change my answer

If you want a *proven* answer rather than a reasoned one, the decisive next experiment is small and cheap:

> **Draw one 16×32 character with a declared personality, 4-way walk, reviewed by you at the silhouette stage and again at playback.**

If that comes out genuinely good with your direction, the plan is validated and the remaining work is engineering. If it comes out correct-but-lifeless even with review, then the honest conclusion is that this engine is an excellent *consistency and volume* tool and a mediocre *author* — and the right plan becomes agent-directs-a-human rather than agent-replaces-one.

That test costs a few hours, not a build. It should happen before we write the engine.
