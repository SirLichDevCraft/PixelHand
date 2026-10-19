// Craft measurement: the numbers behind "this looks hand-made".
//
// The audit layer catches mechanical errors (lone pixels, off-ramp colours, jaggies).
// Those are necessary and not sufficient: draft 1 of the pistol passed every mechanical
// rule and still read as a lump (docs/09 §1). What was missing was a measurement of the
// things that actually separate craft from generation — form modelling, light coherence,
// value structure, silhouette readability, focal hierarchy.
//
// Every function here is measurement only. The engine never draws.
"use strict";

const { components, silhouetteOf, negativeSpace } = require("./core/style.js");
const { rgbToHsl } = require("./core/palette.js");

const TRANSPARENT = -1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Perceived luminance, not HSL lightness: a saturated blue and a pale grey of equal L are not equal on screen. */
/**
 * Can two adjacent colours actually be told apart?
 *
 * The first version of this test compared luminance only, and that is the wrong instrument for a
 * palette whose whole separating strategy is a warm/cool hue shift. A warm brown boot next to a
 * cool blue coat is not invisible just because the two land on the same luminance; on screen they
 * are obviously different things. Measuring them by luminance produced 200+ "invisible boundary"
 * findings and pushed me into contorting the palette to satisfy a metric that did not match how the
 * palette was designed to work.
 *
 * So: value gap first, then a hue credit that is only earned when BOTH sides carry saturation.
 * Two greys at the same value get no credit and are correctly reported as fused. A saturated
 * orange next to a saturated blue at the same value is a real boundary.
 */
function separation(a, b) {
  const ha = rgbToHsl(a), hb = rgbToHsl(b);
  const dv = Math.abs(ha[2] - hb[2]);
  let dh = Math.abs(ha[0] - hb[0]);
  dh = Math.min(dh, 360 - dh);
  const sat = Math.min(ha[1], hb[1]);
  const hueCredit = sat > 0.15 ? Math.min(dh / 90, 1) * 0.10 : 0;
  const score = dv + hueCredit;
  return { dv, dh, sat, score, separable: score >= 0.05 };
}

function luma(rgb) { return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; }

function materialOf(palette, i) {
  if (i < 0 || !palette || !palette.has(i)) return null;
  const e = palette.entries[i];
  return e.ramp || `single:${e.name}`;
}

/** A region is a connected run of one material (ramp identity, not ramp step). */
function regions(cel, palette) {
  const w = cel.w, h = cel.h;
  const mat = new Int16Array(w * h).fill(-2);      // -2 transparent, -1 unmaterial'd
  const id = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = cel.get(x, y);
    if (i < 0) { mat[y * w + x] = -2; continue; }
    const m = materialOf(palette, i);
    mat[y * w + x] = m === null ? -1 : 0;          // grouped below by ramp name
  }
  // group by ramp id string
  const rampKey = new Map();
  for (let p = 0; p < w * h; p++) {
    if (mat[p] === -2 || mat[p] === -1) continue;
    const i = cel.get(p % w, (p - p % w) / w);
    const key = materialOf(palette, i);
    if (!rampKey.has(key)) rampKey.set(key, rampKey.size);
    mat[p] = rampKey.get(key);
  }
  let next = 0;
  const out = [];
  for (let p = 0; p < w * h; p++) {
    if (mat[p] < 0 || id[p] >= 0) continue;
    const stack = [p]; id[p] = next;
    const cells = [];
    while (stack.length) {
      const q = stack.pop(); cells.push(q);
      const qx = q % w, qy = (q - qx) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (mat[r] === mat[p] && id[r] < 0) { id[r] = next; stack.push(r); }
      }
    }
    const key = [...rampKey.keys()].find((k, n) => n === mat[p]);
    out.push({ id: next, material: key, cells, area: cells.length });
    next++;
  }
  return out;
}

/**
 * Form modelling. A large region of one material that uses only one or two ramp steps is a
 * flat fill: the shape is being *outlined and filled* instead of *modelled with light*.
 * This is the single most common signature of generated pixel art, and no existing rule
 * caught it — which is exactly why 64 cels could look flat and still pass.
 */
function formModelling(cel, palette) {
  if (!palette) return { flat: [], modelled: 0, score: 1 };
  const flat = [];
  let modelled = 0;
  for (const reg of regions(cel, palette)) {
    const steps = new Set(reg.cells.map((p) => palette.entries[cel.get(p % cel.w, (p - p % cel.w) / cel.w)].step));
    const ramp = palette.ramp(reg.material);
    const rampSteps = ramp ? ramp.length : 1;
    if (rampSteps < 3) continue;                       // a 2-step material cannot be modelled further
    if (reg.area < 8) continue;                        // a 6px sleeve is a sleeve, not a form
    const want = reg.area >= 40 ? 3 : 2;
    if (steps.size < want) {
      flat.push({
        material: reg.material, area: reg.area, stepsUsed: [...steps].sort((a, b) => a - b),
        available: rampSteps, at: reg.cells.slice(0, 6).map((p) => ({ x: p % cel.w, y: (p - p % cel.w) / cel.w })),
        message: `'${reg.material}' paints ${reg.area}px as ${steps.size} ramp step(s) of ${rampSteps} — a ${reg.area}px mass modelled with ${steps.size} value(s) is a flat fill, not a form`,
      });
    } else modelled++;
  }
  const total = flat.length + modelled;
  return { flat, modelled, score: total ? modelled / total : 1 };
}

/**
 * Light coherence. One key direction per asset. For every modelled region, the vector from
 * its shadow centroid to its lit centroid must point along the light. Two regions lit from
 * opposite sides is the reason generated art looks "randomly shaded".
 */
function lightCoherence(cel, palette, light = [-0.7, -0.7]) {
  if (!palette) return { score: 1, offenders: [] };
  // An asset may legitimately carry more than one source: a key light plus the lantern it holds,
  // the forge it stands beside, the glow of the thing it is holding. Declared lights are checked
  // against each other; agreeing with ANY declared light is agreement.
  const declared = Array.isArray(light[0]) ? light : [light];
  const dirs = declared.map(([x, y]) => { const m = Math.hypot(x, y) || 1; return [x / m, y / m]; });
  const offenders = [];
  let checked = 0, agreed = 0;
  for (const reg of regions(cel, palette)) {
    if (reg.area < 10) continue;
    // A region that touches a declared light-role pixel is self-lit: the flame is inside the
    // lantern, the glow is inside the ember. Applying the key light to it would be a category
    // error, and forcing agreement would flatten every light source in the game.
    const selfLit = reg.cells.some((p) => {
      const x = p % cel.w, y = (p - p % cel.w) / cel.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const j = cel.get(x + dx, y + dy);
        if (j >= 0 && palette.entries[j] && palette.entries[j].role === "light") return true;
      }
      return false;
    });
    if (selfLit) continue;
    const pts = reg.cells.map((p) => {
      const x = p % cel.w, y = (p - p % cel.w) / cel.w;
      const e = palette.entries[cel.get(x, y)];
      return { x, y, step: e.step, ramp: e.ramp ? palette.ramp(e.ramp).length : 1 };
    });
    if (Math.max(...pts.map(p => p.step)) - Math.min(...pts.map(p => p.step)) < 2) continue;
    checked++;
    const mean = (f) => pts.reduce((s, p) => s + f(p), 0) / pts.length;
    // project each pixel onto the light axis; lit pixels should sit further along it
    const proj = (p) => (p.x - mean((q) => q.x)) * lx + (p.y - mean((q) => q.y)) * ly;
    const sorted = [...pts].sort((a, b) => a.step - b.step);
    const dark = sorted.slice(0, Math.max(2, Math.floor(sorted.length * 0.3)));
    const lit = sorted.slice(-Math.max(2, Math.floor(sorted.length * 0.3)));
    const dm = { x: dark.reduce((s, p) => s + p.x, 0) / dark.length, y: dark.reduce((s, p) => s + p.y, 0) / dark.length };
    const lm = { x: lit.reduce((s, p) => s + p.x, 0) / lit.length, y: lit.reduce((s, p) => s + p.y, 0) / lit.length };
    const vx = lm.x - dm.x, vy = lm.y - dm.y;
    const mag = Math.hypot(vx, vy);
    if (mag < 0.35) { offenders.push({ material: reg.material, area: reg.area, reason: "lit and shadow pixels are interleaved, not separated", at: { x: Math.round(mean(p => p.x)), y: Math.round(mean(p => p.y)) } }); continue; }
    const dots = dirs.map(([lx, ly]) => (vx / mag) * lx + (vy / mag) * ly);
    const best = Math.max(...dots);
    if (best > 0.45) agreed++;
    else offenders.push({
      material: reg.material, area: reg.area, dot: +best.toFixed(2),
      from: { x: +dm.x.toFixed(1), y: +dm.y.toFixed(1) }, to: { x: +lm.x.toFixed(1), y: +lm.y.toFixed(1) },
      reason: best < -0.2 ? "this region is lit from the opposite side to every declared light" : "this region's light direction is off-axis from every declared light",
    });
  }
  return { score: checked ? agreed / checked : 1, checked, agreed, offenders };
}

/**
 * Value structure. A sprite whose pixels all sit in a narrow luminance band has no read at
 * distance, no matter how good its hue choices are. Measured as the spread of the silhouette
 * plus the contrast between the subject and the ground it stands on.
 */
function valueStructure(cel, palette, opts = {}) {
  const vals = [];
  cel.forEach((v) => { if (v >= 0 && palette) vals.push(luma(palette.color(v))); });
  if (!vals.length) return { score: 0 };
  vals.sort((a, b) => a - b);
  const lo = vals[0], hi = vals[vals.length - 1];
  const p10 = vals[Math.floor(vals.length * 0.1)], p90 = vals[Math.floor(vals.length * 0.9)];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  // how much of the silhouette sits in the darkest 1/3 and the brightest 1/3 of its own range
  const span = hi - lo || 1;
  const darkShare = vals.filter(v => (v - lo) / span < 0.34).length / vals.length;
  const litShare = vals.filter(v => (v - lo) / span > 0.66).length / vals.length;
  const bg = opts.bgLuma ?? 0.09;
  const subjectLuma = mean;
  const groundContrast = Math.abs(subjectLuma - bg);
  const score = clamp(
    0.45 * clamp((p90 - p10) / 0.55, 0, 1) +
    0.25 * clamp(sd / 0.16, 0, 1) +
    0.15 * clamp(Math.min(darkShare, litShare) / 0.18, 0, 1) +
    0.15 * clamp(groundContrast / 0.28, 0, 1), 0, 1);
  return { lo: +lo.toFixed(3), hi: +hi.toFixed(3), p10: +p10.toFixed(3), p90: +p90.toFixed(3),
    range: +(hi - lo).toFixed(3), mean: +mean.toFixed(3), sd: +sd.toFixed(3),
    darkShare: +darkShare.toFixed(2), litShare: +litShare.toFixed(2),
    groundContrast: +groundContrast.toFixed(3), score: +score.toFixed(3) };
}

/** Blob index: how much of the subject's own bounding box is filled. A near-1.0 fill is a brick. */
function blobIndex(cel) {
  const bb = cel.bbox();
  if (!bb) return { fill: 0 };
  const fill = bb.area / (bb.w * bb.h);
  // A lump and a legible subject can share a fill ratio; what separates them is that a lump has
  // the same width on every row. Row AND column width variety is the measurable version of
  // "this silhouette has appendages", which is what a blob does not.
  const widths = [], heights = [];
  for (let y = bb.y0; y <= bb.y1; y++) {
    let n = 0;
    for (let x = bb.x0; x <= bb.x1; x++) if (cel.get(x, y) >= 0) n++;
    widths.push(n);
  }
  for (let x = bb.x0; x <= bb.x1; x++) {
    let n = 0;
    for (let y = bb.y0; y <= bb.y1; y++) if (cel.get(x, y) >= 0) n++;
    heights.push(n);
  }
  const uniq = new Set(widths).size;
  const uniqH = new Set(heights).size;
  const wVar = bb.h > 1 ? (uniq - 1) / (bb.h - 1) : 0;
  const hVar = bb.w > 1 ? (uniqH - 1) / (bb.w - 1) : 0;
  const variety = (wVar + hVar) / 2;
  const maxW = Math.max(...widths);
  const appendages = widths.filter(n => n < maxW * 0.5).length;
  const fillScore = clamp(1 - Math.abs(fill - 0.62) / 0.38, 0, 1);
  return { fill: +fill.toFixed(3), rowWidthVariety: uniq, colHeightVariety: uniqH,
    variety: +variety.toFixed(3), appendageRows: appendages, rows: bb.h,
    box: [bb.w, bb.h],
    score: +clamp(0.55 * fillScore + 0.45 * clamp(variety * 2.2, 0, 1), 0, 1).toFixed(3) };
}

/**
 * Outline discipline. "selective-dark" means the outline is used where the silhouette needs
 * separating from the background and NOT everywhere. A full outline flattens a form: it replaces
 * modelling with a border, which is the fastest way to make art look stamped.
 */
function outlineUsage(cel, palette) {
  if (!palette) return { ratio: 0, boundary: 0, outlined: 0, score: 1 };
  const outlineIdx = new Set(palette.entries.map((e, i) => [e.role, i]).filter(([r]) => r === "outline").map(([, i]) => i));
  if (!outlineIdx.size) return { ratio: 0, boundary: 0, outlined: 0, score: 1 };
  const solid = silhouetteOf(cel);
  const w = cel.w, h = cel.h;
  let boundary = 0, outlined = 0;
  const at = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid[y * w + x]) continue;
    let onEdge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !solid[ny * w + nx]) { onEdge = true; break; }
    }
    if (!onEdge) continue;
    boundary++;
    if (outlineIdx.has(cel.get(x, y))) { outlined++; if (at.length < 10) at.push({ x, y }); }
  }
  const ratio = boundary ? outlined / boundary : 0;
  return { boundary, outlined, ratio: +ratio.toFixed(3), at, score: +clamp(1 - Math.abs(ratio - 0.55) / 0.55, 0, 1).toFixed(3) };
}

/**
 * Grounding. A character that stands on nothing looks like a sticker. There must be a dark
 * contact band at the feet — the darkest thing in the sprite belongs where the body meets the
 * ground, and it is the cheapest, biggest readability win available.
 */
function contactGrounding(cel, palette) {
  const bb = cel.bbox();
  if (!bb) return { present: false, score: 0 };
  const rows = [];
  for (let y = Math.max(0, bb.y1 - 2); y <= bb.y1; y++) {
    let n = 0, darkest = 1;
    for (let x = bb.x0; x <= bb.x1; x++) {
      const i = cel.get(x, y); if (i < 0) continue;
      n++;
      const v = palette ? luma(palette.color(i)) : 0.5;
      if (v < darkest) darkest = v;
    }
    rows.push({ y, n, darkest: +darkest.toFixed(3) });
  }
  const bottom = rows[rows.length - 1];
  const bodyMean = (() => {
    const vs = [];
    for (let y = bb.y0; y < bb.y1 - 2; y++) for (let x = bb.x0; x <= bb.x1; x++) {
      const i = cel.get(x, y); if (i >= 0) vs.push(palette ? luma(palette.color(i)) : 0.5);
    }
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
  })();
  const present = bottom && bottom.darkest < bodyMean - 0.02;
  // is there a wider dark band *under* the feet (a cast contact shadow), not just dark feet?
  let castShadow = false;
  for (let x = bb.x0; x <= bb.x1; x++) if (cel.get(x, bb.y1 + 1) >= 0) castShadow = true;
  return { present, castShadow, bottomLuma: bottom ? bottom.darkest : null, bodyMean: +bodyMean.toFixed(3),
    score: +(present ? (castShadow ? 1 : 0.75) : 0).toFixed(2) };
}

/**
 * Focal accent. One asset, one thing the eye lands on. Measured as: is the brightest cluster
 * of the declared accent material big enough to find, and is it separated from the rest?
 */
function focalAccent(cel, palette, opts = {}) {
  if (!palette) return { score: 0 };
  const accentIdx = new Set(palette.entries.map((e, i) => [e.role, i]).filter(([r]) => r === "accent" || r === "light").map(([, i]) => i));
  if (!accentIdx.size) return { score: 0, message: "no accent/light role in the palette — nothing is declared as the thing to look at" };
  const clusters = [];
  const seen = new Set();
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const i = cel.get(x, y);
    if (i < 0 || !accentIdx.has(i) || seen.has(y * cel.w + x)) continue;
    const stack = [y * cel.w + x]; seen.add(y * cel.w + x);
    const cells = [];
    while (stack.length) {
      const p = stack.pop(); cells.push(p);
      const px = p % cel.w, py = (p - px) / cel.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h) continue;
        const q = ny * cel.w + nx;
        const j = cel.get(nx, ny);
        if (j >= 0 && accentIdx.has(j) && !seen.has(q)) { seen.add(q); stack.push(q); }
      }
    }
    clusters.push(cells);
  }
  if (!clusters.length) return { score: 0, message: "accent colours exist in the palette but none is used" };
  clusters.sort((a, b) => b.length - a.length);
  const top = clusters[0];
  const total = clusters.reduce((s, c) => s + c.length, 0);
  const dominance = top.length / total;
  const bb = cel.bbox();
  const cy = (bb.y0 + bb.y1) / 2, cx = (bb.x0 + bb.x1) / 2;
  const centroid = top.reduce((s, p) => s + { x: p % cel.w, y: (p - p % cel.w) / cel.w }[0] * 0 + 0, 0);
  const cxs = top.reduce((s, p) => s + (p % cel.w), 0) / top.length;
  const cys = top.reduce((s, p) => s + ((p - p % cel.w) / cel.w), 0) / top.length;
  const offCentre = Math.hypot(cxs - cx, cys - cy) / Math.max(bb.w, bb.h);
  const score = clamp(
    0.5 * clamp(top.length / 6, 0, 1) + 0.3 * clamp(dominance / 0.55, 0, 1) + 0.2 * clamp(offCentre / 0.18, 0, 1), 0, 1);
  return { clusters: clusters.length, largest: top.length, totalAccent: total,
    dominance: +dominance.toFixed(2), offCentre: +offCentre.toFixed(2),
    centroid: { x: +cxs.toFixed(1), y: +cys.toFixed(1) }, score: +score.toFixed(3) };
}

/** Silhouette complexity: perimeter / area. Too low = blob; too high = confetti. */
function silhouetteComplexity(cel) {
  const solid = silhouetteOf(cel);
  const w = cel.w, h = cel.h;
  let per = 0, area = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid[y * w + x]) continue;
    area++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !solid[ny * w + nx]) per++;
    }
  }
  const ratio = area ? per / area : 0;
  // Perimeter over area is scale-dependent — a big solid mass looks "simple" only because it is
  // big. Perimeter over the square root of area is not: a disc sits at 3.54 whatever its size,
  // and a silhouette with limbs, a muzzle and a guard pushes past 5.
  const compactness = area ? per / Math.sqrt(area) : 0;
  // ...and it is a band, not a slope. Below ~4.4 the silhouette is a lump; above ~9.5 it is spiky,
  // fragmented, or built out of single-pixel protrusions that break apart at game scale. Scoring
  // the slope instead means every character saturates at 1 and the metric says nothing.
  const band = compactness < 4.4 ? clamp((compactness - 3.2) / 1.2, 0, 1) : clamp(1 - (compactness - 9.5) / 4.5, 0, 1);
  // Maximal one-pixel runs, horizontal and vertical. A 1px limb, a checkerboard edge, a stray
  // diagonal: all of them read as damage at 1x, and all of them inflate compactness. Counting
  // them separately stops fragmentation from scoring as complexity.
  let runs = 0, thin = 0;
  for (let y = 0; y < h; y++) { let x = 0; while (x < w) { if (!solid[y * w + x]) { x++; continue; } let n = 0; while (x < w && solid[y * w + x]) { n++; x++; } runs++; if (n === 1) thin++; } }
  for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!solid[y * w + x]) { y++; continue; } let n = 0; while (y < h && solid[y * w + x]) { n++; y++; } runs++; if (n === 1) thin++; } }
  const thinShare = runs ? thin / runs : 0;
  // A curved edge legitimately produces single-pixel runs, so a quarter of runs being thin is
  // normal aliasing. Past that it is the shape itself that is one pixel wide.
  const thinPenalty = clamp(1 - Math.max(0, thinShare - 0.25) * 3, 0, 1);
  const score = clamp(band * thinPenalty, 0, 1);
  return { area, perimeter: per, ratio: +ratio.toFixed(2), compactness: +compactness.toFixed(2),
    runs, thinRuns: thin, thinRunShare: +thinShare.toFixed(3), band: +band.toFixed(3),
    score: +score.toFixed(3) };
}

/**
 * Negative space. An object with no enclosed air is a solid cut-out: nothing inside the outline
 * reads as a part. This is the measurable version of the pistol draft-1 lesson.
 */
function negativeSpaceScore(cel, opts) {
  opts = opts || {};
  const ns = negativeSpace(cel);
  const want = opts.assetClass === "character" ? 0.03 : 0.04;
  return { ...ns, want, score: +clamp(ns.enclosedRatio / want, 0, 1).toFixed(3) };
}

/**
 * Feature legibility. Two parts read as one part when the pixels between them carry too little
 * value separation. This is the measurable version of "the arms disappeared into the coat".
 */
function partSeparation(cel, palette) {
  if (!palette) return { score: 1, merged: [] };
  const merged = [];
  let pairs = 0, readable = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const a = cel.get(x, y); if (a < 0) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const b = cel.get(x + dx, y + dy); if (b < 0 || a === b) continue;
      const ea = palette.entries[a], eb = palette.entries[b];
      if (ea.role === "outline" || eb.role === "outline") continue;
      pairs++;
      const d = Math.abs(luma(ea.rgb) - luma(eb.rgb));
      if (d < 0.05) merged.push({ x, y, a: ea.name, b: eb.name, d: +d.toFixed(3) });
      else readable++;
    }
  }
  return { pairs, readable, mergedCount: merged.length, merged: merged.slice(0, 12),
    score: +clamp(pairs ? readable / pairs : 1, 0, 1).toFixed(3) };
}

/** Cluster statistics: hand-made art paints in 2-4px clusters; generated art paints in 1px noise or 8px slabs. */
function clusterStats(cel, palette) {
  const seen = new Set();
  const sizes = [];
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const i = cel.get(x, y);
    if (i < 0 || seen.has(y * cel.w + x)) continue;
    const stack = [y * cel.w + x]; seen.add(y * cel.w + x);
    let n = 0;
    while (stack.length) {
      const p = stack.pop(); n++;
      const px = p % cel.w, py = (p - px) / cel.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h) continue;
        const q = ny * cel.w + nx;
        if (cel.get(nx, ny) === i && !seen.has(q)) { seen.add(q); stack.push(q); }
      }
    }
    sizes.push(n);
  }
  if (!sizes.length) return { score: 0 };
  const lone = sizes.filter(n => n === 1).length;
  const good = sizes.filter(n => n >= 2 && n <= 6).length;
  const slab = sizes.filter(n => n > 24).length;
  const total = sizes.length;
  return { clusters: total, lone, mid: good, slab,
    mean: +(sizes.reduce((s, n) => s + n, 0) / total).toFixed(2),
    score: +clamp(good / total - 0.5 * (lone / total), 0, 1).toFixed(3) };
}

/**
 * The single number the benchmark iterates against. Sub-scores are named so a failure says
 * *what* is wrong, not that something is wrong.
 */
function craftScore(cel, palette, opts = {}) {
  const form = formModelling(cel, palette);
  const light = lightCoherence(cel, palette, opts.light);
  const value = valueStructure(cel, palette, opts);
  const blob = blobIndex(cel);
  const outline = outlineUsage(cel, palette);
  const ground = contactGrounding(cel, palette);
  const focal = focalAccent(cel, palette, opts);
  const shape = silhouetteComplexity(cel);
  const space = negativeSpaceScore(cel, opts);
  const sep = partSeparation(cel, palette);
  const clusters = clusterStats(cel, palette);

  const weights = { form: 0.16, light: 0.12, value: 0.14, blob: 0.09, outline: 0.07,
    ground: 0.07, focal: 0.09, shape: 0.08, space: 0.07, separation: 0.06, clusters: 0.05 };
  const sub = {
    form: form.score, light: light.score, value: value.score, blob: blob.score,
    outline: outline.score, ground: ground.score, focal: focal.score, shape: shape.score,
    space: space.score, separation: sep.score, clusters: clusters.score,
  };
  let total = 0;
  for (const k of Object.keys(weights)) total += weights[k] * (sub[k] ?? 0);
  const weak = Object.entries(sub).sort((a, b) => a[1] - b[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}`);
  return {
    score: +total.toFixed(3), grade: total >= 0.85 ? "hero" : total >= 0.72 ? "support" : total >= 0.58 ? "background" : "reject",
    assessment: "heuristic-diagnostic", visual_approval: "unreviewed",
    sub: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, +(v ?? 0).toFixed(3)])),
    weakest: weak,
    detail: { form, light, value, blob, outline, ground, focal, shape, space, separation: sep, clusters },
  };
}

module.exports = {
  luma, separation, regions, materialOf, formModelling, lightCoherence, valueStructure, blobIndex,
  outlineUsage, contactGrounding, focalAccent, silhouetteComplexity, negativeSpaceScore,
  partSeparation, clusterStats, craftScore,
};
