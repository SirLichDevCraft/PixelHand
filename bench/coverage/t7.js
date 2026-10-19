// PHASE 8 COVERAGE — T7: animation of something with no body at all.
// docs/08 §4 row T7: "Spell FX: 6-frame fireball + looping flame, particle-procedural"
//   proves "animation of something with no body at all, palette-legal".
//
// Everything here is hand-placed: each frame is authored as a list of strokes at declared
// coordinates (the tool-by-tool route of bench/data/COVERAGE.md §3B), then the light falloff
// around each head is built with `glow` — ramp steps arranged in space, which is exactly what
// docs/08 §3 prescribes for Spell/combat FX ("palette-legal 'additive' look built from ramp
// steps in space"). No filter, no alpha, no procedural generation of the form, nothing imported.
//
// The honest difficulty of this coordinate is that every structure rule in the engine is written
// for a body: `disconnected_mass` refuses a limb that floats, `detached_speck` refuses a 1-2px
// speck, `no_contact_ground` wants feet. A comet has no feet and its embers genuinely do float.
// That is reported with numbers (claims 5 and 8), not hidden behind a tier switch.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const styleCore = require("../../src/core/style.js");
const rig = require("../../src/core/rig.js");
const craft = require("../../src/craft.js");

// ---- the coordinate, declared rather than picked from a shelf ----------------------
// edge_policy "none": an FX has no outline to wear (docs/08 §1 E). shading "ramp-lit": the falloff
// IS the modelling. detail "moderate": flat + dense-grain is refused outright (style.js L28), and
// a fireball that is all core with no wisps is not a fireball. motion "6-frame": docs/08 §4 names
// this row "particle-procedural", which does not exist on this engine's motion axis — the refusal
// is proven as a control in claim 8 and the nearest legal value is declared instead.
const STYLE = {
  id: "t7-pyre-fx", projection: "side", art_scale: 32, palette_size: 16,
  temperature: "warm-cool-hue-shift", edge_policy: "none", shading: "ramp-lit",
  detail: "moderate", motion: "6-frame", mood: "menacing", light_vector: [-0.7, -0.7],
};
const PALETTE_ID = "t7-pyre";
// 16 entries exactly: one warm fire ramp (5 steps, shadows cool / lit end warm = the declared
// temperature model), one cool smoke ramp (4 steps, the complementary side of the same event),
// a 3-step light-role core ramp that `glow` builds its falloff from, plus three singles.
const PALETTE_SPEC = {
  ramps: {
    fire:  { role: "material", colors: ["#4a1210", "#8c2a12", "#c65a1c", "#e88f2e", "#f7bf5e"] },
    smoke: { role: "material", colors: ["#141824", "#242c42", "#3b4560", "#5d6884"] },
    core:  { role: "light",    colors: ["#f2a63f", "#ffd977", "#fff3cf"] },
  },
  single: {
    ash:     { rgb: "#0b0c12", role: "shadow" },   // the cold floor the embers fall along
    spark:   { rgb: "#ff8a3d", role: "accent" },   // the focal accent: the thing to look at
    bluecap: { rgb: "#2f5f9c", role: "detail" },   // the cool gas at the base of a real flame
    dust:    { rgb: "#8a7f78", role: "material" }, // spent warm ash drifting off the top
  },
};
// FX has no body to hold together; docs/08 §3 says particle FX are exempt from the mass rules and
// this engine implements that exemption only through the tier table (src/core/parts.js L33).
// TIER is therefore declared, and every finding the strict tiers would raise is reported too.
const TIER = "background";

// ---- the authoring legend ---------------------------------------------------------
//   . air    a-e fire ramp steps 0..4 (a = coolest)   f-h core (light) ramp steps 0..2
//   i-l smoke ramp steps 0..3                          m ash   n spark   p bluecap   q dust
const LEGEND = {
  a: ["fire", 0], b: ["fire", 1], c: ["fire", 2], d: ["fire", 3], e: ["fire", 4],
  f: ["core", 0], g: ["core", 1], h: ["core", 2],
  i: ["smoke", 0], j: ["smoke", 1], k: ["smoke", 2], l: ["smoke", 3],
  m: ["ash", -1], n: ["spark", -1], p: ["bluecap", -1], q: ["dust", -1],
};

// A stroke is [x, y, text]: a hand-placed horizontal run of one ramp step at a declared position.
// The fireball travels RIGHT along rows ~16-23; every frame keeps a falling-ember line on row 23
// so the FX has a stable baseline even though it has no feet.
const FB_W = 32, FB_H = 32;
const FIREBALL = [
  {
    pose: "ignite", head: [6, 21], glow: { at: [6, 21], radius: 2 }, duration: 260,
    note: "the spell leaves the hand: a small core, the first cool wisps breaking off up-left.",
    strokes: [
      [6, 19, "d"],
      [5, 20, "chc"],
      [4, 21, "abhb"],          // tail steps begin left of the core
      [5, 22, "bdb"],
      [2, 20, "a"], [2, 22, "a"],
      [1, 18, "i"], [1, 19, "ji"], [2, 17, "j"], [0, 16, "i"],
      [1, 23, "abb"],           // detached ember cluster (3px) on the fall line
    ],
  },
  {
    pose: "stretch", head: [11, 19], glow: { at: [11, 19], radius: 3 }, duration: 90,
    note: "the body elongates along the travel axis; the tail is now a streak, not a puff.",
    strokes: [
      [11, 16, "d"],
      [10, 17, "cdc"],
      [9, 18, "bchcb"],
      [8, 19, "abcgcba"],       // heat rises toward the head: a b c | g | c b a is the own-extent ramp
      [9, 20, "cgc"],
      [10, 21, "d"],
      [11, 22, "d"],
      [5, 19, "ab"], [6, 18, "b"], [6, 20, "a"],
      [4, 15, "i"], [3, 16, "ji"], [5, 14, "j"], [2, 17, "i"],
      [5, 23, "abb"],
    ],
  },
  {
    pose: "travel-a", head: [16, 17], glow: { at: [16, 17], radius: 3 }, duration: 70,
    note: "full speed; the plume streams behind and the ember line stretches.",
    strokes: [
      [16, 14, "d"],
      [15, 15, "cdc"],
      [14, 16, "bchcb"],
      [11, 17, "aabcbchcb"],    // x11..x19: a a b c b c | h | c b
      [14, 18, "cgc"],
      [15, 19, "cdc"],
      [16, 20, "d"],
      [9, 17, "ab"], [10, 16, "b"], [10, 18, "a"],
      [8, 13, "i"], [7, 14, "ji"], [9, 12, "j"], [6, 15, "i"],
      [9, 23, "abb"],
    ],
  },
  {
    pose: "travel-b", head: [21, 16], glow: { at: [21, 16], radius: 3 }, duration: 50,
    note: "the fastest frame: the smear is drawn along its own path by smear_frame after authoring.",
    strokes: [
      [21, 13, "d"],
      [20, 14, "cdc"],
      [19, 15, "bchcb"],
      [14, 16, "aaabcchcb"],    // x14..x23 long thin streak
      [19, 17, "cgc"],
      [20, 18, "cdc"],
      [21, 19, "d"],
      [12, 16, "ab"], [13, 15, "b"], [13, 17, "a"],
      [11, 12, "i"], [10, 13, "ji"], [12, 11, "j"], [9, 14, "i"],
      [13, 23, "abb"],
    ],
  },
  {
    pose: "travel-c", head: [25, 17], glow: { at: [25, 17], radius: 3 }, duration: 80,
    note: "deceleration begins; the plume lifts and the tail thins.",
    strokes: [
      [25, 14, "d"],
      [24, 15, "cdc"],
      [23, 16, "bchcb"],
      [17, 17, "aabcbchcb"],    // x17..x25
      [23, 18, "cgc"],
      [24, 19, "cdc"],
      [25, 20, "d"],
      [15, 17, "ab"], [16, 16, "b"], [16, 18, "a"],
      [14, 13, "i"], [13, 14, "ji"], [15, 12, "j"], [12, 15, "i"],
      [17, 23, "abb"],
    ],
  },
  {
    pose: "impact", head: [28, 18], glow: { at: [28, 18], radius: 4 }, duration: 190,
    note: "the flare: the core spreads, sparks (accent role) break off up and back, the tail is spent.",
    strokes: [
      [28, 14, "e"],
      [27, 15, "dee"], [30, 15, "ed"],
      [26, 16, "cdehe"],
      [25, 17, "bcdehee"],
      [22, 18, "abcbchghfe"],   // x22..x31: the heat peaks at x27-28 then spills forward
      [25, 19, "bcghee"],
      [26, 20, "cdee"],
      [27, 21, "ee"],
      [20, 18, "ab"], [21, 17, "b"], [21, 19, "a"],
      [18, 14, "i"], [17, 15, "ji"], [19, 13, "j"], [16, 16, "i"],
      [19, 23, "abb"],
      [24, 12, "nnn"],          // spark cluster (accent role), 3px so it is a mass, not a speck
      [22, 15, "n"], [30, 12, "nn"],
    ],
  },
];

// The looping flame: a coal bed that never moves (rows 21-23 identical in every frame) and a body
// that flickers. Six frames, authored so frame 5 hands back to frame 0 without a jump.
const FL_W = 20, FL_H = 24;
// The bed is identical in every flame frame: it is what the loop seams against.
const BED = [
  [6, 21, "abcddcba"],               // x6..x13, hot coals
  [4, 22, "aabcccccbbaa"],           // x4..x15, the coal bed widening down
  [5, 23, "mmmmmmmmmm"],             // x5..x14, the cold floor line
];
const FLAME = [
  {
    pose: "rise", glow: { at: [9, 20], radius: 2 }, duration: 120,
    strokes: [
      [9, 13, "a"], [8, 14, "bc"], [8, 15, "bdc"], [7, 16, "bcdcb"],
      [7, 17, "bchcb"], [6, 18, "abghcba"], [6, 19, "abgdba"], [6, 20, "abcdcba"],
      [11, 12, "j"], [11, 11, "i"],
    ],
  },
  {
    pose: "peak", glow: { at: [9, 20], radius: 3 }, duration: 90,
    strokes: [
      [9, 11, "c"], [9, 12, "d"], [8, 13, "bdc"], [8, 14, "bdcb"], [7, 15, "bcdcb"],
      [7, 16, "bchcb"], [6, 17, "abghcba"], [6, 18, "abghcba"], [6, 19, "abgdba"], [6, 20, "abcdcba"],
      [10, 10, "j"], [10, 9, "i"],
    ],
  },
  {
    pose: "lean-left", glow: { at: [8, 20], radius: 2 }, duration: 150,
    strokes: [
      [7, 12, "a"], [7, 13, "bc"], [6, 14, "bdc"], [6, 15, "bcdcb"], [6, 16, "bchcb"],
      [5, 17, "abghcba"], [6, 18, "abghcba"], [6, 19, "abgdba"], [6, 20, "abcdcba"],
      [9, 11, "j"], [9, 10, "i"], [12, 13, "k"],
    ],
  },
  {
    pose: "settle", glow: { at: [9, 20], radius: 2 }, duration: 110,
    strokes: [
      [9, 14, "a"], [8, 15, "bc"], [8, 16, "bdc"], [7, 17, "bcdcb"], [7, 18, "bchcb"],
      [6, 19, "abghcba"], [6, 20, "abcdcba"],
      [11, 13, "j"], [11, 12, "i"], [12, 14, "k"],
    ],
  },
  {
    pose: "lean-right", glow: { at: [10, 20], radius: 2 }, duration: 80,
    strokes: [
      [11, 12, "a"], [11, 13, "bc"], [11, 14, "bdc"], [10, 15, "bcdcb"], [10, 16, "bchcb"],
      [9, 17, "abghcba"], [8, 18, "abghcba"], [7, 19, "abgdba"], [6, 20, "abcdcba"],
      [13, 11, "j"], [13, 10, "i"], [6, 13, "k"],
    ],
  },
  {
    pose: "dip", glow: { at: [9, 20], radius: 2 }, duration: 140,
    strokes: [
      [9, 15, "a"], [9, 16, "dc"], [8, 17, "bdcb"], [7, 18, "bchcb"], [7, 19, "abghcba"],
      [6, 20, "abcdcba"],
      [11, 14, "j"], [11, 13, "i"], [8, 13, "k"], [12, 15, "l"],
    ],
  },
];

// ---- helpers -------------------------------------------------------------------

/** Hand-placed strokes -> a full grid of legend letters. Overlaps are an authoring error, not a merge. */
function expandStrokes(strokes, w, h) {
  const g = Array.from({ length: h }, () => Array(w).fill("."));
  for (const [x, y, text] of strokes) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") continue;                       // ' ' is leave-alone in this notation too
      if (x + i >= w || y >= h || y < 0 || x < 0) throw new Error(`stroke leaves the canvas at ${x + i},${y}`);
      if (g[y][x + i] !== ".") throw new Error(`two authored strokes collide at ${x + i},${y}`);
      g[y][x + i] = ch;
    }
  }
  return g.map(r => r.join(""));
}

/** Legend rows -> the engine's charset rows (what draw_pixel_map actually takes). */
function toCharsetRows(letterRows, palette) {
  const { charFor } = require("../../src/core/cel.js");
  return letterRows.map(row => [...row].map(ch => {
    if (ch === ".") return ".";
    const [ramp, step] = LEGEND[ch];
    const name = step < 0 ? ramp : `${ramp}.${step}`;
    const idx = palette.byName.get(name);
    if (idx === undefined) throw new Error(`legend '${ch}' -> '${name}' is not an entry of palette '${palette.id}'`);
    return charFor(idx);
  }).join(""));
}

/** Colour census: every index used in a cel, with its declared name and role. */
function census(cel, palette) {
  const used = [...cel.counts().entries()].sort((a, b) => a[0] - b[0]);
  return {
    entries: used.length,
    pixels: used.reduce((s, [, n]) => s + n, 0),
    offPalette: used.filter(([i]) => !palette.has(i)).length,
    detail: used.map(([i, n]) => `${palette.entries[i]?.name ?? "?"}x${n}`).join(" "),
  };
}

/** Column-mean brightness across the cel's own extent, tail -> head -> front edge. */
function columnHeat(cel, palette, coreNames) {
  const bb = cel.bbox();
  if (!bb) return { cols: [], headX: null, monotoneUp: false, monotoneDown: false };
  const cols = [];
  for (let x = bb.x0; x <= bb.x1; x++) {
    let sum = 0, n = 0;
    for (let y = 0; y < cel.h; y++) {
      const v = cel.get(x, y);
      if (v < 0) continue;
      sum += craft.luma(palette.color(v)); n++;
    }
    if (n) cols.push({ x, mean: +(sum / n).toFixed(3) });
  }
  let headX = -1;
  cel.forEach((v, x) => { if (v >= 0 && coreNames.includes(palette.entries[v]?.name)) headX = Math.max(headX, x); });
  const up = cols.filter(c => c.x <= headX).map(c => c.mean);
  const down = cols.filter(c => c.x >= headX).map(c => c.mean);
  const nonDecreasing = a => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-9);
  const nonIncreasing = a => a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-9);
  return { cols, headX, up, down, monotoneUp: nonDecreasing(up), monotoneDown: nonIncreasing(down) };
}

const CLAIMS = [
  "every FX frame uses only colours from the declared palette (colour census reported per frame)",
  "in every fireball frame the heat steps monotonically up the light ramp from tail to head and monotonically down from head to front edge (measured column sequences)",
  "the looping flame passes loop_validate with no stuttering seam: loopDelta vs average step, stable baseline, no duplicate frames",
  "the fireball is built from glow rings on the declared light ramp plus a smear drawn along its travel path, with authored per-frame durations",
  "every FX frame passes audit at the declared tier with zero unexempted error findings, and what the strict tiers would say is reported rather than hidden",
  "every FX frame conforms to assert_style for asset_class 'fx' at art_scale 32",
  "the coordinate was declared from scratch — no preset bible and no reused palette",
  "docs/08 row T7's motion value 'particle-procedural' is refused by this engine's motion axis (control), and the body-written rules that particles defeat are reported with numbers",
  "renders exist and read correctly: contact sheet of both clips, GIF playback at the authored fps, silhouette / squint / value_map",
];

function run(ctx) {
  const { T, W, OUT, say } = ctx;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ART = path.join(__dirname, "..", "..", "art", "coverage", "t7");
  fs.mkdirSync(ART, { recursive: true });

  const notes = [];
  const claims = [];
  const artifacts = ["art/coverage/t7"];
  const hashOf = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  const ruleText = (r) => (r.errors || []).map(e => e.rule ? `${e.rule}: ${e.message}` : String(e)).join(" | ");

  // ---- 0. control first: docs/08 names a motion value this engine does not have ----
  const attempted = { ...STYLE, motion: "particle-procedural" };
  const refusal = styleCore.validateCoordinate(attempted);
  say(`control: motion 'particle-procedural' accepted? ${refusal.ok}  ${ruleText(refusal)}`);

  // ---- 1. declare the coordinate and the palette ---------------------------------
  const init = T.project_init.run({ root: OUT, game: "t7", style: STYLE, canvas: { w: FB_W, h: FB_H }, fps: 10, directions: ["right"] });
  if (!init.ok) throw new Error(`project_init refused the coordinate: ${init.violations?.[0]?.message || JSON.stringify(init)}`);
  const palRes = T.palette_set.run({ id: PALETTE_ID, spec: PALETTE_SPEC });
  if (!palRes.ok) throw new Error(`palette_set refused: ${palRes.violations?.[0]?.message || JSON.stringify(palRes)}`);
  const P = W.palette(PALETTE_ID);
  const rampLint = P.auditRamps();
  const coreNames = P.ramp("core").map(i => P.entries[i].name);
  say(`declared ${STYLE.id} @ art_scale ${STYLE.art_scale}, palette ${P.id} (${P.size} entries authored of a ${STYLE.palette_size} budget)`);
  say(`ramp lint: ${rampLint.problems.length} problem(s)${rampLint.problems.length ? ": " + rampLint.problems.map(p => `${p.severity || "warn"} ${p.rule}`).join(", ") : ""}`);

  // ---- 2. author the fireball: strokes -> pixel map -> glow falloff --------------
  T.sprite_create.run({ id: "t7-fireball", w: FB_W, h: FB_H, palette: PALETTE_ID, style: STYLE.id, tier: TIER, asset_class: "fx" });
  const fbIds = [];
  const preview = [];
  FIREBALL.forEach((fr, i) => {
    const id = `t7-fireball/f${i}-${fr.pose}`;
    T.cel_new.run({ cel: id, w: FB_W, h: FB_H, palette: PALETTE_ID });
    const drawn = T.draw_pixel_map.run({ cel: id, palette: PALETTE_ID, map: toCharsetRows(expandStrokes(fr.strokes, FB_W, FB_H), P) });
    if (!drawn.ok) throw new Error(`${id}: draw_pixel_map refused: ${drawn.violations.map(v => v.message).join(" | ")}`);
    const lit = T.glow.run({ cel: id, ramp: "core", at: fr.glow.at, radius: fr.glow.radius });
    const cel = W.store.get(id);
    cel.meta = { ...cel.meta, pose: fr.pose, label: `${i} ${fr.pose}`, asset_class: "fx", tier: TIER };
    if (!lit.ok) say(`  glow ${i}: ${lit.violations?.map(v => v.message).join("; ")}`);
    fbIds.push(id);
    preview.push(`--- fireball f${i} ${fr.pose} (glow +${lit.changed?.pixels ?? 0} light pixels) ---\n` +
      cel.toGridRows().slice(8, 25).map((r, y) => String(y + 8).padStart(2) + " " + r).join("\n"));
  });
  fs.writeFileSync(path.join(OUT, "preview.txt"), preview.join("\n\n") + "\n");

  // ---- 3. the cast clip: authored durations, then a smear along the travel path ---
  T.clip_create.run({ id: "t7-fireball", template: "attack1", sprite: "t7-fireball", fps: 10, directions: ["right"] });
  T.clip_set_frames.run({
    clip: "t7-fireball", direction: "right", sprite: "t7-fireball",
    frames: FIREBALL.map((fr, i) => ({ cel: fbIds[i], pose: fr.pose, duration: fr.duration })),
  });
  const beforeSmear = W.clips.get("t7-fireball").frames("right")[3].cel.counts();
  const smeared = T.smear_frame.run({ clip: "t7-fireball", direction: "right", frame: 3, ramp: "fire", trail: 4, palette: PALETTE_ID });
  const afterSmear = W.clips.get("t7-fireball").frames("right")[3].cel.counts();
  say(`smear_frame on f3 travel-b: ok=${smeared.ok} drawn ${beforeSmear.size}->${afterSmear.size} colours, region ${JSON.stringify(smeared.region)}`);
  T.event_add.run({ clip: "t7-fireball", direction: "right", frame: 5, event: "spell_impact", data: { damage_window_ms: 190 } });
  const fbTiming = T.timing_apply.run({ clip: "t7-fireball", durations: FIREBALL.map(f => f.duration) });

  // ---- 4. author the looping flame ----------------------------------------------
  T.sprite_create.run({ id: "t7-flame", w: FL_W, h: FL_H, palette: PALETTE_ID, style: STYLE.id, tier: TIER, asset_class: "fx" });
  const flIds = [];
  FLAME.forEach((fr, i) => {
    const id = `t7-flame/f${i}-${fr.pose}`;
    T.cel_new.run({ cel: id, w: FL_W, h: FL_H, palette: PALETTE_ID });
    const drawn = T.draw_pixel_map.run({ cel: id, palette: PALETTE_ID, map: toCharsetRows(expandStrokes([...BED, ...fr.strokes], FL_W, FL_H), P) });
    if (!drawn.ok) throw new Error(`${id}: draw_pixel_map refused: ${drawn.violations.map(v => v.message).join(" | ")}`);
    T.glow.run({ cel: id, ramp: "core", at: fr.glow.at, radius: fr.glow.radius });
    const cel = W.store.get(id);
    cel.meta = { ...cel.meta, pose: fr.pose, label: `${i} ${fr.pose}`, asset_class: "fx", tier: TIER };
    flIds.push(id);
  });
  T.clip_create.run({ id: "t7-flame-loop", template: "idle", sprite: "t7-flame", fps: 9, directions: ["front"] });
  T.clip_set_frames.run({
    clip: "t7-flame-loop", direction: "front", sprite: "t7-flame",
    frames: FLAME.map((fr, i) => ({ cel: flIds[i], pose: fr.pose, duration: fr.duration })),
  });
  const flTiming = T.timing_apply.run({ clip: "t7-flame-loop", durations: FLAME.map(f => f.duration) });
  const flameGate = T.loop_validate.run({ clip: "t7-flame-loop", direction: "front", poses: FLAME.map(f => f.pose) });
  const fbGateBody = T.loop_validate.run({ clip: "t7-fireball" });
  const fbGateFX = (() => {
    const frames = W.clips.get("t7-fireball").frames("right");
    return rig.loopValidate(frames, { maxAnchorSpread: 14, maxFootSpread: 2, maxAreaRatio: 0.6 });
  })();

  // ---- 5. measure every frame ----------------------------------------------------
  const perFrame = [];
  for (const [kind, ids, list] of [["fireball", fbIds, FIREBALL], ["flame", flIds, FLAME]]) {
    ids.forEach((id, i) => {
      const cel = W.store.get(id);
      const c = census(cel, P);
      const heat = kind === "fireball" ? columnHeat(cel, P, coreNames) : null;
      const auTier = T.audit.run({ cel: id, style: STYLE.id, asset_class: "fx", tier: TIER, light: STYLE.light_vector });
      const auStrict = T.audit.run({ cel: id, style: STYLE.id, asset_class: "fx", tier: "hero", light: STYLE.light_vector });
      const st = T.assert_style.run({ cel: id, style: STYLE.id, asset_class: "fx" });
      const ct = T.craft_targets.run({ cel: id, style: STYLE.id });
      perFrame.push({ kind, i, pose: list[i].pose, id, census: c, heat, auTier, auStrict, st, ct });
    });
  }
  const fmt = f => `${f.kind}f${f.i} ${f.pose}`;
  for (const f of perFrame) {
    say(`${fmt(f).padEnd(24)} px ${String(f.census.pixels).padStart(3)} colours ${f.census.entries} | audit@${TIER} err ${f.auTier.errors} warn ${f.auTier.warns} exempt ${f.auTier.exempted} | strict err ${f.auStrict.errors} [${[...new Set(f.auStrict.findings.filter(x => x.severity === "error").map(x => x.rule))].join(",")}] | style ${f.st.conforms ? "ok" : "FAIL " + f.st.violations.map(v => v.rule).join(",")} | craft ${f.ct.ok ? "ok" : "MISS " + f.ct.misses.map(m => `${m.target}<${m.want}>got${m.got}`).join(",")}`);
    if (f.heat) say(`   heat seq tail->head ${JSON.stringify(f.heat.up)} headX ${f.heat.headX} monotoneUp ${f.heat.monotoneUp}; head->front ${JSON.stringify(f.heat.down)} monotoneDown ${f.heat.monotoneDown}`);
  }

  // ---- 6. control: the body rules that particles defeat --------------------------
  T.cel_new.run({ cel: "t7-control.speck", w: 12, h: 12, palette: PALETTE_ID });
  T.draw_pixel_map.run({
    cel: "t7-control.speck", palette: PALETTE_ID,
    map: toCharsetRows(["....aaaa....", "....aaaa....", "....aaaa....", "........a.....", "........aa...."], P),
  });
  const tierFindings = {};
  for (const tier of ["hero", "support", "background", "system"]) {
    const r = T.audit.run({ cel: "t7-control.speck", style: STYLE.id, asset_class: "fx", tier });
    tierFindings[tier] = r.findings.filter(f => f.severity === "error").map(f => f.rule);
  }
  const tierTable = T.tier_policy.run({ tier: TIER });
  say(`control speck audit by tier: ${Object.entries(tierFindings).map(([t, v]) => `${t}=[${v.join(",")}]`).join(" ")}`);

  // ---- 7. renders ---------------------------------------------------------------
  const renders = [];
  const sheetView = T.contact_sheet.run({ cels: fbIds, palette: PALETTE_ID, zoom: 9, mode: "view", name: "t7-fireball.view", stamp: "T7 fireball — 6 frames, rightward travel, shared ember line" });
  const sheetSil = T.contact_sheet.run({ cels: fbIds, palette: PALETTE_ID, zoom: 9, mode: "silhouette", name: "t7-fireball.silhouette", stamp: "T7 fireball silhouette — the shape must read without colour" });
  const flameSheet = T.contact_sheet.run({ cels: flIds, palette: PALETTE_ID, zoom: 12, mode: "view", name: "t7-flame.view", stamp: "T7 looping flame — 6 frames on an unmoving bed" });
  const gridFB = T.contact_grid.run({ clip: "t7-fireball", palette: PALETTE_ID, zoom: 8, mode: "view", stamp: "t7-fireball — 6 frames, authored durations" });
  const gridFL = T.contact_grid.run({ clip: "t7-flame-loop", palette: PALETTE_ID, zoom: 10, mode: "view", stamp: "t7-flame-loop — 6 frames, seamless seam target" });
  renders.push(sheetView, sheetSil, flameSheet, gridFB, gridFL);
  const gifFB = T.export_gif.run({ clip: "t7-fireball", palette: PALETTE_ID, zoom: 6, name: "play.t7-fireball" });
  const gifFL = T.export_gif.run({ clip: "t7-flame-loop", palette: PALETTE_ID, zoom: 6, name: "play.t7-flame-loop" });
  const playFB = T.play.run({ clip: "t7-fireball", palette: PALETTE_ID, zoom: 6 });
  const playFL = T.play.run({ clip: "t7-flame-loop", palette: PALETTE_ID, zoom: 6 });
  for (const [id, tag] of [[fbIds[3], "travel-b"], [flIds[1], "peak"]]) {
    for (const mode of ["view", "silhouette", "value_map"]) renders.push(T.view.run({ cel: id, style: STYLE.id, asset_class: "fx", mode, zoom: mode === "view" ? 18 : 12 }));
    renders.push(T.squint.run({ cel: id, style: STYLE.id }));
  }
  for (const r of [...renders, { image: gifFB.file }, { image: gifFL.file }, { image: playFB.image }, { image: playFL.image }]) if (r?.image) artifacts.push(r.image);
  const gate = T.export_gate.run({ clips: ["t7-fireball", "t7-flame-loop"], style: STYLE.id, palette: PALETTE_ID, assetClass: "fx", light: STYLE.light_vector });

  // ---- 8. commit the grids ------------------------------------------------------
  const drift = [], hashes = {};
  for (const id of [...fbIds, ...flIds]) {
    const cel = W.store.get(id);
    const file = path.join(ART, `${id.replace(/\//g, "-")}.grid`);
    const text = cel.toGrid() + "\n";
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== text) drift.push(id);
    fs.writeFileSync(file, text);
    hashes[id] = hashOf(text);
  }

  // ---- 9. claims ----------------------------------------------------------------
  const allCensusOk = perFrame.every(f => f.census.offPalette === 0 && f.census.entries <= STYLE.palette_size);
  claims.push({
    claim: CLAIMS[0], ok: allCensusOk,
    evidence: `${perFrame.length} FX frames, census per frame (index x count): ` +
      perFrame.map(f => `${f.kind[0]}${f.i}:${f.census.entries}col/${f.census.pixels}px`).join(" ") +
      `. Off-palette pixels across all frames: ${perFrame.reduce((s, f) => s + f.census.offPalette, 0)}. Max entries in any one frame: ${Math.max(...perFrame.map(f => f.census.entries))} against a declared budget of ${STYLE.palette_size}. Palette '${P.id}' has exactly ${P.size} entries; every pixel in every frame is one of them (${perFrame[0].census.detail} in fireball f0).`,
  });

  const heatOk = perFrame.filter(f => f.heat).every(f => f.heat.monotoneUp && f.heat.monotoneDown);
  claims.push({
    claim: CLAIMS[1], ok: heatOk,
    evidence: perFrame.filter(f => f.heat).map(f => `f${f.i} ${f.pose}: tail->head ${f.heat.up.join(" ")} (head col ${f.heat.headX}) then head->front ${f.heat.down.join(" ")} — up-monotone ${f.heat.monotoneUp}, down-monotone ${f.heat.monotoneDown}`).join("; "),
  });

  const fl = flameGate.clips.front || {};
  claims.push({
    claim: CLAIMS[2], ok: !!flameGate.ok,
    evidence: `loop_validate on t7-flame-loop: loopDelta ${fl.loopDelta} vs average step ${fl.avgFrameDelta} (refusal threshold 2.6x = ${(fl.avgFrameDelta * 2.6).toFixed(0)}), footSpread ${fl.footSpread}, anchorSpread ${fl.anchorSpread}, areaRatio ${fl.areaRatio} (${(fl.areaRatio * 100).toFixed(0)}%), areas ${JSON.stringify(fl.areas)}, collisions ${fl.collisions}, duplicate frames none, pose order ${FLAME.map(f => f.pose).join(",")}. problems: ${JSON.stringify(fl.problems)}`,
  });

  const glowPixels = perFrame.filter(f => f.kind === "fireball").reduce((s, f) => s + f.census.pixels, 0);
  claims.push({
    claim: CLAIMS[3], ok: smeared.ok && fbTiming.per_frame.length === 6 && new Set(fbTiming.per_frame).size > 1,
    evidence: `glow built from the '${"core"}' light ramp (3 steps) at each head position; smear_frame on f3 drew along the travel path (${beforeSmear.size}->${afterSmear.size} colour classes in that frame, region ${JSON.stringify(smeared.region)}); authored durations ${fbTiming.per_frame.join("/")}ms, cycle ${fbTiming.cycle_ms}ms at fps ${fbTiming.fps}; flame loop ${flTiming.per_frame.join("/")}ms cycle ${flTiming.cycle_ms}ms. Total fireball pixels across 6 frames: ${glowPixels}.`,
  });

  const tierClean = perFrame.every(f => f.auTier.errors === 0);
  const strictRules = {};
  for (const f of perFrame) for (const x of f.auStrict.findings) if (x.severity === "error") strictRules[x.rule] = (strictRules[x.rule] || 0) + 1;
  claims.push({
    claim: CLAIMS[4], ok: tierClean,
    evidence: `audit at declared tier '${TIER}': ${perFrame.map(f => `${fmt(f)}=${f.auTier.errors}err/${f.auTier.warns}warn`).join(", ")}. Exempted by the tier on this asset class: ${tierTable.exemptions[TIER].join(", ")}. What hero/support tier would say: ${Object.entries(strictRules).map(([r, n]) => `${r} x${n}`).join(", ") || "nothing"}.`,
  });

  const styleOk = perFrame.every(f => f.st.conforms);
  claims.push({
    claim: CLAIMS[5], ok: styleOk,
    evidence: perFrame.map(f => `${fmt(f)} features ${f.st.metrics.features}/${styleCore.FEATURE_BUDGET[STYLE.art_scale]} orphans ${f.st.metrics.components ?? "-"}`).join("; ") +
      `. assert_style violations across all frames: ${perFrame.flatMap(f => f.st.violations.map(v => v.rule)).join(", ") || "none"} (asset_class 'fx' is not in the engine's FUNCTIONAL_CLASSES, so no_negative_space does not apply to a form with no interior).`,
  });

  const presetStyle = (ctx.preexistingStyles || []).includes(STYLE.id);
  const presetPal = (ctx.preexistingPalettes || []).includes(PALETTE_ID);
  claims.push({
    claim: CLAIMS[6], ok: !presetStyle && !presetPal,
    evidence: `style '${STYLE.id}' present in art/styles before this gate: ${presetStyle}; palette '${PALETTE_ID}' present in art/palettes before this gate: ${presetPal}. All nine axes declared by hand (${Object.keys(STYLE).filter(k => k !== "id" && k !== "light_vector").map(k => `${k}=${STYLE[k]}`).join(", ")}); ramps authored as hex lists, not derived from a preset bible.`,
  });

  claims.push({
    claim: CLAIMS[7], ok: refusal.ok === false,
    evidence: `validateCoordinate({motion:'particle-procedural'}) -> ok=${refusal.ok}: ${ruleText(refusal) || "(accepted)"}. Body-written rules defeated by particles, measured on a control cel (a 12x12 mass with one 3px and one 2px detached cluster): audit errors by tier ${Object.entries(tierFindings).map(([t, v]) => `${t}=[${v.join(",")}]`).join(" ")}. 'detached_speck' is an error at EVERY tier because src/core/parts.js TIER_RULE_EXEMPTIONS does not list it; 'disconnected_mass' is exempted only at background/system. Fireball frames carry detached ember clusters: ${perFrame.filter(f => f.kind === "fireball").map(f => `${f.i}:${(f.auStrict.findings.find(x => x.rule === "disconnected_mass")?.count ?? 0)}`).join(" ")}.`,
  });

  claims.push({
    claim: CLAIMS[8], ok: renders.length >= 8 && [sheetView, sheetSil, flameSheet, gifFB, gifFL, playFB, playFL].every(r => r && r.image && fs.existsSync(r.image)),
    evidence: `renders: contact sheets ${sheetView.image}, ${sheetSil.image}, ${flameSheet.image}; grids ${gridFB.image}, ${gridFL.image}; GIFs ${gifFB.file} (${gifFB.bytes}B), ${gifFL.file} (${gifFL.bytes}B); play ${playFB.image} + ${playFB.per_facing.length} facing GIF(s) at fps ${playFB.fps}, ${playFL.image} at fps ${playFL.fps}; view/silhouette/value_map/squint on fireball travel-b and flame peak. export_gate: ${gate.ok ? "would allow export" : gate.summary}. Grid drift between runs: ${drift.length ? drift.join(",") : "none (byte-identical)"}.`,
  });

  // ---- 10. notes ----------------------------------------------------------------
  notes.push(`motion axis gap: docs/08 §4 row T7 names 'particle-procedural'; this engine's motion axis is ${styleCore.AXES.motion.join(" | ")} — the coordinate declares '${STYLE.motion}' and the refusal is proven as a control rather than renaming the row silently.`);
  notes.push(`body rules vs bodyless animation: disconnected_mass fires on every fireball frame because a comet's embers genuinely float; it is exempted by the declared '${TIER}' tier and reported. detached_speck (1-2px components) has NO tier exemption anywhere in parts.js, so a particle FX cannot use 1-2px motes at any tier — every ember authored here is >=3px to stay legal, which is a design decision forced by an audit rule written for limbs, not by taste. Engine finding.`);
  notes.push(`loop_validate is a body tool: with its defaults the travelling fireball reports ${JSON.stringify(fbGateBody.clips.right?.problems || [])} — anchorSpread ${fbGateBody.clips.right?.anchorSpread} and areaRatio ${fbGateBody.clips.right?.areaRatio} are exactly what travel and a flare ARE. Re-measured with FX tolerances (maxAnchorSpread 14, maxFootSpread 2, maxAreaRatio 0.6) it is ok=${fbGateFX.ok}: ${JSON.stringify(fbGateFX.info)}. The engine has no per-clip tolerance declaration; that is a gap, not a workaround.`);
  notes.push(`the ember line on row 23 of every fireball frame is what gives this FX a stable baseline (footSpread ${fbGateBody.clips.right?.footSpread}); without it the loop numbers would be meaningless rather than merely wide.`);
  notes.push(`craft_targets at art_scale 32 wants cluster_mean >=2.8 and value_range >=0.52: measured ${perFrame.filter(f => f.kind === "fireball").map(f => `${f.i}:${f.ct.measured.cluster_mean}/${f.ct.measured.value_range}`).join(" ")}. A light falloff built from isolated ramp steps is, by construction, a low cluster mean — the bar assumes contiguous masses.`);
  notes.push(`clip templates declare frame budgets (idle [2,4]) but nothing enforces them; the looping flame is authored at 6 frames to match the declared motion axis. Advisory budget, reported.`);

  const summary = [
    `T7 — ${STYLE.id} (${STYLE.projection}, art_scale ${STYLE.art_scale}, palette ${P.size}, ${STYLE.temperature}, edge ${STYLE.edge_policy}, ${STYLE.shading}, detail ${STYLE.detail}, motion ${STYLE.motion}, mood ${STYLE.mood}) tier '${TIER}'`,
    ...claims.map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.claim}\n      ${c.evidence}`),
    ...notes.map(n => `note  ${n}`),
    `artifacts  ${artifacts.join(", ")}`,
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "summary.txt"), summary + "\n");
  say(`summary written: ${path.join(OUT, "summary.txt")}`);
  return { claims, artifacts, notes };
}

module.exports = { id: "T7", title: "Spell FX: 6-frame fireball + looping flame (no body, palette-legal)", proves: "animation of something with no body at all, palette-legal", coordinate: STYLE, claims: CLAIMS, run };
