// Regression: golden renders and the export gate. docs/05 §2.
//
// The golden corpus is OUR OWN approved output, never a borrowed picture (docs/07 §5). That has
// an advantage a borrowed reference never had: it is regression-testable. A borrowed picture can
// only be looked at.
//
// Export is gated: a clip that fails loop_validate or assert_style cannot be exported. The gate
// is the point — it is what stops a long project from shipping its own drift.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { audit } = require("../audit.js");
const { assertStyle } = require("./style.js");
const { loopValidate } = require("./rig.js");
const { within } = require("./storage.js");
const { craftScore } = require("../craft.js");

const GOLDEN_DIR = (root) => within(root, "test", "golden");

function hash(buf) { return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16); }

/** Freeze a render as the bar. A golden is a decision that was looked at, not a file that happened to exist. */
function golden_capture(root, id, buffer, meta = {}) {
  const dir = GOLDEN_DIR(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = within(dir, `${id}.png`);
  fs.writeFileSync(file, buffer);
  const metaFile = within(dir, `${id}.json`);
  const record = { id, sha256: hash(buffer), bytes: buffer.length, captured: new Date().toISOString(), approved_by: meta.approved_by || "user", note: meta.note || "" };
  fs.writeFileSync(metaFile, JSON.stringify(record, null, 2));
  return record;
}

/**
 * regression_check: re-render and compare against the frozen golden. A diff is a reviewable
 * change, never a surprise. Palette amendments route through here.
 */
function regression_check(root, id, buffer, opts = {}) {
  const metaFile = within(GOLDEN_DIR(root), `${id}.json`);
  if (!fs.existsSync(metaFile)) return { ok: false, rule: "no_golden", message: `no golden captured for '${id}'; capture one before relying on it as a bar` };
  const golden = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const now = hash(buffer);
  if (now === golden.sha256) return { ok: true, id, unchanged: true, golden };
  const diffFile = within(GOLDEN_DIR(root), `${id}.diff.png`);
  fs.writeFileSync(diffFile, buffer);
  return { ok: false, id, rule: "golden_mismatch", golden, current: { sha256: now, bytes: buffer.length }, diff_file: diffFile,
    message: `'${id}' changed since it was approved (${golden.bytes} -> ${buffer.length} bytes). Review ${diffFile}, then re-capture if the change is intended.` };
}

/**
 * The export gate. A clip that fails loop_validate or assert_style does not ship.
 * Returns the reasons rather than exporting anyway, because a long project shipping its own
 * drift is the failure this whole engine exists to prevent.
 */
function export_gate(clips, style, palette, opts = {}) {
  const blocks = [];
  const warns = [];
  if (!Object.keys(clips).length) blocks.push({ clip: "none", direction: "none", rule: "no_clips", problems: ["No clips were supplied for validation"] });
  for (const [name, clip] of Object.entries(clips)) {
    for (const direction of clip.directions) {
      const frames = clip.frames(direction);
      if (!frames.length) { blocks.push({ clip: name, direction, rule: "missing_direction_frames", problems: ["Declared direction has no authored frames"] }); continue; }
      const lv = loopValidate(frames, { requireCounterSwing: clip.template === "walk" });
      if (!lv.ok) blocks.push({ clip: name, direction, rule: "loop_validate", problems: lv.problems });
      for (const f of frames) {
        const s = assertStyle(f.cel, style, palette, { assetClass: opts.assetClass || "character" });
        if (!s.ok) blocks.push({ clip: name, direction, frame: f.poseName, rule: "assert_style", violations: s.violations.map(v => v.rule) });
        const a = audit(f.cel, { palette, style, light: opts.light });
        if (!a.ok) blocks.push({ clip: name, direction, frame: f.poseName, rule: "audit", violations: a.findings.filter(x => x.severity === "error").map(x => x.rule) });
        if (f.duration === null) blocks.push({ clip: name, direction, frame: f.poseName, rule: "placeholder_timing", violations: ["duration not authored"] });
        const quarantined = f.cel.meta?.imported;
        if (quarantined && !opts.allow_imported) blocks.push({ clip: name, direction, frame: f.poseName, rule: "imported_pixels", violations: [`cel contains ${f.cel.meta.imported_pixels ?? 'imported'} imported pixels; pass allow_imported: true explicitly to ship them`] });
      }
      const fc = clip.frameCountReport();
      if (!fc.consistent) blocks.push({ rule: "frame_count_mismatch_across_directions", clip: name, direction, detail: fc.counts });
    }
  }
  return { ok: blocks.length === 0, blocks, warnings: warns, summary: blocks.length ? `EXPORT REFUSED: ${blocks.length} gate failure(s)` : "export gate passed" };
}

/** Craft targets expressed as numbers, so the bar is external and not circular (docs/10 §3 item 2). */
// Silhouette is measured as COMPACTNESS (perimeter / sqrt(area)), not perimeter/area.
// docs/09 and the Phase-2 post-mortem are explicit that perimeter-over-area is scale-dependent — a
// big solid mass looks "simple" only because it is big — which is why silhouetteComplexity was
// rewritten as a scale-free band. The old `silhouette_ratio_min: 1.2` asked for a perimeter 1.2x
// the area of an 8px sprite: mathematically reachable only by a checkerboard, so every small asset
// failed a target that could not be drawn. Both numbers are reported; the bar uses the one that is
// not scale-dependent, with the engine's own documented band edges (4.4 = lump, 9.5 = confetti).
const SILHOUETTE_LUMP = 4.4;      // src/craft.js silhouetteComplexity: below this the shape is a lump
const SILHOUETTE_CONFETTI = 9.5;  // ...and above this it is fragmentation that breaks at game scale
const CRAFT_TARGETS = {
  8:   { colours_max: 4,  ramp_steps_min: 2, cluster_mean_min: 1.6, value_range_min: 0.30 },
  16:  { colours_max: 16, ramp_steps_min: 3, cluster_mean_min: 2.2, value_range_min: 0.42 },
  24:  { colours_max: 20, ramp_steps_min: 4, cluster_mean_min: 2.6, value_range_min: 0.48 },
  32:  { colours_max: 26, ramp_steps_min: 4, cluster_mean_min: 2.8, value_range_min: 0.52 },
  48:  { colours_max: 32, ramp_steps_min: 5, cluster_mean_min: 3.0, value_range_min: 0.55 },
  64:  { colours_max: 40, ramp_steps_min: 6, cluster_mean_min: 3.2, value_range_min: 0.58 },
  96:  { colours_max: 48, ramp_steps_min: 6, cluster_mean_min: 3.4, value_range_min: 0.60 },
  128: { colours_max: 64, ramp_steps_min: 6, cluster_mean_min: 3.6, value_range_min: 0.62 },
};

/**
 * craft_targets: the external bar. Derived from published technique doctrine, expressed as
 * numbers, and measured against our own output. Our own golden corpus can only ever be as good
 * as our own standard; these numbers are not.
 */
function craft_targets(cel, palette, style) {
  const t = CRAFT_TARGETS[style.art_scale] || CRAFT_TARGETS[32];
  const c = craftScore(cel, palette, { light: style.light });
  const bb = cel.bbox();
  // Ramp steps per material. A cel drawn entirely from `single` (ramp-less) palette entries has no
  // materials to measure across, and Math.max() of an empty list is -Infinity — which failed every
  // such asset against `ramp_steps_min` for the wrong reason. What that target asks is "how many
  // value steps does this asset actually use", so when there are no ramps, count the distinct
  // values used instead and say which route measured it.
  const rampCounts = [...new Set([...cel.counts().keys()].map(i => palette.entries[i]?.ramp).filter(Boolean))]
    .map(r => palette.ramp(r).filter(x => cel.counts().has(x)).length);
  const measured = {
    colours: cel.counts().size,
    ramp_steps_used: rampCounts.length ? Math.max(...rampCounts) : cel.counts().size,
    ramp_steps_measured_by: rampCounts.length ? "material ramps" : "distinct values used (no ramps in this palette)",
    cluster_mean: require("../craft.js").clusterStats(cel, palette).mean,
    silhouette_compactness: require("../craft.js").silhouetteComplexity(cel).compactness,
    silhouette_ratio: require("../craft.js").silhouetteComplexity(cel).ratio,
    silhouette_score: require("../craft.js").silhouetteComplexity(cel).score,
    value_range: require("../craft.js").valueStructure(cel, palette).range,
  };
  const misses = [];
  if (measured.colours > t.colours_max) misses.push({ target: "colours_max", want: t.colours_max, got: measured.colours });
  if (measured.ramp_steps_used < t.ramp_steps_min) misses.push({ target: "ramp_steps_min", want: t.ramp_steps_min, got: measured.ramp_steps_used });
  if (measured.cluster_mean < t.cluster_mean_min) misses.push({ target: "cluster_mean_min", want: t.cluster_mean_min, got: measured.cluster_mean });
  if (measured.silhouette_compactness < SILHOUETTE_LUMP) misses.push({ target: "silhouette_compactness_min", want: SILHOUETTE_LUMP, got: measured.silhouette_compactness, message: "below 4.4 the silhouette is a lump (src/craft.js)" });
  if (measured.silhouette_compactness > SILHOUETTE_CONFETTI) misses.push({ target: "silhouette_compactness_max", want: SILHOUETTE_CONFETTI, got: measured.silhouette_compactness, message: "above 9.5 the silhouette is fragmentation that breaks apart at game scale (src/craft.js)" });
  if (measured.value_range < t.value_range_min) misses.push({ target: "value_range_min", want: t.value_range_min, got: measured.value_range });
  return { ok: misses.length === 0, scale: style.art_scale, target: t, measured, misses, craft: c.score, grade: c.grade, area: bb?.area ?? 0 };
}

function static_gate(cels, style, palette, opts = {}) {
  const blocks = [];
  if (!cels.length) blocks.push({ rule: "no_cels", message: "No static cels supplied" });
  for (const cel of cels) {
    if (cel.paletteId !== palette.id) blocks.push({ cel:cel.name, rule:"palette_mismatch", message:"A sheet must use one declared palette" });
    const checked = audit(cel, { palette, style });
    const conformance = assertStyle(cel, style, palette, { assetClass:opts.assetClass || "object" });
    if (!checked.ok) blocks.push({ cel:cel.name, rule:"audit", violations:checked.findings.filter(f=>f.severity==="error").map(f=>f.rule) });
    if (!conformance.ok) blocks.push({ cel:cel.name, rule:"assert_style", violations:conformance.violations });
    if (cel.meta?.imported && !opts.allow_imported) blocks.push({ cel:cel.name,rule:"imported_pixels" });
  }
  return {ok:blocks.length===0,blocks,warnings:[],summary:blocks.length?`EXPORT REFUSED: ${blocks.length} gate failure(s)`:"static export gate passed"};
}
module.exports = { golden_capture, regression_check, export_gate, static_gate, craft_targets, CRAFT_TARGETS, hash };
