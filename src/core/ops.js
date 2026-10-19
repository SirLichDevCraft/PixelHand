// The hand-placement primitives. docs/01 §3.
//
// Two rules govern this whole file, and both come from a measured failure:
//
// 1. NO BRIGHTNESS/HUE/SATURATION FILTERS. A filter moves every pixel off the declared palette.
//    Every operation here moves pixels *along* a ramp instead. That is why a glow is ramp steps
//    arranged in space, a shadow is a ramp step, and there is no `brighten()` anywhere in the engine.
//
// 2. SHAPE PRIMITIVES ARE SCAFFOLDING ONLY. Phase 0 proved that an agent handed a shape generator
//    writes a formula, and formulas produce the smooth monotone surfaces that make generated art
//    look generated. draw_shape therefore reports how much of the sprite it covered, and the audit
//    treats a shape-dominated sprite as a defect.
"use strict";

const { Cel, TRANSPARENT, charFor, indexFor, CHARSET } = require("./cel.js");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The standard result shape from docs/01 §4. Every op returns it. */
function result(cel, edits, extra = {}) {
  const xs = edits.map(e => e.x), ys = edits.map(e => e.y);
  const region = edits.length
    ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    : null;
  const added = edits.filter(e => e.from < 0).length;
  const removed = edits.filter(e => e.to < 0).length;
  const repainted = edits.length - added - removed;
  const out = {
    ok: true,
    changed: { pixels: edits.length, added, removed, repainted },
    region,
    violations: [],
    warnings: [],
    ...extra,
  };
  // "Nothing changed" is a failure signal, not a success. An edit that hit the wrong layer,
  // fell outside a stale selection, or landed off-canvas is indistinguishable from an edit that
  // was not needed — so the engine says so in the same channel as a successful edit.
  if (!edits.length) out.warnings.push("changed.pixels = 0: the edit did nothing. Wrong layer, wrong region, or the pixels already had this colour.");
  // A violation is not a warning. If part of the instruction was refused, the operation did not
  // do what was asked, and `ok` must not say otherwise.
  if (out.violations.some(v => v.severity !== "warn")) out.ok = false;
  return out;
}

const rampOf = (palette, i) => (i >= 0 && palette && palette.has(i) ? palette.entries[i].ramp : null);
/** A violation added after result() must still flip `ok`. Violations are refusals. */
function syncOk(res) {
  if (res.violations.some(v => v.severity !== "warn")) res.ok = false;
  return res;
}

const stepOf = (palette, i) => (i >= 0 && palette && palette.has(i) ? (palette.entries[i].step ?? 0) : 0);
const roleOf = (palette, i) => (i >= 0 && palette && palette.has(i) ? palette.entries[i].role : null);

/** Find palette entries by role, e.g. the single declared outline colour. */
function byRole(palette, role) {
  const out = [];
  palette.entries.forEach((e, i) => { if (e.role === role) out.push(i); });
  return out;
}

function each(cel, region, cb) {
  const b = regionBounds(cel, region);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) cb(x, y);
}

function regionBounds(cel, region) {
  if (!region) return { x0: 0, y0: 0, x1: cel.w - 1, y1: cel.h - 1 };
  const x0 = Math.max(0, region.x0 ?? region.x ?? 0), y0 = Math.max(0, region.y0 ?? region.y ?? 0);
  const x1 = Math.min(cel.w - 1, region.x1 ?? (region.x + (region.w ?? 1) - 1));
  const y1 = Math.min(cel.h - 1, region.y1 ?? (region.y + (region.h ?? 1) - 1));
  return { x0, y0, x1, y1 };
}

function countComponents(set, w) {
  const seen = new Set(); let n = 0;
  for (const k of set) {
    if (seen.has(k)) continue;
    n++;
    const st = [k]; seen.add(k);
    while (st.length) {
      const p = st.pop(); const px = p % w, py = (p - px) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = (py + dy) * w + (px + dx);
        if (set.has(q) && !seen.has(q)) { seen.add(q); st.push(q); }
      }
    }
  }
  return n;
}

// ---- put / erase / replace / ramp shifts --------------------------------------

/** Surgical single-pixel fixes. cells: "x,y,name;..." where name may be "." for transparent. */
function put(cel, cells, opts = {}) {
  const list = typeof cells === "string"
    ? cells.split(";").map(s => s.trim()).filter(Boolean).map((s) => {
        const [x, y, v] = s.split(",").map(t => t.trim());
        if (v === "." || v === "-") return { x: +x, y: +y, to: TRANSPARENT, name: v };
        if (/^-?\d+$/.test(v)) return { x: +x, y: +y, to: +v, name: v };
        const idx = opts.palette ? opts.palette.index(v) : -1;
        return { x: +x, y: +y, to: idx, name: v, missing: idx < 0 };
      })
    : cells;
  const edits = [];
  const rejected = [];
  for (const c of list) {
    if (c.missing) { rejected.push({ x: c.x, y: c.y, reason: `colour '${c.name}' is not an entry of the cel's palette` }); continue; }
    if (c.to !== TRANSPARENT && (c.to === undefined || c.to < 0)) { rejected.push({ x: c.x, y: c.y, reason: `index '${c.name}' is not a legal palette index` }); continue; }
    const r = cel.set(c.x, c.y, c.to);
    if (!r.ok) { rejected.push({ x: c.x, y: c.y, reason: "out_of_bounds" }); continue; }
    if (r.changed) edits.push({ x: c.x, y: c.y, from: r.from, to: c.to });
  }
  const res = result(cel, edits, { rejected });
  for (const rj of rejected) res.violations.push({ rule: /palette/.test(rj.reason) ? "off_palette" : "region_out_of_bounds", at: [{ x: rj.x, y: rj.y }], message: rj.reason, fix: "palette_set" });
  return syncOk(res);
}

function erase(cel, region) {
  const edits = [];
  each(cel, region, (x, y) => {
    const from = cel.get(x, y);
    const r = cel.set(x, y, TRANSPARENT);
    if (r.ok && r.changed) edits.push({ x, y, from, to: TRANSPARENT });
  });
  return result(cel, edits);
}

/** Replace one colour with another. Exact index only — never a flood of near-colours. */
function replace_color(cel, fromIdx, toIdx, region) {
  const edits = [];
  each(cel, region, (x, y) => {
    if (cel.get(x, y) !== fromIdx) return;
    const r = cel.set(x, y, toIdx);
    if (r.changed) edits.push({ x, y, from: fromIdx, to: toIdx });
  });
  return result(cel, edits);
}

/**
 * shift_along_ramp: move every pixel of a material N steps along its own ramp.
 * This is the legal version of "make it darker". A brightness filter would invent colours;
 * this walks the material's authored steps and refuses to leave the ramp.
 */
function shift_along_ramp(cel, palette, steps, region, opts = {}) {
  const edits = [];
  const skipped = [];
  each(cel, region, (x, y) => {
    const i = cel.get(x, y); if (i < 0) return;
    const ramp = rampOf(palette, i);
    if (!ramp) { skipped.push({ x, y, reason: "not a ramp material" }); return; }
    if (opts.roles && !opts.roles.includes(roleOf(palette, i))) return;
    const list = palette.ramp(ramp);
    const k = list.indexOf(i) + steps;
    if (k < 0 || k >= list.length) { skipped.push({ x, y, reason: "already at the end of the ramp" }); return; }
    const target = list[k];
    const r = cel.set(x, y, target);
    if (r.changed) edits.push({ x, y, from: i, to: target });
  });
  return result(cel, edits, { skipped: skipped.length, skippedExamples: skipped.slice(0, 6) });
}

/**
 * fill_region: a rectangle fill, or a flood bounded by a boundary colour.
 * Region components are reported because scoping by colour distance is the classic way to catch
 * a neighbouring material (docs/01 §4 rule 3).
 */
function fill_region(cel, opts) {
  const idx = opts.idx;
  const edits = [];
  const b = regionBounds(cel, opts.region);
  const seen = new Set();
  if (opts.flood !== undefined) {
    const stack = [[opts.flood[0], opts.flood[1]]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < b.x0 || y < b.y0 || x > b.x1 || y > b.y1) continue;
      const k = y * cel.w + x;
      if (seen.has(k)) continue;
      seen.add(k);
      const cur = cel.get(x, y);
      if (opts.boundary !== undefined && cur === opts.boundary) continue;
      const r = cel.set(x, y, idx);
      if (r.changed) edits.push({ x, y, from: cur, to: idx });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push([x + dx, y + dy]);
    }
  } else {
    each(cel, opts.region, (x, y) => {
      const from = cel.get(x, y);
      const r = cel.set(x, y, idx);
      if (r.changed) edits.push({ x, y, from, to: idx });
    });
  }
  return result(cel, edits, { region_components: countComponents(seen, cel.w), touched: seen.size });
}

// ---- lines and shapes: scaffolding, loudly labelled as such -------------------

/**
 * Slope-aware line. A 1:1 diagonal is a clean staircase; a 2:1 or 3:1 slope must be drawn as
 * runs of 2 or 3 pixels or it becomes jaggies. This is the difference between a diagonal that
 * reads as a bevel and one that reads as a broken edge.
 */
function draw_line(cel, p0, p1, idx, opts = {}) {
  const edits = [];
  const [x0, y0] = p0, [x1, y1] = p1;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const slope = dx === 0 ? Infinity : dy === 0 ? 0 : dy / dx;
  const runFor = (s) => s === 0 || !isFinite(s) ? 1 : s === 1 ? 1 : s <= 0.5 ? 2 : s >= 2 ? 1 : 2;
  const policy = opts.slope_policy ?? "cluster";
  const run = policy === "raw" ? 1 : runFor(slope);
  const cells = [];
  if (dx >= dy) {
    let err = dx / 2;
    for (let x = x0, y = y0; ; x += sx) {
      for (let k = 0; k < run; k++) cells.push([x, y + sy * k]);
      err -= dy;
      if (err < 0) { y += sy; err += dx; }
      if (x === x1) break;
    }
  } else {
    let err = dy / 2;
    for (let y = y0, x = x0; ; y += sy) {
      for (let k = 0; k < run; k++) cells.push([x + sx * k, y]);
      err -= dx;
      if (err < 0) { x += sx; err += dy; }
      if (y === y1) break;
    }
  }
  const dedup = new Set();
  for (const [x, y] of cells) {
    const k = y * cel.w + x;
    if (dedup.has(k)) continue; dedup.add(k);
    const from = cel.get(x, y);
    const r = cel.set(x, y, idx);
    if (r.ok && r.changed) edits.push({ x, y, from, to: idx });
  }
  const res = result(cel, edits, { slope: +slope.toFixed(3), run_length: run, slope_policy: policy });
  res.warnings.push("draw_line is scaffolding: a line is structure, not form. Organic edges must be authored.");
  return res;
}

const SHAPES = {
  rect: (w, h) => { const o = []; for (let y = 0; y < h; y++) o.push("#".repeat(w)); return o; },
  circle: (w, h) => { const o = []; const rx = w / 2, ry = h / 2; for (let y = 0; y < h; y++) { let r = ""; for (let x = 0; x < w; x++) { const d = ((x + .5 - rx) / rx) ** 2 + ((y + .5 - ry) / ry) ** 2; r += d <= 1 ? "#" : "."; } o.push(r); } return o; },
  diamond: (w, h) => { const o = []; const rx = w / 2, ry = h / 2; for (let y = 0; y < h; y++) { let r = ""; for (let x = 0; x < w; x++) r += Math.abs(x + .5 - rx) / rx + Math.abs(y + .5 - ry) / ry <= 1 ? "#" : "."; o.push(r); } return o; },
  rounded: (w, h) => { const o = []; for (let y = 0; y < h; y++) { let r = ""; for (let x = 0; x < w; x++) { const c = (x < 2 && y < 2) || (x >= w - 2 && y < 2) || (x < 2 && y >= h - 2) || (x >= w - 2 && y >= h - 2); r += c ? "." : "#"; } o.push(r); } return o; },
};

/**
 * draw_shape / stroke_shape: SCAFFOLDING ONLY.
 * The result reports coverage, and the audit treats a shape-dominated sprite as a defect,
 * because organic form must be authored pixel by pixel. This is the engine refusing to be
 * a sprite generator.
 */
function shapeRows(shape, opts, cel) {
  if (typeof shape === "string" && SHAPES[shape]) return SHAPES[shape](opts.w ?? cel.w, opts.h ?? cel.h);
  if (shape && typeof shape === "object" && SHAPES[shape.kind]) return SHAPES[shape.kind](shape.w ?? opts.w ?? cel.w, shape.h ?? opts.h ?? cel.h);
  if (Array.isArray(shape)) return shape;
  return String(shape).split(/\n/).filter(r => r.length);
}

function draw_shape(cel, shape, idx, opts = {}) {
  const rows = shapeRows(shape, opts, cel);
  const ox = opts.x ?? 0, oy = opts.y ?? 0;
  const edits = [];
  let covered = 0;
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] !== "#") continue;
      covered++;
      const from = cel.get(ox + dx, oy + dy);
      const r = cel.set(ox + dx, oy + dy, idx);
      if (r.ok && r.changed) edits.push({ x: ox + dx, y: oy + dy, from, to: idx });
    }
  });
  const share = covered / Math.max(1, cel.w * cel.h);
  const res = result(cel, edits, { shape_coverage: +share.toFixed(3) });
  if (share > (opts.coverage_warn ?? 0.25))
    res.warnings.push(`draw_shape covered ${(share * 100).toFixed(0)}% of the sprite. Organic form must be authored as a pixel map; a shape this large is a formula, and formulas are what make generated art look generated.`);
  return res;
}

function stroke_shape(cel, shape, idx, opts = {}) {
  const rows = shapeRows(shape, opts, cel);
  const ox = opts.x ?? 0, oy = opts.y ?? 0;
  const edits = [];
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] !== "#") continue;
      const edge = !rows[dy - 1]?.[dx] || !rows[dy + 1]?.[dx] || !row[dx - 1] || !row[dx + 1];
      if (!edge) continue;
      const from = cel.get(ox + dx, oy + dy);
      const r = cel.set(ox + dx, oy + dy, idx);
      if (r.ok && r.changed) edits.push({ x: ox + dx, y: oy + dy, from, to: idx });
    }
  });
  return result(cel, edits);
}
// ---- the core authoring pair --------------------------------------------------

/** The read half. format: map (rows of chars) | rle | json. */
function get_pixel_map(cel, opts = {}) {
  const b = regionBounds(cel, opts.region);
  const rows = [];
  for (let y = b.y0; y <= b.y1; y++) {
    let r = "";
    for (let x = b.x0; x <= b.x1; x++) r += charFor(cel.get(x, y));
    rows.push(r);
  }
  const format = opts.format ?? "map";
  if (format === "json") {
    const cells = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const i = cel.get(x, y);
      if (i < 0) continue;
      cells.push({ x, y, index: i, name: opts.palette?.entries[i]?.name, role: opts.palette?.entries[i]?.role });
    }
    return { ok: true, region: b, format, cells };
  }
  if (format === "rle") return { ok: true, region: b, format, rle: require("./cel.js").rle(rows) };
  return { ok: true, region: b, format, map: rows };
}

/** The write half. This is how art is authored. A space means "leave this pixel alone". */
function draw_pixel_map(cel, rows, opts = {}) {
  const x0 = opts.x ?? opts.origin?.[0] ?? 0, y0 = opts.y ?? opts.origin?.[1] ?? 0;
  const lines = typeof rows === "string" ? rows.split(/\r?\n/).filter(r => r.length > 0) : rows;

  // Validate the WHOLE map before a single pixel is written. A half-applied map leaves a cel
  // holding indices the palette has never heard of, and every later pass reads them as colours.
  const badChars = [], outOfBounds = [], offPalette = [];
  lines.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx];
      if (ch === " " || ch === undefined) continue;               // space means LEAVE THIS PIXEL ALONE
      const idx = indexFor(ch);
      if (idx === null) { badChars.push({ x: x0 + dx, y: y0 + dy, ch }); continue; }
      if (!cel.inBounds(x0 + dx, y0 + dy)) { outOfBounds.push({ x: x0 + dx, y: y0 + dy }); continue; }
      if (idx >= 0 && opts.palette && !opts.palette.has(idx)) offPalette.push({ x: x0 + dx, y: y0 + dy, idx });
    }
  });
  if (badChars.length || outOfBounds.length || offPalette.length) {
    const res = result(cel, [], { origin: [x0, y0], applied: 0 });
    if (outOfBounds.length) res.violations.push({ rule: "region_out_of_bounds", count: outOfBounds.length, at: outOfBounds.slice(0, 12), message: `${outOfBounds.length} pixel(s) fall outside the ${cel.w}x${cel.h} canvas. The map was not applied at all — a partly-clipped map is a different drawing than the one that was asked for.`, fix: "resize_canvas" });
    if (badChars.length) res.violations.push({ rule: "map_char_out_of_charset", count: badChars.length, at: badChars.slice(0, 12), message: `${badChars.length} character(s) are not in the grid charset (${CHARSET.length} printable entries; '.' is transparent, ' ' is leave-alone). The map was not applied at all.`, fix: "get_pixel_map" });
    if (offPalette.length) res.violations.push({ rule: "off_palette", count: offPalette.length, at: offPalette.slice(0, 12), message: `${offPalette.length} map index(es) are not entries of palette '${opts.palette.id}'. The map was not applied at all: a cel holding an index the palette has never heard of cannot be rendered, audited, or exported.`, fix: "palette_set" });
    return syncOk(res);
  }

  const edits = [];
  lines.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx];
      if (ch === " " || ch === undefined) continue;
      const idx = indexFor(ch);
      const x = x0 + dx, y = y0 + dy;
      const from = cel.get(x, y);
      const r = cel.set(x, y, idx);
      if (r.changed) edits.push({ x, y, from, to: idx });
    }
  });
  return result(cel, edits, { origin: [x0, y0] });
}

// ---- paint_form: the ramp-lit operation ---------------------------------------

/**
 * Light a flat region ALONG ITS RAMP.
 *
 * Not a shading filter. A filter invents colours; this chooses, for each pixel, which authored
 * step of the material's own ramp that pixel should be, based on where the pixel sits relative
 * to the region's extent along the light axis. The output is always a subset of the ramp.
 */
function paint_form(cel, palette, opts = {}) {
  const ramp = opts.ramp && palette.ramp(opts.ramp) ? opts.ramp : rampOf(palette, opts.seed ?? -1);
  if (!ramp) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_ramp", message: "paint_form needs a declared ramp id or a seed pixel that belongs to a ramp" }], warnings: [] };
  const list = palette.ramp(ramp);
  const light = opts.light ?? [-0.7, -0.7];
  const form = opts.form ?? "sphere";
  const pts = [];
  each(cel, opts.region, (x, y) => {
    const i = cel.get(x, y);
    if (i < 0) return;
    if (opts.onlyMaterial !== false && rampOf(palette, i) !== ramp) return;
    pts.push({ x, y, i });
  });
  if (!pts.length) return result(cel, [], { note: "region contains no pixels of that material" });

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const mag = Math.hypot(light[0], light[1]) || 1;
  const lx = light[0] / mag, ly = light[1] / mag;
  let maxProj = -Infinity, minProj = Infinity, maxR = 0, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    p.proj = (p.x - cx) * lx + (p.y - cy) * ly;
    maxProj = Math.max(maxProj, p.proj); minProj = Math.min(minProj, p.proj);
    maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(1e-6, maxProj - minProj);
  const n = list.length;
  const edits = [];
  for (const p of pts) {
    let t;
    if (form === "box") t = p.proj > span * 0.18 ? 1 : p.proj < -span * 0.18 ? 0 : 0.5;
    else if (form === "cylinder") t = (p.proj - minProj) / span;
    else if (form === "cloth") {
      const rowT = 1 - (p.y - minY) / Math.max(1, maxY - minY);
      t = 0.62 * rowT + 0.38 * ((p.proj - minProj) / span);
    } else {
      const r = Math.hypot(p.x - cx, p.y - cy) / Math.max(1, maxR);
      t = clamp(0.55 * ((p.proj - minProj) / span) + 0.45 * (1 - r), 0, 1);
    }
    if (opts.contrast !== undefined) t = clamp(0.5 + (t - 0.5) * opts.contrast, 0, 1);
    let k = Math.round(t * (n - 1));
    if (opts.steps) k = clamp(k, opts.steps[0], opts.steps[1]);
    const target = list[clamp(k, 0, n - 1)];
    const r = cel.set(p.x, p.y, target);
    if (r.changed) edits.push({ x: p.x, y: p.y, from: p.i, to: target });
  }
  const res = result(cel, edits, { ramp, form, steps_available: n, light });
  res.warnings.push("paint_form distributes the material's own ramp steps; it never invents a colour. A lit region is not automatically a modelled form — review it.");
  return res;
}

// ---- anti-aliasing: ramp-adjacent only, convex corners only -------------------

function aa_pass(cel, palette, region, opts = {}) {
  const edits = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  each(cel, region, (x, y) => {
    const i = cel.get(x, y); if (i < 0) return;
    const e = palette.entries[i];
    if (!e || !e.ramp || e.role === "outline" || e.role === "light") return;
    const filled = DIRS.map(([dx, dy]) => cel.get(x + dx, y + dy) >= 0);
    if (filled.filter(Boolean).length !== 1) return;                 // convex corner only
    const d = DIRS[filled.indexOf(true)];
    const gapX = x + d[0], gapY = y + d[1];
    if (cel.get(gapX, gapY) >= 0) return;
    const opp = cel.get(x - d[0], y - d[1]);
    if (opp < 0) return;
    const oppV = palette.entries[opp]?.value;
    const cand = palette.neighbours(i).filter(j => j >= 0 && palette.entries[j]?.ramp === e.ramp);
    if (!cand.length) return;
    const target = cand.sort((a, b) => Math.abs(palette.entries[a].value - oppV) - Math.abs(palette.entries[b].value - oppV))[0];
    if (Math.abs(palette.entries[target].value - oppV) > 0.34) return;
    const from = cel.get(gapX, gapY);
    const r = cel.set(gapX, gapY, target);
    if (r.changed) edits.push({ x: gapX, y: gapY, from, to: target });
  });
  const res = result(cel, edits, { policy: "ramp-adjacent-only, convex corners only" });
  if (edits.length > (opts.max_per_edge ?? 12)) res.warnings.push(`${edits.length} AA pixels placed — more smoothing than the declared policy allows; review before keeping them.`);
  return res;
}

// ---- dither: pattern + density, never on an edge or a 1px detail --------------

const DITHER_PATTERNS = {
  "2x2-bayer": [[0, 2], [3, 1]],
  "4x4-bayer": [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
  "checker": [[0, 1], [1, 0]],
  "stochastic-15": null,
};

function dither_pass(cel, palette, region, opts = {}) {
  const name = opts.pattern ?? "2x2-bayer";
  const pattern = name in DITHER_PATTERNS ? DITHER_PATTERNS[name] : "hash";
  const density = opts.density ?? 0.5;
  const edits = [];
  const solid = [];
  each(cel, region, (x, y) => { if (cel.get(x, y) >= 0) solid.push([x, y]); });
  for (const [x, y] of solid) {
    const i = cel.get(x, y);
    const e = palette.entries[i];
    if (!e || !e.ramp) continue;
    let edge = false, neighbours = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (cel.get(x + dx, y + dy) < 0) edge = true; else neighbours++;
    }
    if (edge && !opts.on_edge) continue;
    if (neighbours < 3) continue;
    let t;
    if (!pattern) t = (((x * 73856093) ^ (y * 19349663)) % 100) < density * 100 ? 1 : 0;
    else t = pattern[y % pattern.length][x % pattern[0].length] / (pattern.length * pattern[0].length - 1) < density ? 1 : 0;
    const list = palette.ramp(e.ramp);
    const k = list.indexOf(i);
    const target = list[clamp(k + (t ? 1 : -1), 0, list.length - 1)];
    if (target === i) continue;
    const r = cel.set(x, y, target);
    if (r.changed) edits.push({ x, y, from: i, to: target });
  }
  const res = result(cel, edits, { pattern: name, density });
  res.warnings.push("dither is a value illusion, not a colour. Legal only where the coordinate declares it, and never on a silhouette or a face.");
  return res;
}

// ---- outline: selective, full, or none ----------------------------------------

/**
 * `selective-dark` means the outline exists where the silhouette needs separating from the
 * background and nowhere else: not on the lit rim, not on interior boundaries. A full outline
 * replaces modelling with a border, which is the fastest way to make art look stamped.
 */
function outline_pass(cel, palette, opts = {}) {
  const policy = opts.policy ?? "selective-dark";
  if (policy === "none") {
    const edits = [];
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const from = cel.get(x, y);
      if (from < 0 || palette.entries[from]?.role !== "outline") continue;
      const r = cel.set(x, y, TRANSPARENT);
      if (r.changed) edits.push({ x, y, from, to: TRANSPARENT });
    }
    return result(cel, edits, { policy });
  }
  const named = opts.color_role ? palette.index(opts.color_role) : -1;
  const outlineIdx = named >= 0 ? named : (byRole(palette, "outline")[0] ?? -1);
  if (outlineIdx < 0) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_outline_colour", message: `palette '${palette.id}' declares no outline-role colour`, fix: "palette_set" }], warnings: [] };
  const light = opts.light ?? [-0.7, -0.7];
  const mag = Math.hypot(light[0], light[1]) || 1;
  const lx = light[0] / mag, ly = light[1] / mag;
  const edits = [];
  let droppedInterior = 0, droppedLit = 0, added = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const i = cel.get(x, y);
    if (i < 0) continue;
    const isOutline = palette.entries[i]?.role === "outline";
    const outs = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h || cel.get(nx, ny) < 0) outs.push([dx, dy]);
    }
    if (!outs.length) {
      if (isOutline && policy !== "full-1px") { const r = cel.set(x, y, TRANSPARENT); if (r.changed) { droppedInterior++; edits.push({ x, y, from: i, to: TRANSPARENT }); } }
      continue;
    }
    const outward = outs.reduce((s, o) => [s[0] + o[0], s[1] + o[1]], [0, 0]);
    const om = Math.hypot(outward[0], outward[1]) || 1;
    const facing = (outward[0] / om) * lx + (outward[1] / om) * ly;   // > 0: this surface faces the light
    const want = policy === "full-1px" ? true : facing < 0.15;
    if (want) {
      if (i !== outlineIdx) { const r = cel.set(x, y, outlineIdx); if (r.changed) { added++; edits.push({ x, y, from: i, to: outlineIdx }); } }
    } else if (isOutline) {
      const r = cel.set(x, y, TRANSPARENT);
      if (r.changed) { droppedLit++; edits.push({ x, y, from: i, to: TRANSPARENT }); }
    }
  }
  return result(cel, edits, { policy, added, dropped_lit_side: droppedLit, dropped_interior: droppedInterior });
}

// ---- light-shaped operations: all built from ramp steps in space --------------

/**
 * specular_pass: a hard 1px line of the ramp's brightest step on the lit side of a form,
 * one per face. Not a highlight filter — the brightest authored step, placed where a hard
 * surface would actually catch the key light.
 */
function specular_pass(cel, palette, region, opts = {}) {
  const list = palette.ramp(opts.ramp);
  if (!list) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_ramp", message: `specular_pass needs a declared ramp; '${opts.ramp}' is not one` }], warnings: [] };
  const bright = list[list.length - 1];
  const light = opts.light ?? [-0.7, -0.7];
  const mag = Math.hypot(light[0], light[1]) || 1;
  const lx = light[0] / mag, ly = light[1] / mag;
  const mid = (list.length - 1) / 2;
  const edits = [];
  each(cel, region, (x, y) => {
    const i = cel.get(x, y); if (i < 0) return;
    const e = palette.entries[i];
    if (e.ramp !== opts.ramp || e.step <= mid) return;
    let facesLight = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h || cel.get(nx, ny) < 0) {
        if (dx * lx + dy * ly > 0.3) facesLight = true;
      }
    }
    if (!facesLight) return;
    if (cel.get(x - 1, y) === bright || cel.get(x, y - 1) === bright) return;   // keep the line 1px thick
    const r = cel.set(x, y, bright);
    if (r.changed) edits.push({ x, y, from: i, to: bright });
  });
  return result(cel, edits, { ramp: opts.ramp, step: bright });
}

/**
 * contact_shadow: the dark band directly under where a body meets the ground.
 * Its absence is what makes a sprite look like a sticker. Built from the palette's shadow
 * role, never from alpha.
 */
function contact_shadow(cel, palette, opts = {}) {
  const shadowIdx = palette.index("contact") >= 0 ? palette.index("contact") : byRole(palette, "shadow")[0];
  if (shadowIdx === undefined) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_shadow_colour", message: `palette '${palette.id}' declares no shadow-role colour`, fix: "palette_set" }], warnings: [] };
  const bb = cel.bbox();
  if (!bb) return result(cel, []);
  const row = opts.row ?? bb.y1 + 1;
  if (row >= cel.h) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "canvas_overflow", message: `contact shadow row ${row} is outside a ${cel.h}-row canvas`, fix: "resize_canvas" }], warnings: [] };
  const edits = [];
  const spread = opts.spread ?? 1;
  for (let x = bb.x0 - spread; x <= bb.x1 + spread; x++) {
    if (x < 0 || x >= cel.w) continue;
    if (cel.get(x, row) >= 0) continue;
    // a contact shadow hugs the contact run; it does not extend past where the body touches
    if (!(cel.get(x, row - 1) >= 0 || cel.get(x + 1, row - 1) >= 0 || cel.get(x - 1, row - 1) >= 0)) continue;
    const r = cel.set(x, row, shadowIdx);
    if (r.changed) edits.push({ x, y: row, from: TRANSPARENT, to: shadowIdx });
  }
  return result(cel, edits, { row, contact_width: bb.w });
}

/**
 * cast_shadow: a directional shadow mass thrown from the silhouette along the light axis.
 * Ramp steps arranged in space — not a multiplied alpha copy of the sprite.
 */
function cast_shadow(cel, palette, opts = {}) {
  const shadowIdx = opts.idx ?? (palette.index("contact") >= 0 ? palette.index("contact") : byRole(palette, "shadow")[0]);
  if (shadowIdx === undefined) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_shadow_colour", message: "cast_shadow needs a shadow-role colour" }], warnings: [] };
  const bb = cel.bbox();
  if (!bb) return result(cel, []);
  const light = opts.light ?? [-0.7, -0.7];
  const len = opts.length ?? 3;
  const dx = -Math.sign(light[0] || 1) * (opts.shear ?? 1);
  const edits = [];
  for (let y = bb.y1 - len + 1; y <= bb.y1; y++) {
    const k = y - (bb.y1 - len + 1);
    for (let x = bb.x0; x <= bb.x1; x++) {
      if (cel.get(x, y) < 0) continue;
      for (let d = 1; d <= len - k; d++) {
        const px = x + dx * (k + 1) + (dx >= 0 ? d : -d);
        if (px < 0 || px >= cel.w || y < 0 || y >= cel.h) continue;
        if (cel.get(px, y) >= 0) continue;
        const r = cel.set(px, y, shadowIdx);
        if (r.changed) edits.push({ x: px, y, from: TRANSPARENT, to: shadowIdx });
      }
    }
  }
  return result(cel, edits, { light, length: len });
}

/**
 * glow: a light source built from ramp steps arranged in space.
 * There is no alpha blending anywhere in this engine: a glow is authored rings of the declared
 * light-role steps, densest at the source. That is what keeps a glow on palette.
 */
function glow(cel, palette, opts = {}) {
  const steps = opts.ramp ? palette.ramp(opts.ramp) : byRole(palette, "light");
  if (!steps?.length) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "no_light_colour", message: "glow needs a light-role ramp or colour declared in the palette" }], warnings: [] };
  const [cx, cy] = opts.at;
  const radius = opts.radius ?? 2;
  const edits = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!cel.inBounds(x, y) || cel.get(x, y) >= 0) continue;
    const d = Math.hypot(dx, dy);
    if (d > radius + 0.4) continue;
    const ring = Math.round(d);
    const t = 1 - ring / (radius + 1);
    // Brightest at the source, falling off outward along the ramp. The old allocation did the reverse:
    // it put step 0 of a light ramp at the core and its brightest step at the rim, so every lamp in
    // this engine had a hollow centre — a bug that only shows up when something next to it is measured.
    const k = clamp(Math.round(t * (steps.length - 1)), 0, steps.length - 1);
    // outer rings thin out by which step occupies which cell, not by opacity: a glow that
    // fades by alpha is off-palette the moment it is exported
    if (ring > 0 && ((x * 31 + y * 17 + ring * 7) % 5) / 5 > t + 0.25) continue;
    const r = cel.set(x, y, steps[k]);
    if (r.changed) edits.push({ x, y, from: TRANSPARENT, to: steps[k] });
  }
  return result(cel, edits, { at: [cx, cy], radius, steps: steps.length });
}

// ---- transform / mirror -------------------------------------------------------

/**
 * mirror: side-view mirroring, gated by an asymmetry audit.
 * A short sword on the right hip ends up on the left hip. The audit reports what would move
 * BEFORE the mirror happens, because a silently mirrored sprite is the kind of bug that only
 * shows up 300 cels later.
 */
function mirror(cel, opts = {}) {
  const axis = opts.axis ?? "x";
  const out = new Cel(cel.w, cel.h, cel.paletteId, cel.name + ".mirror");
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const sx = axis === "x" ? cel.w - 1 - x : x;
    const sy = axis === "y" ? cel.h - 1 - y : y;
    out.idx[sy * out.w + sx] = cel.idx[y * cel.w + x];
  }
  out.offset = axis === "x" ? [-cel.offset[0], cel.offset[1]] : [cel.offset[0], -cel.offset[1]];
  out.meta = { ...cel.meta, mirroredFrom: cel.name, mirrorAxis: axis };
  const asym = asymmetryAudit(cel, opts.palette);
  const warnings = [
    "a mirror mirrors the LIGHT along with the shape. A mirrored facing inherits the original's shading, which flips the key light to the wrong side of the frame; it needs its own authored ramp placement to keep a fixed scene light (docs/03 §5).",
    ...asym.asymmetries.map(a => `asymmetry: ${a.note}`),
  ];
  return { ok: true, cel: out, asymmetry: asym, warnings };
}

/** What would move if this cel were mirrored? Held items, single-sided detail, light side. */
function asymmetryAudit(cel, palette) {
  const bb = cel.bbox();
  if (!bb) return { asymmetries: [], summary: "empty cel", centroidShift: 0 };
  const cx = (bb.x0 + bb.x1) / 2;
  const roles = new Map();
  cel.forEach((v, x, y) => {
    if (v < 0) return;
    const role = palette && palette.entries[v] ? palette.entries[v].role : "material";
    const r = roles.get(role) || { n: 0, sx: 0 };
    r.n++; r.sx += x - cx;
    roles.set(role, r);
  });
  const asymmetries = [];
  for (const [role, r] of roles) {
    if (r.n < 2) continue;
    const mean = r.sx / r.n;
    if (Math.abs(mean) > 1.2) asymmetries.push({ role, offset: +mean.toFixed(2), pixels: r.n, note: `'${role}' sits ${mean > 0 ? "right" : "left"} of the body centre by ${Math.abs(mean).toFixed(1)}px — mirroring moves it to the other side` });
  }
  return { asymmetries, summary: asymmetries.map(a => a.note).join("; ") || "no material is offset enough to matter", centroidShift: +asymmetries.reduce((s, a) => s + Math.abs(a.offset), 0).toFixed(2) };
}

/** transform: offset and flip. Scaling art is refused outright (docs/02 §5). */
function transform(cel, opts = {}) {
  if (opts.scale) return { ok: false, changed: { pixels: 0 }, region: null, violations: [{ rule: "refuse_upscale", message: "the engine refuses to scale art. Moving a design to a bigger canvas is a REDRAW with a higher detail budget, not a resize (docs/02 §5).", fix: "redraw at the target scale" }], warnings: [] };
  const out = cel.clone(cel.name);
  if (opts.offset) out.offset = [cel.offset[0] + opts.offset[0], cel.offset[1] + opts.offset[1]];
  if (opts.flip) { const m = mirror(out, { axis: opts.flip, palette: opts.palette }); return { ...result(out, []), cel: m.cel, warnings: m.warnings }; }
  return { ...result(out, []), cel: out };
}

module.exports = {
  result, rampOf, stepOf, roleOf, byRole, each, regionBounds, countComponents,
  get_pixel_map, draw_pixel_map, put, erase, replace_color, shift_along_ramp, fill_region,
  draw_line, draw_shape, stroke_shape, SHAPES,
  paint_form, aa_pass, dither_pass, outline_pass,
  specular_pass, contact_shadow, cast_shadow, glow,
  mirror, transform, asymmetryAudit,
  DITHER_PATTERNS,
};
