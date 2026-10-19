// PHASE 8 COVERAGE — T9: the dialogue portrait. Illustrative, non-gameplay art.
// docs/08 §4 row T9: "48x64 dialogue portrait, `painterly-clusters`, no direction set".
//
// What this coordinate is actually testing: an asset with no silhouette job to do (nobody has to
// recognise it at forty feet), no direction matrix, no gameplay contract — only paint. The claim is
// that the engine can hold a *painterly* register at scale: form built out of 2-4px colour patches
// along authored ramps, grain where the coordinate declares grain, and light still coherent because
// the light field was declared before the first patch was laid down.
//
// Structure follows bench/data/COVERAGE.md and bench/coverage/t1.js: declare, author, measure,
// render, look, report what is weak.
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS, W } = require("../../src/tools.js");
const { charFor } = require("../../src/core/cel.js");
const craft = require("../../src/craft.js");

// ---- the coordinate -------------------------------------------------------------
// front projection (a portrait faces the viewer; there is no camera and no depth claim to make),
// art_scale 48 (docs/08 says 48x64), palette_size 32 as the cap rather than the usage,
// warm-cool-hue-shift (lit skin warm, shaded skin cool mauve — hue carries the temperature),
// selective-dark edges (outline only where the silhouette needs separating from the ground),
// ramp-lit shading (every material modelled along its own authored ramp),
// dense-grain detail (this is what legally licenses dither — see claim 5),
// static motion, melancholy mood.
const STYLE = {
  id: "t9-portrait", projection: "front", art_scale: 48, palette_size: 32,
  temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "dense-grain", motion: "static", mood: "melancholy", light_vector: [-0.7, -0.7],
};

// Three authored ramps + four authored singles = 20 entries against a declared cap of 32.
// skin desaturates as it lights (a lit cheek is pale warm, a shaded cheek is saturated mauve);
// hair is a WARM dark family so the cool cloth never fuses into it at their boundary —
// craft.separation credits hue only when both sides carry saturation, and two blue families at the
// same value would read as one mass.
const PALETTE = {
  ramps: {
    skin:  { role: "material", colors: ["#5d3a4c", "#78495a", "#96605f", "#b47f66", "#d0a179", "#e9c69a"] },
    hair:  { role: "material", colors: ["#241a14", "#372a1e", "#4c3a27", "#634c33", "#7d6444"] },
    cloth: { role: "material", colors: ["#242f3f", "#334256", "#455a72", "#5c7490", "#7992ab"] },
  },
  single: {
    outline: { rgb: "#0a0d12", role: "outline" },   // selective-dark rim
    clasp:   { rgb: "#c98f3a", role: "accent" },    // the brass throat clasp: the one thing to look at
    eye:     { rgb: "#141b24", role: "detail" },    // lash line, pupils, mouth line, nostrils
    glint:   { rgb: "#eedcb8", role: "detail" },    // the catchlight in each eye
  },
};

// Authored letters -> authored palette entries. Every letter below is a pixel I placed.
const LEGEND = {
  P: "cloth.0", Q: "cloth.1", R: "cloth.2", S: "cloth.3", T: "cloth.4",
  K: "hair.0", L: "hair.1", M: "hair.2", N: "hair.3", O: "hair.4",
  A: "skin.0", B: "skin.1", C: "skin.2", D: "skin.3", E: "skin.4", F: "skin.5",
  o: "outline", x: "clasp", e: "eye", g: "glint",
};

const CW = 48, CH = 64;

// The face field is written as three 7-cell bands (x14..20 | x21..27 | x28..34) so the geometry is
// legible and a mistyped row cannot silently slide the features sideways: region() checks the width.
// Lit forehead/cheek on the light side, cool mauve shade down the far side, values staggered row to
// row so no ramp step runs into a slab.
const FACE = [
  /*y12*/ "CCDDEEE" + "FFFEEDC" + "CBBBAAA",
  /*y13*/ "CCDDDEF" + "FFEEDDC" + "CBBBAAA",
  /*y14*/ "CDDDDEE" + "FEEDDCC" + "CBABAAA",
  /*y15*/ "CDDEEDE" + "EDDCCBB" + "CBBBAAA",   // brow ridge starts to fall
  /*y16*/ "CDDCCDD" + "DCCCBBB" + "CBBBAAA",   // the ridge itself
  /*y17*/ "CDCCBDD" + "CCCBBBA" + "CBABAAA",   // brow socket shadow
  /*y18*/ "CDCBBCD" + "CCCBBBA" + "CBBBAAA",   // upper lids
  /*y19*/ "CDBBBBC" + "DCCBBBA" + "CBBAAAA",   // eye line
  /*y20*/ "CDCBBCD" + "CEEDCBB" + "CBBBAAA",   // lower lids, cheekbone picking light back up
  /*y21*/ "CDDCBDD" + "CEEDDCB" + "CBBBAAA",
  /*y22*/ "CDECCDD" + "CEEDDCB" + "CBBBAAA",   // lit cheek on the light side
  /*y23*/ "CDEECDD" + "CEEDDCC" + "CBABAAA",
  /*y24*/ "CDEEEDC" + "DEEDDCC" + "CBBBAAA",   // nose base
  /*y25*/ "CDDEEDC" + "DEEDDCB" + "CBBBAAA",   // under-nose shadow
  /*y26*/ "CDDEEDC" + "CEEDDCB" + "CBBBAAA",   // upper lip
  /*y27*/ "CDDDEDC" + "CEEDDCB" + "CBBBBAA",   // mouth line
  /*y28*/ "CCDDEDC" + "CEEDDCC" + "CBBBBAA",   // lower lip / chin
  /*y29*/ "CCDDDEC" + "CEDDCCC" + "CBBBBAA",   // chin narrowing into the hood
];

const CLOTH_L = { 12: "TSRR", 13: "STSR", 14: "TSRR", 15: "SRRS", 16: "TRRS", 17: "SRRQ", 18: "SRQS", 19: "TRRQ",
  20: "SRRP", 21: "SRQP", 22: "TRRQ", 23: "SRRQ", 24: "SRQP", 25: "TRRQ", 26: "SRRP", 27: "SRQP", 28: "TRRQ" };
const CLOTH_R = { 12: "RQPP", 13: "RQQP", 14: "RQPP", 15: "RQQP", 16: "RQPP", 17: "RQQP", 18: "RQPP", 19: "RQQP",
  20: "RQPP", 21: "RQQP", 22: "RQPP", 23: "RQQP", 24: "RQPP", 25: "RQQP", 26: "RQPP", 27: "RQQP", 28: "RQPP" };
const HAIR_L = { 12: "ON", 13: "NM", 14: "ML", 15: "LM", 16: "NL", 17: "ML", 18: "LK", 19: "ML", 20: "NK",
  21: "LK", 22: "ML", 23: "LK", 24: "NK", 25: "ML", 26: "LK", 27: "NK", 28: "ML" };
const HAIR_R = { 12: "NM", 13: "ML", 14: "LK", 15: "KL", 16: "KK", 17: "LK", 18: "KK", 19: "LK", 20: "KK",
  21: "KL", 22: "KK", 23: "LK", 24: "KK", 25: "KL", 26: "KK", 27: "LK", 28: "KK" };

// ---- the authored portrait ------------------------------------------------------
// A hooded courier seen front-on, head turned a fraction toward the key light.
// Mass plan: hood crown rows 2-11; face opening rows 12-29 framed by side hair and the hood's inner
// rim; jaw narrowing rows 30-33; neck rows 34-36 in deep shade; cloak and shoulders rows 37-63
// widening to the hem. One deliberate pocket of enclosed air at (28..30, 36): the shadow gap between
// the neck and the hood edge, so the silhouette is not a solid cut-out.
function authorPortrait() {
  const g = Array.from({ length: CH }, () => new Array(CW).fill("."));
  const paint = (y, x0, str) => { for (let i = 0; i < str.length; i++) g[y][x0 + i] = str[i]; };
  const region = (y, x0, w, str) => {
    if (str.length !== w) throw new Error(`authored row y=${y} x=${x0}: expected ${w} cells, wrote ${str.length} (${str})`);
    paint(y, x0, str);
  };

  // hood crown: lit from the upper left, broken into patches rather than one smooth gradient
  paint(2, 20, "SSTRRQQQ");
  paint(3, 17, "SSTTRRQRQQQPQQ");
  paint(4, 15, "SSSTTRRQRRRQQRQQQP");
  paint(5, 13, "SSSSTTRRQRRRQQQRQQQPQP");
  paint(6, 12, "SSSSSTTRRQRRRQQQRQQQQPQP");
  paint(7, 11, "SSSSSSTTRRQRRRQQQRRQQQPQQP");
  // fringe under the hood rim: warm hair, lit on its left edge, going into shadow on the right
  paint(8, 10, "SSR");   paint(8, 13, "ONMLMMNLLMMMMLLKKLKKKK"); paint(8, 35, "RQP");
  paint(9, 9, "SST");    paint(9, 12, "ONMLMMNLLLLMMMLLKKLLKKKK"); paint(9, 36, "QPP");
  paint(10, 9, "TSSR");  paint(10, 13, "OMLMNLLLLMMMLLKLKKKKKK");  paint(10, 35, "RQPP");
  paint(11, 8, "TSSRQ"); paint(11, 13, "NMLMMMMMLLLLKKLKKKKKK");   paint(11, 34, "RQQPP");

  for (let y = 12; y <= 28; y++) {
    region(y, 8, 4, CLOTH_L[y]); region(y, 12, 2, HAIR_L[y]); region(y, 14, 21, FACE[y - 12]); region(y, 35, 2, HAIR_R[y]); region(y, 37, 3, CLOTH_R[y]);
  }
  region(29, 8, 4, "SRQP"); region(29, 12, 2, "ML"); region(29, 14, 21, FACE[17]); region(29, 35, 2, "KL"); region(29, 37, 4, "RQPP");

  // rows 30-33: the jaw narrows and the hood wraps under it
  region(30, 7, 10, "TSRRQQPQQP"); region(30, 17, 15, "CDDDEEDCEECBBBA"); region(30, 32, 9, "LKQPPQQPP");
  region(31, 7, 11, "STSRQQPQQPP"); region(31, 18, 13, "CCDDEEDCEECBB"); region(31, 31, 10, "LKQPPQQPPP");
  region(32, 6, 13, "TSSRQQPPQQPQP"); region(32, 19, 11, "CCDDEEDCCBB"); region(32, 30, 12, "LKQPPQQPPQQ");
  region(33, 6, 14, "SRRQQPPQQPQQPP"); region(33, 20, 9, "CCDEEDCBB"); region(33, 29, 13, "QPPQQPPQQPPQQ");

  // rows 34-36: the neck under the jaw, deepest shade on the body; row 36 leaves the air pocket open
  region(34, 5, 14, "TSRQQPPQQPQQPP"); region(34, 19, 10, "AAAABBBBBB"); region(34, 29, 14, "QQPPQQPPQQPPQQ");
  region(35, 5, 14, "SRQQPPQQPQQPPP"); region(35, 19, 10, "AAAAABBBBB"); region(35, 29, 14, "QPPQQPPQQPPQQP");
  region(36, 4, 15, "TRQQPPQQPPQQPPP"); region(36, 19, 9, "AAAAABBBB"); /* x28..30 stay air */ region(36, 31, 13, "PPQQPPQQPPQQP");

  // collar and shoulders widening to the hem
  region(37, 4, 40, "PPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPP");
  region(38, 3, 42, "SSRQRRSRRQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQ");
  region(39, 3, 42, "TSRRQRRSRRQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPP");
  for (let y = 40; y <= 45; y++) {
    paint(y, 2, y % 2 ? "TSSRQRRSRRQQ" : "SSRQQRRSRRQQ");
    paint(y, 14, y % 2 ? "RRQQPPQQPQQPPQQ" : "RQQQPPQQPQQPPQQ");
    paint(y, 29, y % 2 ? "QQPPQQPPQQPPQQPPQ" : "QPPQQPPQQPPQQPPQP");
  }
  for (let y = 46; y <= 51; y++) {
    paint(y, 2, y % 2 ? "SSRQRRRSRRQQ" : "TSSRQRRSRRQQ");
    paint(y, 14, y % 2 ? "RQQPPQQPPQQPPQQP" : "QQPPQQPPQQPPQQPP");
    paint(y, 30, y % 2 ? "PPQQPPQQPPQQPPQP" : "PQQPPQQPPQQPPQQP");
  }
  for (let y = 52; y <= 57; y++) {
    paint(y, 2, y % 2 ? "SRQQRRSRRQQP" : "SSRQRRRSRRQQ");
    paint(y, 14, y % 2 ? "QQPPQQPPQQPPQQPP" : "PPQQPPQQPPQQPPQP");
    paint(y, 30, y % 2 ? "QQPPQQPPQQPPQQQP" : "PPQQPPQQPPQQPPQP");
  }
  for (let y = 58; y <= 61; y++) {
    paint(y, 2, y % 2 ? "SRQRRRSRRQQP" : "SRRQRRRSRRQQ");
    paint(y, 14, y % 2 ? "QPPQQPPQQPPQQPPQ" : "PQQPPQQPPQQPPQQP");
    paint(y, 30, y % 2 ? "QPPQQPPQQPPQQQQP" : "PQQPPQQPPQQPPQPP");
  }
  region(62, 2, 44, "QQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPP");
  region(63, 2, 44, "PPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQQPPQP");
  return g.map(r => r.join(""));
}

// The features are placed one colour at a time — sockets, brows, lashes, pupils, catchlights, the
// nose, the mouth. These are the pixels that make it a face rather than a lit oval.
// [x, y, letter]
const FEATURES = [
  // brows: warm hair, four on the lit side, three on the shade side (the head is turned a fraction)
  [16, 17, "L"], [17, 17, "L"], [18, 17, "M"], [19, 17, "L"], [25, 17, "K"], [26, 17, "K"], [27, 17, "L"],
  // lash line / upper lid
  [17, 18, "e"], [18, 18, "e"], [19, 18, "e"], [25, 18, "e"], [26, 18, "e"], [27, 18, "e"],
  // pupils, 2x2 each
  [18, 19, "e"], [19, 19, "e"], [18, 20, "e"], [19, 20, "e"], [25, 19, "e"], [26, 19, "e"], [25, 20, "e"], [26, 20, "e"],
  // catchlights, one per eye, on the light side of each eyeball
  [17, 19, "g"], [24, 19, "g"],
  // nose: lit bridge, then the flank falling into the shade side
  [22, 17, "F"], [22, 18, "F"], [22, 19, "F"], [22, 20, "E"], [23, 21, "E"], [23, 22, "E"], [23, 23, "D"],
  // nostrils and the shadow under the tip
  [21, 24, "e"], [25, 24, "e"], [22, 25, "A"], [23, 25, "A"], [24, 25, "A"],
  // mouth: a 6px line off centre, upper-lip shadow above it, lower-lip light below it
  [20, 27, "e"], [21, 27, "e"], [22, 27, "e"], [23, 27, "e"], [24, 27, "e"], [25, 27, "e"],
  [21, 26, "A"], [22, 26, "A"], [23, 26, "A"], [24, 26, "A"],
  [21, 28, "D"], [22, 28, "D"], [23, 28, "D"], [24, 28, "D"],
  // chin and jaw picked out on the light side
  [21, 29, "E"], [22, 29, "E"], [23, 29, "D"],
  // the brass throat clasp: one cluster, off-centre, on the shade side of the collar
  [28, 39, "x"], [29, 39, "x"], [30, 39, "x"], [31, 39, "x"],
  [28, 40, "x"], [29, 40, "x"], [30, 40, "x"], [31, 40, "x"],
  [29, 41, "x"], [30, 41, "x"],
];

// Grain regions declared up front. Deliberately NOT on the face: dense grain on a face is exactly
// what the engine's dither rule protects against, and this coordinate declares grain for the cloth.
const GRAIN = [
  { name: "hood-crown-shadow", region: { x0: 30, y0: 5, x1: 35, y1: 11 }, pattern: "2x2-bayer", density: 0.3 },
  { name: "cloak-shadow-field", region: { x0: 33, y0: 44, x1: 44, y1: 60 }, pattern: "2x2-bayer", density: 0.35 },
  { name: "cloak-lit-fold", region: { x0: 4, y0: 46, x1: 13, y1: 57 }, pattern: "checker", density: 0.2 },
];

const CLAIMS = [
  "the portrait passes its own audit with zero error findings and nothing exempted (hero-tier rules)",
  "assert_style conforms at art_scale 48 for asset_class 'character' — a character body is legitimately solid, so no_negative_space does not fire for it",
  "craft_targets met at art_scale 48: colours <= 32, ramp steps >= 5, cluster mean >= 3.0, silhouette compactness in the 4.4-9.5 band, value range >= 0.55",
  "cluster character proves the painterly register numerically: clusterStats shows hand-sized 2-6px patches dominating the distribution, with the size histogram reported",
  "dither is used legally: detail declares dense-grain, so the engine reports the checkerboard pairs as permitted rather than as a fault; pair counts are reported",
  "no direction set is required by this class and that is declared rather than omitted: the project convention carries zero directions and motion is static",
  "silhouette / squint / value_map renders exist and were reviewed by looking at them",
  "the coordinate was declared from scratch — no preset bible and no reused palette",
];
