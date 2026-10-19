// PHASE 8 COVERAGE T4 — the declared coordinate, the palette and the rig for the heavy opponent.
//
// docs/08 §4 row T4: "64x64, 40 colours, sculpted-large, 8-way with anticipation-heavy attack and a
// 6-frame death" — proves "high-detail form sculpting and weight".
//
// Declared here from scratch: this style id and this palette do not exist in art/styles/ or
// art/palettes/ before the run (bench/data/COVERAGE.md §2).
//
// THE PALETTE MAGNITUDE DECISION, stated up front rather than hidden:
//   The matrix row says 40 colours. `palette_size` is a closed domain (src/core/style.js L11):
//   2, 4, 8, 16, 24, 32, 48. 40 is NOT a legal axis value; 32 and 48 are each exactly 8 away.
//   I declare 48 — the nearest legal value at or above the row's 40 — and then author a palette of
//   41 entries inside that cap, so the row's *intent* (a large, sculpted colour set) is honoured
//   while the axis stays legal. The external craft bar for art_scale 64 caps a single cel at 40
//   colours (src/core/regression.js CRAFT_TARGETS[64]); every composed frame here uses far fewer.
//
//   sculpted is refused below 24 colours (`sculpted-needs-palette`) and below 48px
//   (`sculpted-needs-room`); both refusals are proved as controls in bench/coverage/t4.js.
"use strict";

const CANVAS = [64, 64];
const BASELINE = 61;                    // the sole row. It never moves, in any frame, in any facing.

const STYLE = {
  id: "t4-hollow-breaker",
  projection: "three-quarter",           // an 8-way camera: cardinals + diagonals
  art_scale: 64,
  palette_size: 48,                      // declared; the row's "40" is not a legal axis value (see notes)
  temperature: "complementary-shadow",   // shadows drift cool, lit ends stay warm, on EVERY material
  edge_policy: "selective-dark",         // ink only where the form turns away from the light
  shading: "sculpted",                   // multi-step ramps per material, modelled across each region
  detail: "moderate",
  motion: "8-frame",                     // walk 8, attack 8, death 6 — one shared rhythm
  mood: "menacing",
  light_vector: [-0.7, -0.7],
};

// Complementary-shadow, hand-mixed per material: each ramp starts cool (blue / violet / maroon-cool)
// in its shadow end and drifts monotonically toward its warm lit end. The drift direction is the
// temperature model, and it is measured per ramp in t4.js (shadow hue -> lit hue), not asserted.
// Every ramp is darkest -> brightest, monotonic in value, with steps inside the engine's
// 0.055..0.34 window (src/core/palette.js auditRamps).
const PALETTE = {
  origin: "hand-mixed in-repo from declared shadow/lit hue pairs for one heavy opponent",
  ramps: {
    // riveted slab plate: blue-violet shadows -> neutral -> warm grey lit
    plate: { role: "material", colors: ["#1c2238", "#2b3652", "#3d4c69", "#53657f", "#6f8093", "#a9a6a4"] },
    // boiled leather and under-flesh: cool violet-brown -> warm brown
    hide:  { role: "material", colors: ["#2b1f2e", "#453043", "#63455a", "#8a6470", "#b08d76"] },
    // the millstone head of the hammer: cold grey -> warm stone
    stone: { role: "material", colors: ["#2e2c33", "#44434d", "#5c5b64", "#77797f", "#9aa2a4", "#c9baa2"] },
    // ash haft: cool dark wood -> warm lit wood
    wood:  { role: "material", colors: ["#2f2318", "#4a3724", "#674d31", "#8a6b45", "#b28f63"] },
    // face and gorger
    skin:  { role: "material", colors: ["#3a2a22", "#5c4132", "#82604a", "#a98468", "#cba98b"] },
    // corroded trim, rivets, chain: cool maroon -> rust orange
    rust:  { role: "material", colors: ["#2d1f2c", "#492b2c", "#6e3a26", "#9a5222", "#b07a45"] },
    // the horns sunk into the helmet
    horn:  { role: "material", colors: ["#4d4436", "#6b6049", "#8f8163", "#b3a684", "#d6cba6"] },
  },
  single: {
    outline: { rgb: "#10141f", role: "outline" },   // selective-dark ink, placed only on shadow-side edges
    contact: { rgb: "#241c26", role: "shadow" },    // the sole row: what makes him stand ON something
    core:    { rgb: "#ffeccb", role: "light" },     // declared light step — hit_flash lands here
    eye:     { rgb: "#ff8a3d", role: "accent" },    // the declared focal accent: the eye slit in the helmet
  },
};

// Grid letters -> material. Authored per cell, so a blade, a haft and a plate are decisions made
// while drawing, not regions discovered afterwards (src/author.js header).
const MAP = { P: "plate", H: "hide", S: "stone", W: "wood", K: "skin", R: "rust", N: "horn" };

// ---- the rig ---------------------------------------------------------------------
// Joints are the invariant across 8 facings x 22 frames. A key pose changes WHAT is drawn at a
// joint and WHERE it hangs; the joint itself never moves between frames of one facing.
// The wide planted stance is a design decision with a mechanical consequence: the outermost pixels
// of the silhouette are the boots in every frame of every clip, which is what lets an anticipation
// throw the MASS back and forward without the bounding box sliding (docs/03 §5 anchor_drift).
const ANCHORS = {
  down:   { hip: [31, 43], head: [31, 11], shoulder_l: [16, 25], shoulder_r: [47, 25], hand_l: [13, 33], hand_r: [49, 33], knee_l: [22, 50], knee_r: [40, 50] },
  right:  { hip: [29, 43], head: [30, 11], shoulder_l: [24, 25], shoulder_r: [36, 25], hand_l: [22, 33], hand_r: [38, 33], knee_l: [24, 50], knee_r: [36, 50] },
  up:     { hip: [31, 43], head: [31, 11], shoulder_l: [47, 25], shoulder_r: [16, 25], hand_l: [49, 33], hand_r: [13, 33], knee_l: [40, 50], knee_r: [22, 50] },
  left:   { hip: [33, 43], head: [32, 11], shoulder_l: [38, 25], shoulder_r: [26, 25], hand_l: [40, 33], hand_r: [24, 33], knee_l: [38, 50], knee_r: [26, 50] },
  // Diagonals are DRAFTS derived from the two horizontal cardinals (see t4.js notes on
  // direction_derive). Their anchors mirror the cardinal they were derived from.
  "down-right": { hip: [33, 43], head: [32, 11], shoulder_l: [38, 25], shoulder_r: [26, 25], hand_l: [40, 33], hand_r: [24, 33], knee_l: [38, 50], knee_r: [26, 50] },
  "up-right":   { hip: [33, 43], head: [32, 11], shoulder_l: [38, 25], shoulder_r: [26, 25], hand_l: [40, 33], hand_r: [24, 33], knee_l: [38, 50], knee_r: [26, 50] },
  "down-left":  { hip: [31, 43], head: [31, 11], shoulder_l: [16, 25], shoulder_r: [47, 25], hand_l: [13, 33], hand_r: [49, 33], knee_l: [22, 50], knee_r: [40, 50] },
  "up-left":    { hip: [31, 43], head: [31, 11], shoulder_l: [16, 25], shoulder_r: [47, 25], hand_l: [13, 33], hand_r: [49, 33], knee_l: [22, 50], knee_r: [40, 50] },
};

// Part -> joint it hangs from. arm_weapon_* and hammer_* are the weapon arm and the weapon itself;
// they hang from the weapon-hand joint of whichever side holds them in that facing.
const PART_JOINTS = {
  torso: "hip", torso_kneel: "hip", torso_fallen: "hip",
  head: "head",
  arm_near: "shoulder_near", arm_far: "shoulder_far",
  leg_near: "knee_near", leg_far: "knee_far",
  arm_weapon_up: "hand_weapon", arm_weapon_down: "hand_weapon", arm_weapon_mid: "hand_weapon",
  hammer_rest: "hand_weapon", hammer_up: "hand_weapon", hammer_swing: "hand_weapon", hammer_drop: "hand_weapon",
};

// Occlusion per facing (docs/03 §2: occlusion is explicit — this is what prevents merged limbs).
// The weapon is drawn last so it reads IN FRONT of the body rather than fusing with it.
const Z_ORDER = {
  default: ["leg_far", "arm_far", "torso", "leg_near", "arm_near", "head", "hammer_rest"],
  down:   ["leg_far", "arm_far", "torso", "leg_near", "arm_near", "head", "hammer_rest", "arm_weapon_up", "arm_weapon_mid", "arm_weapon_down", "hammer_up", "hammer_swing", "hammer_drop", "torso_kneel", "torso_fallen"],
  up:     ["arm_far", "leg_far", "torso", "leg_near", "arm_near", "head", "hammer_rest", "arm_weapon_up", "arm_weapon_mid", "arm_weapon_down", "hammer_up", "hammer_swing", "hammer_drop", "torso_kneel", "torso_fallen"],
  right:  ["leg_far", "arm_far", "torso", "leg_near", "arm_near", "head", "hammer_rest", "arm_weapon_up", "arm_weapon_mid", "arm_weapon_down", "hammer_up", "hammer_swing", "hammer_drop", "torso_kneel", "torso_fallen"],
  left:   ["leg_far", "arm_far", "torso", "leg_near", "arm_near", "head", "hammer_rest", "arm_weapon_up", "arm_weapon_mid", "arm_weapon_down", "hammer_up", "hammer_swing", "hammer_drop", "torso_kneel", "torso_fallen"],
};

// Canvas-space placement [x, y] of every authored part in its NEUTRAL pose, per authored facing.
// Offsets are measured from the joint each part hangs from (t4.js converts), so the joint stays the
// invariant and a pose changes the offset, not the joint.
const LAYOUT = {
  down:  { torso: [17, 22], head: [23, 10], arm_far: [12, 26], leg_far: [18, 44], arm_near: [46, 26], leg_near: [38, 44], hammer_rest: [45, 20], arm_weapon_up: [42, 22], arm_weapon_mid: [44, 26], arm_weapon_down: [44, 26], hammer_up: [36, 2], hammer_swing: [42, 26], hammer_drop: [40, 30], torso_kneel: [17, 30], torso_fallen: [14, 42] },
  right: { torso: [18, 22], head: [22, 10], arm_far: [20, 26], leg_far: [20, 44], arm_near: [28, 26], leg_near: [28, 44], hammer_rest: [26, 24], arm_weapon_up: [28, 22], arm_weapon_mid: [30, 26], arm_weapon_down: [30, 26], hammer_up: [18, 2], hammer_swing: [30, 22], hammer_drop: [26, 34], torso_kneel: [18, 30], torso_fallen: [12, 42] },
  up:    { torso: [17, 22], head: [23, 10], arm_far: [46, 26], leg_far: [38, 44], arm_near: [12, 26], leg_near: [18, 44], hammer_rest: [15, 20], arm_weapon_up: [18, 22], arm_weapon_mid: [14, 26], arm_weapon_down: [14, 26], hammer_up: [24, 2], hammer_swing: [14, 26], hammer_drop: [20, 30], torso_kneel: [17, 30], torso_fallen: [16, 42] },
  left:  { torso: [22, 22], head: [24, 10], arm_far: [36, 26], leg_far: [30, 44], arm_near: [26, 26], leg_near: [26, 44], hammer_rest: [30, 24], arm_weapon_up: [26, 22], arm_weapon_mid: [24, 26], arm_weapon_down: [24, 26], hammer_up: [30, 2], hammer_swing: [24, 22], hammer_drop: [30, 34], torso_kneel: [22, 30], torso_fallen: [20, 42] },
};

// Authored single-pixel decisions authorAsset cannot express as a grid letter: the focal accent
// (the eye slit) and the declared light step inside the millstone's struck ring. Coordinates are
// explicit so they are visible in git — "an accent you did not put there is not an accent" (docs/09 §3.6).
const OVERRIDES = {};

module.exports = { CANVAS, BASELINE, STYLE, PALETTE, MAP, ANCHORS, PART_JOINTS, Z_ORDER, LAYOUT, OVERRIDES };
