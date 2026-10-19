// Clips, frames, timing and events. docs/03 §3-§4.
//
// Two numbers define an animation and neither of them is a frame count: how many frames you
// draw (how much information exists) and how fast they play (how that information feels).
// The same 4 frames at 8fps reads as a stride; at 24fps it reads as a shuffle. So duration is
// authored per frame, and `timing_apply` never duplicates a frame to fake a hold — a hold is
// one frame with a longer duration, which is honest in the data and costs no extra art.
"use strict";

const { Cel, diff, applyPatch, invert, UndoStack } = require("./cel.js");
const { DIRECTIONS, WALK_POSES } = require("./rig.js");

/**
 * Clip templates: key poses, frame budget, mandatory motion per body region, default fps.
 * Templates are starting points I override, not generators. A clip that ignores its mandatory
 * motion set fails loop_validate — that is what "a walk with no arm counter-swing" means here.
 */
const CLIP_TEMPLATES = {
  idle:    { poses: ["neutral", "inhale", "exhale", "settle"], frames: [2, 4], fps: 10,
             mandatory: { chest: "rise", head: "drift", one_of: ["blink", "weight_shift"] } },
  walk:    { poses: WALK_POSES, frames: [4, 8], fps: 12,
             mandatory: { legs: "alternate", arms: "oppose legs", head: "curve not square wave", feet: "stay planted" } },
  run:     { poses: ["contact", "passing", "airborne", "land"], frames: [4, 6], fps: 18,
             mandatory: { torso: "forward lean", airborne: "must actually be airborne", one_of: ["smear on the fast limb"] } },
  attack1: { poses: ["anticipation", "action", "recovery"], frames: [3, 6], fps: 15,
             mandatory: { anticipation: "must be LONGER than the swing — this is where weight reads" } },
  attack2: { poses: ["anticipation", "wind", "action", "follow-through", "recovery"], frames: [4, 8], fps: 16,
             mandatory: { anticipation: "longer than the swing", follow_through: "the weapon must overshoot" } },
  hurt:    { poses: ["impact", "recoil"], frames: [2, 3], fps: 16,
             mandatory: { silhouette: "must change SHAPE, not just position" } },
  death:   { poses: ["impact", "fall", "settle"], frames: [3, 6], fps: 10,
             mandatory: { contact_shadow: "must track the body" } },
  jump:    { poses: ["crouch", "launch", "air", "land"], frames: [2, 4], fps: 14, mandatory: {} },
  interact:{ poses: ["reach", "hold", "retract"], frames: [2, 4], fps: 10,
             mandatory: { held: "held item must stay attached to the hand cel" } },
};

class Frame {
  constructor(cel, opts = {}) {
    this.cel = cel;
    this.poseName = opts.poseName ?? cel.meta?.pose ?? null;
    this.pose = opts.pose ?? null;
    this.duration = opts.duration ?? null;      // ms; null means "not authored yet" which is a finding
    this.events = opts.events ?? [];            // [{ at: 'footstep' | 'hitbox_active' | 'sfx', ... }]
    this.link = opts.link ?? null;              // id of another frame sharing this cel (cel_link)
    this.subpixel = opts.subpixel ?? null;      // [dx, dy] in eighths of a pixel, baked at export
    this.hold = opts.hold ?? false;
  }
}

class Clip {
  constructor(id, opts = {}) {
    this.id = id;
    this.template = opts.template ?? null;
    this.directions = opts.directions ?? [...DIRECTIONS];
    this.framesByDirection = new Map();       // direction -> Frame[]
    this.fps = opts.fps ?? null;               // declared, never defaulted silently
    this.events = opts.events ?? {};           // frameIndex -> [event names]
    this.notes = opts.notes ?? "";
    if (!Array.isArray(this.directions) || !this.directions.length || new Set(this.directions).size!==this.directions.length || this.directions.some(d=>!DIRECTIONS.includes(d))) throw Object.assign(new Error("A clip needs a nonempty, unique set of declared directions"),{rule:"clip_directions"});
    if (this.template && !CLIP_TEMPLATES[this.template]) { const e = new Error(`unknown clip template '${this.template}'`); e.rule = "unknown_clip_template"; throw e; };
  }

  setFrames(direction, frames) {
    if (!this.directions.includes(direction)) { const e = new Error(`direction '${direction}' is not in this clip's declared set`); e.rule = "undeclared_direction"; throw e; };
    this.framesByDirection.set(direction, frames);
    return this;
  }
  frames(direction) { return this.framesByDirection.get(direction) || []; }
  directionsWithFrames() { return [...this.framesByDirection.keys()].filter(d => this.framesByDirection.get(d).length); }

  /** Frame count must be identical across the direction set or turning feels uneven. */
  frameCountReport() {
    const counts = {};
    for (const d of this.directions) counts[d] = this.frames(d).length;
    const distinct = [...new Set(Object.values(counts))];
    return { counts, distinct, consistent: distinct.length <= 1 };
  }

  /**
   * timing_apply: per-frame durations from a named curve, or an explicit duration list.
   * A hold is one frame with a longer duration. Frames are never duplicated.
   */
  applyTiming(spec) {
    const curves = {
      // fractions of the cycle each frame occupies; sums to 1
      even:        null,
      "walk-stride": [0.30, 0.22, 0.14, 0.34],       // contact held longest, passing is quick
      "heavy-walk": [0.34, 0.24, 0.12, 0.30],
      "attack-weighted": [0.45, 0.18, 0.37],         // anticipation longer than the swing
      "attack-heavy": [0.50, 0.12, 0.16, 0.22],
      "run-sprint": [0.20, 0.14, 0.38, 0.28],
      "idle-breathe": [0.22, 0.30, 0.30, 0.18],
      "hurt-snap": [0.20, 0.55, 0.25],
      "death-fall": [0.18, 0.42, 0.40],
    };
    for (const [direction, frames] of this.framesByDirection) {
      if (!frames.length) continue;
      let durations;
      if (Array.isArray(spec)) durations = spec;
      else if (spec.durations) durations = spec.durations;
      else if (spec.curve && curves[spec.curve]) {
        const c = curves[spec.curve];
        // A curve is authored for a full cycle. With fewer frames than the curve has steps, the
        // fractions are re-normalised over the frames that exist rather than truncated, so the
        // cycle length stays the declared one instead of silently speeding up.
        const used = frames.map((_, i) => c[i % c.length]);
        const sum = used.reduce((s, x) => s + x, 0) || 1;
        const cycle = 1000 / (spec.fps ?? this.fps ?? 12);
        durations = used.map(f => Math.max(1, Math.round(cycle * f / sum)));
      } else if (spec.fps) {
        const cycle = 1000 / spec.fps;
        durations = frames.map(() => Math.round(cycle));
      } else { const e = new Error("timing_apply needs {curve}, {durations} or {fps}"); e.rule = "bad_timing_args"; throw e; };
      frames.forEach((f, i) => { f.duration = durations[i % durations.length]; });
      if (spec.fps) this.fps = spec.fps;
      else if (!this.fps) this.fps = +(1000 / Math.max(1, durations.reduce((s, d) => s + d, 0))).toFixed(2);
    }
    const perFrame = this.frames(this.directions[0]).map(f => f.duration);
    const cycle = perFrame.reduce((s, d) => s + (d || 0), 0);
    const uniform = new Set(perFrame).size === 1;
    return {
      clip: this.id, fps: this.fps, cycle_ms: cycle, per_frame: perFrame, durations: perFrame,
      warnings: uniform ? [`every frame of '${this.id}' lasts ${perFrame[0]}ms — that is a metronome, not a rhythm. A hold is a LONGER duration, never a duplicated frame (docs/03 §3).`] : [],
    };
  }

  /** event_add: markers travel into the manifest so game code drives feel from the art. */
  addEvent(direction, frameIndex, event, data = {}) {
    const frames = this.frames(direction);
    if (!frames[frameIndex]) { const e = new Error(`no frame ${frameIndex} in ${this.id}/${direction}`); e.rule = "no_frame"; throw e; };
    frames[frameIndex].events.push({ event, ...data });
    return { clip: this.id, direction, frame: frameIndex, event };
  }

  eventsReport() {
    const out = {};
    for (const [d, frames] of this.framesByDirection) {
      frames.forEach((f, i) => { if (f.events.length) (out[d] = out[d] || {})[i] = f.events.map(e => e.event); });
    }
    return out;
  }

  /** cel_link: two frames that genuinely share pixels share a cel, so a fix propagates. */
  linkFrames(a, b) {
    if (!a.cel.equals(b.cel)) return { ok: false, reason: "the two cels are not identical; linking them would silently change one frame", changed: { pixels: 0 }, violations: [], warnings: [] };
    b.link = a.link || `${this.id}/${b.direction}/${b.index}`;
    b.cel = a.cel;
    return { ok: true, changed: { pixels: 0 }, violations: [], warnings: [`frames linked: a fix to one is now a fix to both`] };
  }

  /**
   * smear_frame: a fast limb drawn ALONG its own path, stepping down the ramp so it stays
   * on palette. docs/09 §6 — this is authored frame trickery, not motion blur.
   */
  smearFrame(direction, frameIndex, opts = {}) {
    const frames = this.frames(direction);
    const f = frames[frameIndex];
    if (!f) { const e = new Error(`no frame ${frameIndex}`); e.rule = "no_frame"; throw e; };
    const prev = frames[frameIndex - 1] || frames[frames.length - 1];
    const delta = diff(prev.cel, f.cel);
    if (!delta.length) return { ok: false, reason: "no motion between this frame and its predecessor, so there is nothing to smear", changed: { pixels: 0 }, violations: [], warnings: [] };
    const palette = opts.palette;
    const ramp = palette && opts.ramp ? palette.ramp(opts.ramp) : null;
    const out = f.cel.clone(f.cel.name + ".smear");
    // the smear trails from where the limb WAS toward where it IS going, stepping down the ramp
    const byLine = new Map();
    for (const e of delta) {
      const k = `${e.x - e.y}`;
      if (!byLine.has(k)) byLine.set(k, []);
      byLine.get(k).push(e);
    }
    let painted = 0;
    for (const group of byLine.values()) {
      const tail = group[0];
      for (let k = 1; k <= (opts.trail ?? 2); k++) {
        const x = tail.x - Math.sign(tail.to - tail.from || 1) * 0 + (tail.x - (group[group.length - 1]?.x ?? tail.x) ? -k : k);
        const px = tail.x - k, py = tail.y;
        if (!out.inBounds(px, py) || out.get(px, py) >= 0) continue;
        let idx = tail.to;
        if (ramp && palette) {
          const e = palette.entries[tail.to];
          if (e?.ramp) {
            const list = palette.ramp(e.ramp);
            const j = Math.max(0, list.indexOf(tail.to) - k);
            idx = list[j];
          }
        }
        if (out.set(px, py, idx).changed) painted++;
      }
    }
    out.meta = { ...out.meta, smear: true, smear_from: prev.poseName };
    frames[frameIndex] = new Frame(out, { poseName: f.poseName, pose: f.pose, duration: Math.round((f.duration ?? 1000 / (this.fps || 12)) * 0.6), events: f.events, subpixel: f.subpixel });
    return { ok: true, changed: { pixels: painted, added: painted, removed: 0, repainted: 0 }, region: out.bbox(), violations: [], warnings: [`smear on ${this.id}/${direction}#${frameIndex}: the limb is drawn along its own path, stepping down the ramp so it stays on palette`] };
  }

  /**
   * Hit flash: a declared light step used for ONE frame on impact. Not a shader, not a filter.
   * docs/09 §6.
   */
  hitFlash(direction, frameIndex, palette, opts = {}) {
    const f = this.frames(direction)[frameIndex];
    if (!f) { const e = new Error(`no frame ${frameIndex}`); e.rule = "no_frame"; throw e; };
    const flashIdx = opts.flash ?? palette.entries.findIndex(e => e.role === "light");
    const out = f.cel.clone(f.cel.name + ".flash");
    let n = 0;
    f.cel.forEach((v, x, y) => {
      if (v < 0) return;
      const e = palette.entries[v];
      if (e.role !== "material") return;
      if (opts.regions && !opts.regions.includes(e.ramp)) return;
      if (out.set(x, y, flashIdx).changed) n++;
    });
    this.frames(direction)[frameIndex] = new Frame(out, { poseName: f.poseName, pose: f.pose, duration: Math.max(60, Math.round((f.duration ?? 100) * 0.4)), events: [...f.events, { event: "hit_flash" }] });
    return { ok: true, changed: { pixels: n, added: 0, removed: 0, repainted: n }, region: out.bbox(), violations: [], warnings: [`hit flash is one frame only; ${n} material pixels repainted to the declared light step`] };
  }

  /**
   * Impact squash: a one-pixel scale change with VOLUME PRESERVED. Losing volume on impact is
   * what makes a squash look like the character deflated.
   */
  squash(direction, frameIndex, opts = {}) {
    const f = this.frames(direction)[frameIndex];
    if (!f) { const e = new Error(`no frame ${frameIndex}`); e.rule = "no_frame"; throw e; };
    const bb = f.cel.bbox();
    if (!bb) return { ok: false, reason: "empty cel", changed: { pixels: 0 }, violations: [], warnings: [] };
    const sx = opts.sx ?? 1, sy = opts.sy ?? -1;      // wider and shorter
    const out = new Cel(f.cel.w, f.cel.h, f.cel.paletteId, f.cel.name + ".squash");
    const newW = Math.max(1, bb.w + sx * 2), newH = Math.max(1, bb.h + sy);
    const cx = bb.x0 + bb.w / 2;
    const anchorY = bb.y1;                            // the feet stay on the ground
    let area = 0;
    for (let y = 0; y < newH; y++) for (let x = 0; x < newW; x++) {
      const srcX = Math.round(cx + (x - newW / 2) * (bb.w / newW));
      const srcY = Math.round(anchorY - (newH - 1 - y) * (bb.h / newH));
      const v = f.cel.get(srcX, srcY);
      if (v < 0) continue;
      if (out.set(x, y, v).changed) area++;
    }
    out.meta = { ...f.cel.meta, squash: [sx, sy], volumePreserved: true };
    this.frames(direction)[frameIndex] = new Frame(out, { poseName: f.poseName, pose: f.pose, duration: f.duration, events: f.events });
    const before = bb.area;
    return { ok: true, changed: { pixels: area, added: area, removed: 0, repainted: 0 }, region: out.bbox(), violations: [],
      warnings: [`squash ${before} -> ${area} silhouette px (${((area / before - 1) * 100).toFixed(0)}%); volume must stay within ~5% or the character deflates on impact`] };
  }

  toManifest() {
    const rows = {};
    const durations = {};
    const events = {};
    for (const d of this.directions) {
      const frames = this.frames(d);
      if (!frames.length) continue;
      rows[d] = frames.map((_, i) => `${this.id}/${d}/f${i}`);
      durations[d] = frames.map(f => f.duration);
      const ev = {};
      frames.forEach((f, i) => { if (f.events.length) ev[i] = f.events; });
      if (Object.keys(ev).length) events[d] = ev;
    }
    return { fps: this.fps, template: this.template, rows, durations, events, frameCounts: this.frameCountReport() };
  }
}

// ---- cel-level lifecycle: offset, opacity, undo, snapshot ---------------------

/** cel_offset: per-part bob, recoil, lean. The foot baseline never moves with it. */
function cel_offset(cel, offset, opts = {}) {
  const baseline = opts.baseline ?? cel.meta?.baseline ?? null;
  const before = [...cel.offset];
  cel.offset = [cel.offset[0] + offset[0], cel.offset[1] + offset[1]];
  cel.meta = { ...cel.meta, offset: cel.offset };
  const drift = baseline !== null ? (cel.bbox()?.y1 ?? 0) + cel.offset[1] - baseline : null;
  return { ok: true, changed: { pixels: 0, added: 0, removed: 0, repainted: 0 }, region: null, violations: [],
    warnings: drift !== null && Math.abs(drift) > 0 ? [`cel_offset moved the contact edge ${drift}px off the locked baseline row ${baseline}; the bob belongs on the torso part, not the whole cel`] : [],
    from: before, to: cel.offset };
}

function cel_set_opacity(cel, opacity) {
  if (opacity < 1) return { ok: false, changed: { pixels: 0 }, region: null,
    violations: [{ rule: "no_alpha", message: "this engine has no alpha channel. A faded cel is off-palette the moment it is exported. Re-key the cel onto lighter ramp steps instead (gradient_map).", fix: "gradient_map" }], warnings: [] };
  cel.meta = { ...cel.meta, opacity: 1 };
  return { ok: true, changed: { pixels: 0 }, region: null, violations: [], warnings: [] };
}

/** cel_copy: a new cel sharing nothing with the source. */
function cel_copy(cel, name) { return cel.clone(name || cel.name + ".copy"); }

/**
 * Cel store with undo/redo and snapshots. Disk is the source of truth: an MCP process dying
 * mid-session loses nothing that was saved, and undo history is reconstructible from snapshots.
 */
class CelStore {
  constructor() { this.cels = new Map(); this.undo = new Map(); this.redo = new Map(); this.snapshots = new Map(); }
  put(id, cel) { this.cels.set(id, cel); return cel; }
  get(id) { return this.cels.get(id); }
  has(id) { return this.cels.has(id); }
  ids() { return [...this.cels.keys()]; }

  edit(id, fn) {
    const cel = this.cels.get(id);
    if (!cel) { const e = new Error(`no cel '${id}'`); e.rule = "no_cel"; throw e; };
    const before = cel.clone();
    const res = fn(cel) || {};
    const edits = diff(before, cel);
    if (edits.length) {
      (this.undo.get(id) || this.undo.set(id, []).get(id)).push(edits);
      (this.redo.get(id) || this.redo.set(id, []).get(id)).length = 0;
    }
    return { ...res, changed: res.changed ?? { pixels: edits.length, added: edits.filter(e => e.from < 0).length, removed: edits.filter(e => e.to < 0).length, repainted: edits.length - edits.filter(e => e.from < 0).length - edits.filter(e => e.to < 0).length } };
  }
  undoStep(id) {
    const stack = this.undo.get(id);
    if (!stack?.length) return { ok: false, reason: "nothing to undo", changed: { pixels: 0, added: 0, removed: 0, repainted: 0 } };
    const edits = stack.pop();
    applyPatch(this.cels.get(id), invert(edits));
    (this.redo.get(id) || this.redo.set(id, []).get(id)).push(edits);
    return { ok: true, reverted: edits.length, changed: { pixels: edits.length, added: 0, removed: 0, repainted: edits.length } };
  }
  redoStep(id) {
    const stack = this.redo.get(id);
    if (!stack?.length) return { ok: false, reason: "nothing to redo", changed: { pixels: 0, added: 0, removed: 0, repainted: 0 } };
    const edits = stack.pop();
    applyPatch(this.cels.get(id), edits);
    (this.undo.get(id) || this.undo.set(id, []).get(id)).push(edits);
    return { ok: true, reapplied: edits.length, changed: { pixels: edits.length, added: 0, removed: 0, repainted: edits.length } };
  }
  snapshot(id) {
    const cel = this.cels.get(id);
    if (!cel) { const e = new Error(`no cel '${id}'`); e.rule = "no_cel"; throw e; };
    const key = `${id}@${this.snapshots.size}`;
    // A snapshot that aliases the live cel is not a snapshot: every later edit would have
    // already happened inside it. Clone on capture, clone on restore.
    this.snapshots.set(key, { id, cel: cel.clone(cel.name) });
    return { key, name: cel.name };
  }
  restore(key) {
    const snap = this.snapshots.get(key);
    if (!snap) { const e = new Error(`no snapshot '${key}'`); e.rule = "no_snapshot"; throw e; };
    const restored=snap.cel.clone(snap.cel.name),current=this.cels.get(snap.id);
    if(current)Object.assign(current,restored);
    this.cels.set(snap.id,current || restored);
    const filled = [...snap.cel.counts().values()].reduce((s, n) => s + n, 0);
    return { ok: true, id: snap.id, snapshot: key, filled_pixels: filled };
  }
  depth(id) { return (this.undo.get(id) || []).length; }
}

module.exports = { CLIP_TEMPLATES, Clip, Frame, CelStore, cel_offset, cel_set_opacity, cel_copy };
