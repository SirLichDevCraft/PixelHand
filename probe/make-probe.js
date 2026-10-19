// Vision-loop probe: generate images whose ground truth is known, so my
// description of what I "see" can be diffed against the real pixel data.
"use strict";
const fs = require("fs");
const path = require("path");
const { encodePNG, upscaleNearest } = require("./png.js");

const OUT = __dirname;
const PAL = {
  K: [17, 17, 24],   // near-black
  W: [238, 238, 232],// near-white
  R: [214, 58, 62],  // warm red
  G: [58, 176, 92],  // green
  B: [56, 96, 190],  // blue
  Y: [240, 208, 78], // yellow
  M: [190, 78, 168], // magenta
  C: [86, 182, 206], // cyan
};

// ---- Test A: 8x8 named-colour grid, upscaled 32x -> 256x256 -------------
const GA = [
  "K R G B Y M C W",
  "R K B G M Y W C",
  "G B K M C W R Y",
  "B G M K W C Y R",
  "Y M C W K R G B",
  "M Y W C R K B G",
  "C W M Y G B K R",
  "W C Y R B G M K",
].map((r) => r.split(" "));

function gridTest(grid, z) {
  const w = grid.length, h = grid[0].length;
  const small = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = PAL[grid[y][x]];
      small[(y * w + x) * 3] = c[0];
      small[(y * w + x) * 3 + 1] = c[1];
      small[(y * w + x) * 3 + 2] = c[2];
    }
  const big = upscaleNearest(w, h, small, z);
  return { w: w * z, h: h * z, rgb: big };
}

const A = gridTest(GA, 32);
fs.writeFileSync(path.join(OUT, "A_grid_256.png"), encodePNG(A.w, A.h, A.rgb));

// ---- Test B: same grid at 1x (64px) -> proves raw 1x is useless ---------
const Bsmall = gridTest(GA, 1);
fs.writeFileSync(path.join(OUT, "B_grid_1x_64.png"), encodePNG(Bsmall.w, Bsmall.h, Bsmall.rgb));

// ---- Test C: 16x24 mini sprite, upscaled 20x -> 320x480 ----------------
// A deliberately simple "hero" so shape + palette usage can be verified.
const SW = 16, SH = 24;
const sprite = Buffer.alloc(SW * SH * 3);
const put = (x, y, c) => {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const p = PAL[c];
  sprite[(y * SW + x) * 3] = p[0];
  sprite[(y * SW + x) * 3 + 1] = p[1];
  sprite[(y * SW + x) * 3 + 2] = p[2];
};
const SKIN = "Y", HAIR = "K", SHIRT = "B", PANTS = "M", BOOT = "R";
for (let y = 3; y <= 8; y++) for (let x = 5; x <= 10; x++) put(x, y, HAIR);      // hair block
for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) put(x, y, SKIN);       // face
put(6, 7, "K"); put(9, 7, "K");                                                   // eyes
for (let y = 10; y <= 16; y++) for (let x = 4; x <= 11; x++) put(x, y, SHIRT);   // torso
for (let y = 11; y <= 15; y++) { put(3, y, SKIN); put(12, y, SKIN); }            // arms
for (let y = 17; y <= 21; y++) for (let x = 5; x <= 10; x++) put(x, y, PANTS);   // legs
for (let y = 22; y <= 23; y++) { put(5, y, BOOT); put(6, y, BOOT); put(9, y, BOOT); put(10, y, BOOT); }
const NAMED = { K: "K", W: "W", R: "R", G: "G", B: "B", Y: "Y", M: "M", C: "C" };
const counts = {};
for (let i = 0; i < sprite.length; i += 3) {
  const key = `${sprite[i]},${sprite[i + 1]},${sprite[i + 2]}`;
  counts[key] = (counts[key] || 0) + 1;
}
const namedCounts = Object.entries(counts).map(([k, v]) => {
  const [r, g, b] = k.split(",").map(Number);
  const name = Object.keys(PAL).find((n) => PAL[n][0] === r && PAL[n][1] === g && PAL[n][2] === b) || "?";
  return [name, v];
}).filter(([n, v]) => n !== "?").sort((a, b) => b[1] - a[1]);

const Crgb = upscaleNearest(SW, SH, sprite, 20);
const C = { w: SW * 20, h: SH * 20, rgb: Crgb };
fs.writeFileSync(path.join(OUT, "C_sprite_320x480.png"), encodePNG(C.w, C.h, C.rgb));

// ---- Test D: luminance ramp + hue ramp strip, JPEG-chroma stress test ---
const DW = 64, DH = 16;
const ramp = Buffer.alloc(DW * DH * 3);
for (let x = 0; x < DW; x++) {
  const g = Math.round(20 + (x / (DW - 1)) * 215);
  for (let y = 0; y < 8; y++) { ramp[(y * DW + x) * 3] = g; ramp[(y * DW + x) * 3 + 1] = g; ramp[(y * DW + x) * 3 + 2] = g; }
  const hue = Math.round((x / (DW - 1)) * 360);
  const [r, gg, b] = hsl(hue, 0.65, 0.55);
  for (let y = 8; y < 16; y++) { ramp[(y * DW + x) * 3] = r; ramp[(y * DW + x) * 3 + 1] = gg; ramp[(y * DW + x) * 3 + 2] = b; }
}
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return t.map((v) => Math.round((v + m) * 255));
}
const Drgb = upscaleNearest(DW, DH, ramp, 12);
const D = { w: DW * 12, h: DH * 12, rgb: Drgb };
fs.writeFileSync(path.join(OUT, "D_ramps_768x192.png"), encodePNG(D.w, D.h, D.rgb));

fs.writeFileSync(path.join(OUT, "ground-truth.json"), JSON.stringify({
  A: { size: [A.w, A.h], zoom: 32, grid: GA.map((r) => r.join("")) },
  B: { size: [Bsmall.w, Bsmall.h], zoom: 1, grid: GA.map((r) => r.join("")) },
  C: { size: [C.w, C.h], zoom: 20, art: [SW, SH],
       counts: namedCounts },
  D: { size: [D.w, D.h], zoom: 12, art: [DW, DH] },
}, null, 2));

for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
  const s = fs.statSync(path.join(OUT, f));
  console.log(`${f}  ${s.size} bytes`);
}
console.log("probe images written to", OUT);
