// PHASE 2 GATE — craft rules and style presets enforced together.
//
// "the *same* potion drawn under three maximally distant coordinates ... Each visibly belongs to
//  its style, each passes its own audit, ... the engine refuses at least three impossible
//  coordinates with a clear reason, and the craft metrics correctly flag draft 1 of the pistol as
//  a design failure while passing draft 2."  (PLAN.md §5, Phase 2)
//
// The blind-comparison half ("a blind comparison names the style from the art alone") needs a
// human and is reported as awaiting review, not as passed.
"use strict";

const path = require("path");
const fs = require("fs");
const { Cel, charFor } = require("../src/core/cel.js");
const { TOOLS, W } = require("../src/tools.js");
const { validateCoordinate } = require("../src/core/style.js");
const { craftScore } = require("../src/craft.js");

const ROOT = path.join(__dirname, "..", "out", "gate2");
fs.rmSync(ROOT, { recursive: true, force: true });


let calls = 0;
const call = (name, args = {}) => {
  calls++;
  const res = TOOLS[name].run(args);
  if (res && res.ok === false && !args.expect_refusal) {
    const v = (res.violations || []).map(x => `${x.rule}: ${x.message}`).join(" | ") || res.reason || "refused";
    throw new Error(`${name} refused: ${v}`);
  }
  return res;
};

const out = [];
const say = (s) => { out.push(s); console.log(s); };

// ---------------------------------------------------------------------------
// Three coordinates chosen to be as far apart as the axis space allows.
// ---------------------------------------------------------------------------
const COORDS = {
  "warm-topdown": {
    style: {
      id: "warm-topdown", projection: "topdown", art_scale: 16, palette_size: 24,
      temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
      detail: "moderate", motion: "static", mood: "cozy-warm", light_vector: [-0.7, -0.7],
    },
    palette: {
      ramps: {
        glass:  { role: "material", colors: ["#2f414d", "#48657a", "#6d90a6", "#9cbccf"] },
        liquid: { role: "material", colors: ["#4a1a12", "#7d2f1c", "#b0522a", "#e08a45"] },
        cork:   { role: "material", colors: ["#3a2a18", "#5f4527", "#87643a"] },
        twine:  { role: "material", colors: ["#5c4a30", "#8a7452"] },
      },
      single: { glint: { rgb: "#f2e7c9", role: "light" }, outline: { rgb: "#141a20", role: "outline" }, contact: { rgb: "#241f1c", role: "shadow" } },
    },
    legend: { g:"glass.0", G:"glass.1", h:"glass.2", H:"glass.3", a:"liquid.0", A:"liquid.1", b:"liquid.2", B:"liquid.3", k:"cork.0", K:"cork.1", l:"cork.2", t:"twine.0", T:"twine.1", "*":"glint", o:"outline", s:"contact" },
    grid: [
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
    ],
    intent: "warm, inhabited, lit by a single source. Mid-tones carry the form.",
  },

  "flat-noir-highcontrast": {
    style: {
      id: "flat-noir-highcontrast", projection: "side", art_scale: 16, palette_size: 16,
      temperature: "grey-value", edge_policy: "none", shading: "flat",
      detail: "pristine", motion: "static", mood: "menacing", light_vector: [-0.85, -0.5],
    },
    palette: {
      ramps: {
        glass:  { role: "material", colors: ["#10161c", "#2f414d", "#5d7a92", "#9db8cc"] },
        liquid: { role: "material", colors: ["#33110a", "#73271a", "#b0432a", "#e07c42"] },
        cork:   { role: "material", colors: ["#241c12", "#4f3d24", "#7d6540"] },
        twine:  { role: "material", colors: ["#3f4a44", "#66756c", "#95a49a"] },
      },
      single: { glint: { rgb: "#fff4d6", role: "light" } },
    },
    legend: { g:"glass.0", G:"glass.1", h:"glass.2", H:"glass.3", a:"liquid.0", A:"liquid.1", b:"liquid.2", B:"liquid.3", k:"cork.0", K:"cork.1", l:"cork.2", t:"twine.0", T:"twine.1", L:"twine.2", "*":"glint" },
    // Flat means the DRAWING skips the mid-tones, not that the palette is allowed to jump value.
    // Lit glass is step 3, shadow glass is step 1: a hard split that is still legal on the ramp.
    grid: [
      "................",
      "................",
      ".....llkk.......",
      ".....llkk.......",
      ".....kkkk.......",
      ".....HHGGLLL....",
      "....HHHHG...L...",
      "...HH**BG...L...",
      "..HHHBBBBAAGG...",
      "..HHBBBAAAaGG...",
      ".HHHBBAAaaagg...",
      ".HHBAAAAaagg....",
      ".HHBAaaaaagg....",
      ".HHAAAAaagg.....",
      "..GGAAAaagg.....",
      "...gggggg.......",
    ],
    intent: "hard light from the left, almost no mid-tone, the shadow side reads as silhouette.",
  },

  "monochrome-value": {
    style: {
      id: "monochrome-value", projection: "topdown", art_scale: 8, palette_size: 2,
      temperature: "grey-value", edge_policy: "none", shading: "two-value",
      detail: "pristine", motion: "static", mood: "sterile", light_vector: [-0.7, -0.7],
    },
    palette: {
      single: { dark: { rgb: "#191d23", role: "general" }, light: { rgb: "#d7dee6", role: "light" } },
    },
    legend: { d: "dark", L: "light" },
    // 8x8, two values. The whole design decision is *where the value split falls*, and the
    // undercut under the collar is what stops this from being a blob.
    grid: [
      "..LL....",
      ".LddL...",
      ".L..L...",
      "LLLLLL..",
      "LdLLdL..",
      "LdLLdL..",
      ".LLLL...",
      "..dd....",
    ],
    intent: "no hue at all: the object exists only as a value relationship against the ground.",
  },
};

say("PHASE 2 GATE — one design, three maximally distant coordinates\n");

call("project_init", { root: ROOT, game: "gate2", style: COORDS["warm-topdown"].style, canvas: { w: 16, h: 16 }, fps: 12 });

const results = {};
for (const [id, spec] of Object.entries(COORDS)) {
  const size = spec.style.art_scale;
  call("style_create", { id, bible: spec.style });
  call("palette_set", { id, spec: spec.palette });
  call("sprite_create", {
    id, w: size, h: size, palette: id, style: id,
    tier: id === "monochrome-value" ? "system" : "support", asset_class: "object",
    design: { read: spec.intent },
  });
  const map = spec.grid.map(r => [...r].map(ch => ch === "." ? "." : charFor(W.palette(id).index(spec.legend[ch]))).join(""));
  const celId = `${id}.base`;
  call("draw_pixel_map", { cel: celId, palette: id, map });
  call("save_cel", { sprite: id, cel: celId, cel_key: "base" });

  const a = call("audit", { cel: celId, sprite: id, style: id });
  const st = call("assert_style", { cel: celId, sprite: id, style: id });
  const v = call("view", { cel: celId, style: id, zoom: size <= 8 ? 32 : 16 });
  const sq = call("squint", { cel: celId, style: id });
  const sil = call("silhouette", { cel: celId, style: id });
  const cel = W.store.get(celId);
  const cs = craftScore(cel, W.palette(id), { style: spec.style });

  results[id] = { audit: a.findings.length, auditOk: a.ok, styleOk: st.ok, styleViolations: st.violations.map(x => x.rule), craft: cs.score, grade: cs.grade, colours: cel.counts().size, silhouette: cel.bbox()?.area ?? 0, negative: st.metrics?.negativeSpace?.enclosed };

  say(`  ${id}  (${size}x${size}, palette cap ${spec.style.palette_size})`);
  say(`    audit        ${a.findings.length} findings ${a.ok ? "[clean]" : "[FINDINGS]"}`);
  for (const f of a.findings.slice(0, 8)) say(`      ${f.severity} ${f.rule}${f.at?.length ? ` @ ${f.at.join(" ")}` : ""}: ${f.message}`);
  say(`    assert_style ${st.ok ? "conforms" : "VIOLATIONS: " + st.violations.map(x => `${x.rule} — ${x.message}`).join(" | ")}`);
  say(`    metrics      ${results[id].colours} colours, ${results[id].silhouette}px silhouette, ${results[id].negative} enclosed air, craft ${cs.score} (${cs.grade})`);
  say(`    renders      ${v.image.split(/[\\/]/).pop()}, ${sq.image.split(/[\\/]/).pop()}, ${sil.image.split(/[\\/]/).pop()}`);
}

// ---------------------------------------------------------------------------
// The three must be measurably different drawings, not one drawing with a filter on it.
// ---------------------------------------------------------------------------
say(`\n  MEASURABLE DISTANCE BETWEEN THE THREE`);
const ids = Object.keys(results);
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const cmp = call("compare", { a: `${ids[i]}.base`, b: `${ids[j]}.base` });
  if (cmp.sameCanvas) say(`    ${ids[i]} vs ${ids[j]}: ${cmp.changed.pixels} of ${results[ids[i]].silhouette} pixels differ; palettes ${results[ids[i]].colours}/${results[ids[j]].colours} entries`);
  else say(`    ${ids[i]} vs ${ids[j]}: different canvases — shape distance ${cmp.shape.distance} (aspect ${cmp.shape.a.aspect}/${cmp.shape.b.aspect}, fill ${cmp.shape.a.fill}/${cmp.shape.b.fill}, compactness ${cmp.shape.a.compactness}/${cmp.shape.b.compactness}); palettes ${results[ids[i]].colours}/${results[ids[j]].colours} entries`);
}

// ---------------------------------------------------------------------------
// Impossible coordinates must be refused at DECLARATION, before a pixel exists.
// ---------------------------------------------------------------------------
say(`\n  IMPOSSIBLE COORDINATES THE ENGINE REFUSES`);
const IMPOSSIBLE = [
  { id: "bad-1", projection: "topdown", art_scale: 8,  palette_size: 24, temperature: "warm-cool-hue-shift", edge_policy: "chunky-2px", shading: "ramp-lit", detail: "moderate", motion: "static", mood: "cozy-warm" },
  { id: "bad-2", projection: "topdown", art_scale: 8,  palette_size: 24, temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "ramp-lit", detail: "hyper", motion: "static", mood: "cozy-warm" },
  { id: "bad-3", projection: "iso-21",  art_scale: 8,  palette_size: 24, temperature: "ambient-tinted", edge_policy: "selective-dark", shading: "sculpted", detail: "moderate", motion: "4-frame", mood: "whimsical" },
  { id: "bad-4", projection: "topdown", art_scale: 32, palette_size: 2,  temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "sculpted", detail: "moderate", motion: "static", mood: "cozy-warm" },
  { id: "bad-5", projection: "topdown", art_scale: 16, palette_size: 8,  temperature: "grey-value", edge_policy: "none", shading: "flat", detail: "moderate", motion: "sub-asset", mood: "sterile" },
];
let refused = 0;
for (const c of IMPOSSIBLE) {
  const r = validateCoordinate(c);
  if (!r.ok) { refused++; say(`    REFUSED ${c.id}: ${r.errors.map(e => `${e.rule} — ${e.message}`).join(" | ")}`); }
  else say(`    ACCEPTED ${c.id} (unexpected)`);
}
const toolRefusal = call("style_create", { id: "bad-1", bible: IMPOSSIBLE[0], expect_refusal: true });
say(`    via the style_create tool: ${toolRefusal.ok ? "accepted (unexpected)" : "refused — " + toolRefusal.violations.map(v => v.message).join(" | ")}`);

// ---------------------------------------------------------------------------
// Craft metrics must flag pistol draft 1 as a DESIGN failure and pass draft 2.
// ---------------------------------------------------------------------------
say(`\n  CRAFT METRICS ON THE PISTOL EXPERIMENT (docs/09 §1)`);
const pistolStyle = { id: "pistol", projection: "side", art_scale: 32, palette_size: 16, temperature: "warm-cool-hue-shift", edge_policy: "full-1px", shading: "ramp-lit", detail: "moderate", motion: "static", mood: "menacing", light_vector: [-0.7, -0.7] };
call("style_create", { id: "pistol", bible: pistolStyle });
const pistolPal = { single: Object.fromEntries(Object.entries(require("../probe/draw-pistol.js").P).map(([k, rgb]) => [`c${k}`, { rgb: `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}`, role: "general" }])) };
call("palette_set", { id: "pistol", spec: pistolPal });

for (const [label, mod] of [["draft 1", "../probe/draw-pistol.js"], ["draft 2", "../probe/draw-pistol-v2.js"]]) {
  const m = require(mod);
  const cel = new Cel(m.W, m.H, "pistol", `pistol-${label}`);
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.out[y * m.W + x] >= 0) cel.set(x, y, m.out[y * m.W + x]);
  const cs = craftScore(cel, W.palette("pistol"), { style: pistolStyle, light: pistolStyle.light_vector, assetClass: "object" });
  const ns = require("../src/core/style.js").negativeSpace(cel);
  say(`    ${label}: craft ${cs.score} grade ${cs.grade}  negative space ${ns.enclosed} enclosed / open ratio ${ns.openRatio}`);
  say(`      weakest: ${cs.weakest.join(", ")}`);
  results[`pistol-${label}`] = { craft: cs.score, grade: cs.grade, negative: ns.enclosed, sub: cs.sub };
}
say(`      sub-metric comparison (the honest table, not just the aggregate):`);
say(`        metric        draft 1   draft 2   delta`);
for (const k of Object.keys(results["pistol-draft 1"].sub)) {
  const a = results["pistol-draft 1"].sub[k], b = results["pistol-draft 2"].sub[k];
  say(`        ${k.padEnd(12)} ${String(a).padEnd(9)} ${String(b).padEnd(9)} ${(b - a >= 0 ? "+" : "") + (b - a).toFixed(3)}`);
}

// ---------------------------------------------------------------------------
const gate = {
  auditsClean: ids.every(i => results[i].auditOk),
  stylesConform: ids.every(i => results[i].styleOk),
  impossibleRefused: refused >= 3 && !toolRefusal.ok,
  craftSeparatesPistols: results["pistol-draft 1"].craft < results["pistol-draft 2"].craft,
  craftFlagsDraft1: results["pistol-draft 1"].negative === 0 && results["pistol-draft 1"].sub.blob < results["pistol-draft 2"].sub.blob,
  craftPassesDraft2: results["pistol-draft 2"].negative > 0,
};
say(`\n  GATE CHECKS`);
say(`    every coordinate passes its own audit .......... ${gate.auditsClean ? "PASS" : "FAIL"}`);
say(`    every coordinate passes its own assert_style ... ${gate.stylesConform ? "PASS" : "FAIL"}`);
say(`    ≥3 impossible coordinates refused ................ ${gate.impossibleRefused ? "PASS" : "FAIL"} (${refused})`);
say(`    craft metrics rank draft 2 above draft 1 ......... ${gate.craftSeparatesPistols ? "PASS" : "FAIL"} (${results["pistol-draft 1"].craft} vs ${results["pistol-draft 2"].craft})`);
say(`    craft metrics flag draft 1's lump ............... ${gate.craftFlagsDraft1 ? "PASS" : "FAIL"}`);
say(`    craft metrics credit draft 2's negative space ... ${gate.craftPassesDraft2 ? "PASS" : "FAIL"} — draft 2 never actually closed its trigger guard; the hole leaks to the outside`);
say(`    blind comparison names the style from the art .... AWAITING HUMAN REVIEW (needs you, not the engine)`);
say(`    tool calls used .................................. ${calls}`);

const pass = Object.values(gate).every(Boolean);
say(`\n  PHASE 2 GATE: ${pass ? "PASS (mechanical half)" : "PARTIAL — see failures above"}`);
if (!pass) {
  say(`\n  FINDINGS, stated plainly rather than tuned away:`);
  say(`    1. The aggregate craft score ranks draft 1 ABOVE draft 2 (0.772 vs 0.769).`);
  say(`       The sub-metric that matches the human diagnosis — blob, lumpiness — favours draft 2 (+0.078).`);
  say(`       The aggregate loses it because form/light/value/outline are saturated at 1.0 for both drafts,`);
  say(`       so they carry no information, and clusters penalises draft 2 for the 13 lone pixels its`);
  say(`       added sights and guard introduced (draft 1 had 7).`);
  say(`    2. Draft 2 never actually closed its trigger guard. The claim in PLAN.md Phase 0.5 that it`);
  say(`       "reads as a pistol" because of a guard loop separated by air is wrong: negativeSpace finds`);
  say(`       zero enclosed pixels in both drafts. The pocket leaks to the outside through one pixel.`);
  say(`    3. Both drafts score 0 on focal accent. Neither has a declared accent colour in its palette,`);
  say(`       so neither has anything to look at. That was never measured before this gate ran.`);
  say(`  Conclusion: an aggregate that ranks the worse design higher is not a gate. The sub-metrics are`);
  say(`  the gate, and craft_metrics returns the full sub-table so the disagreement is visible rather than`);
  say(`  averaged away. Weighting the aggregate to force agreement would have been fitting the test.`);
}
fs.writeFileSync(path.join(__dirname, "..", "out", "gate2-report.txt"), out.join("\n"));
