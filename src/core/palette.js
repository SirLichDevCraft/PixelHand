// Palette and ramp authoring. Ramps are DERIVED from declared recipes (base hue, step count,
// hue-shift behaviour), never sampled from a reference image — that is what keeps the output
// original and what makes "same material across 400 assets" mean the same thing every time.
"use strict";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (c) => "#" + c.slice(0, 3).map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const parseHex = (s) => {
  const h = s.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
};

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return t.map(v => Math.round((v + m) * 255));
}

/**
 * A ramp recipe is authored, not filtered. Two forms are legal:
 *
 *  derived:  { base, steps, value:[lo..hi], hueShift, satCurve, warmEnd, hueLock }
 *  authored: { colors: ["#hex", ...] }   darkest -> brightest, hand-picked
 *
 * An authored ramp is a hand-mixed material: it is validated against the same rules
 * (monotonic value, consistent hue drift, no two steps indistinguishable) so a hand-picked
 * ramp cannot smuggle in the muddiness a derived ramp would have refused.
 */
function buildRamp(recipe) {
  if (Array.isArray(recipe.colors)) {
    const out = recipe.colors.map((h) => {
      const rgb = parseHex(h);
      const l = rgbToHsl(rgb)[2];
      return { rgb, t: 0, value: l };
    });
    out.forEach((s, i) => { s.t = out.length === 1 ? 1 : i / (out.length - 1); });
    return out;
  }
  const { base, steps, value, hueShift = 0, satCurve = [1, 1], warmEnd = "lit", hueLock = false } = recipe;
  const [bh, bs, bl] = rgbToHsl(parseHex(base));
  const lo = value?.[0] ?? 0.22, hi = value?.[1] ?? 0.82;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 1 : i / (steps - 1);            // 0 = darkest, 1 = brightest
    const l = lo + (hi - lo) * t;
    // Hue shift: shadows drift cool, lit areas drift warm (or the reverse). This is the
    // difference between "shades of grey" and "sculpted". hueLock disables it for grey materials.
    const dir = warmEnd === "lit" ? 1 : -1;
    const shift = hueLock ? 0 : hueShift * dir * (t - 0.5) * 2;
    const satT = satCurve[0] + (satCurve[1] - satCurve[0]) * t;
    const s = clamp(bs * satT, 0, 1);
    out.push({ rgb: hslToRgb([bh + shift, s, l]), t, value: l });
  }
  return out;
}

class Palette {
  constructor(id, entries = []) {
    this.id = id;
    this.entries = entries;                 // [{ name, rgb, role, ramp, step, value }]
    this.byName = new Map(entries.map((e, i) => [e.name, i]));
    this.ramps = new Map();                 // rampId -> [index,...] darkest -> brightest
    entries.forEach((e, i) => {
      if (e.ramp) {
        if (!this.ramps.has(e.ramp)) this.ramps.set(e.ramp, []);
        this.ramps.get(e.ramp).push(i);
      }
    });
    for (const [k, list] of this.ramps) list.sort((a, b) => this.entries[a].value - this.entries[b].value);
  }

  static fromSpec(id, spec) {
    const entries = [];
    const seen = new Set();
    const add = (name, rgb, role, rampId, step, relight) => {
      if (seen.has(name)) throw new Error(`duplicate palette entry name '${name}'`);
      seen.add(name);
      const hsl = rgbToHsl(rgb);
      entries.push({ name, rgb, role: role || "general", ramp: rampId ?? null, step: step ?? 0, value: hsl[2], relight: relight });
    };
    for (const [rampId, recipe] of Object.entries(spec.ramps || {})) {
      const built = buildRamp(recipe);
      built.forEach((s, i) => add(`${rampId}.${i}`, s.rgb, recipe.role || "material", rampId, i, recipe.relight));
    }
    for (const [name, def] of Object.entries(spec.single || {})) add(name, parseHex(def.rgb), def.role || "accent", null, 0, undefined);
    return new Palette(id, entries);
  }

  get size() { return this.entries.length; }
  index(name) { return this.byName.has(name) ? this.byName.get(name) : -1; }
  color(i) { return this.entries[i]?.rgb ?? null; }
  ramp(id) { return this.ramps.get(id) || null; }
  rampIds() { return [...this.ramps.keys()]; }
  has(i) { return i >= 0 && i < this.entries.length; }

  /** Nearest authorised colour. Delta-E-ish weighting: value matters more than hue for pixel art. */
  nearest(rgb) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.entries.length; i++) {
      const c = this.entries[i].rgb;
      const d = 2.0 * (c[0]-rgb[0]) ** 2 + 3.0 * (c[1]-rgb[1]) ** 2 + 1.2 * (c[2]-rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Step neighbours: the only indices allowed as a neighbour of `i` inside its own ramp. */
  neighbours(i) {
    const r = this.entries[i]?.ramp; if (!r) return [];
    const list = this.ramps.get(r);
    const k = list.indexOf(i);
    return [list[k-1], list[k+1]].filter(v => v !== undefined);
  }

  /**
   * Ramp discipline, measured. A ramp that is not monotonic, or whose steps are too close
   * together to tell apart, or whose hue drifts in two directions, is a broken material —
   * and a broken material repeated across 400 assets is what makes a game look generated.
   */
  auditRamps(opts = {}) {
    const problems = [];
    const minStep = opts.minValueStep ?? 0.055;   // below this two steps fuse at game scale
    const maxStep = opts.maxValueStep ?? 0.34;    // above this the ramp is a hard band, not a gradient
    for (const [id, list] of this.ramps) {
      const e = list.map((i) => this.entries[i]);
      for (let k = 1; k < e.length; k++) {
        const dv = e[k].value - e[k - 1].value;
        if (dv <= 0) problems.push({ ramp: id, pair: [e[k - 1].name, e[k].name], rule: "ramp_not_monotonic",
          message: `ramp '${id}': ${e[k].name} (L${e[k].value.toFixed(2)}) is not lighter than ${e[k - 1].name} (L${e[k - 1].value.toFixed(2)})` });
        else if (dv < minStep) problems.push({ ramp: id, pair: [e[k - 1].name, e[k].name], rule: "ramp_steps_fuse",
          message: `ramp '${id}': ${e[k - 1].name} -> ${e[k].name} differ by only ${dv.toFixed(3)} in value; at game scale they are the same colour` });
        else if (dv > maxStep) problems.push({ ramp: id, pair: [e[k - 1].name, e[k].name], rule: "ramp_step_too_wide",
          message: `ramp '${id}': ${e[k - 1].name} -> ${e[k].name} jump ${dv.toFixed(3)} in value; that is a band across the form, not a gradient` });
      }
      // Hue drift: a good ramp shifts hue monotonically (shadows cool, lit warm). A ramp that
      // swings back and forth reads as a set of unrelated colours wearing one material.
      const hues = e.map((x) => rgbToHsl(x.rgb)[0]);
      const sats = e.map((x) => rgbToHsl(x.rgb)[1]);
      const flips = [];
      for (let k = 1; k < hues.length; k++) {
        const d = ((hues[k] - hues[k - 1] + 540) % 360) - 180;
        if (Math.abs(d) < 1.5) continue;
        flips.push(d);
      }
      const sign = flips.length ? Math.sign(flips[0]) : 0;
      const reversals = flips.filter((d) => Math.sign(d) !== sign).length;
      if (reversals > 1) problems.push({ ramp: id, rule: "ramp_hue_wobble",
        message: `ramp '${id}' reverses its hue drift ${reversals} times — the material's shadows and highlights are drifting in different directions` });
      const satDrop = sats[0] - sats[sats.length - 1];
      if (e.length >= 3 && satDrop < -0.28 && e[0].role !== "light") problems.push({ ramp: id, rule: "ramp_gets_more_saturated_when_lit",
        severity: "warn",
        message: `ramp '${id}' gets ${(-satDrop).toFixed(2)} MORE saturated at its lit end; lit areas usually desaturate toward the light source, over-saturated highlights read as plastic` });
    }
    // Two entries anywhere in the palette that are visually identical will fuse on screen.
    for (let i = 0; i < this.entries.length; i++) for (let j = i + 1; j < this.entries.length; j++) {
      const a = this.entries[i], b = this.entries[j];
      if (Math.abs(a.value - b.value) < 0.035 && rgbDist(a.rgb, b.rgb) < 26) {
        problems.push({ rule: "palette_duplicate", pair: [a.name, b.name], severity: "warn",
          message: `'${a.name}' and '${b.name}' are indistinguishable on screen; one of them is dead weight in the bible` });
      }
    }
    return { ok: !problems.some(p => (p.severity || "error") === "error"), problems };
  }

  toManifest() {
    return { id: this.id, size: this.size, ramps: this.rampIds(), entries: this.entries.map(e => ({ name: e.name, rgb: hex(e.rgb), role: e.role, ramp: e.ramp, step: e.step })) };
  }
}

function rgbDist(a, b) { return Math.sqrt((a[0]-b[0])**2 * 2 + (a[1]-b[1])**2 * 3 + (a[2]-b[2])**2 * 1.2); }

module.exports = { Palette, buildRamp, rgbToHsl, hslToRgb, parseHex, hex, clamp };
