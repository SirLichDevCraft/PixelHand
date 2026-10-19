// The authoring layer: how an asset goes from hand-placed shape to lit, palette-legal pixels.
//
// This is pim.js's technique lifted out of Pim and made reusable, because Phase 0.5 proved the
// binding constraint is design and Phase 3 proved where shading must happen:
//
//   1. SHAPE is authored by hand, one pixel at a time, as a text grid. Each cell carries its own
//      MATERIAL letter, so a blade, a haft and a brass guard are three decisions made while drawing,
//      not three regions discovered afterwards. No shape primitive draws anything organic here — the
//      grids are the art (docs/09 §1, docs/08 "no procedural drawing primitives for organic form").
//   2. COLOUR is derived along each region's OWN extent against ONE declared light field. Not per
//      part bounding box (that produced flat_mass on a 52px leg), not per whole canvas (that gave a
//      4px cap one value across all four). A region is modelled across its own filled row-extent and
//      its own height span, which is what "lit from the upper left" means when the region is thin.
//   3. ACCENTS are placed, never implied (docs/09: an accent you did not put there is not an accent).
//      Authored as their own grid letter so their coordinates are visible in git.
//   4. SEAMS are repaired where they appear — on composed frames for rigged assets (pim.js), and at
//      material boundaries here — because pre-compensating every part for every pose it could be put
//      into makes the parts wrong in isolation.
"use strict";

const { Cel, TRANSPARENT } = require("./core/cel.js");

/** Place a tightly-authored grid onto a declared canvas at an authored offset. The canvas size is a
 *  design decision (docs/08 axis B); the grid is what was drawn. Padding here rather than drawing
 *  empty rows by hand keeps the authored pixels and the canvas declaration separate. */
function padGrid(rows, w, h, dx = 0, dy = 0) {
  const out = Array.from({ length: h }, () => ".".repeat(w));
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) out[y + dy] = out[y + dy].slice(0, x + dx) + rows[y][x] + out[y + dy].slice(x + dx + 1);
  return out;
}

/** Characters used in an authored grid. '.' and ' ' are air; '#' is the default material. */
function parseShape(rows, opts = {}) {
  const map = { "#": opts.defaultMaterial || "body", ...(opts.map || {}) };
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const cel = new Cel(w, h, opts.paletteId || null, opts.name);
  const materials = new Map();          // "x,y" -> material name | {material, role}
  const accents = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x] === undefined ? "." : row[x];
      if (ch === "." || ch === " ") continue;
      if (ch === "+") { accents.push([x, y]); cel.set(x, y, 0); materials.set(`${x},${y}`, { material: opts.defaultMaterial || "body" }); continue; }
      const m = map[ch];
      if (!m) throw Object.assign(new Error(`grid char '${ch}' at ${x},${y} of '${opts.name}' has no material mapping`), { rule: "unknown_grid_char" });
      if (typeof m === "string") { cel.set(x, y, 0); materials.set(`${x},${y}`, { material: m }); }
      else { cel.set(x, y, 0); materials.set(`${x},${y}`, m); }   // {material:"steel", role:"accent"} etc.
    }
  }
  return { cel, materials, accents };
}

/** 4-connected regions of one material. Same definition the audit uses (craft.regions). */
function regionsOf(cel, materialAt) {
  const seen = new Int16Array(cel.w * cel.h).fill(-1);
  const out = [];
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    if (cel.get(x, y) === TRANSPARENT || seen[y * cel.w + x] >= 0) continue;
    const key = materialAt(x, y); if (!key) continue;
    const cells = [], stack = [[x, y]];
    seen[y * cel.w + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!cel.inBounds(nx, ny) || seen[ny * cel.w + nx] >= 0) continue;
        if (cel.get(nx, ny) === TRANSPARENT) continue;
        const other = materialAt(nx, ny);
        if (!other || other.material !== key.material) continue;
        seen[ny * cel.w + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    out.push({ ...key, cells });
  }
  return out.filter(r => r.material);
}

/**
 * Light across a region: measured along each row's own filled extent (horizontal modelling) and the
 * region's height span (vertical modelling), weighted by the declared light vector. A light from the
 * upper left puts weight on the x-extent first; a top-down light inverts that. Either way the region
 * reaches both ends of its ramp because the measurement is taken across the region, not around it.
 */
function modelRegion(cel, palette, region, opts = {}) {
  const list = palette.ramp(region.material);
  if (!list || !list.length) return null;                       // single-colour role: nothing to model
  const steps = list.length;
  const lx = Math.abs(opts.light?.[0] ?? -1), ly = Math.abs(opts.light?.[1] ?? -1);
  const litFromLeft = (opts.light?.[0] ?? -1) <= 0;
  const litFromTop = (opts.light?.[1] ?? -1) <= 0;
  const wx = lx + ly === 0 ? 0.5 : lx / (lx + ly);
  const wy = 1 - wx;
  const ys = region.cells.map(c => c[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys), hSpan = y1 - y0;
  const byRow = new Map();
  for (const [x, y] of region.cells) { if (!byRow.has(y)) byRow.set(y, []); byRow.get(y).push(x); }
  let used = new Set();
  for (const [y, xs] of byRow) {
    const xlo = Math.min(...xs), xhi = Math.max(...xs), spanX = xhi - xlo;
    const ty = hSpan ? (y - y0) / hSpan : null;                       // height across the whole region
    for (const x of xs) {
      // Width is measured across this run only, per cell: a nine-cell collar and a two-cell post must both
      // reach both ends of their ramps even though they sit at the same height in the region.
      const tx = spanX ? (x - xlo) / spanX : null;
      const hx = tx === null ? (litFromLeft ? 1 : 0) : (litFromLeft ? 1 - tx : tx);
      const hy = ty === null ? (litFromTop ? 1 : 0) : (litFromTop ? 1 - ty : ty);
      if (tx === null && ty === null) { const s = Math.floor((steps - 1) / 2); cel.set(x, y, list[s]); used.add(list[s]); continue; }   // a lone cell has no extent to model
      const v = wx * hx + wy * hy;
      const step = Math.max(0, Math.min(steps - 1, Math.round(v * (steps - 1))));
      cel.set(x, y, list[step]); used.add(list[step]);
    }
  }
  return { stepsUsed: used.size, ramp: region.material };
}

/** Place the declared focal accent. Coordinates come from the grid ('+') or an explicit list. */
function placeAccents(cel, palette, accents, roleColor) {
  // Nothing declared as the thing to look at is a design finding for `audit` to report
  // (`no_focal_accent`), not a crash in the authoring pipeline. A 2-colour asset has no third
  // colour to declare as an accent, and refusing to author it at all would hide the finding
  // behind an exception. An accent that WAS drawn but has no colour is still a refusal.
  if (!accents.length) return 0;
  const idx = typeof roleColor === "string" ? palette.index(roleColor) : roleColor;
  if (idx < 0) throw Object.assign(new Error(`accent colour '${roleColor}' is not in the palette, and ${accents.length} cell(s) are marked as the focal accent`), { rule: "accent_missing" });
  let n = 0;
  for (const [x, y] of accents) { if (cel.get(x, y) !== TRANSPARENT) { cel.set(x, y, idx); n++; } }
  return n;
}

/** The darkest authored colour on the bottom row of a grounded mass: what makes it stand ON something. */
function groundSole(cel, palette, soleColor) {
  const idx = typeof soleColor === "string" ? palette.index(soleColor) : soleColor;
  const bb = cel.bbox(); if (!bb || idx < 0) return 0;
  let n = 0;
  for (let x = bb.x0; x <= bb.x1; x++) if (cel.get(x, bb.y1) !== TRANSPARENT) { cel.set(x, bb.y1, idx); n++; }
  return n;
}

/** Bridge same-ramp seams left by two regions modelled independently. Same routine pim.js uses. */
function bridgeSeams(cel, palette) {
  if (!palette) return { cel, bridges: 0 };
  let bridges = 0;
  for (let pass = 0; pass < 8; pass++) {
    let moved = 0;
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const a = cel.get(x, y); if (a < 0) continue;
      const ea = palette.entries[a]; if (!ea || !ea.ramp) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const b = cel.get(x + dx, y + dy); if (b < 0) continue;
        const eb = palette.entries[b]; if (!eb || !eb.ramp || eb.ramp !== ea.ramp) continue;
        const d = Math.abs(ea.step - eb.step);
        if (d < 3) continue;
        const sameCount = (px, py, step) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([ox, oy]) => cel.get(px + ox, py + oy))
          .filter(i => i >= 0 && palette.entries[i] && palette.entries[i].ramp === ea.ramp && palette.entries[i].step === step).length;
        const moveA = sameCount(x, y, ea.step) <= sameCount(x + dx, y + dy, eb.step);
        const [mx, my, from, to] = moveA ? [x, y, ea, eb] : [x + dx, y + dy, eb, ea];
        const idx = palette.ramp(ea.ramp)[from.step + Math.sign(to.step - from.step)];
        if (idx == null) continue;
        cel.set(mx, my, idx); bridges++; moved++;
      }
    }
    if (!moved) break;
  }
  return { cel, bridges };
}

/** "A colour used exactly once reads as dirt." Fixed where it was made rather than reported later. */
function repairSingletons(cel, palette, extraProtected = []) {
  const exemptRole = new Set(["accent", "detail", "light", "outline", "specular"]);
  const protectedIdx = new Set([...extraProtected]);
  cel.forEach((v) => { if (v >= 0 && palette?.entries[v] && exemptRole.has(palette.entries[v].role)) protectedIdx.add(v); });
  for (let pass = 0; pass < 6; pass++) {
    const counts = new Map();
    cel.forEach((v) => { if (v !== TRANSPARENT) counts.set(v, (counts.get(v) || 0) + 1); });
    let fixed = 0;
    for (const [idx, n] of counts) {
      if (n !== 1 || protectedIdx.has(idx)) continue;
      let at = null;
      cel.forEach((v, x, y) => { if (v === idx && !at) at = { x, y }; });
      if (!at) continue;
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => cel.get(at.x + dx, at.y + dy)).filter(v => v !== TRANSPARENT);
      const shared = neighbours.filter(v => (counts.get(v) || 0) > 1);
      const pool = shared.length ? shared : neighbours;
      if (!pool.length) continue;                                // an island: leave it to detached_speck
      pool.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));
      cel.set(at.x, at.y, pool[0]);
      fixed++;
    }
    if (!fixed) break;
  }
  return cel;
}

/** Dark selective outline on the silhouette edge against a dark background render. */
function outlineEdge(cel, palette, opts = {}) {
  const roleColor = opts.color || "outline";
  const idx = typeof roleColor === "string" ? palette.index(roleColor) : roleColor;
  if (idx < 0) throw Object.assign(new Error(`outline colour '${roleColor}' is not in the palette`), { rule: "outline_missing" });
  const skipRole = new Set(opts.skipRoles || ["accent", "light"]);
  let n = 0;
  const solid = (x, y) => cel.inBounds(x, y) && cel.get(x, y) >= 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const v = cel.get(x, y); if (v < 0) continue;
    if (skipRole.has(palette.entries[v]?.role)) continue;
    // Selective: outline only where the mass meets air AND on the side away from the light.
    const litSide = (opts.light?.[1] ?? -1) <= 0 ? [0, -1] : [0, 1];
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const openNeighbours = neighbours.filter(([dx, dy]) => !solid(x + dx, y + dy));
    if (!openNeighbours.length) continue;                       // interior pixel
    // Selective, and it has to be selective the way a draughtsman is: outline the silhouette where it turns
    // away from the light, and let the lit edges keep their modelling. Outlining everything replaces form with
    // a border, which is how stamped-out pixel art gets made.
    const shadow = opts.shadow || [litSide[0] * -1, litSide[1] * -1];            // the side the light does not reach
    const opensOnShadowSide = openNeighbours.some(([dx, dy]) => dx === shadow[0] && dy === shadow[1]);
    if (!opensOnShadowSide) continue;                      // a lit or sideways edge keeps its own value
    cel.set(x, y, idx); n++;
  }
  return { cel, outlined: n };
}

/** Full authored-pixel pipeline for one asset. Returns the cel plus what was done to it. */
function authorAsset(rows, opts) {
  const palette = opts.palette;
  const { cel, materials, accents } = parseShape(rows, opts);
  const materialAt = (x, y) => materials.get(`${x},${y}`);
  const regions = regionsOf(cel, materialAt);
  const modelled = [];
  for (const region of regions) {
    const r = modelRegion(cel, palette, region, opts);
    if (r) modelled.push({ ramp: r.ramp, cells: region.cells.length, stepsUsed: r.stepsUsed });
  }
  placeAccents(cel, palette, [...accents, ...(opts.extraAccents || [])], opts.accentColor || "accent");
  if (opts.soleColor) groundSole(cel, palette, opts.soleColor);
  bridgeSeams(cel, palette);
  if (opts.outline) outlineEdge(cel, palette, { ...opts.outline, light: opts.light });
  repairSingletons(cel, palette, opts.protected || []);
  return { cel, regions: regions.length, modelled };
}

module.exports = { parseShape, regionsOf, modelRegion, placeAccents, groundSole, bridgeSeams, repairSingletons, outlineEdge, authorAsset, padGrid };
