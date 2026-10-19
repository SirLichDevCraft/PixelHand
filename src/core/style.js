// Style is a COORDINATE in a nine-axis space, not a preset filter.
// The engine refuses impossible coordinates at declaration rather than letting
// 300 cels be drawn into a contradiction.
"use strict";

const AXES = {
  // Perspective is on the axis because depth is a design decision made before the first pixel, not
  // a post-process. It carries a cost: a projected structure spends palette steps on distance.
  projection:      ["topdown", "side", "iso-21", "iso-21-flipped", "three-quarter", "front", "mixed", "perspective-1pt", "perspective-2pt"],
  art_scale:       [8, 16, 24, 32, 48, 64, 96, 128],
  palette_size:    [2, 4, 8, 16, 24, 32, 48],
  temperature:     ["grey-value", "warm-cool-hue-shift", "complementary-shadow", "ambient-tinted", "single-hue"],
  edge_policy:     ["none", "selective-dark", "full-1px", "chunky-2px", "per-class"],
  shading:         ["flat", "two-value", "banded", "ramp-lit", "sculpted"],
  detail:          ["pristine", "moderate", "dense-grain", "hyper"],
  motion:          ["static", "2-frame", "4-frame", "6-frame", "8-frame", "sub-asset"],
  mood:            ["cozy-warm", "melancholy", "menacing", "whimsical", "sterile", "violent", "sacred"],
};

const REQUIRED = Object.keys(AXES);

// Hard impossibilities: declared up front, refused with a reason.
const RULES = [
  { id: "outline-2px-on-tiny", test: s => s.edge_policy === "chunky-2px" && s.art_scale <= 8,
    reason: "a 2px outline on an 8px subject consumes 50% of the silhouette; there is no interior left to read." },
  { id: "hyper-detail-on-small", test: s => s.detail === "hyper" && s.art_scale <= 16,
    reason: "hyper detail needs interior pixels; at 16px or below it collapses into noise." },
  { id: "dither-without-values", test: s => s.detail === "dense-grain" && s.palette_size <= 4,
    reason: "grain/dither requires at least two values per material to interleave; 4 colours cannot supply them." },
  { id: "sculpted-needs-palette", test: s => s.shading === "sculpted" && s.palette_size < 24,
    reason: "sculpted shading needs multi-step ramps per material; under 24 colours there are not enough ramps to go round." },
  { id: "sculpted-needs-room", test: s => s.shading === "sculpted" && s.art_scale < 48,
    reason: "sculpted form needs interior area; below 48px it reads as smudged, not modelled." },
  { id: "iso-needs-room", test: s => (s.projection === "iso-21" || s.projection === "iso-21-flipped") && s.art_scale < 32,
    reason: "isometric structure needs a tile footprint wide enough to show two faces; at 8 or 16 both faces are 1-2px." },
  { id: "grey-value-kills-warmth", test: s => s.temperature === "grey-value" && s.mood === "cozy-warm",
    reason: "grey-value shading desaturates as it darkens; cozy-warm depends on shadows staying warm. Pick a hue-shift model." },
  { id: "flat-contradicts-sculpt", test: s => s.shading === "flat" && (s.detail === "hyper" || s.detail === "dense-grain"),
    reason: "flat shading has no interior gradient for dense detail to live in." },
  { id: "mono-contradicts-multi-material", test: s => s.palette_size <= 2 && s.temperature !== "grey-value",
    reason: "a 2-colour palette cannot express a temperature model; value contrast is the only tool available." },
  { id: "sub-asset-needs-scale", test: s => s.motion === "sub-asset" && s.art_scale < 48,
    reason: "sub-asset animation (rotating parts, layered FX) needs pixels to animate independently." },
  { id: "perspective-needs-room", test: s => /^perspective-/.test(s.projection) && s.art_scale < 32,
    reason: "one-point perspective needs enough height to show a near face and a smaller far face; at 16px or below both faces are the same few pixels and the projection is invisible." },
  { id: "perspective-needs-geometry", test: s => /^perspective-/.test(s.projection) && (s.horizon == null || !s.vanishing || s.vanishing.length !== 2),
    reason: "a perspective coordinate must declare a horizon row and a vanishing point. Without them there is nothing for receding edges to converge toward, and 'perspective' is just a word." },
  { id: "perspective-needs-value-range", test: s => /^perspective-/.test(s.projection) && s.palette_size < 8,
    reason: "distance is drawn by spending extra steps of each material's ramp. Under 8 colours there is no ramp left over to spend on depth and on form at the same time." },
  { id: "flat-contradicts-depth-cueing", test: s => /^perspective-/.test(s.projection) && s.shading === "flat" && s.depth_cueing !== "none",
    reason: "flat shading gives every face the same value, so nothing recedes by value. Either set depth_cueing: 'none' and carry depth on silhouette and overlap alone, or shade with ramps." },
];

// Soft tensions: allowed, but reported so the choice is made knowingly.
const WARNINGS = [
  { id: "full-outline-on-large", test: s => s.edge_policy === "full-1px" && s.art_scale >= 64,
    warn: "a full outline on a large subject flattens it; consider selective-dark so interior form carries the shape." },
  { id: "two-value-on-large", test: s => s.shading === "two-value" && s.art_scale >= 48,
    warn: "two-value shading at 48px+ will look under-worked relative to its neighbours." },
  { id: "large-palette-small-canvas", test: s => s.palette_size >= 32 && s.art_scale <= 16,
    warn: "32+ colours on a 16px subject means colours appear once or twice each; ramps will not read as ramps." },
  { id: "pristine-plus-menacing", test: s => s.detail === "pristine" && (s.mood === "menacing" || s.mood === "violent"),
    warn: "pristine surfaces read clean; menacing moods usually need grime or wear. This can still be right — know it is a choice." },
  { id: "perspective-spends-the-ramp", test: s => /^perspective-/.test(s.projection) && s.palette_size <= 16 && (s.depth_cueing ?? "value") === "value",
    warn: "depth cueing by value and form modelling compete for the same ramp steps. At 16 colours with 3+ depth bands there is often one step left per material for modelling the face itself." },
  { id: "perspective-vs-iso", test: s => s.projection === "perspective-1pt" && s.detail === "hyper",
    warn: "hyper detail on a projected structure means every receding line has to stay converged while carrying grain; this is where perspective art usually breaks." },
];

function validateCoordinate(spec) {
  const errors = [], warnings = [];
  for (const axis of REQUIRED) {
    if (!(axis in spec)) { errors.push({ rule: "missing-axis", axis, message: `axis '${axis}' is not declared` }); continue; }
    const v = spec[axis];
    if (!AXES[axis].includes(v)) errors.push({ rule: "axis-out-of-domain", axis, value: v, message: `'${v}' is not a legal value for axis '${axis}'. Legal: ${AXES[axis].join(", ")}` });
  }
  if (errors.length) return { ok: false, errors, warnings };
  for (const r of RULES) if (r.test(spec)) errors.push({ rule: r.id, message: r.reason });
  for (const w of WARNINGS) if (w.test(spec)) warnings.push({ rule: w.id, message: w.warn });
  return { ok: errors.length === 0, errors, warnings };
}

// ---- per-asset craft rules (docs/09) ------------------------------------------

function silhouetteOf(cel) {
  const m = new Uint8Array(cel.w * cel.h);
  cel.forEach((v, x, y) => { if (v >= 0) m[y * cel.w + x] = 1; });
  return m;
}

function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i] || seen[i]) continue;
    const stack = [i]; let n = 0, cells = [];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(); n++; cells.push(p);
      const px = p % w, py = (p - px) / w;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = px+dx, ny = py+dy;
        if (nx<0||ny<0||nx>=w||ny>=h) continue;
        const q = ny*w+nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push({ n, cells });
  }
  return out;
}

/** Negative space: air enclosed inside the silhouette. Low index on a functional object = lump. */
function negativeSpace(cel) {
  const w = cel.w, h = cel.h;
  const solid = silhouetteOf(cel);
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if ((y === 0 || y === h-1 || x === 0 || x === w-1) && !solid[y*w+x]) stack.push(y*w+x);
  while (stack.length) {
    const p = stack.pop();
    if (outside[p]) continue; outside[p] = 1;
    const px = p % w, py = (p - px) / w;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = px+dx, ny = py+dy;
      if (nx<0||ny<0||nx>=w||ny>=h) continue;
      const q = ny*w+nx;
      if (!solid[q] && !outside[q]) stack.push(q);
    }
  }
  const bb = cel.bbox();
  if (!bb) return { enclosed: 0, enclosedRatio: 0, openRatio: 1 };
  let enclosed = 0;
  for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++)
    if (!solid[y*w+x] && !outside[y*w+x]) enclosed++;
  const total = bb.w * bb.h;
  return { enclosed, enclosedRatio: enclosed / total, openRatio: (total - bb.area - enclosed) / total };
}

/** Feature budget: how many separate legible masses the silhouette actually contains. */
function featureCount(cel) {
  const comps = components(silhouetteOf(cel), cel.w, cel.h);
  const big = comps.filter(c => c.n >= Math.max(4, cel.w * cel.h * 0.01));
  return { components: comps.length, features: big.length, orphans: comps.length - big.length };
}

const FEATURE_BUDGET = { 8: 1, 16: 2, 24: 3, 32: 3, 48: 4, 64: 5, 96: 6, 128: 8 };

function assertStyle(cel, style, palette, opts = {}) {
  const v = [];
  const bb = cel.bbox();
  if (!bb) return { ok: true, violations: [], skipped: "empty cel" };

  // 1. every colour used must be authorised by the declared palette
  const counts = cel.counts();
  if (palette) {
    for (const i of counts.keys()) {
      if (!palette.has(i)) v.push({ rule: "unauthorised_colour", x: null, index: i, message: `index ${i} is not in palette '${palette.id}'` });
    }
    if (counts.size > style.palette_size)
      v.push({ rule: "palette_magnitude_exceeded", used: counts.size, cap: style.palette_size,
        message: `uses ${counts.size} colours; coordinate declares ${style.palette_size}` });
  }

  // 2. lone pixels: a colour used exactly once is usually dirt - but a deliberate single-pixel
  //    accent (an eye, a specular glint) is craft, not error, so those roles are exempt.
  const ACCENT_ROLES = new Set(["accent", "detail", "light", "outline"]);
  const lone = [];
  if (palette) for (const [i, n] of counts) if (n === 1 && !ACCENT_ROLES.has(palette.entries[i]?.role)) {
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) if (cel.get(x, y) === i) lone.push({ x, y, index: i });
  }
  if (lone.length && style.detail !== "hyper")
    v.push({ rule: "lone_pixel", count: lone.length, at: lone.slice(0, 12),
      message: `${lone.length} material colour(s) used exactly once — a single pixel of a material reads as dirt. Give it a neighbour or delete it.` });

  // 3. ramp conformance. Calibrated from the first benchmark run, which produced 2,079 hits
  //    for a rule that was simply too strict: a 2-step skip inside a 5-step ramp is ordinary
  //    contrast and appears in hand-painted art everywhere. What actually reads as bad is a
  //    3+ step skip, or a *density* of 2-step skips that turns a form into stripes.
  if (palette) {
    let big = 0, double = 0, adjacencies = 0;
    const at = [];
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const a = cel.get(x, y); if (a < 0) continue;
      const ea = palette.entries[a]; if (!ea.ramp) continue;
      for (const [dx, dy] of [[1,0],[0,1]]) {
        const b = cel.get(x+dx, y+dy); if (b < 0) continue;
        const eb = palette.entries[b]; if (!eb.ramp || eb.ramp !== ea.ramp) continue;
        adjacencies++;
        const d = Math.abs(ea.step - eb.step);
        if (d >= 3) { big++; if (at.length < 12) at.push({ x, y, from: ea.name, to: eb.name }); }
        else if (d === 2) double++;
      }
    }
    if (big) v.push({ rule: "ramp_jump", count: big, at, message: `${big} adjacent same-material pair(s) skip 3+ ramp steps — that is a hard band across a form, not shading` });
    const density = adjacencies ? double / adjacencies : 0;
    if (density > 0.35) v.push({ rule: "ramp_stride", severity: "warn", count: double, density: +density.toFixed(2),
      message: `${(density*100).toFixed(0)}% of same-material adjacencies skip a step — the form is being drawn in stripes instead of a gradient` });
  }

  // 4. edge policy
  if (style.edge_policy === "none" && opts.outlineIndices?.length) {
    const outlined = [...counts.keys()].filter(i => style.outline?.includes?.(palette?.color(i)));
    if (outlined.length) v.push({ rule: "outline_forbidden", colours: outlined, message: "coordinate declares no outline but outline colours are present" });
  }

  // 5. feature budget for the declared scale
  const fc = featureCount(cel);
  const budget = FEATURE_BUDGET[style.art_scale] ?? 3;
  const ns = negativeSpace(cel);
  if (fc.features > budget)
    v.push({ rule: "feature_budget_exceeded", features: fc.features, budget,
      message: `silhouette contains ${fc.features} separate masses; a ${style.art_scale}px subject supports ${budget}. Merge or remove — competing features mean none of them read.` });
  if (fc.orphans > (style.detail === "dense-grain" ? 8 : 2))
    v.push({ rule: "detached_pixels", orphans: fc.orphans, message: `${fc.orphans} disconnected speck(s) — the silhouette is not one shape` });

  // 6. negative space applies to objects with functional anatomy. A character's body is
  //    legitimately a solid mass; demanding enclosed air inside a torso is a category error.
  const FUNCTIONAL_CLASSES = new Set(["object", "weapon", "item", "vehicle", "mechanism", "tool"]);
  if (FUNCTIONAL_CLASSES.has(opts.assetClass || "object") && ns.enclosed === 0)
    v.push({ rule: "no_negative_space", message: `${opts.assetClass} with zero enclosed air — nothing inside the outline is legible as a part` });

  // 7. dither legality
  if (style.detail !== "dense-grain" && opts.ditherPairs > 0)
    v.push({ rule: "dither_forbidden", count: opts.ditherPairs, message: "coordinate declares no dither; checkerboard pairs found" });

  return { ok: v.length === 0, violations: v, metrics: { colours: counts.size, silhouette: bb.area, features: fc, negativeSpace: ns } };
}

module.exports = { AXES, REQUIRED, RULES, WARNINGS, validateCoordinate, assertStyle, negativeSpace, featureCount, components, silhouetteOf, FEATURE_BUDGET };
