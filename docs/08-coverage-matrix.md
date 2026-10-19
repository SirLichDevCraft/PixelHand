# 08 — The coverage matrix: the engine owns the space, a game is a point in it

The design axis is not "which game". It is a **parameter space**, and the engine must be able to produce credible, internally consistent art anywhere in it. A project picks a coordinate; the engine validates that the coordinate is even possible, then enforces it.

**Diversity is a specifiable thing.** Below are the axes, their value domains, the interactions the engine must know, the asset classes that must be covered, and the acceptance tests that prove coverage rather than assert it.

---

## 1. The axes

Each axis is a declared, validated domain. A style bible is a coordinate across all nine.

### A. Projection / camera
`top-down-orthogonal` · `top-down-3quarter` · `side-scroller` · `isometric-2to1` · `dimetric` · `oblique` · `flat-platformer` · `vertical-scroll` · `stage-point-and-click` · `first-person-sprite-hud`

Determines: anchor convention, pivot, depth-sorting rules, which direction sets are legal, foreshortening rules, how contact shadows fall.

### B. Art scale
`8×8` · `16×16` · `24×32` · `32×32` · `48×48` · `64×64` · `96×96` · `128×128` · `192+`

Plus the **relative** rule, which matters more than the absolute one: a 16×16 character on 8×8 tiles is a different game from a 16×16 character on 32×32 tiles. Scale is declared as subject size *and* world tile size.

### C. Palette magnitude
`1 (monochrome)` · `2` · `4` · `8` · `16` · `24` · `32` · `48` · `64+`

And the constraint mode: `fixed-global` · `per-sprite` · `per-region` · `per-scene-ambient-tinted`.

### D. Colour temperature model
`grey-shade` · `hue-shift-warm-cool` · `complementary-shadow` · `split-complementary` · `ambient-tinted` (shadows take the scene's colour) · `duotone` · `limited-hue` (one hue family, value-driven)

### E. Edge and line policy
`no-outline` · `selective-dark` · `full-1px-dark` · `2px-cartoon` · `coloured-outline` (outline is a ramp step, not black) · `interior-line-art` · `anti-aliased-edge` · `hard-edge-jaggies-allowed` · `silhouette-only`

### F. Shading model
`flat` · `2-value` · `ramp-lit-directional` · `form-sculpted` · `banded` · `dithered-gradient` · `painterly-clusters` · `baked-ambient-occlusion` · `rim-lit-backlit`

### G. Texture and detail density
`pristine-flat` · `minimal` · `moderate` · `dense-grain` · `hyper-detailed`

Expressed as a **detail budget per 16×16 area**, not as an adjective — so a small sprite cannot be given a large sprite's ambition.

### H. Motion model
`static` · `2-frame-toggle` · `subpixel` · `cel-offset-bob` · `rig-keypose` · `smear-frames` · `squash-stretch` · `deform-rotate` · `particle-procedural`

### I. Mood register
`cozy-warm` · `cheerful-cartoon` · `gritty-grounded` · `grim-dark` · `surreal-abstract` · `clinical-mechanical` · `organic-creature` · `epic-bold` · `minimalist-iconic`

Mood is the axis the other eight serve. It is declared explicitly rather than emerging by accident.

---

## 2. The interactions the engine must know

This is what makes it an engine instead of a settings menu. Many coordinates are **impossible**, and the engine should refuse them up front rather than let me produce art that quietly fails.

| Combination | Engine behaviour |
|---|---|
| scale ≤ 16 **and** 2px outline | **Refused.** A 2px outline on an 8×8 sprite eats the subject. Suggests 1px selective. |
| scale ≤ 16 **and** `hyper-detailed` | **Refused.** Detail budget is capped by area; the sprite would be mud. |
| `monochrome` or `2-colour` | Hue rules disabled; `value_contrast_min` becomes mandatory; `value_map` becomes a **required** review render, not optional. |
| `2-value` shading **and** dither enabled | **Refused.** Dither is how you fake a third value; with two declared values it is a violation, not a technique. |
| `isometric-2to1` | Forces 6- or 8-way direction set, 2:1 tile ratio, bottom-centre diamond anchor, and iso-specific foreshortening on multi-tile props. |
| `side-scroller` | Direction set collapses to 1 authored facing + mirrored facing; camera-relative flip rules and asymmetry audit become mandatory. |
| `flat` shading **and** `cast_shadow` | Warns: a flat-shaded subject with a modelled cast shadow is a style contradiction. |
| `2px-cartoon` outline **and** `anti-aliased-edge` | Warns: AA inside a 2px outline collapses the outline at game scale. |
| `ambient-tinted` temperature | Requires a declared scene ambient per scene, not per sprite; the engine re-derives ramps per scene rather than reusing one global ramp. |
| `particle-procedural` motion | Allowed only for FX asset classes; refused for characters, because procedural motion on a character is exactly the sliding-shape failure. |

The point of encoding these: **an impossible coordinate is discovered at authoring time, in one error message, instead of discovered 300 cels later in a contact sheet.**

---

## 3. Asset taxonomy — the other half of "diverse"

Covering styles is worthless if the engine only does characters. Every class below is a first-class citizen with its own conventions and its own acceptance test.

| Class | Examples | Special conventions |
|---|---|---|
| **Player / humanoid** | farmer, knight, robot | full rig, direction set, clip matrix |
| **Creature / monster** | slime, beast, insect | non-human rig, silhouette-led readability |
| **Boss / large entity** | 96–192px multi-part | multi-part rig, phase-offset sub-animations |
| **NPC** | villager, merchant | cheaper clip set, shared cel linking |
| **Prop / object** | chest, barrel, crate | ground contact row, footprint for multi-tile |
| **Weapon / tool** | sword, pickaxe, wand | held-attachment rules, per-direction grip consistency |
| **Collectible / icon** | coin, heart, potion | must pass `squint`; often a fixed 16×16 grid |
| **UI / HUD** | buttons, frames, bars, cursors, panels | 9-slice, pixel-grid alignment, no subpixel, no dither |
| **Map / minimap** | world map, fog-of-war | scale-of-scale rules, legibility at 25% |
| **Spell / combat FX** | fireball, slash, impact ring | palette-legal "additive" look built from ramp steps in space |
| **Environmental FX** | flame, water, smoke, dust, magic | loopable, seamless loop test mandatory |
| **Screen FX** | flash, vignette, damage overlay | resolution-independent generation rules |
| **Tiles / autotiles** | terrain, walls, transitions | 47-tile bitmask, seam testing, variant luminance matching |
| **Terrain decals** | cracks, blood, moss, scorch | must not fight the tile ramp they sit on |
| **Structure / building** | house, tower, well | footprint, occlusion, multi-tile anchor |
| **Vehicle** | cart, boat, car | motion model is deform/rotate, not rig |
| **Portrait / illustrative** | dialogue portrait, card art | `sculpted` shading permitted, no direction set |
| **Emote / expression** | face states, speech bubbles | must read at tiny scale, palette-shared with the character |
| **Bitmap font / text** | in-game type, numbers | tested glyph legibility (the E/F/5 lesson), fixed cell metrics |
| **Logo / title** | game logo, title card | illustrative freedom, still palette-declared |

---

## 4. Coverage acceptance tests — proof, not claims

The engine is not "diverse" because the docs say so. It is diverse if it can produce all of these credibly, each passing its own audit under its own coordinate. These are deliberately **maximally distant** points in the space.

| ID | Coordinate | Proves |
|---|---|---|
| **T1** | 8×8, monochrome 2-colour, `2-value`, no outline, side-scroller, 2-frame walk | the engine works with almost nothing to work with |
| **T2** | 16×16, 16 colours, `warm-topdown`, 4-way 4-frame walk | the cozy/warm register and hue-shifted shading |
| **T3** | 32×32, 32 colours, `crisp-16bit`, 8-way 6-frame walk + 5-frame attack | console-grade detail and a full direction matrix |
| **T4** | 64×64, 40 colours, `sculpted-large`, 8-way with anticipation-heavy attack and a 6-frame death | high-detail form sculpting and weight |
| **T5** | 128×128 `isometric-2to1` structure + a full 47-tile autotile set | projection handling and environment scale |
| **T6** | 16×16 icon set, 8 colours, `flat`, no dither, `minimalist-iconic` | iconic readability; must pass `squint` cold |
| **T7** | Spell FX: 6-frame fireball + looping flame, `particle-procedural` | animation of something with no body at all, palette-legal |
| **T8** | Boss: 96×96, multi-part rig, 12-frame attack with phase-offset sub-animations | large multi-part animation without sliding |
| **T9** | 48×64 dialogue portrait, `painterly-clusters`, no direction set | illustrative, non-gameplay art |
| **T10** | Bitmap font + 6 emotes at 8×8 | tiny-scale legibility and the tested-glyph requirement |
| **T11** | Full UI kit: 9-slice panels, HUD bars, cursors, pixel-grid aligned | the class where pixel discipline is unforgiving |
| **T12** | `grim-dark` 32×32 character with `ambient-tinted` shadows under three different scene ambients | one asset, three scene lighting contexts, no re-draw |

**Coverage gate:** the engine passes when T1–T12 each pass their own audit and survive my own `silhouette` / `squint` / `value_map` review — and when at least three of them are produced **without any preset**, purely by declaring a coordinate.

That last clause is the important one. Presets are a convenience. Coverage means the space works, not that four saved coordinates work.

---

## 5. Style derivation — what a coordinate space buys you

Because a style is a coordinate rather than a saved bundle, the engine can move along one axis and re-derive everything downstream:

- **"Same game, but 8-bit constrained"** → move palette magnitude to 16, engine recomputes every ramp under the new cap, re-lints every asset, and reports which sprites lose detail and which colours collapsed.
- **"Same art, darker mood"** → move mood to `grim-dark` and temperature to `complementary-shadow`; ramps re-derive, outlines and dither policy update, existing pixel intent is preserved.
- **"Same design, bigger scale"** → move scale 16→32; the engine treats this as a **redraw with a higher detail budget**, refuses to upscale, and keeps the composition as the reference.
- **"Port this asset to another project's style"** → re-key palette and re-lint against the target bible; the authored grid is unchanged, the colour recipe is not.

A preset library cannot do any of this. This is the actual payoff of specifying the space.

---

## 6. Engine targets are adapters, not a list

Export is a resolver over declared target conventions — row order, pivot units, animation naming, event representation, sheet packing:

`godot` · `phaser` · `unity` · `tiled` · `html5-canvas` · `aseprite-compatible` · `generic-json`

Adding a target is adding an adapter file, not changing the engine. The art data model never bends to accommodate an engine; the adapter does.

---

## 7. What this changes about how we start

There is no "first game" question to answer before building. The build order is defined by the coverage matrix, and the first assets are **test coordinates**, chosen because they are far apart — not because they belong to a game.

A project is then just: declare a coordinate, let the engine validate it, let me draw in it, let the audit enforce it.
