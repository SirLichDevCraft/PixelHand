// PixelHand showcase: an original cozy farmstead house, authored through the tool surface.
// Run: node bench/showcase-farmhouse.js
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS, W } = require("../src/tools.js");
const { charFor } = require("../src/core/cel.js");
const render = require("../src/render.js");
const { encodeRGB } = require("../src/codec/png.js");

const ROOT = path.join(__dirname, "..", "showcase", "farmhouse");
const WID = 64, HEI = 64;
const STYLE = {
  id: "farmstead-cozy", projection: "three-quarter", art_scale: 48, palette_size: 24,
  temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "static", mood: "cozy-warm", light_vector: [-0.7, -0.7],
  signature: "sun-warmed cream siding, a red clay roof, cool blue window glass, and a small brass detail",
};
const PALETTE_ID = "farmhouse";
const PALETTE = {
  ramps: {
    roof:  { role: "material", colors: ["#64313a", "#914044", "#bd574c", "#e47a59"] },
    wall:  { role: "material", colors: ["#8a634e", "#bd9167", "#e0bb83", "#f2d9a0"] },
    wood:  { role: "material", colors: ["#44313a", "#765044", "#a87952"] },
    glass: { role: "material", colors: ["#304a5b", "#4c7788", "#88b4b2"] },
    stone: { role: "material", colors: ["#4a4650", "#77717a", "#aaa18e"] },
    leaf:  { role: "material", colors: ["#344a3b", "#54704b", "#849259"] },
  },
  single: {
    ink:    { rgb: "#302631", role: "outline" },
    brass:  { rgb: "#f1c45f", role: "accent" },
    ground: { rgb: "#201a25", role: "shadow" },
  },
};

const REPORT_TOOLS = new Set(["audit", "view", "silhouette", "squint", "value_map", "game_scale", "craft_metrics"]);
const must = (name, args) => {
  const result = TOOLS[name].run(args);
  if (result?.ok === false && !REPORT_TOOLS.has(name)) {
    const why = (result.violations || []).map(v => `${v.rule}: ${v.message}`).join("; ") || result.reason || "refused";
    throw new Error(`${name} refused: ${why}`);
  }
  return result;
};

// The map is hand-placed on the engine's 64x64 pixel grid. These small placement helpers only
// stamp the dimensions and row profiles declared below; they do not invent or resize the drawing.
const init = must("project_init", { root: ROOT, game: "farmhouse-showcase", style: STYLE, canvas: { w: WID, h: HEI }, fps: 12 });
must("palette_set", { id: PALETTE_ID, spec: PALETTE });
must("sprite_create", {
  id: "farmhouse", w: WID, h: HEI, palette: PALETTE_ID, style: STYLE.id,
  tier: "support", asset_class: "structure",
  anchor: { x: 32, y: 54 },
  design: {
    primary_read: "a welcoming farm cottage with a broad terracotta roof and a centered timber door",
    exaggerated: "the roof is broad and sheltering, while the entry is small and warm",
    focal_accent: "one brass door latch",
    shape_family: "rural_cottage",
    provenance_note: "original hand-authored PixelHand showcase asset; no game sprite or reference image imported",
  },
});

const palette = W.palette(PALETTE_ID);
const color = name => {
  const i = palette.index(name);
  if (i < 0) throw new Error(`palette entry '${name}' is missing`);
  return i;
};
const pix = new Int16Array(WID * HEI).fill(-1);
function put(x, y, name) {
  if (x < 0 || y < 0 || x >= WID || y >= HEI) return;
  pix[y * WID + x] = color(name);
}
function rect(x, y, w, h, name) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, name);
}
function frame(x, y, w, h, name) {
  rect(x, y, w, 1, name); rect(x, y + h - 1, w, 1, name);
  rect(x, y, 1, h, name); rect(x + w - 1, y, 1, h, name);
}

// Chimney sits behind the roof. The roof later cuts across its lower end.
rect(43, 2, 7, 13, "stone.0");
rect(44, 3, 4, 9, "stone.2");
frame(42, 1, 9, 3, "ink");
rect(43, 2, 7, 1, "stone.2");
put(44, 6, "stone.1"); put(47, 9, "stone.1");

// Main walls: a broad sunlit front plane and a short, cooler right return.
rect(7, 19, 42, 27, "wall.2");
rect(48, 24, 9, 22, "wall.1");
rect(7, 19, 42, 2, "wall.3");
rect(8, 21, 2, 23, "wall.3");
rect(46, 21, 2, 23, "wall.0");
rect(49, 25, 2, 18, "wall.0");
rect(50, 24, 7, 2, "wall.2");
// Quiet clapboard seams keep the large wall from reading as a blank rectangle.
for (const y of [24, 39]) rect(11, y, 33, 1, "wall.1");
for (const y of [29, 35]) rect(50, y, 6, 1, "wall.0");

// Roof profile: the widening rows are deliberate pixel steps, not a resize operation.
const roofRows = [
  [30, 33], [28, 35], [26, 37], [24, 39], [22, 41], [20, 43], [18, 45], [16, 47],
  [14, 49], [12, 51], [10, 53], [8, 55], [6, 57], [4, 59], [2, 61], [1, 62],
  [1, 62], [1, 62], [1, 62], [1, 62],
];
roofRows.forEach(([left, right], row) => {
  const y = row + 2;
  for (let x = left; x <= right; x++) {
    const edge = x === left || x === right || y === 21;
    const across = (x - left) / Math.max(1, right - left);
    const step = Math.max(0, Math.min(3, Math.round((1 - across) * 3) - (y > 16 ? 1 : 0)));
    put(x, y, edge ? "ink" : `roof.${step}`);
  }
});
// Eaves catch a warm highlight, with a dark fascia under the overhang.
rect(2, 20, 60, 1, "roof.2");
rect(2, 21, 60, 1, "ink");
rect(5, 22, 54, 1, "wood.1");
// Sparse shingle bands and a small attic vent add authored structure without noise.
for (const [y, x0, x1] of [[9, 17, 46], [14, 9, 54]]) {
  for (let x = x0; x <= x1; x += 6) put(x, y, "roof.1");
}
frame(28, 12, 8, 5, "wood.0");
rect(30, 14, 4, 2, "glass.0");
put(31, 14, "glass.2");

// Foundation and timber corners tie the facade and side plane into one structure.
rect(6, 44, 52, 4, "stone.0");
rect(7, 44, 40, 1, "stone.2");
for (let x = 8; x < 57; x += 5) put(x, 46, "stone.1");
rect(7, 19, 2, 27, "wood.0");
rect(46, 19, 2, 27, "wood.0");
rect(48, 24, 2, 22, "wood.0");

function windowAt(x, y, w = 9, h = 9) {
  frame(x, y, w, h, "wood.0");
  rect(x + 1, y + 1, w - 2, h - 2, "glass.0");
  rect(x + 2, y + 2, Math.max(1, Math.floor((w - 3) / 2)), h - 3, "glass.1");
  rect(x + 2, y + 2, 2, 2, "glass.2");
  rect(x + Math.floor(w / 2) - 1, y + 1, 2, h - 2, "wood.1");
  rect(x + 1, y + Math.floor(h / 2) - 1, w - 2, 2, "wood.1");
  rect(x - 1, y - 1, w + 2, 1, "wood.2");
  rect(x - 1, y + h, w + 2, 2, "wood.0");
}
windowAt(12, 27, 9, 9);
windowAt(37, 27, 9, 9);
// A smaller side window establishes the return face.
windowAt(49, 30, 8, 7);

// Little porch canopy, posts, and a recessed plank door.
rect(24, 33, 17, 2, "ink");
rect(25, 32, 15, 1, "roof.2");
rect(25, 33, 15, 1, "roof.1");
rect(24, 35, 2, 10, "wood.0");
rect(25, 35, 1, 9, "wood.2");
rect(39, 35, 2, 10, "wood.0");
rect(39, 35, 1, 9, "wood.1");
frame(27, 34, 10, 12, "wood.0");
rect(29, 35, 6, 10, "wood.1");
rect(30, 36, 4, 3, "wood.2");
rect(30, 41, 4, 3, "wood.0");
rect(33, 39, 2, 3, "brass");
rect(26, 46, 12, 2, "stone.2");
rect(27, 48, 10, 2, "stone.1");

// One connected stone walk and two low flower boxes make the entrance feel lived in.
rect(29, 50, 6, 2, "stone.0");
rect(28, 52, 8, 2, "stone.1");
rect(29, 54, 6, 2, "stone.0");
rect(27, 56, 10, 2, "stone.1");
rect(29, 58, 6, 2, "stone.0");
rect(27, 60, 10, 2, "stone.1");
rect(11, 42, 10, 2, "wood.0");
rect(12, 40, 8, 2, "leaf.0");
rect(13, 39, 3, 2, "leaf.2");
rect(14, 38, 2, 2, "leaf.2"); put(18, 39, "leaf.1");
rect(39, 42, 9, 2, "wood.0");
rect(40, 40, 7, 2, "leaf.0");
rect(41, 39, 3, 2, "leaf.2");
rect(42, 38, 2, 2, "leaf.2"); put(46, 39, "leaf.1");

// A compact contact shadow anchors the house to the ground plane.
rect(5, 48, 54, 1, "ground");
rect(9, 49, 46, 1, "ground");

const map = Array.from({ length: HEI }, (_, y) => Array.from({ length: WID }, (_, x) => {
  const idx = pix[y * WID + x];
  return idx < 0 ? "." : charFor(idx);
}).join(""));

const celId = "farmhouse.base";
const draw = must("draw_pixel_map", { cel: celId, palette: PALETTE_ID, map });
function componentsOf(ramp) {
  const cel = W.store.get(celId), seen = new Uint8Array(WID * HEI), out = [];
  for (let y = 0; y < HEI; y++) for (let x = 0; x < WID; x++) {
    const start = y * WID + x;
    const idx = cel.get(x, y);
    if (seen[start] || idx < 0 || palette.entries[idx]?.ramp !== ramp) continue;
    const stack = [[x, y]], points = []; seen[start] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop(); points.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * WID + nx;
        if (nx < 0 || ny < 0 || nx >= WID || ny >= HEI || seen[ni]) continue;
        const colorIdx = cel.get(nx, ny);
        if (colorIdx < 0 || palette.entries[colorIdx]?.ramp !== ramp) continue;
        seen[ni] = 1; stack.push([nx, ny]);
      }
    }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    out.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 });
  }
  return out;
}
for (const ramp of ["roof", "wall", "wood", "glass", "stone", "leaf"]) {
  for (const region of componentsOf(ramp)) {
    must("paint_form", { cel: celId, ramp, region, form: "cylinder", light: STYLE.light_vector });
  }
}
// The audit catches a few one-pixel material islands where the sill, foundation, and side return
// meet. Keep the corner in timber and use ink at the door threshold so the material edges stay crisp.
const repairs = [
  [48, 23, "wood.1"], [41, 38, "leaf.2"], [51, 31, "glass.1"], [54, 31, "glass.1"],
  [28, 44, "wood.1"], [35, 44, "wood.1"], [27, 44, "ink"], [27, 45, "ink"], [28, 45, "ink"],
];
must("put", { cel: celId, cells: repairs.map(([x, y, name]) => `${x},${y},${color(name)}`).join(";") });
must("save_cel", { sprite: "farmhouse", cel: celId, cel_key: "base" });
const audit = must("audit", { cel: celId, sprite: "farmhouse", style: STYLE.id, tier: "support" });
const craft = must("craft_metrics", { cel: celId });
const views = {};
for (const [name, args] of [
  ["view", { cel: celId, style: STYLE.id, zoom: 10 }],
  ["silhouette", { cel: celId, style: STYLE.id }],
  ["squint", { cel: celId, style: STYLE.id }],
  ["value_map", { cel: celId, style: STYLE.id }],
  ["game_scale", { cel: celId, style: STYLE.id }],
]) views[name] = must(name, args);

// Keep a clean, exact nearest-neighbour preview beside the editable text-grid project. This crops
// only the engine's labels and palette legend; every art pixel comes from renderCel unchanged.
const zoom = 8, labels = render.MIN_LABEL_FONT;
const scene = render.renderCel(W.store.get(celId), palette, { mode: "view", zoom, grid: false, legend: false });
const ox = Math.max(12, String(WID - 1).length * 6 * labels + 14), oy = 5 * labels + 10;
const clean = Buffer.alloc(WID * zoom * HEI * zoom * 3);
for (let y = 0; y < HEI * zoom; y++) {
  const from = ((oy + y) * scene.raster.w + ox) * 3;
  scene.raster.rgb.copy(clean, y * WID * zoom * 3, from, from + WID * zoom * 3);
}
const preview = path.join(ROOT, "preview.png");
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(preview, encodeRGB(WID * zoom, HEI * zoom, clean));

console.log(`Project: ${ROOT}`);
console.log(`Authored pixels: ${draw.changed.pixels}`);
console.log(`Audit: ${audit.errors} errors, ${audit.warns} warnings, ${audit.exempted} exempted`);
console.log(`Craft: ${craft.score} (${craft.grade}), weakest: ${craft.weakest}`);
console.log(`Clean preview: ${preview}`);
for (const [name, result] of Object.entries(views)) console.log(`${name}: ${result.image}`);
if (audit.findings.length) for (const f of audit.findings) console.log(`  ${f.severity} ${f.rule}: ${f.message}`);
if (!init.ok) throw new Error("project initialization failed");
