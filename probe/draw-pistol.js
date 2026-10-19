// Test of the plan's weakest assumption: can the loop produce GOOD illustrative
// pixel art? One 32x32 pistol, high-contrast / strong-outline register, cool metal
// ramps with a warm grip, light from top-left. Mechanical on purpose: it exposes
// craft (edge, ramp, silhouette, negative space) without hiding behind plumbing.
"use strict";
const fs = require("fs");
const { encodePNG, upscaleNearest } = require("./png.js");

const W = 32, H = 32;
const P = {
  "1": [20, 19, 26],    // outline: near-black navy, never pure black
  "2": [58, 63, 82],    // metal shadow (cool)
  "3": [90, 99, 121],   // metal mid
  "4": [138, 147, 168], // metal main
  "5": [185, 194, 212], // metal light
  "6": [226, 232, 242], // metal highlight
  "7": [74, 47, 34],    // grip shadow (warm)
  "8": [122, 78, 51],   // grip mid
  "9": [168, 112, 74],  // grip light
  "A": [107, 74, 30],   // brass shadow
  "B": [185, 138, 52],  // brass mid
  "C": [232, 197, 107], // brass highlight
};
const KEYS = Object.keys(P);
const buf = new Int16Array(W * H).fill(-1);
const set = (x, y, k) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = KEYS.indexOf(k); };
const rect = (x0, x1, y0, y1, k) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, k); };

// --- masses ------------------------------------------------------------------
rect(8, 27, 8, 12, "4");            // slide
rect(8, 10, 6, 7, "3");             // rear sight
rect(24, 26, 6, 7, "3");            // front sight
rect(9, 21, 13, 15, "4");           // frame
rect(17, 22, 16, 16, "3");          // guard top
rect(19, 22, 17, 18, "3");          // guard rear wall
rect(17, 19, 19, 20, "3");          // guard front curve
rect(16, 17, 16, 18, "B");          // trigger

// grip: angled back-left going down, authored row by row
const grip = [[9,16,15],[9,16,16],[8,15,17],[8,15,18],[8,15,19],[8,14,20],[8,14,21],
              [7,14,22],[7,14,23],[7,14,24],[7,13,25],[7,13,26],[6,13,27],[6,13,28]];
for (const [x0, x1, y] of grip) for (let x = x0; x <= x1; x++) set(x, y, "8");

// --- shading: light from top-left, ramps walked not filtered ------------------
for (let x = 8; x <= 27; x++) { set(x, 8, "6"); set(x, 9, "5"); set(x, 12, "3"); } // slide top light / bottom shadow
for (let y = 9; y <= 11; y++) { set(27, y, "2"); }                                  // muzzle face turns away from light
for (const sx of [10, 12, 14]) for (let y = 9; y <= 11; y++) set(sx, y, "3");      // slide serrations
for (let x = 9; x <= 21; x++) { set(x, 13, "5"); set(x, 15, "2"); }                // frame top light / bottom shadow
for (const [x0, x1, y] of grip) { set(x0, y, "9"); set(x1, y, "7"); }              // grip lit left, shadowed right
set(16, 16, "C"); set(17, 18, "A"); set(16, 18, "A");                              // brass specular + shadow
// grip texture: 2px clusters, on-ramp, never lone pixels
set(10, 20, "7"); set(11, 20, "7"); set(9, 24, "7"); set(10, 24, "7"); set(12, 17, "9"); set(13, 17, "9");
// corner bevels (1px, ramp-adjacent only)
set(8, 12, "2"); set(27, 8, "5"); set(21, 15, "3"); set(22, 16, "2");

// --- outline: any transparent pixel touching the subject ----------------------
const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && buf[y * W + x] >= 0;
const out = new Int16Array(buf);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (buf[y * W + x] >= 0) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && filled(x + dx, y + dy)) { out[y * W + x] = 0; break; }
  }
}

// --- metrics -----------------------------------------------------------------
const counts = new Map(); let silhouette = 0; let lone = 0;
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -2 : out[y * W + x];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = at(x, y); if (v < 0) continue;
  silhouette++;
  counts.set(v, (counts.get(v) || 0) + 1);
  if (at(x-1,y) !== v && at(x+1,y) !== v && at(x,y-1) !== v && at(x,y+1) !== v) lone++;
}
console.log(`silhouette ${silhouette} px of ${W*H}  |  colours ${counts.size}  |  lone pixels ${lone}`);

// --- render: Z=20, grid every 4 art px, axis labels, palette legend -----------
const Z = 20, GUT = 44;
const RW = W * Z + GUT, RH = H * Z + GUT;
const img = Buffer.alloc(RW * RH * 3);
const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < RW && y < RH) { const o = (y * RW + x) * 3; img[o] = c[0]; img[o+1] = c[1]; img[o+2] = c[2]; } };
const box = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c); };
box(0, 0, RW, RH, [30, 30, 38]);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = out[y * W + x];
  box(GUT + x * Z, GUT + y * Z, Z, Z, v < 0 ? [46, 46, 56] : P[KEYS[v]]);
}
for (let i = 0; i <= W; i++) box(GUT + i * Z - 1, GUT, 2, H * Z, [12, 12, 16]);
for (let i = 0; i <= H; i++) box(GUT, GUT + i * Z - 1, W * Z, 2, [12, 12, 16]);

const FONT = {
  "0":".###.|#...#|#..##|#.#.#|##..#|#...#|.###.","1":"..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2":".###.|#...#|....#|...#.|..#..|.#...|#####","3":"####.|....#|....#|.###.|....#|....#|####.",
  "4":"#..#.|#..#.|#..#.|####.|...#.|...#.|...#.","5":"#####|#....|#....|####.|....#|....#|####.",
  "6":"..##.|.#...|#....|####.|#...#|#...#|.###.","7":"#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8":".###.|#...#|#...#|.###.|#...#|#...#|.###.","9":".###.|#...#|#...#|.####|....#|...#.|.##..",
};
const FS = 5;
const glyph = (ch, x0, y0, col) => { const rows = (FONT[ch] || FONT["0"]).split("|");
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (rows[r][c] === "#") box(x0 + c * FS, y0 + r * FS, FS, FS, col); };
const num = (n, x0, y0, col) => { const s = String(n); for (let i = 0; i < s.length; i++) glyph(s[i], x0 + i * 5 * FS, y0, col); };
for (let i = 0; i < W; i += 4) num(i, GUT + i * Z + 6, 8, [255, 255, 255]);
for (let i = 0; i < H; i += 4) num(i, 4, GUT + i * Z + 8, [255, 255, 255]);

fs.writeFileSync(require("path").join(__dirname, "draw_pistol_32.png"), encodePNG(RW, RH, img));
console.log(`wrote draw_pistol_32.png  ${RW}x${RH}`);

// Exported so the craft layer can measure this draft directly rather than re-reading its PNG.
module.exports = { W, H, out, KEYS, P };
