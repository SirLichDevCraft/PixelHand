// The art-direction loop. docs/11.
//
// The design principle the whole file rests on:
//
//   People cannot specify a visual style in words. They can recognise one.
//
// So the loop is recognition-driven, not description-driven. The engine presents small concrete
// option sets along ONE axis, the human reacts, and every reaction is recorded as a constraint
// on the coordinate. Style bibles are not authored by the agent and handed over; they are
// accumulated from the human's decisions and then enforced forever after.
//
// Bounded on purpose: <=3 options, one axis per round, <=2 questions per asset, max 6 rounds
// per style, then it locks. Unbounded option rounds do not converge, they churn.
"use strict";

const fs = require("fs");
const path = require("path");
const { AXES, REQUIRED } = require("./style.js");
const { multiSheet, renderCel, gridText } = require("../render.js");
const { audit } = require("../audit.js");

const MAX_ROUNDS = 6;
const MAX_OPTIONS = 3;

// ---- the shared vocabulary (docs/11 §3) ---------------------------------------
// Most people perceive a defect before they can name it. This table IS the interface:
// plain language in, specific rule changes out.
const VOCABULARY = {
  muddy:        { maps_to: ["aa_across_hue_family", "min_step_delta", "cross_material_aa"], change: "remove AA between materials; widen the value gap between adjacent ramp steps", axis: "temperature / edge_policy" },
  "too busy":   { maps_to: ["detail_budget", "lone_pixel", "cluster_character"], change: "lower detail density; enforce 2-4px clusters; delete single-pixel detail", axis: "detail" },
  noisy:        { maps_to: ["detail_budget", "dither_detected", "lone_pixel"], change: "lower detail density; forbid dither on this asset class", axis: "detail" },
  flat:         { maps_to: ["value_contrast_min", "value_structure", "formModelling"], change: "raise value contrast; model each region with 3+ ramp steps", axis: "shading" },
  cartoonish:   { maps_to: ["edge_policy", "exaggeration_axis", "saturation_curve"], change: "thin or remove the outline; reduce exaggeration; desaturate the lit end of ramps", axis: "edge_policy / mood" },
  cheap:        { maps_to: ["palette_magnitude", "ramp_steps_fuse", "ramp_collapse"], change: "raise palette magnitude for this scale, or reduce the ambition of the sprite", axis: "palette_size" },
  lifeless:     { maps_to: ["temperature", "ramp_hue_wobble", "placeholder_timing"], change: "enable hue-shifted shadows (never desaturate to grey); author per-frame durations", axis: "temperature / motion" },
  floats:       { maps_to: ["no_contact_ground", "anchor_drift"], change: "add a contact shadow at the feet; lock the baseline row", axis: "—" },
  "hard to read":{ maps_to: ["feature_budget_exceeded", "blob_silhouette", "silhouette_delta"], change: "cut features to the scale budget; break the silhouette", axis: "detail" },
  inconsistent: { maps_to: ["shape_family", "material_recipe", "assert_style"], change: "share the material ramp and the corner/terminal treatment across the family", axis: "—" },
  "too dark":   { maps_to: ["value_structure", "light_direction"], change: "raise the lit end of the ramp; check the declared light direction", axis: "shading" },
  "too bright": { maps_to: ["value_structure", "ramp_gets_more_saturated_when_lit"], change: "lower the lit end; desaturate highlights toward the light source", axis: "shading" },
};

function tastePath(root) { return path.join(root, "art", "taste.json"); }

function taste_read(root) {
  const p = tastePath(root);
  if (!fs.existsSync(p)) return { ok: true, taste: { project: null, style: "undeclared", rounds: [], accepted: [], rejected: [], decided_by_agent: [], vocabulary: VOCABULARY, signature: null } };
  return { ok: true, taste: JSON.parse(fs.readFileSync(p, "utf8")), path: p };
}

function taste_write(root, patch) {
  const cur = taste_read(root).taste;
  const next = {
    ...cur,
    ...patch,
    rounds: [...(cur.rounds || []), ...(patch.rounds || [])],
    accepted: [...(cur.accepted || []), ...(patch.accepted || [])],
    rejected: [...(cur.rejected || []), ...(patch.rejected || [])],
    decided_by_agent: [...(cur.decided_by_agent || []), ...(patch.decided_by_agent || [])],
    vocabulary: { ...VOCABULARY, ...(cur.vocabulary || {}), ...(patch.vocabulary || {}) },
  };
  const p = tastePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2));
  return { ok: true, path: p, rounds: next.rounds.length, accepted: next.accepted.length, rejected: next.rejected.length };
}

// ---- option rounds -------------------------------------------------------------

/**
 * Every axis has three concrete extremes to react to. Rejecting is easier than specifying, so
 * the options are deliberately far apart: the point of round 1 is to find out what the answer
 * is NOT, which is a constraint just as useful as a pick.
 */
const AXIS_OPTIONS = {
  temperature:   [["grey-value", "every shadow is the same hue, darker. Flat, lifeless, honest."], ["warm-cool-hue-shift", "shadows drift cool and stay saturated; lit areas drift warm."], ["complementary-shadow", "shadows take the complementary hue. Strong separation, higher risk of mud."]],
  edge_policy:   [["none", "no outline anywhere; value alone separates the subject from the ground."], ["selective-dark", "outline only where the silhouette needs separating; never on the lit rim."], ["full-1px", "a 1px dark edge on the whole silhouette. Reads clean, flattens form."]],
  detail:        [["pristine", "clean surfaces, no grain, minimal texture."], ["moderate", "2-4px clusters, some wear."], ["dense-grain", "texture everywhere. Only viable at large scale."]],
  palette_size:  [[8, "8 colours: every colour has to work hard."], [16, "16 colours: 3-4 step ramps per material."], [32, "32 colours: multi-material, sculpted."]],
  shading:       [["flat", "no interior gradient."], ["ramp-lit", "each material lit along its own ramp from one declared direction."], ["sculpted", "form modelled step by step; needs scale and palette."]],
  mood:          [["cozy-warm", "warm, soft, inhabited."], ["melancholy", "desaturated mid-tones, one warm light in a cold scene."], ["menacing", "hard edges, deep shadows, high contrast."]],
  projection:    [["topdown", "camera straight down; feet are the anchor, no facial read."], ["three-quarter", "camera at an angle; both a body read and a face read."], ["side", "flat profile; one authored facing plus a mirror."]],
  motion:        [["2-frame", "toggle only. Cheap, mechanical."], ["4-frame", "contact/down/passing/up. The stride budget."], ["6-frame", "in-betweens. Costs twice the art for a smoother read."]],
  exaggeration_axis: [["none", "accurate proportions. Safe, and therefore generic."], ["primary feature amplified", "the identifying feature is 1.5-2x; everything else simplified."], ["silhouette amplified", "the whole outline is pushed; detail stays restrained."]],
};

/**
 * style_options: one labelled A/B/C contact sheet plus the axis value each option represents.
 * `subjects` are the calibration assets, so the choice is made on real art, not on a description.
 */
function style_options(axis, subjects, opts = {}) {
  const variants = AXIS_OPTIONS[axis];
  if (!variants) return { ok: false, reason: `no option set for axis '${axis}'. Legal axes: ${Object.keys(AXIS_OPTIONS).join(", ")}` };
  const authored = subjects.map(s => s.cels?.length || (s.cel ? 1 : 0));
  if (authored.some(n => n === 0)) return { ok: false, reason: "style_options needs one authored candidate per option; nothing was supplied" };
  // Options are bounded by what was actually authored. Silently repeating one cel across three
  // options would show a human the same picture three times and ask them to choose between it.
  const n = Math.min(opts.count ?? MAX_OPTIONS, variants.length, Math.min(...authored));
  const chosen = variants.slice(0, n);
  const rows = chosen.map(([value, note], i) => ({
    label: `${String.fromCharCode(65 + i)}  ${value}`,
    note: note.slice(0, 46),
    cels: subjects.map(s => s.cels?.[i] ?? s.cel).filter(Boolean),
  }));
  const sheet = multiSheet(rows, opts.palette, { zoom: opts.zoom ?? 6, labelW: opts.labelW ?? 90, mode: opts.stage === "silhouette" ? "silhouette" : "view", stamp: `style_options axis=${axis} stage=${opts.stage || "shaded"} — one axis varies, everything else identical` });
  return {
    ok: true, axis, options: chosen.map(([value, note], i) => ({ option: String.fromCharCode(65 + i), value, why: note })),
    sheet, questions: [
      `Which one is wrong for you? (rejecting is easier than choosing)`,
      `For the one you like: is it too much or too little of anything?`,
    ],
    bounded: { max_options: MAX_OPTIONS, max_rounds: MAX_ROUNDS, one_axis_per_round: true },
  };
}

/** style_pick: the recorded delta on the coordinate. */
function style_pick(root, axis, option, note, current) {
  const taste = taste_read(root).taste;
  const round = (taste.rounds || []).length + 1;
  if (round > MAX_ROUNDS) return { ok: false, reason: `style has had ${MAX_ROUNDS} rounds and must lock or the brief is missing something. Run style_signature, or state what is missing.` };
  const value = option.value !== undefined ? option.value : option;
  const delta = { round, axis, picked: option.option ?? null, value, note: note || null, at: new Date().toISOString() };
  const next = current ? { ...current, [axis]: value } : null;
  taste_write(root, { rounds: [delta], accepted: note ? [{ axis, value, note }] : [{ axis, value }] });
  return { ok: true, delta, coordinate: next, rounds_used: round, rounds_remaining: MAX_ROUNDS - round };
}

/**
 * style_reject: a rejection is a constraint, not a failure. "Too muddy" becomes a rule change.
 */
function style_reject(root, axis, option, reason) {
  const translated = style_translate(reason);
  const delta = { round: (taste_read(root).taste.rounds || []).length + 1, axis, rejected: option ?? null, reason, implied_changes: translated.map(t => t.maps_to) };
  taste_write(root, { rounds: [delta], rejected: [{ pattern: option?.value ?? option ?? axis, reason, applies_to: translated.map(t => t.axis).filter(Boolean) }] });
  return { ok: true, delta, implied_changes: translated };
}

/** style_translate: plain language in, specific candidate rule changes out. Never guessed at. */
function style_translate(plain) {
  const words = String(plain).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const hits = [];
  for (const [word, def] of Object.entries(VOCABULARY)) {
    if (words.includes(word) || String(plain).toLowerCase().includes(word)) hits.push({ said: word, ...def });
  }
  if (!hits.length) {
    // An unactionable instruction is put back to the caller as 2-3 concrete candidates rather
    // than guessed at (docs/11 §10).
    return [{ said: plain, maps_to: [], change: "not actionable — here are the three concrete things it could mean: (a) widen value contrast, (b) add one accent cluster at the identifying detail, (c) reduce the number of competing features", axis: "—" }];
  }
  return hits;
}

/**
 * review_pack: one image, <=3 options, <=2 questions, on a shared baseline, with a render stamp.
 * Silhouette stage FIRST: shading on a shape that has not been agreed is wasted work.
 */
function review_pack(subject, options, opts = {}) {
  if (options.length > MAX_OPTIONS) return { ok: false, reason: `a review pack carries at most ${MAX_OPTIONS} options; ${options.length} is a chore, not a decision` };
  const stage = opts.stage ?? "silhouette";
  const rows = options.map((o, i) => ({ label: `${String.fromCharCode(65 + i)} ${o.name || ""}`.trim(), note: (o.note || "").slice(0, 44), cels: o.cels || [o.cel] }));
  const sheet = multiSheet(rows, opts.palette, { zoom: opts.zoom ?? 6, labelW: opts.labelW ?? 90, mode: stage === "silhouette" ? "silhouette" : stage === "value_map" ? "value_map" : "view", stamp: `${subject} — stage=${stage} — one decision per pack` });
  const measured = options.map((o, i) => {
    const cels = o.cels || [o.cel];
    const audits = cels.map(c => audit(c, { palette: opts.palette, style: opts.style, light: opts.light }));
    const craft = audits.map(a => a.craft?.score ?? 0);
    return { option: String.fromCharCode(65 + i), name: o.name, errors: audits.reduce((s, a) => s + a.errors, 0), craft: +(craft.reduce((s, v) => s + v, 0) / craft.length).toFixed(3), weakest: [...new Set(audits.flatMap(a => a.craft?.weakest || []))].slice(0, 3) };
  });
  return {
    ok: true, subject, stage, image: sheet.buffer, measured,
    questions: (opts.questions || [
      `Which one reads at a glance?`,
      `What is the one thing you would change about it?`,
    ]).slice(0, 2),
    note: "Measurements are mine. Which one is right is yours.",
  };
}

/**
 * style_signature: the style written in plain language for a human to confirm or correct.
 * If this paragraph does not read like the game in their head, the coordinate is wrong — and
 * fixing it here costs nothing next to fixing it after 400 sprites.
 */
function style_signature(style, palette) {
  const s = style;
  const parts = [];
  parts.push({ mood: { "cozy-warm": "Warm, soft, inhabited", melancholy: "Quiet and a bit sad; desaturated mid-tones with one warm light", menacing: "Threatening; hard edges and deep shadows", grim: "Harsh", whimsical: "Playful", sterile: "Clinical", violent: "Harsh", sacred: "Ceremonial" }[s.mood] || s.mood });
  parts.push({ [s.projection]: { topdown: "Seen from directly above", "three-quarter": "Seen from a three-quarter angle", side: "Seen flat from the side", iso: "Isometric", mixed: "Mixed camera" }[s.projection] || s.projection });
  parts.push(`${s.art_scale}px subjects`);
  parts.push(`${s.palette_size} colours maximum per sprite`);
  parts.push({ "grey-value": "Shades of the same hue, darkening without shifting — flat but honest", "warm-cool-hue-shift": "Shadows shift cool and stay saturated; lit areas shift warm and pale", "complementary-shadow": "Shadows take the complementary hue", "ambient-tinted": "Shadows take the scene's own colour, re-derived per scene", "single-hue": "One hue family, carried entirely by value" }[s.temperature]);
  parts.push({ none: "No outlines anywhere", "selective-dark": "A single dark edge only where the silhouette needs separating from the ground, never on the lit side", "full-1px": "A 1px dark edge around every silhouette", "chunky-2px": "A 2px cartoon outline", "per-class": "Outline policy differs by asset class" }[s.edge_policy]);
  parts.push({ flat: "Flat planes, no interior gradient", "two-value": "Two values per material", banded: "Banded shading", "ramp-lit": "Each material lit along its own ramp from one declared direction", sculpted: "Form sculpted step by step" }[s.shading]);
  parts.push({ pristine: "Clean surfaces, no grain", moderate: "Chunky 2-3 pixel clusters; nothing floats alone", "dense-grain": "Dense texture", hyper: "Hyper-detailed" }[s.detail]);
  parts.push({ "2-frame": "Two-frame toggles", "4-frame": "Four-frame cycles (contact, down, passing, up)", "6-frame": "Six-frame cycles with in-betweens", "8-frame": "Eight-frame cycles", static: "Static assets", "sub-asset": "Sub-assets animate independently" }[s.motion]);
  if (palette) parts.push(`${palette.size}-entry palette built from ${palette.rampIds().length} authored ramps`);
  const sentences = parts.filter(Boolean).map(p => Object.values(p)[0]).filter(Boolean);
  const text = sentences.join(". ") + ". Light from the top-left unless a sprite declares otherwise.";
  return { ok: true, signature: text, axes: REQUIRED.map(a => `${a}=${s[a]}`), confirm_required: true };
}

/** compare: side-by-side plus a changed-pixel report. */
function compare(a, b, opts = {}) {
  const { diff } = require("./cel.js");
  const sameCanvas = a.w === b.w && a.h === b.h;
  const edits = sameCanvas ? diff(a, b) : [];
  const entered = edits.filter(e => e.from < 0).length, left = edits.filter(e => e.to < 0).length, repainted = edits.length - entered - left;
  const sheet = multiSheet([{ label: "A " + a.name, cels: [a] }, { label: "B " + b.name, cels: [b] }], opts.palette, { zoom: opts.zoom ?? 8, labelW: 70, stamp: sameCanvas ? `compare ${a.name} vs ${b.name} — ${edits.length} pixels differ (+${entered} entered / -${left} left / ~${repainted} repainted)` : `compare ${a.name} (${a.w}x${a.h}) vs ${b.name} (${b.w}x${b.h}) — different canvases: shape comparison only` });
  // A 16px drawing and an 8px drawing are not "the same" because the pixel diff is empty.
  // Cross-scale comparison has to be a comparison of shape, not of pixels.
  const shape = (c) => {
    const bb = c.bbox();
    if (!bb) return null;
    const solid = require("./style.js").silhouetteOf(c);
    let per = 0, area = 0;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      if (!solid[y * c.w + x]) continue;
      area++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= c.w || ny >= c.h || !solid[ny * c.w + nx]) per++;
      }
    }
    return { canvas: [c.w, c.h], box: [bb.w, bb.h], aspect: +(bb.w / bb.h).toFixed(2), fill: +(bb.area / (bb.w * bb.h)).toFixed(3), compactness: +(per / Math.sqrt(area)).toFixed(2), colours: c.counts().size };
  };
  const sa = shape(a), sb = shape(b);
  const shapeDistance = sa && sb ? +Math.abs(sa.aspect - sb.aspect) + Math.abs(sa.fill - sb.fill) + Math.abs(sa.compactness - sb.compactness) / 4 : null;
  return {
    ok: true, image: sheet.buffer, changed: { pixels: edits.length, entered, left, repainted },
    at: edits.slice(0, 40), same: sameCanvas && edits.length === 0,
    sameCanvas, shape: { a: sa, b: sb, distance: shapeDistance },
    note: sameCanvas ? null : `canvases differ (${a.w}x${a.h} vs ${b.w}x${b.h}); pixel diff is not defined, shape distance ${shapeDistance} is`,
  };
}

/**
 * annotate: apply the human's notes as authored pixel edits.
 * notes: "x,y: too dark; 12,8: remove" — the notes are applied, not interpreted.
 */
function annotate(cel, palette, notes, opts = {}) {
  const edits = [];
  const applied = [];
  const unresolved = [];
  const ops = String(notes).split(";").map(s => s.trim()).filter(Boolean);
  for (const op of ops) {
    const m = op.match(/^\s*(\d+)\s*,\s*(\d+)\s*:\s*(.+)$/);
    if (!m) { unresolved.push(op); continue; }
    const x = +m[1], y = +m[2], want = m[3].toLowerCase();
    const cur = cel.get(x, y);
    if (cur < 0) { unresolved.push(`${x},${y}: ${want} (nothing there)`); continue; }
    let to = cur;
    if (/remove|delete|gone|none/.test(want)) to = -1;
    else if (/darker|less light|shadow/.test(want)) { const l = palette.ramp(palette.entries[cur].ramp); const k = l.indexOf(cur); to = k > 0 ? l[k - 1] : cur; }
    else if (/lighter|brighter|more light/.test(want)) { const l = palette.ramp(palette.entries[cur].ramp); const k = l.indexOf(cur); to = k < l.length - 1 ? l[k + 1] : cur; }
    else if (/outline/.test(want)) to = palette.entries.findIndex(e => e.role === "outline");
    else if (/accent/.test(want)) to = palette.entries.findIndex(e => e.role === "accent");
    else if (/^\d+$/.test(want)) to = +want;
    else { unresolved.push(`${x},${y}: ${want} (no pixel-level meaning for that phrase — say darker, lighter, outline, accent, or remove)`); continue; }
    if (cel.set(x, y, to).changed) { edits.push({ x, y, from: cur, to }); applied.push({ x, y, from: cur, to }); }
  }
  return { ok: true, changed: { pixels: edits.length, added: 0, removed: edits.filter(e => e.to < 0).length, repainted: edits.filter(e => e.to >= 0).length }, region: edits.length ? { x0: Math.min(...edits.map(e => e.x)), y0: Math.min(...edits.map(e => e.y)), x1: Math.max(...edits.map(e => e.x)), y1: Math.max(...edits.map(e => e.y)) } : null, applied, unresolved, violations: [], warnings: unresolved.length ? [`${unresolved.length} note(s) had no pixel-level meaning and were NOT guessed at: ${unresolved.join(" | ")}`] : [] };
}

module.exports = { VOCABULARY, AXIS_OPTIONS, MAX_ROUNDS, MAX_OPTIONS, taste_read, taste_write, style_options, style_pick, style_reject, style_translate, review_pack, style_signature, compare, annotate };
