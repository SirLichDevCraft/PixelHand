#!/usr/bin/env node
"use strict";

// Original pixel placement, committed as editable PixelHand cels. No imported
// images, sampled palettes, raster filters, or image-generation services.
const fs = require("fs");
const path = require("path");
const { createEngine } = require("../src/index.js");
const { decodePNG, encodeRGB, upscaleNearest } = require("../src/codec/png.js");

const WIDTH = 384, HEIGHT = 224, FRAMES = 8, DURATION = 160, ZOOM = 3;
const destination = path.resolve(__dirname, "../showcase/starfall");
const out = path.resolve(__dirname, "../out");
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, "starfall-build-"));
const engine = createEngine(root);
function call(tool, args) {
  const result = engine.call(tool, args);
  if (!result.ok) throw new Error(`${tool}: ${JSON.stringify(result.violations)}`);
  return result;
}

const ramps = {
  night: ["#0c1121", "#171e33", "#242b46", "#383e58"],
  cloud: ["#3a3855", "#554968", "#745d7c", "#a08093"],
  stone: ["#202e3c", "#344a57", "#536976", "#7d9397", "#abb9ae", "#d5d4b1"],
  wood: ["#302938", "#573b47", "#885847", "#be855b"],
  copper: ["#41394c", "#655064", "#987077", "#ce9584", "#f1c49a"],
  roof: ["#193c49", "#285e6a", "#3d8790", "#72b0aa", "#b6d5bd"],
  moss: ["#173d3c", "#285a4e", "#47816a", "#80a281", "#c3c996"],
  water: ["#263d5f", "#3c6483", "#5794ac", "#8fd0d5", "#d4f1df"],
  gold: ["#8d5c4b", "#ca8953", "#edb866", "#ffe0a0", "#fff2ce"],
  accent: ["#ae638b", "#e9a6bc", "#6485a3", "#99bad0", "#d7e1de"],
};
const names = Object.entries(ramps).flatMap(([r, colors]) => colors.map((_, i) => `${r}.${i}`));
const index = Object.fromEntries(names.map((n, i) => [n, i]));
let pixels = new Int16Array(WIDTH * HEIGHT);
const I = name => { if (!(name in index)) throw new Error(name); return index[name]; };
function dot(x, y, color) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) pixels[y * WIDTH + x] = typeof color === "number" ? color : I(color);
}
function rect(x, y, w, h, color) {
  const c = typeof color === "number" ? color : I(color);
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(HEIGHT, y + h); yy++)
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(WIDTH, x + w); xx++) pixels[yy * WIDTH + xx] = c;
}
function line(x0, y0, x1, y1, color, width = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    rect(x0, y0, width, width, color);
    if (x0 === x1 && y0 === y1) break;
    const e = 2 * error;
    if (e >= dy) { error += dy; x0 += sx; }
    if (e <= dx) { error += dx; y0 += sy; }
  }
}
function poly(points, color) {
  const lo = Math.max(0, Math.ceil(Math.min(...points.map(p => p[1]))));
  const hi = Math.min(HEIGHT - 1, Math.floor(Math.max(...points.map(p => p[1]))));
  for (let y = lo; y <= hi; y++) {
    const hits = [];
    for (let j = 0; j < points.length; j++) {
      const a = points[j], b = points[(j + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    hits.sort((a, b) => a - b);
    for (let j = 0; j < hits.length; j += 2) rect(Math.ceil(hits[j]), y, Math.floor(hits[j + 1]) - Math.ceil(hits[j]) + 1, 1, color);
  }
}
function ellipse(cx, cy, rx, ry, color) {
  for (let y = -Math.floor(ry); y <= ry; y++) {
    const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    rect(Math.round(cx) - dx, Math.round(cy) + y, dx * 2 + 1, 1, color);
  }
}
function chain(points, color, width = 1) {
  for (let i = 1; i < points.length; i++) line(...points[i - 1], ...points[i], color, width);
}
function spark(x, y, c = "gold.3", size = 2) {
  line(x - size, y, x + size, y, c); line(x, y - size, x, y + size, c);
}
function pine(x, y, h, shade = 0) {
  line(x, y - h + 5, x, y + 1, shade ? "night.0" : "wood.0", Math.max(1, Math.round(h / 30)));
  const colors = shade ? ["night.1", "night.2", "night.2"] : ["moss.0", "moss.1", "moss.2"];
  for (let i = 0; i < 5; i++) {
    const top = y - h + i * h * 0.16, span = h * (0.12 + i * 0.047);
    poly([[x, top], [x - span, top + h * 0.29], [x + span * 0.9, top + h * 0.25]], colors[0]);
    chain([[x - span + 2, top + h * 0.26], [x - 2, top + 3], [x - 1, top + h * 0.18]], colors[1]);
    if (!shade) line(x - span + 3, top + h * 0.26, x - 3, top + h * 0.2, colors[2]);
  }
}

// 1. Wide, quiet sky. Four discrete bands, never a blended gradient.
rect(0, 0, WIDTH, HEIGHT, "night.0");
poly([[0, 34], [80, 36], [149, 24], [236, 29], [384, 57], [384, 224], [0, 224]], "night.1");
poly([[0, 100], [88, 87], [188, 101], [288, 91], [384, 100], [384, 224], [0, 224]], "night.2");
poly([[0, 144], [99, 120], [176, 129], [281, 120], [384, 131], [384, 224], [0, 224]], "night.3");

// The aurora is an authored broken ribbon with cool inner edges.
poly([[121, 0], [153, 0], [184, 19], [230, 34], [294, 42], [339, 68], [291, 50], [223, 43], [177, 28]], "night.2");
poly([[145, 0], [154, 0], [186, 18], [230, 31], [291, 40], [319, 54], [287, 44], [224, 36], [182, 24]], "roof.0");
chain([[158, 1], [189, 17], [233, 29], [272, 33]], "roof.1");
chain([[174, 12], [196, 23], [228, 33]], "roof.2");
for (const [x, y, w] of [[188, 13, 1], [207, 24, 2], [247, 31, 1], [279, 36, 1]]) line(x, y, x + w, y + 9, "roof.0");

// A warm moon counterbalances the cool roof and frames the approach.
const behindMoon = pixels.slice();
ellipse(77, 47, 24, 24, "cloud.0");
ellipse(77, 46, 21, 21, "gold.1");
ellipse(76, 45, 20, 20, "gold.2");
ellipse(74, 43, 18, 18, "gold.3");
ellipse(70, 40, 13, 15, "gold.4");
for (let y = 18; y <= 56; y++) for (let x = 69; x <= 103; x++) {
  if (((x - 86) / 17) ** 2 + ((y - 37) / 19) ** 2 <= 1) pixels[y * WIDTH + x] = behindMoon[y * WIDTH + x];
}
rect(64, 48, 3, 2, "gold.2"); rect(67, 53, 4, 2, "gold.2"); dot(62, 42, "gold.3");

// Deliberately sparse star clusters and a faint constellation.
for (const [x, y] of [[19, 20], [35, 51], [45, 12], [113, 15], [130, 48], [156, 69], [171, 39], [206, 9], [227, 61], [255, 16], [302, 17], [335, 25], [359, 51], [370, 10], [371, 90], [17, 96], [114, 76], [136, 22], [326, 83], [321, 7]]) dot(x, y, "accent.2");
for (const [x, y] of [[26, 34], [120, 33], [349, 16], [329, 57]]) spark(x, y, "accent.3", 1);
chain([[20, 78], [38, 65], [52, 70], [63, 80], [89, 85]], "night.3");
for (const [x, y] of [[20, 78], [38, 65], [52, 70], [63, 80], [89, 85]]) dot(x, y, "accent.3");

// 2. Cloud sea, with large readable scallops and selective rim light.
function cloudBank(y, shade, lobes) {
  rect(0, y, WIDTH, HEIGHT - y, shade);
  for (const [x, rise, rx] of lobes) ellipse(x, y, rx, rise, shade);
}
cloudBank(151, "cloud.0", [[6, 14, 38], [62, 18, 42], [123, 11, 32], [185, 16, 55], [263, 12, 60], [344, 24, 53], [382, 13, 37]]);
chain([[0, 137], [15, 137], [23, 131], [40, 131], [47, 134], [68, 134], [74, 131], [89, 131]], "cloud.1");
chain([[307, 138], [319, 138], [327, 131], [347, 131], [353, 127], [369, 128], [380, 135]], "cloud.1");
cloudBank(180, "cloud.1", [[0, 15, 37], [48, 11, 32], [117, 12, 45], [197, 15, 51], [290, 11, 38], [356, 14, 44]]);
chain([[14, 165], [29, 165], [34, 169], [49, 169], [55, 171], [72, 171]], "cloud.2");
cloudBank(210, "cloud.2", [[12, 13, 45], [81, 16, 50], [157, 8, 40], [221, 12, 38], [304, 19, 54], [377, 12, 34]]);
chain([[251, 199], [264, 199], [274, 193], [290, 193], [297, 188], [313, 188], [325, 191], [335, 191]], "cloud.3");
chain([[100, 198], [115, 198], [123, 202], [139, 202], [145, 205], [163, 205]], "cloud.3");
// Scalloped cloud heads curl around the island; long shadows keep them light.
for (const [points, color] of [
  [[[53, 190], [62, 185], [74, 185], [79, 181], [95, 181], [103, 184], [113, 184], [121, 191], [134, 191], [144, 199], [168, 204], [151, 209], [112, 206], [86, 199], [63, 199]], "cloud.2"],
  [[[61, 190], [73, 189], [79, 185], [92, 185], [99, 188], [108, 188], [115, 194], [130, 194], [139, 199], [117, 198], [109, 194], [96, 194], [86, 191]], "cloud.3"],
  [[[159, 224], [163, 217], [175, 215], [181, 207], [194, 207], [201, 201], [217, 201], [223, 204], [235, 204], [241, 210], [257, 214], [264, 224]], "cloud.1"],
  [[[166, 224], [178, 218], [185, 211], [197, 211], [203, 205], [215, 205], [223, 209], [234, 209], [241, 214], [229, 214], [220, 212], [207, 212], [200, 218], [188, 218], [181, 224]], "cloud.3"],
  [[[337, 224], [341, 216], [351, 213], [354, 207], [366, 206], [376, 199], [384, 199], [384, 224]], "cloud.3"],
]) poly(points, color);
chain([[72, 203], [87, 203], [96, 208], [113, 208], [121, 213], [147, 213]], "cloud.1");
chain([[286, 216], [302, 216], [310, 211], [323, 211], [327, 214], [339, 214]], "cloud.1");

// A distant island and ruined watchpost establish depth without competing detail.
poly([[102, 121], [129, 114], [152, 120], [140, 125], [131, 147], [124, 135], [116, 133]], "cloud.0");
poly([[102, 120], [126, 116], [151, 120], [128, 124]], "accent.2");
rect(124, 104, 8, 14, "night.3"); rect(125, 102, 6, 2, "accent.2");
rect(126, 108, 2, 5, "cloud.0"); line(132, 108, 132, 117, "accent.2");
pine(114, 118, 18, 1); pine(143, 119, 12, 1);
line(131, 129, 130, 153, "accent.2"); line(133, 127, 133, 141, "cloud.1");

// 3. Main island: top plane, fractured rock planes, roots, and mineral seams.
poly([[167, 148], [188, 139], [223, 141], [257, 135], [310, 142], [340, 151], [346, 166], [330, 177], [314, 178], [304, 199], [289, 188], [274, 209], [263, 215], [248, 201], [240, 188], [219, 199], [209, 184], [191, 183], [181, 169], [169, 165]], "night.0");
poly([[177, 158], [211, 158], [238, 169], [225, 187], [216, 193], [207, 176], [188, 178]], "stone.1");
poly([[211, 160], [251, 160], [265, 177], [258, 206], [248, 195], [236, 181]], "stone.0");
poly([[258, 160], [285, 158], [302, 169], [282, 190], [272, 207], [263, 211], [267, 179]], "stone.1");
poly([[301, 155], [335, 156], [338, 167], [315, 173], [305, 193], [297, 184]], "stone.0");
poly([[185, 160], [205, 162], [212, 172], [195, 167], [193, 175]], "stone.2");
poly([[236, 165], [246, 168], [257, 188], [243, 183]], "stone.2");
poly([[272, 171], [285, 166], [279, 188], [269, 201]], "stone.2");
poly([[314, 161], [335, 160], [325, 166], [309, 172]], "stone.2");
chain([[197, 170], [207, 173], [213, 183]], "stone.3");
chain([[249, 180], [253, 190], [259, 194]], "stone.1");
chain([[279, 182], [272, 190], [271, 195]], "roof.2"); dot(270, 197, "water.3");
chain([[316, 172], [312, 181], [309, 183]], "stone.1");
// Broken strata follow the facets rather than spraying texture over the cliff.
for (const [points, color] of [
  [[[189, 165], [199, 168], [201, 171], [193, 169]], "stone.3"],
  [[[200, 175], [205, 176], [210, 183], [205, 181]], "stone.2"],
  [[[218, 165], [230, 169], [234, 174], [224, 170]], "stone.1"],
  [[[244, 173], [249, 176], [254, 187], [249, 183]], "stone.3"],
  [[[250, 190], [253, 191], [257, 198], [254, 196]], "stone.2"],
  [[[273, 176], [281, 172], [278, 180], [272, 186]], "stone.3"],
  [[[266, 199], [271, 191], [272, 194], [268, 204]], "stone.2"],
  [[[316, 166], [327, 163], [323, 167], [313, 170]], "stone.3"],
]) poly(points, color);
chain([[286, 176], [289, 181], [285, 187]], "night.0");
chain([[238, 178], [236, 183], [239, 189]], "night.0");
ellipse(255, 152, 87, 17, "moss.0");
poly([[174, 150], [191, 143], [216, 143], [236, 140], [268, 142], [295, 141], [326, 149], [337, 155], [315, 160], [291, 159], [267, 162], [239, 159], [220, 163], [197, 158], [181, 159]], "moss.1");
poly([[179, 148], [193, 143], [215, 144], [229, 142], [235, 145], [216, 148], [199, 148], [190, 153]], "moss.3");
chain([[174, 152], [185, 156], [195, 155], [209, 160], [218, 158], [230, 160]], "moss.2", 2);
chain([[279, 160], [296, 156], [311, 158], [333, 154]], "moss.2", 2);
for (const [x, y] of [[181, 158], [190, 161], [215, 163], [290, 163], [326, 159]]) {
  line(x, y, x + 1, y + 7, "moss.1"); line(x + 1, y + 2, x + 3, y + 2, "moss.2");
}
for (const [x, y, w] of [[178, 152, 6], [192, 155, 8], [224, 155, 9], [240, 158, 8], [269, 157, 10], [296, 153, 8], [316, 153, 9], [332, 152, 5]]) {
  rect(x, y, w, 2, "moss.2"); line(x, y, x + Math.floor(w / 2), y - 1, "moss.3");
  for (let k = 1; k < w; k += 3) line(x + k, y, x + k - 1, y - 3, "moss.2");
}
chain([[228, 174], [231, 184], [226, 194], [231, 196]], "wood.0");
chain([[322, 170], [319, 180], [324, 187], [320, 195]], "wood.0");
chain([[323, 171], [323, 180], [326, 185]], "wood.1");

// The garden path catches reflected window light in broken stone slabs.
poly([[173, 149], [211, 137], [231, 137], [230, 145], [208, 148], [185, 155]], "stone.1");
for (const [x, y, w] of [[178, 149, 8], [188, 146, 10], [199, 143, 9], [210, 140, 9], [222, 139, 8]]) {
  line(x, y, x + w, y - 1, "stone.3", 2); line(x + 2, y, x + w, y - 1, "stone.4");
}

// 4. Observatory tower behind the library. Cool cylinder, copper instruments.
ellipse(287, 128, 18, 7, "stone.0");
rect(270, 64, 34, 64, "stone.1"); rect(272, 65, 8, 62, "stone.2");
rect(275, 65, 5, 58, "stone.3"); rect(298, 65, 6, 62, "stone.0");
for (let y = 75; y < 126; y += 10) {
  line(272, y, 278, y + 1, "stone.4"); line(281, y + 2, 298, y + 2, "stone.0");
  line(286 + (y % 3), y + 2, 286 + (y % 3), y + 10, "stone.0");
}
rect(281, 75, 11, 17, "wood.0"); ellipse(286, 75, 5, 5, "wood.0");
rect(283, 75, 7, 15, "gold.1"); ellipse(286, 75, 3, 3, "gold.2");
rect(284, 76, 4, 12, "gold.3"); line(286, 75, 286, 89, "gold.0"); line(283, 81, 289, 81, "gold.0");
ellipse(287, 67, 22, 7, "wood.0"); ellipse(286, 65, 23, 6, "copper.2");
ellipse(286, 62, 22, 6, "copper.4"); ellipse(286, 58, 21, 17, "copper.0");
ellipse(284, 57, 19, 17, "copper.1"); ellipse(281, 55, 15, 15, "copper.2");
ellipse(278, 53, 10, 12, "copper.3");
// Dome ribs follow its curvature, leaving broad metal clusters between them.
chain([[284, 40], [276, 44], [272, 51], [271, 58], [272, 62]], "copper.4");
chain([[285, 40], [286, 47], [289, 53], [290, 61]], "copper.0", 2);
chain([[286, 41], [295, 47], [301, 56], [302, 61]], "copper.2");
rect(264, 61, 43, 3, "wood.0"); rect(265, 61, 41, 1, "copper.4");
rect(266, 64, 39, 2, "copper.1");
// Telescope: dark lower edge, faceted brass tube, cyan objective.
line(286, 53, 308, 35, "wood.0", 7);
line(287, 51, 309, 34, "gold.0", 5);
line(287, 51, 309, 34, "gold.2", 3);
line(288, 51, 307, 36, "gold.3");
line(305, 33, 311, 40, "copper.0", 2); line(307, 33, 312, 38, "water.2", 2);
line(308, 33, 311, 36, "water.4");
rect(285, 39, 2, 4, "copper.4"); dot(285, 37, "gold.4");

// 5. Library: lit front, cooler return, heavy beams, and a patinated roof.
poly([[188, 104], [261, 102], [262, 144], [188, 148]], "wood.0");
poly([[191, 106], [257, 104], [257, 142], [191, 146]], "stone.3");
poly([[258, 103], [311, 99], [311, 135], [259, 144]], "stone.1");
poly([[262, 107], [306, 103], [306, 133], [262, 140]], "stone.2");
rect(193, 111, 61, 2, "stone.2"); rect(193, 131, 61, 2, "stone.2");
for (const x of [191, 207, 237, 255]) { line(x, 108, x, 144, "wood.1", 3); line(x, 111, x, 141, "wood.2"); }
line(191, 128, 256, 125, "wood.0", 3); line(192, 127, 255, 124, "wood.2");
line(261, 126, 309, 118, "wood.0", 2);
line(262, 107, 262, 139, "wood.0", 2); line(286, 104, 286, 135, "wood.0", 2);
line(307, 104, 307, 133, "wood.0", 2);
line(193, 132, 203, 143, "wood.1", 2); line(247, 132, 238, 142, "wood.1", 2);

// Warm windows have actual frames, shutters, sills, and individual book shapes.
function window(x, y, w, h) {
  rect(x - 2, y - 2, w + 4, h + 4, "wood.0"); rect(x - 1, y - 1, w + 2, h + 2, "wood.3");
  rect(x, y, w, h, "gold.1"); rect(x + 1, y + 1, w - 3, h - 2, "gold.2");
  rect(x + 1, y + 1, Math.max(2, w - 5), h - 4, "gold.3");
  rect(x + 2, y + 2, 2, 3, "gold.4");
  rect(x + Math.floor(w / 2), y, 1, h, "wood.1"); rect(x, y + Math.floor(h / 2), w, 1, "wood.1");
  rect(x - 3, y + h + 2, w + 6, 2, "wood.0"); rect(x - 2, y + h + 2, w + 4, 1, "copper.3");
}
window(194, 115, 10, 9); window(240, 111, 11, 11);
window(269, 108, 10, 13); window(292, 105, 10, 12);
rect(196, 123, 2, 1, "accent.0"); rect(199, 122, 1, 2, "roof.0"); rect(242, 119, 2, 2, "wood.1");

// Rounded entrance, stone steps, illuminated transom, brass latch.
rect(214, 123, 19, 22, "wood.0"); ellipse(223, 123, 9, 8, "wood.0");
rect(217, 122, 13, 22, "wood.1"); ellipse(223, 122, 6, 6, "gold.1");
rect(218, 123, 11, 6, "gold.3"); line(218, 128, 228, 128, "wood.0");
for (const x of [220, 224, 228]) line(x, 123, x, 127, "wood.1");
for (const x of [218, 222, 226]) line(x, 131, x, 142, "wood.2");
dot(227, 136, "gold.3"); rect(216, 143, 16, 2, "stone.4");
rect(213, 146, 22, 2, "stone.2"); rect(213, 145, 22, 1, "stone.5");
rect(210, 149, 27, 2, "stone.1"); rect(210, 148, 27, 1, "stone.3");

// Roof planes and edge caps. All shingles lie in the plane's authored slopes.
poly([[221, 73], [276, 61], [321, 98], [266, 112]], "night.0");
poly([[222, 75], [275, 64], [316, 97], [265, 108]], "roof.1");
poly([[224, 76], [274, 65], [307, 92], [261, 103]], "roof.2");
poly([[232, 76], [271, 68], [280, 75], [239, 84]], "roof.3");
// Lines descend with roof pitch; seams are sparse clusters, not random noise.
for (let row = 0; row < 5; row++) {
  const ax = 228 + row * 7, ay = 81 + row * 5;
  line(ax, ay, ax + 50, ay - 11, "roof.0");
  line(ax + 1, ay + 1, ax + 50, ay - 10, "roof.3");
  for (let t = 0; t < 5; t++) {
    const x = ax + t * 10 + (row % 2) * 4, y = ay - t * 2;
    if (x < 310) line(x, y - 4, x + 4, y - 1, "roof.1");
  }
}
line(222, 74, 275, 63, "roof.4"); line(275, 63, 317, 97, "roof.3");
line(265, 109, 320, 98, "wood.0", 3); line(266, 109, 318, 98, "copper.3");

// Front gable is plaster, with an inset circular celestial window.
poly([[222, 75], [269, 113], [173, 113]], "wood.0");
poly([[222, 81], [258, 110], [185, 110]], "stone.3");
poly([[222, 84], [247, 108], [222, 108]], "stone.2");
line(222, 76, 174, 112, "roof.2", 3); line(222, 76, 267, 112, "roof.0", 3);
line(222, 76, 174, 111, "roof.4"); line(223, 77, 267, 111, "roof.3");
line(176, 113, 266, 113, "wood.0", 3); line(179, 113, 263, 113, "wood.3");
line(222, 85, 222, 108, "wood.1", 2); line(199, 109, 219, 91, "wood.1", 2); line(225, 91, 247, 109, "wood.1", 2);
ellipse(222, 100, 10, 10, "wood.0"); ellipse(222, 99, 8, 8, "gold.1");
ellipse(222, 99, 6, 6, "gold.3"); ellipse(221, 98, 4, 4, "gold.4");
line(216, 99, 228, 99, "copper.1"); line(222, 93, 222, 105, "copper.1");
line(218, 95, 226, 103, "gold.0"); line(218, 103, 226, 95, "gold.0");
dot(222, 99, "gold.4");

// Chimney and drifting smoke. Small clusters preserve crisp silhouette.
rect(244, 67, 9, 17, "wood.0"); rect(245, 68, 6, 14, "stone.2"); rect(245, 68, 2, 13, "stone.4");
rect(243, 66, 11, 3, "stone.1"); rect(243, 66, 10, 1, "stone.4");
line(247, 74, 250, 74, "stone.0"); dot(248, 79, "stone.1");
poly([[247, 64], [244, 60], [246, 56], [252, 55], [256, 50], [254, 46], [250, 44], [254, 43], [260, 47], [261, 52], [257, 57], [249, 59], [250, 63]], "night.3");
chain([[246, 60], [247, 57], [254, 56], [258, 51]], "cloud.0");

// 6. Railings, banner, pots, books, weather vane, and a sleeping cat.
line(264, 131, 312, 123, "wood.0", 2); line(264, 129, 312, 121, "copper.3");
for (let x = 265; x <= 311; x += 6) line(x, 130 - (x - 265) / 6, x, 140 - (x - 265) / 6, "wood.0");
line(263, 140, 314, 131, "wood.0", 3); line(264, 140, 313, 131, "wood.3");
rect(307, 101, 2, 24, "wood.0");
poly([[309, 105], [319, 108], [317, 122], [312, 119], [309, 121]], "accent.0");
line(311, 107, 311, 117, "accent.1"); dot(314, 112, "gold.3"); line(313, 111, 315, 114, "gold.2");
line(259, 62, 259, 79, "wood.0"); line(255, 64, 266, 64, "gold.1");
poly([[265, 61], [271, 64], [265, 67]], "gold.2"); spark(259, 60, "gold.3", 1);
function pot(x, y, flowers = true) {
  rect(x - 3, y - 4, 7, 2, "copper.3"); rect(x - 2, y - 2, 5, 4, "copper.1");
  line(x - 1, y - 2, x - 1, y, "copper.2");
  line(x, y - 5, x - 1, y - 11, "moss.0"); line(x, y - 6, x + 3, y - 9, "moss.2");
  rect(x - 3, y - 9, 3, 2, "moss.2"); rect(x + 1, y - 10, 4, 2, "moss.3");
  if (flowers) { rect(x - 2, y - 12, 3, 2, "accent.0"); dot(x - 1, y - 12, "accent.1"); rect(x + 3, y - 11, 2, 2, "gold.2"); }
}
pot(201, 143); pot(251, 141); pot(304, 131, false);
// A reading table, an open atlas, and brass sundial make the setting specific.
line(277, 143, 275, 150, "wood.0", 2); line(284, 143, 286, 149, "wood.0", 2);
poly([[270, 140], [282, 137], [290, 141], [278, 145]], "wood.0");
poly([[270, 139], [282, 136], [290, 140], [278, 143]], "wood.3");
poly([[274, 138], [279, 137], [282, 138], [285, 137], [287, 139], [282, 141], [279, 140]], "gold.3");
line(281, 138, 282, 140, "gold.0"); dot(278, 138, "roof.1"); dot(284, 139, "accent.0");
rect(291, 148, 5, 5, "stone.1"); rect(292, 147, 3, 5, "stone.3");
ellipse(293, 146, 5, 2, "gold.0"); ellipse(293, 145, 5, 1, "gold.2");
line(293, 145, 294, 142, "gold.3"); dot(291, 145, "wood.0");
rect(242, 140, 6, 2, "wood.0"); rect(241, 138, 6, 2, "roof.0"); rect(242, 137, 5, 1, "stone.4");
rect(240, 135, 6, 2, "accent.0"); rect(241, 135, 4, 1, "accent.1");
ellipse(236, 145, 3, 2, "wood.0"); rect(237, 142, 3, 3, "wood.0");
dot(237, 141, "wood.0"); dot(239, 141, "wood.0"); dot(239, 143, "gold.2");
chain([[233, 146], [231, 144], [232, 142]], "wood.0");

// Hanging sign with a star symbol rather than illegible miniature text.
line(184, 117, 175, 117, "wood.0", 2); line(176, 119, 176, 123, "copper.2");
line(182, 119, 182, 123, "copper.2"); rect(173, 123, 13, 11, "wood.0");
rect(174, 124, 11, 8, "roof.0"); spark(179, 128, "gold.2", 2);

// A wind-bent tree frames the right edge; foliage comes in coherent tufts.
chain([[332, 153], [336, 139], [333, 122], [338, 109], [337, 101]], "wood.0", 4);
chain([[335, 140], [339, 132], [350, 127]], "wood.0", 3);
chain([[335, 124], [325, 118], [322, 111]], "wood.0", 3);
line(334, 148, 336, 137, "wood.2"); line(334, 125, 337, 113, "wood.1");
for (const [x, y, rx, ry] of [[337, 102, 12, 8], [325, 110, 14, 8], [343, 112, 17, 8], [352, 126, 14, 7], [332, 120, 11, 7]]) {
  ellipse(x, y, rx, ry, "moss.0"); ellipse(x - 2, y - 2, rx - 2, ry - 2, "moss.1");
  chain([[x - rx + 3, y - 2], [x - 5, y - 5], [x + 2, y - 5]], "moss.2", 2);
  line(x - rx + 5, y - 3, x - 5, y - 5, "moss.3");
  for (const [dx, dy] of [[-6, 1], [-1, 2], [5, -1], [9, 0]]) {
    rect(x + dx, y + dy, 3, 2, "moss.1"); line(x + dx, y + dy, x + dx + 2, y + dy - 1, "moss.2");
  }
}
for (const [x, y] of [[322, 114], [335, 103], [344, 112], [352, 124], [326, 119]]) {
  rect(x, y, 2, 2, "gold.2"); dot(x, y, "gold.3");
}

// Wisteria follows the left gable and drapes from the eaves.
chain([[178, 143], [180, 132], [181, 121], [187, 110], [196, 104]], "moss.0", 2);
for (const [x, y, h] of [[181, 115, 9], [184, 112, 6], [189, 109, 8], [194, 106, 5], [178, 129, 8]]) {
  rect(x, y, 3, h, "accent.0"); rect(x, y, 2, Math.max(2, h - 3), "accent.1"); dot(x + 1, y + h, "accent.0");
  rect(x - 1, y - 1, 3, 2, "moss.2");
}

// 7. Arched bridge. Openings reveal the exact background, preserving depth.
const behindBridge = pixels.slice();
const bridgeY = x => 180 - (x - 38) * 0.245;
for (let x = 35; x < 185; x++) {
  const y = Math.round(bridgeY(x)); rect(x, y - 5, 1, 22, "stone.1");
  rect(x, y - 5, 1, 3, "stone.3"); rect(x, y - 2, 1, 2, "stone.4");
}
for (const [left, right] of [[51, 78], [89, 117], [128, 158]]) {
  for (let x = left; x <= right; x++) {
    const u = (x - left) / (right - left), ceiling = Math.round(bridgeY(x) + 15 - Math.sin(Math.PI * u) * 13);
    for (let y = ceiling; y < bridgeY(x) + 19 && y < HEIGHT; y++) pixels[y * WIDTH + x] = behindBridge[y * WIDTH + x];
    dot(x, ceiling - 1, "stone.0"); dot(x, ceiling - 3, "stone.2");
    if (x % 5 === 0) line(x, ceiling - 3, x - 1, ceiling - 6, "stone.0");
  }
}
for (let x = 39; x < 183; x += 8) {
  const y = Math.round(bridgeY(x)); line(x, y - 4, x - 1, y - 1, "stone.1");
  if (x % 3) rect(x + 1, y + 4, 3, 1, "stone.2");
}
for (const x of [45, 83, 123, 166]) {
  const y = Math.round(bridgeY(x)); rect(x - 2, y - 12, 5, 9, "stone.1");
  rect(x - 3, y - 13, 7, 3, "stone.3"); rect(x - 3, y - 13, 6, 1, "stone.4");
}
line(45, bridgeY(45) - 9, 181, bridgeY(181) - 9, "stone.0");
line(45, bridgeY(45) - 10, 181, bridgeY(181) - 10, "stone.3");
// Far posts and handrail remain behind the traveler rather than across the body.

// Foreground approach is darker and more detailed than the distant island.
poly([[0, 174], [18, 164], [33, 164], [48, 174], [61, 181], [58, 198], [68, 224], [0, 224]], "night.0");
poly([[0, 177], [17, 169], [33, 170], [52, 180], [44, 186], [18, 181], [0, 185]], "moss.0");
chain([[2, 176], [17, 171], [29, 172], [43, 179]], "moss.2", 2);
poly([[10, 179], [26, 177], [43, 180], [47, 184], [29, 182], [16, 184]], "stone.2");
pine(7, 180, 64); pine(28, 176, 36);

// A lone courier, scarf pointing away from the destination, carries a lantern.
const tx = 112, ty = Math.round(bridgeY(tx)) - 2;
ellipse(tx, ty + 1, 6, 2, "stone.0");
line(tx - 1, ty - 5, tx - 2, ty, "night.0", 2); line(tx + 1, ty - 4, tx + 2, ty, "night.0", 2);
poly([[tx - 2, ty - 12], [tx + 2, ty - 11], [tx + 4, ty - 3], [tx - 4, ty - 2]], "accent.0");
line(tx - 2, ty - 10, tx - 2, ty - 4, "accent.1");
rect(tx - 2, ty - 15, 5, 4, "wood.0"); rect(tx + 1, ty - 14, 2, 3, "copper.4");
rect(tx - 3, ty - 16, 6, 2, "roof.1"); dot(tx - 2, ty - 17, "roof.3");
chain([[tx - 2, ty - 11], [tx - 8, ty - 12], [tx - 10, ty - 10]], "accent.1");
line(tx + 2, ty - 10, tx + 6, ty - 7, "wood.0", 2); dot(tx + 6, ty - 7, "gold.2");
line(tx + 7, ty - 7, tx + 7, ty - 4, "wood.0");
rect(tx + 5, ty - 4, 5, 5, "gold.0"); rect(tx + 6, ty - 3, 3, 3, "gold.3"); dot(tx + 7, ty - 2, "gold.4");
rect(tx + 5, ty - 5, 5, 1, "wood.0"); rect(tx + 5, ty + 1, 5, 1, "wood.0");

// Foreground ferns, a few flowers, and loose petals complete the frame.
for (const [x, y, size] of [[17, 200, 13], [42, 214, 10], [3, 218, 14], [357, 223, 17], [376, 217, 25]]) {
  line(x, y, x + 2, y - size, "night.0", 2);
  for (let i = 2; i < size; i += 3) {
    line(x + 1, y - i, x - 3 - (size - i) / 3, y - i - 3, "moss.0", 2);
    line(x + 1, y - i, x + 5 + (size - i) / 4, y - i - 4, "moss.0", 2);
    dot(x - 2, y - i - 2, "moss.1");
  }
}
for (const [x, y] of [[56, 188], [39, 195], [166, 154], [321, 153], [292, 151]]) {
  line(x, y, x, y - 3, "moss.1"); rect(x - 1, y - 5, 3, 2, "accent.0"); dot(x, y - 5, "accent.1");
}
// Small herb clumps and blue flowers break up the open garden without noise.
for (const [x, y] of [[258, 151], [267, 148], [304, 150], [318, 148], [231, 155], [187, 156]]) {
  chain([[x - 3, y], [x - 1, y - 3], [x, y], [x + 2, y - 4], [x + 3, y]], "moss.0");
  dot(x - 1, y - 3, "moss.3"); dot(x + 2, y - 4, "moss.2");
  rect(x - 2, y - 4, 2, 1, "accent.2"); dot(x - 2, y - 5, "accent.3");
}

// 8. Ambient motion. Water descends through fixed authored masks; no geometry
// shifts, camera movement, global palette flashes, or resampling between frames.
const still = pixels.slice();
function waterFall(x, y, w, length, phase) {
  for (let yy = 0; yy < length; yy++) {
    const taper = yy > length - 7 ? Math.floor((yy - length + 7) / 3) : 0;
    const drift = Math.floor(yy / 17);
    for (let xx = taper; xx < w - taper; xx++) {
      let c = "water.1";
      if (xx === 1 || xx === w - 2) c = "water.2";
      if (xx === 2 && (yy - phase * 2 + 80) % 16 < 10) c = "water.3";
      if (xx === w - 3 && (yy - phase * 2 + 91) % 16 < 6) c = "water.4";
      dot(x + xx + drift, y + yy, c);
    }
  }
  ellipse(x + w / 2, y - 1, w / 2 + 3, 2, "water.2");
  line(x, y - 2, x + w - 1, y - 2, "water.4");
  for (let i = 0; i < 3; i++) {
    const yy = y + length - 3 + ((phase * 2 + i * 5) % 16);
    dot(x + w / 2 + i * 2 - 1, yy, "water.3");
  }
}
function frame(phase) {
  pixels = still.slice();
  waterFall(199, 159, 8, 42, phase); waterFall(309, 161, 5, 34, phase);
  for (const [x, y, offset] of [[151, 126, 0], [161, 139, 2], [323, 140, 3], [347, 150, 5]]) {
    const dx = Math.round(Math.sin((phase + offset) * Math.PI / 4) * 2), dy = Math.round(Math.cos((phase + offset) * Math.PI / 4));
    dot(x + dx, y + dy, "gold.2");
    if ((phase + offset) % 8 < 3) dot(x + dx, y + dy - 1, "gold.3");
  }
  for (const [x, y, offset] of [[120, 33, 0], [349, 16, 3], [26, 34, 5]]) {
    if ((phase + offset) % 8 === 0) spark(x, y, "gold.3", 2);
    if ((phase + offset) % 8 === 1) dot(x, y, "gold.4");
  }
  return pixels;
}

// Commit every pixel through PixelHand's public, validated editing interface.
const style = {
  id: "starfall", projection: "three-quarter", art_scale: 128, palette_size: 48,
  temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "hyper", motion: "sub-asset", mood: "whimsical", light_vector: [-0.7, -0.7],
  signature: "brass starlight, patinated teal roofs, plum cloud banks, and warm windows above a quiet night",
};
call("project_init", { game: "the-starfall-archive", style, canvas: { w: WIDTH, h: HEIGHT }, directions: ["down"], fps: 6.25 });
call("palette_set", { id: "starfall", spec: {
  ramps: Object.fromEntries(Object.entries(ramps).filter(([name]) => name !== "accent").map(([name, colors]) => [name, { role: name === "gold" ? "light" : "material", colors }])),
  single: Object.fromEntries(ramps.accent.map((rgb, i) => [`accent.${i}`, { rgb, role: "accent" }])),
} });
call("sprite_create", { id: "starfall", w: WIDTH, h: HEIGHT, palette: "starfall", style: "starfall", tier: "hero", asset_class: "scene", directions: ["down"], anchor: { x: 222, y: 148 }, design: { primary_read: "a lantern-bearing traveler approaches an observatory suspended above a sea of clouds", focal_accent: "the warm celestial window", provenance_note: "original code-authored pixels; no imported or generated images" } });
const symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const legend = Object.fromEntries(names.map((name, i) => [symbols[i], name]));
const cels = [];
for (let f = 0; f < FRAMES; f++) {
  const cel = `starfall.ambient.f${f}`;
  call("cel_new", { cel, w: WIDTH, h: HEIGHT, palette: "starfall" });
  const artwork = frame(f), map = [];
  for (let y = 0; y < HEIGHT; y++) map.push(Array.from(artwork.subarray(y * WIDTH, (y + 1) * WIDTH), i => symbols[i]).join(""));
  call("draw_named_map", { cel, map, legend });
  call("save_cel", { cel, sprite: "starfall", cel_key: `ambient/f${f}` });
  cels.push(cel);
  console.log(`Authored and saved frame ${f + 1}/${FRAMES}`);
}
const png = call("export_indexed_png", { cel: cels[0], name: "starfall-native" });
const gif = call("export_gif", { cels, palette: "starfall", name: "starfall", zoom: ZOOM, delay: DURATION });
const decoded = decodePNG(fs.readFileSync(png.file));
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = decoded.rgba[i * 4 + k];
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(root, "art"), path.join(destination, "art"), { recursive: true });
fs.copyFileSync(png.file, path.join(destination, "native.png"));
fs.copyFileSync(gif.file, path.join(destination, "starfall.gif"));
fs.writeFileSync(path.join(destination, "preview.png"), encodeRGB(WIDTH * ZOOM, HEIGHT * ZOOM, upscaleNearest(WIDTH, HEIGHT, rgb, ZOOM)));
fs.writeFileSync(path.join(destination, "animation.json"), JSON.stringify({ title: "The Starfall Archive", native: [WIDTH, HEIGHT], display_scale: ZOOM, palette_colors: names.length, duration_ms: DURATION, loop: true, frames: cels.map((cel, f) => ({ cel: `ambient/f${f}`, duration_ms: DURATION })), authored_with: "PixelHand public JavaScript API", license: "MIT" }, null, 2) + "\n");
console.log(JSON.stringify({ destination, native: [WIDTH, HEIGHT], colors: names.length, frames: FRAMES, gif_bytes: gif.bytes }, null, 2));
