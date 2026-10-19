// Probe 3: coordinate-labeled inspection views.
// If I can read burned-in axis labels and name a cell exactly, the engine can
// do chunked, addressable viewing. If I can't, chunking has to work differently.
"use strict";
const fs = require("fs");
const path = require("path");
const { encodePNG } = require("./png.js");
const OUT = __dirname;

const PAL = {
  K: [17, 17, 24], W: [238, 238, 232], R: [214, 58, 62], G: [58, 176, 92],
  B: [56, 96, 190], Y: [240, 208, 78], M: [190, 78, 168], C: [86, 182, 206],
};
const GRID = [
  "KRGBYMCW", "RKBGMYWC", "GBKMCWRY", "BGMKWCYR",
  "YMCWKRGB", "MYWCRKBG", "CWMYGBKR", "WCYRBGMK",
];

// 5x7 bitmap font: labels must survive the JPEG re-encode pi applies to images.
const FONT = {
  "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
  "3": "####.|....#|....#|.###.|....#|....#|####.",
  "4": "#..#.|#..#.|#..#.|####.|...#.|...#.|...#.",
  "5": "#####|#....|#....|####.|....#|....#|####.",
  "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
  "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "###..|#..#.|#...#|#...#|#...#|#..#.|###..",
  E: "#####|#....|#....|####.|....#|....#|#####",
  F: "#####|#....|#....|####.|....#|....#|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.###.",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
};

const Z = 40, FS = 4, GUT = 44; // art zoom, font scale, gutter in screen px
const N = 8;
const W = N * Z + GUT, H = N * Z + GUT;
const img = Buffer.alloc(W * H * 3);
const px = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c); };

rect(0, 0, W, H, [24, 24, 30]);
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const c = PAL[GRID[y][x]];
    rect(GUT + x * Z, GUT + y * Z, Z, Z, c);
  }
// grid separators, 2 screen px thick so JPEG 4:2:0 chroma subsampling cannot eat them
for (let i = 0; i <= N; i++) {
  rect(GUT + i * Z - 1, GUT, 2, N * Z, [12, 12, 16]);
  rect(GUT, GUT + i * Z - 1, N * Z, 2, [12, 12, 16]);
}
function glyph(ch, x0, y0, color) {
  const rows = (FONT[ch] || FONT["0"]).split("|");
  for (let r = 0; r < 7; r++)
    for (let cIdx = 0; cIdx < 5; cIdx++)
      if (rows[r][cIdx] === "#") rect(x0 + cIdx * FS, y0 + r * FS, FS, FS, color);
}
for (let i = 0; i < N; i++) {
  glyph(String.fromCharCode(65 + i), GUT + i * Z + 10, 8, [255, 255, 255]);   // columns A-H
  glyph(String(i + 1), 10, GUT + i * Z + 6, [255, 255, 255]);                 // rows 1-8
}

fs.writeFileSync(path.join(OUT, "G_labeled_grid.png"), encodePNG(W, H, img));
fs.writeFileSync(path.join(OUT, "ground-truth-3.json"), JSON.stringify({
  asks: ["A1", "D4", "H8", "C3", "F6", "B7", "E5", "G2"],
  truth: Object.fromEntries(["A1", "D4", "H8", "C3", "F6", "B7", "E5", "G2"].map((a) => {
    const col = a.charCodeAt(0) - 65, row = +a[1] - 1;
    return [a, GRID[row][col]];
  })),
}, null, 2));
console.log("wrote G_labeled_grid.png", W + "x" + H);
