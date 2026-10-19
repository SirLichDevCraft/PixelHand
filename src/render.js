// The seeing layer. Every inspection render carries: nearest-neighbour integer zoom, burned-in
// coordinate labels, a non-destructive grid, a palette legend and a render stamp.
// Measured in Phase 0: unlabelled spatial reading failed, labelled reading was 8/8 exact.
// Labels are not decoration; they are what makes single-pixel correction possible.
//
// Layout rule (learned the hard way): gutters are measured in SCREEN pixels and the art origin
// is a screen-pixel offset. Mixing art-grid offsets with screen offsets silently clips the
// sprite at high zoom, which is worse than no render because it looks like the art is wrong.
"use strict";

const { encodeRGB, encodeIndexed, upscaleNearest, downscaleBox } = require("./codec/png.js");
const { Cel, charFor } = require("./core/cel.js");
const { hex } = require("./core/palette.js");
const craft = require("./craft.js");

// 5x5 bitmap font. Phase 0 measured that a 5x7 font at 4x scale made E and F read as 5;
// at scale 2-3 with a 1-cell advance gap the digits are unambiguous.
const FONT = {
  '0':['11110','10001','10001','10001','11110'],'1':['01100','00100','00100','00100','01110'],
  '2':['11110','00001','11110','10000','11111'],'3':['11110','00001','01110','00001','11110'],
  '4':['10010','10010','10010','11111','00010'],'5':['11111','10000','11110','00001','11110'],
  '6':['11110','10000','11111','10001','11110'],'7':['11111','00001','00010','00100','00100'],
  '8':['11110','10001','11110','10001','11110'],'9':['11110','10001','11111','00001','11110'],
  'A':['01110','10001','11111','10001','10001'],'B':['11110','10001','11110','10001','11110'],
  'C':['01110','10001','10000','10001','01110'],'D':['11100','10010','10001','10010','11100'],
  'E':['11111','10000','11110','10000','11111'],'F':['11111','10000','11110','10000','10000'],
  'G':['01110','10000','10011','10001','01110'],'H':['10001','10001','11111','10001','10001'],
  'I':['01110','00100','00100','00100','01110'],'J':['00111','00001','00001','10001','01110'],
  'K':['10001','10010','11100','10010','10001'],'L':['10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10001','10001'],'N':['10001','11001','10101','10011','10001'],
  'O':['01110','10001','10001','10001','01110'],'P':['11110','10001','11110','10000','10000'],
  'Q':['01110','10001','10101','10010','01101'],'R':['11110','10001','11110','10100','10010'],
  'S':['01111','10000','01110','00001','11110'],'T':['11111','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','01110'],'V':['10001','10001','10001','01010','00100'],
  'W':['10001','10001','10101','11011','10001'],'X':['10001','01010','00100','01010','10001'],
  'Y':['10001','01010','00100','00100','00100'],'Z':['11111','00010','00100','01000','11111'],
  '.':['00000','00000','00000','00000','00100'],',':['00000','00000','00000','00100','01000'],
  '-':['00000','00000','11111','00000','00000'],'_':['00000','00000','00000','00000','11111'],
  ':':['00000','00100','00000','00100','00000'],'/':['00001','00010','00100','01000','10000'],
  ' ':['00000','00000','00000','00000','00000'],'x':['00000','10001','01010','10001','00000'],
  '+':['00000','00100','11111','00100','00000'],'=':['00000','11111','00000','11111','00000'],
  '#':['01010','11111','01010','11111','01010'],'%':['10001','00010','00100','01000','10001'],
  '(':['00010','00100','00100','00100','00010'],')':['01000','00100','00100','00100','01000'],
  '[':['01110','01000','01000','01000','01110'],']':['01110','00010','00010','00010','01110'],
  '>':['01000','00100','00010','00100','01000'],'<':['00010','00100','01000','00100','00010'],
  '*':['00000','10101','01110','10101','00000'],"'":['00100','00100','00000','00000','00000'],
  '|':['00100','00100','00100','00100','00100'],'!':['00100','00100','00100','00000','00100'],
  '?':['11110','00001','00110','00100','00100'],
};

class Raster {
  constructor(w, h, bg = [22, 22, 28]) {
    this.w = w; this.h = h;
    this.rgb = Buffer.alloc(w * h * 3);
    this.fill(bg);
  }
  fill(c) { for (let i = 0; i < this.w * this.h; i++) { const o = i*3; this.rgb[o]=c[0]; this.rgb[o+1]=c[1]; this.rgb[o+2]=c[2]; } }
  px(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3; this.rgb[o]=c[0]; this.rgb[o+1]=c[1]; this.rgb[o+2]=c[2];
  }
  get(x, y) { const o = (y * this.w + x) * 3; return [this.rgb[o], this.rgb[o+1], this.rgb[o+2]]; }
  rect(x, y, w, h, c) { for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) this.px(x+dx, y+dy, c); }
  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.rgb[o]   = Math.round(this.rgb[o]   * (1 - a) + c[0] * a);
    this.rgb[o+1] = Math.round(this.rgb[o+1] * (1 - a) + c[1] * a);
    this.rgb[o+2] = Math.round(this.rgb[o+2] * (1 - a) + c[2] * a);
  }
  blendRect(x, y, w, h, c, a) { for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) this.blend(x+dx, y+dy, c, a); }
  text(x, y, s, c, sc = 2) {
    let cx = 0;
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] || FONT[" "];
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++)
        if (g[dy][dx] === "1") this.rect(x + (cx + dx) * sc, y + dy * sc, sc, sc, c);
      cx += 6;
    }
    return cx * sc;
  }
  textWidth(s, sc = 2) { return String(s).length * 6 * sc; }
  /** A marker that cannot be mistaken for art: a hollow bracket in a colour the palette never uses. */
  bracket(cx, cy, half, c, t = 2) {
    for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const x = cx + (sx < 0 ? -half - t : half);
      const y = cy + (sy < 0 ? -half - t : half);
      this.rect(x, y, t, t + half, c);
      this.rect(cx + (sx < 0 ? -half - t : half), cy + (sy < 0 ? -half : half), half, t, c);
    }
  }
}

const PALETTE_BG = [16, 16, 21];
const ART_BG_A = [26, 26, 34];
const ART_BG_B = [21, 21, 27];
const INK = [236, 240, 248];
const DIM = [132, 140, 156];
const FAINT = [52, 56, 68];
const GRID = [40, 44, 55];
const MAJOR = [88, 96, 116];
const WARN = [255, 92, 74];
const MARKER = [255, 214, 0];
const PREV_GHOST = [255, 150, 60];
const NEXT_GHOST = [70, 190, 255];

const MIN_LABEL_FONT = 2;      // measured floor: below this the glyphs become ambiguous

function chooseZoom(cel, requested) {
  const longest = Math.max(cel.w, cel.h);
  const auto = Math.max(8, Math.min(40, Math.floor(760 / longest)));
  const z = requested === undefined || requested === null ? auto : requested;
  return Math.max(2, Math.min(64, Math.round(z)));
}

function labelEveryFor(n, z, ls = MIN_LABEL_FONT) {
  let every = n <= 16 ? 2 : n <= 32 ? 4 : 8;
  while (every * z < 6 * ls + 8) every *= 2;
  return every;
}

const emptyCell = (x, y) => ((x + y) % 2 ? ART_BG_B : ART_BG_A);

function drawArt(r, cel, palette, ox, oy, z, mode) {
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const v = cel.get(x, y);
    const px = ox + x * z, py = oy + y * z;
    if (v < 0) { r.rect(px, py, z, z, emptyCell(x, y)); continue; }
    let c;
    if (mode === "silhouette") c = [230, 234, 244];
    else if (mode === "value_map") { const l = Math.round((palette ? craft.luma(palette.color(v)) : 0.5) * 255); c = [l, l, l]; }
    else if (mode === "flat") { const e = palette?.entries[v]; c = e?.ramp ? [46, 104, 70] : [190, 96, 44]; }
    else c = (palette && palette.color(v)) || [200, 200, 200];
    r.rect(px, py, z, z, c);
  }
}

/** A grid that helps without destroying: 1px minor lines only at high zoom, 2px major lines. */
function drawGrid(r, cel, ox, oy, z, every) {
  if (z >= 12) {
    for (let x = 1; x < cel.w; x++) if (x % every) r.rect(ox + x * z, oy, 1, cel.h * z, GRID);
    for (let y = 1; y < cel.h; y++) if (y % every) r.rect(ox, oy + y * z, cel.w * z, 1, GRID);
  }
  for (let x = 0; x <= cel.w; x += every) r.rect(ox + x * z, oy, 2, cel.h * z, MAJOR);
  for (let y = 0; y <= cel.h; y += every) r.rect(ox, oy + y * z, cel.w * z, 2, MAJOR);
}

function drawLabels(r, cel, ox, oy, z, every, ls) {
  for (let x = 0; x < cel.w; x += every) {
    const s = String(x), w = r.textWidth(s, ls);
    r.text(ox + x * z + Math.max(0, Math.floor((z - w) / 2)), 3, s, x % (every * 2) === 0 ? INK : DIM, ls);
    r.rect(ox + x * z, oy - 5, 2, 5, x % (every * 2) === 0 ? INK : DIM);
  }
  for (let y = 0; y < cel.h; y += every) {
    const s = String(y), w = r.textWidth(s, ls);
    r.text(ox - 8 - w, oy + y * z + Math.max(0, Math.floor((z - 5 * ls) / 2)), s, y % (every * 2) === 0 ? INK : DIM, ls);
    r.rect(ox - 5, oy + y * z, 5, 2, y % (every * 2) === 0 ? INK : DIM);
  }
}


/**
 * view: the primary inspection render.
 * mode: view | silhouette | value_map | flat | squint | heatmap | chunk | game_scale
 */
function renderCel(cel, palette, opts = {}) {
  const mode = opts.mode || "view";
  if (mode === "squint") return renderSquint(cel, palette, opts);
  if (mode === "chunk") return renderChunk(cel, palette, opts);
  if (mode === "game_scale") return renderGameScale(cel, palette, opts);
  if (mode === "depth_map") return renderDepthMap(cel, palette, opts);

  const z = chooseZoom(cel, opts.zoom);
  const ls = MIN_LABEL_FONT;
  const every = opts.labelEvery ?? labelEveryFor(Math.max(cel.w, cel.h), z, ls);
  const showGrid = opts.grid !== false && z >= 6;

  const digits = Math.max(String(cel.w - 1).length, String(cel.h - 1).length);
  const ox = Math.max(12, digits * 6 * ls + 14);
  const oy = 5 * ls + 10;
  const used = [...cel.counts().entries()].sort((a, b) => a[0] - b[0]);
  const legendRows = palette && opts.legend !== false ? used.length : 0;
  const legendH = legendRows ? (5 * ls + 10) + legendRows * (4 * ls + 2) : 0;

  const W = ox + cel.w * z + 12;
  const H = oy + cel.h * z + legendH + 18;
  const r = new Raster(W, H, PALETTE_BG);

  drawArt(r, cel, palette, ox, oy, z, mode);
  if (showGrid) drawGrid(r, cel, ox, oy, z, every);
  drawLabels(r, cel, ox, oy, z, every, ls);

  if (mode === "heatmap" && opts.findings) {
    for (const f of opts.findings) for (const p of (f.at || []).slice(0, 60)) {
      if (p.x === undefined) continue;
      r.blendRect(ox + p.x * z, oy + p.y * z, z, z, f.severity === "error" ? WARN : MARKER, 0.6);
    }
  }

  const bb = cel.bbox();
  const stamp = `${mode} ${cel.name} ${cel.w}x${cel.h} z${z}${bb ? " sil" + bb.area : ""}${opts.stampExtra ? " " + opts.stampExtra : ""}`;
  r.text(ox, oy + cel.h * z + 5, stamp, FAINT, 2);

  if (legendRows) {
    let ly = oy + cel.h * z + 5 + 5 * ls + 8;
    r.text(ox, ly, "palette " + palette.id + " (" + palette.size + ") used " + used.length, DIM, ls);
    ly += 5 * ls + 4;
    for (const [i, n] of used) {
      const e = palette.entries[i]; if (!e) continue;
      r.rect(ox, ly, 4 * ls, 4 * ls, e.rgb);
      r.rect(ox, ly, 4 * ls, 1, [0, 0, 0]);
      r.rect(ox, ly + 4 * ls - 1, 4 * ls, 1, [0, 0, 0]);
      r.text(ox + 5 * ls, ly, charFor(i) + " idx " + i + " " + e.name + " " + hex(e.rgb) + (e.ramp ? " " + e.ramp + ":" + e.step : "") + " x" + n, DIM, ls);
      ly += 4 * ls + 2;
    }
  }
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/**
 * The camera guides, burned into the render: horizon row, vanishing point, the declared receding
 * edges extended toward it, and each placed object's contact row.
 * Perspective is invisible in a pixel render until it is drawn on top of the render: the eye will
 * accept a trapezoid as a wall whether or not it converges. This overlay makes the difference
 * between "looks like a building" and "measurably converges" visible in the same image.
 */
function drawPerspectiveGuides(r, ox, oy, z, persp, opts = {}) {
  const artW = (opts.canvasW ?? 0) * z, artH = (opts.canvasH ?? 0) * z;
  const y = oy + persp.horizon * z + Math.floor(z / 2);
  for (let x = 0; x <= artW; x += 2) r.rect(ox + x, y, Math.min(2, artW - x + 1) || 1, 1, MAJOR);
  const vx = ox + persp.vanishing[0] * z + Math.floor(z / 2), vy = oy + persp.vanishing[1] * z + Math.floor(z / 2);
  r.bracket(vx, vy, Math.max(3, z), MARKER, 2);
  r.text(vx + z + 4, vy - 3 * MIN_LABEL_FONT, `VP ${persp.vanishing[0]},${persp.vanishing[1]}`, MARKER, MIN_LABEL_FONT);
  r.text(ox + 2, y - 3 * MIN_LABEL_FONT - 2, `HORIZON ROW ${persp.horizon}  EYE ${persp.eye}  FOCAL ${persp.focal}`, MAJOR, MIN_LABEL_FONT);
  for (const e of (opts.edges || [])) {
    const [ax, ay] = e.from, [bx, by] = e.to;
    // draw the declared edge, then its extension to the vanishing point
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
    for (let i = 0; i <= steps; i++) {
      const px = ax + (bx - ax) * (i / steps), py = ay + (by - ay) * (i / steps);
      r.rect(ox + Math.round(px) * z, oy + Math.round(py) * z, Math.max(1, z >> 1), Math.max(1, z >> 1), WARN);
    }
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, px = bx + (persp.vanishing[0] - bx) * t, py = by + (persp.vanishing[1] - by) * t;
      r.rect(ox + Math.round(px) * z, oy + Math.round(py) * z, 1, 1, FAINT);
    }
  }
  for (const p of (opts.placed || [])) {
    const row = p.baseRow ?? p.contactRow;
    if (row == null) continue;
    const ry = oy + row * z + z;
    r.rect(ox + 2, ry, 4, 1, NEXT_GHOST);
    r.text(ox + 8, ry - 2, `${p.id} Z${(p.z ?? 0).toFixed ? (p.z ?? 0).toFixed(2) : p.z}`, NEXT_GHOST, MIN_LABEL_FONT);
  }
}

/**
 * depth_map: the render that answers "does this have point-of-view depth?"
 * Art + camera guides + every declared depth region boxed and labelled with its distance +
 * the ramp-step budget each material actually spent on distance vs on form.
 */
function renderDepthMap(cel, palette, opts = {}) {
  const z = chooseZoom(cel, opts.zoom);
  const ls = MIN_LABEL_FONT;
  const digits = Math.max(String(cel.w - 1).length, String(cel.h - 1).length);
  const ox = Math.max(12, digits * 6 * ls + 14);
  const oy = 5 * ls + 10;
  const regions = opts.depth?.regions || [];
  const bands = opts.bands || [];
  const legendH = bands.length ? (5 * ls + 8) + bands.length * (5 * ls + 3) : 0;
  const W = ox + cel.w * z + 12;
  const H = oy + cel.h * z + 5 * ls + 14 + legendH;
  const r = new Raster(W, H, PALETTE_BG);
  drawArt(r, cel, palette, ox, oy, z, "view");
  drawGrid(r, cel, ox, oy, z, labelEveryFor(Math.max(cel.w, cel.h), z, ls));
  drawLabels(r, cel, ox, oy, z, labelEveryFor(Math.max(cel.w, cel.h), z, ls), ls);
  if (opts.perspective) drawPerspectiveGuides(r, ox, oy, z, opts.perspective, { ...opts, canvasW: cel.w, canvasH: cel.h });
  regions.forEach((reg, i) => {
    const [x0, y0, x1, y1] = reg.region;
    const c = [MARKER, NEXT_GHOST, PREV_GHOST, WARN][i % 4];
    for (let x = x0 * z; x <= (x1 + 1) * z; x++) { r.rect(ox + x, oy + y0 * z - 1, 1, 1, c); r.rect(ox + x, oy + (y1 + 1) * z, 1, 1, c); }
    for (let yy = y0 * z; yy <= (y1 + 1) * z; yy++) { r.rect(ox + x0 * z - 1, oy + yy, 1, 1, c); r.rect(ox + (x1 + 1) * z, oy + yy, 1, 1, c); }
    r.text(ox + x0 * z, oy + y0 * z - 3 * ls - 3, `${reg.name} Z${reg.z}`, c, ls);
  });
  let ly = oy + cel.h * z + 5 * ls + 6;
  r.text(ox, ly, `depth map ${cel.name} z${z}  ${regions.length} region(s)${opts.perspective ? "  camera " + opts.perspective.id : ""}`, FAINT, ls);
  ly += 5 * ls + 4;
  for (const b of bands) {
    r.text(ox, ly, `${b.ramp} ${b.steps} steps: ${b.forDepth} to distance, ${b.forForm} left for form`, b.forForm === 0 ? WARN : DIM, ls);
    ly += 5 * ls + 3;
  }
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/** chunk: a sub-region at high zoom. The context-budget lever - inspect a face, not a sprite. */
function renderChunk(cel, palette, opts = {}) {
  const reg = opts.region || { x: 0, y: 0, w: cel.w, h: Math.min(cel.h, 12) };
  const w = Math.min(reg.w, cel.w - reg.x), h = Math.min(reg.h, cel.h - reg.y);
  const rows = cel.toGridRows().slice(reg.y, reg.y + h).map(row => row.slice(reg.x, reg.x + w));
  const sub = Cel.fromGrid(rows.join("\n"), cel.paletteId);
  sub.name = cel.name + "_r" + reg.x + "_" + reg.y;
  return renderCel(sub, palette, {
    ...opts, mode: opts.chunkMode || "view",
    zoom: opts.chunkZoom ?? Math.max(12, Math.min(48, Math.floor(560 / Math.max(w, h)))),
    stampExtra: "region " + reg.x + "," + reg.y + " " + w + "x" + h,
  });
}

/** squint: box-filtered 50% downscale, upscaled back. Simulates distance and game scale. */
function renderSquint(cel, palette, opts = {}) {
  const z = chooseZoom(cel, opts.zoom ?? 10);
  const art = new Raster(cel.w * z, cel.h * z, [18, 18, 24]);
  drawArt(art, cel, palette, 0, 0, z, "view");
  const sq = downscaleBox(cel.w * z, cel.h * z, art.rgb, 2);
  const up = Math.max(2, Math.floor(520 / sq.w));
  const bw = sq.w * up, bh = sq.h * up;
  const back = upscaleNearest(sq.w, sq.h, sq.rgb, up);
  const ls = MIN_LABEL_FONT;
  const W = bw + 14, H = bh + 5 * ls + 20;
  const r = new Raster(W, H, PALETTE_BG);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const o = (y * bw + x) * 3; r.px(7 + x, 5 * ls + 12 + y, [back[o], back[o + 1], back[o + 2]]); }
  r.text(7, 3, "squint " + cel.name + " 50% of z" + z + " -> " + sq.w + "x" + sq.h, INK, ls);
  r.text(7, 5 * ls + 14 + back.h, "if this is unreadable, the sprite is unreadable in game", FAINT, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/**
 * game_scale: the sprite at 1x on a mock ground, upscaled. The only render that answers
 * "does this belong in this game?". The ground is harness scaffolding, not shipped art:
 * deterministic, authored here, no third-party asset, never exported.
 */
function renderGameScale(cel, palette, opts = {}) {
  const z = opts.zoom ?? Math.max(6, Math.min(20, Math.floor(620 / Math.max(cel.w, cel.h))));
  const tile = opts.tile ?? 16;
  const cols = Math.max(3, Math.ceil((cel.w + 14) / tile));
  const rows = Math.max(3, Math.ceil((cel.h + 10) / tile));
  const gw = cols * tile, gh = rows * tile;
  const bg = opts.ground ?? [[38, 40, 52], [45, 47, 61], [33, 35, 45], [51, 53, 69]];
  const ground = new Raster(gw, gh, bg[0]);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    ground.rect(tx * tile, ty * tile, tile, tile, bg[(tx + ty * 2) % bg.length]);
    ground.rect(tx * tile, ty * tile, tile, 1, [26, 28, 38]);
    ground.rect(tx * tile, ty * tile, 1, tile, [26, 28, 38]);
    for (let k = 0; k < 6; k++) {
      const sx = tx * tile + ((k * 7 + ty * 5 + tx * 11) % (tile - 2)) + 1;
      const sy = ty * tile + ((k * 5 + tx * 3 + ty * 7) % (tile - 2)) + 1;
      ground.px(sx, sy, bg[(k + tx) % bg.length].map(v => Math.max(0, v - 7)));
    }
  }
  const big = upscaleNearest(gw, gh, ground.rgb, z);
  const bw = gw * z, bh = gh * z;
  const ls = MIN_LABEL_FONT;
  const ox = 12, oy = 5 * ls + 14;
  const W = ox + bw + 12, H = oy + bh + 5 * ls + 16;
  const r = new Raster(W, H, PALETTE_BG);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const o = (y * bw + x) * 3; r.px(ox + x, oy + y, [big[o], big[o + 1], big[o + 2]]); }
  const bb = cel.bbox();
  const centre = bb ? bb.x0 + bb.w / 2 : cel.w / 2;
  const px = Math.round(ox + (gw / 2 - centre) * z);
  const py = oy + (gh - cel.h - 2) * z;
  if (bb) r.blendRect(px + bb.x0 * z - z, py + (bb.y1 + 1) * z, bb.w * z + 2 * z, z, [0, 0, 0], 0.45);
  drawArt(r, cel, palette, px, py, z, "view");
  r.text(ox, 3, "game_scale " + cel.name + " 1x on " + tile + "px ground z" + z, INK, ls);
  r.text(ox, oy + bh + 4, "judge against the ground: value, edge weight, light direction, grounding", FAINT, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/** onion: current frame with neighbours ghosted. Finds the one-pixel jump between poses. */
function renderOnion(frames, palette, opts = {}) {
  const list = frames.map(f => f.cel || f);
  const i = opts.index ?? list.length - 1;
  const cur = list[Math.min(i, list.length - 1)];
  const z = chooseZoom(cur, opts.zoom);
  const ls = MIN_LABEL_FONT;
  const every = labelEveryFor(Math.max(cur.w, cur.h), z, ls);
  const ox = Math.max(12, String(cur.h - 1).length * 6 * ls + 14), oy = 5 * ls + 12;
  const W = ox + cur.w * z + 12, H = oy + cur.h * z + 5 * ls + 16;
  const r = new Raster(W, H, PALETTE_BG);
  const ghost = (cel, a) => cel.forEach((v, x, y) => {
    if (v < 0) return;
    r.blendRect(ox + x * z, oy + y * z, z, z, palette ? palette.color(v) : [200, 200, 200], a);
  });
  if (list[i - 1]) ghost(list[i - 1], 0.3);
  if (list[i + 1]) ghost(list[i + 1], 0.3);
  drawArt(r, cur, palette, ox, oy, z, "view");
  drawGrid(r, cur, ox, oy, z, every);
  drawLabels(r, cur, ox, oy, z, every, ls);
  r.text(ox, 3, "onion " + cur.name + "  prev=orange next=blue", INK, ls);
  r.text(ox, oy + cur.h * z + 5, "frame " + i + " of " + list.length, FAINT, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/** diff: before/after side by side with changed pixels flagged. Proves an edit did what I asked. */
function renderDiff(before, after, palette, opts = {}) {
  const z = chooseZoom(before, opts.zoom);
  const ls = MIN_LABEL_FONT;
  const gutter = 16;
  const ox = Math.max(12, String(before.h - 1).length * 6 * ls + 14), oy = 5 * ls + 12;
  const ox2 = ox + before.w * z + gutter;
  const maxH = Math.max(before.h, after.h);
  const W = ox2 + after.w * z + 12, H = oy + maxH * z + 5 * ls + 18;
  const r = new Raster(W, H, PALETTE_BG);
  drawArt(r, before, palette, ox, oy, z, "view");
  drawArt(r, after, palette, ox2, oy, z, "view");
  let entered = 0, left = 0, repainted = 0;
  for (let y = 0; y < maxH; y++) for (let x = 0; x < Math.max(before.w, after.w); x++) {
    const a = before.get(x, y), b = after.get(x, y);
    if (a === b) continue;
    if (a < 0) entered++; else if (b < 0) left++; else repainted++;
    const c = a < 0 ? [70, 226, 130] : b < 0 ? WARN : MARKER;
    r.rect(ox + x * z, oy + y * z, z, z, c);
    r.rect(ox2 + x * z, oy + y * z, z, z, c);
  }
  drawGrid(r, before, ox, oy, z, labelEveryFor(Math.max(before.w, before.h), z, ls));
  drawGrid(r, after, ox2, oy, z, labelEveryFor(Math.max(after.w, after.h), z, ls));
  r.text(ox, 3, "before " + before.name, INK, ls);
  r.text(ox2, 3, "after " + after.name, INK, ls);
  r.text(ox, oy + maxH * z + 5, "changed +" + entered + " silhouette entered  -" + left + " silhouette left  ~" + repainted + " repainted inside", DIM, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z, stats: { entered, left, repainted } };
}

/** palette_audit: the palette as a ramp strip with usage counts and ramp problems flagged. */
function renderPaletteAudit(palette, usage, problems = []) {
  const ls = MIN_LABEL_FONT, sw = 11, rowH = 4 * ls + 8;
  const byRamp = new Map();
  palette.entries.forEach((e, i) => { const k = e.ramp || "single"; if (!byRamp.has(k)) byRamp.set(k, []); byRamp.get(k).push([i, e]); });
  const W = 700, H = 5 * ls + 14 + byRamp.size * rowH + 14;
  const r = new Raster(W, H, PALETTE_BG);
  r.text(8, 4, "palette " + palette.id + "  " + palette.size + " entries  ramps grouped darkest to lit", INK, ls);
  let y = 5 * ls + 14;
  for (const [rampId, list] of byRamp) {
    list.sort((a, b) => a[1].step - b[1].step);
    let x = 8;
    for (const [i, e] of list) {
      r.rect(x, y, sw, 4 * ls, e.rgb);
      r.rect(x, y, sw, 1, [0, 0, 0]);
      r.rect(x, y + 4 * ls - 1, sw, 1, [0, 0, 0]);
      x += sw;
    }
    r.text(x + 8, y, rampId + " x" + list.length + "  " + list.map(([i, e]) => e.name + ":" + (usage && usage.get(i) || 0)).join(" "), DIM, ls);
    const bad = problems.filter(p => p.ramp === rampId);
    if (bad.length) r.text(x + 8, y + 5 * ls + 2, bad.map(b => b.message).join(" | ").slice(0, 120), WARN, ls);
    y += rowH;
  }
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r };
}

/**
 * contact_sheet: many cels on one shared baseline. The animation review surface -
 * anchor drift and silhouette instability are only visible side by side.
 */
function contactSheet(cels, palette, opts = {}) {
  const maxW = cels.reduce((m, c) => Math.max(m, c.w), 1);
  const maxH = cels.reduce((m, c) => Math.max(m, c.h), 1);
  const z = opts.zoom ?? Math.max(4, Math.min(20, Math.floor(1100 / (maxW * Math.min(cels.length, 8)))));
  const ls = MIN_LABEL_FONT;
  const gutter = Math.max(10, Math.round(26 / z) * 2);
  const headH = 5 * ls + 8, footH = 5 * ls + 12;
  const pitch = maxW * z + gutter;
  const W = gutter + cels.length * pitch + gutter;
  const H = headH + maxH * z + footH;
  const r = new Raster(W, H, PALETTE_BG);
  const baseline = headH + maxH * z;
  r.rect(0, baseline, W, 2, FAINT);
  cels.forEach((cel, n) => {
    const ox = gutter + n * pitch;
    const oy = baseline - cel.h * z;
    drawArt(r, cel, palette, ox, oy, z, opts.mode || "view");
    const bb = cel.bbox();
    if (bb) r.rect(ox + bb.x0 * z, baseline, bb.w * z, 2, [120, 130, 150]);
    const label = cel.meta?.label || cel.name;
    r.text(ox, 3, label, INK, ls);
    const stat = opts.stats?.[cel.name];
    if (stat) r.text(ox, baseline + 4, stat, DIM, ls);
  });
  if (opts.stamp) r.text(gutter, H - 5 * ls - 6, opts.stamp, DIM, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/**
 * Multi-row contact sheet: one row per facing, one column per pose.
 * The 8-direction review surface - facings are only judgeable side by side on a shared
 * baseline, and pose order is only judgeable left to right.
 * All measurements are in screen pixels; art cells are placed by (artCoord * z).
 */
function multiSheet(rows, palette, opts = {}) {
  const cols = rows.reduce((m, r) => Math.max(m, r.cels.length), 0);
  const cellW = Math.max(1, ...rows.map(r => Math.max(1, ...r.cels.map(c => c.w))));
  const cellH = Math.max(1, ...rows.map(r => Math.max(1, ...r.cels.map(c => c.h))));
  const z = opts.zoom ?? 6;
  const ls = MIN_LABEL_FONT;
  const gutter = opts.gutter ?? Math.max(10, z * 2);
  const labelW = opts.labelW ?? Math.max(40, 11 * 6 * ls + 12);
  const headH = 5 * ls + 10;
  const rowLabelH = 5 * ls + 4;
  const pitch = cellW * z + gutter;
  const rowPitch = cellH * z + rowLabelH + gutter;
  const W = labelW + cols * pitch + 10;
  const H = headH + rows.length * rowPitch + 5 * ls + 12;
  const r = new Raster(W, H, PALETTE_BG);

  for (let c = 0; c < cols; c++) {
    const head = rows.find(row => row.cels[c])?.cels[c]?.meta?.pose || "f" + c;
    r.text(labelW + c * pitch, 3, head, INK, ls);
  }
  rows.forEach((row, ri) => {
    const ry = headH + ri * rowPitch;
    r.text(4, ry, row.label || "", INK, ls);
    if (row.note) r.text(4, ry + 5 * ls + 2, row.note, FAINT, ls);
    const baseline = ry + rowLabelH + cellH * z;
    r.rect(labelW - 6, baseline, W - labelW + 6, 2, FAINT);
    row.cels.forEach((cel, ci) => {
      const ox = labelW + ci * pitch;
      const oy = baseline - cellH * z;
      drawArt(r, cel, palette, ox, oy, z, opts.mode || "view");
      const bb = cel.bbox();
      if (bb) r.rect(ox + bb.x0 * z, baseline, bb.w * z, 2, [126, 136, 158]);
      const stat = opts.stats?.[cel.name];
      if (stat) r.text(ox, baseline + 4, stat, DIM, ls);
    });
  });
  if (opts.stamp) r.text(4, H - 5 * ls - 6, opts.stamp, DIM, ls);
  return { buffer: encodeRGB(r.w, r.h, r.rgb), raster: r, zoom: z };
}

/** Coordinate-addressed text grid, paired with every image render (dual-channel rule). */
function gridText(cel, opts = {}) {
  const labelEvery = opts.labelEvery ?? (cel.w <= 16 ? 2 : 4);
  const tens = (i) => (i % 10 === 0 ? String(Math.floor(i / 10)) : " ");
  let ruler = "     ";
  for (let i = 0; i < cel.w; i++) ruler += (i % labelEvery === 0 ? (i % 10 === 0 ? tens(i) : String(i % 10)) : " ");
  const out = [ruler];
  cel.toGridRows().forEach((row, y) => {
    const tag = y % labelEvery === 0 ? String(y).padStart(5, " ") : "     ";
    out.push(tag + " " + row);
  });
  return out.join("\n");
}

function legendText(palette) {
  return palette.entries.map((e, i) => `${charFor(i)} idx ${i} ${e.name} ${hex(e.rgb)} role:${e.role}${e.ramp ? ` ramp:${e.ramp} step:${e.step}` : ""}`).join("\n");
}

module.exports = {
  Raster, FONT, PALETTE_BG, ART_BG_A, ART_BG_B, INK, DIM, FAINT, GRID, MAJOR, WARN, MARKER,
  PREV_GHOST, NEXT_GHOST, MIN_LABEL_FONT, chooseZoom, labelEveryFor, emptyCell,
  drawArt, drawGrid, drawLabels,
  renderCel, renderChunk, renderSquint, renderGameScale, renderOnion, renderDiff,
  renderDepthMap, drawPerspectiveGuides,
  renderPaletteAudit, contactSheet, multiSheet, gridText, legendText,
};
