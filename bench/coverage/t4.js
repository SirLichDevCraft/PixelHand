// PHASE 8 COVERAGE — T4: the heavy opponent at the top of the character scale.
// docs/08 §4 row T4: "64x64, 40 colours, sculpted-large, 8-way with anticipation-heavy attack and a
// 6-frame death" — proves "high-detail form sculpting and weight".
//
// The coordinate is declared from scratch (no preset): its own style id, its own palette.
// "40 colours" is read as *at least* 40, so the nearest legal value on this engine's palette axis
// (src/core/style.js L11: 2,4,8,16,24,32,48) is 48 — and the tension that creates is reported, not
// hidden: the external craft bar for art_scale 64 caps a composed frame at 40 colours used
// (src/core/regression.js CRAFT_TARGETS[64]), so the bible may hold 48 steps while any one drawing
// must spend no more than 40 of them. Both numbers are measured below.
//
// One character — "Slab", a pauldron-shouldered hulk with an iron maul — across 8 facings:
// four cardinals authored as pixel maps, four diagonals produced by direction_derive and reported
// as drafts (docs/03 §1: a derived diagonal is a draft, never the answer).
// Three clips: an 8-frame walk, an anticipation-heavy 6-frame attack, a 6-frame death.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { authorAsset } = require("../../src/author.js");
const { Cel } = require("../../src/core/cel.js");

// ---- the coordinate --------------------------------------------------------------
const STYLE = {
  id: "t4-slab-heavy",
  projection: "three-quarter",   // docs/08 axis A; the rig's 8-direction set is a three-quarter set
  art_scale: 64, palette_size: 48,
  temperature: "complementary-shadow",   // warm lit masses, shadows that shift to the cool side
  edge_policy: "selective-dark",         // line weight only where a form opens on the shadow side
  shading: "sculpted",                   // needs palette >= 24 and scale >= 48 (style.js L30-33)
  detail: "moderate",                    // dense-grain would demand real dithering; see notes
  motion: "8-frame",
  mood: "menacing",
  light_vector: [-0.7, -0.7],
};
const PALETTE_ID = "t4-slab";
const CANVAS = { w: 64, h: 64 };
const FPS = 12;
const BASELINE = 55;             // authored foot baseline row; contact band sits at 56
const CONTACT_ROW = 56;

// Seven material ramps + eleven authored single colours = 48 entries.
// complementary-shadow is expressed *inside* each ramp: the dark end shifts to the cool/complement
// side of the lit end's hue, so a warm-lit mass lands its shadow on violet-blue rather than grey.
const PALETTE_SPEC = {
  origin: "authored for T4 from declared base hues; no preset palette reused",
  base_hues: { iron: "cool steel, 197..228deg", hide: "warm tan lit / violet shadow", wood: "olive-brown", rust: "corroded iron", flesh: "warm flesh / violet shadow", mail: "desaturated green-grey", ash: "neutral impact dust" },
  ramps: {
    iron: { role: "material", colors: ["#1c2334", "#2b3547", "#3d4c62", "#526479", "#6a7e93", "#8799ab", "#a6b8c6", "#c6d3da"] },
    mail: { role: "material", colors: ["#18211d", "#26332c", "#354639", "#485c4a", "#5d735d", "#758b72"] },
    hide: { role: "material", colors: ["#241c2b", "#3a2a38", "#544044", "#6f5449", "#8d6d54", "#ac8765"] },
    wood: { role: "material", colors: ["#201e14", "#332f1f", "#48402a", "#605436", "#7d6d45"] },
    flesh: { role: "material", colors: ["#3b2a3f", "#63474f", "#8f6a6a", "#bd9482"] },
    rust: { role: "material", colors: ["#33201a", "#4d2c1d", "#6d4024", "#91592d"] },
    ash: { role: "material", colors: ["#2f2c2a", "#4a4642", "#6b6660", "#8f8a82"] },
  },
  single: {
    outline: { rgb: "#0b0f14", role: "outline" },
    void: { rgb: "#05070b", role: "outline" },
    contact: { rgb: "#151013", role: "shadow" },
    shade: { rgb: "#241d29", role: "shadow" },
    flash: { rgb: "#eef4f7", role: "light" },
    glint: { rgb: "#dbe4e9", role: "light" },
    accent: { rgb: "#dfae52", role: "accent" },
    ember: { rgb: "#b4652a", role: "detail" },
    grit: { rgb: "#9a9488", role: "detail" },
    chip: { rgb: "#6b6558", role: "detail" },
    dust: { rgb: "#c2bcae", role: "detail" },
  },
};

// ---- claims, declared before the work -------------------------------------------
const CLAIMS = [
  "the coordinate was declared from scratch — no preset bible and no reused palette",
  "sculpted form is real, not a label: every material ramp in use supplies at least 6 value steps and craft_metrics' form sub-metric measures modelled regions rather than flat fills at art_scale 64",
  "every composed frame passes audit with zero error findings, assert_style for asset_class character, and craft_targets for scale 64",
  "loop_validate passes for walk, attack and death across all 8 facings",
  "the attack's anticipation is measurable: per-frame silhouette area and centre of mass show mass pulled back through the wind-up and thrown forward by the strike",
  "the death clip is six authored frames — hit, fall, ground contact, settle — with the hold carried by duration, never by a duplicated frame",
  "timing is authored: explicit per-frame millisecond durations on every clip and facing, with the anticipation longer than the swing",
  "export_gate would allow export of all three clips",
  "contact_grid sheets and playback GIFs exist for all three clips across the facings",
  "8-way coverage is real: four cardinals authored as pixel maps, four diagonals produced by direction_derive and reported as drafts",
  "committed grids are byte-identical on a clean re-run (hash comparison)",
  "the sculpted coordinate is enforced rather than decorative: the same shading declared under 24 colours or under 48px is refused by the engine",
];

// ---- grid loading ---------------------------------------------------------------
// The character is authored as text grids under bench/data/t4/grids/, one file per authored facing,
// split into named part sections. Every pixel in them was placed by hand; nothing here is generated.
const GRID_DIR = path.join(__dirname, "..", "data", "t4", "grids");

function loadFacingGrid(facing) {
  const file = path.join(GRID_DIR, `${facing}.grid`);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const parts = {};
  let cur = null;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith("@")) {
      const [, name, origin] = line.split(/\s+/);
      const [ox, oy] = origin.split(",").map(Number);
      cur = { name, ox, oy, rows: [] };
      parts[name] = cur;
      continue;
    }
    if (!cur) continue;
    if (line.trim() === "") continue;
    cur.rows.push(line.replace(/\s+$/, ""));
  }
  for (const [name, p] of Object.entries(parts)) {
    const width = Math.max(...p.rows.map(r => r.length));
    for (let i = 0; i < p.rows.length; i++) {
      const bad = /[^\dA-Za-z.]/.test(p.rows[i]);
      if (bad) throw new Error(`grid ${facing}/${name} row ${i} contains a non-pixel character`);
      void width; void Cel;
    }
  }
  return parts;
}

// Letters -> materials. A cell carries its own material while it is being drawn (docs/09 §1),
// so the blade, the haft and the pauldron are three decisions, not three regions found later.
const LEGEND = {
  I: "iron", M: "mail", H: "hide", W: "wood", F: "flesh", R: "rust", A: "ash",
};
// 'A' in the authored grids is the declared focal accent, placed rather than implied (docs/09 §3.5).
function mapForGrid() {
  const map = { ...LEGEND };
  map.A = { material: "iron", role: "accent" };   // the brass boss reads as metal furniture on the plate
  return map;
}

module.exports = { id: "T4", title: "64x64 sculpted hulk, 8-way, anticipation-heavy attack, 6-frame death", proves: "high-detail form sculpting and weight", coordinate: STYLE, claims: CLAIMS, run };
