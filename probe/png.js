// Zero-dependency PNG encode/decode for the PixelHand engine probe.
// Node's built-in zlib handles deflate/inflate; no sharp, no canvas, no pngjs.
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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/**
 * pixels: Uint8Array RGB, length w*h*3
 */
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none (progressive JPEG re-encode is a nightmare for pixel art)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none -> keeps hard pixel edges hard
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbour integer upscale. This is the whole trick: 1 art pixel -> Z x Z screen pixels. */
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
  const channels = colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 3;
  const bpp = Math.max(1, Math.floor(bitDepth * channels / 8));
  const pxPerGroup = bitDepth === 8 ? 1 : 0; // only 8-bit depths supported here
  if (bitDepth !== 8) throw new Error("unsupported bit depth " + bitDepth);
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
  // Normalise everything to RGBA so callers never have to care about the source mode.
  const rgba = Buffer.alloc(w * h * 4);
  const idxMap = new Int32Array(w * h); // palette index per pixel (-1 when not indexed)
  for (let i = 0; i < w * h; i++) {
    let r = 0, g = 0, b = 0, a = 255, idx = -1;
    if (colorType === 3) {
      idx = out[i];
      r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 6) {
      r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3];
    } else if (colorType === 2) {
      r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2];
    } else if (colorType === 0) {
      r = g = b = out[i];
    } else {
      r = out[i * 2]; g = out[i * 2 + 1]; b = out[i * 2 + 2]; a = out[i * 2 + 3];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
    idxMap[i] = idx;
  }
  const palette = plte ? Array.from({ length: plte.length / 3 }, (_, k) => [plte[k * 3], plte[k * 3 + 1], plte[k * 3 + 2], trns && k < trns.length ? trns[k] : 255]) : null;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  return { w, h, colorType, rgba, rgb, palette, indices: colorType === 3 ? idxMap : null };
}

module.exports = { encodePNG, decodePNG, upscaleNearest };
