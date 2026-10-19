// scratch probe for T3 authoring: declares the coordinate + palette, checks ramp discipline
// numbers, and probes direction_derive / compose / loop_validate plumbing before I commit to
// 40 authored part grids. Writes only under out/t3-probe. Not part of the gate.
"use strict";
const path = require("path");
const { TOOLS: T, W } = require("../../../src/tools.js");
const rig = require("../../../src/core/rig.js");
const { STYLE, PALETTE } = require("./style.js");

const ROOT = path.join(__dirname, "..", "..", "..", "out", "t3-probe");
const init = T.project_init.run({ root: ROOT, game: "t3probe", style: STYLE, canvas: { w: 32, h: 32 }, fps: 12 });
console.log("init:", JSON.stringify(init).slice(0, 400));
const pal = T.palette_set.run({ id: "t3-breaker", spec: PALETTE });
console.log("palette ok:", pal.ok, "size:", pal.size, "problems:", JSON.stringify(pal.problems));
if (!pal.ok) process.exit(1);
const p = W.palette("t3-breaker");
for (const r of p.rampIds()) {
  const list = p.ramp(r);
  console.log(`ramp ${r}: ` + list.map(i => `${p.entries[i].name} L${p.entries[i].value.toFixed(3)} ${p.entries[i].rgb}`).join(" | "));
}
console.log("singles:", p.entries.filter(e => !e.ramp).map(e => `${e.name}(${e.role}) L${e.value.toFixed(3)}`).join(", "));

// ---- probe: skin authored on cardinals only, then direction_derive for a diagonal ----------
const mk = (id, w, h, rows, legend) => {
  const cel = new (require("../../../src/core/cel.js").Cel)(w, h, "t3-breaker", id);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") cel.set(x, y, legend[ch]); }));
  W.store.put(id, cel);
  return id;
};
const leg = { w: 0 };
mk("probe/right/leg_near", 4, 6, ["hhhh", "hhhh", "hhhh", "tttt", "tttt", "tttt"], { h: 5, t: 20 });
mk("probe/right/body", 8, 12, ["wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww", "wwwwwwww"], { w: 0 });
const RIGDEF = {
  canvas: [32, 32], baseline: 29,
  anchors: { right: { hip: [14, 22], shoulder: [14, 11] }, down: { hip: [15, 22], shoulder: [15, 11] } },
  zOrder: { default: ["body", "leg_near"] },
  partJoints: { body: { joint: "hip" }, leg_near: { joint: "hip" } },
};
T.rig_create.run({ id: "probe", ...RIGDEF });
const sk = T.skin_define.run({
  id: "probe", palette: "t3-breaker",
  parts: [
    { direction: "right", name: "body", cel: "probe/right/body", joint: "hip", offset: [-2, -10] },
    { direction: "right", name: "leg_near", cel: "probe/right/leg_near", joint: "hip", offset: [-1, 2] },
  ],
});
console.log("skin:", JSON.stringify(sk));
for (const from of [["down", "right"], ["right", "down"], ["up", "right"]]) {
  const r = T.direction_derive.run({ skin: "probe", from, to: "down-right" });
  console.log(`direction_derive from [${from}] -> down-right:`, JSON.stringify(r).slice(0, 300));
}
// compose one frame and check the collision plumbing seen from two sides
const skin = W.skins.get("probe");
const pose = new rig.Pose("contact", { parts: { leg_near: { dx: 1 } } });
const composed = rig.compose(skin, RIGDEF, pose, "right", { name: "probe/composed" });
console.log("composed meta.collisions:", JSON.stringify(composed.meta.collisions), "mirroredFacing:", composed.meta.mirroredFacing);
T.clip_create.run({ id: "probe-walk", template: "walk", sprite: "probe", fps: 12, directions: ["right"] });
T.clip_set_frames.run({ clip: "probe-walk", sprite: "probe", direction: "right", frames: [{ cel: composed.name, pose: "contact", duration: 200 }] });
W.clips.get("probe-walk").setFrames("right", [
  new (require("../../../src/core/clip.js").Frame)(composed, { poseName: "contact", duration: 200 }),
]);
const lv = T.loop_validate.run({ clip: "probe-walk" });
console.log("loop_validate (tool):", JSON.stringify(lv).slice(0, 400));
console.log("frame has .collisions property?", Object.prototype.hasOwnProperty.call(W.clips.get("probe-walk").frames("right")[0], "collisions"));
const eg = T.export_gate.run({ clips: ["probe-walk"], style: STYLE.id, palette: "t3-breaker", assetClass: "character" });
console.log("export_gate:", JSON.stringify(eg).slice(0, 700));
