"use strict";
const assert = require("assert");
const { encodeRGB, encodeIndexed, decodePNG, upscaleNearest, downscaleBox } = require("../src/codec/png.js");
const { Cel, rle, unrle, diff, applyPatch, UndoStack, charFor, indexFor } = require("../src/core/cel.js");
const { Palette, buildRamp } = require("../src/core/palette.js");
const { validateCoordinate, assertStyle, negativeSpace, featureCount } = require("../src/core/style.js");
const { renderCel, contactSheet, gridText } = require("../src/render.js");
const { audit } = require("../src/audit.js");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + " :: " + e.message); } };

// ---- codec ---------------------------------------------------------------------
t("rgb round-trip 1x1", () => {
  const rgb = Buffer.from([255, 0, 128]);
  const d = decodePNG(encodeRGB(1, 1, rgb));
  assert.deepStrictEqual([d.w, d.h], [1, 1]);
  assert.deepStrictEqual([...d.rgb], [255, 0, 128]);
});
t("rgb round-trip non-square 7x3", () => {
  const w = 7, h = 3, rgb = Buffer.alloc(w*h*3);
  for (let i = 0; i < w*h; i++) { rgb[i*3] = i*10; rgb[i*3+1] = 255-i*10; rgb[i*3+2] = (i*37)&255; }
  const d = decodePNG(encodeRGB(w, h, rgb));
  assert.strictEqual(d.rgb.compare(rgb), 0);
});
t("indexed round-trip keeps palette exactly", () => {
  const pal = [[0,0,0],[10,20,30],[200,10,10],[0,255,0]];   // entry 0 is the reserved transparent entry
  const idx = Int16Array.from([1,2,3,-1,1,2]);
  const d = decodePNG(encodeIndexed(3, 2, idx, pal, 0));
  assert.strictEqual(d.colorType, 3);
  assert.deepStrictEqual(d.palette.slice(0,4).map(c=>c.slice(0,3)), pal);
  assert.deepStrictEqual([...d.indices], [1,2,3,0,1,2], "cel -1 must map to the transparent entry");
  assert.strictEqual(d.rgba[3*4+3], 0, "transparent entry must carry alpha 0");
  assert.strictEqual(d.rgba[0*4+3], 255);
});
t("indexed refuses out-of-range index", () => {
  assert.throws(() => encodeIndexed(1, 1, Int16Array.from([5]), [[1,2,3]]), /out of range/);
});
t("all five PNG filter types decode", () => {
  // hand-build a 4x2 RGB stream using each filter type on a row
  const zlib = require("zlib");
  const { crc32, chunk } = require("../src/codec/png.js");
  const w = 4, h = 5;
  const src = [];
  for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w*3; x++) row.push((x*17 + y*29) & 255); src.push(row); }
  const filters = [0,1,2,3,4];
  const raw = Buffer.alloc(h * (1 + w*3));
  let prevOrig = Buffer.alloc(w*3);
  for (let y = 0; y < h; y++) {
    const f = filters[y % 5];
    raw[y*(1+w*3)] = f;
    const orig = Buffer.from(src[y]);          // filters predict from RAW values, not encoded ones
    const enc = Buffer.alloc(w*3);
    for (let x = 0; x < w*3; x++) {
      const a = x>=3 ? orig[x-3] : 0, b = prevOrig[x], c = x>=3 ? prevOrig[x-3] : 0;
      let pr = 0;
      if (f===1) pr = a;
      else if (f===2) pr = b;
      else if (f===3) pr = Math.floor((a+b)/2);
      else if (f===4) { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); pr=(pa<=pb&&pa<=pc)?a:(pb<=pc?b:c); }
      enc[x] = (orig[x] - pr) & 255;
    }
    enc.copy(raw, y*(1+w*3)+1);
    prevOrig = orig;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=2;
  const buf = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const d = decodePNG(buf);
  const expect = Buffer.from(src.flat());
  assert.strictEqual(d.rgb.compare(expect), 0, "filter reconstruction mismatch");
});
t("upscaleNearest is exact nearest-neighbour", () => {
  const rgb = Buffer.from([1,2,3, 4,5,6]);
  const up = upscaleNearest(2, 1, rgb, 3);
  assert.strictEqual(up.length, 2 * 3 * 1 * 3 * 3);
  assert.deepStrictEqual([...up.slice(0, 9)], [1,2,3, 1,2,3, 1,2,3]);
});
t("downscaleBox averages the box", () => {
  const rgb = Buffer.from([0,0,0, 200,200,200, 0,0,0, 200,200,200]);
  const s = downscaleBox(2, 2, rgb, 2);
  assert.strictEqual(s.w, 1); assert.strictEqual(s.h, 1);
  assert.strictEqual(s.rgb[0], 100);
});

// ---- cel -----------------------------------------------------------------------
t("cel grid round-trip", () => {
  const c = new Cel(5, 3, "p", "test");
  c.set(0,0,0); c.set(4,2,92); c.set(2,1,-1);
  const back = Cel.fromGrid(c.toGrid());
  assert.ok(c.equals(back));
  assert.strictEqual(back.paletteId, "p");
  assert.strictEqual(back.name, "test");
});
t("charset covers 93 entries and '.' is transparent", () => {
  assert.strictEqual(charFor(-1), ".");
  assert.strictEqual(indexFor("."), -1);
  for (let i = 0; i < 93; i++) assert.strictEqual(indexFor(charFor(i)), i);
});
t("out-of-bounds edit is reported, not applied", () => {
  const c = new Cel(2, 2);
  const r = c.set(5, 0, 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "out_of_bounds");
});
t("no-op edit reports changed:false", () => {
  const c = new Cel(2, 2); c.set(0,0,3);
  assert.strictEqual(c.set(0,0,3).changed, false);
});
t("pixel map space means leave-alone", () => {
  const c = new Cel(3, 1); c.set(1,0,7);
  c.applyPixelMap(["A B"]);
  assert.strictEqual(c.get(0,0), indexFor("A"));
  assert.strictEqual(c.get(1,0), 7);
  assert.strictEqual(c.get(2,0), indexFor("B"));
});
t("diff/patch/undo", () => {
  const a = new Cel(3, 3); a.set(0,0,1);
  const before = a.clone();
  const b = a.clone(); b.set(1,1,2); b.set(0,0,-1);
  const e = diff(a, b);
  assert.strictEqual(e.length, 2);
  const u = new UndoStack(); u.push(e); applyPatch(a, e);
  assert.ok(a.equals(b), "patch must reproduce the target");
  assert.ok(u.undo(a), "undo must report success");
  assert.ok(a.equals(before), "undo must restore the original");
  assert.strictEqual(u.undo(new Cel(1,1)), false, "undo on an empty stack reports failure");
});
t("rle round-trip", () => {
  const rows = ["...###...", "##.......", "###..####"];
  const s = rle(rows);
  const back = unrle(s, 9, 3);
  assert.deepStrictEqual(back, rows, `rle '${s}' -> ${JSON.stringify(back)}`);
});
t("bbox and counts", () => {
  const c = new Cel(4, 4); c.set(1,1,0); c.set(2,2,0); c.set(3,3,1);
  const bb = c.bbox();
  assert.deepStrictEqual([bb.x0,bb.y0,bb.w,bb.h,bb.area], [1,1,3,3,3]);
  assert.strictEqual(c.counts().get(0), 2);
});

// ---- palette -------------------------------------------------------------------
t("ramp builds requested steps with hue shift", () => {
  const r = buildRamp({ base: "#8a9bb5", steps: 5, value: [0.25, 0.85], hueShift: 12 });
  assert.strictEqual(r.length, 5);
  assert.ok(r[0].value < r[4].value, "ramp must be ordered dark -> light");
  assert.notDeepStrictEqual(r[0].rgb, r[4].rgb);
});
t("hueLock produces a pure value ramp", () => {
  const a = buildRamp({ base: "#808080", steps: 4, hueShift: 20, hueLock: true });
  for (const s of a) assert.ok(s.rgb[0] === s.rgb[1] && s.rgb[1] === s.rgb[2], `grey ramp drifted chromatic: ${s.rgb}`);
  assert.ok(new Set(a.map(s => s.rgb[0])).size === 4, "a value ramp must still produce distinct steps");
});
t("palette fromSpec builds ramps and nearest() only returns authorised colours", () => {
  const p = Palette.fromSpec("t", { ramps: { metal: { base: "#8a9bb5", steps: 4, hueShift: 10 } }, single: { accent: { rgb: "#ffd23f", role: "accent" } } });
  assert.strictEqual(p.size, 5);
  const i = p.nearest([250, 250, 250]);
  assert.ok(p.has(i));
  assert.ok(p.ramp("metal").length === 4);
});

// ---- style ---------------------------------------------------------------------
t("valid coordinate passes", () => {
  const r = validateCoordinate({ projection:"topdown", art_scale:16, palette_size:24, temperature:"warm-cool-hue-shift",
    edge_policy:"selective-dark", shading:"ramp-lit", detail:"moderate", motion:"4-frame", mood:"cozy-warm" });
  assert.ok(r.ok, JSON.stringify(r.errors));
});
t("impossible coordinates are refused", () => {
  const base = { projection:"topdown", art_scale:8, palette_size:24, temperature:"warm-cool-hue-shift",
    edge_policy:"chunky-2px", shading:"ramp-lit", detail:"moderate", motion:"4-frame", mood:"cozy-warm" };
  const a = validateCoordinate(base);
  assert.ok(!a.ok && a.errors.some(e => e.rule === "outline-2px-on-tiny"));
  const b = validateCoordinate({ ...base, art_scale: 16, edge_policy: "none", detail: "hyper", palette_size: 16 });
  assert.ok(!b.ok && b.errors.some(e => e.rule === "hyper-detail-on-small"));
  const c = validateCoordinate({ ...base, art_scale: 32, edge_policy: "none", detail: "dense-grain", palette_size: 4 });
  assert.ok(!c.ok && c.errors.some(e => e.rule === "dither-without-values"));
  const d = validateCoordinate({ ...base, art_scale: 64, edge_policy: "none", detail: "moderate", palette_size: 16, shading: "sculpted" });
  assert.ok(!d.ok && d.errors.some(e => e.rule === "sculpted-needs-palette"));
});
t("illegal axis value is refused with the legal domain", () => {
  const r = validateCoordinate({ projection:"isometric", art_scale:16, palette_size:16, temperature:"grey-value",
    edge_policy:"none", shading:"flat", detail:"pristine", motion:"static", mood:"sterile" });
  assert.ok(!r.ok && r.errors[0].message.includes("topdown"));
});
t("negative space detects a lump vs a loop", () => {
  const lump = new Cel(8, 8); lump.fill(0);
  const loop = new Cel(8, 8);
  for (let x=1;x<7;x++) { loop.set(x,1,0); loop.set(x,6,0); }
  for (let y=1;y<7;y++) { loop.set(1,y,0); loop.set(6,y,0); }
  assert.strictEqual(negativeSpace(lump).enclosed, 0);
  assert.ok(negativeSpace(loop).enclosed >= 16);
});
t("feature budget counts separate masses", () => {
  const c = new Cel(16, 16);
  for (let i = 0; i < 4; i++) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) c.set(i*4 + x, y, 0);
  const fc = featureCount(c);
  assert.strictEqual(fc.features, 4, JSON.stringify(fc));
  assert.strictEqual(fc.orphans, 0);
});

// ---- render + audit ------------------------------------------------------------
t("render produces a decodable labelled PNG", () => {
  const p = Palette.fromSpec("t", { ramps: { metal: { base: "#8a9bb5", steps: 4, hueShift: 10 } } });
  const c = new Cel(8, 8, "t", "cube"); c.set(3,3,0); c.set(4,4,2);
  const out = renderCel(c, p, { zoom: 10 });
  const d = decodePNG(out.buffer);
  assert.ok(d.w > c.w * 8 && d.h > c.h * 8, "render must include header and legend");
  assert.ok(out.zoom >= 8);
});
t("audit catches lone pixels and detached specks", () => {
  const p = Palette.fromSpec("t", { ramps: { metal: { base: "#8a9bb5", steps: 4, hueShift: 10 } } });
  const c = new Cel(8, 8, "t", "bad");
  for (let y=2;y<6;y++) for (let x=2;x<6;x++) c.set(x,y,0);
  c.set(7,0,3);
  const a = audit(c, { palette: p, style: { palette_size: 8, detail: "moderate" } });
  assert.ok(!a.ok);
  assert.ok(a.findings.some(f => f.rule === "lone_pixel"));
  assert.ok(a.findings.some(f => f.rule === "detached_speck"));
});
t("audit catches ramp jumps", () => {
  const p = Palette.fromSpec("t", { ramps: { metal: { base: "#8a9bb5", steps: 5, hueShift: 10 } } });
  const c = new Cel(4, 1, "t", "jump");
  c.set(0,0,0); c.set(1,0,4);
  const a = audit(c, { palette: p, style: { palette_size: 8, detail: "moderate" } });
  assert.ok(a.findings.some(f => f.rule === "ramp_jump"));
});
t("gridText is coordinate-addressed", () => {
  const c = new Cel(12, 4, "t", "g"); c.set(5,2,0);
  const g = gridText(c, { labelEvery: 4 });
  const lines = g.split("\n");
  assert.strictEqual(lines.length, 5);
  assert.ok(lines[3].indexOf(charFor(0)) > 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
