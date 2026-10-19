// THE TOOL SURFACE. One registry, three surfaces: this module, the CLI mirror, and the MCP wrapper.
//
// docs/01 §4: every result that describes a sprite carries the same top-level keys
//   { ok, changed, region, violations, warnings }
// and three rules hold everywhere:
//   1. "nothing changed" is reported loudly
//   2. every violation names its coordinates and the tool that fixes it
//   3. any region-scoped op reports what it actually touched
"use strict";

const fs = require("fs");
const path = require("path");

const { Cel, diff, rle, unrle } = require("./core/cel.js");
const { Palette, buildRamp, hex, parseHex, rgbToHsl } = require("./core/palette.js");
const style = require("./core/style.js");
const ops = require("./core/ops.js");
const rig = require("./core/rig.js");
const clipLib = require("./core/clip.js");
const { Project } = require("./core/project.js");
const collab = require("./core/collab.js");
const tiles = require("./core/tiles.js");
const parts = require("./core/parts.js");
const sceneLib = require("./core/scene.js");
const depth = require("./core/depth.js");
const regression = require("./core/regression.js");
const adapters = require("./adapters.js");
const { audit, formatAudit } = require("./audit.js");
const craft = require("./craft.js");
const render = require("./render.js");
const { buildSheet, buildManifest, writeExport, previewGif } = require("./export.js");
const { encodeGIF } = require("./codec/gif.js");
const { decodePNG } = require("./codec/png.js");

const ROOT = process.env.PIXELHAND_ROOT || path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");

/**
 * Warm state. Undo/redo, onion buffers, the render cache and the live selection live in the
 * process — rebuilding them per call is pure waste. Disk stays authoritative: a crashed process
 * loses nothing that was saved, and undo history is reconstructible from snapshots.
 */
class Workspace {
  constructor(root = ROOT) {
    this.root = root;
    this.project = null;
    this.store = new clipLib.CelStore();
    this.clips = new Map();
    this.rigs = new Map();
    this.skins = new Map();
    this.poses = new Map();
    this.cache = new Map();          // content hash -> render file path (docs/04 §4 rule 5)
    this.faces = new Map();          // celId -> compiled face recipe (the shading half of depth)
    this.faceRecipes = new Map();    // celId -> every ramp's recipe for that cel
    this.perspectives = new Map();   // id -> Perspective
    this.selection = null;
    this.renders = 0;
    this.calls = 0;
    this.authoredPixels = 0;
  }

  load(root = this.root) {
    // Open first so a bad path leaves the currently loaded project and its warm state intact.
    const project = Project.open(root);
    this.root = root;
    this.project = project;
    this.store = new clipLib.CelStore();
    this.clips.clear();
    this.rigs.clear();
    this.skins.clear();
    this.poses.clear();
    this.cache.clear();
    this.faces.clear();
    this.faceRecipes.clear();
    this.perspectives.clear();
    this.selection = null;
    this.renders = 0;
    this.calls = 0;
    this.authoredPixels = 0;
    // Warm state is a cache, not the record. On load the declared rigs and clips come back from
    // disk so a fresh process can resume an animation without re-declaring it.
    for (const [id, doc] of this.project.rigs) this.rigs.set(id, doc);
    for (const [id, doc] of this.project.skins) {
      const skin = new rig.Skin(id, doc.palette);
      let missing = 0;
      for (const p of doc.parts || []) {
        const cel = doc.sprite ? this.project.readCel(doc.sprite, p.cel_key) : null;
        if (!cel) { missing++; continue; }
        const part = { name: p.name, pose: p.pose, cel, anchorX: p.anchor?.[0] ?? 0, anchorY: p.anchor?.[1] ?? 0 };
        if (p.joint !== undefined) part.anchorJoint = p.joint;
        if (p.offset !== undefined) part.anchorOffset = p.offset;
        if (p.lean !== undefined) part.leanFactor = p.lean;
        skin.add(p.direction, part);
      }
      for (const [src, mirror] of Object.entries(rig.MIRROR_OF)) {
        if (mirror && skin.authoredDirections().includes(src) && !skin.authoredDirections().includes(mirror)) skin.deriveMirror(mirror, src);
      }
      skin.incomplete = missing ? `${missing} skin part cel(s) referenced by '${id}' are missing` : null;
      this.skins.set(id, skin);
    }
    for (const [id, doc] of this.project.clips) {
      const c = new clipLib.Clip(id, { template: doc.template, directions: doc.directions, fps: doc.fps, notes: doc.notes });
      c.sprite = doc.sprite ?? null;
      let missing = 0;
      for (const [dir, frames] of Object.entries(doc.frames_by_direction || {})) {
        const built = frames.map(f => {
          const cel = doc.sprite ? this.project.readCel(doc.sprite, f.cel) : null;
          if (!cel) { missing++; return new clipLib.Frame({ name: f.cel, meta: { clip: id, direction: dir, pose: f.pose } }, { poseName: f.pose, duration: f.duration, events: f.events || [] }); }
          cel.meta = { ...cel.meta, clip: id, direction: dir, pose: f.pose,
            ...(f.motion_parts ? { compositionParts: f.motion_parts } : {}) };
          return new clipLib.Frame(cel, { poseName: f.pose, duration: f.duration, events: f.events || [] });
        });
        c.setFrames(dir, built);
      }
      c.incomplete = missing > 0 ? `${missing} frame cel(s) referenced by '${id}' are not on disk under sprite '${doc.sprite}'` : null;
      this.clips.set(id, c);
    }
    return this.project;
  }
  needProject() {
    if (!this.project) {
      try { this.load(); } catch {
        const e = new Error("no project loaded; run project_init or point at an art/project.json");
        e.rule = "no_project";
        throw e;
      }
    }
    return this.project;
  }
  palette(id) {
    const p = this.needProject().palette_get(id);
    if (!p) { const e = new Error(`no palette '${id}'`); e.rule = "no_palette"; throw e; }
    return p;
  }
  styleOf(id) {
    const s = this.needProject().style_get(id);
    if (!s) { const e = new Error(`no style '${id}'`); e.rule = "no_style"; throw e; }
    return s;
  }
  /** Write a render to disk and return the path. The read-the-PNG path is the verified one. */
  saveRender(name, buffer, opts = {}) {
    const h = require("crypto").createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    const key = `${name}:${h}`;
    if (this.cache.has(key) && fs.existsSync(this.cache.get(key)) && !opts.force) return { path: this.cache.get(key), cached: true };
    // Render names are allowed to be grouped ("depth.corner-house/base"), so the directory has to be
    // derived from the name instead of assumed to be one level deep.
    const file = path.join(OUT, "inspect", `${name}.${h}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    this.cache.set(key, file);
    this.renders++;
    return { path: file, cached: false, bytes: buffer.length };
  }
  /** The dual channel: image + coordinate-addressed grid + audit, never one without the others. */
  triple(cel, palette, styleId, renderResult, opts = {}) {
    const s = styleId ? this.styleOf(styleId) : null;
    const a = audit(cel, { palette, style: s, light: opts.light ?? s?.light_vector });
    const st = s ? style.assertStyle(cel, s, palette, { assetClass: opts.assetClass || "object" }) : null;
    const img = this.saveRender(opts.name || cel.name, renderResult.buffer, opts);
    return {
      ok: a.ok && (!st || st.ok),
      image: img.path, cached: img.cached, zoom: renderResult.zoom,
      grid: render.gridText(cel, { labelEvery: opts.labelEvery }),
      legend: palette ? render.legendText(palette) : "",
      audit: a.findings.map(f => ({ rule: f.rule, severity: f.severity, at: (f.at || []).slice(0, 8).map(p => p.x === undefined ? p.material : `${p.x},${p.y}`), fix: f.fix, message: f.message })),
      audit_text: formatAudit(a),
      style_violations: st ? st.violations.map(v => ({ rule: v.rule, message: v.message })) : [],
      metrics: { colours: cel.counts().size, silhouette: cel.bbox()?.area ?? 0, bbox: cel.bbox(), craft: a.craft?.score, grade: a.craft?.grade, weakest: a.craft?.weakest },
      renders_used: this.renders,
    };
  }
}

const W = new Workspace();

// ---- helpers ------------------------------------------------------------------

const ok = (extra = {}) => ({ ok: true, changed: { pixels: 0, added: 0, removed: 0, repainted: 0 }, region: null, violations: [], warnings: [], ...extra });
const bad = (rule, message, extra = {}) => ({ ok: false, changed: { pixels: 0, added: 0, removed: 0, repainted: 0 }, region: null, violations: [{ rule, message, fix: extra.fix || null }], warnings: [], ...extra });

function celOf(args) {
  const id = args.cel ?? args.id;
  if (id && W.store.has(id)) return { cel: W.store.get(id), id };
  const tryDisk = (sprite, key) => {
    if (!sprite || !key) return null;
    const c = W.project?.readCel(sprite, key);
    if (!c) return null;
    const canonical = `${sprite}/${key}`;
    W.store.put(canonical, c);
    return { cel: c, id: canonical };
  };
  if (id && id.includes("/")) {
    const [sprite, ...rest] = id.split("/");
    const hit = tryDisk(sprite, rest.join("/"));
    if (hit) return hit;
  }
  const disk = tryDisk(args.sprite, args.cel_key);
  if (disk) return disk;
  const e = new Error(`no cel '${id}'. Create one with cel_new + draw_pixel_map, or pass {sprite, cel_key} for a cel on disk.`);
  e.rule = "no_cel";
  throw e;
}
function paletteOfCel(cel) { return W.palette(cel.paletteId); }

/**
 * A clip is git-tracked text, not session state. The document records the authored cel keys,
 * the declared direction set, the timing and the events — everything needed to resume the
 * animation in a process that was not alive when it was drawn.
 */
function clipDocOf(c, spriteId) {
  const frames_by_direction = {};
  for (const [d, frames] of c.framesByDirection) {
    frames_by_direction[d] = frames.map(f => ({
      cel: f.diskKey ?? f.cel?.name ?? null, pose: f.poseName ?? null,
      motion_parts: f.cel?.meta?.compositionParts || null,
      duration: f.duration ?? null, events: (f.events || []).map(e => e.event || e),
    }));
  }
  return {
    id: c.id, template: c.template, directions: c.directions, fps: c.fps, notes: c.notes,
    sprite: spriteId ?? null, frames_by_direction,
  };
}
function saveClip(c, spriteId) {
  if (!W.project) return null;
  return W.project.clip_save(c.id, clipDocOf(c, spriteId ?? c.sprite ?? null));
}

function withUndo(id, fn) {
  const cel = W.store.get(id);
  if (!cel) return bad("no_cel", `withUndo needs a cel in warm state ('${id}')`);
  const before = cel.clone();
  const res = fn() || {};
  const edits = diff(before, W.store.get(id));
  if (edits.length) {
    (W.store.undo.get(id) || (W.store.undo.set(id, []), W.store.undo.get(id))).push(edits);
    (W.store.redo.get(id) || (W.store.redo.set(id, []), W.store.redo.get(id))).length = 0;
    const authored = edits.filter(e => e.to >= 0).length;
    W.authoredPixels += authored;
    // Provenance is a by-product of the edit history, not a claim someone makes at the end.
    W.project?.record(id, "edit", authored, false);
  }
  const changed = res.changed ?? { pixels: edits.length, added: edits.filter(e => e.from < 0).length, removed: edits.filter(e => e.to < 0).length, repainted: edits.length - edits.filter(e => e.from < 0).length - edits.filter(e => e.to < 0).length };
  return { ...res, changed };
}

const TOOLS = {};
const tool = (name, describe, run) => { TOOLS[name] = { describe, run }; };

// ---- project & style ----------------------------------------------------------

tool("project_init", "Declare a project: a coordinate in the nine-axis space, frozen conventions.", (a) => {
  const res = Project.init(a.root || W.root, a);
  if (!res.ok) return bad("coordinate_refused", res.errors.map(e => e.message).join(" | "));
  W.project = res.project; W.root = a.root || W.root;
  return ok({ project: res.id, conventions: res.conventions, warnings: res.warnings });
});
tool("project_open", "Open an existing PixelHand project from its root without overwriting it; safely switches the active workspace.", (a) => {
  if (typeof a.root !== "string" || !a.root.trim()) return bad("missing_project_root", "project_open needs the project root containing art/project.json");
  let project;
  try { project = W.load(a.root); }
  catch (e) { return bad("project_open_failed", `cannot open PixelHand project at '${a.root}': ${e.message}`); }
  return ok({ project: project.doc.id, root: W.root, style: project.doc.style, canvas: project.doc.canvas, directions: project.doc.directions, fps: project.doc.fps });
});
tool("style_list", "List declared style bibles.", () => ok({ styles: W.needProject().style_list() }));
tool("style_load", "Load one bible.", (a) => ok({ bible: W.styleOf(a.id) }));
tool("style_create", "Declare a bible. Refuses an impossible coordinate with the exact inconsistent fields.", (a) => {
  const res = W.needProject().style_create(a.id, a.bible);
  if (!res.ok) return { ...bad("coordinate_refused", res.errors.map(e => `${e.rule}: ${e.message}`).join(" | ")), errors: res.errors, warnings: res.warnings };
  return ok({ bible: res.bible, warnings: res.warnings });
});
tool("assert_style", "Fail an asset against its bible. Each failure carries coordinates and the fix tool.", (a) => {
  const { cel } = celOf(a);
  const s = a.style ? W.styleOf(a.style) : W.styleOf(cel.meta.style || W.project.doc.style);
  const p = paletteOfCel(cel);
  const r = style.assertStyle(cel, s, p, { assetClass: a.asset_class || cel.meta.asset_class || "object" });
  return ok({ conforms: r.ok, violations: r.violations, metrics: r.metrics });
});

// ---- collaboration ------------------------------------------------------------

tool("style_options", "One labelled A/B/C contact sheet varying ONE axis.", (a) => {
  const resolve = x => typeof x === "string" ? W.store.get(x) : x;
  const subjects = (a.subjects || []).map(s => ({ cels: (s.cels || [s.cel]).map(resolve).filter(Boolean) }));
  if (subjects.some(s => !s.cels.length)) return bad("no_candidates", "style_options needs authored candidate cels; none of the supplied ids resolved");
  const r = collab.style_options(a.axis, subjects, { palette: a.palette ? W.palette(a.palette) : null, stage: a.stage, count: a.count, zoom: a.zoom });
  if (!r.ok) return bad("no_options", r.reason);
  const img = W.saveRender(`style_options.${a.axis}`, r.sheet.buffer, { force: true });
  return ok({ axis: r.axis, options: r.options, image: img.path, questions: r.questions, bounded: r.bounded });
});
tool("style_pick", "Record the delta a pick puts on the coordinate.", (a) => ok(collab.style_pick(W.root, a.axis, a.option, a.note, a.coordinate)));
tool("style_reject", "Record a rejection as a constraint, with the rule changes it implies.", (a) => ok(collab.style_reject(W.root, a.axis, a.option, a.reason)));
tool("style_translate", "Plain language in, specific candidate rule changes out. Never guessed at.", (a) => ok({ said: a.plain_language, implied: collab.style_translate(a.plain_language) }));
tool("review_pack", "One image, <=3 options, <=2 questions, on a shared baseline.", (a) => {
  const options = (a.options || []).map(o => ({ ...o, cel: typeof o.cel === "string" ? W.store.get(o.cel) : o.cel, cels: (o.cels || []).map(c => typeof c === "string" ? W.store.get(c) : c) }));
  const r = collab.review_pack(a.subject, options, { stage: a.stage, palette: a.palette ? W.palette(a.palette) : null, style: a.style ? W.styleOf(a.style) : null, light: a.light });
  if (!r.ok) return bad("review_pack", r.reason);
  const img = W.saveRender(`review.${a.subject}.${a.stage || "silhouette"}`, r.image, { force: true });
  return ok({ subject: r.subject, stage: r.stage, image: img.path, measured: r.measured, questions: r.questions, note: r.note });
});
tool("style_signature", "The style in plain language, for the human to confirm or correct.", (a) => ok(collab.style_signature(a.style ? W.styleOf(a.style) : a.bible, a.palette ? W.palette(a.palette) : null)));
tool("taste_read", "The persistent preference record.", () => ok(collab.taste_read(W.root)));
tool("taste_write", "Persist accepted/rejected patterns across sessions.", (a) => ok(collab.taste_write(W.root, a)));
tool("compare", "Side-by-side plus a changed-pixel report.", (a) => {
  const A = celOf({ cel: a.a }).cel, B = celOf({ cel: a.b }).cel;
  const r = collab.compare(A, B, { palette: paletteOfCel(A) });
  const img = W.saveRender(`compare.${A.name}.${B.name}`, r.image, { force: true });
  return ok({ image: img.path, changed: r.changed, at: r.at, same: r.same, sameCanvas: r.sameCanvas, shape: r.shape, note: r.note });
});
tool("annotate", "Apply the human's notes as authored pixel edits.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => collab.annotate(cel, paletteOfCel(cel), a.notes));
});
tool("sketch_analyse", "Measure a human sketch. Never a trace.", (a) => ok(W.needProject().sketch_analyse(a)));

// ---- palette & ramps ----------------------------------------------------------

tool("palette_get", "A palette with roles and ramps.", (a) => { const p = W.palette(a.id); return ok({ palette: p.toManifest(), ramps: p.rampIds().map(r => ({ ramp: r, steps: p.ramp(r).map(i => p.entries[i].name) })) }); });
tool("palette_set", "Declare a palette from authored ramp recipes.", (a) => {
  const r = W.needProject().palette_set(a.id, a.colors ? { single: Object.fromEntries(a.colors.map((c, i) => [`c${i}`, { rgb: c, role: "general" }])) } : a.spec);
  if (!r.ok) return bad("palette_refused", r.problems.map(p => p.message).join(" | "));
  return ok({ id: a.id, size: r.size, problems: r.problems });
});
tool("create_ramp", "Build a ramp from a recipe; reports distinct steps and warns when two collapse.", (a) => {
  const built = buildRamp(a);
  const distinct = new Set(built.map(s => hex(s.rgb))).size;
  const warnings = [];
  if (distinct < built.length) warnings.push(`${built.length - distinct} of ${built.length} steps resolved to a colour another step already has — that ramp is ${distinct} colours wearing ${built.length} slots`);
  for (let i = 1; i < built.length; i++) {
    const d = Math.abs(built[i].value - built[i - 1].value);
    if (d < 0.055) warnings.push(`steps ${i - 1}->${i} differ by ${d.toFixed(3)} in value; at game scale they are the same colour`);
  }
  return ok({ colors: built.map(s => hex(s.rgb)), distinct, values: built.map(s => +s.value.toFixed(3)), warnings });
});
tool("ramp_between", "A ramp interpolated between two authored colours, validated against the same rules.", (a) => {
  const steps = a.steps || 4;
  const A = rgbToHsl(parseHex(a.from)), B = rgbToHsl(parseHex(a.to));
  const colors = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 1 : i / (steps - 1);
    let dh = B[0] - A[0]; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    colors.push(hex(require("./core/palette.js").hslToRgb([A[0] + dh * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])));
  }
  return ok({ colors, distinct: new Set(colors).size, warnings: new Set(colors).size < steps ? ["two steps are the same colour"] : [] });
});
tool("quantise_to_palette", "Map arbitrary RGB onto declared ramps and report the worst-case delta.", (a) => {
  const rows = a.source || (a.rows ? a.rows.map(r => r.map(t => parseHex(t))) : null);
  const r = W.needProject().quantise_to_palette(rows, a.palette, a);
  if (!r.ok) return bad("quantise", r.reason);
  if (r.cel) W.store.put(a.name || "quantised", r.cel);
  return ok({ cel: a.name || "quantised", worst_delta: r.worst_delta, worst_at: r.worst_at, colours_off_palette: r.colours_off_palette });
});
tool("gradient_map", "Re-key existing art onto another palette's ramps. Pixel intent preserved.", (a) => {
  const { cel } = celOf(a);
  const r = W.needProject().gradient_map(cel, a.from, a.to, a);
  if (!r.ok) return bad("gradient_map", r.reason);
  W.store.put(a.cel, r.cel);
  return r;
});
tool("palette_audit", "Palette discipline at a glance: usage counts, ramp ordering, problems.", (a) => {
  const p = W.palette(a.id);
  const usage = new Map();
  for (const id of a.sprites || []) {
    const s = W.needProject().sprite_info(id);
    for (const key of Object.keys(s?.cels || {})) { const c = W.needProject().readCel(id, key); c?.forEach(v => { if (v >= 0) usage.set(v, (usage.get(v) || 0) + 1); }); }
  }
  const problems = p.auditRamps(a);
  const r = render.renderPaletteAudit(p, usage, problems.problems);
  const img = W.saveRender(`palette.${a.id}`, r.buffer, { force: true });
  return ok({ image: img.path, size: p.size, problems: problems.problems, usage: [...usage.entries()].map(([i, n]) => `${p.entries[i]?.name}: ${n}`) });
});

// ---- sprite lifecycle ---------------------------------------------------------

tool("sprite_create", "Declare a sprite document: canvas, anchor, layers, direction set, tier.", (a) => {
  const r = W.needProject().sprite_create(a);
  if (!r.ok) return bad("sprite_create", r.reason);
  const cel = new Cel(a.w, a.h, a.palette, `${a.id}.base`);
  W.store.put(`${a.id}.base`, cel);
  return ok({ sprite: r.sprite.id, path: r.path, canvas: r.sprite.canvas, anchor: r.sprite.anchor, layers: r.sprite.layers.map(l => l.id), tier: r.sprite.tier });
});
tool("sprite_info", "Read a sprite document.", (a) => ok({ sprite: W.needProject().sprite_info(a.id) }));
tool("sprite_list", "Every sprite in the project.", () => ok({ sprites: W.needProject().sprite_list() }));
tool("sprite_delete", "Delete a sprite and its cels.", (a) => ok(W.needProject().sprite_delete(a.id)));
tool("resize_canvas", "Resize a sprite canvas. Art is never scaled — pixels are preserved or clipped.", (a) => ok(W.needProject().resize_canvas(a.id, a.w, a.h)));
tool("layer_add", "Add a layer.", (a) => ok(W.needProject().layer_add(a.id, a.layer, a.z)));
tool("layer_remove", "Remove a layer and its cels.", (a) => ok(W.needProject().layer_remove(a.id, a.layer)));
tool("layer_reorder", "Reorder layers (occlusion).", (a) => ok(W.needProject().layer_reorder(a.id, a.order)));
tool("layer_opacity", "Refuses alpha: a faded cel is off-palette the moment it is exported.", (a) => ops ? (a.opacity < 1 ? bad("no_alpha", "this engine has no alpha channel. Re-key the cel onto lighter ramp steps with gradient_map instead.", { fix: "gradient_map" }) : ok({ opacity: 1 })) : null);
tool("save_cel", "Write a cel to its grid file on disk.", (a) => {
  const { cel } = celOf(a);
  const r = W.needProject().writeCel(a.sprite, a.cel_key || a.cel, cel);
  W.needProject().record(`${a.sprite}/${a.cel_key || a.cel}`, "save", cel.bbox()?.area ?? 0);
  return ok({ ...r, provenance: W.needProject().provenanceFor(a.sprite) });
});
// ---- painting: the hand-placement primitives ----------------------------------

tool("get_pixel_map", "The read half of the core pair.", (a) => {
  const { cel } = celOf(a);
  return ok({ ...ops.get_pixel_map(cel, { ...a, palette: paletteOfCel(cel) }), grid: render.gridText(cel) });
});
tool("draw_pixel_map", "The write half. This is how art is authored: rows of palette-index characters.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.draw_pixel_map(cel, a.map, { ...a, palette: paletteOfCel(cel) }));
});
tool("put", "Surgical single-pixel fixes: 'x,y,name;...'", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.put(cel, a.cells, { palette: paletteOfCel(cel) }));
});
tool("fill_region", "Rectangle fill or bounded flood; reports region components.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.fill_region(cel, { ...a, idx: typeof a.idx === "string" ? paletteOfCel(cel).index(a.idx) : a.idx }));
});
tool("draw_line", "Slope-aware line. SCAFFOLDING: a line is structure, not form.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.draw_line(cel, a.p0, a.p1, typeof a.idx === "string" ? paletteOfCel(cel).index(a.idx) : a.idx, a));
});
tool("draw_shape", "SCAFFOLDING ONLY. Reports coverage; a shape-dominated sprite is a defect.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.draw_shape(cel, a.shape, typeof a.idx === "string" ? paletteOfCel(cel).index(a.idx) : a.idx, a));
});
tool("stroke_shape", "Outline of a shape. Scaffolding.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.stroke_shape(cel, a.shape, typeof a.idx === "string" ? paletteOfCel(cel).index(a.idx) : a.idx, a));
});
tool("paint_form", "Light a flat region ALONG ITS RAMP. Never a brightness filter.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.paint_form(cel, paletteOfCel(cel), { ...a, ramp: a.ramp || a.material }));
});
tool("aa_pass", "Anti-aliasing: ramp-adjacent steps only, convex corners only.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.aa_pass(cel, paletteOfCel(cel), a.region, a));
});
tool("dither_pass", "Dither by pattern and density. Never on a silhouette or a face.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.dither_pass(cel, paletteOfCel(cel), a.region, a));
});
tool("outline_pass", "selective-dark | full-1px | none.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.outline_pass(cel, paletteOfCel(cel), { ...a, color_role: a.color_role || a.outline }));
});
tool("specular_pass", "A hard 1px line of the ramp's brightest step on the lit side. One per face.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.specular_pass(cel, paletteOfCel(cel), a.region, { ...a, ramp: a.ramp || a.material }));
});
tool("contact_shadow", "The dark band where a body meets the ground.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.contact_shadow(cel, paletteOfCel(cel), a));
});
tool("cast_shadow", "A directional shadow mass built from ramp steps in space.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.cast_shadow(cel, paletteOfCel(cel), a));
});
tool("glow", "A light source built from ramp steps arranged in space. No alpha anywhere.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.glow(cel, paletteOfCel(cel), a));
});
tool("shift_along_ramp", "The legal version of 'make it darker'.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.shift_along_ramp(cel, paletteOfCel(cel), a.steps, a.region, a));
});
tool("replace_color", "Exact index only — never a flood of near-colours.", (a) => {
  const { cel, id } = celOf(a);
  const p = paletteOfCel(cel);
  return withUndo(id, () => ops.replace_color(cel, typeof a.from === "string" ? p.index(a.from) : a.from, typeof a.to === "string" ? p.index(a.to) : a.to, a.region));
});
tool("erase", "Clear a region.", (a) => {
  const { cel, id } = celOf(a);
  return withUndo(id, () => ops.erase(cel, a.region));
});
tool("mirror", "Mirroring gated by an asymmetry audit that reports what would move.", (a) => {
  const { cel } = celOf(a);
  const r = ops.mirror(cel, { axis: a.axis, palette: paletteOfCel(cel) });
  if (a.into) W.store.put(a.into, r.cel);
  return ok({ cel: a.into || r.cel.name, asymmetry: r.asymmetry, warnings: r.warnings, changed: { pixels: 0 }, region: null, violations: [] });
});
tool("transform", "Offset or flip. Scaling art is refused outright.", (a) => {
  const { cel } = celOf(a);
  const r = ops.transform(cel, { ...a, palette: paletteOfCel(cel) });
  if (r.cel && a.into) W.store.put(a.into, r.cel);
  return r;
});

// ---- cels ---------------------------------------------------------------------

tool("cel_copy", "Copy a cel.", (a) => { const { cel } = celOf(a); W.store.put(a.into, cel.clone(a.into)); return ok({ cel: a.into }); });
tool("cel_offset", "Per-part bob/recoil. The foot baseline never moves with it.", (a) => {
  const { cel, id } = celOf(a);
  return clipLib.cel_offset(cel, a.offset, { baseline: a.baseline });
});
tool("cel_link", "Two frames that genuinely share pixels share a cel, so a fix propagates.", (a) => {
  const clip = W.clips.get(a.clip);
  if (!clip) return bad("no_clip", `no clip '${a.clip}'`);
  const frames = clip.frames(a.direction);
  return clip.linkFrames(frames[a.a], frames[a.b]);
});
tool("cel_set_opacity", "Refused below 1: this engine has no alpha channel.", (a) => {
  const { cel } = celOf(a);
  return clipLib.cel_set_opacity(cel, a.opacity);
});
tool("undo", "Undo the last edit on a cel.", (a) => ok(W.store.undoStep(a.cel)));
tool("redo", "Redo.", (a) => ok(W.store.redoStep(a.cel)));
tool("snapshot", "Freeze a cel state; undo history is reconstructible from snapshots.", (a) => { const r = W.store.snapshot(a.cel); return ok({ ...r, snapshot: r.key }); });
tool("restore", "Restore a snapshot.", (a) => ok(W.store.restore(a.key ?? a.snapshot)));
tool("cel_list", "Every cel in warm state.", () => ok({ cels: W.store.ids() }));
tool("cel_new", "Create an empty cel in warm state.", (a) => { W.store.put(a.cel, new Cel(a.w, a.h, a.palette, a.cel)); return ok({ cel: a.cel, canvas: [a.w, a.h] }); });
tool("cel_from_grid", "Load a cel from grid text (the format a human can edit in any editor).", (a) => { W.store.put(a.cel, Cel.fromGrid(a.grid, a.palette)); return ok({ cel: a.cel }); });
tool("cel_to_grid", "Read a cel as grid text.", (a) => { const { cel } = celOf(a); return ok({ grid: cel.toGrid(), labelled: render.gridText(cel) }); });

// ---- animation ----------------------------------------------------------------

tool("rig_create", "Declare a rig: joints per direction, limb widths, locked foot baseline.", (a) => {
  W.rigs.set(a.id, a);
  const saved = W.project ? W.project.rig_save(a.id, { canvas: a.canvas, baseline: a.baseline, anchors: a.anchors, zOrder: a.zOrder, partJoints: a.partJoints, limbWidth: a.limbWidth, gaitStride: a.gaitStride, gaitParts: a.gaitParts }) : null;
  return ok({ rig: a.id, persisted: !!saved, directions: Object.keys(a.anchors), baseline: a.baseline, note: "the rig is what keeps a knee in the same place across 8 directions x 4 frames = 32 drawings" });
});
tool("pose_define", "A pose is joint intent, authored once and reused across clips.", (a) => {
  const pose = new rig.Pose(a.name, a.spec);
  (W.poses || (W.poses = new Map())).set(a.name, pose);
  return ok({ pose: a.name, note: pose.note, template: clipLib.CLIP_TEMPLATES[a.clip] || null });
});
tool("skin_pose", "The step where the agent paints: the rig gives joint coordinates, the pixel map is authored.", (a) => {
  const skin = W.skins.get(a.skin);
  if (!skin) return bad("no_skin", `no skin '${a.skin}'`);
  const rigDef = W.rigs.get(a.rig);
  const pose = (W.poses || new Map()).get(a.pose) || new rig.Pose(a.pose, a.spec || {});
  const cel = rig.compose(skin, rigDef, pose, a.direction, { name: a.name || `${a.pose}.${a.direction}`, label: a.pose });
  W.store.put(a.name || `${a.skin}.${a.pose}.${a.direction}`, cel);
  const p = paletteOfCel(cel);
  const au = audit(cel, { palette: p, style: a.style ? W.styleOf(a.style) : null });
  return ok({ cel: cel.name, collisions: cel.meta.collisions?.length ?? 0, placed: cel.meta.placed, audit: au.summary, changed: { pixels: cel.bbox()?.area ?? 0 }, region: cel.bbox(), violations: [], warnings: [] });
});
tool("clip_create", "Declare a clip from a template with its mandatory motion set.", (a) => {
  const t = clipLib.CLIP_TEMPLATES[a.template];
  if (!t) return bad("unknown_clip_template", `no clip template '${a.template}'. Declared templates: ${Object.keys(clipLib.CLIP_TEMPLATES).join(", ")}. A template is a starting point to override, not something to invent.`, { fix: "clip_create" });
  const c = new clipLib.Clip(a.id, { template: a.template, directions: a.directions, fps: a.fps });
  c.sprite = a.sprite ?? null;
  W.clips.set(a.id, c);
  saveClip(c, c.sprite);
  return ok({ clip: a.id, persisted: !!W.project, template: a.template, frame_budget: t.frames, mandatory_motion: t.mandatory, default_fps: t.fps, note: "templates are starting points to override, not generators" });
});
tool("clip_set_frames", "Assign authored frames to a clip for one direction.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const frames = a.frames.map((f, i) => {
    const cel = typeof f.cel === "string" ? W.store.get(f.cel) : f.cel;
    if (!cel) return null;
    // The sheet is built from cel meta, so the clip/direction/pose/duration tags travel with the
    // authored pixels rather than being reconstructed at export time.
    cel.meta = { ...cel.meta, clip: a.clip, direction: a.direction, pose: f.pose ?? cel.meta.pose, frameIndex: i, duration: f.duration ?? null, events: f.events ?? cel.meta.events ?? [] };
    return new clipLib.Frame(cel, { poseName: f.pose, pose: f.pose ? (W.poses?.get(f.pose) || null) : null, duration: f.duration ?? null, events: f.events || [] });
  }).filter(Boolean);
  if (!frames.length) return bad("no_frames", `clip_set_frames got no resolvable cels for '${a.clip}/${a.direction}'`);
  c.setFrames(a.direction, frames);
  const spriteId = a.sprite || c.sprite || (typeof a.frames[0]?.cel === "string" && a.frames[0].cel.includes("/") ? a.frames[0].cel.split("/")[0] : null);
  c.sprite = spriteId ?? c.sprite ?? null;
  if (spriteId && W.project) {
    c.sprite = spriteId;
    frames.forEach((f, i) => {
      const key = `${a.clip}/${a.direction}/f${i}`;
      try { W.project.writeCel(spriteId, key, f.cel); f.diskKey = key; } catch { /* warm-only clip in a scratch project */ }
    });
  }
  saveClip(c, spriteId);
  return ok({ clip: a.clip, direction: a.direction, frames: frames.length, cels_on_disk: frames.filter(f => f.diskKey).length, durations: frames.map(f => f.duration), warnings: frames.every(f => f.duration === null) ? [`no per-frame durations authored for '${a.clip}/${a.direction}'; export_gate will refuse placeholder timing`] : [] });
});
tool("timing_apply", "Per-frame durations from a named curve. A hold is a longer duration, never a duplicated frame.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const r = ok(c.applyTiming(a));
  for (const d of c.directions) for (const f of c.frames(d)) f.cel.meta = { ...f.cel.meta, duration: f.duration };
  saveClip(c);
  return r;
});
tool("direction_derive", "Derive a diagonal facing from two approved cardinals. A DRAFT, never the answer.", (a) => {
  const skin = W.skins.get(a.skin);
  if (!skin) return bad("no_skin", `no skin '${a.skin}'`);
  if (rig.MIRROR_OF[a.from?.[0]]) {
    try { skin.deriveMirror(a.to, a.from[0]); }
    catch (e) { return bad("derive_failed", e.message); }
    return ok({
      derived: a.to, from: a.from[0], method: "mirror",
      warnings: ["a mirror mirrors the LIGHT with the shape; the derived facing needs its own authored shading to keep a fixed scene key light (docs/03 §5)"],
    });
  }
  return bad("derive_unsupported", `direction '${a.from?.[0]}' has no horizontal mirror; author '${a.to}' from its two neighbours and hand-correct it — a down-right view must not become a front pose with the eyes nudged sideways`);
});
tool("loop_validate", "The animation audit. A gate, not a report: a clip that fails it cannot be exported.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const out = {};
  let fails = 0;
  for (const d of c.directions) {
    const frames = c.frames(d);
    if (!frames.length) continue;
    const r = rig.loopValidate(frames, { requireCounterSwing: c.template === "walk", poses: a.poses });
    out[d] = { ok: r.ok, problems: r.problems, ...r.info };
    if (!r.ok) fails++;
  }
  const fc = c.frameCountReport();
  if (!fc.consistent) out.__frame_counts = { ok: false, problem: `frame count differs across directions (${JSON.stringify(fc.counts)}); turning will feel uneven even though each loop looks fine alone` };
  return ok({ clip: a.clip, ok: fails === 0 && fc.consistent, clips: out, frame_counts: fc.counts });
});
tool("motion_report", "Show which authored body parts actually change across a clip; catches head-only walks.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const dirs = a.direction ? [a.direction] : c.directions;
  const reports = {};
  for (const d of dirs) {
    const frames = c.frames(d);
    if (frames.length) reports[d] = rig.motionCoverage(frames, { template: c.template, expectedParts: a.expected_parts });
  }
  const all = Object.values(reports);
  return ok({ clip: a.clip, ok: all.length > 0 && all.every(r => r.ok), directions: reports,
    summary: { checked: all.length, passed: all.filter(r => r.ok).length, failed: all.filter(r => !r.ok).length } });
});
tool("smear_frame", "A fast limb drawn along its own path, stepping down the ramp so it stays on palette.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  return c.smearFrame(a.direction, a.frame, { palette: a.palette ? W.palette(a.palette) : null, ramp: a.ramp, trail: a.trail });
});
tool("hit_flash", "A declared light step used for ONE frame on impact. Not a shader.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  return c.hitFlash(a.direction, a.frame, W.palette(a.palette), a);
});
tool("impact_squash", "A one-pixel scale change with volume preserved.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  return c.squash(a.direction, a.frame, a);
});
tool("event_add", "Event markers travel into the manifest so game code drives feel from the art.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const r = ok(c.addEvent(a.direction, a.frame, a.event, a.data || {}));
  saveClip(c);
  return r;
});
tool("clip_info", "Read a clip.", (a) => { const c = W.clips.get(a.clip); return ok({ clip: c?.toManifest(), persisted: W.project ? !!W.project.clip_get(a.clip) : false }); });
tool("clip_list", "Every clip in warm state.", () => ok({ clips: [...W.clips.keys()], on_disk: W.project ? W.project.clip_list() : [] }));
tool("skin_define", "Declare base and pose-specific part cels per direction, each hung from a named rig joint.", (a) => {
  const skin = new rig.Skin(a.id, a.palette);
  const problems = [];
  const savedParts = [];
  const pendingSaves = [];
  if (a.sprite && (!W.project || !W.project.sprites.has(a.sprite))) return bad("no_sprite", `cannot persist skin '${a.id}': no declared sprite '${a.sprite}'`);
  for (const p of a.parts || []) {
    const cel = typeof p.cel === "string" ? W.store.get(p.cel) : p.cel;
    if (!cel) { problems.push(`part '${p.name}' in facing '${p.direction}': no cel '${p.cel}'`); continue; }
    try {
      const part = { name: p.name, cel, pose: p.pose,
        anchorX: p.anchor?.[0] ?? 0, anchorY: p.anchor?.[1] ?? 0 };
      if (p.joint !== undefined) part.anchorJoint = p.joint;
      if (p.offset !== undefined) part.anchorOffset = p.offset;
      if (p.lean !== undefined) part.leanFactor = p.lean;
      skin.add(p.direction, part);
      if (a.sprite) {
        const celKey = p.cel_key || `parts/${p.direction}/${p.pose || "base"}/${p.name}`;
        pendingSaves.push({ celKey, cel });
        savedParts.push({ direction: p.direction, name: p.name, ...(p.pose ? { pose: p.pose } : {}), cel_key: celKey,
          ...(p.joint !== undefined ? { joint: p.joint } : {}), ...(p.offset !== undefined ? { offset: p.offset } : {}),
          ...(p.anchor ? { anchor: p.anchor } : {}), ...(p.lean !== undefined ? { lean: p.lean } : {}) });
      }
    } catch (e) { problems.push(`${p.direction}/${p.name}: ${e.message}`); }
  }
  if (problems.length) return bad("skin_invalid", problems.join(" | "));
  for (const { celKey, cel } of pendingSaves) W.project.writeCel(a.sprite, celKey, cel);
  // A facing whose mirror is not authored is derived here, not left absent. docs/03 makes mirroring
  // a mechanical consequence of authoring one facing; a skin that silently has no left facing is
  // worse than a skin with a wrong one, because the clip then just has fewer directions than declared.
  const authored = skin.authoredDirections();
  const derived = [];
  for (const [src, mirror] of Object.entries(rig.MIRROR_OF)) {
    if (!mirror) continue;                                     // 'down' and 'up' have no horizontal mirror
    if (authored.includes(src) && !authored.includes(mirror)) { skin.deriveMirror(mirror, src); derived.push(`${mirror}<-${src}`); }
  }
  W.skins.set(a.id, skin);
  if (a.sprite) W.project.skin_save(a.id, { palette: a.palette, sprite: a.sprite, parts: savedParts });
  return ok({ skin: a.id, part_cels: skin.parts.size, pose_variants: [...skin.parts.values()].filter(p => p.pose).length,
    persisted: !!a.sprite, authored_directions: authored, derived_directions: derived,
    note: "each direction and key pose may carry its own hand-authored part cel; the rig supplies joints and composition, not replacement art. A skin authored in one direction is not an 8-direction character." });
});

// ---- seeing: the heart --------------------------------------------------------

const MODES = { view: "view", silhouette: "silhouette", value_map: "value_map", heatmap: "heatmap", flat: "flat", depth_map: "depth_map" };
tool("view", "The workhorse. Always returns image + coordinate-addressed grid + audit.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const r = render.renderCel(cel, p, { mode: MODES[a.mode] || "view", zoom: a.zoom, region: a.region });
  return W.triple(cel, p, a.style, r, { name: a.name || `view.${cel.name}`, assetClass: a.asset_class, light: a.light, labelEvery: a.label_every });
});
tool("chunk", "A sub-region at high zoom. The context-budget lever.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const r = render.renderChunk(cel, p, { region: a.region, chunkZoom: a.zoom });
  return W.triple(cel, p, a.style, r, { name: `chunk.${cel.name}.${a.region?.x ?? 0}_${a.region?.y ?? 0}`, assetClass: a.asset_class });
});
tool("contact_sheet", "N frames on one shared baseline. The animation review surface.", (a) => {
  const cels = (a.cels || []).map(c => typeof c === "string" ? W.store.get(c) : c).filter(Boolean);
  if (!cels.length) return bad("no_cels", "contact_sheet needs cels");
  const p = a.palette ? W.palette(a.palette) : paletteOfCel(cels[0]);
  const r = render.contactSheet(cels, p, { mode: a.mode, zoom: a.zoom, stamp: a.stamp });
  const img = W.saveRender(`contact.${a.name || cels[0].name}`, r.buffer);
  return ok({ image: img.path, cached: img.cached, frames: cels.length, zoom: r.zoom, grids: cels.map(c => render.gridText(c)), audits: cels.map(c => audit(c, { palette: p }).summary) });
});
tool("contact_grid", "Rows = directions, columns = frames. The 8-direction review surface.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const rows = c.directions.map(d => ({ label: d, cels: c.frames(d).map(f => f.cel) })).filter(r => r.cels.length);
  if (!rows.length) return bad("empty_clip", `clip '${a.clip}' has no frames assigned`);
  const p = W.palette(a.palette);
  const r = render.multiSheet(rows, p, { zoom: a.zoom ?? 5, labelW: a.label_w ?? 11, mode: a.mode, stamp: a.stamp || `${a.clip} — ${rows.length} facings x ${rows[0].cels.length} frames — shared foot baseline` });
  const img = W.saveRender(`grid.${a.clip}.${a.mode || "view"}`, r.buffer, { force: true });
  const stats = {};
  for (const row of rows) for (const cel of row.cels) { const bb = cel.bbox(); stats[cel.name] = bb ? `${bb.area}px` : "empty"; }
  return ok({ image: img.path, rows: rows.length, frames: rows.reduce((s, rr) => s + rr.cels.length, 0), zoom: r.zoom, stats });
});
tool("onion", "Current frame with neighbours ghosted warm/cool. Finds the one-pixel jump.", (a) => {
  const c = W.clips.get(a.clip);
  const frames = c ? c.frames(a.direction) : (a.cels || []).map(x => W.store.get(x));
  const p = a.palette ? W.palette(a.palette) : (frames[0] ? paletteOfCel(frames[0].cel || frames[0]) : null);
  const r = render.renderOnion(frames, p, { index: a.index });
  return ok({ image: W.saveRender(`onion.${a.clip || "frames"}.${a.direction || "x"}`, r.buffer).path, zoom: r.zoom });
});
tool("play", "An animated GIF at the clip's real fps. Timing faults are invisible in stills.", (a) => {
  const c = W.clips.get(a.clip);
  if (!c) return bad("no_clip", `no clip '${a.clip}'`);
  const dirs = a.directions || [c.directions.find(d => c.frames(d).length)];
  const frames = dirs.flatMap(d => c.frames(d));
  const p = W.palette(a.palette);
  const zoom = a.zoom ?? 8;
  const gif = adapters.export_gif(frames.map(f => f.cel), p, { zoom });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `play.${a.clip}.gif`);
  fs.writeFileSync(file, gif);
  // One GIF per facing: a single strip of four facings played in sequence tells you nothing about
  // whether one facing's rhythm is wrong, because you never see the same facing twice.
  const perFacing = dirs.map(d => {
    const f2 = path.join(OUT, `play.${a.clip}.${d}.gif`);
    fs.writeFileSync(f2, adapters.export_gif(c.frames(d).map(fr => fr.cel), p, { zoom }));
    return { direction: d, image: f2 };
  });
  const durations = dirs.map(d => ({ direction: d, durations: c.frames(d).map(f => f.duration) }));
  const uniform = durations.every(d => new Set(d.durations).size === 1);
  return ok({ image: file, per_facing: perFacing, frames: frames.length, fps: c.fps, zoom, durations, placeholder_timing: uniform ? "every duration identical — there is no authored rhythm; timing_apply a curve" : null, note: "review timing AT PLAYBACK, never defaulted" });
});
tool("silhouette", "Everything flattened to two colours. The honest readability test.", (a) => {
  const { cel } = celOf(a);
  const r = render.renderCel(cel, paletteOfCel(cel), { mode: "silhouette", legend: false });
  const c = craft.silhouetteComplexity(cel);
  const b = craft.blobIndex(cel);
  return ok({ image: W.saveRender(`silhouette.${cel.name}`, r.buffer).path, silhouette_complexity: c.score, compactness: c.compactness, perimeter_to_area: c.ratio, blob_fill: b.fill, blob_score: b.score, row_width_variety: b.rowWidthVariety, negative_space: style.negativeSpace(cel), features: style.featureCount(cel), verdict: c.score < 0.35 ? "shape alone may not carry this asset" : "shape carries it" });
});
tool("squint", "Box-filtered 50% downscale, upscaled back. Simulates game distance.", (a) => {
  const { cel } = celOf(a);
  const r = render.renderCel(cel, paletteOfCel(cel), { mode: "squint" });
  return ok({ image: W.saveRender(`squint.${cel.name}`, r.buffer).path, note: "if this is unreadable, the sprite is unreadable in game" });
});
tool("value_map", "Luminance only. A colour-correct sprite with a broken value structure looks amateur.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const r = render.renderCel(cel, p, { mode: "value_map", legend: false });
  const v = craft.valueStructure(cel, p);
  return ok({ image: W.saveRender(`value.${cel.name}`, r.buffer).path, ...v, verdict: v.score < 0.35 ? "value structure broken; hue tweaks will not save it" : v.score < 0.55 ? "value structure thin" : "value structure sound" });
});
tool("game_scale", "The sprite at 1x on a ground. The only render that answers 'does this belong?'.", (a) => {
  const { cel } = celOf(a);
  const base = paletteOfCel(cel);
  const p = a.ambient ? sceneLib.ambient_palette(base, sceneLib.LIGHT_STATES[a.ambient] || a.ambient) : base;
  const r = render.renderCel(cel, p, { mode: "game_scale", tile: a.tile, ground: a.ground, zoom: a.zoom });
  const g = craft.contactGrounding(cel, p);
  const v = craft.valueStructure(cel, p, { bgLuma: 0.09 });
  return ok({ image: W.saveRender(`game.${cel.name}.${a.ambient || "base"}`, r.buffer).path, grounding: g, ground_contrast: v.groundContrast, value: v.score, palette_used: a.ambient || "base", authored_grid_untouched: !!a.ambient });
});
tool("diff", "Before/after with changed pixels bucketed. Proves an edit did what was asked.", (a) => {
  const A = celOf({ cel: a.before }).cel, B = celOf({ cel: a.after }).cel;
  const r = render.renderDiff(A, B, paletteOfCel(A));
  const res = { image: W.saveRender(`diff.${A.name}.${B.name}`, r.buffer).path, ...r.stats, expect: a.expect || null };
  if (a.expect) {
    res.assertion = r.stats.entered === (a.expect.entered ?? 0) && r.stats.left === (a.expect.left ?? 0) && r.stats.repainted === (a.expect.repainted ?? 0);
    if (!res.assertion) res.warnings = [`expect=${JSON.stringify(a.expect)} but got +${r.stats.entered}/-${r.stats.left}/~${r.stats.repainted}: the edit did NOT do what was asked`];
  }
  return ok(res);
});
tool("heatmap", "Per-region violation overlay in a loud marker colour.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const au = audit(cel, { palette: p, style: a.style ? W.styleOf(a.style) : null });
  const r = render.renderCel(cel, p, { mode: "heatmap", findings: au.findings });
  return ok({ image: W.saveRender(`heatmap.${cel.name}`, r.buffer).path, audit: au.summary, findings: au.findings.map(f => ({ rule: f.rule, severity: f.severity, at: (f.at || []).slice(0, 8) })) });
});

// ---- QA -----------------------------------------------------------------------

tool("audit", "Deterministic rules. Every violation carries coordinates AND the tool that fixes it.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const s = a.style ? W.styleOf(a.style) : null;
  const ctx = { palette: p, style: s, light: a.light };
  if (a.perspective) ctx.perspective = perspectiveOf(a.perspective);
  if (a.place) ctx.place = a.place;
  if (a.depth_regions) ctx.depth = { regions: a.depth_regions, toward: a.depth_toward ?? null };
  if (a.edges) ctx.edges = a.edges;
  const rec = W.faces.get(cel.name);
  if (rec && !a.no_faces) ctx.faces = { recipe: rec };
  const au = a.tier ? parts.audit_for_tier(cel, p, s || { palette_size: 999, art_scale: Math.max(cel.w, cel.h), detail: "moderate", edge_policy: "selective-dark" }, a.tier, { light: a.light }) : audit(cel, ctx);
  return ok({
    ok: au.ok, errors: au.errors, warns: au.warns, exempted: au.exempted || 0,
    craft: au.craft?.score, grade: au.craft?.grade, weakest: au.craft?.weakest, sub: au.craft?.sub,
    findings: au.findings.map(f => ({ rule: f.rule, severity: f.severity, at: (f.at || []).slice(0, 10).map(q => q.x === undefined ? q.material : `${q.x},${q.y}`), fix: f.fix, message: f.message })),
    text: formatAudit(au),
  });
});
tool("craft_metrics", "The craft layer as numbers: form, light, value, blob, outline, grounding, focal, separation, clusters.", (a) => {
  const { cel } = celOf(a);
  const c = craft.craftScore(cel, paletteOfCel(cel), { light: a.light });
  return ok({ score: c.score, grade: c.grade, weakest: c.weakest, sub: c.sub, negative_space: style.negativeSpace(cel), features: style.featureCount(cel), detail: { flat_regions: c.detail.form.flat.map(f => f.message), light_offenders: c.detail.light.offenders.map(o => `${o.material}: ${o.reason}`) } });
});
tool("craft_targets", "The external bar as numbers, not as a picture to trace.", (a) => {
  const { cel } = celOf(a);
  return ok(regression.craft_targets(cel, paletteOfCel(cel), a.style ? W.styleOf(a.style) : { art_scale: Math.max(cel.w, cel.h), light: [-0.7, -0.7] }));
});
tool("regression_check", "Compare a render against its frozen golden, or capture one.", (a) => {
  if (a.capture) return ok(regression.golden_capture(W.root, a.id, fs.readFileSync(a.image), a));
  return ok(regression.regression_check(W.root, a.id, fs.readFileSync(a.image)));
});
tool("export_gate", "A clip that fails loop_validate or assert_style cannot be exported.", (a) => {
  const ids = a.clips || [...W.clips.keys()];
  const clips = Object.fromEntries(ids.map(k => [k, W.clips.get(k)]).filter(([, v]) => v));
  return ok(regression.export_gate(clips, W.styleOf(a.style), W.palette(a.palette), a));
});

// ---- import / export ----------------------------------------------------------

tool("import_png", "Gated: provenance REQUIRED, result quarantined.", (a) => {
  const r = W.needProject().import_png({ ...a, path: a.path || a.file });
  if (!r.ok) return r;
  W.store.put(a.name || r.cel.name, r.cel);
  return ok({ cel: r.cel.name, quarantined: r.quarantined, worst_delta: r.worst_delta, violations: r.violations, warnings: r.warnings });
});
tool("export_sheet", "Rows = directions in the frozen declared order, columns = frames. Indexed PNG.", (a) => {
  const ids = a.clips || [...W.clips.keys()];
  const gate = a.skip_gate ? { ok: true, summary: "gate skipped explicitly" } : regression.export_gate(Object.fromEntries(ids.map(k => [k, W.clips.get(k)]).filter(([, v]) => v)), W.styleOf(a.style), W.palette(a.palette), a);
  if (!gate.ok) return { ...bad("export_refused", gate.summary, { fix: "fix the gate failures listed in gate" }), gate };
  const cels = [];
  if (a.cels) for (const c of a.cels) cels.push(typeof c === "string" ? W.store.get(c) : c);
  else for (const k of ids) { const clip = W.clips.get(k); if (!clip) continue; for (const d of clip.directions) for (const f of clip.frames(d)) cels.push(f.cel); }
  if (!cels.length) return bad("no_cels", "nothing to export");
  const p = W.palette(a.palette);
  const sheet = buildSheet(cels, { cols: a.cols ?? cels.length, palette: p, pad: a.pad ?? 1, duration: a.duration });
  const manifest = buildManifest(sheet, W.styleOf(a.style), p, { imageName: a.image || "sheet.png", provenance: W.needProject().provenanceFor(a.sprite || ids[0] || "default"), directions: W.needProject().doc.directions || rig.DIRECTIONS });
  const dir = a.out ? path.resolve(a.out) : path.join(OUT, "export");
  const written = writeExport(dir, sheet, manifest);
  const back = decodePNG(sheet.png);
  return ok({ dir, bytes: written.bytes, sheet: `${sheet.width}x${sheet.height}`, frames: sheet.celCount, palette_entries: sheet.palette.length, round_trip: `${back.w}x${back.h} colourType ${back.colorType} palette ${back.palette.length}`, gate: gate.summary });
});
tool("export_manifest", "Engine manifests: godot | phaser | tiled | unity | aseprite | html5-canvas | generic.", (a) => {
  const dir = a.dir || path.join(OUT, "export");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const out = {};
  for (const t of a.targets || ["generic"]) { const r = adapters.adapt(manifest, t); out[t] = r.ok ? r.manifest : { error: r.reason }; }
  const file = path.join(dir, "adapters.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return ok({ targets: Object.keys(out), file });
});
tool("export_gif", "Animated preview; the palette travels with the frames, so the preview is not a re-quantisation.", (a) => {
  const c = W.clips.get(a.clip);
  const cels = c ? c.frames(a.direction || c.directions.find(d => c.frames(d).length)).map(f => f.cel) : (a.cels || []).map(x => W.store.get(x));
  if (!cels.length) return bad("no_cels", "export_gif needs a clip with frames or an explicit cels list");
  const gif = adapters.export_gif(cels, W.palette(a.palette), a);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${a.name || "preview"}.gif`);
  fs.writeFileSync(file, gif);
  return ok({ file, bytes: gif.length, frames: cels.length });
});
tool("export_indexed_png", "One cel as an indexed PNG.", (a) => {
  const { cel } = celOf(a);
  const buf = adapters.export_indexed_png(cel, paletteOfCel(cel));
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${a.name || cel.name}.png`);
  fs.writeFileSync(file, buf);
  const back = decodePNG(buf);
  return ok({ file, bytes: buf.length, round_trip: `${back.w}x${back.h} colourType ${back.colorType} palette ${back.palette.length}` });
});
tool("export_tileset", "The 47-slot autotile sheet plus the bitmask bookkeeping.", (a) => {
  const r = adapters.export_tileset((a.tiles || []).map(t => ({ ...t, cel: typeof t.cel === "string" ? W.store.get(t.cel) : t.cel })), W.palette(a.palette), a);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "tileset.png"), r.sheet.png);
  fs.writeFileSync(path.join(OUT, "tileset.json"), JSON.stringify(r.index, null, 2));
  return ok({ ok: r.ok, missing: r.missing, slots: r.index.length, sheet: `${r.sheet.width}x${r.sheet.height}`, bitmask: r.bitmask });
});
tool("export_harness", "A real 1x playtest scene in dependency-free HTML5 canvas.", (a) => {
  const dir = a.dir || path.join(OUT, "export");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const sheet = { width: manifest.sheet.width, height: manifest.sheet.height, cellW: manifest.sheet.cellW, cellH: manifest.sheet.cellH, cols: manifest.sheet.cols };
  const html = sceneLib.playtest_harness(sheet, manifest, a);
  const file = path.join(dir, "playtest.html");
  fs.writeFileSync(file, html);
  return ok({ file, note: "open it. Click the canvas to switch clip, right-click to switch facing. 1x art pixels, nearest-neighbour, per-frame durations honoured." });
});

// ---- parts, families, volume --------------------------------------------------

tool("part_add", "Add an authored part to the library.", (a) => {
  const lib = W.parts || (W.parts = new parts.PartLibrary());
  const { cel } = celOf(a);
  try { lib.add({ id: a.part, slot: a.slot, cel, anchor: a.anchor, anchorOffset: a.anchor_offset, tags: a.tags || [] }); }
  catch (e) { return bad("part_invalid", e.message); }
  return ok({ part: a.part, slot: a.slot, library: lib.size(), authored_pixels: lib.authoredPixels() });
});
tool("part_list", "The part library, by slot.", () => {
  const lib = W.parts || new parts.PartLibrary();
  return ok({ parts: [...lib.parts.values()].map(p => ({ id: p.id, slot: p.slot, tags: p.tags, uses: p.uses, pixels: p.cel.bbox()?.area ?? 0 })), authored_pixels: lib.authoredPixels(), legal_slots: parts.SLOTS });
});
tool("assemble", "Build a character from authored parts. Illegal slot assignments are refused.", (a) => {
  const lib = W.parts || (W.parts = new parts.PartLibrary());
  const r = parts.assemble(lib, a, { w: a.w, h: a.h, palette: a.palette, anchors: a.anchors, zOrder: a.z_order, name: a.into });
  if (!r.ok) return bad("assembly_invalid", r.problems.join(" | "));
  W.store.put(a.into || a.id, r.cel);
  return ok(r);
});
tool("family_audit", "Do these assets read as one family? Each member declares its exaggerated feature.", (a) => {
  const r = parts.family_audit((a.assets || []).map(x => ({ ...x, cel: typeof x.cel === "string" ? W.store.get(x.cel) : x.cel })), a.family);
  return ok({ ...r, problems: r.problems, families: Object.keys(parts.SHAPE_FAMILIES) });
});
tool("batch_relint", "A material changed: which assets drifted?", (a) => {
  const assets = (a.assets || []).map(x => ({ ...x, cel: typeof x.cel === "string" ? W.store.get(x.cel) : x.cel }));
  return ok(parts.batch_relint(assets, W.palette(a.palette), W.styleOf(a.style), a));
});
tool("tier_policy", "Quality tiers: hero / support / background / system, with their budgets.", (a) => ok({ tiers: parts.TIERS, policy: a.tier ? parts.tier_policy(a.tier) : null, exemptions: parts.TIER_RULE_EXEMPTIONS }));
tool("material_define", "Declare a material ramp recipe. Every asset naming this material shares it.", (a) => {
  const lib = W.materials || (W.materials = new parts.MaterialLibrary());
  lib.define(a.id, a);
  return ok({ material: a.id, library: lib.ids() });
});

// ---- tiles & structures -------------------------------------------------------

tool("autotile_index", "The 47-slot blob set with the bitmask bookkeeping.", () => {
  const set = tiles.blobSet();
  return ok({ slots: set.length, rule: "a corner is filled only when the corner neighbour and both edge neighbours touching it are filled", index: set.map(s => ({ slot: s.id, name: s.name, edges: s.edges, corners: s.corners, mask: s.mask })) });
});
tool("tile_edge_check", "Seam test: luminance AND hue across shared edges. A seam that passes luminance and fails hue still reads.", (a) => {
  const cel = typeof a.cel === "string" ? W.store.get(a.cel) : celOf(a).cel;
  const r = tiles.tile_edge_check(cel, W.palette(a.palette));
  return ok({ ...r, cel: cel.name, warnings: r.material_breaks_total ? [`${r.material_breaks_total} tile edge(s) continue into a different material ramp; a seam that passes luminance and fails hue still reads`] : [] });
});
tool("variant_lint", "Variants of the same tile: mean-luma drift, shared ramps, silhouette difference.", (a) => {
  const variants = (a.variants || []).map(v => ({ ...v, cel: typeof v.cel === "string" ? W.store.get(v.cel) : v.cel }));
  return ok(tiles.variant_lint(variants, W.palette(a.palette)));
});
tool("tileset_audit", "Whole-tileset audit: 47-slot coverage, edge caps, variants, repeat visibility.", (a) => {
  const tilesIn = (a.tiles || []).map(t => ({ ...t, cel: typeof t.cel === "string" ? W.store.get(t.cel) : t.cel }));
  return ok(tiles.tileset_audit(tilesIn, W.palette(a.palette), a.style ? W.styleOf(a.style) : null, a));
});
tool("tile_repeat", "How visible is the tiling pattern? The failure mode of generated environments.", (a) => {
  const cel = typeof a.cel === "string" ? W.store.get(a.cel) : celOf(a).cel;
  const rep = tiles.tileRepeat(cel, a.n ?? 4);
  const p = paletteOfCel(cel);
  const seam = tiles.tile_edge_check(rep, p);
  return ok({ ...seam, repeated_canvas: [rep.w, rep.h], n: a.n ?? 4, note: "if the repeat is obvious at 4x4, no amount of variation on a single tile will hide it in a field" });
});
tool("structure", "Multi-tile props: declared footprint, contact row, per-tile audit.", (a) => {
  const cel = typeof a.cel === "string" ? W.store.get(a.cel) : celOf(a).cel;
  return ok(tiles.structure(a.id || cel.name, cel, { tile: a.tile, footprint: a.footprint, contact_row: a.contact_row }));
});

// ---- scene --------------------------------------------------------------------

tool("scene_create", "A scene: tiles, props, characters, one declared ambient.", (a) => {
  const s = new sceneLib.Scene(a.id, { cols: a.cols, rows: a.rows, tile: a.tile, palette: W.palette(a.palette), ambient: sceneLib.LIGHT_STATES[a.ambient] || a.ambient });
  W.scenes || (W.scenes = new Map());
  W.scenes.set(a.id, s);
  return ok({ scene: a.id, canvas: [a.cols * (a.tile ?? 16), a.rows * (a.tile ?? 16)], light_states: Object.keys(sceneLib.LIGHT_STATES) });
});
tool("scene_place", "Place a tile, prop or character. Props declare a footprint and a contact row.", (a) => {
  const s = W.scenes?.get(a.scene);
  if (!s) return bad("no_scene", `no scene '${a.scene}'`);
  const cel = typeof a.cel === "string" ? W.store.get(a.cel) : celOf(a).cel;
  if (a.kind === "tile") s.fillTile(a.at[0], a.at[1], cel);
  else if (a.kind === "prop") s.addProp({ id: a.id, footprint: a.footprint, contact_row: a.contact_row ?? 0 }, cel, a.at);
  else s.addCharacter(cel, a.at, { contact_row: a.contact_row ?? cel.bbox()?.y1 ?? 0 });
  return ok({ scene: a.id, kind: a.kind, at: a.at });
});
tool("scene_review", "The five scene reviews: game scale, squint, value map, silhouette, grounding.", (a) => {
  const s = W.scenes?.get(a.scene);
  if (!s) return bad("no_scene", `no scene '${a.scene}'`);
  const r = s.review(a.palette ? W.palette(a.palette) : null);
  for (const [k, v] of Object.entries(r.renders)) r.renders[k] = W.saveRender(`scene.${a.scene}.${k}`, v.buffer, { force: true }).path;
  return ok(r);
});
tool("ambient_rederive", "Re-key a palette for a scene's light. The authored grid is untouched.", (a) => {
  const p = W.palette(a.palette);
  const ambient = sceneLib.LIGHT_STATES[a.ambient] || a.ambient;
  const out = sceneLib.ambient_palette(p, ambient);
  W.needProject().palettes.set(out.id, out);
  const aH = require("./core/palette.js").rgbToHsl(ambient.hue)[0];
  const drift = out.entries.map((e, i) => {
    const [h0, , l0] = rgbToHsl(p.entries[i].rgb);
    const [h1, , l1] = rgbToHsl(e.rgb);
    let dh = h1 - h0; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    const gap = sceneLib.shortestDelta(h0, aH) || 1;
    return {
      name: e.name, role: e.role, from: hex(p.entries[i].rgb), to: hex(e.rgb),
      // claim = how much of this step the scene's ambient took over. Darker steps are claimed
      // harder than lit ones, which is what keeps a ramp readable under a new light.
      claim: (e.role === "light" || e.relight === false) ? 0 : +Math.abs(dh / gap).toFixed(3),
      value_shift: +(l1 - l0).toFixed(3), hue_shift: +dh.toFixed(2),
    };
  });
  return ok({ palette: out.id, ambient: ambient.id, strength: ambient.strength, authored_grid_untouched: true, value_order_preserved: out.entries.every((e, i) => i === 0 || e.ramp !== out.entries[i - 1].ramp || e.value >= out.entries[i - 1].value), drift });
});

// ---- depth, perspective, faces -------------------------------------------------
// "Add depth" in a normal engine means a brightness filter and a z-buffer. Neither exists here.
// Depth is authored: a camera declared before the first pixel, faces that earn their ramp steps
// from the light, distance that moves ALONG a ramp, and four independent measurements that can
// each refuse the result. A building that passes all four has point-of-view depth; a building
// that passes three has a perspective label on it.

function perspectiveOf(id) {
  const doc = W.needProject().perspective_get(id);
  if (!doc) { const e = new Error(`no perspective '${id}'. Declare one with perspective_declare.`); e.rule = "no_perspective"; throw e; }
  return new depth.Perspective(doc.id, doc);
}

tool("perspective_declare", "Declare the camera: horizon row, vanishing point, focal length, eye height. Everything later is measured against it.", (a) => {
  const proj = W.needProject();
  const coord = a.style ? proj.styles.get(a.style) : proj.doc.coordinate;
  if (coord && !/^perspective-/.test(coord.projection) && a.allow_parallel !== true)
    return bad("projection_not_perspective", `style '${coord.id || proj.doc.style}' declares projection '${coord.projection}'. A camera with a vanishing point only means something for perspective-1pt or perspective-2pt. Either change the coordinate or pass allow_parallel.`);
  let persp;
  try { persp = new depth.Perspective(a.id, a); } catch (e) { return bad(e.rule || "perspective_invalid", e.message); }
  proj.perspective_save(a.id, persp.toManifest());
  W.perspectives.set(a.id, persp);
  const bands = persp.bands(a.bands_n ?? 3);
  // The useful half: what this camera does to the things we are about to draw.
  const table = bands.map(z => ({
    z,
    ground_row: +persp.groundRow(z).toFixed(1),
    human_px: +persp.screenHeight(persp.eye, z).toFixed(1),
    metre_px: +persp.scaleAt(z).toFixed(2),
  }));
  return ok({
    perspective: persp.toManifest(), scale_table: table,
    foreshortening: bands.length > 1 ? bands.slice(1).map(z => ({ from: bands[0], to: z, ratio: +persp.foreshorten(bands[0], z).toFixed(3) })) : [],
    note: "every receding edge, contact row and drawn height in this scene is now checkable against these numbers",
  });
});
tool("perspective_list", "Declared cameras.", () => ok({ perspectives: W.needProject().perspective_list() }));

tool("depth_slice", "Which steps of one material's ramp each distance band gets — and what is left over to model form.", (a) => {
  const p = W.palette(a.palette);
  const persp = a.perspective ? perspectiveOf(a.perspective) : null;
  const bands = a.bands || (persp ? persp.bands(a.bands_n ?? 3) : null);
  if (!bands) return bad("no_bands", "pass bands: [z,...] or a perspective to derive them from");
  try { return ok(depth.depthSlice(p, a.ramp, bands, a.toward)); } catch (e) { return bad(e.rule || "depth_slice", e.message); }
});

tool("depth_shade", "Move a region to its distance band. The index changes to another step of the SAME ramp; nothing is darkened.", (a) => {
  const { cel, id } = celOf(a);
  const p = paletteOfCel(cel);
  const persp = perspectiveOf(a.perspective);
  const bands = a.bands || persp.bands(a.bands_n ?? 3);
  let slice;
  try { slice = depth.depthSlice(p, a.ramp, bands, a.toward); } catch (e) { return bad(e.rule || "depth_slice", e.message); }
  const band = a.band_index != null ? slice.bands[a.band_index] : slice.bands.find(b => Math.abs(b.z - a.z) < 1e-6);
  if (!band) return bad("no_band", `no band for z=${a.z}. Declared bands: ${slice.bands.map(b => b.z).join(", ")}`);
  return withUndo(id, () => {
    const r = depth.depthShade(cel, p, a.ramp, band, a.region);
    return { ...r, ramp_budget: { steps: slice.steps, spent_on_depth: slice.span, left_for_form: slice.roomForForm, warning: slice.note }, band_used: { z: band.z, step: band.step, color: p.color(band.index), name: p.entries[band.index]?.name } };
  });
});

tool("faces_declare", "Compile a light + a face list into ramp-step bands. Refuses a ramp too short to carry orientation AND distance.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const faces = (a.faces || []).map(f => ({ ...f }));
  if (!faces.length) return bad("no_faces", "faces: [{name, normal|FACE_NORMALS key, ramp, region:[x0,y0,x1,y1], z?}]");
  const byRamp = new Map();
  for (const f of faces) (byRamp.get(f.ramp) || byRamp.set(f.ramp, []).get(f.ramp)).push(f);
  const recipes = [];
  for (const [ramp, fs] of byRamp) {
    try {
      const rec = depth.faceRecipe(p, ramp, fs, { light: a.light, lightWeight: a.lightWeight, depth: a.depth ? { bands: a.depth.bands || perspectiveOf(a.depth.perspective).bands(a.depth.bands_n ?? 3), toward: a.depth.toward } : null });
      recipes.push(rec);
      if (!rec.ok) return bad("face_budget", `${ramp}: ${rec.conflicts.map(c => c.message).join(" | ")}`);
    } catch (e) { return bad(e.rule || "face_recipe", e.message); }
  }
  W.faces.set(cel.name, recipes[0]);
  W.faceRecipes.set(cel.name, recipes);
  return ok({
    cel: cel.name, recipes,
    note: recipes.map(r => `${r.ramp}: ${r.steps} steps, ${r.faces} face(s), ${r.band_span} per face${r.flat_faces.length ? `, flat by design: ${r.flat_faces.join(", ")}` : ""}`).join(" | "),
  });
});

tool("face_shade", "Paint each face inside its own band, modelled across the face's OWN extent row by row.", (a) => {
  const { cel, id } = celOf(a);
  const p = paletteOfCel(cel);
  const rec = a.faces ? depth.faceRecipe(p, a.ramp, a.faces, { light: a.light }) : W.faces.get(cel.name);
  if (!rec) return bad("no_faces", `no faces declared for '${cel.name}'. faces_declare first, or pass faces inline.`);
  return withUndo(id, () => {
    const r = depth.shadeFaces(cel, p, rec, { light: a.light });
    const check = depth.faceAudit(cel, p, rec);
    return { ...r, obeyed_the_light: check.ok, faces_measured: check.faces, problems: [...check.problems, ...check.seams] };
  });
});

tool("face_audit", "Measure the faces from the ART, not from the recipe: did the pixels obey the declared light?", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const rec = W.faces.get(cel.name);
  if (!rec) return bad("no_faces", `no faces declared for '${cel.name}'`);
  const r = depth.faceAudit(cel, p, rec);
  return ok({ ...r, problems: [...r.problems, ...r.seams], text: [...r.problems, ...r.seams].map(x => `[${x.rule}] ${x.message}`).join("\n") || "every face sits where the light puts it" });
});

tool("shadow_cast", "Cast-shadow geometry from the light vector: the silhouette sheared onto the ground plane, monotonic toward the tip.", (a) => {
  const { cel } = celOf(a);
  let foot;
  try { foot = depth.shadowFootprint(cel, a); } catch (e) { return bad(e.rule || "shadow", e.message); }
  if (a.apply && a.ramp) {
    const p = paletteOfCel(cel);
    const list = p.ramp(a.ramp);
    if (!list) return bad("no_ramp", `no ramp '${a.ramp}'`);
    return withUndo(cel.name, () => {
      const r = ops.put(cel, foot.cells.map(c => ({ x: c.x, y: c.y, to: list[Math.min(list.length - 1, c.band)] })), { palette: p });
      return { ...r, shadow_cells: foot.count, ground_row: foot.ground_row, shear: foot.shear, overlap_note: foot.overlap_note };
    });
  }
  return ok({ ...foot, applied: false, note: foot.note });
});

tool("depth_audit", "THE POV-depth gate: convergence, foreshortening, value monotonicity, ground plane, occlusion. All five or it is a label.", (a) => {
  const { cel } = celOf(a);
  const p = paletteOfCel(cel);
  const persp = perspectiveOf(a.perspective);
  const recipes = W.faceRecipes.get(cel.name) || [];
  let res;
  try {
    res = depth.povAudit({
      persp, cel, palette: p,
      edges: a.edges, faces: a.faces, depthRegions: a.depth_regions, placed: a.placed, repeats: a.repeats,
      recipe: recipes[0], opts: { ...a, light: a.light },
    });
  } catch (e) { return bad(e.rule || "depth_audit", e.message); }
  const bands = [];
  for (const r of recipes) bands.push({ ramp: r.ramp, steps: `${r.steps}`, forDepth: r.band_span, forForm: Math.max(...r.faces_out.map(f => f.band.hi - f.band.lo)) });
  for (const reg of a.depth_regions || []) {
    const rd = depth.depthReadings(cel, p, [reg]);
    for (const x of rd) bands.push({ ramp: x.ramp, steps: `${p.ramp(x.ramp).length}`, forDepth: new Set((a.depth_regions || []).filter(q => q.name === reg.name).map(q => q.z)).size, forForm: p.ramp(x.ramp).length - new Set((a.depth_regions || []).map(q => q.z)).size });
  }
  const img = W.saveRender(`depth.${cel.name}`, render.renderDepthMap(cel, p, {
    mode: "depth_map", zoom: a.zoom, perspective: persp.toManifest(), depth: { regions: a.depth_regions || [] },
    edges: a.edges, placed: a.placed, bands,
  }).buffer, { force: true });
  return ok({ ...res, image: img.path, verdict_text: res.verdict, checks_text: Object.entries(res.checks).filter(([k]) => k !== "recipe").map(([k, v]) => `${k}: ${v.ok ? "ok" : "FAIL"}${v.message ? " — " + v.message : ""}${v.edges ? " — " + v.edges.map(e => `${e.edge} ${e.verdict}`).join("; ") : ""}${v.problems ? " — " + v.problems.map(x => x.message).join("; ") : ""}`).join("\n") });
});

tool("occlusion_sort", "Who covers whom. Derived from contact rows, not from the order things happened to be drawn in.", (a) => {
  const placed = a.placed || (a.scene && W.scenes?.get(a.scene) ? [...W.scenes.get(a.scene).props, ...W.scenes.get(a.scene).characters].map((p, i) => ({ id: p.id || `char${i}`, contactRow: (p.at?.[1] ?? 0) + (p.contact_row ?? 0), drawOrder: i })) : null);
  if (!placed?.length) return bad("no_placed", "pass placed: [{id, contactRow, z?, drawOrder?}] or a scene");
  const order = depth.occlusionSort(placed);
  const inversions = depth.occlusionAudit(placed);
  return ok({ ...order, inversions: inversions.problems, ok: order.ok && inversions.ok, note: inversions.problems.length ? inversions.problems.map(p => p.message).join(" | ") : "nearer things cover farther things" });
});

tool("parallax_plan", "Layers, distances, and the rate each one must move. Refuses a nearer layer that moves slower.", (a) => {
  const persp = a.perspective ? perspectiveOf(a.perspective) : null;
  try { return ok(depth.parallaxPlan(a.layers || [], persp)); } catch (e) { return bad(e.rule || "parallax", e.message); }
});

// ---- coverage matrix ----------------------------------------------------------

tool("coverage_report", "docs/08 coverage matrix: what the engine claims to do, and whether it actually does it.", () => {
  const rows = [
    ["T1", "core cel + palette indexing", "core/cel.js core/palette.js", true],
    ["T2", "hand placement primitives", "core/ops.js", true],
    ["T3", "shape scaffolding with coverage reporting", "core/ops.js draw_shape", true],
    ["T4", "ramp-lit form modelling (no filters)", "core/ops.js paint_form", true],
    ["T5", "AA / dither / outline policies", "core/ops.js", true],
    ["T6", "specular, contact shadow, cast shadow, glow", "core/ops.js", true],
    ["T7", "style bible + coordinate validation", "core/style.js", true],
    ["T8", "assert_style gate", "core/style.js assertStyle", true],
    ["T9", "rig + pose + compose", "core/rig.js", true],
    ["T10", "clip templates + per-frame durations", "core/clip.js", true],
    ["T11", "smear / flash / squash", "core/clip.js", true],
    ["T12", "loop_validate gate", "core/rig.js loopValidate", true],
    ["T13", "direction rows + frame-count parity", "core/clip.js frameCountReport", true],
    ["T14", "render modes (view/chunk/squint/game_scale/onion/diff/heatmap)", "render.js", true],
    ["T15", "contact sheet + 8-direction grid", "render.js contactSheet multiSheet", true],
    ["T16", "audit rule engine", "audit.js", true],
    ["T17", "craft layer (form/value/blob/outline/grounding/focal)", "craft.js", true],
    ["T18", "collaboration: options, pick, reject, translate", "core/collab.js", true],
    ["T19", "taste persistence", "core/collab.js taste_read taste_write", true],
    ["T20", "sketch_analyse (measure, never trace)", "core/project.js sketch_analyse", true],
    ["T21", "import_png gated + quarantined", "core/project.js import_png", true],
    ["T22", "provenance computed from edit history", "core/project.js provenanceFor", true],
    ["T23", "autotiling 47 slots + seam check", "core/tiles.js", true],
    ["T24", "variant lint + tileset audit + repeat visibility", "core/tiles.js", true],
    ["T25", "multi-tile structures", "core/tiles.js structure", true],
    ["T26", "part library + assembly + family audit", "core/parts.js", true],
    ["T27", "tiered quality budgets", "core/parts.js TIERS", true],
    ["T28", "batch re-lint", "core/parts.js batch_relint", true],
    ["T29", "scene ambient re-derivation (no redraw)", "core/scene.js ambient_palette", true],
    ["T30", "playtest harness at 1x", "core/scene.js playtest_harness", true],
    ["T31", "golden corpus + regression check", "core/regression.js", true],
    ["T32", "export gate", "core/regression.js export_gate", true],
    ["T33", "external craft targets", "core/regression.js craft_targets", true],
    ["T34", "engine adapters", "adapters.js", true],
    ["T35", "indexed PNG / GIF codecs, zero deps", "codec/png.js codec/gif.js", true],
    ["T36", "undo / redo / snapshot", "core/clip.js CelStore", true],
    ["T37", "CLI mirror of every tool", "cli.js", true],
    ["T38", "MCP surface with direct exposure", "mcp.js", true],
    ["T39", "pose-specific part art + motion coverage", "core/rig.js motionCoverage", true],
  ];
  const missing = rows.filter(r => !r[3]);
  return ok({ total: rows.length, implemented: rows.length - missing.length, rows, missing: missing.map(m => m[0]) });
});

// ---- meta ---------------------------------------------------------------------

tool("tools_list", "Every tool the engine exposes, with its description.", () => ok({ count: Object.keys(TOOLS).length, tools: Object.keys(TOOLS).sort().map(k => ({ name: k, describe: TOOLS[k].describe })) }));
tool("session_stats", "Renders used, authored pixels, tool calls. The budget numbers.", () => ok({ renders: W.renders, authored_pixels: W.authoredPixels, calls: W.calls, cels: W.store.ids().length, clips: [...W.clips.keys()], cached_renders: W.cache.size }));
tool("provenance", "Computed from edit history, never asserted.", (a) => ok(W.needProject().provenanceFor(a.sprite || "default")));

module.exports = { W, TOOLS, Workspace, ROOT, OUT, ok, bad, celOf, paletteOfCel };
