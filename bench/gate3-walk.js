// PHASE 3 GATE, STAGE 2 — the 4-frame walk, the rig, and playback.
//
// Runs on top of stage 1 (out/gate3 must already exist). Two design calls were made after the
// stage-1 measurement and are recorded here rather than quietly applied:
//   - the front view's satchel and right arm were one mass, so he had no visible right arm.
//     The bag moved below the hand and the arm got its own column of air.
//   - the back view adopts variant B (bag on the back). Variant A measured lower and is kept in
//     the record as a rejected option.
"use strict";

const path = require("path");
const fs = require("fs");
const { TOOLS, W } = require("../src/tools.js");
const rig = require("../src/core/rig.js");
const P = require("../src/pim.js");
const { audit } = require("../src/audit.js");
const { craftScore } = require("../src/craft.js");
const { negativeSpace } = require("../src/core/style.js");

const ROOT = path.join(__dirname, "..", "out", "gate3");
if (!fs.existsSync(path.join(ROOT, "art", "project.json"))) {
  console.error("stage 1 has not run. Run `npm run gate3` first — the walk is built on the approved silhouette.");
  process.exit(1);
}

const call = (name, args = {}) => {
  const res = TOOLS[name].run(args);
  if (res && res.ok === false && !args.expect_refusal) {
    const v = (res.violations || []).map(x => `${x.rule}: ${x.message}`).join(" | ") || res.reason || "refused";
    throw new Error(`${name} refused: ${v}`);
  }
  return res;
};
const out = [];
const say = (s) => { out.push(s); console.log(s); };

W.load(ROOT);
const STYLE = W.styleOf("late-courier");

say("PHASE 3 GATE, STAGE 2 — rig, 4-frame walk, playback\n");
say("  DESIGN CALLS MADE AFTER THE STAGE-1 MEASUREMENT");
say("    front: the satchel and the right arm were one mass (cols 11-14, rows 13-17) — he had no");
say("      visible right arm. The bag now hangs from the belt BELOW the hand, and the arm keeps");
say("      its own column of air. Three masses now read as three things.");
say("    back: variant B (bag on the back) adopted. It measured higher — shape 0.802 vs 0.762,");
say("      blob 0.954 vs 0.911 — and it answers 'what is he carrying?' from behind.");
say("      Variant A stays in the record as a rejected option, not deleted.\n");

// ---- 1. the rig -----------------------------------------------------------------
call("rig_create", {
  id: "pim", canvas: P.CANVAS, baseline: P.BASELINE,
  anchors: P.RIG.anchors, zOrder: P.RIG.zOrder, partJoints: P.RIG.partJoints,
});
say(`  rig          facings [${Object.keys(P.RIG.anchors).join(", ")}], foot baseline y=${P.BASELINE}`);
say(`               joints: hip, shoulder_l, shoulder_r, head. Every limb hangs from a joint,`);
say(`               so a knee is the same knee in all four frames of all four facings.`);

// ---- 2. authored part cels ------------------------------------------------------
let partCount = 0, partPixels = 0;
for (const [key, rows] of Object.entries(P.GRIDS)) {
  const [direction, name] = key.split("/");
  const { cel } = P.parsePart(key, rows);
  cel.paletteId = "courier";
  const celId = `pim/part/${direction}/${name}`;
  W.store.put(celId, cel);
  W.project.writeCel("pim", `part/${direction}/${name}`, cel);
  W.project.record(celId, "authored_part", cel.bbox()?.area ?? 0, false);
  partCount++; partPixels += cel.bbox()?.area ?? 0;
}
say(`  parts        ${partCount} authored part cels, ${partPixels} authored pixels, written as text grids`);

// ---- 3. skin --------------------------------------------------------------------
const parts = [];
for (const [key] of Object.entries(P.GRIDS)) {
  const [direction, name] = key.split("/");
  const j = P.RIG.partJoints[name];
  const [absX, absY] = P.LAYOUT[direction][name];
  // A part hangs from a joint, so its offset is measured FROM that joint, not from the canvas
  // corner. Authoring in canvas coordinates and converting here is what keeps a knee the same
  // knee in every frame: the joint is the invariant, the offset is derived.
  const joint = P.RIG.anchors[direction][j.joint];
  parts.push({
    direction, name, cel: `pim/part/${direction}/${name}`, joint: j.joint,
    offset: [absX - joint[0], absY - joint[1]],
    lean: name === "bag" ? 1.2 : name.startsWith("arm") ? 0.6 : 0,
  });
}
const sk = call("skin_define", { id: "pim", palette: "courier", parts });
say(`  skin         ${sk.part_cels} part cels across authored facings [${sk.authored_directions.join(", ")}]`);

// ---- 4. poses -------------------------------------------------------------------
for (const pose of P.WALK) call("pose_define", { name: pose.name, clip: "walk", spec: pose });
say(`  poses        ${P.WALK.map(p => `${p.name}(w${p.weight})`).join("  ")}`);
say(`               authored once, reused across every facing. A facing changes the stride,`);
say(`               not the pose — the per-facing tweaks live in dirMods.`);

// ---- 5. compose the walk --------------------------------------------------------
const DIRS = ["down", "right", "left", "up"];
call("clip_create", { id: "walk", template: "walk", sprite: "pim", fps: 8, directions: DIRS });
const skin = W.skins.get("pim");
let composed = 0, seamBridges = 0;
for (const dir of DIRS) {
  const frames = P.WALK.map((pose, i) => {
    const cel = rig.compose(skin, P.RIG, new rig.Pose(pose.name, pose), dir, { name: `pim/walk/${dir}/f${i}`, label: `walk ${i}` });
    cel.paletteId = "courier";
    // The seam pass runs on the composed frame, because that is the first place the seam exists.
    const sm = P.smoothRamps(cel, W.palette("courier"));
    if (sm.bridges) seamBridges += sm.bridges;
    W.store.put(cel.name, cel);
    W.project.writeCel("pim", `walk/${dir}/f${i}`, cel);
    W.project.record(cel.name, "composed_from_authored_parts", 0, false);
    composed++;
    return { cel: cel.name, pose: pose.name };
  });
  call("clip_set_frames", { clip: "walk", sprite: "pim", direction: dir, frames });
}
const t = call("timing_apply", { clip: "walk", curve: "walk-stride", fps: 8 });
say(`  clip         walk: ${DIRS.length} facings x ${P.WALK.length} frames = ${composed} composed cels`);
say(`               ${seamBridges} seam pixel(s) re-stepped across part boundaries (the audit's own`);
say(`               prescribed fix, applied where the seam exists rather than pre-compensating each`);
say(`               part for every pose it could be put into)`);
say(`               cycle ${t.cycle_ms}ms, per-frame ${t.per_frame.join("/")}ms — a hold is a longer`);
say(`               duration, never a duplicated frame`);

// ---- 6. loop_validate: the gate -------------------------------------------------
const lv = call("loop_validate", { clip: "walk", expect_refusal: true });
say(`\n  LOOP VALIDATE`);
let fails = 0;
for (const [d, r] of Object.entries(lv.clips || {})) {
  if (d === "__frame_counts") { if (!r.ok) { fails++; say(`    FAIL frames  ${r.problem}`); } continue; }
  const okTag = r.ok ? "ok  " : "FAIL";
  if (!r.ok) fails++;
  say(`    ${okTag} ${d.padEnd(6)} footSpread=${r.footSpread ?? "-"}  anchorSpread=${r.anchorSpread ?? "-"}  areaRatio=${r.areaRatio ?? "-"}  collisions=${r.collisions ?? "-"}  loopDelta=${r.loopDelta ?? "-"}`);
  for (const p of (r.problems || []).slice(0, 4)) say(`         ${p.rule ?? ""} ${p.message ?? p}`);
}
say(`  ${fails} facing(s) failed the gate`);

// ---- 7. per-frame craft ---------------------------------------------------------
say(`\n  PER-FRAME MEASUREMENT`);
for (const dir of DIRS) {
  const row = P.WALK.map((pose, i) => {
    const cel = W.store.get(`pim/walk/${dir}/f${i}`); if (!cel || !cel.bbox()) return `${pose.name.slice(0,8)} EMPTY`;
    const bb = cel.bbox();
    const cs = craftScore(cel, W.palette("courier"), { assetClass: "character", style: STYLE });
    const ns = negativeSpace(cel);
    return `${pose.name.slice(0, 8)} ${String(bb.area).padStart(3)}px base${bb.y1} blob${cs.sub.blob} shp${cs.sub.shape} air${ns.enclosed}`;
  });
  say(`    ${dir.padEnd(6)} ${row.join("   ")}`);
}

// ---- 8. the frames themselves, in text ----------------------------------------
say(`\n  THE WALK, READ AS TEXT (right-facing: the facing where the stride is visible)`);
for (let i = 0; i < P.WALK.length; i++) {
  const cel = W.store.get(`pim/walk/right/f${i}`);
  const bb = cel.bbox();
  const rows = cel.toGrid().split("\n").filter(l => !l.startsWith("#")).map(r => r.replace(/ /g, "."));
  say(`    ${P.WALK[i].name.padEnd(9)} frame ${i}  ${P.WALK[i].note}`);
  rows.slice(bb.y0, bb.y1 + 1).forEach((r, n) => say(`      ${String(bb.y0 + n).padStart(2)} ${r}`));
}

// ---- 9. the review surfaces -----------------------------------------------------
const grid = call("contact_grid", { clip: "walk", palette: "courier", zoom: 6, mode: "silhouette", stamp: "PIM walk — 4 facings x 4 frames — silhouette, shared foot baseline" });
const colourGrid = call("contact_grid", { clip: "walk", palette: "courier", zoom: 6, mode: "view", stamp: "PIM walk — 4 facings x 4 frames — with colour" });
const gif = call("play", { clip: "walk", palette: "courier", directions: DIRS });
const gate = call("export_gate", { clips: ["walk"], style: "late-courier", palette: "courier", assetClass: "character", expect_refusal: true });

say(`\n  REVIEW SURFACES`);
say(`    silhouette contact grid : ${grid.image}`);
say(`    colour contact grid     : ${colourGrid.image}`);
say(`    playback GIF at 8fps    : ${gif.image || gif.gif || gif.file}`);
say(`    export_gate             : ${gate.ok ? "would allow export" : gate.summary}`);
for (const b of (gate.blocks || []).slice(0, 14)) {
  const detail = b.problems ? b.problems.map(p => p.rule ?? p.message ?? p).join(", ") : (b.violations || []).join(", ");
  say(`       ${b.clip}/${b.direction}${b.frame ? "/" + b.frame : ""}  ${b.rule}: ${detail}`);
}
for (const w of (gate.warnings || []).slice(0, 6)) say(`       warn ${w.rule}: ${JSON.stringify(w.detail ?? w.clip)}`);

// Name the pixels. A rule name tells you a rule fired; a coordinate tells you what to change.
say(`\n  WHY THE GATE REFUSES (the first refused frame, with coordinates)`);
{
  const b = (gate.blocks || [])[0];
  if (b) {
    const poseIdx = P.WALK.findIndex(p => p.name === b.frame);
    const cel = W.store.get(`pim/walk/${b.direction}/f${poseIdx >= 0 ? poseIdx : 0}`);
    const a = audit(cel, { palette: W.palette("courier"), style: STYLE, light: STYLE.light_vector });
    say(`    frame: ${b.direction} / ${b.frame}`);
    for (const f of a.findings.filter(x => x.severity === "error").slice(0, 8)) {
      say(`    ${f.rule} @ ${JSON.stringify(f.at ?? "-").slice(0, 300)}`);
      say(`      ${f.message}`);
      say(`      fix: ${f.fix ?? "-"}`);
    }
  }
}

say(`\n  WHAT STAGE 2 ASKS YOU`);
say(`    1. Watch the GIF. Does it read as walking, or as sliding?`);
say(`    2. Does the arm oppose the leg? (the gate measures counter-swing; only you can say if it`);
say(`       reads as a flustered courier rather than a metronome)`);
say(`    3. Is 8fps with a ${t.cycle_ms}ms cycle too fast, too slow, or right?`);
say(`    4. The bag swings with a lean factor of 1.2 — deliberately more than the body, because a`);
say(`       bag that does not lag a hurried person is not a bag. Too much?`);

fs.writeFileSync(path.join(__dirname, "..", "out", "gate3-stage2.txt"), out.join("\n"));
