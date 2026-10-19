#!/usr/bin/env node
"use strict";
// A deterministic authored example, not a live-model evaluation result.
const path = require("path");
const { createEngine } = require("../src/index.js");
const root = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "out", "lantern-example"),
);
const engine = createEngine(root);
const call = (name, args) => {
  const r = engine.call(name, args);
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return r;
};
const style = {
  id: "lantern",
  projection: "side",
  art_scale: 16,
  palette_size: 16,
  temperature: "warm-cool-hue-shift",
  edge_policy: "full-1px",
  shading: "ramp-lit",
  detail: "moderate",
  motion: "static",
  mood: "cozy-warm",
  light_vector: [-0.7, -0.7],
};
call("project_init", {
  game: "lantern-example",
  style,
  canvas: { w: 16, h: 16 },
  directions: ["down"],
});
call("palette_set", {
  id: "lantern",
  spec: {
    ramps: {
      stone: { role: "material", colors: ["#293444", "#495768", "#7e9098"] },
      roof: { role: "material", colors: ["#633a3d", "#a05b42", "#d49357"] },
      glass: { role: "material", colors: ["#715849", "#b88649", "#f1ba67"] },
      light: { role: "light", colors: ["#ffd88a", "#fff1bd"] },
    },
    single: {
      ink: { rgb: "#202835", role: "outline" },
      ground: { rgb: "#283041", role: "shadow" },
    },
  },
});
call("sprite_create", {
  id: "lantern",
  w: 16,
  h: 16,
  palette: "lantern",
  style: "lantern",
  tier: "support",
});
call("asset_begin", {
  asset: "lantern",
  brief: "A small crooked-roof lantern, one bright window and a chipped base",
  cels: ["lantern.base"],
});
call("draw_named_map", {
  cel: "lantern.base",
  legend: {
    r: "roof.0",
    R: "roof.1",
    T: "roof.2",
    s: "stone.0",
    S: "stone.1",
    H: "stone.2",
    g: "glass.0",
    G: "glass.2",
    L: "light.1",
    l: "light.0",
    o: "ink",
    h: "ground",
  },
  map: [
    "................",
    "......rT........",
    ".....rTTRr......",
    "....rTTTRRr.....",
    "...rTTTRRRRr....",
    "..orRRRRRRRRro..",
    "...oHHHSSSSso...",
    "...oHSgGGgSso...",
    "...oHSgLLgSso...",
    "...oHSgLlgSso...",
    "...oHSgllgSso...",
    "...oHSggggSso...",
    "...oHHSSSSSso...",
    "...oHSSSSSso....",
    "..oooooooSoooo..",
    "..hhhhhhhhhhhh..",
  ],
});
call("mask_define", {
  cel: "lantern.base",
  name: "window",
  region: { x: 6, y: 7, w: 4, h: 5 },
  protect: true,
});
for (const [stage, evidence] of [
  [
    "silhouette",
    "Authored the crooked roof and chipped base on a 16-pixel canvas",
  ],
  ["blocking", "Separated roof, stone and glass with named palette colours"],
  ["lighting", "Placed warm window light and cool stone shadow clusters"],
  ["detail", "Protected the window pixels and kept the identifying roof break"],
  [
    "review",
    "Rendered native-scale, value and silhouette reviews for inspection",
  ],
])
  call("asset_advance", { asset: "lantern", stage, evidence });
call("save_cel", { cel: "lantern.base", sprite: "lantern", cel_key: "base" });
const review = call("review_bundle", { cel: "lantern.base", zoom: 20 });
const png = call("export_indexed_png", {
  cel: "lantern.base",
  name: "lantern",
});
console.log(
  JSON.stringify(
    { root, png: png.file, reviews: review.images, visual_approval: "pending" },
    null,
    2,
  ),
);
