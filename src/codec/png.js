// PixelHand PNG codec — zero dependencies, promoted from the verified Phase 0 probe.
// Node's zlib provides deflate/inflate. No sharp, no canvas, no pngjs.
"use strict";
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Truecolour RGB. Used for every inspection render (labels, grids, legends). */
function encodeRGB(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter none: hard pixel edges stay hard
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Palette-indexed PNG (colour type 3 + tRNS). This is the *asset* export path:
 * the file carries the declared palette exactly, so a shipped sprite cannot
 * contain a colour the style bible did not authorise.
 *
 * `transparentIndex` is the PALETTE ENTRY that stands for transparency; cel value -1 maps to it.
 * The export layer reserves entry 0 for that so the declared palette stays untouched.
 */
function encodeIndexed(w, h, indices, palette, transparentIndex = 0) {
  const n = palette.length;
  if (n < 1 || n > 256) throw new Error(`indexed PNG needs 1..256 palette entries, got ${n}`);
  for (const i of indices) if (i >= n) throw new Error(`palette index ${i} out of range`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(n * 3);
  palette.forEach((c, k) => { plte[k * 3] = c[0]; plte[k * 3 + 1] = c[1]; plte[k * 3 + 2] = c[2]; });
  const chunks = [PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", plte)];
  if (transparentIndex >= 0) {
    const trns = Buffer.alloc(Math.max(transparentIndex + 1, 1));
    trns.fill(255); trns[transparentIndex] = 0;
    chunks.push(chunk("tRNS", trns));
  }
  const stride = w;
  const raw = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0;
    for (let x = 0; x < w; x++) raw[y * (1 + stride) + 1 + x] = indices[y * w + x] < 0 ? transparentIndex : indices[y * w + x];
  }
  chunks.push(chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

/** Nearest-neighbour integer upscale — the whole inspection trick: 1 art pixel -> Z x Z screen pixels. */
function upscaleNearest(w, h, rgb, z, channels = 3) {
  const out = Buffer.alloc(w * z * h * z * channels);
  const rowBytes = w * channels;
  for (let y = 0; y < h * z; y++) {
    const sy = Math.floor(y / z) * rowBytes;
    for (let x = 0; x < w * z; x++) {
      const sx = Math.floor(x / z) * channels;
      const o = (y * w * z + x) * channels;
      for (let k = 0; k < channels; k++) out[o + k] = rgb[sy + sx + k];
    }
  }
  return out;
}

/** Box-filter downscale. Used by the `squint` render mode (does the sprite survive game scale?). */
function downscaleBox(w, h, rgb, factor) {
  const ow = Math.max(1, Math.round(w / factor)), oh = Math.max(1, Math.round(h / factor));
  const out = Buffer.alloc(ow * oh * 3);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    const y0 = Math.floor(y * h / oh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / oh));
    const x0 = Math.floor(x * w / ow), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / ow));
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const o = (sy * w + sx) * 3; r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; n++;
    }
    const o = (y * ow + x) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
  return { w: ow, h: oh, rgb: out };
}

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, colorType = 0, bitDepth = 8, idat = [];
  let plte = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("unsupported bit depth " + bitDepth);
  const channels = colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 4;
  const bpp = channels;
  const stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += Math.floor((a + b) / 2);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[x] = v & 0xff;
    }
    line.copy(out, y * stride, 0, stride);
    prev = line;
  }
  const rgba = Buffer.alloc(w * h * 4);
  const idxMap = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    let r = 0, g = 0, b = 0, a = 255;
    if (colorType === 3) {
      const idx = out[i]; idxMap[i] = idx;
      r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 6) { r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; }
    else if (colorType === 2) { r = out[i*3]; g = out[i*3+1]; b = out[i*3+2]; }
    else if (colorType === 0) { r = g = b = out[i]; }
    else { r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; }
    rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b; rgba[i*4+3] = a;
  }
  const palette = plte ? Array.from({ length: plte.length / 3 }, (_, k) =>
    [plte[k*3], plte[k*3+1], plte[k*3+2], trns && k < trns.length ? trns[k] : 255]) : null;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i*3] = rgba[i*4]; rgb[i*3+1] = rgba[i*4+1]; rgb[i*3+2] = rgba[i*4+2]; }
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
  return {
    w, h, colorType, bitDepth, rgba, rgb, data: rgb, channels: 3, alpha, trns,
    palette,
    indices: colorType === 3 ? idxMap : null,
  };
}

module.exports = { encodeRGB, encodeIndexed, decodePNG, upscaleNearest, downscaleBox, crc32, chunk };
