// Volume: the part library, the material library, family templates, tiered quality budgets,
// and batch re-lint. docs/09 §4.
//
// Craft is worthless if the engine can only make ten sprites. What makes 40 NPCs tractable is
// authored, reusable body parts with per-part cel linking so a fix propagates — the modularity
// TECHNIQUE is public method; the parts themselves are authored in this repo (docs/07).
"use strict";

const { Cel } = require("./cel.js");
const { audit } = require("../audit.js");
const { assertStyle } = require("./style.js");
const { craftScore } = require("../craft.js");

/**
 * Quality tiers (docs/09 §3.7). Not every asset deserves the same effort, and pretending
 * otherwise is how projects die of over-polishing. Common props need less iteration than
 * signature characters: that is a production decision, and the engine encodes it instead of
 * pretending every sprite needs the same effort.
 */
const TIERS = {
  hero:       { renders: [6, 12], design_passes: 3, audit: "full", human_review: "required", iteration_budget: "6-12 renders, 3+ design passes" },
  support:    { renders: [3, 6],  design_passes: 1, audit: "full", human_review: "spot-check", iteration_budget: "3-6 renders" },
  background: { renders: [1, 3],  design_passes: 0, audit: "structure+palette", human_review: "none", iteration_budget: "1-3 renders" },
  system:     { renders: [1, 2],  design_passes: 0, audit: "squint only", human_review: "none", iteration_budget: "1-2 renders" },
};

function tier_policy(tier) { return TIERS[tier] || TIERS.support; }

/** Which audit rules a tier is allowed to skip. Background-tier assets are not hero assets. */
const TIER_RULE_EXEMPTIONS = {
  hero: [],
  support: [],
  background: ["no_focal_accent", "parts_fuse", "cluster_character", "light_direction", "disconnected_mass"],
  system: ["no_focal_accent", "parts_fuse", "cluster_character", "light_direction", "flat_mass", "value_structure", "no_contact_ground", "blob_silhouette", "outline_discipline", "disconnected_mass"],
};

function audit_for_tier(cel, palette, style, tier, ctx = {}) {
  const a = audit(cel, { palette, style, ...ctx });
  const exempt = new Set(TIER_RULE_EXEMPTIONS[tier] || []);
  const kept = a.findings.filter(f => !exempt.has(f.rule));
  const errors = kept.filter(f => f.severity === "error").length;
  return { ...a, findings: kept, errors, warns: kept.filter(f => f.severity === "warn").length, ok: errors === 0, tier, exempted: a.findings.length - kept.length };
}

// ---- material library ---------------------------------------------------------

/**
 * The material library is the main engine of coherence: one authored ramp recipe per material,
 * shared by every asset that names that material. Per-asset palettes are how a game stops
 * looking like one place.
 */
class MaterialLibrary {
  constructor() { this.materials = new Map(); }
  define(id, recipe) { this.materials.set(id, { id, ...recipe }); return this; }
  get(id) { return this.materials.get(id) || null; }
  ids() { return [...this.materials.keys()]; }
  /** Ramp spec for a palette builder: { role: "material", colors: [...] } */
  toRampSpec() {
    const out = {};
    for (const [id, m] of this.materials) out[id] = { role: m.role || "material", colors: m.colors, relight: m.relight, hue_shift: m.hue_shift };
    return out;
  }
}

// ---- part library -------------------------------------------------------------

/**
 * A part is an authored cel plus the joint it hangs from and the slots it fits.
 * { id, slot, cel, anchorJoint, anchorOffset, tags }
 *
 * Slots are what make assembly legal: a head fits a neck slot, and an assembly that puts a
 * boot in a hair slot is refused rather than composed into nonsense.
 */
const SLOTS = ["head", "hair", "torso", "arm_near", "arm_far", "leg_near", "leg_far", "foot_near", "foot_far", "held", "accessory"];

class PartLibrary {
  constructor() { this.parts = new Map(); }
  add(part) {
    if (!SLOTS.includes(part.slot)) throw new Error(`part '${part.id}' has slot '${part.slot}'; legal slots: ${SLOTS.join(", ")}`);
    if (!(part.cel instanceof Cel)) throw new Error(`part '${part.id}' needs a Cel`);
    this.parts.set(part.id, { ...part, uses: 0 });
    return this;
  }
  get(id) { return this.parts.get(id) || null; }
  inSlot(slot) { return [...this.parts.values()].filter(p => p.slot === slot); }
  size() { return this.parts.size; }
  /** Cost accounting: authored pixels vs composed pixels. This is the number that must fall. */
  authoredPixels() { return [...this.parts.values()].reduce((s, p) => s + (p.cel.bbox()?.area ?? 0), 0); }
}

/**
 * assemble: build a character from parts. Returns the rig-shaped skin description the composer
 * needs, plus the cost record — authored parts reused, new pixels added.
 */
function assemble(library, recipe, opts = {}) {
  const chosen = {};
  const problems = [];
  for (const [slot, partId] of Object.entries(recipe.parts)) {
    if (!SLOTS.includes(slot)) { problems.push(`slot '${slot}' is not a legal slot`); continue; }
    const part = library.get(partId);
    if (!part) { problems.push(`part '${partId}' is not in the library`); continue; }
    if (part.slot !== slot) { problems.push(`part '${partId}' is a '${part.slot}' part being put in the '${slot}' slot`); continue; }
    part.uses++;
    chosen[slot] = part;
  }
  const required = ["torso", "leg_near", "leg_far"];
  for (const r of required) if (!chosen[r]) problems.push(`assembly has no '${r}'`);
  if (problems.length) return { ok: false, problems, changed: { pixels: 0 }, violations: problems.map(p => ({ rule: "assembly_invalid", message: p })), warnings: [] };

  const w = opts.w ?? 20, h = opts.h ?? 32;
  const cel = new Cel(w, h, opts.paletteId || chosen.torso.cel.paletteId, opts.name || recipe.id);
  const order = opts.zOrder || ["leg_far", "leg_near", "arm_far", "torso", "head", "hair", "arm_near", "held"];
  const collisions = [];
  for (const slot of order) {
    const part = chosen[slot];
    if (!part) continue;
    const at = opts.anchors?.[slot] || part.anchor || [Math.floor(w / 2) - Math.floor(part.cel.w / 2), h - part.cel.h];
    const off = part.anchorOffset || [0, 0];
    for (let y = 0; y < part.cel.h; y++) for (let x = 0; x < part.cel.w; x++) {
      const v = part.cel.get(x, y);
      if (v < 0) continue;
      const px = at[0] + off[0] + x, py = at[1] + off[1] + y;
      if (!cel.inBounds(px, py)) continue;
      const prev = cel.get(px, py);
      if (prev >= 0 && prev !== v) collisions.push({ x: px, y: py, over: prev, to: v, slot });
      cel.set(px, py, v);
    }
  }
  const bb = cel.bbox();
  return {
    ok: true, cel, collisions: collisions.slice(0, 20),
    changed: { pixels: bb?.area ?? 0, added: bb?.area ?? 0, removed: 0, repainted: 0 },
    region: bb, violations: [], warnings: collisions.length ? [`${collisions.length} part boundary collision(s); those pixels are where two parts fight for the same cell`] : [],
    cost: { parts_reused: Object.keys(chosen).length, new_pixels_authored: 0, composed_pixels: bb?.area ?? 0, library_parts_total: library.size() },
  };
}

// ---- family templates ---------------------------------------------------------

/**
 * A weapon family shares corner treatment, mass distribution and accent placement; individual
 * members differ in their exaggerated feature. This is the measurable half of "reads as one world".
 */
const SHAPE_FAMILIES = {
  blunt_weighted: { corner: "rounded", terminal: "flat", taper: "toward the grip", mass_distribution: "distal", note: "heavy things: blunt ends, mass away from the hand" },
  sharp_tapered:  { corner: "hard", terminal: "point", taper: "toward the tip", mass_distribution: "proximal", note: "cutting things: mass near the hand, a single point" },
  framed_mechanical: { corner: "chamfered", terminal: "squared", taper: "none", mass_distribution: "even", note: "mechanisms: straight runs, right angles, exposed structure" },
  organic_tapered: { corner: "rounded", terminal: "tapered", taper: "toward the end", mass_distribution: "proximal", note: "grown things: no straight runs at all" },
};

function family_audit(cels, family, opts = {}) {
  const spec = SHAPE_FAMILIES[family];
  if (!spec) return { ok: false, reason: `unknown shape family '${family}'` };
  const report = cels.map(c => {
    const bb = c.cel.bbox();
    const straightness = straightRunShare(c.cel);
    const corners = cornerTreatment(c.cel);
    const mass = massDistribution(c.cel, { grip: c.grip });
    return {
      name: c.name, declared_exaggeration: c.exaggerated_feature, bbox: bb ? [bb.w, bb.h] : null,
      straight_run_share: straightness, corners, mass: mass.kind, mass_ratio: mass.ratio,
      family_fit: {
        corner: spec.corner === corners.dominant,
        mass: spec.mass_distribution === mass.kind,
        taper: spec.taper === "none" ? straightness > 0.5 : straightness < 0.75,
      },
    };
  });
  const offFamily = report.filter(r => !Object.values(r.family_fit).every(Boolean));
  const dupFeature = new Map();
  for (const r of report) if (r.declared_exaggeration) dupFeature.set(r.declared_exaggeration, (dupFeature.get(r.declared_exaggeration) || 0) + 1);
  const repeated = [...dupFeature.entries()].filter(([, n]) => n > 1);
  return {
    ok: offFamily.length === 0 && repeated.length === 0,
    family: spec, report,
    problems: [
      ...offFamily.map(r => ({ rule: "shape_family_violation", asset: r.name, fit: r.family_fit, message: `'${r.name}' does not fit the '${family}' family: corner=${r.corners.dominant} (want ${spec.corner}), mass=${r.mass} (want ${spec.mass_distribution})` })),
      ...repeated.map(([f, n]) => ({ rule: "duplicate_exaggeration", feature: f, count: n, message: `${n} assets exaggerate '${f}'; a family where every member exaggerates the same feature has no members` })),
    ],
  };
}

function straightRunShare(cel) {
  let horiz = 0, vert = 0, diag = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    if (cel.get(x, y) < 0) continue;
    if (cel.get(x + 1, y) >= 0) horiz++;
    if (cel.get(x, y + 1) >= 0) vert++;
    if (cel.get(x + 1, y + 1) >= 0 || cel.get(x - 1, y + 1) >= 0) diag++;
  }
  const total = horiz + vert + diag || 1;
  return +((horiz + vert) / total).toFixed(3);
}

/**
 * Corner treatment, measured as three classes.
 *
 * The original version returned only 'rounded' or 'hard', which made the 'chamfered' class of
 * framed_mechanical unreachable by definition — a family field no asset could ever satisfy is a broken
 * family definition, not a failing asset. Found while declaring the Phase 4 weapon family: the engine
 * asked for machined corners and could only ever report rounded ones.
 *
 *   hard       an air cell wrapped on two orthogonal sides by material with the connecting diagonal
 *              empty: a right-angle inner corner, i.e. a butted joint
 *   chamfered  one cell cut off the end of a straight run: a bevel, which is what machined things do
 *              at their corners when they are not grown
 *   rounded    a staircase of diagonal-only steps three cells or longer: curvature or anti-aliasing
 */
function cornerTreatment(cel) {
  let hard = 0, rounded = 0, chamfered = 0;
  const solid = (x, y) => cel.get(x, y) >= 0;
  for (let y = 1; y < cel.h - 1; y++) for (let x = 1; x < cel.w - 1; x++) {
    if (solid(x, y)) continue;
    const a = solid(x - 1, y), b = solid(x + 1, y), c = solid(x, y - 1), d = solid(x, y + 1);
    const e = solid(x - 1, y - 1), f = solid(x + 1, y - 1), g = solid(x - 1, y + 1), h = solid(x + 1, y + 1);
    if ((a && c && !e) || (a && d && !g) || (b && c && !f) || (b && d && !h)) hard++;
  }
  // Bevels: air diagonally beside the end of a straight run. The diagonal material must continue along
  // an axis two cells away — that is what separates a chamfer from a stray anti-alias pixel.
  const continuesRun = (x, y) => solid(x - 2, y) || solid(x + 2, y) || solid(x, y - 2) || solid(x, y + 2);
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    if (solid(x, y)) continue;
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!solid(nx, ny)) continue;
      if (solid(nx, y) || solid(x, ny)) continue;                 // an edge pixel, not a cut corner
      if (!continuesRun(nx, ny)) continue;                        // nothing is being bevelled
      chamfered++;
    }
  }
  // Curvature: maximal staircase runs where every step is diagonal-only.
  for (const [ax, ay] of [[1, 1], [-1, 1]]) {
    const consumed = new Set();
    for (let i = 0; i < cel.w * cel.h; i++) {
      const x0 = i % cel.w, y0 = Math.floor(i / cel.w);
      if (!solid(x0, y0) || consumed.has(`${x0},${y0}`)) continue;
      let len = 1, x = x0, y = y0;
      while (true) {
        const qx = x + ax, qy = y + ay;
        if (!cel.inBounds(qx, qy) || !solid(qx, qy)) break;
        if (solid(qx, y) || solid(x, qy)) break;                  // the two rows are joined: a band, not a staircase
        consumed.add(`${qx},${qy}`); len++; x = qx; y = qy;
      }
      if (len >= 3) rounded += len - 2;
    }
  }
  const counts = { hard, chamfered, rounded };
  let dominant = "none";
  // Ties resolve toward the stronger claim: a right angle is harder to fake than a bevel.
  for (const k of ["hard", "chamfered", "rounded"]) if (counts[k] > (counts[dominant] ?? -1)) dominant = k;
  return { ...counts, events: hard + chamfered + rounded, dominant };
}

/**
 * Mass distribution measured from the asset's GRIP, not from its bounding-box centre.
 *
 * The original test counted pixels inside a disc of radius max(w,h)/4 around the bbox centre. For an
 * asset that fills its canvas that disc holds roughly a fifth of the area, so every asset in existence
 * classified as 'distal' and both 'proximal' and 'even' were unreachable — which made three of the four
 * shape families unconfirmable. docs/09 defines mass relative to THE HAND ("mass away from the hand"),
 * so the hand is now declared: bottom-centre by default, or the asset's own hip anchor for rigged work.
 */
function massDistribution(cel, opts = {}) {
  const bb = cel.bbox();
  if (!bb) return { kind: "none", near: 0, far: 0, ratio: null, grip: null };
  const grip = opts.grip || [Math.round((bb.x0 + bb.x1) / 2), bb.y1];
  let sumX = 0, sumY = 0, n = 0;
  cel.forEach((v, x, y) => { if (v >= 0) { sumX += x; sumY += y; n++; } });
  if (!n) return { kind: "none", near: 0, far: 0, ratio: null, grip };
  // The working axis runs from the grip toward the centroid of the drawn mass.
  let ax = sumX / n - grip[0], ay = sumY / n - grip[1];
  const mag = Math.hypot(ax, ay);
  if (mag < 1e-6) return { kind: "even", near: n, far: 0, ratio: Infinity, grip };
  ax /= mag; ay /= mag;
  let lo = Infinity, hi = -Infinity;
  const proj = [];
  cel.forEach((v, x, y) => {
    if (v < 0) return;
    const t = (x - grip[0]) * ax + (y - grip[1]) * ay;
    proj.push(t); if (t < lo) lo = t; if (t > hi) hi = t;
  });
  const mid = (lo + hi) / 2;
  const near = proj.filter(t => t <= mid).length;
  const far = proj.length - near;
  const ratio = far ? +(near / far).toFixed(3) : Infinity;
  const kind = ratio >= 1.25 ? "proximal" : ratio <= 0.8 ? "distal" : "even";
  return { kind, near, far, ratio, grip };
}

// ---- batch re-lint ------------------------------------------------------------

/**
 * Changing a material re-runs every asset through assert_style and reports which ones drifted.
 * This is the defence against the slow style drift that ruins long generated projects.
 */
function batch_relint(assets, palette, style, opts = {}) {
  const out = [];
  for (const a of assets) {
    const s = assertStyle(a.cel, style, palette, { assetClass: a.asset_class || "object" });
    const au = audit_for_tier(a.cel, palette, style, a.tier || "support", { light: opts.light });
    const c = craftScore(a.cel, palette, { light: opts.light });
    out.push({ name: a.name, tier: a.tier || "support", style_ok: s.ok, audit_ok: au.ok, errors: au.errors, craft: c.score, grade: c.grade, violations: s.violations.map(v => v.rule), weakest: c.weakest });
  }
  const drifted = out.filter(o => !o.style_ok || !o.audit_ok);
  return { ok: drifted.length === 0, total: out.length, drifted: drifted.length, report: out, summary: `${out.length - drifted.length}/${out.length} assets conform; ${drifted.length} drifted` };
}

module.exports = { TIERS, tier_policy, TIER_RULE_EXEMPTIONS, audit_for_tier, MaterialLibrary, SLOTS, PartLibrary, assemble, SHAPE_FAMILIES, family_audit, batch_relint, straightRunShare, cornerTreatment, massDistribution };
