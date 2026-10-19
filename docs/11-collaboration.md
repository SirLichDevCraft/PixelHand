# 11 — Collaboration: the style is built from your choices, not my guess

The requirement: the model driving the engine must develop the visual style **with you**, not deliver one at you.

The design principle that follows is the one most art pipelines get wrong:

> **People cannot specify a visual style in words. They can recognise it when they see it.** So the loop must be *recognition-driven*, not description-driven. The engine's job is to make your reactions cheap to express and durable to record.

Nobody can answer "describe the style you want." Almost anybody can answer "not that one — that one, but less muddy." The whole system is built around that asymmetry.

---

## 1. The convergence loop

Each round varies **one axis** and presents a small, concrete option set. You react. Your reaction becomes a rule delta. Repeat until the coordinate is determined by your taste rather than my assumption.

```
I propose 3 variants along ONE axis      (one image, labelled A / B / C)
You pick one, or reject all three        (one tap, or one sentence)
Engine records the delta on the coordinate
Next round varies the next most uncertain axis
...
Converges in 3–6 rounds, then the style signature is written for you to confirm
```

Worked example, one session:

| Round | Axis varied | Options presented | Your reaction | Delta recorded |
|---|---|---|---|---|
| 1 | temperature model | A grey-shade · B warm/cool hue-shift · C complementary-shadow | "B, but the shadows are too purple" | `hue_shift.shadow: +18° → +9°` |
| 2 | outline policy | A none · B selective-dark · C full 1px | "A on characters, B on items" | `outline.policy: per-asset-class` |
| 3 | detail density | A pristine · B moderate · C dense-grain | "B, but the ground is too busy" | `detail_budget.ground: −30%` |
| 4 | palette magnitude | A 16 · B 24 · C 32 | "B" | `palette.size_cap: 24` |
| 5 | edge treatment | A hard · B 1px ramp AA · C dithered | "B, no dither on faces" | `aa.policy: ramp-adjacent` · `dither.forbidden_on: [face]` |

After five rounds the style exists because you decided it, five times, in answers you could actually answer.

**Rejections are as valuable as acceptances.** "Too muddy", "too busy", "too cartoonish" each map to a specific rule change. The engine treats a rejection as a constraint, not a failure.

---

## 2. Bounded, so it converges instead of churning

- **≤ 3 options per decision.** More than three is not a choice, it's a chore.
- **≤ 2 questions per asset.** Ask the two that change the most; decide the rest yourself and report what you decided.
- **One axis per round.** Varying three things at once makes your reaction uninterpretable.
- **Max 6 rounds per style**, then it locks. If it hasn't converged by then, the problem is not the number of options — it's that the brief is missing something, and I say so explicitly.
- **A default with veto.** "If you don't answer, I proceed with A and you can veto later." Respects your time; keeps momentum; nothing is silently locked.

---

## 3. A shared vocabulary, because you can see the problem but may not have the word for it

Most people perceive a defect before they can name it. So the engine ships a short craft vocabulary, and I use it *deliberately* so that over a project we build a shared shorthand.

| You might say | What it maps to |
|---|---|
| "muddy" | AA or dither crossing hue families; ramp steps too close in value → `aa_across_hue_family`, `min_step_delta` |
| "too busy" / "noisy" | detail budget exceeded; lone pixels; texture clusters too dense → `detail_budget`, `lone_pixel` |
| "flat" | insufficient value contrast; ramp too compressed → `value_contrast_min`, `value_map` |
| "cartoonish" | outline weight, exaggeration level, saturation curve |
| "cheap" | palette too small for the scale, or ramps collapsing |
| "floats" / "not on the ground" | missing contact shadow, anchor drift |
| "hard to read" | silhouette failure at `squint`; feature budget exceeded |
| "inconsistent" | shape family violation; material ramp not shared |
| "lifeless" | hue-shift absent (shades desaturating to grey), or timing uniform |

This table is not decoration. It is the interface.

---

## 4. Review surfaces designed for a human, not for me

A review pack is one image, three options, labelled, on a shared baseline, with a render stamp.

- **A/B/C contact sheet** — variants side by side, same subject, one axis different.
- **Silhouette pack first** — unshaded two-colour options. Shading decisions come *after* the shape is agreed, because shading on a wrong shape is wasted work.
- **Before/after diff** — when you ask for a change, you see exactly what changed, not a new image you have to compare from memory.
- **Playback GIF** — for any animation decision. Timing cannot be reviewed in a still.
- **Game-scale composite** — the option placed in the actual world at 1×, because a sprite that looks great on a grey checkerboard can be wrong in the game.
- **One decision per pack.** Never "here are 12 sprites, any notes?"

Each pack ends with a question you can answer in under ten seconds.

---

## 5. You can paint. This is not a one-way street.

Three genuine human-input paths, all first-class:

1. **Edit the grids directly.** Cels are text — rows of palette-index characters in `art/sprites/*/cels/*.grid`. You can open one in any editor and change pixels by hand. I re-lint, re-render, and continue from your edit. The format was chosen for machine authoring and it happens to be human-editable too.
2. **Round-trip through a real editor.** Export to an Aseprite-compatible sheet layout, you polish in Aseprite or free Pixelorama, re-import with provenance declared as `user-owned`. Your pixels stay yours; the engine re-keys and re-lints them onto the declared ramps.
3. **Your own sketches, analysed not traced.** You draw a rough shape, import it (`origin: user-owned`), and the engine *measures* it — silhouette area, negative-space index, cluster statistics, feature count, proportion relationships — then I author original art in that shape language. Measurement extracts the *design decision*; it does not copy the *expression*.

The last one is the honest version of "reference": your own art, your own copyright, used for analysis.

---

## 6. Taste memory: the style survives the session

Every accept and reject is recorded, not remembered conversationally.

```jsonc
// art/taste.json — written by the engine, read by every future session
{
  "style": "warm-topdown",
  "accepted": [
    { "axis": "temperature", "value": "hue-shift warm/cool", "note": "shadows toward violet but less than proposed" },
    { "edge": "1px ramp-adjacent AA", "note": "no dither on faces" }
  ],
  "rejected": [
    { "pattern": "full outline", "reason": "cartoonish", "applies_to": ["characters"] },
    { "pattern": "dither on ground", "reason": "too busy", "applies_to": ["terrain"] },
    { "pattern": "grey shadows", "reason": "lifeless" }
  ],
  "vocabulary": { "muddy": "aa_across_hue_family", "busy": "detail_budget" },
  "decided_by_agent": [
    { "axis": "palette magnitude", "value": 24, "reason": "you approved B" }
  ]
}
```

A new session resumes with the style already established. It does not re-derive it, and it does not re-ask questions you already answered. That is what makes a multi-week art project coherent instead of amnesiac.

---

## 7. Who decides what

| Decision | Owner |
|---|---|
| Mood, feeling, "is this the game I want to make" | **You**, absolutely |
| Silhouette and shape of a Hero-tier asset | **You** sign off before shading begins |
| Animation timing feel | **You**, at playback |
| Palette magnitude, temperature model, outline policy | **You**, via option rounds |
| Ramp construction, cluster rules, AA legality, dither legality | **Engine**, enforced |
| Mechanical correctness (lone pixels, off-ramp colour, anchor drift) | **Engine**, no human time spent |
| Support/background/system tier assets | **Agent** proceeds; you spot-check |
| Whether a coordinate is internally possible | **Engine**, refuses |
| Whether a style is *right* | **You**. Always. |

That last row is the point of the whole document.

---

## 8. Style signature — the confirmation step

When the coordinate converges, the engine writes it in plain language, not JSON, and you confirm or correct it:

> **warm-topdown.** Warm, saturated, soft-edged. No outlines on characters, a single dark edge on items. Shadows shift toward violet but stay close to the base hue. Chunky 2–3 pixel clusters; nothing floats alone. Anti-aliasing only between neighbouring ramp steps, never across materials. No dither on faces or silhouettes. Ground is calmer than props. 24 colours maximum per sprite. Light from the top-left, with a weak bounce from below.

If that paragraph reads like the game in your head, the coordinate is right. If it doesn't, the coordinate is wrong and we are still in the loop — and it is far cheaper to fix here than after 400 sprites.

---

## 9. MCP tools for the collaboration layer

| Tool | Args | Returns |
|---|---|---|
| ★ `style_options` | `axis, count: 3, subject` | one labelled A/B/C contact sheet + the axis values each option represents |
| ★ `style_pick` | `option: A\|B\|C, note?` | the recorded delta on the coordinate |
| ★ `style_reject` | `option?, reason` | the constraint derived from your rejection |
| `style_translate` | `plain_language: "too muddy"` | the specific rule changes it implies, and the render that demonstrates each |
| ★ `review_pack` | `subject, options, stage: silhouette\|shaded\|game_scale\|playback` | one image, ≤3 options, ≤2 questions |
| ★ `style_signature` | `style` | the plain-language description, for confirmation |
| `taste_read` / `taste_write` | — | the persistent preference record |
| `compare` | `a, b` | side-by-side with a changed-pixel report |
| `annotate` | `subject, notes: "x,y: too dark"` | applies your notes as authored pixel edits |
| `sketch_analyse` | `path, provenance: user-owned` | measured shape properties — never a trace |

`style_options`, `review_pack` and `style_pick` are the hot loop and are `direct`-exposure: I ask, you see, you answer, the coordinate moves.

---

## 10. Failure modes of collaboration, designed against

| Failure | Design response |
|---|---|
| Endless option churn | Max 6 rounds, one axis per round, then lock |
| "Make it pop" (unactionable) | I translate it into 2–3 concrete candidate changes and ask which — never accept a vague instruction and guess |
| You have no reference in mind | Start from axis *extremes*; rejecting is easier than specifying |
| Style agreed, then drifts per asset | Tiered sign-off + `assert_style` on every asset + taste memory |
| Your sketch is rough | Measure it, don't trace it |
| You have no time to review every asset | Tiering: Hero-tier needs you, background-tier does not |
| Style locked too early | Style signature confirmation step, and derivation lets us move one axis later with a full re-lint report |

---

## 11. What this changes about the plan

The collaboration loop is not a review stage at the end of the pipeline. It is **how the coordinate gets populated in the first place**. The nine axes in `docs/08` are the vocabulary; `docs/09` craft metrics are the enforcement; this document is the mechanism by which *you* end up owning the result.

Concretely: style bibles are no longer authored by me and handed to you. They are **accumulated from your decisions**, recorded in `art/taste.json`, confirmed as a plain-language signature, and then enforced by the engine on every asset forever after.

---

## 12. Round 1, actually run (`probe/collab-round1.js`)

Not a proposal — an executed round, with the failure included.

**Take 1 failed, and the silhouette stage caught it.** My first three masks read as *funnels*, not pistols. Diagnosis: the "slide" was 9–11px thick so barrel and grip merged into one wedge; there was no distinct horizontal barrel bar; the guard holes were 2–3px specks invisible at silhouette level; the shapes were taller than wide. All three options were bad, so the round was worthless — and I only know that because the unshaded render made it obvious instead of hiding it under shading.

**Take 2, authored as per-row run lists** (how a pixel artist actually thinks: "row 12, fill 8–28"), one axis varied — `exaggeration_axis`:

| | barrel band | grip | enclosed air | open air | verdict |
|---|---|---|---|---|---|
| **A** barrel-forward | **10px** | 6 × 8 | **0** | 33% | fails — barrel too thick, slide and grip merge into a brick; no guard loop |
| **B** grip-forward | **5px** | 12 × 12 | 0 | 42% | correct barrel proportion, widest air; guard is a hook not a loop |
| **C** accurate | 6px | 6 × 13 | **7** | 50% | only real guard loop; grip reads as a stick, not a handle |

The round produced a usable result: **B's proportions plus C's guard loop** is the synthesis for round 2 — a conclusion that exists only because the options were separated and measured. A single "here's my pistol" would have hidden all three findings.

Two things this proved about the mechanism:

1. **The metrics have to be part-aware or they lie.** My first barrel-thickness measure returned 10px for all three options because a naive vertical run follows the guard where it joins the barrel. The fix — define the barrel as *the band of rows spanning ≥ 60% of the bounding-box width* — is a real engine feature (part decomposition), not a display trick. A metric that lies is worse than no metric, because it makes a bad choice look defensible.
2. **Silhouette-first is not ceremony.** Take 1 would have looked acceptable once shaded. Rendering it unshaded and two-tone is what made three failures visible in one image.

Recorded in `art/taste.json` with `decision: pending` — because the decision is yours, not mine.
