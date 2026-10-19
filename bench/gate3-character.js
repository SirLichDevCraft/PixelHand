// PHASE 3 GATE — the hard test, early: a character with personality.
//
// "a 16x32 character with a declared personality, 4 directions x 4-frame walk. Reviewed by you
//  twice: once at the unshaded silhouette stage, once at playback."  (PLAN.md §5, Phase 3)
//
// This file is STAGE 1 of that gate and it deliberately stops. Silhouette is reviewed before
// shading exists, because shading is how a bad silhouette hides. Adding colour here would make
// the review useless. Stage 2 (walk frames, timing, playback) runs only after this is approved.
"use strict";

const path = require("path");
const fs = require("fs");
const { Cel, charFor } = require("../src/core/cel.js");
const { TOOLS, W } = require("../src/tools.js");
const { negativeSpace, featureCount, assertStyle } = require("../src/core/style.js");
const { craftScore } = require("../src/craft.js");

const ROOT = path.join(__dirname, "..", "out", "gate3");
fs.rmSync(ROOT, { recursive: true, force: true });

const call = (name, args = {}) => {
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
// The coordinate and the person, declared before a single pixel exists.
// ---------------------------------------------------------------------------
const STYLE = {
  id: "late-courier", projection: "three-quarter", art_scale: 32, palette_size: 24,
  temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "4-frame", mood: "whimsical", light_vector: [-0.7, -0.7],
  signature: "small person, too much equipment; warm lamp-lit colours against a cold ground",
};

const DESIGN = {
  name: "Pim",
  role: "courier who is always late",
  personality: "apologetic, flustered, permanently in a hurry. A body too small for the equipment it is carrying.",
  primary_read: "a head on top of a bag, with boots underneath",
  exaggerated: "the satchel — nearly half the height; the boots — two sizes too big; the strap — cut too long",
  simplified: "no fingers, no belt, no face beyond two pixels of eye",
  focal_accent: "the brass buckle on the satchel flap",
  negative_space: "the arm leaves the torso at the armpit and rejoins at the hand on the bag; in side view the bag hangs off the strap with a column of air between it and the body",
  shape_family: "organic_tapered",
  tier: "hero",
};

const PALETTE = {
  ramps: {
    coat:  { role: "material", colors: ["#2b2436", "#3d3450", "#544a68", "#736a8a"] },
    bag:   { role: "material", colors: ["#3a2417", "#59381f", "#7c522c", "#a4713c"] },
    boot:  { role: "material", colors: ["#1e1a18", "#372f2a", "#564940"] },
    skin:  { role: "material", colors: ["#7a4f33", "#a5714a", "#d09b6c"] },
    hat:   { role: "material", colors: ["#241f2b", "#3a3247", "#5a4f68"] },
  },
  single: {
    buckle: { rgb: "#e8b64a", role: "accent" },
    eye:    { rgb: "#141118", role: "outline" },
    glint:  { rgb: "#f6e2b0", role: "light" },
    contact: { rgb: "#17151f", role: "shadow" },
  },
};

say("PHASE 3 GATE, STAGE 1 — silhouette, unshaded, for your review\n");
say(`  ${DESIGN.name} — ${DESIGN.role}`);
say(`  personality: ${DESIGN.personality}`);
say(`  primary read: ${DESIGN.primary_read}`);
say(`  exaggerated: ${DESIGN.exaggerated}`);
say(`  simplified: ${DESIGN.simplified}`);
say(`  focal accent: ${DESIGN.focal_accent}\n`);

call("project_init", { root: ROOT, game: "gate3", style: STYLE, canvas: { w: 16, h: 32 }, fps: 12 });
call("style_create", { id: STYLE.id, bible: { ...STYLE, design: DESIGN } });
call("palette_set", { id: "courier", spec: PALETTE });
call("sprite_create", {
  id: "pim", w: 16, h: 32, palette: "courier", style: STYLE.id,
  tier: "hero", asset_class: "character", design: DESIGN,
  directions: ["down", "down-right", "right", "up", "left"],
});

// ---------------------------------------------------------------------------
// The silhouettes. One colour. No shading, no outline, no face.
// If the shape cannot carry the character here, nothing added later will save it.
// ---------------------------------------------------------------------------
const SILHOUETTE = {
  // Front. Shoulders wider than the head, arms separated from the torso by a column of air each
  // side, closed at the armpit and at the hand on the bag. The satchel hangs low on the right and
  // is wider than the waist. The boots are wider than the legs they come out of.
  down: [
    "................",
    "................",
    ".....####.......",
    "....######......",
    "....######......",
    "....######......",
    "....######......",
    ".....####.......",
    "......##........",
    "..###########...",
    "..###########...",
    "..##.#####.##...",
    "..##.#####.##...",
    "..##.#####.##...",
    "..##.#####.####.",
    "..##.#####.####.",
    "..##.#####.####.",
    "..##.#####.####.",
    "..###########...",
    "...#########....",
    "....#######.....",
    "....#######.....",
    "....#######.....",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    "....###.###.....",
    "..#######.######",
    "..#######.######",
    "..#####...#####.",
    "................",
  ],
  // Right-facing. The bag hangs from the shoulder in FRONT of the body, so a column of air reads
  // between torso and bag — closed above by the strap and below by the bag's own base. This is the
  // view that tells you he is carrying something.
  right: [
    "................",
    "................",
    "......####......",
    ".....######.....",
    ".....######.....",
    ".....######.....",
    ".....#####......",
    "......####......",
    "......##........",
    ".....#####......",
    "....#######.....",
    "....########....",
    "....#########...",
    "....######.####.",
    "....######.####.",
    "....######.####.",
    "....######.####.",
    "....######.####.",
    "....###########.",
    ".....#####......",
    ".....#####......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    "....####.####...",
    "....#########...",
    "....#####.####..",
    "................",
    "................",
    "................",
  ],
  // Back, variant A. The bag hangs below the coat hem.
  up: [
    "................",
    "................",
    ".....####.......",
    "....######......",
    "....######......",
    "....######......",
    "....######......",
    ".....####.......",
    "......##........",
    "....######......",
    "..############..",
    "..##.######.##..",
    "..##.######.##..",
    "..##.######.##..",
    "..##.######.##..",
    "..##.######.##..",
    "..##.######.##..",
    "..############..",
    "....########....",
    "....########....",
    "....########....",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    "....###.###.....",
    "..#######.#####.",
    "..#####...#####.",
    "................",
    "................",
    "................",
  ],
  // Back, variant B. The bag is ON the back: one mass wider than the head and wider than the legs,
  // spanning shoulder to hem. The arms sit outside it, separated by a column of air each side,
  // closed at the shoulder line and at the bag's lower hem. This is the version that answers
  // "what is he carrying?" from behind.
  up_b: [
    "................",
    "................",
    ".....####.......",
    "....######......",
    "....######......",
    "....######......",
    "....######......",
    ".....####.......",
    "......##........",
    "....######......",
    ".##############.",
    ".##.########.##.",
    ".##.########.##.",
    ".##.########.##.",
    ".##.########.##.",
    ".##.########.##.",
    ".##.########.##.",
    ".##.########.##.",
    ".##############.",
    "..##########....",
    "...########.....",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    ".....##.##......",
    "....###.###.....",
    "..#######.#####.",
    "..#####...#####.",
    "................",
    "................",
    "................",
    "................",
  ],
};

const authored = {};
say(`  AUTHORED SILHOUETTES  (one colour each; 'left' is the engine's mirror of 'right', not a fourth drawing)`);
for (const [dir, rows] of Object.entries(SILHOUETTE)) {
  const id = `pim.sil.${dir}`;
  call("cel_new", { cel: id, w: 16, h: 32, palette: "courier" });
  const map = rows.map(r => [...r].map(c => c === "#" ? charFor(W.palette("courier").index("coat.1")) : ".").join(""));
  call("draw_pixel_map", { cel: id, palette: "courier", map });
  call("save_cel", { sprite: "pim", cel: id, cel_key: `sil.${dir}` });
  const cel = W.store.get(id);
  authored[dir] = cel;
  const bb = cel.bbox(), ns = negativeSpace(cel), fc = featureCount(cel);
  const cs = craftScore(cel, W.palette("courier"), { assetClass: "character" });
  const st = assertStyle(cel, STYLE, W.palette("courier"), { assetClass: "character" });
  say(`    ${dir.padEnd(6)} ${String(bb.area).padStart(3)}px in ${bb.w}x${bb.h} (fill ${(bb.area / (bb.w * bb.h)).toFixed(2)})  features ${fc.features}  orphans ${fc.orphans}  enclosed air ${ns.enclosed} (${(ns.enclosedRatio * 100).toFixed(1)}%)  open air ${(ns.openRatio * 100).toFixed(1)}%`);
  say(`           blob ${cs.sub.blob}  shape ${cs.sub.shape}  space ${cs.sub.space}  assert_style ${st.ok ? "conforms" : "VIOLATIONS: " + st.violations.map(v => v.rule).join(", ")}`);
}

// left is derived, not drawn a fourth time
const mir = call("mirror", { cel: "pim.sil.right", axis: "x", into: "pim.sil.left" });
say(`    left   derived from right by the engine's mirror; asymmetry report: ${JSON.stringify(mir.asymmetry)}`);

// ---------------------------------------------------------------------------
// The review surface: one image, all facings, shared baseline, unshaded.
// ---------------------------------------------------------------------------
const sheet = call("contact_sheet", {
  cels: ["pim.sil.down", "pim.sil.right", "pim.sil.left", "pim.sil.up", "pim.sil.up_b"],
  name: "pim-silhouette", mode: "silhouette", zoom: 8,
  stamp: "PIM — silhouette only, no shading — 4 facings + a back variant, one baseline",
});
// The pack asks the one question the measurement cannot answer, with two concrete things to react to.
const pack = call("review_pack", {
  subject: "pim", stage: "silhouette", style: STYLE.id, palette: "courier",
  options: [
    { label: "back A — bag hangs below the hem", cel: "pim.sil.up" },
    { label: "back B — bag is on the back", cel: "pim.sil.up_b" },
  ],
});
for (const d of ["down", "right", "up", "up_b"]) {
  const s = call("silhouette", { cel: `pim.sil.${d}`, style: STYLE.id });
  say(`    silhouette ${d}: complexity ${s.silhouette_complexity} compactness ${s.compactness} blob ${s.blob_score} — ${s.verdict}`);
}

say(`\n  REVIEW PACK`);
say(`    contact sheet : ${sheet.image}`);
say(`    review pack   : ${pack.image}`);
say(`    grids are coordinate-addressed; every pixel is addressable by x,y in stage 2.`);

say(`\n  WHAT STAGE 1 IS ASKING YOU`);
say(`    1. Does he read as a person carrying something, at silhouette only, in every facing?`);
say(`    2. Back A or back B? The engine measures both; only you can say which one answers`);
say(`       "what is he carrying?" from behind.`);
say(`    3. Does the side view read as 'late' rather than 'bulky'?`);
say(`    4. Is the satchel too big, or big enough?`);
say(`\n  WHAT THE MEASUREMENT ALREADY TOLD ME, BEFORE ASKING YOU ANYTHING:`);
say(`    - Front view: the satchel and the right arm are one mass (cols 11-14, rows 13-17).`);
say(`      At the front he has no visible right arm. That is a design defect I authored, not a metric artifact.`);
say(`    - Back A: the bag sits below the hem, so from behind he reads as wearing a coat, not carrying a bag.`);
say(`    - Both front and back sit at compactness ~10.6 against the side view's 9.3. The cause is the`);
say(`      one-pixel columns of air that separate arm from torso: they are what make an arm read as an`);
say(`      arm at 16px wide, and they are also what makes the silhouette fragile at 1x. Widening them`);
say(`      costs body width this character does not have. Your call, not mine.`);
say(`\n  Until those are answered, no colour, no shading and no walk frames get authored:`);
say(`  shading is how a wrong silhouette hides.`);
say(`\n  STAGE 1: AUTHORED AND MEASURED. STAGE 2 (4-frame walk, timing, playback, loop_validate) is BLOCKED ON YOUR REVIEW.`);

fs.writeFileSync(path.join(__dirname, "..", "out", "gate3-stage1.txt"), out.join("\n"));
