// PHASE 8 COVERAGE T8 — the declared coordinate and the rig for the boss.
//
// Declared here, not picked from a shelf: this style id and this palette do not exist in
// art/styles/ or art/palettes/ before the run (bench/data/COVERAGE.md §2).
"use strict";

const CANVAS = [96, 96];
const BASELINE = 94;                    // the sole row. It never moves, in any frame.

const STYLE = {
  id: "t8-warden-sluice",
  projection: "front", art_scale: 96, palette_size: 32,
  temperature: "complementary-shadow", edge_policy: "selective-dark",
  shading: "sculpted", detail: "moderate", motion: "sub-asset", mood: "menacing",
  light_vector: [-0.7, -0.7],
};

// Complementary-shadow: shadows on every material drift toward violet-blue while the lit ends stay
// warm, and the one hot material (the burning core, the roaring throat) is the complement of those
// shadows rather than a third neutral. Hand-mixed ramps, darkest -> brightest; palette_audit reports
// zero problems on this set.
const PALETTE = {
  ramps: {
    carapace: { role: "material", colors: ["#211d3a", "#2f2a4e", "#423d68", "#585487", "#7370a4", "#9593c2"] },
    hide:     { role: "material", colors: ["#3a2436", "#55364a", "#754d5c", "#96696f", "#bd9a90"] },
    bone:     { role: "material", colors: ["#655c46", "#877e61", "#a99f7d", "#c9c19f", "#e4ddc1"] },
    iron:     { role: "material", colors: ["#39424f", "#4f5a6b", "#68758a", "#8593a8", "#a8b6c9"] },
    ember:    { role: "material", colors: ["#6e2f10", "#a9551c", "#d97f2b", "#ffb45e"] },
  },
  single: {
    outline: { rgb: "#101420", role: "outline" },   // selective-dark: only where the form turns away
    contact: { rgb: "#241a2b", role: "shadow" },    // the sole row: what makes it stand ON something
    core:    { rgb: "#fff0cf", role: "light" },     // declared light step: hit flash lands here
    sigil:   { rgb: "#ff8a3d", role: "accent" },    // declared focal accent: eyes and throat
  },
};

const MAP = { C: "carapace", H: "hide", B: "bone", I: "iron", E: "ember" };

// ---- the rig -------------------------------------------------------------------
// Joints are the invariant. Every part hangs from a named joint, so the same shoulder is the same
// shoulder in all twelve frames; a key pose changes what is DRAWN at that joint, not where it is.
const ANCHORS = {
  down: {
    hip: [48, 68], spine: [48, 52], chest: [48, 44], head: [48, 26],
    shoulder_l: [26, 38], shoulder_r: [70, 38],
    chain_mount_l: [22, 48], chain_mount_r: [74, 48],
    foot_l: [40, 94], foot_r: [56, 94],
  },
};

const PART_JOINTS = {
  torso: "spine", head: "head", jaw_closed: "head", jaw_open: "head",
  pauldron_l: "shoulder_l", pauldron_r: "shoulder_r",
  arm_l_neutral: "shoulder_l", arm_l_back: "shoulder_l", arm_l_guard: "shoulder_l",
  arm_r_low: "shoulder_r", arm_r_mid: "shoulder_r", arm_r_high: "shoulder_r",
  arm_r_down: "shoulder_r", arm_r_follow: "shoulder_r",
  blade_ready: "chain_mount_r", blade_up: "chain_mount_r", blade_arc: "chain_mount_r",
  blade_smear: "chain_mount_r", blade_impact: "chain_mount_r", blade_follow: "chain_mount_l",
  chain_a_hang: "chain_mount_l", chain_a_out: "chain_mount_l",
  chain_b_hang: "chain_mount_l", chain_b_out: "chain_mount_l",
  chain_c_hang: "chain_mount_r", chain_c_out: "chain_mount_r",
  leg_l: "hip", leg_r: "hip",
};

// Occlusion order for the one authored facing. The weapon is drawn last so it reads in front of the
// body instead of fusing with it; chains sit under the arms that hang them.
const Z_ORDER = {
  default: ["leg_l", "leg_r", "torso", "head", "jaw_closed", "jaw_open",
    "pauldron_l", "pauldron_r", "chain_a_hang", "chain_a_out", "chain_b_hang", "chain_b_out",
    "arm_l_neutral", "arm_l_back", "arm_l_guard",
    "arm_r_low", "arm_r_mid", "arm_r_high", "arm_r_down", "arm_r_follow",
    "chain_c_hang", "chain_c_out",
    "blade_ready", "blade_up", "blade_arc", "blade_smear", "blade_impact", "blade_follow"],
};

// Canvas-space placement [x, y] of every authored variant, measured from the joint it hangs from.
const LAYOUT = {
  torso:        [32, 34],
  head:         [37, 16],
  jaw_closed:   [40, 35],
  jaw_open:     [40, 35],
  pauldron_l:   [14, 28],
  pauldron_r:   [57, 28],
  arm_l_neutral:[16, 48],
  arm_l_back:   [12, 46],
  arm_l_guard:  [22, 46],
  arm_r_low:    [64, 46],
  arm_r_mid:    [62, 40],
  arm_r_high:   [60, 34],
  arm_r_down:   [54, 40],
  arm_r_follow: [40, 42],
  blade_ready:  [64, 44],
  blade_up:     [58, 12],
  blade_arc:    [59, 20],
  blade_smear:  [56, 30],
  blade_impact: [57, 46],
  blade_follow: [34, 36],
  chain_a_hang: [18, 46],
  chain_a_out:  [14, 46],
  chain_b_hang: [23, 46],
  chain_b_out:  [20, 46],
  chain_c_hang: [72, 46],
  chain_c_out:  [76, 46],
  leg_l:        [33, 70],
  leg_r:        [49, 70],
};

// Per-part authored overrides that authorAsset cannot express as a grid letter: the focal accent
// pixels (eyes, throat) and the light-role core inside the chest chamber. Coordinates are explicit
// so they are visible in git — an accent you did not put there is not an accent (docs/09).
const OVERRIDES = {
  head:      [[5, 9, "sigil"], [6, 9, "sigil"], [13, 9, "sigil"], [14, 9, "sigil"],
              [5, 10, "sigil"], [14, 10, "sigil"]],
  jaw_open:  [[7, 5, "core"], [8, 5, "core"], [7, 6, "core"], [8, 6, "core"]],
  torso:     [[14, 15, "core"], [15, 15, "core"], [16, 15, "core"], [17, 15, "core"],
              [14, 16, "core"], [15, 16, "core"], [16, 16, "core"], [17, 16, "core"]],
};

module.exports = { CANVAS, BASELINE, STYLE, PALETTE, MAP, ANCHORS, PART_JOINTS, Z_ORDER, LAYOUT, OVERRIDES };
