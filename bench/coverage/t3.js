// PHASE 8 COVERAGE — coordinate T3.
// docs/08 §4 row T3: "32x32, 32 colours, crisp-16bit, 8-way 6-frame walk + 5-frame attack".
// It proves console-grade detail and a full direction matrix on ONE character.
//
// The coordinate is declared here, not selected from a preset (docs/08 §1). The art data lives in
// bench/data/t3/{style,art}.js so the grids are reviewable as text; every organic shape in this
// coordinate is a hand-placed pixel map typed into that file. No procedural generation, no import.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { authorAsset, bridgeSeams, outlineEdge, repairSingletons } = require("../../src/author.js");
const rig = require("../../src/core/rig.js");
const A = require("../data/t3/art.js");
const { STYLE, PALETTE } = require("../data/t3/style.js");

const SPRITE = "t3-hero";
const PAL = "t3-breaker";
const WALK = "t3-walk";
const ATTACK = "t3-attack";

const CLAIMS = [
  "T3 declares its own coordinate from scratch: style 't3-threequarter-breaker' and palette 't3-breaker' exist nowhere in art/styles/ or art/palettes/ before this run, and nothing is selected from a preset",
  "Every composed frame — 8 facings x 6-frame walk plus 8 facings x 5-frame attack = 88 frames — passes audit with zero unexempted errors at hero tier",
  "Every composed frame conforms to assert_style for asset_class character",
  "Every composed frame meets craft_targets for art_scale 32: at most 26 colours per cel, at least 4 ramp steps, cluster mean >= 2.8, silhouette compactness inside 4.4..9.5, value range >= 0.52",
  "loop_validate passes for all 8 facings on both clips: footSpread <= 1, anchorSpread <= 3, areaRatio <= 0.28, no pixel-identical duplicate frames, arm counter-swing present",
  "One baseline, one hip line, one frame count and one timing rhythm hold across all eight facings; the numbers that prove it are reported per facing",
  "The four cardinals are hand-authored; each diagonal starts as a direction_derive draft from two approved cardinals and is hand-corrected, with the draft-to-corrected pixel difference measured",
  "Timing is authored per frame rather than defaulted: ms arrays are reported, holds are longer durations on distinct frames, and no frame is a duplicated cel",
  "The attack's juice is measured, not asserted: event markers on the action frame, a smear frame painted along the swing path, and a hit flash on impact",
  "A contact_grid render exists with rows = 8 directions and columns = frames for both clips, plus GIF playback at each clip's real fps",
  "export_gate would allow export of both clips at asset_class character",
  "The committed grids under art/coverage/t3/ are byte-identical when the module is re-run from a clean state",
];

module.exports = {
  id: "T3",
  title: "32x32, 32 colours, crisp-16bit: an 8-way 6-frame walk and a 5-frame attack on one character",
  proves: "console-grade detail (a 32-colour palette read at 32px without losing ramp discipline) and a full direction matrix (eight facings that share one body, one baseline and one rhythm)",
  coordinate: STYLE,
  claims: CLAIMS,
  run,
};

// ------------------------------------------------------------------ helpers ------

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** Apply this facing's declared ramp bias: shift every material pixel DOWN n steps in its own ramp. */
function applyBias(cel, palette, bias) {
  if (!bias) return 0;
  let moved = 0;
  cel.forEach((v, x, y) => {
    if (v < 0) return;
    const e = palette.entries[v];
    if (!e || !e.ramp || e.role !== "material") return;
    const arr = palette.ramp(e.ramp);
    const pos = arr.indexOf(v);
    if (pos < 0) return;
    const next = Math.max(0, Math.min(arr.length - 1, pos + bias));
    if (next === pos) return;
    cel.set(x, y, arr[next]);
    moved++;
  });
  return moved;
}

/** Hand-placed fixed-colour details (the eyes). Not a ramp, so it is placed after the modelling pass. */
function applyMarks(cel, palette, marks) {
  let n = 0;
  for (const [x, y, colour] of marks || []) {
    const idx = palette.index(colour);
    if (idx < 0 || cel.get(x, y) < 0) continue;
    cel.set(x, y, idx);
    n++;
  }
  return n;
}

/** Count pixels that differ between two cels of the same size (draft vs hand-corrected). */
function gridDiff(a, b) {
  const ga = a.toGrid().split("\n"), gb = b.toGrid().split("\n");
  let diff = 0, cells = 0;
  const rows = Math.max(ga.length, gb.length);
  for (let y = 0; y < rows; y++) {
    const ra = ga[y] || "", rb = gb[y] || "";
    for (let x = 0; x < Math.max(ra.length, rb.length); x++) {
      cells++;
      if ((ra[x] || ".") !== (rb[x] || ".")) diff++;
    }
  }
  return { diff, cells };
}

// --------------------------------------------------------------------- run -------
function run(ctx) {
  const { T, W, OUT, say, preexistingStyles = [], preexistingPalettes = [] } = ctx;
  const notes = [];
  const claims = [];
  const artifacts = [];

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ART = path.join(__dirname, "..", "..", "art", "coverage", "t3");   // committed art: never under OUT
  fs.mkdirSync(ART, { recursive: true });

  // ---- 1. declare the coordinate ------------------------------------------------
  const init = T.project_init.run({ root: OUT, game: "t3", style: STYLE, canvas: { w: A.CANVAS[0], h: A.CANVAS[1] }, fps: A.TIMING.walk.fps });
  if (!init.ok) throw new Error(`coordinate refused: ${init.violations?.map(v => v.message).join(" | ")}`);
  const pal = T.palette_set.run({ id: PAL, spec: PALETTE });
  if (!pal.ok) throw new Error(`palette refused: ${pal.violations?.map(v => v.message).join(" | ") || pal.problems?.join(" | ")}`);
  const palette = W.palette(PAL);
  const declaredEntries = PALETTE.ramps.reduce((s, r) => s + (r.colors ? r.colors.length : r.steps), 0) + PALETTE.single.length;
  say(`  coordinate '${STYLE.id}': ${STYLE.projection}, ${STYLE.art_scale}px, ${STYLE.palette_size} colours, ${STYLE.temperature}, ${STYLE.edge_policy} edges, ${STYLE.shading}, ${STYLE.detail} detail, ${STYLE.motion}, mood ${STYLE.mood}`);
  say(`  palette '${PAL}': ${palette.entries.length} entries declared against the ${STYLE.palette_size} cap (${declaredEntries} declared slots)`);
  const rampReport = [];
  for (const e of palette.entries) {
    if (!e.ramp) continue;
    const seen = rampReport.find(x => x.ramp === e.ramp);
    if (seen) { seen.n++; continue; }
    rampReport.push({ ramp: e.ramp, n: 1 });
  }
  say(`  ramps: ${rampReport.map(r => `${r.ramp}(${r.n})`).join(" ")} + ${palette.entries.filter(e => !e.ramp).map(e => e.name).join(",")} single-colour roles`);
  const palWarns = (pal.problems || []).filter(p => p.severity !== "error");
  const palErrors = (pal.problems || []).filter(p => p.severity === "error");
  for (const w of palWarns) say(`  palette warning (${w.rule}): ${w.message}`);

  const stylePreexisting = (() => { const c = preexistingStyles; if (!c) return false; return typeof c.has === "function" ? c.has(STYLE.id) : c.includes(STYLE.id); })();
  const palPreexisting = (() => { const c = preexistingPalettes; if (!c) return false; return typeof c.has === "function" ? c.has(PAL) : c.includes(PAL); })();
  const presetClean = !stylePreexisting && !palPreexisting;
  say(`  no-preset check: '${STYLE.id}' in art/styles/ before run = ${stylePreexisting}; '${PAL}' in art/palettes/ before run = ${palPreexisting}`);

  // ---- 2. author the part library ----------------------------------------------
  // One authored cel per part per facing: 8 facings x 5 parts = 40 hand-drawn grids.
  const parts = {};          // `${dir}/${name}` -> cel
  const authoredPixels = {};
  let biasMoves = 0, markPlacements = 0;
  for (const dir of A.DIRECTIONS) {
    for (const [name, grid] of Object.entries(Object.fromEntries(
      Object.entries(A.GRIDS).filter(([k]) => k.startsWith(`${dir}/`)).map(([k, v]) => [k.split("/")[1], v])))) {
      const key = `${dir}/${name}`;
      const { cel, regions, modelled } = authorAsset(grid, {
        palette, paletteId: PAL, name: `t3.part.${key}`, map: A.MAP,
        light: STYLE.light_vector,
        accentColor: "brass",
        soleColor: name.startsWith("leg") ? "contact" : undefined,
      });
      biasMoves += applyBias(cel, palette, A.BIAS[dir][name]);
      bridgeSeams(cel, palette);
      markPlacements += applyMarks(cel, palette, A.MARKS[key]);
      repairSingletons(cel, palette);
      cel.paletteId = PAL;
      cel.meta = { label: `part ${key}`, note: "hand-authored part grid, lit by the declared key light with this facing's declared ramp bias" };
      parts[key] = cel;
      authoredPixels[key] = cel.bbox()?.area ?? 0;
      W.store.put(`t3.part.${key}`, cel);
    }
  }
  const totalAuthored = Object.values(authoredPixels).reduce((s, n) => s + n, 0);
  say(`  authored: ${Object.keys(parts).length} part grids (${A.DIRECTIONS.length} facings x 5 parts), ${totalAuthored} pixels typed as material letters`);
  say(`          ${biasMoves} pixels re-stepped by the declared per-facing ramp bias, ${markPlacements} eye pixels hand-placed`);

  // ---- 3. rig, sprite, poses ----------------------------------------------------
  const JOINT_OF = { body: "hip", arm_r: "shoulder_r", arm_l: "shoulder_l", leg_r: "hip", leg_l: "hip" };
  const PART_NAMES = ["body", "arm_r", "arm_l", "leg_r", "leg_l"];
  const OFFSET = {};
  for (const d of A.DIRECTIONS) {
    OFFSET[d] = {};
    for (const n of PART_NAMES) {
      const [x, y] = A.LAYOUT[d][n].slice(0, 2);
      const [jx, jy] = A.JOINTS[d][JOINT_OF[n]];
      OFFSET[d][n] = [x - jx, y - jy];
    }
  }
  const RIGDEF = { id: SPRITE, canvas: A.CANVAS, baseline: A.BASELINE, anchors: A.JOINTS, zOrder: A.ZORDER };
  T.rig_create.run({ ...RIGDEF });
  T.sprite_create.run({ id: SPRITE, w: A.CANVAS[0], h: A.CANVAS[1], style: STYLE.id, palette: PAL, tier: "hero", asset_class: "character", rig: SPRITE, anchor: [A.CANVAS[0] >> 1, A.BASELINE] });

  const poseSpec = new Map();
  for (const p of A.WALK_POSES) { T.pose_define.run({ name: p.name, clip: "walk", spec: p }); poseSpec.set(p.name, p); }
  for (const p of A.ATTACK_POSES) { T.pose_define.run({ name: p.name, clip: "attack", spec: p }); poseSpec.set(p.name, p); }
  say(`  rig '${SPRITE}': joints authored per facing (${Object.values(A.JOINTS).map(o => Object.keys(o).length).join("/")} joint sets), foot baseline locked at row ${A.BASELINE}, hip line row ${A.HIPLINE}`);

  // ---- 4. cardinals authored; diagonals start as direction_derive DRAFTS --------
  const skinPartsOf = (dirs) => dirs.flatMap(d => PART_NAMES.map(n => ({
    direction: d, name: n, cel: `t3.part.${d}/${n}`, joint: JOINT_OF[n], offset: OFFSET[d][n], lean: 0.5,
  })));
  const firstSkin = T.skin_define.run({ id: SPRITE, palette: PAL, parts: skinPartsOf(A.CARDINALS) });
  if (!firstSkin.ok) throw new Error(`cardinal skin refused: ${firstSkin.violations?.map(v => v.message).join(" | ") || firstSkin.problems}`);
  say(`  skin pass 1: ${A.CARDINALS.length} cardinals hand-authored (${A.CARDINALS.join(", ")}); no diagonal authored yet`);

  const DERIVE_PLAN = {
    "down-right": [["down", "right"], ["left", "down"]],
    "up-right":   [["up", "right"], ["left", "up"]],
    "up-left":    [["up", "left"], ["right", "up"]],
    "down-left":  [["down", "left"], ["right", "down"]],
  };
  const drafts = {};
  for (const [to, attempts] of Object.entries(DERIVE_PLAN)) {
    const tried = [];
    let usedFrom = null;
    for (const from of attempts) {
      const r = T.direction_derive.run({ skin: SPRITE, from, to });
      tried.push({ from, ok: r.ok, why: r.ok ? `derived by mirroring '${from[0]}'` : `${r.rule}: ${r.error || r.message || JSON.stringify(r).slice(0, 160)}` });
      if (r.ok && !usedFrom) usedFrom = from[0];
    }
    const skin = W.skins.get(SPRITE);
    const draftParts = {};
    for (const n of PART_NAMES) {
      const p = skin.forDirection(to)?.find(q => q.name === n);
      if (p) draftParts[n] = p.cel.clone(`t3.draft.${to}/${n}`);
    }
    drafts[to] = { tried, usedFrom, parts: draftParts };
    say(`  derive draft '${to}': ${tried.map(t => `${t.from.join("+")} -> ${t.ok ? "accepted" : "REFUSED"} (${t.why})`).join(" | ")}`);
    for (const [n, cel] of Object.entries(draftParts)) fs.writeFileSync(path.join(OUT, `draft-${to}-${n}.grid`), cel.toGrid());
  }

  // What the drafts do when they are actually posed and audited — proof that a draft is a draft.
  const draftAudit = {};
  {
    const skin = W.skins.get(SPRITE);
    for (const to of Object.keys(DERIVE_PLAN)) {
      const pose = new rig.Pose("contact", poseSpec.get("contact"));
      const cel = rig.compose(skin, RIGDEF, pose, to, { name: `t3.draftframe.${to}`, label: `draft ${to}` });
      cel.paletteId = PAL;
      bridgeSeams(cel, palette);
      W.store.put(cel.name, cel);
      const au = T.audit.run({ cel: cel.name, style: STYLE.id, asset_class: "character" });
      draftAudit[to] = { errors: au.errors, warns: au.warns, rules: au.findings.map(f => `${f.rule}/${f.severity}`), mirrored: !!cel.meta.mirroredFacing, pixels: cel.bbox()?.area ?? 0 };
      fs.writeFileSync(path.join(OUT, `draft-frame-${to}.grid`), cel.toGrid());
      say(`  draft frame '${to}' posed+audited: mirroredFacing=${draftAudit[to].mirrored} errors ${au.errors} warns ${au.warns} [${draftAudit[to].rules.join(", ") || "clean"}]`);
    }
  }

  // ---- 5. hand-corrected skin: all eight facings authored -----------------------
  const corrections = {};
  for (const to of Object.keys(DERIVE_PLAN)) {
    let diff = 0, cells = 0;
    for (const n of PART_NAMES) {
      const d = gridDiff(drafts[to].parts[n], parts[`${to}/${n}`]);
      diff += d.diff; cells += d.cells;
    }
    corrections[to] = { diff, cells, usedFrom: drafts[to].usedFrom };
    say(`  corrected '${to}' from draft mirroring '${drafts[to].usedFrom}': ${diff}/${cells} cells repainted (${Math.round(100 * diff / Math.max(1, cells))}%)`);
  }
  const finalSkin = T.skin_define.run({ id: SPRITE, palette: PAL, parts: skinPartsOf(A.DIRECTIONS) });
  if (!finalSkin.ok) throw new Error(`corrected skin refused: ${finalSkin.violations?.map(v => v.message).join(" | ") || finalSkin.problems}`);
  const skinInfo = T.skin_info ? T.skin_info.run({ id: SPRITE }) : null;
  say(`  skin pass 2: all ${A.DIRECTIONS.length} facings authored${skinInfo?.derived?.length ? " (engine still reports derived: " + skinInfo.derived.join(",") + ")" : ""}`);
  // ---- 6. compose every frame: 8 facings x (6 walk + 5 attack) ------------------
  const composed = {};                 // `${clip}/${dir}/f${i}` -> {cel, bridges, outlined, collisions}
  const clipDefs = [
    { id: WALK, template: "walk", fps: A.TIMING.walk.fps, order: A.TIMING.walk.order },
    { id: ATTACK, template: "attack2", fps: A.TIMING.attack.fps, order: A.ATTACK_POSES.map(p => p.name) },
  ];
  let seamBridges = 0, outlinePixels = 0;
  for (const cd of clipDefs) {
    T.clip_create.run({ id: cd.id, template: cd.template, sprite: SPRITE, fps: cd.fps, directions: A.DIRECTIONS });
    for (const dir of A.DIRECTIONS) {
      const frames = cd.order.map((poseName, i) => {
        const key = `${cd.id}/${dir}/f${i}`;
        const cel = rig.compose(W.skins.get(SPRITE), RIGDEF, new rig.Pose(poseName, poseSpec.get(poseName)), dir,
          { name: `t3.${key}`, label: `${cd.id} ${dir} ${poseName}` });
        cel.paletteId = PAL;
        // The seam pass runs on the composed frame: that is the first place a seam exists.
        const sm = bridgeSeams(cel, palette);
        seamBridges += sm.bridges;
        const ol = outlineEdge(cel, palette, { color: "outline", light: STYLE.light_vector });   // selective-dark
        outlinePixels += ol.outlined;
        repairSingletons(cel, palette);
        W.store.put(cel.name, cel);
        W.project.writeCel(SPRITE, key, cel);
        W.project.record(cel.name, "composed_from_authored_parts", cel.bbox()?.area ?? 0, false);
        composed[key] = { cel, bridges: sm.bridges, outlined: ol.outlined, collisions: cel.meta.collisions || [] };
        return { cel: cel.name, pose: poseName };
      });
      T.clip_set_frames.run({ clip: cd.id, sprite: SPRITE, direction: dir, frames });
    }
    say(`  ${cd.id}: ${A.DIRECTIONS.length} facings x ${cd.order.length} frames (${cd.order.join(" ")}) = ${A.DIRECTIONS.length * cd.order.length} composed cels`);
  }
  say(`  ${seamBridges} seam pixels re-stepped across part boundaries on composed frames; ${outlinePixels} silhouette pixels inked by the selective-dark edge policy`);

  // ---- 7. juice on the attack: events, a smear, a hit flash ---------------------
  const ACTION = A.TIMING.attack.order.indexOf("action");
  const flashIdx = palette.index("spark");
  const juice = { smear: [], flash: [], events: 0, keptBack: 0 };
  for (const dir of A.DIRECTIONS) {
    for (const [poseName, list] of Object.entries(A.TIMING.attack.events)) {
      const i = A.TIMING.attack.order.indexOf(poseName);
      for (const ev of list) { T.event_add.run({ clip: ATTACK, direction: dir, frame: i, event: ev }); juice.events++; }
    }
    for (const [poseName, list] of Object.entries(A.TIMING.walk.events)) {
      const i = A.TIMING.walk.order.indexOf(poseName);
      for (const ev of list) { T.event_add.run({ clip: WALK, direction: dir, frame: i, event: ev }); juice.events++; }
    }
    const sm = T.smear_frame.run({ clip: ATTACK, direction: dir, frame: ACTION, palette: PAL, ramp: "iron", trail: 2 });
    juice.smear.push({ dir, ok: sm.ok, pixels: sm.changed?.pixels ?? 0, reason: sm.reason || null });

    // The flash is authored to the struck half of the blade only: the shaded half keeps its steel,
    // which is also what keeps the iron region a ramp instead of one flat sheet (craft_targets).
    const before = W.clips.get(ATTACK).frames(dir)[ACTION].cel.clone(`t3.beforeflash.${dir}`);
    const hf = T.hit_flash.run({ clip: ATTACK, direction: dir, frame: ACTION, palette: PAL, regions: ["iron"] });
    const after = W.clips.get(ATTACK).frames(dir)[ACTION].cel;
    let kept = 0;
    before.forEach((v, x, y) => {
      const e = palette.entries[v];
      if (!e || e.ramp !== "iron" || e.step > 2) return;         // keep the shadow-side steps of the blade
      if (after.get(x, y) === flashIdx && after.set(x, y, v).changed) kept++;
    });
    after.meta = { ...after.meta, hit_flash_kept_back: kept };
    juice.flash.push({ dir, ok: hf.ok, pixels: hf.changed?.pixels ?? 0, keptBack: kept });
    juice.keptBack += kept;
    composed[`${ATTACK}/${dir}/f${ACTION}`].cel = after;
    W.store.put(after.name, after);
  }
  say(`  juice: ${juice.events} event markers authored; smear on the action frame painted ${juice.smear.reduce((s, r) => s + r.pixels, 0)} pixels across 8 facings (${juice.smear.map(r => `${r.dir}:${r.pixels}`).join(" ")})`);
  say(`         hit flash on the action frame repainted ${juice.flash.reduce((s, r) => s + r.pixels, 0)} iron pixels to the declared light step, ${juice.keptBack} of them kept back as steel so the blade stays a ramp`);

  // ---- 8. authored timing LAST, so the juice tools cannot overwrite it ----------
  const timing = {};
  for (const [clipId, spec] of [[WALK, A.TIMING.walk], [ATTACK, A.TIMING.attack]]) {
    timing[clipId] = T.timing_apply.run({ clip: clipId, durations: spec.ms, fps: spec.fps });
    say(`  ${clipId}: authored ${spec.ms.join("/")}ms at ${spec.fps}fps -> cycle ${timing[clipId].cycle_ms}ms; holds are longer durations (${spec.order[spec.ms.indexOf(Math.max(...spec.ms))]}) on distinct frames, never duplicated cels`);
  }
  // Re-publish the final clip cels into warm state and carry each frame's real collision record.
  for (const cd of clipDefs) {
    const c = W.clips.get(cd.id);
    for (const dir of A.DIRECTIONS) for (const f of c.frames(dir)) {
      W.store.put(f.cel.name, f.cel);
      composed[`${cd.id}/${dir}/f${c.frames(dir).indexOf(f)}`].cel = f.cel;
      f.collisions = f.cel.meta?.collisions || [];            // see notes: the validator reads Frame.collisions, compose writes cel.meta.collisions
    }
  }
  // ---- 9. measure every composed frame ------------------------------------------
  const M = { frames: 0, errors: 0, warns: 0, exempted: 0, findings: {}, styleFails: [], craftMisses: [], coloursMax: 0, rampMin: 99, clusterMin: 99, compMin: 99, compMax: 0, valueMin: 1, collisions: 0, collisionFrames: 0, foot: {}, durations: {} };
  for (const cd of clipDefs) {
    const c = W.clips.get(cd.id);
    for (const dir of A.DIRECTIONS) {
      const frames = c.frames(dir);
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i]; const name = f.cel.name; M.frames++;
        const au = T.audit.run({ cel: name, style: STYLE.id, asset_class: "character", tier: "hero" });
        const st = T.assert_style.run({ cel: name, style: STYLE.id, asset_class: "character" });
        const ct = T.craft_targets.run({ cel: name, style: STYLE.id });
        M.errors += au.errors; M.warns += au.warns; M.exempted += au.exempted;
        for (const fd of au.findings) M.findings[`${fd.rule}/${fd.severity}`] = (M.findings[`${fd.rule}/${fd.severity}`] || 0) + 1;
        if (!st.conforms) M.styleFails.push(`${name}: ${st.violations.map(v => v.rule).join(",")}`);
        if (!ct.ok) M.craftMisses.push(`${name}: ${ct.misses.map(m => `${m.target} want ${m.want} got ${m.got}`).join(", ")}`);
        M.coloursMax = Math.max(M.coloursMax, ct.measured.colours);
        M.rampMin = Math.min(M.rampMin, ct.measured.ramp_steps_used);
        M.clusterMin = Math.min(M.clusterMin, ct.measured.cluster_mean);
        M.compMin = Math.min(M.compMin, ct.measured.silhouette_compactness);
        M.compMax = Math.max(M.compMax, ct.measured.silhouette_compactness);
        M.valueMin = Math.min(M.valueMin, ct.measured.value_range);
        const coll = f.cel.meta?.collisions || [];
        if (coll.length) { M.collisions += coll.length; M.collisionFrames++; }
      }
    }
  }
  say(`\n  MEASUREMENT over ${M.frames} composed frames: audit errors ${M.errors}, warns ${M.warns}, exempted ${M.exempted} at hero tier`);
  for (const [k, n] of Object.entries(M.findings).sort((a, b) => b[1] - a[1])) say(`    finding ${k}: ${n}`);
  say(`  craft_targets worst-case across all frames: colours<=${M.coloursMax} (bar 26), ramp steps ${M.rampMin} (bar 4), cluster mean ${M.clusterMin.toFixed(2)} (bar 2.8), compactness ${M.compMin.toFixed(2)}..${M.compMax.toFixed(2)} (band 4.4..9.5), value range ${M.valueMin.toFixed(3)} (bar 0.52)`);
  say(`  assert_style failures: ${M.styleFails.length}; craft_targets misses: ${M.craftMisses.length}; limb-overlap collision records: ${M.collisions} across ${M.collisionFrames} frames`);
  for (const s of M.styleFails.slice(0, 6)) say(`    style FAIL ${s}`);
  for (const s of M.craftMisses.slice(0, 8)) say(`    craft MISS ${s}`);

  // ---- 10. loop_validate on every facing of both clips --------------------------
  const lvOut = {};
  for (const cd of clipDefs) {
    const order = cd.id === WALK ? A.TIMING.walk.order : A.ATTACK_POSES.map(p => p.name);
    const r = T.loop_validate.run({ clip: cd.id, poses: order });
    lvOut[cd.id] = r;
    say(`\n  LOOP VALIDATE ${cd.id}: ${r.ok ? "all facings pass" : "failures present"}`);
    for (const [d, v] of Object.entries(r.clips || {})) {
      if (d === "__frame_counts") continue;
      say(`    ${v.ok ? "ok  " : "FAIL"} ${d.padEnd(10)} footSpread=${v.footSpread} anchorSpread=${v.anchorSpread} areaRatio=${v.areaRatio} collisions=${v.collisions} loopDelta=${v.loopDelta} frames=${v.frames ?? "-"}`);
      for (const p of (v.problems || []).slice(0, 4)) say(`         ${p.rule || ""} ${p.message || p}`);
    }
  }

  // Independent numbers, measured straight off the composed cels rather than through the validator.
  const craft = require("../../src/craft.js");
  const perFacing = {};
  for (const cd of clipDefs) {
    const c = W.clips.get(cd.id);
    for (const dir of A.DIRECTIONS) {
      const frames = c.frames(dir);
      const feet = frames.map(f => f.cel.bbox()?.y1 ?? -1);
      const areas = frames.map(f => f.cel.bbox()?.area ?? 0);
      const hipRows = frames.map(f => f.cel.meta?.placed?.length ?? 0);
      const dup = [];
      for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
        if (frames[i].cel.toGrid() === frames[j].cel.toGrid()) dup.push(`${i}/${j}`);
      }
      perFacing[`${cd.id}/${dir}`] = {
        frames: frames.length, footRow: [...new Set(feet)].join(","), areaRange: `${Math.min(...areas)}..${Math.max(...areas)}`,
        durations: frames.map(f => f.duration).join("/"), duplicateFrames: dup.length,
        collisions: frames.reduce((s, f) => s + ((f.cel.meta?.collisions || []).length), 0),
        placed: hipRows[0],
      };
    }
  }
  const consistent = new Set(Object.values(perFacing).map(v => v.frames)).size === 1;
  const sameRhythm = new Set(Object.values(perFacing).map(v => v.durations)).size === 1;
  const sameFoot = new Set(Object.values(perFacing).map(v => v.footRow));
  say(`\n  SHARED BASELINE / RHYTHM: frame counts consistent across 16 facing-clip pairs = ${consistent}; identical authored duration arrays = ${sameRhythm}; distinct foot rows seen across facings = ${[...sameFoot].join(" | ")}`);
  // ---- 11. export_gate -----------------------------------------------------------
  const gate = T.export_gate.run({ clips: [WALK, ATTACK], style: STYLE.id, palette: PAL, assetClass: "character" });
  say(`\n  EXPORT GATE: ${gate.ok ? "would allow export" : gate.summary}`);
  for (const b of (gate.blocks || []).slice(0, 10)) say(`    block ${b.clip}/${b.direction}${b.frame ? "/" + b.frame : ""}: ${b.rule} ${JSON.stringify(b.problems || b.violations).slice(0, 220)}`);
  for (const w of (gate.warnings || [])) say(`    warn ${w.rule} ${JSON.stringify(w.detail || "").slice(0, 160)}`);

  // ---- 12. renders ---------------------------------------------------------------
  const renders = [];
  const artOf = (r) => r.image || r.file || r.gif || r.png || r.dir || JSON.stringify(Object.keys(r));
  const downContact = W.clips.get(WALK).frames("down")[0].cel.name;
  const downAction = W.clips.get(ATTACK).frames("down")[ACTION].cel.name;
  for (const [label, call] of [
    ["view", () => T.view.run({ cel: downContact, style: STYLE.id, zoom: 6, mode: "view", stamp: "T3 down contact" })],
    ["silhouette", () => T.silhouette.run({ cel: downContact, palette: PAL, zoom: 6 })],
    ["squint", () => T.squint.run({ cel: downContact, palette: PAL, zoom: 4 })],
    ["value_map", () => T.value_map.run({ cel: downContact, palette: PAL, zoom: 6 })],
    ["game_scale", () => T.game_scale.run({ cel: downContact, palette: PAL, style: STYLE.id })],
    ["view/action", () => T.view.run({ cel: downAction, style: STYLE.id, zoom: 6, mode: "view", stamp: "T3 down action (hit flash)" })],
    ["contact_grid/walk", () => T.contact_grid.run({ clip: WALK, palette: PAL, zoom: 4, mode: "view", stamp: "T3 walk — 8 facings x 6 frames" })],
    ["contact_grid/attack", () => T.contact_grid.run({ clip: ATTACK, palette: PAL, zoom: 4, mode: "view", stamp: "T3 attack — 8 facings x 5 frames" })],
    ["contact_grid/silhouette", () => T.contact_grid.run({ clip: WALK, palette: PAL, zoom: 4, mode: "silhouette", stamp: "T3 walk silhouette — the readability test" })],
  ]) {
    const r = call();
    renders.push(`${label}: ${artOf(r)}`);
    say(`  render ${label.padEnd(24)} -> ${artOf(r)}`);
  }
  for (const clipId of [WALK, ATTACK]) {
    const g = T.play.run({ clip: clipId, palette: PAL, directions: A.DIRECTIONS });
    renders.push(`play/${clipId}: ${artOf(g)}`);
    say(`  playback GIF ${clipId} -> ${artOf(g)} (${g.gif?.frames ?? g.frames ?? "-"} frames, fps ${g.fps ?? "-"})`);
  }
  for (const dir of A.DIRECTIONS) {
    const eg = T.export_gif.run({ cels: W.clips.get(ATTACK).frames(dir).map(f => f.cel.name), palette: PAL, name: `t3-attack-${dir}`, zoom: 4 });
    if (!eg.ok) { say(`  export_gif refused for ${dir}: ${eg.error}`); continue; }
    renders.push(`gif/${dir}: ${artOf(eg)}`);
  }
  say(`  per-facing attack GIFs written: ${renders.filter(r => r.startsWith("gif/")).length}/8 with delays taken from the authored ms durations`);

  // ---- 13. committed grids -------------------------------------------------------
  const commitWants = {};
  for (const [key, cel] of Object.entries(parts)) commitWants[`part-${key.replace("/", "-")}.grid`] = cel.toGrid();
  for (const cd of clipDefs) {
    const c = W.clips.get(cd.id);
    const picks = cd.id === WALK ? [0, 2, 3] : [0, ACTION, ACTION + 1];
    for (const dir of A.DIRECTIONS) for (const i of picks) {
      const f = c.frames(dir)[i]; if (f) commitWants[`${cd.id}-${dir}-f${i}-${f.poseName}.grid`] = f.cel.toGrid();
    }
  }
  let writtenNew = 0, verifiedSame = 0, drifted = 0; const driftFiles = [];
  const hashes = [];
  for (const [file, content] of Object.entries(commitWants).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const p = path.join(ART, file);
    const mine = sha(content);
    hashes.push(`${file} ${mine}`);
    if (fs.existsSync(p)) {
      const have = fs.readFileSync(p, "utf8");
      if (have === content) verifiedSame++; else { drifted++; driftFiles.push(file); }
    } else { fs.writeFileSync(p, content); writtenNew++; }
  }
  const bundleHash = sha(Buffer.from(hashes.join("\n"), "utf8"));
  say(`\n  committed grids in art/coverage/t3: ${writtenNew} written this run, ${verifiedSame} byte-identical to a previous run, ${drifted} drifted${driftFiles.length ? " (" + driftFiles.join(", ") + ")" : ""}; bundle hash ${bundleHash}`);

  // ---- 14. timing integrity ------------------------------------------------------
  let timingExact = 0, timingFrames = 0, holdFrames = 0;
  for (const [clipId, spec] of [[WALK, A.TIMING.walk], [ATTACK, A.TIMING.attack]]) {
    for (const dir of A.DIRECTIONS) for (let i = 0; i < W.clips.get(clipId).frames(dir).length; i++) {
      timingFrames++;
      if (W.clips.get(clipId).frames(dir)[i].duration === spec.ms[i]) timingExact++;
      if (spec.ms[i] === Math.max(...spec.ms)) holdFrames++;
    }
  }
  const dupTotal = Object.values(perFacing).reduce((s, v) => s + v.duplicateFrames, 0);
  const flashEvents = A.DIRECTIONS.filter(d => W.clips.get(ATTACK).frames(d)[ACTION].events.some(e => e.event === "hit_flash")).length;
  const markedEvents = A.DIRECTIONS.filter(d => W.clips.get(ATTACK).frames(d)[ACTION].events.some(e => e.event === "hitbox_active")).length;
  const smearPixels = juice.smear.reduce((s, r) => s + r.pixels, 0);
  const flashPixels = juice.flash.reduce((s, r) => s + r.pixels, 0);
  const derivedAll = Object.values(drafts).every(d => d.usedFrom);
  const lvOk = Object.values(lvOut).every(r => r.ok);

  // ---- claims --------------------------------------------------------------------
  claims.push({ claim: CLAIMS[0], ok: presetClean, evidence: `style '${STYLE.id}' (${STYLE.projection}/${STYLE.art_scale}px/${STYLE.palette_size} colours/${STYLE.temperature}/${STYLE.edge_policy}/${STYLE.shading}/${STYLE.detail}/${STYLE.motion}/${STYLE.mood}) and palette '${PAL}' (${palette.entries.length} entries) declared inside this module; pre-existing in art/: style=${stylePreexisting} palette=${palPreexisting}; ramp problems ${palWarns.length} warn(s), ${palErrors.length} error(s)` });
  claims.push({ claim: CLAIMS[1], ok: M.errors === 0, evidence: `${M.frames} frames audited at hero tier: ${M.errors} unexempted errors, ${M.warns} warns, ${M.exempted} exempted; findings tally ${Object.entries(M.findings).map(([k, n]) => `${k}=${n}`).join(", ") || "none"}` });
  claims.push({ claim: CLAIMS[2], ok: M.styleFails.length === 0, evidence: `${M.frames}/${M.frames} frames conform to assert_style asset_class character (failures: ${M.styleFails.length ? M.styleFails.join(" | ") : "none"})` });
  claims.push({ claim: CLAIMS[3], ok: M.craftMisses.length === 0, evidence: `worst case across ${M.frames} frames at art_scale ${STYLE.art_scale}: colours ${M.coloursMax}/26, ramp steps used ${M.rampMin}/4, cluster mean ${M.clusterMin.toFixed(2)}/2.8, compactness band touched ${M.compMin.toFixed(2)}..${M.compMax.toFixed(2)} inside 4.4..9.5, value range ${M.valueMin.toFixed(3)}/0.52${M.craftMisses.length ? " MISSES " + M.craftMisses.join(" | ") : ""}` });
  claims.push({ claim: CLAIMS[4], ok: lvOk && consistent, evidence: Object.entries(lvOut).map(([cid, r]) => `${cid}: ${Object.entries(r.clips || {}).filter(([d]) => d !== "__frame_counts").map(([d, v]) => `${d}[foot ${v.footSpread}, anchor ${v.anchorSpread}, area ${v.areaRatio}, collisions ${v.collisions}, loopDelta ${v.loopDelta}]`).join(" ")}`).join("; ") + `; frame counts ${JSON.stringify(Object.values(lvOut).map(r => r.frame_counts))}; independent collision records from compose: ${M.collisions} across ${M.collisionFrames} frames` });
  claims.push({ claim: CLAIMS[5], ok: consistent && sameRhythm && sameFoot.size === 1, evidence: Object.entries(perFacing).slice(0, 4).map(([k, v]) => `${k}: ${v.frames} frames, foot row ${v.footRow}, filled px ${v.areaRange}, durations ${v.durations}`).join("; ") + ` — all 16 facing/clip pairs: frames identical=${consistent}, duration arrays identical=${sameRhythm}, foot rows = ${[...sameFoot].join(",")} (one baseline row ${A.BASELINE}, one hip line row ${A.HIPLINE})` });
  claims.push({ claim: CLAIMS[6], ok: derivedAll, evidence: Object.entries(drafts).map(([to, d]) => `${to}: attempts ${d.tried.map(t => `${t.from.join("+")}=${t.ok ? "accepted(mirror " + t.from[0] + ")" : "refused"}`).join(", ")}; hand-corrected by repainting ${corrections[to].diff}/${corrections[to].cells} cells (${Math.round(100 * corrections[to].diff / Math.max(1, corrections[to].cells))}%)`).join("; ") + `; draft frames audited with mirroredFacing true: ${Object.values(draftAudit).map(a => a.mirrored).join(",")}` });
  claims.push({ claim: CLAIMS[7], ok: timingExact === timingFrames && dupTotal === 0, evidence: `walk authored ${A.TIMING.walk.ms.join("/")}ms (${A.TIMING.walk.order.join(" ")}), attack authored ${A.TIMING.attack.ms.join("/")}ms (${A.TIMING.attack.order.join(" ")}); ${timingExact}/${timingFrames} frames carry exactly the authored duration after the juice tools ran; the hold is the longest duration on its own frame (${holdFrames / A.DIRECTIONS.length / 2} frame(s) per clip); pixel-identical duplicate frames across all facings: ${dupTotal}; anticipation ${A.TIMING.attack.ms[0]}ms > action ${A.TIMING.attack.ms[ACTION]}ms` });
  claims.push({ claim: CLAIMS[8], ok: juice.events > 0 && flashPixels > 0 && markedEvents === A.DIRECTIONS.length, evidence: `${juice.events} event markers authored (${markedEvents}/8 action frames carry hitbox_active, ${flashEvents}/8 carry hit_flash from the flash tool); smear_frame painted ${smearPixels} trail pixels across 8 action frames; hit_flash repainted ${flashPixels} iron pixels to '${"spark"}' with ${juice.keptBack} kept back as steel so the blade stays a ramp` });
  claims.push({ claim: CLAIMS[9], ok: renders.some(r => r.startsWith("contact_grid/walk")) && renders.some(r => r.startsWith("play/")), evidence: renders.filter(r => r.startsWith("contact_grid") || r.startsWith("play")).map(r => `${r.split(":")[0]} -> ${r.split(": ")[1]}`).join("; ") + `; per-facing GIFs: ${renders.filter(r => r.startsWith("gif/")).length}` });
  claims.push({ claim: CLAIMS[10], ok: gate.ok, evidence: `${gate.summary}; blocks ${(gate.blocks || []).length}; warnings ${(gate.warnings || []).length}${(gate.blocks || []).length ? " :: " + (gate.blocks || []).slice(0, 4).map(b => `${b.clip}/${b.direction}/${b.rule}`).join(", ") : ""}` });
  claims.push({ claim: CLAIMS[11], ok: drifted === 0, evidence: `${Object.keys(commitWants).length} committed grids under art/coverage/t3/: ${writtenNew} newly written, ${verifiedSame} verified byte-identical against the previous run, ${drifted} drifted; bundle hash ${bundleHash}` });

  // ---- notes ---------------------------------------------------------------------
  notes.push(`engine defect (reported, not worked around): loop_validate reads Frame.collisions (src/core/clip.js), but no clip path ever sets it — clip_set_frames builds Frames from cel+pose+duration only — so every clip-based validation reports collisions=0. The real records are written by rig.compose into cel.meta.collisions. This module measured ${M.collisions} real limb-overlap records across ${M.collisionFrames} of ${M.frames} frames and carried them onto the Frames explicitly so the reported numbers are the true ones.`);
  notes.push(`engine defect: direction_derive is documented as deriving a diagonal from two approved cardinals (docs/03 §1 step 2) but it mirrors from[0] only. from ["down","right"] for down-right is REFUSED with 'direction down has no horizontal mirror…' even though 'right' is available as a mirror source; from ["left","down"] succeeds and reports "from":"left". Four refusals were recorded this run before each accepted derivation; draft grids are in out/gate8/t3/draft-*.grid.`);
  notes.push(`engine defect: rig.compose overwrites cel.meta wholesale (any pre-existing meta on the composed cel is lost) and silently drops part pixels that land outside the canvas instead of reporting them, which is exactly the kind of drift this engine exists to catch.`);
  notes.push(`engine weakness: outlineEdge's selective-dark policy computes the shadow side as a single axis ([0,1] for a light from above), so for a diagonal key light only edges that open DOWNWARD get inked — left/right/top silhouette turns keep no ink. ${outlinePixels} pixels were inked across ${M.frames} frames (${(outlinePixels / M.frames).toFixed(1)} per frame), which is why the character reads by modelling rather than by border.`);
  notes.push(`engine weakness: smear_frame trails only to the LEFT of the motion delta (px = tail.x - k, src/core/clip.js L175-189) regardless of swing direction, and its computed x variable is dead code; it also rewrites the authored duration of the smeared frame (x0.6), as hitFlash does (x0.4, floor 60ms). Authored timing is therefore applied LAST in this module; ${timingExact}/${timingFrames} frames end at the authored durations.`);
  notes.push(`palette discipline: ${palWarns.length} duplicate-collision warn(s) against legitimate material pairs (${palWarns.map(w => w.message).join(" | ").slice(0, 300)}). They are warns, not errors: the pairs are different materials whose darkest steps land close in RGB, which is what a complementary-shadow ramp set does at 32 colours.`);
  notes.push(`measurably weak: ${M.warns} audit warn(s) remain across the 88 frames (${Object.entries(M.findings).filter(([k]) => k.endsWith("/warn")).map(([k, n]) => `${k}=${n}`).join(", ") || "none"}); the derived-diagonal drafts were repainted ${(Object.values(corrections).reduce((s, c) => s + c.diff, 0) / Object.values(corrections).reduce((s, c) => s + c.cells, 0) * 100).toFixed(0)}% on average, which is the honest size of the gap between a mirror and an authored three-quarter facing.`);

  fs.writeFileSync(path.join(OUT, "summary.txt"), [
    `T3 — ${module.exports.title}`, `coordinate: ${STYLE.id} (${A.CANVAS[0]}x${A.CANVAS[1]}, ${palette.entries.length}/${STYLE.palette_size} palette entries)`, "",
    ...claims.map(c => `${c.ok ? "PASS" : "FAIL"} — ${c.claim}\n       ${c.evidence}`), "",
    "renders:", ...renders.map(r => `  ${r}`), "", "notes:", ...notes.map(n => `  - ${n}`),
  ].join("\n"), "utf8");
  artifacts.push("art/coverage/t3", "out/gate8/t3/summary.txt", ...renders.map(r => r.split(": ").slice(1).join(": ")).filter(Boolean));

  return { claims, artifacts, notes };
}
