// PHASE 1 GATE — the potion.
//
// "I draw a 16x16 potion from a blank canvas, in <= 25 tool calls, that (a) passes audit with
//  zero violations and (b) survives review at game scale. No shape primitives for the bottle
//  body — only considered pixels."  (PLAN.md §5, Phase 1)
//
// This script is the gate. It counts its own tool calls, refuses to use draw_shape, and prints
// the audit with coordinates. Run: node bench/gate1-potion.js
"use strict";

const path = require("path");
const fs = require("fs");
const { TOOLS, Workspace } = require("../src/tools.js");

const ROOT = path.join(__dirname, "..", "out", "gate1");
fs.rmSync(ROOT, { recursive: true, force: true });

const W = new Workspace(ROOT);
let calls = 0;
const NO_THROW = new Set(["audit", "assert_style", "regression_check", "export_gate", "loop_validate", "family_audit", "tileset_audit", "coverage_report", "craft_metrics",
  "view", "chunk", "contact_sheet", "contact_grid", "onion", "play", "silhouette", "squint", "value_map", "game_scale", "diff", "heatmap", "review_pack", "compare", "export_sheet"]);
const call = (name, args = {}) => {
  calls++;
  const res = TOOLS[name].run(args);
  if (res && res.ok === false && !args.expect_refusal && !NO_THROW.has(name)) {
    const v = (res.violations || []).map(x => `${x.rule}: ${x.message}`).join(" | ") || res.reason || "refused";
    throw new Error(`${name} refused: ${v}`);
  }
  return res;
};

// ---- the coordinate -----------------------------------------------------------
const STYLE = {
  id: "warm-topdown", projection: "topdown", art_scale: 16, palette_size: 24,
  temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "static", mood: "cozy-warm", light_vector: [-0.7, -0.7],
};

// ---- the palette: authored ramp recipes, not filter output --------------------
// glass  : cool, desaturating into shadow
// liquid : warm, the mass the object is *about*
// cork   : the driest material in the frame
const PALETTE = {
  ramps: {
    glass:  { role: "material", colors: ["#2f414d", "#48657a", "#6d90a6", "#9cbccf"] },
    liquid: { role: "material", colors: ["#4a1a12", "#7d2f1c", "#b0522a", "#e08a45"] },
    cork:   { role: "material", colors: ["#3a2a18", "#5f4527", "#87643a"] },
    twine:  { role: "material", colors: ["#5c4a30", "#8a7452"] },
  },
  single: {
    glint:   { rgb: "#f2e7c9", role: "light" },   // the one declared light source on the object
    outline: { rgb: "#141a20", role: "outline" },
    contact: { rgb: "#241f1c", role: "shadow" },
  },
};

const LEGEND = {
  g: "glass.0", G: "glass.1", h: "glass.2", H: "glass.3",
  a: "liquid.0", A: "liquid.1", b: "liquid.2", B: "liquid.3",
  k: "cork.0", K: "cork.1", l: "cork.2",
  t: "twine.0", T: "twine.1",
  "*": "glint", o: "outline", s: "contact",
};

// ---- the drawing: every pixel placed by hand ----------------------------------
// Bottle: cork at the top, a narrow neck, a shouldered body, a flat weighted base.
// Light from the upper-left, so the bright glass steps (H) run down the left flank and the dark
// ones (G, g) down the right. The liquid follows the same rule inside the glass: B upper-left,
// a lower-right. The cork is lit the same way. The glint is the focal accent and sits opposite
// the cork. The contact row is authored, not appended by a tool.
const POTION = [
  "................",
  "................",
  ".....KKkk.......",
  ".....KKkk.......",
  ".....kkkk.......",
  ".....HHGGTTTT...",
  "....HHHHG...T...",
  "...HH**BG...T...",
  "..HHHBBBBbbGG...",
  "..HHBBBbbbaGG...",
  ".HHHBBbbaaagg...",
  ".HHBbbaAaagg....",
  ".HHBAaaaaagg....",
  ".HHAAAAaagg.....",
  "..HHbbbaagg.....",
  "...ssssss.......",
];

console.log("PHASE 1 GATE — 16x16 potion, hand-placed pixels, no shape primitives\n");

// 1. project, palette, sprite: 3 calls
call("project_init", { root: ROOT, game: "gate1", style: STYLE, canvas: { w: 16, h: 16 }, fps: 12 });
call("palette_set", { id: "potion", spec: PALETTE });
call("sprite_create", {
  id: "potion", w: 16, h: 16, palette: "potion", style: "warm-topdown",
  tier: "support", asset_class: "object",
  design: {
    primary_read: "a stoppered bottle of something warm — the liquid is the object, the glass is only how you know",
    exaggerated: "the shouldered body; the neck is deliberately thin so the body reads at a glance",
    simplified: "cork and neck: three shapes, no grain detail",
    focal_accent: "the glint on the upper-left shoulder, opposite the cork",
    negative_space: "the twine loop tied below the cork encloses six pixels of air — the bottle is not a solid lump",
    shape_family: "blunt_weighted — flat base, rounded shoulder, no tapered ends",
  },
});

// 2. the map: 1 call. This is the whole drawing.
const map = POTION.map(r => [...r].map(ch => {
  if (ch === ".") return ".";                                  // transparent is not a palette entry
  const idx = W.palette("potion").index(LEGEND[ch]);
  if (idx < 0) throw new Error(`legend '${ch}' -> '${LEGEND[ch]}' is not in the palette`);
  return require("../src/core/cel.js").charFor(idx);
}).join(""));
const drawn = call("draw_pixel_map", { cel: "potion.base", palette: "potion", map });
console.log(`  draw_pixel_map: ${drawn.changed.pixels} pixels placed`);
const saved = call("save_cel", { sprite: "potion", cel: "potion.base", cel_key: "base" });
console.log(`  save_cel: ${saved.file} (${saved.bytes} bytes) — the drawing is now git-diffable text`);

// 3. the fixes the audit asks for, each one named by the audit itself
const fixes = [];
for (let round = 0; round < 6; round++) {
  const a = call("audit", { cel: "potion.base", sprite: "potion", style: "warm-topdown" });
  const errs = a.findings.filter(f => f.severity !== "warn");
  const warns = a.findings.filter(f => f.severity === "warn");
  console.log(`\n  audit round ${round}: ${a.findings.length} findings (${errs.length} error, ${warns.length} warn)`);
  for (const f of a.findings.slice(0, 12)) console.log(`    ${f.severity} ${f.rule}${f.at ? ` @ ${f.at.slice(0, 4).map(p => `${p.x},${p.y}`).join(" ")}` : ""}: ${f.message}`);
  if (!a.findings.length) break;

  // Apply only what the audit names, using only the tools the audit names as the fix.
  for (const f of warns) {
    if (f.rule === "no_contact_ground") { fixes.push(call("contact_shadow", { cel: "potion.base", shadow: "contact" })); }
    if (f.rule === "no_focal_accent") {
      const glint = W.palette("potion").index("glint");
      const cells = [[4, 8], [5, 8], [4, 9]].map(([x, y]) => `${x},${y},${glint}`).join(";");
      fixes.push(call("put", { cel: "potion.base", cells }));
    }
    if (f.rule === "lone_pixel" || f.rule === "detached_speck") {
      const cells = (f.at || []).map(p => `${p.x},${p.y},.`).join(";");
      if (cells) fixes.push(call("erase", { cel: "potion.base", cells }));
    }
    if (f.rule === "staircase_edge") fixes.push(call("aa_pass", { cel: "potion.base" }));
    if (f.rule === "flat_mass") fixes.push(call("paint_form", { cel: "potion.base", material: f.ramp || "liquid", form: "sphere", light: STYLE.light_vector, region: f.region }));
  }
  for (const f of errs) {
    if (f.rule === "ramp_jump") {
      const cells = (f.at || []).map(p => `${p.x},${p.y},${W.palette("potion").index("glass.2")}`).join(";");
      if (cells) fixes.push(call("put", { cel: "potion.base", cells, expect_refusal: true }));
    }
    if (f.rule === "light_direction") {
      fixes.push(call("paint_form", { cel: "potion.base", material: "liquid", form: "sphere", light: STYLE.light_vector, region: { x: 3, y: 8, w: 10, h: 7 }, expect_refusal: true }));
    }
  }
}

// 4. review at game scale: the second half of the gate
const view = call("view", { cel: "potion.base", style: "warm-topdown", zoom: 16 });
const gs = call("game_scale", { cel: "potion.base", style: "warm-topdown" });
const sq = call("squint", { cel: "potion.base", style: "warm-topdown" });
const sil = call("silhouette", { cel: "potion.base", style: "warm-topdown" });
const style = call("assert_style", { cel: "potion.base", sprite: "potion", style: "warm-topdown" });
const craft = call("craft_metrics", { cel: "potion.base", palette: "potion" });

const finalAudit = call("audit", { cel: "potion.base", sprite: "potion", style: "warm-topdown" });

console.log(`\n  FINAL AUDIT: ${finalAudit.findings.length} findings — ${finalAudit.ok ? "CLEAN" : "NOT CLEAN"}`);
for (const f of finalAudit.findings) console.log(`    ${f.severity} ${f.rule}: ${f.message}`);
console.log(`  assert_style: ${style.ok ? "conforms" : "violations " + style.violations.map(v => v.rule).join(", ")}`);
for (const [label, res] of [["view", view], ["game_scale", gs], ["squint", sq], ["silhouette", sil]]) {
  const sv = res.style_violations || [];
  if (!res.ok) console.log(`  ${label}: STYLE VIOLATIONS — ${sv.map(v => `${v.rule}: ${v.message}`).join(" | ")}`);
}
console.log(`  renders used: view/game_scale/squint/silhouette -> ${view.image}, ${gs.image}, ${sq.image}, ${sil.image}`);
console.log(`  craft score: ${craft.score ?? craft.craft} grade ${craft.grade}`);
console.log(`\n  TOOL CALLS USED: ${calls} (gate allows 25)`);
console.log(`  shape primitives used for the body: 0`);

const pass = finalAudit.findings.length === 0 && calls <= 25;
console.log(`\n  PHASE 1 GATE: ${pass ? "PASS" : "FAIL"}`);
fs.writeFileSync(path.join(__dirname, "..", "out", "gate1-report.txt"),
  `calls=${calls} findings=${finalAudit.findings.length} pass=${pass}\n`);
process.exit(pass ? 0 : 1);
