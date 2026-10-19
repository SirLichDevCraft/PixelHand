// Tiles, autotiling, seams, variants, structures. docs/06.
//
// The division of labour is the whole point: the engine owns the BITMASK BOOKKEEPING and the
// agent authors the 47 TILES. Getting that division backwards is what makes a procedurally
// generated tileset look procedural.
//
// Seamlessness is a test, not an intention. A tile that "looks seamless" on its own and shows a
// visible line when tiled four times is not seamless, and tile_edge_check says so numerically.
"use strict";

const { Cel } = require("./cel.js");
const { craftScore, luma } = require("../craft.js");
const { assertStyle } = require("./style.js");

// ---- the 47-tile blob set -----------------------------------------------------
// Bit layout for a neighbour configuration:
//   bit0 TL  bit1 T  bit2 TR  bit3 R  bit4 BR  bit5 B  bit6 BL  bit7 L
// A corner is FILLED only when the corner neighbour and both edge neighbours touching it are
// filled — which is the rule that collapses 256 neighbour configurations to 47 tiles.
const BLOB_BITS = { TL: 1, T: 2, TR: 4, R: 8, BR: 16, B: 32, BL: 64, L: 128 };
const CORNER_NEEDS = { TL: ["T", "L"], TR: ["T", "R"], BR: ["B", "R"], BL: ["B", "L"] };

function blobCorners(mask) {
  const out = {};
  for (const [corner, [a, b]] of Object.entries(CORNER_NEEDS)) out[corner] = !!(mask & BLOB_BITS[corner]) && !!(mask & BLOB_BITS[a]) && !!(mask & BLOB_BITS[b]);
  return out;
}
function blobEdges(mask) {
  return { T: !!(mask & BLOB_BITS.T), R: !!(mask & BLOB_BITS.R), B: !!(mask & BLOB_BITS.B), L: !!(mask & BLOB_BITS.L) };
}

/** Enumerate the 47 canonical tiles. Deterministic order, so a tileset id is stable forever. */
function blobSet() {
  const out = [];
  const edgeMasks = [0, BLOB_BITS.T, BLOB_BITS.R, BLOB_BITS.B, BLOB_BITS.L,
    BLOB_BITS.T | BLOB_BITS.R, BLOB_BITS.R | BLOB_BITS.B, BLOB_BITS.B | BLOB_BITS.L, BLOB_BITS.L | BLOB_BITS.T,
    BLOB_BITS.T | BLOB_BITS.B, BLOB_BITS.L | BLOB_BITS.R,
    BLOB_BITS.T | BLOB_BITS.R | BLOB_BITS.B, BLOB_BITS.R | BLOB_BITS.B | BLOB_BITS.L,
    BLOB_BITS.B | BLOB_BITS.L | BLOB_BITS.T, BLOB_BITS.L | BLOB_BITS.T | BLOB_BITS.R,
    BLOB_BITS.T | BLOB_BITS.R | BLOB_BITS.B | BLOB_BITS.L];
  for (const em of edgeMasks) {
    const e = blobEdges(em);
    const allowed = Object.keys(CORNER_NEEDS).filter(c => e[CORNER_NEEDS[c][0]] && e[CORNER_NEEDS[c][1]]);
    for (let sub = 0; sub < (1 << allowed.length); sub++) {
      const corners = {};
      allowed.forEach((c, i) => { corners[c] = !!(sub & (1 << i)); });
      out.push({ id: out.length, edges: e, corners, edge_mask: em, name: blobName(e, corners) });
    }
  }
  return out;
}

function blobName(e, c) {
  if (!e.T && !e.R && !e.B && !e.L) return "isolated";
  if (e.T && e.R && e.B && e.L) return c.TL || c.TR || c.BR || c.BL ? "fill-cornered" : "fill";
  const sides = ["T", "R", "B", "L"].filter(k => e[k]).join("");
  const cs = ["TL", "TR", "BR", "BL"].filter(k => c[k]).join("");
  return `${sides}${cs ? "+" + cs : ""}`;
}

/** Resolve a neighbour configuration to one of the 47 canonical tile ids. */
function blobIndex(mask) {
  const e = blobEdges(mask), c = blobCorners(mask);
  const set = blobSet();
  const hit = set.find(t => ["T", "R", "B", "L"].every(k => t.edges[k] === e[k]) && ["TL", "TR", "BR", "BL"].every(k => t.corners[k] === c[k]));
  return hit ? hit.id : -1;
}

/** Neighbour mask for a cell in a filled-grid boolean map. */
function neighbourMask(filled, w, h, x, y) {
  const at = (px, py) => (px >= 0 && py >= 0 && px < w && py < h) ? !!filled[py * w + px] : false;
  let m = 0;
  if (at(x - 1, y - 1)) m |= BLOB_BITS.TL;
  if (at(x, y - 1)) m |= BLOB_BITS.T;
  if (at(x + 1, y - 1)) m |= BLOB_BITS.TR;
  if (at(x + 1, y)) m |= BLOB_BITS.R;
  if (at(x + 1, y + 1)) m |= BLOB_BITS.BR;
  if (at(x, y + 1)) m |= BLOB_BITS.B;
  if (at(x - 1, y + 1)) m |= BLOB_BITS.BL;
  if (at(x - 1, y)) m |= BLOB_BITS.L;
  return m;
}

// ---- seam testing -------------------------------------------------------------

/**
 * tile_edge_check: compare the right edge column against the left edge column and the bottom
 * row against the top row. Reports the discontinuity in luminance AND hue, because a seam that
 * is invisible in luminance and obvious in hue is still a seam.
 */
function tile_edge_check(cel, palette) {
  const colL = [], colR = [], rowT = [], rowB = [];
  for (let y = 0; y < cel.h; y++) { colL.push(cel.get(0, y)); colR.push(cel.get(cel.w - 1, y)); }
  for (let x = 0; x < cel.w; x++) { rowT.push(cel.get(x, 0)); rowB.push(cel.get(x, cel.h - 1)); }
  const score = (a, b) => {
    let dv = 0, dh = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      const ia = a[i], ib = b[(i + b.length - 1) % b.length];   // wrapping continuation
      if (ia < 0 || ib < 0) continue;
      n++;
      const la = luma(palette.color(ia)), lb = luma(palette.color(ib));
      dv += Math.abs(la - lb);
      const ha = palette.entries[ia].ramp, hb = palette.entries[ib].ramp;
      if (ha !== hb) dh += 1;
    }
    return { mean_luma_break: n ? +(dv / n).toFixed(4) : 0, material_breaks: dh, compared: n };
  };
  const h = score(colR, colL), v = score(rowB, rowT);
  const threshold = 0.055;
  return {
    ok: h.mean_luma_break <= threshold && v.mean_luma_break <= threshold && h.material_breaks === 0 && v.material_breaks === 0,
    horizontal: h, vertical: v,
    material_breaks_total: h.material_breaks + v.material_breaks,
    verdict: h.mean_luma_break > threshold || v.mean_luma_break > threshold
      ? `seam visible: a ${threshold} luminance step is the threshold at which a tiled edge reads as a line; horizontal ${h.mean_luma_break}, vertical ${v.mean_luma_break}`
      : h.material_breaks + v.material_breaks > 0
        ? `luminance continues but ${h.material_breaks + v.material_breaks} edge pixel(s) cross into a different material ramp — a seam that passes luminance and fails hue still reads`
        : "seamless under a 4x4 repeat",
  };
}

/** Repeat a tile NxN and audit the result, which is the only honest way to see a seam. */
function tileRepeat(cel, n = 4) {
  const out = new Cel(cel.w * n, cel.h * n, cel.paletteId, cel.name + "_x" + n);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const v = cel.get(x, y);
      if (v >= 0) out.set(tx * cel.w + x, ty * cel.h + y, v);
    }
  }
  return out;
}

// ---- variants: constrained, because a patchwork floor is a variant bug ---------

/**
 * Variants differ in texture cluster placement and ramp step, NEVER in hue or value mean.
 * Variants whose mean luminance differs are the classic cause of a tiled floor looking like
 * a patchwork, so variant_lint measures exactly that and refuses the offender.
 */
function variant_lint(variants, palette) {
  const stats = variants.map(v => {
    const vs = [];
    v.cel.forEach((i) => { if (i >= 0) vs.push(luma(palette.color(i))); });
    const mean = vs.reduce((s, x) => s + x, 0) / Math.max(1, vs.length);
    const ramps = new Set();
    v.cel.forEach((i) => { if (i >= 0) ramps.add(palette.entries[i].ramp); });
    return { name: v.name, mean_luma: +mean.toFixed(4), ramps: [...ramps].sort(), clusters: craftClusters(v.cel) };
  });
  const means = stats.map(s => s.mean_luma);
  const spread = Math.max(...means) - Math.min(...means);
  const rampSets = new Set(stats.map(s => s.ramps.join(",")));
  const problems = [];
  if (spread > 0.03) problems.push({ rule: "variant_luma_drift", spread: +spread.toFixed(4), message: `variant mean luminance spreads ${spread.toFixed(3)}; above 0.03 a tiled floor reads as a patchwork` });
  if (rampSets.size > 1) problems.push({ rule: "variant_ramp_drift", message: `variants use different material ramps (${[...rampSets].join(" | ")}); per-tile palettes are how a tileset stops looking like one place` });
  const seen = new Map();
  stats.forEach((s, i) => {
    const key = variants[i].cel.toGrid();
    if (seen.has(key)) problems.push({ rule: "variant_identical", message: `'${s.name}' is pixel-identical to '${seen.get(key)}'. A variant that is not different is not a variant; it is the same tile counted twice.` });
    else seen.set(key, s.name);
  });
  return { ok: problems.length === 0, problems, stats };
}

function craftClusters(cel) {
  const seen = new Set(); const sizes = [];
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const i = cel.get(x, y);
    if (i < 0 || seen.has(y * cel.w + x)) continue;
    const st = [y * cel.w + x]; seen.add(y * cel.w + x); let n = 0;
    while (st.length) {
      const p = st.pop(); n++;
      const px = p % cel.w, py = (p - px) / cel.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h) continue;
        const q = ny * cel.w + nx;
        if (cel.get(nx, ny) === i && !seen.has(q)) { seen.add(q); st.push(q); }
      }
    }
    sizes.push(n);
  }
  return { clusters: sizes.length, mean: +(sizes.reduce((s, n) => s + n, 0) / Math.max(1, sizes.length)).toFixed(2), slab: sizes.filter(n => n > 24).length };
}

// ---- tileset audit ------------------------------------------------------------

/**
 * tileset_audit: all 47 present, each tile's edges match its neighbours, no tile exceeds the
 * palette cap, and the whole set passes assert_style. A tileset is one asset, not 47 assets.
 */
function tileset_audit(tiles, palette, style, opts = {}) {
  const problems = [];
  const byId = new Map(tiles.map(t => [t.blobId, t]));
  const missing = blobSet().filter(b => !byId.has(b.id)).map(b => `${b.id} ${b.name}`);
  if (missing.length) problems.push({ rule: "blob_set_incomplete", count: missing.length, message: `${missing.length} of 47 autotile slots missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}` });
  const caps = new Map();
  for (const t of tiles) {
    const used = t.cel.counts().size;
    caps.set(t.cel.counts().size, (caps.get(t.cel.counts().size) || 0) + 1);
    if (style.palette_size && used > style.palette_size) problems.push({ rule: "palette_cap", tile: t.name, used, cap: style.palette_size, message: `tile '${t.name}' uses ${used} colours; cap is ${style.palette_size}` });
    const a = assertStyle(t.cel, style, palette, { assetClass: "tile" });
    if (!a.ok) problems.push({ rule: "tile_style", tile: t.name, violations: a.violations.map(v => v.rule) });
    const e = tile_edge_check(t.cel, palette);
    if (!e.ok) problems.push({ rule: "tile_seam", tile: t.name, message: e.verdict });
  }
  // shared-ramp rule: every tile naming a material must use that material's one ramp
  const rampUse = new Map();
  for (const t of tiles) t.cel.forEach((i) => { if (i >= 0) { const r = palette.entries[i].ramp; if (r) rampUse.set(r, (rampUse.get(r) || 0) + 1); } });
  return {
    ok: problems.length === 0, problems,
    tiles: tiles.length, palette_cap_profile: [...caps.entries()].map(([n, c]) => `${n} colours x${c}`),
    ramps_shared_across_set: [...rampUse.entries()].map(([r, n]) => `${r} used by ${n} tile(s)`),
  };
}

// ---- structures: multi-tile props with a declared footprint -------------------

/**
 * A multi-tile prop is ONE sprite with a declared footprint, not a pile of tiles.
 * The footprint drives occlusion and depth sorting, and depth sorting done wrong in the art
 * is unrecoverable — so it is declared in the manifest, not guessed at runtime.
 */
function structure(id, cel, opts = {}) {
  const bb = cel.bbox();
  const tile = opts.tile ?? 16;
  return {
    id, canvas: [cel.w, cel.h],
    footprint: opts.footprint ?? [Math.ceil((bb?.w ?? cel.w) / tile), Math.ceil((bb?.h ?? cel.h) / tile)],
    contact_row: opts.contact_row ?? bb?.y1 ?? cel.h - 1,
    anchor: opts.anchor ?? [(bb?.x0 ?? 0) + (bb?.w ?? cel.w) / 2, bb?.y1 ?? cel.h - 1],
    occludes: opts.occludes ?? [],
    note: "Depth sorting is a data problem, not an art problem: the engine exports footprints and contact rows, the game engine sorts.",
  };
}

module.exports = { BLOB_BITS, blobSet, blobIndex, blobName, neighbourMask, tile_edge_check, tileRepeat, variant_lint, tileset_audit, structure, craftClusters };
