// PHASE 4 GATE - ten members of one weapon family under one declared coordinate, measured against the
// Phase-2 claims plus the silhouette metrics added to src/core/parts.js for this phase. Run: npm run gate4
//
// The coordinate lives in bench/data/style-arsenal.js and the members in bench/data/weapons/. Each member is
// authored as dimensions (see bench/data/arsenal.js for why a machined family is written that way), expanded
// into an explicit grid, lit by the shared authoring model in src/author.js, then handed to the engine's own
// audits. Nothing here trusts my eye alone: every claim below is a number the engine produced.
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS: T, W } = require("../src/tools.js");               // the engine's tool registry and its warm state
const A = require("./data/arsenal.js");                     // this family's design language
const { authorAsset } = require("../src/author.js");        // the lighting model shared with Phases 5-8
const parts = require("../src/core/parts.js");              // silhouette measurement, added for this phase
const { STYLE, PALETTE_SPEC } = require("./data/style-arsenal.js");

const ROOT = path.join(__dirname, "..", "out", "gate4");
const LIGHT = STYLE.light_vector;

const LINES = [];
const say = (s = "") => { LINES.push(s); console.log(s); };
for (const d of [ROOT, path.join(ROOT, "art"), path.join(ROOT, "contact")]) fs.mkdirSync(d, { recursive: true });

const init = T.project_init.run({ root: ROOT, game: "arsenal", style: STYLE, canvas: { w: 32, h: 32 }, fps: 8 });
const pal = T.palette_set.run({ id: "arsenal", spec: PALETTE_SPEC });
say("PHASE 4 GATE — ten members of one weapon family\n");
say(`  coordinate '${STYLE.id}' projection ${STYLE.projection} art_scale ${STYLE.art_scale}px palette cap ${STYLE.palette_size} (${pal.size || 0} mixed)`);
say(`  light vector [${LIGHT.join(", ")}] edge policy ${STYLE.edge_policy} shape family framed_mechanical\n`);

// ---- rasterising an authored member ----------------------------------------------------
// Blocks are painted in the order declared, so overlap means what I ordered it to mean: a sleeve drawn after a
// shaft covers that stretch of shaft. Chamfers then remove the corner cells the family rule asks for, and studs
// go last because a fastener is never chamfered away by the mass it fastens.
// Every material name in this family starts with a different letter, which is what makes the grid readable:
// i iron, g gunmetal, l leather, e ember, + the focal accent. A human can edit these grids in any editor.
const letterOf = (m) => m[0];

function raster(spec) {
  const g = Array.from({ length: A.CH }, () => Array(A.CW).fill("."));
  for (const b of spec.blocks) {
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      if (b.y + j >= 0 && b.y + j < A.CH && b.x + i >= 0 && b.x + i < A.CW) g[b.y + j][b.x + i] = letterOf(b.m);
    }
  }
  const owner = new Map();
  spec.blocks.forEach((b, n) => { for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) owner.set(`${b.x + i},${b.y + j}`, n); });
  const drop = new Set();
  spec.blocks.forEach((b, n) => { if (b.sq) return; for (const c of A.chamfers(b.x, b.y, b.w, b.h)) if (owner.get(`${c.x},${c.y}`) === n) drop.add(`${c.x},${c.y}`); });
  const named = new Set((spec.cuts || []).map((c) => `${c.x},${c.y}`));      // bevels I placed by hand
  const base = new Set();
  for (let y = 0; y < A.CH; y++) for (let x = 0; x < A.CW; x++) {
    if (g[y][x] === "." || named.has(`${x},${y}`)) continue;
    base.add(`${x},${y}`);
  }
  const whole = components(base);
  // A chamfer survives only if the member still reads as one continuous piece afterwards. A cut that would
  // break a member apart is refused and counted, not dropped in silence.
  const kept = new Set(); const refusedCuts = [];
  for (const key of [...drop].sort()) {
    const trial = new Set(base); for (const k of kept) trial.delete(k); trial.delete(key);
    if (components(trial) !== whole) { refusedCuts.push(key); continue; }
    kept.add(key);
  }
  for (const key of kept) { const [x, y] = key.split(",").map(Number); g[y][x] = "."; }
  for (const key of named) { const [x, y] = key.split(",").map(Number); g[y][x] = "."; }
  for (const s of spec.studs || []) if (g[s.y][s.x] !== ".") g[s.y][s.x] = "+";   // a fastener is never bevelled away
  return { rows: g.map((r) => r.join("")), chamfers: kept.size, refused: refusedCuts };
}

/** Count separate masses in a cell set. Used to refuse any cut that would break a member apart. */
function components(cells) {
  const left = new Set(cells); let n = 0;
  while (left.size) {
    n++; const start = left.values().next().value; left.delete(start);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.pop().split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (left.has(k)) { left.delete(k); queue.push(k); }
      }
    }
  }
  return n;
}

// ---- run every member through authoring, measurement and audit -------------------------
const HERE = path.join(__dirname, "data", "weapons");
const ART = path.join(__dirname, "..", "art", "weapons");
fs.mkdirSync(ART, { recursive: true });
const SPECS = fs.readdirSync(HERE).filter((f) => f.endsWith(".js")).sort();
const made = []; const drift = []; let refusedTotal = 0;
// While a member is still being designed its grid legitimately changes. --rebase re-commits the drawing and
// says so; without the flag a changed grid is reported as drift, because hand-edited art must not be silently
// overwritten by a rerun.
const REBASE = process.argv.includes("--rebase"); const regenerated = [];
const MAP = { i: "iron", g: "gunmetal", l: "leather", e: "ember" };         // the letters a member is drawn with

for (const file of SPECS) {
  const spec = require(path.join(HERE, file));
  const drawn = raster(spec);                                       // dimensions -> cells, chamfers kept or refused
  refusedTotal += drawn.refused.length;
  const authored = authorAsset(drawn.rows, {
    palette: W.palette("arsenal"), paletteId: "arsenal", name: `${spec.id}/base`, defaultMaterial: "iron",
    map: MAP, light: LIGHT, accentColor: "brass.2", outline: { color: "outline" }, soleColor: "contact", protected: [],
  });
  const gridText = authored.cel.toGrid();                                   // the committed form of the drawing
  const gridPath = path.join(ART, `${spec.id}.grid`);
  fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "preview", `${spec.id}.txt`), drawn.rows.join("\n") + "\n");   // material letters, for design review

  // The committed grid is the asset. If a freshly authored member no longer matches it, that is drift, and it
  // is reported rather than overwritten: art gets edited by hand on purpose, and the gate must notice.
  if (fs.existsSync(gridPath)) {
    const held = fs.readFileSync(gridPath, "utf8");
    if (held !== gridText) { if (REBASE) { fs.writeFileSync(gridPath, gridText); regenerated.push(spec.id); } else drift.push(spec.id); }
  } else fs.writeFileSync(gridPath, gridText);
  T.sprite_create.run({ id: spec.id, w: A.CW, h: A.CH, style: STYLE.id, palette: "arsenal", tier: "support", asset_class: "object" });
  const held = fs.existsSync(gridPath) ? fs.readFileSync(gridPath, "utf8") : gridText;      // measure what is on disk
  T.cel_from_grid.run({ cel: `${spec.id}/base`, grid: held, palette: "arsenal" });

  const grip = gripOf(drawn.rows);                                    // the hand end of this member, from its wrap
  const corners = parts.cornerTreatment(authored.cel);
  const mass = parts.massDistribution(authored.cel, { grip });
  const straight = parts.straightRunShare(authored.cel);
  const st = T.assert_style.run({ cel: `${spec.id}/base` });
  const au = T.audit.run({ cel: `${spec.id}/base`, tier: "support", light: LIGHT });
  const cm = T.craft_metrics.run({ cel: `${spec.id}/base`, light: LIGHT });
  const rec = { name: spec.id, key: `${spec.id}/base`, spec, grip, corners, massKind: mass.kind, ratio: mass.ratio, straight };
  Object.assign(rec, { style_ok: st.ok !== false, audit_ok: au.ok === true, craft: cm.score, grade: cm.grade,
    negspace: cm.negative_space, features: cm.features, weakest: cm.weakest, sub: cm.sub, findings: au.findings || [] });
  made.push(rec);

  say(`  ${rec.name.padEnd(15)} corners h${corners.hard}/c${corners.chamfered}/r${corners.rounded} -> ${corners.dominant}` +
    ` | mass ${rec.massKind} ${rec.ratio} | straight ${rec.straight.toFixed(2)} | craft ${rec.craft} ${rec.grade}` +
    ` | air ${cm.negative_space.enclosed}px/${Math.round(cm.negative_space.enclosedRatio * 100)}% | chamfers kept ${drawn.chamfers}/${drawn.refused.length} refused`);
  say(`     weakest subs: ${Object.entries(rec.sub || {}).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const f of rec.findings.slice(0, 4)) say(`     [${f.severity}] ${f.rule}${f.at && f.at.length ? " at " + f.at.join(" ") : ""}: ${String(f.message).slice(0, 96)}`);
}

/** The hand end of a member, read off its own wrap instead of assumed from the canvas centre. */
function gripOf(rows) {
  let x0 = 99, x1 = -1, y1 = -1;
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "l") { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
  return x1 < 0 ? null : [Math.round((x0 + x1) / 2), y1];
}

const seenFeat = new Map(); made.forEach((mm) => { const k = (mm.spec.rule_broken || "nothing declared").toLowerCase(); seenFeat.set(k, (seenFeat.get(k) || 0) + 1); });
const dup = [...seenFeat].filter(([k, n]) => n > 1).map(([k, n]) => `${k} claimed by ${n} members`);
// ---- the family claim -----------------------------------------------------------------
const fam = T.family_audit.run({ family: "framed_mechanical", assets: made.map((m) => ({ name: m.name, cel: m.key, exaggerated_feature: m.spec.rule_broken, grip: m.grip })) });
say(`\n  FAMILY 'framed_mechanical' over ${made.length} members -> ${fam.ok ? "reads as one family" : "does NOT read as one family"}`);
for (const p of fam.problems || []) say(`     problem ${p.rule}: ${p.message}`);
for (const r of fam.report || []) {
  const fit = Object.entries(r.family_fit).map(([k, v]) => `${k}${v ? "=" : "!"}`).join(" ");
  say(`     ${(r.name || "?").padEnd(16)} corners=${r.corners.dominant} mass=${r.mass} straight=${r.straight_run_share.toFixed(2)} bbox=${(r.bbox || []).join("x")} [${fit}] exaggerates: ${r.declared_exaggeration || "nothing declared"}`);
}

// ---- the review surfaces ---------------------------------------------------------------
const keys = made.map((m) => m.key); const sheets = [];
for (const mode of ["view", "squint", "silhouette", "value_map"]) {
  const s = T.contact_sheet.run({ cels: keys, palette: "arsenal", mode, zoom: 3, name: `arsenal-${mode}` });
  if (s && s.image) sheets.push(`${mode.padEnd(10)} ${s.image} (${s.frames} frames)`);
}
if (sheets.length) { say(`\n  REVIEW SURFACES (${sheets.length} contact sheets over ${keys.length} members)`); for (const s of sheets) say(`     ${s}`); } else say("\n  REVIEW SURFACES: none authored yet");

// ---- the gate claims -------------------------------------------------------------------
const cleanStyle = made.filter((m) => m.style_ok).length; const cleanAudit = made.filter((m) => m.audit_ok).length;
const chamferDominant = fam.report ? fam.report.filter((r) => r.corners.dominant === "chamfered").length : 0;
const CLAIMS = []; const claim = (what, ok, measured) => CLAIMS.push({ what, measured: String(measured), ok: !!ok });
const fitAll = fam.report ? fam.report.filter((r) => Object.values(r.family_fit).every(Boolean)).length : 0;
const aboveBar = made.filter((m) => m.grade === "hero" || m.grade === "support").length;
claim("ten members authored", made.length === 10, `${made.length} of 10`);
claim("every member passes assert_style (negative space + feature budget)", cleanStyle === made.length && made.length > 0, `${cleanStyle}/${made.length}`);
claim("every member is audit-clean at its tier", cleanAudit === made.length && made.length > 0, `${cleanAudit}/${made.length}`);
claim("every member fits all three measured family classes", fitAll === made.length && made.length > 0, `${fitAll}/${made.length} corner+mass+taper`);
claim("no two members exaggerate the same feature", dup.length === 0, dup.length ? dup.join(", ") : `${made.length} distinct features`);
claim("one contact sheet per review mode", sheets.length === 4 && keys.length > 0, `${sheets.length}/4 modes over ${keys.length} members`);
claim("committed grids match what the engine re-authors (no silent drift)", drift.length === 0, drift.length ? `drift: ${drift.join(", ")}` : "identical");

say(`\n  GATE 4 CLAIMS (${STYLE.id}, framed_mechanical)`); let failed = 0;
for (const c of CLAIMS) { if (!c.ok) failed++; say(`     ${c.ok ? "PASS" : "FAIL"}  ${c.what.padEnd(62)} ${c.measured}`); }

const verdict = failed ? `${failed} claim(s) FAILED` : `all ${CLAIMS.length} claims PASSED`;
say(`\n  GATE 4: ${verdict} | grid drift ${drift.length} | grids regenerated this run ${regenerated.length}${REBASE ? " (--rebase was passed)" : ""} | chamfers refused for breaking continuity: ${refusedTotal}`);
fs.writeFileSync(path.join(ROOT, "..", "gate4-report.txt"), LINES.join("\n") + "\n");
process.exitCode = failed ? 1 : 0;
