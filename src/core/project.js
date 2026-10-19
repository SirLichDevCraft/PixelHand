// The disk layer. Disk is the source of truth; MCP is only the fast loop.
//
// Everything here is git-tracked text: sprite documents, style bibles, palettes, rigs,
// clips and cels as grid files. A character is not one session's work, so a session must be
// able to resume cold, and a sprite change must be reviewable as a diff.
//
// Provenance is COMPUTED from edit history, never asserted by the caller (docs/07 §2.2).
// A cel that received an import cannot report imported_pixels: 0.
"use strict";

const fs = require("fs");
const path = require("path");
const { Cel } = require("./cel.js");
const { Palette } = require("./palette.js");
const { validateCoordinate } = require("./style.js");
const { DIRECTIONS } = require("./rig.js");
const { decodePNG } = require("../codec/png.js");
const storage = require("./storage.js");

const ENGINE = `pixelhand ${require("../../package.json").version}`;

const artRoot = (root) => path.join(root, "art");
const ensure = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = storage.writeJSON;

class Project {
  constructor(root, doc = null) {
    this.root = root;
    this.doc = doc;
    this.palettes = new Map();
    this.styles = new Map();
    this.sprites = new Map();
    this.rigs = new Map();
    this.skins = new Map();
    this.clips = new Map();
    this.perspectives = new Map();   // camera declarations: horizon, vanishing point, focal, eye
    this.history = new Map();      // celId -> [{ op, pixels, imported, at }]  — provenance source
  }

  // ---- lifecycle --------------------------------------------------------------

  static init(root, spec) {
    const p = new Project(root);
    const coord = validateCoordinate(spec.style);
    if (!coord.ok) return { ok: false, errors: coord.errors, warnings: coord.warnings };
    p.doc = {
      id: spec.game,
      created: new Date().toISOString(),
      engine: ENGINE,
      style: spec.style.id,
      canvas: spec.canvas ?? { w: 16, h: 24 },
      directions: spec.directions ?? [...DIRECTIONS],
      fps: spec.fps ?? 12,
      coordinate: spec.style,
      coordinate_warnings: coord.warnings,
    };
    ensure(artRoot(root));
    for (const sub of ["styles", "palettes", "sprites", "rigs", "skins", "clips", "perspectives", "export", "quarantine"]) ensure(path.join(artRoot(root), sub));
    writeJSON(path.join(artRoot(root), "project.json"), p.doc);
    // The coordinate IS the bible: declaring a project declares its style, so every later tool
    // has something to assert against instead of inventing one.
    p.style_create(spec.style.id, spec.style);
    return { ok: true, project: p, id: spec.game, warnings: coord.warnings, bible: p.styles.get(spec.style.id), conventions: { directions: p.doc.directions, fps: p.doc.fps, canvas: p.doc.canvas } };
  }

  static open(root) {
    const doc = readJSON(path.join(artRoot(root), "project.json"));
    const p = new Project(root, doc);
    p.loadAll();
    return p;
  }

  loadAll() {
    const base = artRoot(this.root);
    // A record on disk with no name is not an asset, it is damage. Loading it used to hand the registry
    // an entry keyed "undefined" that then appeared in style_list as a legitimate coordinate.
    this.loadWarnings = [];
    for (const dir of ["palettes", "styles"]) {
      const d = path.join(base, dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter(f => f.endsWith(".json"))) {
        const spec = readJSON(path.join(d, f));
        if (!spec || typeof spec.id !== "string" || !spec.id.trim()) {
          this.loadWarnings.push({ file: `${dir}/${f}`, rule: "record_has_no_id", message: `${dir} record '${f}' declares no id; it is skipped rather than loaded as an asset` });
          continue;
        }
        if (dir === "palettes") this.palettes.set(spec.id, Palette.fromSpec(spec.id, spec));
        else this.styles.set(spec.id, spec);
      }
    }
    const sd = path.join(base, "sprites");
    if (fs.existsSync(sd)) {
      for (const id of fs.readdirSync(sd)) {
        const docPath = path.join(sd, id, "sprite.json");
        if (!fs.existsSync(docPath)) continue;
        this.sprites.set(id, readJSON(docPath));
      }
    }
    // Rigs and clips are git-tracked text too. A session that ends mid-animation must be
    // resumable, which means the rig and the clip survive the process that made them.
    for (const [dir, store] of [["rigs", this.rigs], ["clips", this.clips], ["perspectives", this.perspectives]]) {
      const d = path.join(base, dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter(f => f.endsWith(".json"))) {
        const doc = readJSON(path.join(d, f));
        if (doc?.id) store.set(doc.id, doc);
      }
    }
    const skinDir = path.join(base, "skins");
    if (fs.existsSync(skinDir)) for (const f of fs.readdirSync(skinDir).filter(f => f.endsWith(".json"))) {
      const spec = readJSON(path.join(skinDir, f));
      if (spec && typeof spec.id === "string" && spec.id.trim()) this.skins.set(spec.id, spec);
      else this.loadWarnings.push({ file: `skins/${f}`, rule: "record_has_no_id", message: `skin '${f}' declares no id; it is skipped` });
    }
    this.loadHistory();
    return this;
  }

  // ---- rigs & clips -----------------------------------------------------------

  rig_save(id, doc) {
    const full = { ...doc, id };
    this.rigs.set(id, full);
    writeJSON(storage.within(this.root, "art", "rigs", `${id}.json`), full);
    return full;
  }
  // A camera is git-tracked text too. A building authored against a horizon that a later session
  // cannot read back is a building whose perspective cannot be re-audited.
  perspective_save(id, doc) {
    const full = { ...doc, id };
    this.perspectives.set(id, full);
    writeJSON(storage.within(this.root, "art", "perspectives", `${id}.json`), full);
    return full;
  }
  perspective_get(id) { return this.perspectives.get(id) || null; }
  perspective_list() { return [...this.perspectives.values()].map(p => ({ id: p.id, projection: p.projection, horizon: p.horizon, vanishing: p.vanishing, focal: p.focal, eye: p.eye })); }

  rig_get(id) { return this.rigs.get(id) || null; }
  rig_list() { return [...this.rigs.values()].map(r => ({ id: r.id, directions: Object.keys(r.anchors || {}), baseline: r.baseline })); }

  skin_save(id, doc) {
    const full = { ...doc, id };
    this.skins.set(id, full);
    writeJSON(storage.within(this.root, "art", "skins", `${id}.json`), full);
    return full;
  }
  skin_get(id) { return this.skins.get(id) || null; }
  skin_list() { return [...this.skins.values()].map(s => ({ id: s.id, palette: s.palette, sprite: s.sprite, parts: s.parts?.length ?? 0 })); }

  clip_save(id, doc) {
    const full = { ...doc, id };
    this.clips.set(id, full);
    writeJSON(storage.within(this.root, "art", "clips", `${id}.json`), full);
    return full;
  }
  clip_get(id) { return this.clips.get(id) || null; }
  clip_list() { return [...this.clips.values()].map(c => ({ id: c.id, template: c.template, directions: Object.keys(c.frames_by_direction || {}), fps: c.fps })); }

  // ---- palettes ---------------------------------------------------------------

  palette_set(id, spec) {
    // A palette nobody can name cannot be referenced by any asset; writing it out under the filename
    // "undefined.json" only makes the damage look like data.
    if (typeof id !== "string" || !id.trim()) return { ok: false, problems: [{ rule: "palette_needs_id", severity: "error", message: `a palette must be declared with a name; got ${JSON.stringify(id ?? null)}. Pass { id: "<name>", spec: { ramps: ... } }` }], palette: null };
    const pal = Palette.fromSpec(id, spec);
    const rampAudit = pal.auditRamps({ minValueStep: spec.min_value_step, maxValueStep: spec.max_value_step });
    const cap = this.doc?.coordinate?.palette_size;
    const problems = [...rampAudit.problems];
    if (cap && pal.size > cap) problems.push({ rule: "palette_cap", severity: "error", message: `palette '${id}' has ${pal.size} entries; the coordinate caps at ${cap}` });
    if (problems.some(x => (x.severity || "error") === "error")) return { ok: false, problems, palette: null };
    this.palettes.set(id, pal);
    writeJSON(storage.within(this.root, "art", "palettes", `${id}.json`), { id, origin: spec.origin || "derived in-repo from declared base hues", base_hues: spec.base_hues || null, ramps: spec.ramps, single: spec.single });
    return { ok: true, palette: pal, problems, size: pal.size };
  }
  palette_get(id) { return this.palettes.get(id) || null; }
  palette_list() { return [...this.palettes.values()].map(p => ({ id: p.id, size: p.size, ramps: p.rampIds() })); }

  /**
   * quantise_to_palette: map arbitrary RGB onto the declared ramps and REPORT the worst-case
   * delta, rather than silently inventing colours.
   */
  quantise_to_palette(source, paletteId, opts = {}) {
    const pal = this.palettes.get(paletteId);
    if (!pal) return { ok: false, reason: `no palette '${paletteId}'` };
    const rows = Array.isArray(source) ? source : [source];
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    const cel = new Cel(w, h, paletteId, opts.name || "quantised");
    let worst = 0, worstAt = null, offCount = 0;
    rows.forEach((row, y) => row.forEach((rgb, x) => {
      if (!rgb) return;
      const i = pal.nearest(rgb);
      const c = pal.color(i);
      const d = Math.sqrt((c[0]-rgb[0])**2 + (c[1]-rgb[1])**2 + (c[2]-rgb[2])**2);
      if (d > worst) { worst = d; worstAt = { x, y, from: rgb, to: c }; }
      if (d > (opts.reject_above ?? 42)) offCount++;
      cel.set(x, y, i);
    }));
    return { ok: true, cel, worst_delta: +worst.toFixed(1), worst_at: worstAt, colours_off_palette: offCount, palette: paletteId };
  }

  /** gradient_map: re-key existing art onto a ramp. Pixel intent preserved; colour recipe changed. */
  gradient_map(cel, fromPaletteId, toPaletteId, opts = {}) {
    const from = this.palettes.get(fromPaletteId), to = this.palettes.get(toPaletteId);
    if (!from || !to) return { ok: false, reason: "both palettes must exist" };
    const out = cel.clone(cel.name);
    const map = new Map();
    let changed = 0, unmapped = 0;
    cel.forEach((v, x, y) => {
      if (v < 0) return;
      if (!map.has(v)) {
        const e = from.entries[v];
        // match by ramp identity first (a coat stays a coat), fall back to nearest colour
        const target = e.ramp && to.ramp(e.ramp)
          ? to.ramp(e.ramp)[Math.min(e.step ?? 0, to.ramp(e.ramp).length - 1)]
          : to.nearest(e.rgb);
        map.set(v, target);
        if (!to.ramp(e.ramp) && e.ramp) unmapped++;
      }
      const t = map.get(v);
      if (out.set(x, y, t).changed) changed++;
    });
    this.record(cel.name, "gradient_map", changed);
    return { ok: true, cel: out, changed: { pixels: changed, added: 0, removed: 0, repainted: changed }, region: out.bbox(),
      violations: [], warnings: unmapped ? [`${unmapped} source ramp(s) have no counterpart in '${toPaletteId}'; those pixels were matched by nearest colour, which is a re-design not a re-skin`] : [],
      mapping: [...map.entries()].map(([a, b]) => ({ from: from.entries[a]?.name, to: to.entries[b]?.name })) };
  }

  // ---- style bibles -----------------------------------------------------------

  style_create(id, bible) {
    if (typeof id !== "string" || !id.trim()) return { ok: false, errors: [{ rule: "style_needs_id", axis: "id", message: `a style bible must be declared with a name; got ${JSON.stringify(id ?? null)}. Nothing was written to disk.` }], warnings: [], bible: null };
    if (!bible || typeof bible !== "object") return { ok: false, errors: [{ rule: "style_has_no_coordinate", axis: "bible", message: `style '${id}' was declared without a coordinate object to validate.` }], warnings: [], bible: null };
    const coord = validateCoordinate(bible);
    if (!coord.ok) return { ok: false, errors: coord.errors, warnings: coord.warnings, bible: null };
    const doc = { id, ...bible, signature: bible.signature || "", frozen: false, derived_from: bible.derived_from || "declared base hues", created: new Date().toISOString() };
    this.styles.set(id, doc);
    writeJSON(storage.within(this.root, "art", "styles", `${id}.json`), doc);
    return { ok: true, bible: doc, warnings: coord.warnings };
  }
  style_get(id) { return this.styles.get(id) || null; }
  style_list() { return [...this.styles.values()].map(s => ({ id: s.id, signature: s.signature, frozen: s.frozen })); }
  style_freeze(id) {
    const s = this.styles.get(id);
    if (!s) return { ok: false, reason: `no style '${id}'` };
    s.frozen = true;
    writeJSON(storage.within(this.root, "art", "styles", `${id}.json`), s);
    return { ok: true, id, frozen: true };
  }
  /** Amending a frozen bible is allowed but triggers a regression run, never a silent edit. */
  style_amend(id, patch) {
    const s = this.styles.get(id);
    if (!s) return { ok: false, reason: `no style '${id}'` };
    const next = { ...s, ...patch };
    const coord = validateCoordinate(next);
    if (!coord.ok) return { ok: false, errors: coord.errors };
    this.styles.set(id, next);
    writeJSON(storage.within(this.root, "art", "styles", `${id}.json`), next);
    return { ok: true, bible: next, must_rerun: "regression_check", warnings: coord.warnings };
  }

  // ---- sprites ---------------------------------------------------------------

  sprite_create(spec) {
    const style = this.styles.get(spec.style);
    if (!style) return { ok: false, reason: `no style '${spec.style}'; declare it with style_create first` };
    const palette = this.palettes.get(spec.palette);
    if (!palette) return { ok: false, reason: `no palette '${spec.palette}'` };
    const id = spec.id;
    const doc = {
      id, style: spec.style, palette: spec.palette,
      canvas: { w: spec.w, h: spec.h },
      anchor: spec.anchor ?? { x: Math.floor(spec.w / 2), y: spec.h - 1 },
      layers: spec.layers ?? [{ id: "body", z: 0 }],
      rig: spec.rig ?? null,
      directions: spec.directions ?? this.doc?.directions ?? [...DIRECTIONS],
      clips: spec.clips ?? [],
      cels: {},
      tier: spec.tier ?? "support",
      asset_class: spec.asset_class ?? "object",
      design: spec.design ?? null,
      provenance: this.provenanceFor(id),
    };
    this.sprites.set(id, doc);
    const dir = ensure(storage.within(this.root, "art", "sprites", id));
    writeJSON(path.join(dir, "sprite.json"), doc);
    ensure(path.join(dir, "cels"));
    return { ok: true, sprite: doc, path: dir };
  }
  sprite_info(id) { return this.sprites.get(id) || null; }
  sprite_delete(id) {
    this.sprites.delete(id);
    const dir = storage.within(this.root, "art", "sprites", id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, id };
  }
  sprite_list() { return [...this.sprites.values()].map(s => ({ id: s.id, style: s.style, canvas: s.canvas, cels: Object.keys(s.cels).length, tier: s.tier })); }

  layer_add(id, layer, z) {
    const s = this.sprites.get(id); if (!s) return { ok: false, reason: "no sprite" };
    s.layers.push({ id: layer, z: z ?? s.layers.length });
    return this.saveSprite(s);
  }
  layer_remove(id, layer) {
    const s = this.sprites.get(id); if (!s) return { ok: false, reason: "no sprite" };
    s.layers = s.layers.filter(l => l.id !== layer);
    for (const k of Object.keys(s.cels)) if (k.includes("/" + layer + "/")) delete s.cels[k];
    return this.saveSprite(s);
  }
  layer_reorder(id, order) {
    const s = this.sprites.get(id); if (!s) return { ok: false, reason: "no sprite" };
    s.layers = order.map(o => s.layers.find(l => l.id === o)).filter(Boolean);
    return this.saveSprite(s);
  }
  resize_canvas(id, w, h) {
    const s = this.sprites.get(id); if (!s) return { ok: false, reason: "no sprite" };
    const old = { ...s.canvas };
    s.canvas = { w, h };
    for (const [k, file] of Object.entries(s.cels)) {
      const cel = this.readCel(id, k);
      if (!cel) continue;
      const out = new Cel(w, h, s.palette, cel.name);
      for (let y = 0; y < Math.min(h, cel.h); y++) for (let x = 0; x < Math.min(w, cel.w); x++) out.set(x, y, cel.get(x, y));
      this.writeCel(id, k, out);
    }
    return this.saveSprite(s) && { ok: true, from: old, to: s.canvas };
  }

  saveSprite(s) { writeJSON(storage.within(this.root, "art", "sprites", s.id, "sprite.json"), s); return s; }

  celKey(clip, direction, frame) { return `${clip}/${direction}/f${frame}`; }

  writeCel(spriteId, key, cel) {
    const s = this.sprites.get(spriteId);
    if (!s) { const e = new Error(`no sprite '${spriteId}'`); e.rule = "no_sprite"; throw e; };
    storage.within(this.root, "art", "sprites", spriteId, key);
    const file = s.cels[key] || `cels/${encodeURIComponent(key)}.grid`;
    const abs = storage.within(this.root, "art", "sprites", spriteId, file);
    ensure(path.dirname(abs));
    storage.atomicWrite(abs, cel.toGrid());
    s.cels[key] = file;
    s.provenance = this.provenanceFor(spriteId);
    this.saveSprite(s);
    return { key, file, bytes: fs.statSync(abs).size };
  }
  readCel(spriteId, key) {
    const s = this.sprites.get(spriteId);
    if (!s || !s.cels[key]) return null;
    const abs = storage.within(this.root, "art", "sprites", spriteId, s.cels[key]);
    if (!fs.existsSync(abs)) return null;
    return Cel.fromGrid(fs.readFileSync(abs, "utf8"), s.palette);
  }

  /** Record an edit so provenance can be COMPUTED later rather than asserted now. */
  record(celId, op, pixels, imported = false) {
    const h = this.history.get(celId) || this.history.set(celId, []).get(celId);
    const entry = { op, pixels, imported, at: new Date().toISOString() };
    h.push(entry);
    // The history has to survive the process that made it, or "provenance is computed from edit
    // history" quietly becomes "provenance is whatever the last session remembered".
    fs.appendFileSync(storage.within(this.root, "art", "history.jsonl"), JSON.stringify({ cel: celId, ...entry }) + "\n");
    return h.length;
  }

  loadHistory() {
    const f = storage.within(this.root, "art", "history.jsonl");
    if (!fs.existsSync(f)) return 0;
    let n = 0;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const h = this.history.get(e.cel) || this.history.set(e.cel, []).get(e.cel);
      h.push({ op: e.op, pixels: e.pixels, imported: e.imported, at: e.at });
      n++;
    }
    return n;
  }

  /** Only this sprite's own edit history counts towards this sprite's provenance. */
  historyFor(spriteId) {
    const out = [];
    for (const [celId, edits] of this.history) {
      if (celId === spriteId || celId.startsWith(`${spriteId}/`) || celId.startsWith(`${spriteId}.`)) out.push(...edits);
    }
    return out;
  }

  provenanceFor(spriteId) {
    const s = this.sprites.get(spriteId);
    const edits = this.historyFor(spriteId);
    const importedPixels = edits.filter(e => e.imported).reduce((sum, e) => sum + e.pixels, 0);
    const authoredPixels = edits.filter(e => !e.imported).reduce((sum, e) => sum + e.pixels, 0);
    return {
      authored_by: "agent",
      directed_by: "user",
      engine: ENGINE,
      style_bible: s?.style ?? null,
      palette_file: s ? `art/palettes/${s.palette}.json` : null,
      palette_origin: "derived in-repo from declared base hues",
      authored_pixels: authoredPixels,
      imported_pixels: importedPixels,
      authored_share: edits.length ? +(authoredPixels / Math.max(1, authoredPixels + importedPixels)).toFixed(4) : 1,
      generative_model_used: null,
      sources: [],
      edit_ops: edits.length,
    };
  }

  // ---- import_png: gated, quarantined, loud (docs/07 §2.1) -------------------

  /**
   * An import without declared provenance is a refusal, not a warning. One careless call and a
   * third-party sprite is in the canvas, quantised, indistinguishable from authored art.
   */
  import_png(spec) {
    const prov = spec.provenance;
    if (!prov || !prov.origin) return { ok: false, violations: [{ rule: "provenance_required", message: "import_png requires provenance: { origin: original|licensed|user-owned|generated, licence?, source_url?, declared_by }", fix: "supply provenance or author the pixels" }], warnings: [] };
    if (prov.origin === "licensed" && (!prov.licence || !prov.source_url)) return { ok: false, violations: [{ rule: "licence_required", message: "origin 'licensed' requires licence and source_url" }], warnings: [] };
    const buf = fs.readFileSync(spec.path);
    const img = decodePNG(buf);
    const pal = this.palettes.get(spec.quantize_to_palette);
    if (!pal) return { ok: false, violations: [{ rule: "no_palette", message: "import_png needs quantize_to_palette" }], warnings: [] };
    const cel = new Cel(img.w, img.h, pal.id, spec.name || path.basename(spec.path));
    let worst = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x;
      if (img.alpha[i] === 0) continue;                       // a fully transparent source pixel stays transparent
      const rgb = [img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]];
      const c = pal.nearest(rgb);
      const cc = pal.color(c);
      worst = Math.max(worst, Math.hypot(cc[0] - rgb[0], cc[1] - rgb[1], cc[2] - rgb[2]));
      cel.set(x, y, c);
    }
    cel.meta = { ...cel.meta, imported: true, provenance: prov };
    // Quarantine: the file lands in art/quarantine/, never in the asset tree.
    const q = ensure(storage.within(this.root, "art", "quarantine"));
    const qfile = storage.within(q, `${cel.name}.grid`);
    storage.atomicWrite(qfile, cel.toGrid());
    this.record(cel.name, "import_png", cel.bbox()?.area ?? 0, true);
    return { ok: true, cel, quarantined: qfile, worst_delta: +worst.toFixed(1),
      violations: [{ rule: "imported_pixels", severity: "warn", message: `${cel.bbox()?.area ?? 0} pixel(s) imported from ${spec.path} (${prov.origin}). Quarantined. export_sheet will refuse to include this cel unless allow_imported: true, and assert_style reports it as a finding, not a pass.` }],
      warnings: [`imported cel is quarantined at ${qfile}`] };
  }

  /**
   * sketch_analyse: measure a human sketch, never trace it (docs/11 §5).
   * The output is shape properties and proportions. There is no path from this function to pixels.
   */
  sketch_analyse(spec) {
    const img = decodePNG(fs.readFileSync(spec.path));
    const pal = this.palettes.get(spec.quantize_to_palette) || null;
    const cel = new Cel(img.w, img.h, pal?.id || "analysis", "sketch");
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x;
      if (img.alpha[i] === 0) continue;
      const l = 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2];
      if (l > 40) cel.set(x, y, 0);
    }
    const { negativeSpace, featureCount } = require("./style.js");
    const craft = require("../craft.js");
    const bb = cel.bbox();
    return {
      ok: true,
      measured: {
        canvas: [img.w, img.h], bbox: bb ? [bb.w, bb.h] : null, area: bb?.area ?? 0,
        fill_of_bbox: bb ? +(bb.area / (bb.w * bb.h)).toFixed(3) : 0,
        negative_space: negativeSpace(cel),
        features: featureCount(cel),
        silhouette_complexity: craft.silhouetteComplexity(cel),
        cluster_stats: craft.clusterStats(cel, null),
        aspect: bb ? +(bb.w / bb.h).toFixed(2) : 0,
      },
      trace: false,
      pixels_transferred: 0,
      note: "These are the design decisions in your sketch. They are not a trace: no pixel of this sketch enters any cel. Original art is authored in this shape language.",
      provenance: { origin: spec.provenance || "user-owned", declared_by: "user", used_for: "measurement only" },
    };
  }
}

module.exports = { Project, ENGINE };
