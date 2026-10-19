// Export: sprite sheets + engine manifests. Sheets are exported PALETTE-INDEXED,
// so a shipped file physically cannot contain a colour the style bible did not authorise.
"use strict";

const fs = require("fs");
const path = require("path");
const { encodeIndexed, encodeRGB } = require("./codec/png.js");
const { encodeGIF } = require("./codec/gif.js");

const TRANSPARENT_ENTRY = 0;

/** Pack cels into a row-major sheet with padding, and record every frame rect. */
function buildSheet(cels, opts = {}) {
  const pad = opts.pad ?? 1;
  const cols = opts.cols ?? cels.length;
  const cellW = cels.reduce((m, c) => Math.max(m, c.w), 0) + pad * 2;
  const cellH = cels.reduce((m, c) => Math.max(m, c.h), 0) + pad * 2;
  const rows = Math.ceil(cels.length / cols);
  const W = cols * cellW, H = rows * cellH;

  // Build the export palette: entry 0 is reserved transparent, then the union of used indices.
  const used = new Map();
  for (const c of cels) for (const i of c.counts().keys()) if (!used.has(i)) used.set(i, used.size + 1);

  const indices = new Int16Array(W * H).fill(-1);
  const frames = [];
  cels.forEach((cel, n) => {
    const cx = (n % cols) * cellW + pad, cy = Math.floor(n / cols) * cellH + pad;
    cel.forEach((v, x, y) => { if (v >= 0) indices[(cy + y) * W + (cx + x)] = used.get(v); });
    const bb = cel.bbox();
    frames.push({
      name: cel.name, clip: cel.meta?.clip, direction: cel.meta?.direction, pose: cel.meta?.pose,
      x: cx, y: cy, w: cel.w, h: cel.h,
      sourceSize: [cel.w, cel.h],
      offset: cel.offset,
      trimmed: bb ? { x: bb.x0, y: bb.y0, w: bb.w, h: bb.h } : null,
      duration: cel.meta?.duration ?? opts.duration ?? 120,
      events: cel.meta?.events ?? [],
    });
  });

  const palette = [[0, 0, 0], ...[...used.keys()].map(i => opts.palette.color(i))];
  return {
    width: W, height: H, cellW, cellH, cols, rows,
    png: encodeIndexed(W, H, indices, palette, TRANSPARENT_ENTRY),
    palette, frames,
    celCount: cels.length,
  };
}

/** Engine-agnostic manifest plus the two engine shapes people actually ask for. */
function buildManifest(sheet, style, palette, opts = {}) {
  const byClip = {};
  for (const f of sheet.frames) {
    const key = f.clip || "default";
    byClip[key] = byClip[key] || { frames: [], directions: {} };
    byClip[key].frames.push(f.name);
    if (f.direction) (byClip[key].directions[f.direction] = byClip[key].directions[f.direction] || []).push(f.name);
  }
  return {
    format: "pixelhand/1",
    generated: new Date().toISOString(),
    style,
    palette: palette.toManifest(),
    sheet: { image: opts.imageName || "sheet.png", width: sheet.width, height: sheet.height, cellW: sheet.cellW, cellH: sheet.cellH, cols: sheet.cols, rows: sheet.rows },
    clips: Object.entries(byClip).map(([name, v]) => {
      const lookup = n => sheet.frames.find(f => f.name === n);
      const present = Object.keys(v.directions);
      // Rows follow the DECLARED direction order from the project, not insertion order. A sheet
      // whose rows are in the order the loops happened to run in is a sheet the game engine will
      // read sideways.
      const ordered = (opts.directions || []).filter(d => present.includes(d)).concat(present.filter(d => !(opts.directions || []).includes(d)));
      const perDirection = Object.fromEntries(ordered.map(d => [d, v.directions[d]]));
      const durations = ordered.map(d => v.directions[d].map(n => lookup(n)?.duration ?? 120));
      const events = ordered.flatMap(d => v.directions[d].flatMap((n, i) => (lookup(n)?.events || []).map(e => ({ ...e, direction: d, frameIndex: i }))));
      const all = durations.flat();
      const cycle = all.reduce((s, x) => s + x, 0) || 1;
      return {
        name, frameCount: v.frames.length, frames: v.frames, fps: +(1000 / (cycle / Math.max(1, all.length / ordered.length))).toFixed(2),
        directions: v.directions, rows: perDirection,
        durations: Object.fromEntries(ordered.map((d, i) => [d, durations[i]])),
        events,
        uniform_timing: new Set(all).size === 1,
      };
    }),
    frames: sheet.frames,
    provenance: opts.provenance || { origin: "authored-in-engine", thirdPartyAssets: false },
    engines: {
      godot: { note: "import sheet.png with filter=Nearest; use frames[] as SpriteFrames regions", frames: sheet.frames.map(f => ({ name: f.name, region: [f.x, f.y, f.w, f.h], duration_ms: f.duration })) },
      phaser: { frames: sheet.frames.map(f => ({ key: f.name, frame: [f.x, f.y, f.w, f.h] })) },
      tiled: { tilewidth: sheet.cellW, tileheight: sheet.cellH, columns: sheet.cols, image: opts.imageName || "sheet.png" },
      aseprite: { note: "each frame rect maps 1:1 to an Aseprite cel; palette is the declared one", palette: palette.entries.map(e => e.rgb) },
    },
  };
}

function writeExport(dir, sheet, manifest, extraFiles = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sheet.png"), sheet.png);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [name, buf] of Object.entries(extraFiles)) fs.writeFileSync(path.join(dir, name), buf);
  return { dir, bytes: sheet.png.length };
}

/** Animated preview: the palette travels with the frames, so the preview is not a re-quantisation. */
function previewGif(cels, palette, opts = {}) {
  const frames = cels.map(c => ({ w: c.w, h: c.h, indices: c.idx, offset: c.offset }));
  const pal = [[0, 0, 0], ...palette.entries.map(e => e.rgb)];
  const map = new Map(palette.entries.map((e, i) => [i, i + 1]));
  const remapped = frames.map(f => {
    const out = new Int16Array(f.indices.length);
    for (let i = 0; i < f.indices.length; i++) out[i] = f.indices[i] < 0 ? -1 : map.get(f.indices[i]);
    return { ...f, indices: out };
  });
  return encodeGIF(remapped, pal, { delay: opts.delay ?? 12, loop: 0, transparentIndex: 0, width: opts.width, height: opts.height });
}

module.exports = { buildSheet, buildManifest, writeExport, previewGif };
