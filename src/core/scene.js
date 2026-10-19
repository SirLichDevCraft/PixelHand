// Scene coherence: global light palettes, per-scene ambient re-derivation, time-of-day and
// season ramps, grounding, and a real playtest harness. docs/06 §4, docs/10 §3 item 5.
//
// Per-sprite quality is not what makes a game look good. What makes it look good is one light
// model shared by everything in the frame. A game of individually good sprites in a disjoint
// world looks bad.
//
// The re-derivation rule: an ambient changes the PALETTE, not the art. The authored grid is
// untouched; the colour recipe is re-keyed. That is what "the same sprite under four declared
// light states, no redraw" means mechanically.
"use strict";

const { Palette, rgbToHsl, hslToRgb, hex, parseHex } = require("./palette.js");
const { Cel } = require("./cel.js");
const { luma } = require("../craft.js");
const { renderCel, multiSheet, Raster, PALETTE_BG, INK, DIM, FAINT } = require("../render.js");
const { encodeRGB } = require("../codec/png.js");
const { buildSheet, buildManifest } = require("../export.js");

/**
 * ambient_palette: re-derive a palette for a scene's light without touching any authored cel.
 *
 * Shadows take the scene's colour; lit steps take the light source's colour. The shift is
 * proportional to how dark the step is, so a ramp keeps its shape and its authored intent while
 * the whole material moves into the scene's atmosphere. Value order is preserved, which is what
 * keeps every ramp-conformance rule meaningful after re-derivation.
 */
function ambient_palette(palette, ambient, opts = {}) {
  const aHsl = rgbToHsl(parseHex(ambient.hue));
  const aH = aHsl[0];
  const aSat = aHsl[1];
  const strength = ambient.strength ?? 0.55;
  const valueScale = ambient.value_scale ?? 1;
  const entries = palette.entries.map(e => {
    const [h, s, l] = rgbToHsl(e.rgb);
    // A declared light source is its own source, and a material declared relight:false (self-lit
    // brass, an emissive panel) opted out of the scene's claim on it. Re-lighting those would
    // flatten the authored modelling that made them read as lit from inside.
    if (e.role === "light" || e.relight === false) return { ...e, rgb: e.rgb };
    // darker steps are more claimed by the scene's ambient than lit ones
    const claim = strength * (1 - l) ** 0.85;
    let nh = h + shortestDelta(h, aH) * claim;
    let ns = s * (1 - claim) + aSat * claim * 0.85;
    let nl = l * valueScale;
    if (ambient.desaturate) ns *= (1 - ambient.desaturate * claim);
    const rgb = hslToRgb([nh, Math.max(0, Math.min(1, ns)), Math.max(0.02, Math.min(0.96, nl))]);
    return { ...e, rgb, value: rgbToHsl(rgb)[2] };
  });
  const out = new Palette(`${palette.id}@${ambient.id}`, entries);
  out.ramps = new Map(palette.ramps);
  out.origin = `re-derived from '${palette.id}' under scene ambient '${ambient.id}' (${ambient.note || "no note"})`;
  return out;
}

function shortestDelta(from, to) {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * Declared light states. These are authored recipes, not filters: each one is a hue, a strength
 * and a value scale, and the same authored cel is drawn under all of them.
 */
const LIGHT_STATES = {
  "day-neutral":   { id: "day-neutral", hue: "#c8d4e0", strength: 0.18, value_scale: 1.06, note: "overcast neutral daylight" },
  "dawn-warm":     { id: "dawn-warm", hue: "#e8a866", strength: 0.42, value_scale: 0.94, desaturate: 0.10, note: "low warm sun, long shadows" },
  "dusk-cool":     { id: "dusk-cool", hue: "#4a5f8a", strength: 0.55, value_scale: 0.80, desaturate: 0.18, note: "falling light, cool ambience" },
  "night-cold":    { id: "night-cold", hue: "#243050", strength: 0.72, value_scale: 0.62, desaturate: 0.30, note: "night; only declared light sources carry warmth" },
  "season-autumn": { id: "season-autumn", hue: "#8a5a2a", strength: 0.35, value_scale: 0.98, note: "autumn ambient over the whole scene" },
  "season-winter": { id: "season-winter", hue: "#9fb4c8", strength: 0.40, value_scale: 1.02, desaturate: 0.25, note: "winter; desaturated, cold shadows, bright ground bounce" },
};

/**
 * A scene is a composition of authored parts, reviewed as a whole.
 * Tiles are placed by grid cell; props declare a footprint and a contact row.
 */
class Scene {
  constructor(id, opts = {}) {
    this.id = id;
    this.cols = opts.cols; this.rows = opts.rows;
    this.tile = opts.tile ?? 16;
    this.grid = Array.from({ length: opts.rows }, () => Array(opts.cols).fill(null));
    this.props = [];
    this.characters = [];
    this.ambient = opts.ambient ?? LIGHT_STATES["day-neutral"];
    this.basePalette = opts.palette;
  }
  fillTile(x, y, cel) { this.assert(x, y); this.grid[y][x] = cel; return this; }
  addProp(prop, cel, at) { this.props.push({ ...prop, cel, at }); return this; }
  addCharacter(cel, at, opts = {}) { this.characters.push({ cel, at, ...opts }); return this; }
  assert(x, y) { if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) throw new Error(`tile ${x},${y} outside a ${this.cols}x${this.rows} scene`); }

  /** Composite at 1x art scale. Transparent cells fall through to whatever is below. */
  composite() {
    const w = this.cols * this.tile, h = this.rows * this.tile;
    const out = new Cel(w, h, this.basePalette.id, `${this.id}_scene`);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const cel = this.grid[y][x];
      if (!cel) continue;
      for (let sy = 0; sy < Math.min(cel.h, this.tile); sy++) for (let sx = 0; sx < Math.min(cel.w, this.tile); sx++) {
        const v = cel.get(sx, sy);
        if (v >= 0) out.set(x * this.tile + sx, y * this.tile + sy, v);
      }
    }
    // props sort by contact row: this is the art-side half of depth sorting. The engine exports
    // the numbers; the game engine does the other half.
    const sorted = [...this.props, ...this.characters].sort((a, b) => (a.at[1] + (a.contact_row ?? 0)) - (b.at[1] + (b.contact_row ?? 0)));
    for (const p of sorted) {
      for (let sy = 0; sy < p.cel.h; sy++) for (let sx = 0; sx < p.cel.w; sx++) {
        const v = p.cel.get(sx, sy);
        if (v < 0) continue;
        const px = p.at[0] + sx, py = p.at[1] + sy;
        if (out.inBounds(px, py)) out.set(px, py, v);
      }
    }
    return out;
  }

  /** The five scene reviews from docs/06 §4. A scene that passes only the first will look wrong
   *  the moment the camera pulls back. */
  review(paletteOverride) {
    const pal = paletteOverride || this.basePalette;
    const cel = this.composite();
    const { negativeSpace } = require("./style.js");
    const craft = require("../craft.js");
    return {
      scene: this.id, ambient: this.ambient.id, canvas: [cel.w, cel.h],
      renders: {
        game_scale: renderCel(cel, pal, { mode: "game_scale", zoom: Math.max(3, Math.min(8, Math.floor(620 / Math.max(cel.w, cel.h)))), ground: groundPalette(pal) }),
        squint: renderCel(cel, pal, { mode: "squint" }),
        value_map: renderCel(cel, pal, { mode: "value_map", legend: false }),
        silhouette: renderCel(cel, pal, { mode: "silhouette", legend: false }),
      },
      measured: {
        value_structure: craft.valueStructure(cel, pal),
        silhouette_complexity: craft.silhouetteComplexity(cel),
        negative_space: negativeSpace(cel),
        colour_count: cel.counts().size,
        contact_grounding: this.characters.map(c => ({ at: c.at, grounded: craft.contactGrounding(c.cel, pal).present })),
      },
    };
  }
}

function groundPalette(pal) {
  const ranked = pal.entries.map((e, i) => [luma(e.rgb), i]).sort((a, b) => a[0] - b[0]);
  const base = pal.color(ranked[Math.floor(ranked.length * 0.25)][1]);
  const mid = pal.color(ranked[Math.floor(ranked.length * 0.45)][1]);
  return [base, mid, base.map(v => Math.max(0, v - 6)), mid.map(v => Math.min(255, v + 6))];
}

/**
 * Playtest harness: a real 1x canvas scene, not a mock background.
 * docs/10 §3 item 6 — art is finally judged at 1x, moving, with lighting and a camera. A mock
 * never catches that. This is dependency-free HTML5 canvas so it runs anywhere.
 */
function playtest_harness(sheet, manifest, opts = {}) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>PixelHand playtest — ${manifest.format}</title>
<style>
  body{margin:0;background:#0b0d12;color:#c9d2e0;font:13px/1.5 ui-monospace,Consolas,monospace}
  canvas{image-rendering:pixelated;image-rendering:crisp-edges;border:1px solid #22262f}
  #wrap{display:flex;gap:16px;padding:16px;flex-wrap:wrap}
  .panel{border:1px solid #22262f;padding:10px}
  button{background:#1b2130;color:#c9d2e0;border:1px solid #2c3546;padding:4px 10px;font:inherit;cursor:pointer}
  .k{color:#7f8ba3}
</style></head><body>
<div id="wrap">
  <div class="panel">
    <div><button id="play">play</button> <button id="slow">half speed</button> <button id="fast">double speed</button>
      <span id="state" class="k"></span></div>
    <canvas id="c" width="${sheet.width * 2}" height="${sheet.height * 2}"></canvas>
    <div class="k">1x art pixels, integer-scaled x2 for visibility. Nearest-neighbour only — a filtered canvas lies about pixel art.</div>
  </div>
  <div class="panel">
    <b>${manifest.style?.id || manifest.style}</b>
    <pre id="info"></pre>
  </div>
</div>
<script>
const SHEET = ${JSON.stringify({ width: sheet.width, height: sheet.height, cellW: sheet.cellW, cellH: sheet.cellH, cols: sheet.cols })};
const CLIPS = ${JSON.stringify(manifest.clips)};
const FRAMES = ${JSON.stringify(manifest.frames.map(f => ({ name: f.name, x: f.x, y: f.y, w: f.w, h: f.h, duration: f.duration, clip: f.clip, direction: f.direction })))};
const SCALE = 2;
const c = document.getElementById('c'), ctx = c.getContext('2d');
ctx.imageSmoothingEnabled = false;
const img = new Image();
let playing = true, speed = 1, t = 0, last = 0, clipName = Object.keys(CLIPS)[0], dir = Object.keys(CLIPS[Object.keys(CLIPS)[0]].rows)[0];
function framesFor(){ return FRAMES.filter(f => f.clip === clipName && f.direction === dir); }
function draw(now){
  const dt = now - last; last = now;
  if (playing) t += dt * speed;
  const fs = framesFor();
  if (fs.length){
    const total = fs.reduce((s,f)=>s+(f.duration||120),0);
    let k = t % total, i = 0;
    for (i=0;i<fs.length;i++){ k -= (fs[i].duration||120); if (k<=0) break; }
    const f = fs[Math.min(i, fs.length-1)];
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(img, f.x, f.y, f.w, f.h, 8, 8, f.w*SCALE, f.h*SCALE);
    document.getElementById('state').textContent = clipName+'/'+dir+' frame '+i+' of '+fs.length+'  '+f.duration+'ms';
  }
  requestAnimationFrame(draw);
}
img.onload = () => {
  document.getElementById('info').textContent =
    'clips: '+Object.keys(CLIPS).join(', ')+'\\ndirections: '+Object.keys(CLIPS[Object.keys(CLIPS)[0]].rows).join(', ')+
    '\\nper-frame durations (ms):\\n'+Object.entries(CLIPS).map(([n,cl])=>'  '+n+' fps '+cl.fps+'  '+JSON.stringify(cl.durations)).join('\\n')+
    '\\nevents:\\n'+Object.entries(CLIPS).map(([n,cl])=>'  '+n+' '+JSON.stringify(cl.events)).join('\\n');
  requestAnimationFrame(draw);
};
img.src = opts.sheetFile || 'sheet.png';
document.getElementById('play').onclick = ()=>{ playing = !playing; };
document.getElementById('slow').onclick = ()=>{ speed *= 0.5; };
document.getElementById('fast').onclick = ()=>{ speed *= 2; };
document.getElementById('c').onclick = ()=>{ const ks=Object.keys(CLIPS); clipName = ks[(ks.indexOf(clipName)+1)%ks.length]; };
document.getElementById('c').oncontextmenu = (e)=>{ e.preventDefault(); const ks=Object.keys(CLIPS[clipName].rows); dir = ks[(ks.indexOf(dir)+1)%ks.length]; };
</script></body></html>`;
  return html;
}

module.exports = { ambient_palette, LIGHT_STATES, Scene, groundPalette, playtest_harness, shortestDelta };
