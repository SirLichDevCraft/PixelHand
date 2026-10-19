// Engine targets are ADAPTERS, not a list. docs/08 §6.
// Adding a target is adding an adapter file, not changing the engine. The art data model never
// bends to accommodate an engine; the adapter does.
//
// These are output FORMATS only. No third-party code, assets or palettes enter the project
// because we can export to them (docs/07 §1).
"use strict";

const { buildSheet, buildManifest } = require("./export.js");
const { encodeIndexed } = require("./codec/png.js");
const { encodeGIF } = require("./codec/gif.js");
const { blobSet } = require("./core/tiles.js");

/** Godot SpriteFrames .tres-shaped JSON: regions into one texture, per-animation frame lists. */
function godot(manifest) {
  const animations = {};
  for (const clip of manifest.clips) {
    for (const [dir, frames] of Object.entries(clip.directions)) {
      animations[`${clip.name}_${dir}`] = frames.map(name => {
        const f = manifest.frames.find(x => x.name === name);
        return { texture: manifest.sheet.image, region: [f.x, f.y, f.w, f.h], duration: (f.duration ?? 120) / 1000 };
      });
    }
  }
  return { format: "godot-spriteframes/1", note: "import the sheet with filter=Nearest; do not let the engine resample indexed art", anchor_unit: "pixels", anchor: manifest.anchor, animations, events: manifest.clips.map(c => ({ clip: c.name, events: c.events })) };
}

/** Phaser frames + animations, durations converted to ms. */
function phaser(manifest) {
  const frames = {};
  for (const f of manifest.frames) frames[f.name] = { x: f.x, y: f.y, width: f.w, height: f.h };
  const animations = {};
  for (const clip of manifest.clips) {
    for (const [dir, framesList] of Object.entries(clip.directions)) {
      animations[`${clip.name}_${dir}`] = { frames: framesList.map(n => ({ key: manifest.sheet.image.replace(/\.png$/, ""), frame: n })), frameRate: clip.fps, repeat: -1 };
    }
  }
  return { format: "phaser/1", asset: { key: manifest.sheet.image.replace(/\.png$/, ""), url: manifest.sheet.image }, frames, animations, events: manifest.clips.map(c => ({ clip: c.name, events: c.events })) };
}

/** Tiled TSJSON tileset shape. */
function tiled(manifest) {
  return {
    format: "tiled-tsjson/1", tilewidth: manifest.sheet.cellW, tileheight: manifest.sheet.cellH,
    spacing: 0, margin: 0, columns: manifest.sheet.cols, image: manifest.sheet.image,
    imageheight: manifest.sheet.height, imagewidth: manifest.sheet.width,
    tiles: manifest.frames.map((f, i) => ({ id: i, image: manifest.sheet.image, x: f.x, y: f.y, width: f.w, height: f.h, animation: f.animation_frames || undefined })),
    tilecount: manifest.frames.length,
  };
}

/**
 * Aseprite-COMPATIBLE sheet layout: frame rects plus the declared palette, so the user can open
 * the export in whatever editor they choose and polish by hand. That is output interoperability
 * only — no third-party code, assets or palettes enter this project because of it (docs/07 §1).
 */
function aseprite(manifest) {
  return {
    format: "aseprite-compatible/1",
    note: "each frame rect maps 1:1 to an Aseprite cel. Import the indexed PNG; the palette below is the declared one, so a hand edit cannot leave the bible.",
    image: manifest.sheet.image,
    frames: manifest.frames.map(f => ({ name: f.name, x: f.x, y: f.y, w: f.w, h: f.h, duration: f.duration ?? 120 })),
    palette: manifest.palette.entries.map((e, i) => ({ index: i + 1, name: e.name, rgb: e.rgb })),
    layers: manifest.layers || [{ id: "body", z: 0 }],
  };
}

/** html5-canvas: one sheet, one manifest, nearest-neighbour drawing rules stated. */
function html5canvas(manifest) {
  return {
    format: "html5-canvas/1",
    image: manifest.sheet.image,
    draw: { imageSmoothingEnabled: false, scaling: "integer only" },
    clips: manifest.clips.map(c => ({ name: c.name, fps: c.fps, durations: c.durations, rows: c.rows, events: c.events })),
    anchor: manifest.anchor,
  };
}

/** generic-json: the engine's own shape, which is the one everything else is derived from. */
function generic(manifest) { return { format: "pixelhand/1", ...manifest }; }

const ADAPTERS = { godot, phaser, tiled, unity: godot, aseprite, "html5-canvas": html5canvas, generic };

function adapt(manifest, target) {
  const fn = ADAPTERS[target];
  if (!fn) return { ok: false, reason: `unknown target '${target}'. Legal: ${Object.keys(ADAPTERS).join(", ")}` };
  return { ok: true, target, manifest: fn(manifest) };
}

/**
 * export_tileset: the 47-slot autotile sheet plus the bitmask bookkeeping the game engine needs
 * to select them. The engine resolves the bitmask; the authored tiles are the art.
 */
function export_tileset(tiles, palette, opts = {}) {
  const set = blobSet();
  const byId = new Map(tiles.map(t => [t.blobId, t]));
  const missing = set.filter(s => !byId.has(s.id));
  const ordered = set.map(s => byId.get(s.id)).filter(Boolean);
  const sheet = buildSheet(ordered.map(t => t.cel), { cols: opts.cols ?? 8, palette, pad: opts.pad ?? 1 });
  const index = set.map(s => {
    const t = byId.get(s.id);
    return { slot: s.id, name: s.name, edges: s.edges, corners: s.corners, cell: t ? [t.cel.name] : null, rect: t ? sheet.frames[set.indexOf(s)] : null };
  });
  return {
    ok: missing.length === 0, sheet, index,
    missing: missing.map(m => ({ slot: m.id, name: m.name, edges: m.edges, corners: m.corners })),
    bitmask: { layout: "TL=1 T=2 TR=4 R=8 BR=16 B=32 BL=64 L=128", rule: "a corner is filled only when the corner neighbour and both edge neighbours touching it are filled" },
  };
}

function export_gif(cels, palette, opts = {}) {
  const pal = [[0, 0, 0], ...palette.entries.map(e => e.rgb)];
  // Nearest-neighbour integer upscale. A 16x32 animation played at 1x is 16 pixels wide, which is
  // not a review surface - it is a squint test nobody can perform. Integer replication only: no
  // resampling, no blending, no new colours.
  const z = Math.max(1, Math.floor(opts.zoom ?? 1));
  const frames = cels.map(c => {
    const src = Int16Array.from(c.idx, v => v < 0 ? -1 : v + 1);
    const w = c.w * z, h = c.h * z;
    const indices = new Int16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) indices[y * w + x] = src[((y / z) | 0) * c.w + ((x / z) | 0)];
    return {
      w, h,
      indices,
      offset: [(c.offset?.[0] ?? 0) * z, (c.offset?.[1] ?? 0) * z],
      delay: Math.max(2, Math.round((c.meta?.duration ?? opts.delay ?? 120) / 10)),
    };
  });
  return encodeGIF(frames, pal, { loop: 0, transparentIndex: 0, width: opts.width, height: opts.height });
}

function export_indexed_png(cel, palette) {
  const pal = [[0, 0, 0], ...palette.entries.map(e => e.rgb)];
  return encodeIndexed(cel.w, cel.h, Int16Array.from(cel.idx, v => v < 0 ? -1 : v + 1), pal, 0);
}

module.exports = { adapt, ADAPTERS, godot, phaser, tiled, aseprite, html5canvas, generic, export_tileset, export_gif, export_indexed_png };
