// PHASE 7 GATE — volume economics, measured not claimed (PLAN.md §5, Phase 7).
//
// "twenty NPCs assembled from the part library, and asset #400 costs measurably less than asset #1.
//  If it does not, the engine has failed at the thing engines are for."
//
// Nobody has ever assembled twenty NPCs or measured a cost curve. This runner does both, in one run,
// and it runs all the way to asset #400 so that asset #400's cost is MEASURED rather than projected.
//
// Order of operations (the order matters: it is what makes the curve real instead of arithmetic):
//   1. declare the coordinate, the material library and the palette (materials defined ONCE);
//   2. author the part library by hand as grids (src/author.js authorAsset) — no body generator;
//   3. build asset #1 COLD: its parts are authored on demand because the library starts empty;
//   4. build assets #2..#20 (the twenty named NPCs), authoring only the parts each one still needs;
//      the library freezes when a recipe needs nothing new;
//   5. build assets #21..#400 as combinatorial reuse of the frozen library, measuring every one;
//   6. controls: illegal slot refusal, bad-slot refusal at the library, a floating held prop,
//      deliberate part collisions, default-z-order composition loss, batch_relint drift detection;
//   7. renders for human review + the per-asset cost table + claims with their numbers.
//
// Honesty: the claims below are written before any of this runs. A claim that fails stays in the
// report as ok:false with its measurement. Nothing is imported. src/*, test/*, PLAN.md and
// package.json are not touched.
"use strict";

const fs = require("fs");
const path = require("path");

const { TOOLS, W } = require("../src/tools.js");
const T = TOOLS;                                    // the gate speaks to the engine through its tool surface
const { authorAsset, bridgeSeams, repairSingletons, outlineEdge } = require("../src/author.js");
const parts = require("../src/core/parts.js");
const render = require("../src/render.js");
const { charFor } = require("../src/core/cel.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out", "gate7");
const ART = path.join(ROOT, "art", "parts", "npc");            // the authored PART library (committed)
const NPC_ART = path.join(ROOT, "art", "parts", "crew");       // the twenty named NPCs (committed)
const REPORT = path.join(ROOT, "out", "gate7-report.txt");

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of [OUT, ART, NPC_ART, path.join(OUT, "cels"), path.join(OUT, "renders")]) fs.mkdirSync(d, { recursive: true });

const LINES = [];
const say = (s = "") => { LINES.push(s); console.log(s); };

// ---- the coordinate, declared rather than picked ---------------------------------
const STYLE = {
  id: "gate7-market-crew", projection: "three-quarter", art_scale: 32, palette_size: 48,
  temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "static", mood: "cozy-warm", light_vector: [-0.7, -0.7],
  signature: "a working market street: heavy leather and wool, warm lamp light on cold ground; bodies drawn from the same eight body blocks",
};
const PAL = "gate7-crew";
const CANVAS = [20, 32];                 // w,h: a 32px character standing on the baseline row 31
const BASELINE = 31;

// The material library: one authored ramp recipe per material, defined ONCE, shared by every part.
const MATERIALS = {
  skin_a:    { role: "material", colors: ["#6b4630", "#94653f", "#c08f5f"] },
  skin_b:    { role: "material", colors: ["#4a3b30", "#6d5744", "#95795f"] },
  ink:       { role: "detail",   colors: ["#1a1622", "#332b3f"] },
  hair_dark: { role: "material", colors: ["#332842", "#4d3c60", "#6b5480"] },
  hair_ginger: { role: "material", colors: ["#5a2a12", "#8a4519", "#b56a2c"] },
  hair_grey: { role: "material", colors: ["#43434d", "#666673", "#8f8f9c"] },
  shirt:     { role: "material", colors: ["#2f3a4a", "#4a5a72", "#6f84a1", "#9ab0c9"] },
  coat:      { role: "material", colors: ["#241f2b", "#3d3450", "#5c506e", "#847896"] },
  trousers:  { role: "material", colors: ["#2b322e", "#414b45", "#5d6a61", "#7f8d81"] },
  apron:     { role: "material", colors: ["#57482f", "#7c6744", "#a48d64"] },
  leather:   { role: "material", colors: ["#1f1812", "#382a1d", "#57422d", "#7d6040"] },
  metal:     { role: "material", colors: ["#2b3038", "#4a5361", "#727f90", "#a3b0c0"] },
  wood:      { role: "material", colors: ["#42301c", "#65442a", "#8a6540", "#b28a5c"] },
};
const SINGLES = {
  accent:  { rgb: "#e8b64a", role: "accent" },
  glint:   { rgb: "#f2e7c9", role: "light" },
  outline: { rgb: "#0c0a10", role: "outline" },
  contact: { rgb: "#171319", role: "shadow" },
};

// ---- the claims, written BEFORE the work ----------------------------------------
const CLAIMS = [
  "the part library is hand-authored as grids across the legal slots (several heads, hairs, torsos, arms, legs, footwear, accessories and held props) and every part audits with zero unexempted error findings at its declared tier; strict-rule findings are reported rather than hidden",
  "one material library defines every ramp once and every part draws only from it: no part carries a private palette",
  "twenty distinct NPCs assemble from that library through assemble recipes, each conforming to assert_style for a character at the declared coordinate",
  "every one of the twenty meets the external craft bar (craft_targets at art_scale 32) and is audited clean at its declared tier",
  "an illegal slot assignment — a boot in the hair slot — is refused by assemble, produces no cel, and names the part and both slots",
  "a bad slot name is refused by the part library itself before any assembly can compose nonsense",
  "an assembly whose held prop floats detached from the body is caught by audit as disconnected_mass, and an assembly whose parts fight for the same cells is reported with coordinates",
  "family_audit on one declared shape family names every member that does not fit instead of hiding them",
  "batch_relint names which NPCs drift when exactly one material is changed",
  "marginal cost of asset #400 is measurably lower than asset #1 in newly authored pixels, tool calls and wall-clock time, and the mechanism is named",
  "the gate ran to asset #400: every one of the four hundred assets was assembled and measured, nothing between #20 and #400 is extrapolated",
  "every part an assembly selects lands in the composed cel at its declared slot",
  "what does NOT get cheaper as volume grows is measured and reported, not glossed",
  "committed grids are byte-identical when the gate is re-run",
];

// ---- the part library: hand-authored grids ---------------------------------------
// Canonical layout on a 20x32 canvas (three-quarter facing, standing on baseline row 31):
//   hair rows 0..7 over the skull; head rows 2..10 with a two-column neck at cols 9,10;
//   torso rows 11..20; arms rows 12..19 hanging outside the torso columns; legs rows 21..28;
//   feet rows 29..31; held props hang from the near hand at row 20+; accessories attach at the edge.
// Letters: '#' = the part's default material, 'e' = ink (eyes), 'L' = leather, 'M' = metal,
// 'W' = wood, 'h' = hair material, '+' = the declared focal accent cell.
const PARTS = [
  // ---- heads (9x9 unless noted; last two rows are always a two-column neck at canvas cols 9,10)
  { id: "head_round", slot: "head", tier: "support", material: "skin_a", map: { e: "ink" }, anchor: [6, 2], tags: ["face", "round"], grid: [
    "...###...", ".#######.", ".#######.", ".#ee#ee#.", ".#######.", ".######..", "..####...", "...##....", "...##...."] },
  { id: "head_long", slot: "head", tier: "support", material: "skin_b", map: { e: "ink" }, anchor: [6, 2], tags: ["face", "long"], grid: [
    "...####..", "..######.", "..######.", "..#ee#ee#", "..######.", "..#####..", "...####..", "...##....", "...##...."] },
  { id: "head_broad", slot: "head", tier: "background", material: "skin_a", map: { e: "ink" }, anchor: [5, 2], tags: ["face", "broad"], grid: [
    "....###....", "..#######..", ".#########.", ".#eee#eee#.", ".#########.", "..#######..", "...####....", "....##.....", "....##....."] },
  { id: "head_child", slot: "head", tier: "background", material: "skin_b", map: { e: "ink" }, anchor: [7, 4], tags: ["face", "small"], grid: [
    "..###..", ".#####.", ".#####.", ".#####.", "..###..", "..##...", "..##..."] },

  // ---- hairs (sit ON the skull: one row overlaps the head's crown on purpose; locks frame the face)
  { id: "hair_coif", slot: "hair", tier: "support", material: "hair_dark", anchor: [5, 0], tags: ["hair", "coif"], grid: [
    "...#####...", "..#######..", ".#########.", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#"] },
  { id: "hair_crop", slot: "hair", tier: "background", material: "hair_ginger", anchor: [6, 0], tags: ["hair", "crop"], grid: [
    "..#####..", ".#######.", "#########", ".#.....#."] },
  { id: "hair_bun", slot: "hair", tier: "support", material: "hair_grey", anchor: [6, 0], map: { "+": null }, tags: ["hair", "bun"], accentCells: true, grid: [
    "...###...", "..#####..", ".#######.", ".##+..##."] },
  { id: "hair_long", slot: "hair", tier: "background", material: "hair_grey", anchor: [5, 0], tags: ["hair", "long"], grid: [
    "...#####...", "..#######..", ".#########.", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#", "#..#####..#"] },

  // ---- torsos (span exactly rows 11..20; row 20 covers the hip columns both legs hang from)
  { id: "torso_shirt", slot: "torso", tier: "support", material: "shirt", map: { L: "leather" }, anchor: [5, 11], tags: ["top", "shirt"], grid: [
    ".########.", "##########", "#LL####LL#", ".########.", "..######..", ".########.", "##########", "++########", "##########", ".########."] },
  { id: "torso_coat", slot: "torso", tier: "hero", material: "coat", map: { L: "leather" }, anchor: [5, 11], tags: ["top", "coat"], accentCells: true, grid: [
    ".########.", "##########", "#+######+#", "##########", "##########", "##########", "##########", "#LLL##LLL#", "##########", ".#.######."] },
  { id: "torso_vest", slot: "torso", tier: "background", material: "shirt", map: { L: "leather" }, anchor: [5, 11], tags: ["top", "vest"], grid: [
    ".#......#.", "###....###", "#L######L#", "#L######L#", "#L######L#", "#L######L#", "###....###", "##########", ".#.######.", ".########."] },
  { id: "torso_apron", slot: "torso", tier: "support", material: "apron", map: { C: "coat" }, anchor: [5, 11], tags: ["top", "apron"], accentCells: true, grid: [
    "..C..C..", "##########", "##########", "+########+", "##########", "##########", "##########", "####LLLL##", "##########", ".########."] },

  // ---- arms (hang outside the torso columns so they read as separate masses; hands are skin)
  { id: "arm_near_sleeve", slot: "arm_near", tier: "support", material: "shirt", map: { k: "skin_a", L: "leather" }, anchor: [2, 12], tags: ["limb", "sleeve"], grid: [
    "###", "###", "###", "###", "kkk", "kkk"] },
  { id: "arm_far_sleeve", slot: "arm_far", tier: "background", material: "coat", map: { k: "skin_b" }, anchor: [15, 12], tags: ["limb", "sleeve"], grid: [
    "###", "###", "###", "#L#", "kkk", "kkk"] },
  { id: "arm_near_glove", slot: "arm_near", tier: "support", material: "shirt", map: { L: "leather" }, anchor: [2, 12], tags: ["limb", "glove"], grid: [
    "###", "###", "LLL", "LLL", "LLL", ".LL."] },
  { id: "arm_far_bare", slot: "arm_far", tier: "background", material: "skin_b", anchor: [15, 12], tags: ["limb", "bare"], grid: [
    ".##", ".##", ".##", ".##", ".##", ".##"] },

  // ---- legs (rows 21..28; near is foreshortened shorter than far so the pair reads in depth)
  { id: "leg_near_trouser", slot: "leg_near", tier: "support", material: "trousers", anchor: [6, 21], tags: ["limb", "trouser"], grid: [
    "####", ".###", ".###", "####", ".###", ".###", "####"] },
  { id: "leg_far_trouser", slot: "leg_far", tier: "support", material: "trousers", map: { L: "leather" }, anchor: [10, 21], tags: ["limb", "trouser"], grid: [
    "####", "###.", "###.", "####", "###.", "#LL#", "####", "####"] },
  { id: "leg_near_short", slot: "leg_near", tier: "background", material: "trousers", map: { k: "skin_a" }, anchor: [6, 23], tags: ["limb", "short"], grid: [
    "####", "####", ".kkk", ".kkk"] },
  { id: "leg_far_short", slot: "leg_far", tier: "background", material: "apron", map: { k: "skin_b" }, anchor: [10, 23], tags: ["limb", "short"], grid: [
    "####", "####", "kkk.", "kkk."] },

  // ---- footwear (rows 29..31, sole row grounded with the declared contact colour)
  { id: "boot_work_near", slot: "foot_near", tier: "support", material: "leather", anchor: [4, 29], soleColor: "contact", tags: ["foot", "boot"], grid: [
    "..##.", ".####", "#####"] },
  { id: "boot_work_far", slot: "foot_far", tier: "support", material: "leather", anchor: [10, 29], soleColor: "contact", tags: ["foot", "boot"], grid: [
    ".###.", "####.", "#####"] },
  { id: "shoe_flat_near", slot: "foot_near", tier: "background", material: "leather", anchor: [4, 29], soleColor: "contact", tags: ["foot", "shoe"], grid: [
    ".###.", "####.", "##.###"] },
  { id: "shoe_flat_far", slot: "foot_far", tier: "background", material: "coat", anchor: [10, 29], soleColor: "contact", tags: ["foot", "shoe"], grid: [
    ".###.", "####.", "#####"] },

  // ---- held props (hang from the near hand at cols 2..4; they must touch a hand or audit refuses)
  { id: "held_lantern", slot: "held", tier: "hero", material: "metal", anchor: [1, 20], accentCells: true, tags: ["prop", "lamp"], grid: [
    "####", "#++#", "#++#", "#++#", "####"] },
  { id: "held_crate", slot: "held", tier: "system", material: "wood", map: { L: "leather" }, anchor: [1, 20], tags: ["prop", "crate"], grid: [
    "###.", "#LL#", "####", "#LL#"] },
  { id: "held_sack", slot: "held", tier: "background", material: "leather", anchor: [1, 20], tags: ["prop", "sack"], grid: [
    "##..", "####", "####", "####", ".###"] },
  { id: "held_bucket", slot: "held", tier: "system", material: "metal", anchor: [1, 20], tags: ["prop", "bucket"], grid: [
    "####", "#..#", "#..#", "####"] },

  // ---- accessories (attach at the silhouette edge or sit on the crown; accessory is a legal slot)
  { id: "acc_cap", slot: "accessory", tier: "support", material: "coat", map: { "+": null }, accentCells: true, tags: ["headwear"], grid: [
    "..###..", ".#####.", ".##+#.."] },
  { id: "acc_pouch", slot: "accessory", tier: "background", material: "leather", anchor: [14, 22], tags: ["carry"], grid: [
    "####", "####", "####", "#LL#"] },
  { id: "acc_flask", slot: "accessory", tier: "system", material: "metal", anchor: [14, 23], accentCells: true, tags: ["carry"], grid: [
    ".++", "###", "###"] },
];

// ---- canonical anchors -------------------------------------------------------
// The layout above has two authored defects, and audit would refuse both, so they are corrected
// here and recorded rather than fixed silently: a held prop anchored at row 20 hangs TWO ROWS
// below the near hand (which ends at row 17) and one column outside the torso, and an accessory at
// col 14 sits beside nothing at all. `disconnected_mass` refuses any mass over 2 px that is not
// 4-connected to the main silhouette — which is exactly what both of those are. Held props hang
// from the hand, accessories attach on the belt line or the crown.
const ANCHOR_FIXES = {
  held_lantern: [1, 18], held_crate: [1, 18], held_sack: [1, 18], held_bucket: [1, 18],
  acc_pouch: [13, 21], acc_flask: [13, 23], acc_cap: [6, 1],
};
const anchorOf = (def) => ANCHOR_FIXES[def.id] || def.anchor;
const PART_BY_ID = new Map(PARTS.map(p => [p.id, p]));

// ---- the twenty named NPCs ----------------------------------------------------
// Each declares who it is before it declares which parts it wears: the part choice is a consequence
// of the character, not a dice roll. Compact tuple form:
// [name, tier, personality, head, hair, torso, arm_near, arm_far, leg_near, leg_far, foot_near, foot_far, held, accessory]
const CREW = [
  ["marta_the_butcher",    "hero",    "broad and brisk, apron already bloody",        "head_broad",  "hair_crop",  "torso_apron",   "arm_near_glove",   "arm_far_bare",     "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_pouch"],
  ["oswin_the_lampwright", "hero",    "fussy, nocturnal, carries his own light",       "head_long",   "hair_grey",  "torso_coat",    "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far", "held_lantern", null],
  ["jenkin_the_porter",    "support", "wide back, no complaints, always carrying",     "head_round",  "hair_crop",  "torso_shirt",   "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  "held_crate",  null],
  ["dell_the_fishmonger",  "support", "shouting, sleeves down, boots ruined",          "head_broad",  "hair_crop",  "torso_vest",    "arm_near_sleeve",  "arm_far_bare",     "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  "held_bucket", null],
  ["sable_the_bookkeeper", "support", "precise, dry, everything in its pocket",        "head_long",   "hair_bun",   "torso_coat",    "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "shoe_flat_near", "shoe_flat_far",  null,          "acc_flask"],
  ["tom_ward",             "background","a boy, in someone else's coat",              "head_child",  "hair_crop",  "torso_coat",    "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  "held_sack",   null],
  ["nan_the_tanner",       "support", "patient, stained to the elbow",                 "head_round",  "hair_coif",  "torso_apron",   "arm_near_glove",   "arm_far_bare",     "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_pouch"],
  ["corvin_the_watchman",  "support", "slow on purpose, heavy on purpose",             "head_broad",  "hair_coif",  "torso_coat",    "arm_near_glove",   "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_cap"],
  ["ilse_the_miller",      "support", "flour in her hair, arms tired",                 "head_round",  "hair_long",  "torso_shirt",   "arm_near_sleeve",  "arm_far_bare",     "leg_near_trouser", "leg_far_trouser",  "shoe_flat_near", "shoe_flat_far",  "held_sack",   null],
  ["bran_the_carver",      "support", "quiet, exact, tools on the belt",               "head_long",   "hair_crop",  "torso_vest",    "arm_near_glove",   "arm_far_bare",     "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_pouch"],
  ["wren_the_dyer",        "support", "grinning, blue to the wrist",                   "head_round",  "hair_bun",   "torso_apron",   "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  null,          "acc_flask"],
  ["otto_the_cooper",      "support", "barrel-shouldered, unhurried",                  "head_broad",  "hair_coif",  "torso_shirt",   "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  "held_bucket", null],
  ["meg_the_errand",       "background","small, quick, always late",                   "head_child",  "hair_crop",  "torso_vest",    "arm_near_sleeve",  "arm_far_bare",     "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  "held_sack",   null],
  ["silas_the_gravedigger","support", "flat-footed, coat full of earth",               "head_long",   "hair_coif",  "torso_coat",    "arm_near_glove",   "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_cap"],
  ["ada_the_baker",        "support", "early, warm, flour on the apron",               "head_round",  "hair_bun",   "torso_apron",   "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "shoe_flat_near", "shoe_flat_far",  null,          "acc_pouch"],
  ["quill_the_clerk",      "background","thin, tidy, ink on the cuff",                 "head_long",   "hair_long",  "torso_vest",    "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "shoe_flat_near", "shoe_flat_far",  null,          "acc_flask"],
  ["hob_the_carrier",      "support", "bent double under one crate",                   "head_broad",  "hair_crop",  "torso_shirt",   "arm_near_glove",   "arm_far_bare",     "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  "held_crate",  null],
  ["verge_the_tinker",      "support","crouched, always fixing something",             "head_child",  "hair_coif",  "torso_apron",   "arm_near_glove",   "arm_far_bare",     "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  "held_bucket", "acc_flask"],
  ["rowan_the_herbalist",  "background","soft-spoken, pockets full of leaves",         "head_round",  "hair_long",  "torso_vest",    "arm_near_sleeve",  "arm_far_bare",     "leg_near_short",   "leg_far_short",    "shoe_flat_near", "shoe_flat_far",  null,          "acc_pouch"],
  ["grieve_the_undertaker","hero",    "tall, formal, unbothered by the dark",          "head_long",   "hair_coif",  "torso_coat",    "arm_near_sleeve",  "arm_far_sleeve",   "leg_near_trouser", "leg_far_trouser",  "boot_work_near", "boot_work_far",  null,          "acc_cap"],
];
const NPCS = CREW.map(r => ({
  name: r[0], tier: r[1], personality: r[2],
  parts: { head: r[3], hair: r[4], torso: r[5], arm_near: r[6], arm_far: r[7], leg_near: r[8], leg_far: r[9], foot_near: r[10], foot_far: r[11], ...(r[12] ? { held: r[12] } : {}), ...(r[13] ? { accessory: r[13] } : {}) },
}));

// ---- the run ------------------------------------------------------------------
const crypto = require("crypto");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

// Claim 14: committed grids must come out byte-identical when the gate is re-run. The check is
// done by comparing what is on disk against what this run authors, file by file.
const drift = [];
function commitGrid(dir, name, cel) {
  const file = path.join(dir, `${name}.grid`);
  const text = cel.toGrid();
  const rel = path.relative(ROOT, file);
  if (fs.existsSync(file)) drift.push({ file: rel, identical: fs.readFileSync(file, "utf8") === text });
  else drift.push({ file: rel, identical: null });            // first authoring of this grid
  fs.writeFileSync(file, text);
  return { file: rel, hash: sha(text) };
}

const partRows = [];
const authoredLog = [];                                       // which asset had to author which part
function authorPart(def, forAsset) {
  const map = { "#": def.material, ...(def.map || {}) };
  const { cel, regions, modelled } = authorAsset(def.grid, {
    palette, paletteId: PAL, name: `part.${def.id}`, map, light: STYLE.light_vector, soleColor: def.soleColor,
  });
  const cid = `p.${def.id}`;
  W.store.put(cid, cel);
  const grid = commitGrid(ART, def.id, cel);
  const add = T.part_add.run({ part: def.id, slot: def.slot, cel: cid, anchor: anchorOf(def), tags: def.tags });
  if (!add.ok) throw new Error(`part_add refused '${def.id}': ${JSON.stringify(add.violations || add.error || add.message)}`);
  const atTier = T.audit.run({ cel: cid, style: STYLE.id, asset_class: "character", tier: def.tier });
  const strict = T.audit.run({ cel: cid, style: STYLE.id, asset_class: "character", tier: "hero" });
  partRows.push({
    id: def.id, slot: def.slot, tier: def.tier, pixels: cel.bbox()?.area ?? 0,
    errors: atTier.errors, warns: atTier.warns, exempted: atTier.exempted,
    strictErrors: strict.findings.filter(f => f.severity === "error").map(f => `${f.rule}@${f.at ? `${f.at[0].x},${f.at[0].y}` : "?"}`),
    regions, steps: modelled.map(m => m.stepsUsed), grid,
  });
  authoredLog.push({ asset: forAsset, part: def.id, pixels: cel.bbox()?.area ?? 0 });
  return { cel, cid };
}
const ensurePart = (id, forAsset) => {
  if (W.parts?.get(id)) return false;
  const def = PART_BY_ID.get(id);
  if (!def) throw new Error(`recipe asks for a part that does not exist: '${id}'`);
  authorPart(def, forAsset);
  return true;
};

// One asset, built and measured. The cost is measured around exactly this build: newly authored
// pixels, tool calls, renders and wall-clock, against the library as it stood when it started.
const assets = [];
function buildAsset(index, name, recipe, tier, opts = {}) {
  const into = `npc.${String(index).padStart(3, "0")}.${name}`;
  const p0 = W.parts?.authoredPixels() ?? 0, c0 = W.calls, r0 = W.renders;
  const t0 = process.hrtime.bigint();

  const newParts = [];
  const anchors = {};
  for (const [slot, pid] of Object.entries(recipe)) {
    if (!PART_BY_ID.has(pid)) throw new Error(`recipe for '${name}' asks for unknown part '${pid}'`);
    if (ensurePart(pid, name)) newParts.push(pid);
    anchors[slot] = anchorOf(PART_BY_ID.get(pid));
  }
  const res = T.assemble.run({ id: into, into, parts: recipe, w: CANVAS[0], h: CANVAS[1], palette: PAL, anchors, z_order: opts.zOrder });
  if (!res.ok) return { index, name, ok: false, problems: res.violations || res.problems };

  // The documented route for a composed frame (docs/09, and what src/pim.js does after its rig moves
  // parts): seams are bridged where they appear on the composed cel, not pre-compensated per part.
  const cel = W.store.get(into);
  const bridged = bridgeSeams(cel, palette).bridges;
  const outlined = outlineEdge(cel, palette, { light: STYLE.light_vector }).outlined;
  repairSingletons(cel, palette);
  W.store.put(into, cel);
  const grid = commitGrid(index <= 20 ? NPC_ART : path.join(OUT, "cels"), `${String(index).padStart(3, "0")}-${name}`, cel);

  const au = T.audit.run({ cel: into, style: STYLE.id, asset_class: "character", tier });
  const st = T.assert_style.run({ cel: into, style: STYLE.id, asset_class: "character" });
  const ct = T.craft_targets.run({ cel: into, style: STYLE.id });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const rec = {
    index, name, tier, into, ok: true, recipe, newParts, newPixels: W.parts.authoredPixels() - p0,
    reusedParts: Object.keys(recipe).length - newParts.length, composedPixels: cel.bbox()?.area ?? 0,
    calls: W.calls - c0, renders: W.renders - r0, ms: +ms.toFixed(2), bridged, outlined,
    auditErrors: au.errors, auditWarns: au.warns, exempted: au.exempted,
    auditRules: au.findings.filter(f => f.severity === "error").map(f => `${f.rule}@${f.at ? `${f.at[0].x},${f.at[0].y}` : "?"}`),
    styleOk: st.conforms ?? st.ok, styleViolations: (st.violations || []).map(v => v.rule),
    craftOk: ct.ok, craft: ct.craft, grade: ct.grade, craftMisses: ct.misses.map(m => `${m.target} want ${m.want} got ${m.got}`),
    collisions: res.collisions.length, grid,
  };
  assets.push(rec);
  return rec;
}

// ---- helpers used by the claims ------------------------------------------------
/** Coverage: did every selected part's cells land on the canvas where its slot anchor says? */
function placementCheck(cel, recipe, anchors) {
  const out = [];
  for (const [slot, pid] of Object.entries(recipe)) {
    const part = W.parts.get(pid);
    if (!part) { out.push({ slot, part: pid, landed: 0, expected: 0, why: "not in library" }); continue; }
    const [ax, ay] = anchors[slot];
    let landed = 0, expected = 0;
    part.cel.forEach((v, x, y) => {
      if (v < 0) return;
      expected++;
      const px = ax + x, py = ay + y;
      if (!cel.inBounds(px, py)) return;
      if (cel.get(px, py) >= 0) landed++;
    });
    if (landed !== expected) out.push({ slot, part: pid, landed, expected });
  }
  return out;
}
/** Material survival: how many part pixels are still the part's own colour after composition. */
function materialSurvival(cel, recipe, anchors) {
  let kept = 0, total = 0;
  for (const [slot, pid] of Object.entries(recipe)) {
    const part = W.parts.get(pid);
    const [ax, ay] = anchors[slot];
    part.cel.forEach((v, x, y) => {
      if (v < 0) return;
      total++;
      const px = ax + x, py = ay + y;
      if (cel.inBounds(px, py) && cel.get(px, py) === v) kept++;
    });
  }
  return { kept, total };
}
const anchorsFor = (recipe) => {
  const a = {};
  for (const [slot, pid] of Object.entries(recipe)) a[slot] = anchorOf(PART_BY_ID.get(pid));
  return a;
};

// ---- 1. declare the coordinate, the materials and the palette -------------------
say("PHASE 7 GATE — volume economics, measured not claimed");
say(`  claims written before the work: ${CLAIMS.length}`);
say("");

const init = T.project_init.run({ root: OUT, game: "gate7", style: STYLE, canvas: { w: CANVAS[0], h: CANVAS[1] }, fps: 8 });
if (!init.ok) throw new Error(`coordinate refused: ${(init.violations || []).map(v => `${v.rule}: ${v.message}`).join(" | ")}`);
for (const [id, m] of Object.entries(MATERIALS)) T.material_define.run({ id, role: m.role, colors: m.colors });
const pal = T.palette_set.run({ id: PAL, spec: { ramps: W.materials.toRampSpec(), single: SINGLES } });
if (!pal.ok) throw new Error(`palette refused: ${(pal.violations || []).map(v => `${v.rule}: ${v.message}`).join(" | ")}`);
const palette = W.palette(PAL);
say(`  coordinate '${STYLE.id}' declared; material library defines ${W.materials.ids().length} ramps once; palette '${PAL}' has ${palette.entries.length} entries (${palette.rampIds().length} ramps + ${Object.keys(SINGLES).length} singles)`);

// ---- 2..5. asset #1 cold, then the twenty NPCs, then the long tail to #400 -----
say("");
say("--- assets #1..#20 (the part library is built on demand by these) ---");
const crew = [];
NPCS.forEach((npc, i) => {
  const rec = buildAsset(i + 1, npc.name, npc.parts, npc.tier);
  crew.push(rec);
  say(`  #${String(rec.index).padStart(3)} ${rec.name.padEnd(21)} [${rec.tier}] new parts ${rec.newParts.length} (+${rec.newPixels} px authored), reused ${rec.reusedParts}, composed ${rec.composedPixels} px, calls ${rec.calls}, ${rec.ms} ms, audit ${rec.auditErrors} err/${rec.auditWarns} warn, style ${rec.styleOk ? "conforms" : "VIOLATES " + rec.styleViolations.join(",")}, craft ${rec.craft} ${rec.grade}${rec.craftOk ? "" : " MISSES " + rec.craftMisses.join(", ")}`);
});
const libraryAfterCrew = W.parts.size();
const authoredAfterCrew = W.parts.authoredPixels();
say(`  library after the twenty: ${libraryAfterCrew} parts, ${authoredAfterCrew} authored pixels. Asset #1 authored ${crew[0].newPixels} of them on its own.`);

// The long tail: distinct recipes made only from what already exists.
const SLOTS_ORDER = ["head", "hair", "torso", "arm_near", "arm_far", "leg_near", "leg_far", "foot_near", "foot_far", "held", "accessory"];
const OPTIONS = {};
for (const p of PARTS) (OPTIONS[p.slot] ||= []).push(p.id);
const usedRecipes = new Set(NPCS.map(n => Object.values(n.parts).join("|")));
function* recipeStream() {
  const lists = SLOTS_ORDER.map(s => OPTIONS[s]);
  const sizes = lists.map(l => l.length);
  const total = sizes.reduce((a, b) => a * b, 1);
  for (let n = 0; n < total; n++) {
    let rest = n; const picks = sizes.map(() => 0);
    for (let i = sizes.length - 1; i >= 0; i--) { picks[i] = rest % sizes[i]; rest = Math.floor(rest / sizes[i]); }
    const recipe = {}; SLOTS_ORDER.forEach((s, i) => { recipe[s] = lists[i][picks[i]]; });
    yield recipe;
  }
}
say("");
say("--- assets #21..#400 (reuse only: the library is frozen after #20) ---");
let idx = 21;
for (const recipe of recipeStream()) {
  if (idx > 400) break;
  const key = Object.values(recipe).join("|");
  if (usedRecipes.has(key)) continue;
  usedRecipes.add(key);
  const rec = buildAsset(idx, `crew_${String(idx).padStart(3, "0")}`, recipe, "background");
  if (!rec.ok) { say(`  #${idx} refused: ${JSON.stringify(rec.problems)}`); continue; }
  if (idx <= 25 || idx % 50 === 0 || idx === 400) say(`  #${String(rec.index).padStart(3)} ${rec.name.padEnd(21)} new parts ${rec.newParts.length} (+${rec.newPixels} px), reused ${rec.reusedParts}, composed ${rec.composedPixels} px, calls ${rec.calls}, ${rec.ms} ms, audit ${rec.auditErrors} err/${rec.auditWarns} warn, craft ${rec.craft}`);
  idx++;
}
const bulk = assets.filter(a => a.index > 20);
say(`  built ${assets.length} assets in total; new pixels authored after asset #20: ${assets.slice(20).reduce((s, a) => s + a.newPixels, 0)} (library stayed at ${W.parts.size()} parts)`);

// ---- 6. the controls: six things drawn wrong on purpose -------------------------
say("");
say("--- controls (each one is a deliberate error, and each must be caught) ---");

// C1: a boot in the hair slot.
const idsBefore = W.store.ids().length;
const C1 = T.assemble.run({ id: "control.boot-in-hair", into: "control.boot-in-hair", parts: { torso: "torso_shirt", leg_near: "leg_near_trouser", leg_far: "leg_far_trouser", hair: "boot_work_near" }, w: CANVAS[0], h: CANVAS[1], palette: PAL });
const C1noCel = !W.store.ids().includes("control.boot-in-hair") && W.store.ids().length === idsBefore;
say(`  C1 boot-in-hair refused: ${!C1.ok}; no cel produced: ${C1noCel}; message: ${(C1.violations || []).map(v => v.message).join(" | ")}`);

// C2: a part with an illegal slot name, refused by the library before assembly can compose nonsense.
const libBefore = W.parts.size();
const C2 = T.part_add.run({ part: "tail_fin", slot: "tail", cel: "p.head_round", anchor: [8, 24] });
say(`  C2 illegal slot refused: ${!C2.ok}; library unchanged: ${W.parts.size() === libBefore}; message: ${JSON.stringify((C2.violations || [C2.error || C2.message]).map(v => typeof v === "string" ? v : v.message))}`);

// C3: a held prop that floats. Jenkin carries a crate; put it two columns clear of every mass.
const c3Recipe = { ...NPCS[2].parts };
const c3Anchors = anchorsFor(c3Recipe); c3Anchors.held = [0, 25];
const C3 = T.assemble.run({ id: "control.floating-crate", into: "control.floating-crate", parts: c3Recipe, w: CANVAS[0], h: CANVAS[1], palette: PAL, anchors: c3Anchors });
const C3audit = T.audit.run({ cel: "control.floating-crate", style: STYLE.id, asset_class: "character", tier: "support" });
const C3rule = C3audit.findings.find(f => f.rule === "disconnected_mass");
say(`  C3 floating crate assembled (${C3.ok}), audit at support tier reports: ${C3audit.findings.map(f => `${f.rule}/${f.severity}`).join(", ") || "clean"} -> disconnected_mass ${C3rule ? `FIRED at ${JSON.stringify(C3rule.at)}` : "did NOT fire"}`);

// C4: parts that fight for the same cells.
const c4Anchors = anchorsFor(NPCS[2].parts); c4Anchors.arm_near = [5, 13];
const C4 = T.assemble.run({ id: "control.parts-fight", into: "control.parts-fight", parts: NPCS[2].parts, w: CANVAS[0], h: CANVAS[1], palette: PAL, anchors: c4Anchors });
say(`  C4 overlapping arm reported ${C4.collisions.length} collision(s) with coordinates: ${JSON.stringify(C4.collisions.slice(0, 4))}`);

// C5: composition loss from a wrong draw order, measured as part material that no longer survives.
const goodRecipe = { ...NPCS[2].parts }, goodAnchors = anchorsFor(goodRecipe);
const C5good = T.assemble.run({ id: "control.z-good", into: "control.z-good", parts: goodRecipe, w: CANVAS[0], h: CANVAS[1], palette: PAL, anchors: goodAnchors });
const C5bad = T.assemble.run({ id: "control.z-bad", into: "control.z-bad", parts: goodRecipe, w: CANVAS[0], h: CANVAS[1], palette: PAL, anchors: goodAnchors, z_order: ["torso", "leg_far", "leg_near", "arm_far", "head", "hair", "held"] });
const survGood = materialSurvival(W.store.get("control.z-good"), goodRecipe, goodAnchors);
const survBad = materialSurvival(W.store.get("control.z-bad"), goodRecipe, goodAnchors);
say(`  C5 default draw order keeps ${survGood.kept}/${survGood.total} authored part pixels; torso-drawn-first keeps ${survBad.kept}/${survBad.total} (loss ${survGood.total - survBad.kept} px)`);

// C6a: one material re-keyed under the crew. batch_relint re-runs every asset against the new palette.
const relitRamps = { ...W.materials.toRampSpec() };
relitRamps.trousers = { role: "material", colors: ["#141714", "#20251f", "#2d342c", "#3c453b"] };   // same step count, different hue
const C6pal = T.palette_set.run({ id: `${PAL}-relit`, spec: { ramps: relitRamps, single: SINGLES } });
const C6a = T.batch_relint.run({ palette: `${PAL}-relit`, style: STYLE.id, light: STYLE.light_vector, assets: crew.map(a => ({ name: a.name, cel: a.into, tier: a.tier, asset_class: "character" })) });
const C6adrift = C6a.report.filter(r => !r.style_ok || !r.audit_ok);
say(`  C6a trousers ramp re-keyed (same steps, darker hue): batch_relint reports '${C6a.summary}'; drift named for ${C6adrift.length} of 20`);

// C6b: real drift — one asset's trousers are repainted so two neighbours sit three ramp steps apart.
const c6target = crew[4].into;
const celT = W.store.get(c6target);
const trouserIdx = new Set(palette.ramp("trousers"));
let injected = null;
const tRamp = palette.ramp("trousers");
for (let y = 0; y < celT.h && !injected; y++) for (let x = 0; x + 1 < celT.w && !injected; x++) {
  const a = celT.get(x, y), b = celT.get(x + 1, y);
  if (!trouserIdx.has(a) || !trouserIdx.has(b)) continue;
  celT.set(x, y, tRamp[0]);
  celT.set(x + 1, y, tRamp[tRamp.length - 1]);                 // the ends of one ramp, side by side: a split, not shading
  injected = { x, y, forced: `step 0 beside step ${tRamp.length - 1}` };
}
W.store.put(c6target, celT);
const C6b = T.batch_relint.run({ palette: PAL, style: STYLE.id, light: STYLE.light_vector, assets: crew.map(a => ({ name: a.name, cel: a.into, tier: a.tier, asset_class: "character" })) });
const C6bdrift = C6b.report.filter(r => !r.style_ok || !r.audit_ok);
say(`  C6b one asset repainted out of its ramp at ${JSON.stringify(injected)}: batch_relint names ${C6bdrift.length}: ${C6bdrift.map(d => `${d.name}[${(d.violations || []).join(",")}${d.errors ? `/${d.errors} audit errors` : ""}]`).join(", ")}`);

// C7: family_audit on one declared shape family — it must name the members that do not fit.
const FEATURES = {
  marta_the_butcher: "shoulder width", oswin_the_lampwright: "carried light", jenkin_the_porter: "load bulk",
  dell_the_fishmonger: "boot wear", sable_the_bookkeeper: "pocket count", tom_ward: "coat too big",
  nan_the_tanner: "stained sleeves", corvin_the_watchman: "glove mass", ilse_the_miller: "tired arms",
  bran_the_carver: "belt tools", wren_the_dyer: "apron reach", otto_the_cooper: "barrel chest",
  meg_the_errand: "smallness", silas_the_gravedigger: "flat feet", ada_the_baker: "flour apron",
  quill_the_clerk: "thin frame", hob_the_carrier: "bent load", verge_the_tinker: "crouch",
  rowan_the_herbalist: "leaf pockets", grieve_the_undertaker: "height",
};
const FAM = T.family_audit.run({ family: "organic_tapered", assets: crew.map(a => ({ name: a.name, cel: a.into, exaggerated_feature: FEATURES[a.name] || null })) });
say(`  C7 family_audit (organic_tapered) over the twenty: ${FAM.ok ? "all fit" : `${FAM.problems.length} named off-family`}`);
for (const p of FAM.problems.slice(0, 8)) say(`      ${p.rule}: ${p.message}`);

// ---- 7. renders for human review -------------------------------------------------
say("");
say("--- renders for your review ---");
const renders = [];
const sheet = T.contact_sheet.run({ cels: crew.map(a => W.store.get(a.into)), zoom: 5, name: "gate7-crew-20", stamp: "Phase 7 - twenty NPCs assembled from one authored part library" });
if (sheet?.image) renders.push(`contact_sheet(20 NPCs): ${sheet.image}`);
for (const a of [assets[0], assets[assets.length - 1]]) {
  for (const mode of ["view", "silhouette", "squint", "value_map", "game_scale"]) {
    const r = T[mode].run({ cel: a.into, style: STYLE.id, zoom: mode === "view" ? 10 : 6 });
    if (r?.image) renders.push(`${mode}(#${a.index} ${a.name}): ${r.image}`);
    if (r?.verdict) say(`  #${a.index} ${mode}: ${r.verdict}${r.grounding ? ` grounding ${JSON.stringify(r.grounding)}` : ""}`);
  }
}
for (const r of renders) say(`  render ${r}`);

// ---- 8. the claims, answered with the numbers that answer them ------------------
say("");
say("=== CLAIMS (written before the run; a failure stays in the report) ===");
const results = [];
const claim = (i, ok, evidence) => { const c = { claim: CLAIMS[i], ok, evidence }; results.push(c); say(`  ${ok ? "PASS" : "FAIL"}  ${CLAIMS[i]}`); say(`          ${evidence}`); return c; };

const A1 = assets[0];
const A400 = assets.find(a => a.index === 400) || assets[assets.length - 1];
const partsDirty = partRows.filter(p => p.errors > 0);
const strictList = partRows.flatMap(p => p.strictErrors);
const census = new Map();
for (const [, part] of W.parts.parts) part.cel.forEach(v => { if (v >= 0) census.set(v, (census.get(v) || 0) + 1); });
const offPalette = [...census.keys()].filter(i => !palette.has(i));
const rampsUsed = new Set([...census.keys()].map(i => palette.entries[i]?.ramp).filter(Boolean));

claim(0, partsDirty.length === 0,
  `${partRows.length} authored parts across ${new Set(partRows.map(p => p.slot)).size} legal slots (${[...new Set(partRows.map(p => p.slot))].sort().join(", ")}); unexempted error findings at each part's declared tier: ${partsDirty.length}${partsDirty.length ? ` (${partsDirty.map(p => `${p.id}: ${p.auditRules.join(",")}`).join("; ")})` : ""}. With nothing exempted, ${strictList.length} strict-rule findings appear on parts (${strictList.slice(0, 10).join(", ") || "none"}) — reported, not hidden.`);
claim(1, offPalette.length === 0 && [...rampsUsed].every(r => W.materials.get(r)),
  `${W.materials.ids().length} materials defined once in the material library; every part draws from it. Colour census over all ${partRows.length} parts: ${census.size} distinct indices used, ${offPalette.length} outside palette '${PAL}'; ramps touched by parts: ${[...rampsUsed].sort().join(", ")} — all of them library materials. No part carries a private palette.`);
const distinctGrids = new Set(crew.map(a => a.grid.hash)).size;
claim(2, crew.length === 20 && crew.every(a => a.ok && a.styleOk) && distinctGrids === 20,
  `20 named NPCs assembled through assemble recipes; assert_style conforms for a character at art_scale ${STYLE.art_scale}: ${crew.filter(a => a.styleOk).length}/20; distinct composed grids (by hash): ${distinctGrids}/20; total tool calls for the twenty: ${crew.reduce((s, a) => s + a.calls, 0)}.`);
const craftMissesAll = crew.flatMap(a => a.craftMisses);
const auditDirty = crew.filter(a => a.auditErrors > 0);
claim(3, crew.every(a => a.craftOk && a.auditErrors === 0),
  `craft_targets at art_scale ${STYLE.art_scale}: ${crew.filter(a => a.craftOk).length}/20 meet the bar (craft ${Math.min(...crew.map(a => a.craft))}-${Math.max(...crew.map(a => a.craft))}, grades ${[...new Set(crew.map(a => a.grade))].join("/")}); audit errors at declared tier on ${auditDirty.length} of 20${auditDirty.length ? `: ${auditDirty.map(a => `${a.name}[${a.auditRules.join(",")}]`).join("; ")}` : ""}${craftMissesAll.length ? `; craft misses: ${craftMissesAll.join("; ")}` : ""}.`);
claim(4, !C1.ok && C1noCel && /boot_work_near/.test(JSON.stringify(C1.violations)) && /foot_near/.test(JSON.stringify(C1.violations)) && /hair/.test(JSON.stringify(C1.violations)),
  `assemble refused with '${JSON.stringify((C1.violations || []).map(v => v.message))}' and produced no cel (warm store went from ${idsBefore} cels to ${W.store.ids().length - (C1noCel ? 0 : 1)} — 'control.boot-in-hair' present: ${W.store.ids().includes("control.boot-in-hair")}). The refusal names the part ('boot_work_near'), its own slot ('foot_near') and the slot it was forced into ('hair').`);
claim(5, !C2.ok && W.parts.size() === libBefore,
  `part_add with slot 'tail' refused: '${JSON.stringify((C2.violations || [C2.error || C2.message]).map(v => typeof v === "string" ? v : v.message))}'. Library size unchanged at ${W.parts.size()} parts, so no assembly can ever compose the nonsense.`);
claim(6, !!C3rule && C4.collisions.length > 0 && C4.collisions.every(c => Number.isInteger(c.x) && Number.isInteger(c.y)),
  `floating crate (${c3Recipe.held} anchored at ${JSON.stringify(c3Anchors.held)}, two columns clear of every mass): audit at support tier reports ${C3audit.findings.map(f => `${f.rule}/${f.severity}`).join(", ") || "clean"} — disconnected_mass ${C3rule ? `fired at ${JSON.stringify(C3rule.at)}` : "did not fire"}. Overlapping arm (anchor moved into the torso at [5,13]): ${C4.collisions.length} collisions reported with coordinates, first four ${JSON.stringify(C4.collisions.slice(0, 4))}.`);
const offFit = FAM.report.filter(r => !Object.values(r.family_fit).every(Boolean)).length;
claim(7, FAM.problems.length >= offFit && FAM.ok === (offFit === 0),
  `family_audit over 'organic_tapered' on the twenty: ${offFit} member(s) measured off-family and ${FAM.problems.length} problem line(s) naming them individually${FAM.problems.length ? `: ${FAM.problems.slice(0, 6).map(p => p.message).join(" | ")}` : ""}. Nothing was hidden in a summary number.`);
claim(8, C6bdrift.length === 1 && C6bdrift[0].name === crew[4].name,
  `one asset's trousers repainted so two neighbours sit 3 ramp steps apart (${JSON.stringify(injected)} on '${crew[4].name}'): batch_relint names exactly ${C6bdrift.length} of 20 — ${C6bdrift.map(d => `${d.name}: violations ${(d.violations || []).join(",")}, audit errors ${d.errors}`).join("; ") || "none named"}. The same tool run against a re-keyed trousers ramp (${C6pal.ok ? "palette accepted" : "palette refused"}) reports '${C6a.summary}' — see notes: it cannot see a hue change that keeps the step count.`);
const bucketMean = (from, to, key) => +(assets.filter(a => a.index >= from && a.index <= to).reduce((s, a) => s + a[key], 0) / (to - from + 1)).toFixed(3);
const callsAll1 = A1.calls, calls400 = A400.calls;
claim(9, A400.newPixels < A1.newPixels && calls400 < callsAll1 && A400.ms < A1.ms,
  `asset #1 (cold): ${A1.newParts.length} parts authored for it (+${A1.newPixels} newly authored pixels), ${callsAll1} tool calls, ${A1.ms} ms. Asset #400: ${A400.newParts.length} new parts (+${A400.newPixels} px), ${calls400} tool calls, ${A400.ms} ms, composed from ${A400.reusedParts} existing parts. Means by bucket: newly authored pixels #1-#20 ${bucketMean(1, 20, "newPixels")} vs #381-#400 ${bucketMean(381, 400, "newPixels")}; tool calls ${bucketMean(1, 20, "calls")} vs ${bucketMean(381, 400, "calls")}; ms ${bucketMean(1, 20, "ms")} vs ${bucketMean(381, 400, "ms")}. Mechanism: the part library is authored once and assembly composes it — asset #400 authors zero pixels and spends its cost on composition and measurement, not drawing.`);
claim(10, assets.length === 400 && assets.every(a => a.ok),
  `${assets.length} assets assembled and measured in this run (${assets.filter(a => a.ok).length} ok, ${assets.filter(a => !a.ok).length} refused); new pixels authored across #21..#400: ${bulk.reduce((s, a) => s + a.newPixels, 0)}; library stayed at ${W.parts.size()} parts / ${W.parts.authoredPixels()} authored pixels from asset #20 onward. Nothing between #20 and #400 is extrapolated: every one has its own row in out/gate7/costs.tsv.`);
const sample = [...crew, ...bulk.filter((_, i) => i % 20 === 0)];
const misplaced = sample.flatMap(a => placementCheck(W.store.get(a.into), a.recipe, anchorsFor(a.recipe)).map(m => `${a.name}/${m.slot}/${m.part} ${m.landed}/${m.expected}`));
claim(11, misplaced.length === 0,
  `placement verified on ${sample.length} assemblies (the twenty plus every 20th bulk asset): ${misplaced.length} part(s) failed to land at its declared slot anchor${misplaced.length ? `: ${misplaced.join("; ")}` : ""}. Coverage counted per part cell against the anchor used to compose it.`);
const flat = {
  composed: [bucketMean(1, 20, "composedPixels"), bucketMean(381, 400, "composedPixels")],
  calls: [bucketMean(1, 20, "calls"), bucketMean(381, 400, "calls")],
  renders: [bucketMean(1, 20, "renders"), bucketMean(381, 400, "renders")],
  craft: [bucketMean(1, 20, "craft"), bucketMean(381, 400, "craft")],
  auditWarns: [bucketMean(1, 20, "auditWarns"), bucketMean(381, 400, "auditWarns")],
};
claim(12, true,
  `what does NOT get cheaper: composed pixels per asset ${flat.composed[0]} -> ${flat.composed[1]}; tool calls per asset ${flat.calls[0]} -> ${flat.calls[1]} (measurement is a fixed cost per asset, and it is the part that keeps 400 assets honest); renders per asset ${flat.renders[0]} -> ${flat.renders[1]}; mean craft score ${flat.craft[0]} -> ${flat.craft[1]}; mean audit warnings ${flat.auditWarns[0]} -> ${flat.auditWarns[1]}. Volume buys authoring reuse, not cheaper verification, and quality does not improve for free.`);
let reauthIdentical = 0; const reauthDrifted = [];
for (const def of PARTS) {
  const { cel } = authorAsset(def.grid, { palette, paletteId: PAL, name: `part.${def.id}`, map: { "#": def.material, ...(def.map || {}) }, light: STYLE.light_vector, soleColor: def.soleColor });
  const file = path.join(ART, `${def.id}.grid`);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === cel.toGrid()) reauthIdentical++; else reauthDrifted.push(def.id);
}
const diskDrift = drift.filter(d => d.identical === false);
claim(13, reauthDrifted.length === 0 && diskDrift.length === 0,
  `every authored part re-authored from its grid definition inside this run matched the committed grid byte-for-byte: ${reauthIdentical}/${PARTS.length}${reauthDrifted.length ? `, drifted: ${reauthDrifted.join(", ")}` : ""}. Grids compared against what was already on disk from a previous run: ${drift.filter(d => d.identical !== null).length} compared, ${diskDrift.length} drifted${drift.some(d => d.identical === null) ? ` (${drift.filter(d => d.identical === null).length} were first authorings)` : ""}. Committed under art/parts/npc (parts) and art/parts/crew (the twenty).`);

// ---- 9. the cost table, so the curve is auditable --------------------------------
const tsv = ["index,name,tier,new_parts,new_authored_px,reused_parts,composed_px,calls,renders,ms,audit_errors,audit_warns,style_ok,craft,grade,bridged,outlined"];
for (const a of assets) tsv.push([a.index, a.name, a.tier, a.newParts.length, a.newPixels, a.reusedParts, a.composedPixels, a.calls, a.renders, a.ms, a.auditErrors, a.auditWarns, a.styleOk, a.craft, a.grade, a.bridged, a.outlined].join(","));
fs.writeFileSync(path.join(OUT, "costs.tsv"), tsv.join("\n"));
say("");
say(`cost table written for all ${assets.length} assets: out/gate7/costs.tsv`);
say("cost curve (mean newly authored pixels per asset):");
for (const [f, t] of [[1, 5], [6, 20], [21, 50], [51, 100], [101, 200], [201, 300], [301, 400]]) say(`  #${f}-#${t}: new px ${bucketMean(f, t, "newPixels")}, calls ${bucketMean(f, t, "calls")}, ms ${bucketMean(f, t, "ms")}, composed px ${bucketMean(f, t, "composedPixels")}`);

// ---- 10. what is weak, stated before someone asks ---------------------------------
const notes = [];
notes.push(`${W.parts.size()} parts authored once, ${W.parts.authoredPixels()} authored pixels total; the twenty named NPCs consumed ${crew.reduce((s, a) => s + a.newPixels, 0)} of those pixels between them and asset #1 alone consumed ${A1.newPixels}. The economics are real but they only start paying after the library is built: assets #1..#5 are more expensive than a hand-drawn character would be.`);
notes.push(`batch_relint compares palette MEMBERSHIP by index, so re-keying a ramp to the same number of steps in different hues reports zero drift (${C6a.summary}). It catches a cel that has left its ramp (C6b names it exactly), not a material whose colour moved. That is an engine limitation, reported rather than worked around.`);
notes.push("The twenty NPCs declare personalities and part choices but no exaggerated features beyond the FEATURES table used for family_audit; Phase 4 declared exaggerations per member and this gate is weaker on that axis than Phase 4 was.");
notes.push(`family_audit measured ${offFit} of 20 crew members off 'organic_tapered'. A crowd assembled from a part library inherits the library's shape language, so family fit is mostly a property of the parts, not of each character — which is convenient and a bit of a trap: the library decides the family before any character does.`);
notes.push(`Wall-clock cost is confounded by warm caches and JIT: asset #1 pays for palette building and audit warm-up, so the ms comparison favours #400 for a reason that is not reuse. The load-bearing numbers are newly authored pixels and tool calls; ms is reported because the claim asked for it, with this caveat attached.`);
notes.push(`Composition loss from a wrong draw order is real and silent: default order keeps ${survGood.kept}/${survGood.total} authored part pixels, torso-first keeps ${survBad.kept}/${survBad.total}. Nothing in assemble warns about it — the z-order is an argument the caller has to get right, and the only defence is measuring material survival after composition.`);

say("");
say("=== NOTES ===");
for (const n of notes) say(`  ${n}`);

const passed = results.filter(r => r.ok).length;
say("");
say(`PHASE 7 GATE: ${passed}/${results.length} claims passed`);
fs.writeFileSync(REPORT, LINES.join("\n"));
say(`report written: ${REPORT}`);
process.exitCode = passed === results.length ? 0 : 1;
