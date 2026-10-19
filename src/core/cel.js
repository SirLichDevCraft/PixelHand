// Cel: the atomic unit. Palette-indexed, so palette discipline is structural —
// a cel physically cannot contain a colour its palette did not authorise.
// Cels persist as TEXT GRIDS: git-diffable, hand-editable by a human in any editor,
// resumable, and readable by the agent without a codec.
"use strict";

const TRANSPARENT = -1;

// Deterministic charset for grid cells. Printable ASCII 33..126 minus '.' (reserved for transparent).
// Index 0 -> first char. 93 available entries, which is far beyond any palette we declare.
const CHARSET = (() => {
  const out = [];
  for (let c = 33; c <= 126; c++) { const ch = String.fromCharCode(c); if (ch !== ".") out.push(ch); }
  return out;
})();
const CHAR_TO_INDEX = new Map(CHARSET.map((ch, i) => [ch, i]));
const charFor = (i) => (i === TRANSPARENT ? "." : CHARSET[i]);
const indexFor = (ch) => (ch === "." ? TRANSPARENT : CHAR_TO_INDEX.has(ch) ? CHAR_TO_INDEX.get(ch) : null);

class Cel {
  constructor(w, h, paletteId = "none", name = "cel") {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2048 || h > 2048) throw new Error(`bad cel size ${w}x${h}; maximum is 2048 per axis`);
    this.w = w; this.h = h;
    this.paletteId = paletteId;
    this.name = name;
    this.idx = new Int16Array(w * h).fill(TRANSPARENT);
    this.offset = [0, 0];      // cel-level offset: recoil, bob, lean — no redraw needed
    this.meta = {};            // rig tags, event markers, provenance
  }

  inBounds(x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.w && y < this.h; }
  /** Out-of-bounds reads return TRANSPARENT, never null: a null silently defeats `v < 0` guards. */
  get(x, y) { return this.inBounds(x, y) ? this.idx[y * this.w + x] : TRANSPARENT; }

  /** Returns true if the pixel actually changed. A no-op edit is a finding, not a success. */
  set(x, y, index) {
    if (!this.inBounds(x, y)) return { ok: false, reason: "out_of_bounds", x, y };
    const i = index === null || index === undefined ? TRANSPARENT : index;
    const at = y * this.w + x;
    const from = this.idx[at];
    if (from === i) return { ok: true, changed: false, from, to: i, x, y };
    this.idx[at] = i;
    return { ok: true, changed: true, from, to: i, x, y };
  }

  clear() { this.idx.fill(TRANSPARENT); }
  fill(index) { this.idx.fill(index); }

  forEach(cb) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) cb(this.idx[y * this.w + x], x, y);
  }

  bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    this.forEach((v, x, y) => { if (v !== TRANSPARENT) { n++; if (x<x0)x0=x; if(y<y0)y0=y; if(x>x1)x1=x; if(y>y1)y1=y; } });
    if (!n) return null;
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area: n };
  }

  counts() {
    const c = new Map();
    this.forEach((v) => { if (v !== TRANSPARENT) c.set(v, (c.get(v) || 0) + 1); });
    return c;
  }

  clone(name = this.name) {
    const c = new Cel(this.w, this.h, this.paletteId, name);
    c.idx = Int16Array.from(this.idx);
    c.offset = [...this.offset];
    c.meta = JSON.parse(JSON.stringify(this.meta));
    return c;
  }

  equals(other) {
    if (this.w !== other.w || this.h !== other.h) return false;
    for (let i = 0; i < this.idx.length; i++) if (this.idx[i] !== other.idx[i]) return false;
    return true;
  }

  /** Text grid: the primary authoring and review surface. */
  toGridRows() {
    const rows = [];
    for (let y = 0; y < this.h; y++) {
      let s = "";
      for (let x = 0; x < this.w; x++) s += charFor(this.idx[y * this.w + x]);
      rows.push(s);
    }
    return rows;
  }

  toGrid() {
    return [
      `# cel v1`,
      `# name ${this.name}`,
      `# size ${this.w}x${this.h}`,
      `# palette ${this.paletteId}`,
      `# offset ${this.offset[0]},${this.offset[1]}`,
      ...(Object.keys(this.meta).length ? [`# meta ${JSON.stringify(this.meta)}`] : []),
      ...this.toGridRows(),
    ].join("\n");
  }

  static fromGrid(text, fallbackPaletteId = "none") {
    const lines = String(text).split(/\r?\n/);
    let w = null, h = null, paletteId = fallbackPaletteId, name = "cel", offset = [0, 0], meta = {};
    const rows = [];
    for (const line of lines) {
      // A header line is '# ' plus a known key. It cannot be a grid row, because a grid row's
      // characters are charset entries and '.' — and index 2 of the charset is '#'. Prefix-matching
      // on '#' alone would silently eat any row whose leftmost pixel is palette entry 2.
      const head = /^#\s*(cel|size|palette|name|offset|meta|layer|charset|rle)\b/.exec(line);
      if (head) {
        const m = line.slice(1).trim();
        const sp = m.indexOf(" ");
        const key = sp < 0 ? m : m.slice(0, sp);
        const val = sp < 0 ? "" : m.slice(sp + 1);
        if (key === "size") { const [a, b] = val.split("x").map(Number); w = a; h = b; }
        else if (key === "palette") paletteId = val;
        else if (key === "name") name = val;
        else if (key === "offset") offset = val.split(",").map(Number);
        else if (key === "meta") meta = JSON.parse(val);
        continue;
      }
      if (line.length === 0 && rows.length === 0) continue;
      rows.push(line);
    }
    if (!w) w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (!h) h = rows.length;
    const cel = new Cel(w, h, paletteId, name);
    rows.forEach((row, y) => {
      if (y >= h) return;
      for (let x = 0; x < w; x++) {
        const ch = row[x] === undefined ? "." : row[x];
        const i = ch === " " ? TRANSPARENT : indexFor(ch);
        if (i === null) throw new Error(`grid char '${ch}' is not in the cel charset (${x},${y})`);
        cel.idx[y * w + x] = i;
      }
    });
    cel.offset = offset; cel.meta = meta;
    return cel;
  }

  /** Apply a pixel map: rows of characters, same charset as a grid. The core authoring primitive. */
  applyPixelMap(rows, { x0 = 0, y0 = 0 } = {}) {
    const edits = [];
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx];
        if (ch === " ") continue;              // space = "leave this pixel alone"
        const i = indexFor(ch);
        if (i === null) throw new Error(`pixel map char '${ch}' not in charset`);
        const r = this.set(x0 + dx, y0 + dy, i);
        if (r.ok && r.changed) edits.push({ x: x0 + dx, y: y0 + dy, from: r.from, to: i });
      }
    });
    return edits;
  }
}

// ---- diff / patch / undo -------------------------------------------------------

function diff(a, b) {
  const edits = [];
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const f = a.idx[y * a.w + x], t = b.idx[y * b.w + x];
    if (f !== t) edits.push({ x, y, from: f, to: t });
  }
  return edits;
}

function applyPatch(cel, edits) {
  const applied = [];
  for (const e of edits) {
    const r = cel.set(e.x, e.y, e.to);
    if (r.ok && r.changed) applied.push(e);
  }
  return applied;
}

function invert(edits) {
  return edits.map(e => ({ x: e.x, y: e.y, from: e.to, to: e.from }));
}

class UndoStack {
  constructor(limit = 200) { this.stack = []; this.limit = limit; }
  push(edits) {
    if (!edits.length) return;
    this.stack.push(edits);
    if (this.stack.length > this.limit) this.stack.shift();
  }
  undo(cel) { const e = this.stack.pop(); if (!e) return false; applyPatch(cel, invert(e)); return true; }
  redo(cel) { return false; } // redo is handled by the snapshot layer, not the edit stack
  get depth() { return this.stack.length; }
}

// ---- run-length encoding, for compact storage of large cels -------------------

function rle(rows) {
  const out = [];
  for (const row of rows) {
    let i = 0;
    while (i < row.length) {
      const ch = row[i]; let n = 1;
      while (i + n < row.length && row[i + n] === ch) n++;
      out.push(n > 1 ? `${ch}${n}` : ch);
      i += n;
    }
    out.push("|");
  }
  out.pop();
  return out.join("");
}

function unrle(s, w, h) {
  const rows = [];
  let row = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "|") { rows.push(row); row = ""; continue; }
    let ch = s[i], n = 0;
    let j = i + 1;
    while (j < s.length && s[j] >= "0" && s[j] <= "9") { n = n * 10 + (+s[j]); j++; }
    if (n === 0) n = 1; else i = j - 1;
    row += ch.repeat(n);
  }
  rows.push(row);
  return rows.slice(0, h).map(r => r.padEnd(w, ".").slice(0, w));
}

module.exports = { Cel, TRANSPARENT, CHARSET, charFor, indexFor, diff, applyPatch, invert, UndoStack, rle, unrle };
