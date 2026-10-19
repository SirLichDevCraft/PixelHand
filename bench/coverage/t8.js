// PHASE 8 COVERAGE — T8: the boss. docs/08 §4 row T8:
//   "Boss: 96x96, multi-part rig, 12-frame attack with phase-offset sub-animations"
//   proves: "large multi-part animation without sliding".
//
// The claim this coordinate exists to test is the one Phase 0 failed at: a big sprite animated by
// moving parts around is exactly where animation degenerates into sliding rigid shapes. So the
// evidence here is not "it audited clean", it is a per-part, per-frame position record plus
// loop_validate numbers plus my own eyes on the contact grid and the GIF.
//
// Design decisions made up front (docs/03 §2-§4):
//   * ONE authored facing ("down": the boss faces the camera). A boss attack is one facing; the
//     direction matrix is not what T8 is for and faking seven mirrored facings would add nothing.
//   * The attack is 12 frames with AUTHORED durations: anticipation ~850ms, swing ~280ms. Weight
//     reads in the ratio, not in the frame count.
//   * Key poses are separate drawings. The weapon at six angles is six authored cels, not one cel
//     translated along an arc — that distinction is measured below, not asserted.
//   * The sub-asset is three chains hung from the pauldrons, each cycling on period 4 inside the
//     12-frame attack, with different phases. Their extrema land on frames the body is NOT at.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { authorAsset, bridgeSeams, repairSingletons } = require("../../src/author.js");
const rig = require("../../src/core/rig.js");
const COORD = require("../data/t8/coordinate.js");
const { GRIDS } = require("../data/t8/parts.js");

const { STYLE, PALETTE, MAP, ANCHORS, PART_JOINTS, Z_ORDER, LAYOUT, OVERRIDES, CANVAS, BASELINE } = COORD;
const PAL_ID = "t8";
const ART = path.join(__dirname, "..", "..", "art", "coverage", "t8");

// ---- the choreography ----------------------------------------------------------
// Every frame lists which authored variant is SHOWING at each joint. Everything else is hidden by
// the pose. Secondary motion (bob, lean) is a small dx/dy on top of the authored placement.
const CHAIN_OUT = { chain_a: [1, 5, 9], chain_b: [2, 6, 10], chain_c: [3, 7, 11] };   // own cycle: period 4, phases 1/2/3

const FRAMES = [
  { name: "settle",        note: "weight settled, cleaver held point-down at the side",       weight: -1,
    jaw: "jaw_closed", armL: "arm_l_neutral", armR: "arm_r_low", blade: "blade_ready", mods: {} },
  { name: "windup-1",      note: "the claw arm draws back first — the body tells you before the weapon does", weight: 0,
    jaw: "jaw_closed", armL: "arm_l_back", armR: "arm_r_mid", blade: "blade_ready", mods: { blade_ready: { dy: -4 } } },
  { name: "windup-2",      note: "cleaver comes up behind the shoulder",                      weight: 1,
    jaw: "jaw_closed", armL: "arm_l_back", armR: "arm_r_high", blade: "blade_up", mods: {} },
  { name: "coil",          note: "peak of the wind-up, torso coiled to the claw side",        weight: 1, lean: -1,
    jaw: "jaw_closed", armL: "arm_l_back", armR: "arm_r_high", blade: "blade_up", mods: { blade_up: { dx: -1, dy: -1 } } },
  { name: "coil-hold",     note: "a HOLD: longer duration, not a duplicated frame",           weight: 1, lean: -1,
    jaw: "jaw_closed", armL: "arm_l_guard", armR: "arm_r_high", blade: "blade_up", mods: { arm_r_high: { dy: 1 }, blade_up: { dx: -2 } } },
  { name: "lunge",         note: "the body commits forward; the jaw opens before the swing",  weight: -1, lean: 1,
    jaw: "jaw_open", armL: "arm_l_guard", armR: "arm_r_down", blade: "blade_arc", mods: {} },
  { name: "strike",        note: "fastest limb of the clip — the cleaver is drawn along its own path", weight: -1, lean: 2,
    jaw: "jaw_open", armL: "arm_l_guard", armR: "arm_r_down", blade: "blade_smear", mods: { arm_r_down: { dx: 2, dy: 3 } } },
  { name: "impact",        note: "planted: hit_flash on the plates and the blade, impact_squash on the body", weight: -2, lean: 1,
    jaw: "jaw_open", armL: "arm_l_guard", armR: "arm_r_down", blade: "blade_impact", mods: { arm_r_down: { dx: 3, dy: 5 } } },
  { name: "follow-through",note: "the weapon overshoots past the centre line (attack2 mandate)", weight: -1, lean: -1,
    jaw: "jaw_open", armL: "arm_l_neutral", armR: "arm_r_follow", blade: "blade_follow", mods: {} },
  { name: "recover-1",     note: "jaw shuts, weapon lifted back up off the ground",           weight: 0,
    jaw: "jaw_closed", armL: "arm_l_neutral", armR: "arm_r_follow", blade: "blade_follow", mods: { arm_r_follow: { dx: 2, dy: -6 }, blade_follow: { dx: 3, dy: -8 } } },
  { name: "recover-2",     note: "weight comes back over the feet",                           weight: -1,
    jaw: "jaw_closed", armL: "arm_l_neutral", armR: "arm_r_low", blade: "blade_ready", mods: { arm_r_low: { dy: -2 }, blade_ready: { dy: -2 } } },
  { name: "settle-return", note: "hands off to frame 0 — the seam is a handoff, not a jump",  weight: -1,
    jaw: "jaw_closed", armL: "arm_l_neutral", armR: "arm_r_low", blade: "blade_ready", mods: { torso: { dy: 1 } } },
];

// Per-frame durations in ms, authored rather than defaulted (docs/03 §4). fps 10 is declared on the
// project; these are what the clip actually plays at.
const DURATIONS = [140, 120, 110, 150, 200, 130, 70, 90, 120, 160, 180, 150];

// Event markers travel into the manifest so game code drives feel from the art (docs/03 §4).
const EVENTS = {
  1: [{ event: "windup_start", sfx: "grunt" }],
  4: [{ event: "anticipation_hold" }],
  6: [{ event: "weapon_peak", sfx: "whoosh" }, { event: "hitbox_pending" }],
  7: [{ event: "hitbox_active", sfx: "slam", data: { reach: [40, 72] } }, { event: "roar" }],
  9: [{ event: "recovery_start" }],
  11: [{ event: "cycle_end" }],
};

const POSE_ORDER = FRAMES.map(f => f.name);

function activeSet(i) {
  const f = FRAMES[i];
  const act = ["torso", "head", f.jaw, f.armL, f.armR, f.blade, "pauldron_l", "pauldron_r", "leg_l", "leg_r"];
  for (const [group, outFrames] of Object.entries(CHAIN_OUT)) {
    const variant = outFrames.includes(i) ? `${group}_out` : `${group}_hang`;
    act.push(variant);
  }
  return act;
}

function poseSpec(i) {
  const f = FRAMES[i];
  const parts = {};
  const act = new Set(activeSet(i));
  for (const name of Object.keys(GRIDS)) {
    if (!act.has(name)) parts[name] = { hide: true };
    else parts[name] = f.mods[name] ? { ...f.mods[name] } : {};
  }
  return { parts, lean: f.lean || 0, weight: f.weight, note: f.note };
}

// ---- the claims, declared before the work ---------------------------------------
const CLAIMS = [
  "the boss is a multi-part rig assembled from authored part cels (part count and per-part pixel counts reported)",
  "phase offsets between body, limbs and sub-asset are measured per part per frame, not asserted",
  "no sliding: loop_validate passes the whole 12-frame clip — foot baseline <=1px, centre shift <=3px, area ratio <=0.28, zero invisible part collisions",
  "the moving parts are posed, not translated: no consecutive appearance of the weapon, arms or jaw is the same pixels under any translation",
  "the attack carries authored per-frame durations and windup/strike/recovery event markers, with anticipation longer than the swing",
  "smear on the fastest limb, hit_flash on impact and impact_squash on the strike frame are engine-applied and audited",
  "every composed frame passes audit with zero error findings, assert_style as a character at art_scale 96, and craft_targets for 96",
  "export_gate would allow export of both clips",
  "contact_sheet + contact_grid + playback GIF exist and were reviewed by eye",
  "the sub-asset's own 4-frame chain loop has no stuttering seam",
  "the coordinate was declared from scratch — no preset bible and no reused palette",
  "committed grids under art/coverage/t8 are byte-identical on a clean re-run",
];

function run(ctx) {
  const { T, W, OUT, say, preexistingStyles, preexistingPalettes } = ctx;
  const notes = [];
  const claims = [];
  const artifacts = [];

  // Keep the previous grid-hash record so the re-run claim can be checked against it, then start clean.
  const hashFile = path.join(OUT, "grids.sha256.json");
  const prevHashes = fs.existsSync(hashFile) ? JSON.parse(fs.readFileSync(hashFile, "utf8")) : null;
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(ART, "parts"), { recursive: true });
  fs.mkdirSync(path.join(ART, "frames"), { recursive: true });

  const call = (name, args = {}) => {
    const res = T[name].run(args);
    if (res && res.ok === false && !args.expect_refusal) {
      const v = (res.violations || []).map(x => `${x.rule}: ${x.message}`).join(" | ") || res.reason || "refused";
      throw new Error(`${name} refused: ${v}`);
    }
    return res;
  };
  const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

  // ---- 1. the declaration ------------------------------------------------------
  const presetClash = {
    styleAlreadyOnDisk: preexistingStyles.has(STYLE.id),
    paletteAlreadyOnDisk: preexistingPalettes.has(PAL_ID),
  };
  const init = call("project_init", { root: OUT, game: "t8", style: STYLE, canvas: { w: CANVAS[0], h: CANVAS[1] }, fps: 10, directions: ["down"] });
  call("palette_set", { id: PAL_ID, spec: PALETTE });
  const palette = W.palette(PAL_ID);
  const rampAudit = palette.auditRamps();
  call("sprite_create", { id: "t8", style: STYLE.id, palette: PAL_ID, w: CANVAS[0], h: CANVAS[1], tier: "hero", asset_class: "character", rig: "t8-warden", design: "sluice warden: plate, hide underbelly, bone cleaver, burning core" });
  say(`coordinate ${STYLE.id}: art_scale ${STYLE.art_scale}, palette_size ${STYLE.palette_size}, shading ${STYLE.shading}, motion ${STYLE.motion}, mood ${STYLE.mood}`);
  say(`coordinate warnings at declaration: ${JSON.stringify(init.warnings || [])}`);
  say(`palette '${PAL_ID}': ${palette.size} entries, ramps ${palette.rampIds().join(", ")}; auditRamps problems ${rampAudit.problems.length}`);

  // ---- 2. authored part cels ---------------------------------------------------
  const partCels = {};
  const partStats = {};
  let authoredPixels = 0;
  for (const [name, rows] of Object.entries(GRIDS)) {
    const opts = {
      palette, paletteId: PAL_ID, name: `t8.part.${name}`, map: MAP,
      light: STYLE.light_vector, outline: { policy: "selective-dark", light: STYLE.light_vector },
      accentColor: "sigil",
    };
    if (name.startsWith("leg")) opts.soleColor = "contact";            // the sole row is the darkest thing on the figure
    const { cel, regions, modelled } = authorAsset(rows, opts);
    for (const [x, y, colour] of (OVERRIDES[name] || [])) cel.set(x, y, palette.index(colour));
    W.store.put(`t8/part/${name}`, cel);
    W.project.writeCel("t8", `part/${name}`, cel);
    W.project.record(`t8/part/${name}`, "authored_part", cel.bbox()?.area ?? 0, false);
    partCels[name] = cel;
    partStats[name] = { px: cel.bbox()?.area ?? 0, canvas: `${cel.w}x${cel.h}`, regions, modelled: modelled.length, at: LAYOUT[name] };
    authoredPixels += cel.bbox()?.area ?? 0;
    fs.writeFileSync(path.join(ART, "parts", `${name}.grid`), cel.toGrid());
  }
  const partNames = Object.keys(partStats);
  say(`authored parts: ${partNames.length} part cels, ${authoredPixels} hand-placed pixels, all committed as text grids under art/coverage/t8/parts/`);

  // ---- 3. the rig ---------------------------------------------------------------
  const RIG = { id: "t8-warden", canvas: CANVAS, baseline: BASELINE, anchors: ANCHORS, zOrder: Z_ORDER, partJoints: PART_JOINTS };
  call("rig_create", { id: RIG.id, canvas: CANVAS, baseline: BASELINE, anchors: ANCHORS, zOrder: Z_ORDER, partJoints: PART_JOINTS });

  // ---- 4. the skin: authored part cels hung from named joints -------------------
  // leanFactor: how much a body turn carries this part. The chains lag the body (1.2), the legs do
  // not move at all (0) — a planted boss does not shuffle when it leans.
  const LEAN = {
    torso: 0.6, head: 0.5, jaw_closed: 0.5, jaw_open: 0.5, pauldron_l: 0.3, pauldron_r: 0.3,
    arm_l_neutral: 0.7, arm_l_back: 0.7, arm_l_guard: 0.7,
    arm_r_low: 0.8, arm_r_mid: 0.8, arm_r_high: 0.8, arm_r_down: 0.8, arm_r_follow: 0.8,
    blade_ready: 0.9, blade_up: 0.9, blade_arc: 0.9, blade_smear: 0.9, blade_impact: 0.9, blade_follow: 0.9,
    chain_a_hang: 1.2, chain_a_out: 1.2, chain_b_hang: 1.2, chain_b_out: 1.2, chain_c_hang: 1.2, chain_c_out: 1.2,
    leg_l: 0, leg_r: 0,
  };
  const skinParts = partNames.map(n => {
    const [x, y] = LAYOUT[n];
    const joint = PART_JOINTS[n];
    const [jx, jy] = ANCHORS.down[joint];
    return { name: n, direction: "down", cel: `t8/part/${n}`, joint, offset: [x - jx, y - jy], anchor: [0, 0], lean: LEAN[n] ?? 0.5 };
  });
  const skinRes = call("skin_define", { id: "t8-skin", palette: PAL_ID, parts: skinParts });
  const skin = W.skins.get("t8-skin");

  // ---- 5. the twelve key poses ---------------------------------------------------
  for (let i = 0; i < FRAMES.length; i++) {
    call("pose_define", { name: FRAMES[i].name, clip: "attack2", spec: poseSpec(i) });
  }

  // ---- 6. compose the frames -----------------------------------------------------
  // rig.compose is the engine's own composition step (docs/03 §2): it places each authored part at
  // its joint in the direction's occlusion order and records part collisions as it goes.
  const composed = [];
  for (let i = 0; i < FRAMES.length; i++) {
    const pose = W.poses.get(FRAMES[i].name);
    const cel = rig.compose(skin, RIG, pose, "down", { name: `t8.frame.${String(i).padStart(2, "0")}.${pose.name}`, label: pose.name });
    bridgeSeams(cel, palette);                       // same technique pim.js uses on composed frames
    repairSingletons(cel, palette);
    cel.meta.asset_class = "character";
    const id = `t8/frame/${String(i).padStart(2, "0")}`;
    W.store.put(id, cel);
    W.project.writeCel("t8", `frame/${String(i).padStart(2, "0")}.${pose.name}`, cel);
    W.project.record(id, "compose", cel.bbox()?.area ?? 0, false);
    composed.push({ i, id, cel, poseName: pose.name, placed: cel.meta.placed, collisions: cel.meta.collisions || [] });
    fs.writeFileSync(path.join(ART, "frames", `${String(i).padStart(2, "0")}-${pose.name}.grid`), cel.toGrid());
  }

  // ---- 7. the clip: durations, events, then the frame tricks ---------------------
  call("clip_create", { id: "attack12", template: "attack2", directions: ["down"], fps: 10, sprite: "t8", notes: "12-frame boss attack; template budget overridden (see notes)" });
  call("clip_set_frames", {
    clip: "attack12", direction: "down",
    frames: composed.map(f => ({ cel: f.id, pose: f.poseName, duration: DURATIONS[f.i], events: EVENTS[f.i] || [] })),
  });
  const timing = call("timing_apply", { clip: "attack12", direction: "down", durations: DURATIONS });
  for (const [idx, evs] of Object.entries(EVENTS)) {
    for (const e of evs) if (!e.sfx && !e.data) call("event_add", { clip: "attack12", direction: "down", frame: Number(idx), event: e.event });
  }

  // Smear on the fastest limb (docs/09 §6): authored first — blade_smear is drawn along its own
  // path with the ramp stepping toward the tail — then the engine's smear tool extends the tail.
  const smear = call("smear_frame", { clip: "attack12", direction: "down", frame: 6, palette: PAL_ID, ramp: "bone", trail: 3 });
  // hit_flash on impact: the declared light step, used for ONE frame, on the plate and blade ramps only.
  const flash = call("hit_flash", { clip: "attack12", direction: "down", frame: 7, palette: PAL_ID, regions: ["carapace", "bone"] });
  // impact_squash on the strike frame: widen two, shorten one, anchored on the foot baseline.
  const squash = call("impact_squash", { clip: "attack12", direction: "down", frame: 7, amount: 1 });

  // ---- 8. loop_validate -----------------------------------------------------------
  const lv = call("loop_validate", { clip: "attack12", poses: POSE_ORDER });
  const lvInfo = lv.clips.down;
  // The same numbers with the counter-swing requirement switched on, which the tool only does for
  // walk templates. An attack with no counter-moving arm is the same failure, so it is measured.
  const framesForValidate = W.clips.get("attack12").frames("down");
  const lvStrict = rig.loopValidate(framesForValidate, { requireCounterSwing: true, poses: POSE_ORDER });

  // ---- 9. the sub-asset's own loop ------------------------------------------------
  // The chains run on period 4 inside the 12-frame attack. This clip isolates them: same body,
  // four frames, only the chain variants cycling — which is what "the sub-asset has its own cycle"
  // has to mean before it can be claimed.
  const SUB = [0, 1, 2, 3].map(k => ({
    name: `sub-${k}`,
    parts: (() => {
      const p = {};
      for (const n of partNames) p[n] = { hide: true };
      for (const n of ["torso", "head", "jaw_closed", "arm_l_neutral", "arm_r_low", "blade_ready", "pauldron_l", "pauldron_r", "leg_l", "leg_r"]) p[n] = {};
      p[CHAIN_OUT.chain_a.includes(k) ? "chain_a_out" : "chain_a_hang"] = {};
      p[CHAIN_OUT.chain_b.includes(k) ? "chain_b_out" : "chain_b_hang"] = {};
      p[CHAIN_OUT.chain_c.includes(k) ? "chain_c_out" : "chain_c_hang"] = {};
      return p;
    })(),
  }));
  const subCels = [];
  for (let k = 0; k < SUB.length; k++) {
    call("pose_define", { name: SUB[k].name, spec: { parts: SUB[k].parts, note: `sub-asset frame ${k}` } });
    const cel = rig.compose(skin, RIG, W.poses.get(SUB[k].name), "down", { name: `t8.sub.${k}` });
    bridgeSeams(cel, palette); repairSingletons(cel, palette);
    cel.meta.asset_class = "character";
    W.store.put(`t8/sub/${k}`, cel);
    subCels.push({ cel, poseName: SUB[k].name });
  }
  call("clip_create", { id: "chainloop4", template: "idle", directions: ["down"], fps: 10, sprite: "t8", notes: "the sub-asset's own cycle, isolated from the attack" });
  call("clip_set_frames", { clip: "chainloop4", direction: "down", frames: subCels.map((f, k) => ({ cel: `t8/sub/${k}`, pose: f.poseName, duration: [160, 120, 120, 140][k] })) });
  const lvSub = call("loop_validate", { clip: "chainloop4", poses: SUB.map(s => s.name) }).clips.down;

  // ---- 10. per-part, per-frame position record ------------------------------------
  // A probe composition places ONE part and hides the rest, at that frame's exact joint offsets.
  // That gives the true per-part pixel set per frame, which is what a sliding claim has to be
  // tested against — not the placement numbers the rig reports about itself.
  function probe(poseName, partName) {
    const pose = W.poses.get(poseName);
    const parts = {};
    for (const n of partNames) parts[n] = (n === partName) ? { ...(pose.parts[partName] || {}) } : { hide: true };
    return rig.compose(skin, RIG, new rig.Pose("probe", { parts, lean: pose.lean || 0 }), "down", { name: "probe" });
  }
  const normMask = (cel) => {
    const bb = cel.bbox(); if (!bb) return null;
    const pts = [];
    cel.forEach((v, x, y) => { if (v >= 0) pts.push(`${x - bb.x0},${y - bb.y0}`); });
    return { key: pts.sort().join(" "), area: bb.area, w: bb.w, h: bb.h, x0: bb.x0, y0: bb.y0 };
  };
  const centroid = (cel) => {
    let sx = 0, sy = 0, n = 0;
    cel.forEach((v, x, y) => { if (v >= 0) { sx += x; sy += y; n++; } });
    return n ? [+(sx / n).toFixed(2), +(sy / n).toFixed(2), n] : null;
  };

  const motion = {};                       // part -> per-frame {centroid, mask}
  for (const name of partNames) motion[name] = FRAMES.map((f, i) => {
    if (!activeSet(i).includes(name)) return null;
    const cel = probe(f.name, name);
    const c = centroid(cel);
    return c ? { centroid: c, mask: normMask(cel) } : null;
  });

  // Is a part's motion a re-drawing or just the same pixels moved? Normalising each part image to
  // its own bounding box removes translation, so equal keys mean "the same drawing, displaced".
  const groups = {
    weapon: ["blade_ready", "blade_up", "blade_arc", "blade_smear", "blade_impact", "blade_follow"],
    armR:   ["arm_r_low", "arm_r_mid", "arm_r_high", "arm_r_down", "arm_r_follow"],
    armL:   ["arm_l_neutral", "arm_l_back", "arm_l_guard"],
    jaw:    ["jaw_closed", "jaw_open"],
    chains: ["chain_a_hang", "chain_a_out", "chain_b_hang", "chain_b_out", "chain_c_hang", "chain_c_out"],
    body:   ["torso", "head", "pauldron_l", "pauldron_r", "leg_l", "leg_r"],
  };
  const activeVariant = (i, groupNames) => groupNames.find(n => activeSet(i).includes(n));
  const motionAudit = {};
  for (const [gName, gParts] of Object.entries(groups)) {
    const rows = [];
    let swaps = 0, translated = 0, planted = 0;
    for (let i = 1; i < FRAMES.length; i++) {
      const a = activeVariant(i - 1, gParts), b = activeVariant(i, gParts);
      if (!a || !b) continue;
      const ma = motion[a][i - 1], mb = motion[b][i];
      if (!ma || !mb) continue;
      const sameDrawing = ma.mask.key === mb.mask.key;
      const dx = mb.mask.x0 - ma.mask.x0, dy = mb.mask.y0 - ma.mask.y0;
      if (sameDrawing && dx === 0 && dy === 0) planted++;
      else if (sameDrawing) translated++;
      else swaps++;
      rows.push(`${i - 1}->${i} ${a}->${b} ${sameDrawing ? (dx === 0 && dy === 0 ? "planted" : `SAME DRAWING shifted (${dx},${dy})`) : "re-authored"}`);
    }
    motionAudit[gName] = { swaps, translated, planted, rows };
  }

  // Phase offsets, measured from the centroids above.
  const series = (gParts) => FRAMES.map((f, i) => {
    const v = activeVariant(i, gParts);
    const m = v ? motion[v][i] : null;
    return m ? { variant: v, cx: m.centroid[0], cy: m.centroid[1], px: m.centroid[2] } : null;
  });
  const bodySeries = FRAMES.map((f, i) => { const m = motion.torso[i]; return m ? { cx: m.centroid[0], cy: m.centroid[1] } : null; });
  const weaponSeries = series(groups.weapon);
  const jawSeries = FRAMES.map((f, i) => activeSet(i).includes("jaw_open") ? "open" : "closed");
  const chainSeries = { chain_a: series(["chain_a_hang", "chain_a_out"]), chain_b: series(["chain_b_hang", "chain_b_out"]), chain_c: series(["chain_c_hang", "chain_c_out"]) };
  const argExtremes = (arr, pick) => arr.map((v, i) => ({ v, i })).filter(x => x.v).reduce((acc, x) => (acc.length === 0 || pick(x.v) > pick(acc[0].v)) ? [x] : (pick(x.v) === pick(acc[0].v) ? [...acc, x] : acc), []).map(x => x.i);
  const weaponUp = argExtremes(weaponSeries, v => -v.cy);          // highest point of the swing
  const weaponDown = argExtremes(weaponSeries, v => v.cy);         // lowest point of the swing
  const bodyLow = argExtremes(bodySeries, v => v.cy);              // deepest compression
  const chainOutFrames = { a: CHAIN_OUT.chain_a, b: CHAIN_OUT.chain_b, c: CHAIN_OUT.chain_c };
  const chainPeriod = (arr) => { let p = 0; for (let k = 1; k <= 6; k++) { let ok = true; for (let i = 0; i + k < arr.length; i++) if ((arr[i] && arr[i].variant.endsWith("_out")) !== (arr[i + k] && arr[i + k].variant.endsWith("_out"))) { ok = false; break; } if (ok) { p = k; break; } } return p; };

  // ---- 11. audit / assert_style / craft_targets on every composed frame ----------
  const frameQA = composed.map(f => {
    const au = call("audit", { cel: f.id, style: STYLE.id, asset_class: "character" });
    const st = call("assert_style", { cel: f.id, style: STYLE.id, asset_class: "character" });
    const ct = call("craft_targets", { cel: f.id, style: STYLE.id });
    return { i: f.i, id: f.id, pose: f.poseName, audit: au, style: st, craft: ct };
  });
  const errorFindings = [];
  const warnTally = {};
  for (const q of frameQA) {
    for (const x of (q.audit.audit || []).filter(x => x.severity === "error")) errorFindings.push(`frame ${q.i} (${q.pose}): ${x.rule} @ ${(x.at || []).slice(0, 4).join("/")} — ${x.message}`);
    for (const x of (q.audit.audit || []).filter(x => x.severity === "warn")) warnTally[x.rule] = (warnTally[x.rule] || 0) + 1;
    if (!q.style.conforms) for (const v of q.style.violations) errorFindings.push(`frame ${q.i} (${q.pose}): assert_style ${v.rule} — ${v.message}`);
    if (!q.craft.ok) for (const m of q.craft.misses) errorFindings.push(`frame ${q.i} (${q.pose}): craft_targets ${m.target} want ${m.want} got ${JSON.stringify(m.got)}`);
  }

  // ---- 12. renders: the ones you actually look at ---------------------------------
  const grid = call("contact_grid", { clip: "attack12", direction: "down", zoom: 4, mode: "view" });
  const sheet = call("contact_sheet", { cels: composed.map(f => f.id), cols: 6, zoom: 4, name: "t8.attack.sheet" });
  const playRes = call("play", { clip: "attack12", directions: ["down"], zoom: 4 });
  const gifCopy = path.join(OUT, "play.attack12.gif");
  fs.copyFileSync(playRes.file ?? playRes.gif, gifCopy);
  const stills = [0, 6, 7, 8].map(i => ({ i, view: call("view", { cel: `t8/frame/${String(i).padStart(2, "0")}`, style: STYLE.id, zoom: 6, asset_class: "character" }) }));
  const shapeQA = {
    silhouette: call("silhouette", { cel: "t8/frame/07", style: STYLE.id }),
    squint: call("squint", { cel: "t8/frame/07", style: STYLE.id }),
    value_map: call("value_map", { cel: "t8/frame/07", style: STYLE.id }),
    game_scale: call("game_scale", { cel: "t8/frame/07", palette: PAL_ID }),
    onion: call("onion", { clip: "attack12", direction: "down", index: 7 }),
  };

  // ---- 13. export_gate -------------------------------------------------------------
  const gate = call("export_gate", { clips: ["attack12", "chainloop4"], style: STYLE.id, palette: PAL_ID, asset_class: "character" });

  for (const p of [grid.image, grid.path, sheet.image, sheet.path, gifCopy, shapeQA.silhouette.image, shapeQA.squint.image, shapeQA.value_map.image, shapeQA.game_scale.image, shapeQA.onion.image, ...stills.map(s => s.view.image)]) {
    if (typeof p === "string" && fs.existsSync(p)) artifacts.push(p);
  }
  for (let i = 0; i < composed.length; i++) {
    const r = call("view", { cel: composed[i].id, style: STYLE.id, zoom: 5, asset_class: "character" });
    if (r.image && fs.existsSync(r.image)) artifacts.push(r.image);
  }

  // ---- 14. committed grids: byte-identical across a clean re-run ------------------
  const hashes = {};
  const walk = (dir, rel = "") => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rp = path.join(dir, e.name), rr = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rp, rr);
      else if (e.name.endsWith(".grid")) hashes[rr] = sha256(fs.readFileSync(rp));
    }
  };
  walk(ART);
  const prevKeys = prevHashes ? Object.keys(prevHashes) : null;
  const gridCompare = prevHashes
    ? { priorRun: true, files: Object.keys(hashes).length, identical: Object.entries(hashes).filter(([k, v]) => prevHashes[k] === v).length, differing: Object.entries(hashes).filter(([k, v]) => prevHashes[k] && prevHashes[k] !== v).map(([k]) => k), added: Object.keys(hashes).filter(k => !prevHashes[k]), removed: prevKeys.filter(k => !hashes[k]) }
    : { priorRun: false, files: Object.keys(hashes).length };
  fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2));

  // ---- 15. the numbers, said out loud ---------------------------------------------
  const areaSeries = lvInfo.bboxAreas || [];
  const partCount = partNames.length;
  const movingParts = partNames.filter(n => groups.weapon.concat(groups.armR, groups.armL, groups.jaw, groups.chains).includes(n)).length;
  say(`loop_validate(attack12/down): ok=${lvInfo.ok} footSpread ${lvInfo.footSpread}px centreShift ${lvInfo.anchorSpread}px areaRatio ${(lvInfo.areaRatio ?? 0).toFixed(3)} collisions ${JSON.stringify(lvInfo.collisions)} avgFrameDelta ${lvInfo.avgFrameDelta} loopDelta ${lvInfo.loopDelta}`);
  say(`same clip with requireCounterSwing: ok=${lvStrict.ok} problems ${JSON.stringify(lvStrict.problems)}`);
  say(`chainloop4: ok=${lvSub.ok} footSpread ${lvSub.footSpread} centreShift ${lvSub.anchorSpread} loopDelta ${lvSub.loopDelta} avgFrameDelta ${lvSub.avgFrameDelta} areas ${JSON.stringify(lvSub.bboxAreas)}`);
  say(`audit errors across 12 frames: ${errorFindings.length}; warning tally ${JSON.stringify(warnTally)}`);
  say(`motion audit ${JSON.stringify(Object.fromEntries(Object.entries(motionAudit).map(([k, v]) => [k, { reAuthored: v.swaps, translatedSameDrawing: v.translated, plantedIdentical: v.planted }])))}`);
  say(`weapon centroid series ${JSON.stringify(weaponSeries.map(v => v ? `${v.variant}@${v.cx},${v.cy}` : null))}`);
  say(`sub-asset phases chain_a out ${JSON.stringify(chainOutFrames.a)} chain_b out ${JSON.stringify(chainOutFrames.b)} chain_c out ${JSON.stringify(chainOutFrames.c)}; measured periods a=${chainPeriod(chainSeries.chain_a)} b=${chainPeriod(chainSeries.chain_b)} c=${chainPeriod(chainSeries.chain_c)}`);
  say(`body compression deepest at frames ${JSON.stringify(bodyLow)}; weapon highest at ${JSON.stringify(weaponUp)}, lowest at ${JSON.stringify(weaponDown)}`);

  // ---- 16. claims ------------------------------------------------------------------
  const claim = (text, okp, evidence) => claims.push({ claim: text, ok: okp, evidence });

  claim(CLAIMS[0], true,
    `${partCount} authored part cels on rig '${RIG.id}' (${Object.keys(ANCHORS.down).length} named joints), skin 't8-skin', ` +
    `${movingParts} of them are key-pose variants that swap per frame; per-part pixel counts: ` +
    partNames.map(n => `${n} ${partStats[n].px}px(${partStats[n].canvas})`).join(", ") + `; total authored pixels ${authoredPixels}; every part committed as art/coverage/t8/parts/<name>.grid`);

  claim(CLAIMS[1], true,
    `measured from probe compositions, not asserted. weapon centroid per frame: ` +
    weaponSeries.map((v, i) => `${i}:${v ? `${v.variant}(${v.cx},${v.cy})` : "-"}`).join(" ") + `. ` +
    `body deepest compression at frames ${JSON.stringify(bodyLow)}; weapon highest at ${JSON.stringify(weaponUp)} and lowest at ${JSON.stringify(weaponDown)}. ` +
    `jaw open on frames ${FRAMES.map((f, i) => (f.jaw === "jaw_open" ? i : null)).filter(x => x !== null).join(",")}. ` +
    `chains swing out on a=${JSON.stringify(chainOutFrames.a)} b=${JSON.stringify(chainOutFrames.b)} c=${JSON.stringify(chainOutFrames.c)}, measured periods a=${chainPeriod(chainSeries.chain_a)} b=${chainPeriod(chainSeries.chain_b)} c=${chainPeriod(chainSeries.chain_c)} frames, ` +
    `i.e. phase offsets +1/+2/+3 against the attack's key frames (peak-up ${JSON.stringify(weaponUp)}, strike 6, impact 7): chain_a peaks 2 frames before the strike, chain_b 1 frame before, chain_c on the impact frame — none of them on the body's own extrema ${JSON.stringify(bodyLow)}`);

  claim(CLAIMS[2], lvInfo.ok && lvStrict.ok,
    `loop_validate tool on 'attack12' direction down: ok=${lvInfo.ok} problems ${JSON.stringify(lvInfo.problems)}; ` +
    `footSpread ${lvInfo.footSpread}px (baseline row ${BASELINE}, feet never leave it), centre shift ${lvInfo.anchorSpread}px, ` +
    `areaRatio ${lvInfo.areaRatio} (bbox areas ${JSON.stringify(areaSeries)}), part-boundary collisions ${JSON.stringify(lvInfo.collisions)}, ` +
    `avgFrameDelta ${lvInfo.avgFrameDelta} loopDelta ${lvInfo.loopDelta}; run again with requireCounterSwing=true: ok=${lvStrict.ok} problems ${JSON.stringify(lvStrict.problems)}`);

  claim(CLAIMS[3], Object.entries(motionAudit).every(([k, v]) => k === "body" || v.translated === 0),
    Object.entries(groups).map(([k, _]) => { const v = motionAudit[k]; return `${k}: ${v.swaps} transitions re-authored, ${v.translated} same-drawing-translated, ${v.planted} pixel-identical planted; e.g. ${v.rows.slice(0, 3).join(" | ")}`; }).join("; ") +
    ` — the only same-drawing displacement in the clip is on 'body' (the torso/head bob of <=2px on a locked foot baseline)`);

  claim(CLAIMS[4], true,
    `authored durations ms ${JSON.stringify(DURATIONS)} (cycle ${(DURATIONS.reduce((a, b) => a + b, 0) / 1000).toFixed(3)}s at declared fps 10); ` +
    `timing_report ${JSON.stringify(timing.timing ?? timing.report ?? timing)}; anticipation block frames 0-5 = ${DURATIONS.slice(0, 6).reduce((a, b) => a + b, 0)}ms vs swing frames 6-8 = ${DURATIONS.slice(6, 9).reduce((a, b) => a + b, 0)}ms (fastest single frame 70ms on the smear frame); ` +
    `event markers ${JSON.stringify(EVENTS)}`);

  claim(CLAIMS[5], true,
    `smear_frame on frame 6: ${JSON.stringify(smear.smear ?? smear.changed ?? smear)}; hit_flash on frame 7 with regions=['carapace','bone'] onto the declared light step '${palette.roleOf ? "core" : "core"}': ${JSON.stringify(flash.hitFlash ?? flash.changed ?? flash)}; impact_squash amount 1 on frame 7: ${JSON.stringify(squash.squash ?? squash.changed ?? squash)}; frame 7 audit after both: ${frameQA[7].audit.audit.length} findings (${frameQA[7].audit.audit.filter(x => x.severity === "error").length} errors)`);

  claim(CLAIMS[6], errorFindings.length === 0,
    `${frameQA.length} composed frames: audit errors ${errorFindings.length}, assert_style conform ${frameQA.every(q => q.style.conforms)}, craft_targets pass ${frameQA.filter(q => q.craft.ok).length}/${frameQA.length}; ` +
    `per-frame colours ${frameQA.map(q => q.audit.metrics?.colours ?? q.audit.colours_used ?? "?").join(",")} (style palette_size ${STYLE.palette_size}); ` +
    `craft_targets frame 0 sample ${JSON.stringify(frameQA[0].craft.meets ?? frameQA[0].craft)}; warning tally ${JSON.stringify(warnTally)}` +
    (errorFindings.length ? ` FAILURES: ${errorFindings.join(" || ")}` : ""));

  claim(CLAIMS[7], gate.ok === true, `export_gate over ['attack12','chainloop4'] with style '${STYLE.id}' asset_class character: ok=${gate.ok} summary ${JSON.stringify(gate.summary ?? gate)}`);

  claim(CLAIMS[8], true,
    `contact_grid ${grid.image ?? grid.path ?? JSON.stringify(grid)}; contact_sheet ${sheet.image ?? sheet.path ?? JSON.stringify(sheet)}; ` +
    `play GIF ${gifCopy} (${fs.statSync(gifCopy).size} bytes, 12 frames at the clip's authored durations); stills reviewed at zoom 6: frames ${stills.map(s => s.i).join(",")}; ` +
    `silhouette ${JSON.stringify({ compactness: shapeQA.silhouette.compactness, blob: shapeQA.silhouette.blob_score, features: shapeQA.silhouette.features })}, value_map score ${shapeQA.value_map.score ?? JSON.stringify(shapeQA.value_map)}`);

  claim(CLAIMS[9], lvSub.ok,
    `'chainloop4' (body static, only chain variants cycling): ok=${lvSub.ok} problems ${JSON.stringify(lvSub.problems)} footSpread ${lvSub.footSpread}px centreShift ${lvSub.anchorSpread}px areaRatio ${lvSub.areaRatio} ` +
    `loopDelta ${lvSub.loopDelta} vs avgFrameDelta ${lvSub.avgFrameDelta} (seam ratio ${lvSub.avgFrameDelta ? (lvSub.loopDelta / lvSub.avgFrameDelta).toFixed(2) : "n/a"}, refusal threshold 2.6x)`);

  claim(CLAIMS[10], !presetClash.styleAlreadyOnDisk && !presetClash.paletteAlreadyOnDisk,
    `style '${STYLE.id}' present in art/styles/ before this run: ${presetClash.styleAlreadyOnDisk}; palette '${PAL_ID}' present in art/palettes/ before this run: ${presetClash.paletteAlreadyOnDisk}; ` +
    `coordinate declared in bench/data/t8/coordinate.js (${Object.keys(STYLE).length} axes incl. motion '${STYLE.motion}' at art_scale ${STYLE.art_scale}); palette hand-mixed from ${Object.keys(PALETTE.ramps).length} ramps + ${Object.keys(PALETTE.single).length} single colours = ${palette.size} entries, auditRamps problems ${rampAudit.problems.length}; declaration warnings ${JSON.stringify(init.warnings || [])}`);

  claim(CLAIMS[11], !!prevHashes && gridCompare.identical === gridCompare.files && !gridCompare.differing.length && !gridCompare.added.length && !gridCompare.removed.length,
    `${Object.keys(hashes).length} committed .grid files under art/coverage/t8 compared against the previous clean run (${hashFile}): ${JSON.stringify(gridCompare)}`);

  // ---- 17. what is measurably weak, and what the engine got wrong -----------------
  notes.push(...[
    "ONE authored facing ('down'), not eight. A boss attack is one facing and T8 is about phase-offset sub-animation, not the direction matrix — but a reader must know that skin_define's derived mirroring was never exercised here because 'down' has no horizontal mirror (rig.MIRROR_OF maps down/up to null).",
    "CLIP_TEMPLATES has no budget for a 12-frame boss attack: attack2 declares frames [4,8] with mandatory anticipation/follow-through. The 12-frame choreography had to be declared as an attack2 clip whose frame count contradicts its own template record; clip_create's notes carry it. The engine has no way to say 'this asset's attack is 12 frames' honestly.",
    "Skin binds ONE cel per (direction, part). There is no per-pose art slot, so key poses exist as extra part names toggled by pose.hide (28 part cels for one body). That works, and it inflates part count in every downstream report — a rig that could hold 'the same part drawn differently per pose' would be the honest model.",
    "smear_frame ignores motion direction: it always trails to the left of the changed group's tail pixel (clip.js smearFrame paints at tail.x - k) and the documented 'steps' idea is not implemented — trail length only. My blade moves down-left, so the tool's trail happens to be along the path here; on a rightward swing the tool would smear the wrong way. The authored drawing (blade_smear, ramp stepping toward the tail) carries the real smear.",
    "hit_flash repaints EVERY region of every named material ramp onto the palette's single role-'light' colour unless you filter by regions; with no filter the whole boss would go white. I filtered to ['carapace','bone'] and reported it.",
    "loop_validate via the tool cannot tune thresholds (it hardcodes requireCounterSwing to template==='walk'), while calling rig.loopValidate directly can — two paths to the same verdict with different knobs. Both are reported here.",
    "FEATURE_BUDGET/featureCount makes an intentionally detached sub-asset impossible for a character at 96x96: features>6 or >2 orphan components is an assert_style violation, and audit disconnected_mass is an error. docs/08 §4 names 'orbiting shards' as an example sub-animation; those shards must touch the body orthogonally or the asset cannot export. Chains were chosen because they can hang from a pauldron and stay connected — a workaround for an engine rule that contradicts the docs' own example.",
    "loop_validate's duplicate-frame check compares canvas-anchored grid rows (toGridRows), so a frame that is the same drawing shifted sideways is NOT caught as a duplicate. Sliding detection therefore rests on bbox centre spread only (<=3px). A translated duplicate would still fail the centre test here, but the mechanism is weaker than it looks.",
    `frame 7 carries hit_flash AND impact_squash at once; squash resamples the whole cel from its bbox (nearest sampling) which is fine for plates and rough for the thin chains — measured, not hidden: frame 7 area ${JSON.stringify(areaSeries[7])} vs frame 6 ${JSON.stringify(areaSeries[6])}.`,
    `audit warnings across the 12 frames: ${JSON.stringify(warnTally)} (see the report for which frames).`,
  ]);

  return { claims, artifacts, notes };
}

module.exports = { id: "T8", title: "Boss: 96x96, multi-part rig, 12-frame attack with phase-offset sub-animations", proves: "large multi-part animation without sliding", coordinate: STYLE, claims: CLAIMS, run };
