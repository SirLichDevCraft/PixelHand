# 03 — Animation: rigs, key poses, direction sets, timing

> Historical design notes. Proposals and status claims may be superseded. See the [current guide](../guide.md), [roadmap](../../PLAN.md), and [asset policy](../provenance.md).


The requirement is the hard part: **high-detail sprites, with animation frames, with directions, with animations per direction.** This document is how that is done without the result collapsing into sliding rigid shapes — which my Phase 0 attempt proved is the default failure.

---

## 1. Direction sets

Chosen per game at `project_init`, then **frozen**.

| Set | Use | Notes |
|---|---|---|
| **4-way** | top-down, side-scroller | S, N, E, W. E and W are true mirrors *only* after an asymmetry audit. |
| **6-way** | 3/4 top-down, no flat profile view | SE, S, SW, NW, N, NE. The camera never sees the subject dead-on from the side. |
| **8-way** | isometric, twin-stick, RPG | E, SE, S, SW, W, NW, N, NE. |

Row order is declared once in `sprite.json` and never reordered — engines do not know what a row means, so the order is a contract with the game code and the manifest.

### How diagonals get made

1. **Author and approve the cardinals first.** Front, back, left, right neutral poses. Compare total height, shoulder width, head size, foot placement and palette across them. This step exposes almost every design contradiction, and fixing a wrong side silhouette in one still is far cheaper than fixing it in six walk frames across two directions.
2. **Derive each diagonal from its two neighbours.** `direction_derive({from: ["S","E"], to: "SE"})` proposes a starting cel from the two approved anchors plus a declared body turn. It is a *draft*, never the answer.
3. **Hand-correct by pixel map.** A down-right view must not become a front pose with the eyes nudged sideways. The torso, feet, hair and equipment all need a coherent three-quarter rotation. I repaint it.
4. **Track the asymmetric details.** A short sword is the detail that swaps sides if the facing views are mirrored. `mirror` runs an asymmetry audit first and reports what would move.

### Direction consistency checks (engine-enforced)

- Same total height, shoulder width, head size and foot placement across the direction set.
- Same palette usage profile per direction (a rear view that uses 9 extra colours is a mistake, not a style).
- Shared baseline row for every facing.
- Light direction constant across all facings — the brightest cluster must stay on the declared light side as the body turns.

---

## 2. Rigs and poses

A **rig** is a declared skeleton in art pixels: joint positions per direction, limb widths, and a locked foot baseline.

```jsonc
// art/rigs/hero-rig.json
{
  "id": "hero-rig",
  "directions": ["S","SE","E","NE","N","NW","W","SW"],
  "baseline_row": 23,
  "joints": {
    "hip":    { "S": [8, 15], "E": [8, 15], "N": [8, 15] },
    "knee":   { "S": [8, 19], "E": [7, 19] },
    "ankle":  { "S": [8, 22], "E": [7, 22] },
    "shoulder": { "S": [5, 10], "E": [6, 10] },
    "elbow":  { "S": [4, 13], "E": [5, 13] },
    "head":   { "S": [8, 6],  "E": [8, 6] }
  },
  "limbs": { "upper_arm": 2, "forearm": 2, "thigh": 3, "shin": 2, "foot": 2 },
  "parts": ["body", "cloth", "hair", "held"]
}
```

A **pose** is a set of joint positions plus a body height and a weight note. Poses are authored once per direction and reused across clips.

For a walk cycle, poses may also declare a local `gait` phase and the rig may set `gaitStride`. The composer projects that phase along the facing vector (down moves on screen Y, right on screen X, diagonals on both), counter-swings arms against legs, and carries a held blade with its hand. Parts attach to named pivots such as `hip`, `shoulder`, `head`, and `grip`; `gaitParts` can make a limb hinge around its root instead of shifting the whole cel. Per-direction `zOrder` places far limbs behind the torso and near limbs in front. A body pose can select different cels for its legs with `partPoses`, so one foot can plant while the other swings. This gives hand-drawn pixel parts a small 2.5D skeleton instead of applying the same screen-space nudge to every facing. Major changes of limb bend still use authored pose cels.

```jsonc
// poses for a walk, per direction
{ "contact":  { "height": -1, "legs": "widest", "note": "heel down, lowest point of the cycle" },
  "down":     { "height": -1, "legs": "weight landing", "note": "body sinks as it absorbs the step" },
  "passing":  { "height":  0, "legs": "legs crossed", "note": "body at its tallest" },
  "up":       { "height":  0, "legs": "about to fall", "note": "full height, pre-contact" } }
```

**`skin_pose`** is the step where I compose a pose. Each direction has base part cels, and `skin_define` can add a pose-specific cel for any part with `{direction, pose, name, cel}`. That lets a contact pose redraw bent legs and a passing pose redraw crossed legs while reusing the unchanged body or equipment. The engine selects the pose cel, inherits its base joint and pivot, then applies any small authored offset. It does not morph pixels between poses. Include `sprite` in `skin_define` to save the skin definition and part grids into the project so they can be rebuilt after reload.

Use `motion_report({clip})` after composition. It compares each part's authored shape and placement across frames, reports which parts vary, and flags a walk where the legs or arms never change. `loop_validate` includes the same coverage check for rig-composed frames. This catches a technically smooth loop whose motion is concentrated in the head or one prop.

Why a rig at all, if I paint by hand anyway:

- It is what keeps a knee in the same place across 8 directions × 4 frames = 32 drawings.
- It makes limb *widths* and *joint counts* consistent, which is what makes a character read as the same character.
- It gives the audit something to measure against: `anchor_drift`, `silhouette_delta`, and "the head moved 3px while the feet stayed put" become detectable facts.
- It is the only structure that makes an 8-direction × 6-clip set tractable at all.

---

## 3. Clip templates

Each clip type carries a template: key poses, frame budget, mandatory motion per body region, and default timing. Templates are starting points I override, not generators.

| Clip | Key poses | Frames | Mandatory motion | Default fps |
|---|---|---|---|---|
| `idle` | breathe, weight-shift | 2–4 | chest rise, one blink cycle, slight head drift | 8–12 |
| `walk` | contact, down, passing, up | 4–8 | legs alternate; **arms oppose legs**; head bobs on a curve not a square wave; feet stay planted | 12 |
| `run` | contact, passing, airborne | 4–6 | forward lean, airborne frames must actually be airborne, smear on the fast limb | 16–20 |
| `attack1` | anticipation, action, recovery | 3–6 | anticipation must be *longer* than the swing — this is where weight reads | 12–18 |
| `hurt` | impact, recoil | 2–3 | silhouette must change shape, not just position | 16 |
| `death` | impact, fall, settle | 3–6 | contact shadow must track the body | 10 |
| `interact` | reach, hold, retract | 2–4 | held item must stay attached to the hand cel | 10 |

**Frame budgets are deliberate.** Idle 2–4, walk 4–8, run 4–6, attack 3–6, jump 2–3. Past 12 frames is rarely worth the redraw: more frames mostly means more art to redraw every time the timing changes, and at small sprite sizes the eye barely notices the extra in-betweens. A four-frame walk at the right fps reads smoother than an eight-frame walk at the wrong one.

---

## 4. Timing is an asset, not a default

Two numbers define an animation, and neither is a frame count:

- **how many frames you draw** — how much information exists,
- **how fast they play** — how that information feels.

The same 8 frames at 12 fps loop in about two-thirds of a second, close to a real stride. The same 8 frames at 24 fps look like a shuffle.

Engine support:

- `timing_apply({clip, curve})` sets **per-frame durations**. It never duplicates a frame to fake a hold — a hold is one frame with a longer duration, which is honest in the data and cheap in the art.
- **Hold frames** are first-class: they sell weight and anticipation and cost no new art.
- **Event markers** (`event_add`) attach to frames: `footstep`, `weapon_peak`, `hitbox_active`, `sfx`. These are exported into the manifest so the game code drives feel from the art rather than guessing.
- **Cel offsets** carry the bob. A part moves; the foot baseline does not. This is the specific fix for the failure where my torso lifted and its legs stayed behind.
- **Sub-pixel motion** is metadata (`subpixel_offset`), baked at export as asymmetric edge weighting — not a runtime float position, which would break a 1× pixel grid.

---

## 5. `loop_validate` — the animation-specific audit

A still frame hides almost every animation fault. This tool measures the cycle:

| Check | Catches |
|---|---|
| `wrap_frame_duplicate` | the last frame is identical to the first, so the loop stutters |
| `pose_held_by_duplication` | a "pose" that is actually the same cel repeated |
| `placeholder_timing` | every duration identical, i.e. no authored rhythm |
| `anchor_drift` | the contact edge (feet) moves across frames |
| `centroid_jump` | the body's mass teleports between frames |
| `silhouette_merge` | disjoint parts collapse into one blob in one frame — the exact bug where my two legs became one column |
| `missing_opposing_motion` | a walk with no arm counter-swing, an attack with no anticipation |
| `frame_count_mismatch_across_directions` | the side walk has 6 frames and the down walk has 4, so turning feels uneven even though each loop looks fine alone |
| `missing_part_motion` | rig-composed walk frames leave the leg or arm parts unchanged, even when another part is moving |
| `phase_offset` | one direction advances a frame early, so it reads faster at the same playback rate |

`loop_validate` is a **gate**, not a report: a clip that fails it cannot be exported.

---

## 6. Direction × clip matrix

For one character in one game, the real deliverable is a matrix. This is what "animations for those directions" costs, honestly:

| | 4-way | 6-way | 8-way |
|---|---|---|---|
| cels for a 4-frame walk | 16 (8 after mirroring) | 24 | 32 |
| cels for idle + walk + run + attack + hurt + death | ~64 | ~96 | ~128 |
| tool calls to author + review + fix | ~400–700 | ~700–1,100 | ~900–1,500 |

Mitigations that are built in rather than improvised:

- **Cel linking** — a frame that genuinely shares pixels with another frame links to the same cel, so a fix propagates instead of being applied 32 times.
- **Cardinal-first authoring** — half an 8-way walk is derived from four approved cardinals and then corrected, not invented eight times.
- **True mirroring** where the asymmetry audit permits it, which halves a 4-way set immediately.
- **Contact sheets as the review unit** — reviewing 8 facings in one render is one look, not eight.

---

## 7. Reviewing animation with my own eyes

Measurement catches the mechanical faults. Pose quality is mine, and it needs the right renders:

- `contact_sheet` — every frame of every direction, one image, labelled, on a shared baseline. This is the single most useful render in the whole system.
- `play` — an actual GIF/APNG at the target fps, because a cycle that looks fine frame-by-frame can still read as a shuffle at 24 fps.
- `onion` — neighbours ghosted warm/cool behind the current frame, which is how a one-pixel jump between poses becomes visible.
- `silhouette` — every frame flattened to two colours. If the pose is readable only because of colour and detail, it is not a readable pose. This is the fastest way to find a walk that is really just sliding.
- `diff` between consecutive frames, bucketed into pixels that entered/left the silhouette, pixels repainted inside it, and pixels that changed only alpha.
