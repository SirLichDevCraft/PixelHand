// Zero-dependency GIF89a encoder, including animation.
// The engine is palette-indexed, so GIF is a lossless fit for animation previews:
// the frames ship with the declared palette, not a re-quantised approximation of it.
"use strict";

/** GIF LZW: variable-width codes, LSB-first bit packing, 255-byte sub-blocks. */
function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let dict = new Map();

  const bytes = [];
  let cur = 0, nbits = 0;
  const emit = (code) => {
    cur |= code << nbits; nbits += codeSize;
    while (nbits >= 8) { bytes.push(cur & 0xff); cur >>= 8; nbits -= 8; }
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // The decoder is one dictionary entry behind the encoder: it only learns
      // a code after reading the following prefix. Keep the current width while
      // `next` equals the first code that needs the wider width, then grow it
      // on the next insertion so both sides change width on the same bit.
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map(); next = end + 1; codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (nbits > 0) bytes.push(cur & 0xff);

  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const block = bytes.slice(i, i + 255);
    out.push(block.length, ...block);
  }
  out.push(0); // block terminator
  return Buffer.from(out);
}

function paletteBits(n) { let b = 1; while ((1 << b) < n) b++; return Math.max(2, b); }

/**
 * frames: [{ w, h, indices: Int16Array/Array (-1 transparent), offset?: [x, y] }]
 * palette: [[r,g,b], ...] (<= 256)
 * opts: { delay: 10 (1/100 s per frame), loop: 0 (infinite), transparentIndex: -1 }
 */
function encodeGIF(frames, palette, opts = {}) {
  const delay = opts.delay ?? 10;
  const loop = opts.loop ?? 0;
  const tIndex = opts.transparentIndex ?? -1;
  const gw = opts.width ?? Math.max(...frames.map(f => f.w + (f.offset?.[0] || 0)));
  const gh = opts.height ?? Math.max(...frames.map(f => f.h + (f.offset?.[1] || 0)));
  const bits = paletteBits(palette.length);
  const entries = 1 << bits;

  const parts = [];
  parts.push(Buffer.from("GIF89a", "ascii"));

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(gw, 0); lsd.writeUInt16LE(gh, 2);
  lsd[4] = 0x80 | 0x70 | (bits - 1); // GCT present, colour resolution 8, size field
  lsd[5] = tIndex >= 0 ? tIndex : 0;
  lsd[6] = 0;
  parts.push(lsd);

  const gct = Buffer.alloc(entries * 3);
  palette.forEach((c, i) => { gct[i*3] = c[0]; gct[i*3+1] = c[1]; gct[i*3+2] = c[2]; });
  parts.push(gct);

  if (frames.length > 1) {
    parts.push(Buffer.from([0x21, 0xFF, 0x0B]));
    parts.push(Buffer.from("NETSCAPE2.0", "ascii"));
    parts.push(Buffer.from([0x03, 0x01, loop & 0xff, (loop >> 8) & 0xff, 0x00]));
  }

  for (const f of frames) {
    const off = f.offset || [0, 0];
    const fDelay = f.delay ?? delay;   // per-frame: a walk cycle is 38/28/18/43 ms, not one number
    // GCE packed: bits 0-2 disposal method (2 = restore to background), bit 4 transparency flag
    const packed = 0x02 | (tIndex >= 0 ? 0x10 : 0);
    const gce = Buffer.from([0x21, 0xF9, 0x04, packed, fDelay & 0xff, (fDelay >> 8) & 0xff,
      tIndex >= 0 ? tIndex : 0, 0x00]);
    parts.push(gce);
    // The image descriptor is 10 bytes and its FIRST byte is the 0x2C separator. Building a 9-byte
    // buffer and writing the fields at 0,2,4,6 silently drops that separator: the result is a GIF
    // with a valid header, a valid palette, and ZERO image blocks - which is what every playback
    // review this engine produced actually was. Fields now start at 1.
    const img = Buffer.alloc(10);
    img[0] = 0x2C;
    img.writeUInt16LE(off[0], 1); img.writeUInt16LE(off[1], 3);
    img.writeUInt16LE(f.w, 5); img.writeUInt16LE(f.h, 7);
    img[9] = 0; // no local colour map
    parts.push(img);
    const flat = new Uint8Array(f.w * f.h);
    for (let i = 0; i < flat.length; i++) { const v = f.indices[i]; flat[i] = v < 0 ? (tIndex >= 0 ? tIndex : 0) : v; }
    parts.push(Buffer.from([Math.max(2, bits)]));
    parts.push(lzwEncode(flat, Math.max(2, bits)));
  }
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

module.exports = { encodeGIF, lzwEncode };
