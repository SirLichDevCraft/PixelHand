// Probe 2: the two capabilities the whole engine hinges on.
//   E -> can I find a single wrong pixel inside a flat field? (quality control)
//   F -> can I compare 4 animation frames side by side?   (animation QC)
"use strict";
const fs = require("fs");
const path = require("path");
const { encodePNG } = require("./png.js");
const OUT = __dirname;

const PAL = {
  K: [17, 17, 24], W: [238, 238, 232], R: [214, 58, 62], G: [58, 176, 92],
  B: [56, 96, 190], Y: [240, 208, 78], M: [190, 78, 168], C: [86, 182, 206],
  N: [40, 40, 48], // guide-line grey
};

// ---------- E: 24x24 flat magenta field with ONE orphan cyan pixel --------
const EW = 24, EH = 24, EZ = 24;
const ORPHAN = { x: 17, y: 6 };
const e = Buffer.alloc(EW * EH * 3);
for (let y = 0; y < EH; y++)
  for (let x = 0; x < EW; x++) {
    // a soft magenta ramp so the field is not trivially uniform
    const t = (x + y) / (EW + EH - 2);
    const base = t < 0.5 ? [172, 66, 150] : [204, 92, 180];
    const c = (x === ORPHAN.x && y === ORPHAN.y) ? PAL.C : base;
    const o = (y * EW + x) * 3;
    e[o] = c[0]; e[o + 1] = c[1]; e[o + 2] = c[2];
  }

// ---------- F: 4-frame walk cycle contact sheet ---------------------------
const FW = 16, FH = 24, FZ = 16, GAP = 4; // art px gap between frames
const frames = [];
const SKIN = [238, 200, 120], SHIRT = [56, 96, 190], PANTS = [70, 70, 96], BOOT = [214, 58, 62];
// Classic 4-frame walk: contact -> pass -> contact -> pass, legs alternate.
const legSets = [
  { l: 0, r: 0 },   // f0 contact: both legs together
  { l: -1, r: 1 },  // f1 pass: left back, right forward
  { l: 0, r: 0 },   // f2 contact
  { l: 1, r: -1 },  // f3 pass: opposite
];
const bob = [0, -1, 0, -1]; // vertical bob = sub-pixel-ish bounce
function buildFrame(li) {
  const s = Buffer.alloc(FW * FH * 3);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= FW || y >= FH) return;
    const o = (y * FW + x) * 3; s[o] = c[0]; s[o + 1] = c[1]; s[o + 2] = c[2];
  };
  const dy = bob[li];
  for (let y = 2 + dy; y <= 7 + dy; y++) for (let x = 5; x <= 10; x++) put(x, y, [30, 26, 30]);   // hair
  for (let y = 5 + dy; y <= 8 + dy; y++) for (let x = 6; x <= 9; x++) put(x, y, SKIN);            // head
  for (let y = 9 + dy; y <= 15 + dy; y++) for (let x = 4; x <= 11; x++) put(x, y, SHIRT);         // torso
  // legs: horizontal offset encodes stride
  const l = legSets[li].l, r = legSets[li].r;
  for (let y = 16; y <= 21; y++) { put(5 + l, y, PANTS); put(6 + l, y, PANTS); put(9 + r, y, PANTS); put(10 + r, y, PANTS); }
  for (let y = 22; y <= 23; y++) { put(5 + l, y, BOOT); put(6 + l, y, BOOT); put(9 + r, y, BOOT); put(10 + r, y, BOOT); }
  return s;
}
frames.push(...legSets.map((_, i) => buildFrame(i)));

const sheetW = FW * 4 + GAP * 3, sheetH = FH;
const sheet = Buffer.alloc(sheetW * sheetH * 3);
frames.forEach((f, i) => {
  const ox = i * (FW + GAP);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const o = (y * sheetW + ox + x) * 3, s = (y * FW + x) * 3;
      sheet[o] = f[s]; sheet[o + 1] = f[s + 1]; sheet[o + 2] = f[s + 2];
    }
});

// ---------- screen-space overlay: nearest upscale then draw guides --------
function upscale(buf, w, h, z) {
  const out = Buffer.alloc(w * z * h * z * 3);
  for (let y = 0; y < h * z; y++)
    for (let x = 0; x < w * z; x++) {
      const s = (Math.floor(y / z) * w + Math.floor(x / z)) * 3;
      const o = (y * w * z + x) * 3;
      out[o] = buf[s]; out[o + 1] = buf[s + 1]; out[o + 2] = buf[s + 2];
    }
  return out;
}
function drawGuides(buf, W, H, cell, thick, color) {
  const px = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; };
  for (let gx = 0; gx <= W; gx += cell)
    for (let t = 0; t < thick; t++) for (let y = 0; y < H; y++) px(gx + t, y, color);
  for (let gy = 0; gy <= H; gy += cell)
    for (let t = 0; t < thick; t++) for (let x = 0; x < W; x++) px(x, gy + t, color);
}

const Ebig = upscale(e, EW, EH, EZ);
drawGuides(Ebig, EW * EZ, EH * EZ, 4 * EZ, 2, PAL.N); // guide every 4 art px, 2 screen px thick
fs.writeFileSync(path.join(OUT, "E_orphan_576.png"), encodePNG(EW * EZ, EH * EZ, Ebig));

const Fbig = upscale(sheet, sheetW, sheetH, FZ);
fs.writeFileSync(path.join(OUT, "F_walk4_1216x384.png"), encodePNG(sheetW * FZ, sheetH * FZ, Fbig));

fs.writeFileSync(path.join(OUT, "ground-truth-2.json"), JSON.stringify({
  E: { orphan: ORPHAN, field: [EW, EH], note: "magenta ramp, one cyan pixel" },
  F: { frames: legSets, bob, frameSize: [FW, FH], gap: GAP },
}, null, 2));
console.log("E orphan at art px", ORPHAN, "-> screen px", [ORPHAN.x * EZ, ORPHAN.y * EZ]);
console.log("F sheet", sheetW * FZ + "x" + sheetH * FZ, "frames at x offsets", frames.map((_, i) => i * (FW + GAP) * FZ));
