// T3 — the coordinate, declared rather than picked from a shelf (docs/08 §4 row T3).
// "32×32, 32 colours, crisp-16bit, 8-way 6-frame walk + 5-frame attack" — console-grade
// detail and a full direction matrix.
//
// Nine axes, each from the closed domain in src/core/style.js L6-18:
//   projection three-quarter · art_scale 32 · palette_size 32 · temperature complementary-shadow
//   edge_policy selective-dark · shading ramp-lit · detail moderate · motion 6-frame · mood menacing
// "crisp-16bit" is not an axis value; it is the *consequence* of this combination: a 32px subject,
// multi-step ramps per material, hand-placed clusters, hard edges with ink only where the form
// opens on the shadow side, and a full 8-facing × clip matrix.
"use strict";

const STYLE = {
  id: "t3-threequarter-breaker",
  projection: "three-quarter",
  art_scale: 32,
  palette_size: 32,
  temperature: "complementary-shadow",
  edge_policy: "selective-dark",
  shading: "ramp-lit",
  detail: "moderate",
  motion: "6-frame",
  mood: "menacing",
  light_vector: [-0.7, -0.7],
};

// ---- the palette, 32 slots declared, 29 mixed ------------------------------------
// complementary-shadow in practice: every material's shadow end drifts to the cool complement
// (violet-blue) and its lit end stays warm, except the blade, which is the one deliberately cold
// material in the set — steel catches the key light as pale violet-blue and shadows as teal.
// Ramps are authored as DERIVED recipes (base hue + step count + value range + hue drift), which
// is what keeps discipline provable: buildRamp gives monotonic lightness with even steps, and a
// single-sign hue drift, so `palette_audit` cannot find a band or a wobble by construction.
// Hue arithmetic in buildRamp: lit end = base + hueShift, shadow end = base - hueShift.
const PALETTE = {
  ramps: {
    // hood + coat: one mass, one material, five steps. Violet shadow -> ochre lit.
    wool:  { role: "material", base: "#7c5a6e", steps: 5, value: [0.18, 0.56], hueShift: 55, satCurve: [1.0, 0.80] },
    // breeches: four steps, warmer family, same shadow direction.
    hide:  { role: "material", base: "#8d6b52", steps: 4, value: [0.20, 0.50], hueShift: 38, satCurve: [1.0, 0.85] },
    // the blade: the cold material. Teal shadow -> pale violet-blue highlight.
    iron:  { role: "material", base: "#6f7f96", steps: 5, value: [0.24, 0.74], hueShift: 55, satCurve: [1.0, 0.75] },
    // haft/grip: three steps; a wrapped leather grip does not need a long ramp.
    haft:  { role: "material", base: "#7a5b3f", steps: 3, value: [0.22, 0.46], hueShift: 30, satCurve: [1.0, 0.9] },
    // face and hands: three steps, kept out of the deepest band so the face reads.
    skin:  { role: "material", base: "#b98a6b", steps: 3, value: [0.36, 0.62], hueShift: 22, satCurve: [1.0, 0.9] },
    // boots: four steps sitting in the darkest part of the palette — the figure stands ON something.
    boot:  { role: "material", base: "#5d4a44", steps: 4, value: [0.16, 0.40], hueShift: 45, satCurve: [1.0, 0.85] },
  },
  single: {
    outline: { rgb: "#0d1117", role: "outline" },   // selective-dark: ink only where the form opens on the shadow side
    contact: { rgb: "#1b2130", role: "shadow" },    // the sole row: the darkest authored thing under the feet
    brass:   { rgb: "#d9a441", role: "accent" },    // the declared focal accent (belt plate + trim)
    spark:   { rgb: "#f2ddb0", role: "light" },     // one frame only: hit_flash is a colour decision, not a shader
    eye:     { rgb: "#0a0c10", role: "detail" },    // two pixels of eye per facing; nothing else on the face
  },
};

module.exports = { STYLE, PALETTE };
