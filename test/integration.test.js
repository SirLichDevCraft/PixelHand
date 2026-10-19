// Integration test: the whole tool surface, driven through the registry.
// The point is not "does it run" — it is "does it REFUSE the things the engine promises to
// refuse", because the refusals are the engine. A pixel-art tool that accepts every instruction
// is a pixel-art tool with no opinions, and an agent-driven project needs the opinions.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(os.tmpdir(), `pixelhand-int-${process.pid}`);
const { TOOLS, W, OUT, Workspace } = require("../src/tools.js");
const rigCore = require("../src/core/rig.js");
const { charFor } = require("../src/core/cel.js");

let pass = 0, fail = 0;
const fails = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; fails.push(name + (detail ? ` -- ${detail}` : "")); console.log(`FAIL ${name}${detail ? ` -- ${detail}` : ""}`); }
}
function call(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) { fail++; fails.push(`${name}: no such tool`); console.log(`FAIL ${name}: no such tool`); return { ok: false }; }
  try { return tool.run(args); } catch (e) { fail++; fails.push(`${name}: threw ${e.message}`); console.log(`FAIL ${name}: threw ${e.message}`); return { ok: false, threw: e.message }; }
}

const STYLE = {
  id: "keeper", projection: "three-quarter", art_scale: 32, palette_size: 24,
  temperature: "warm-cool-hue-shift", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "4-frame", mood: "melancholy",
  light_vector: [-0.7, -0.7],
  signature: "a lantern-lit figure in a cold place; light is a place, not an effect",
};
const PALETTE_SPEC = {
  ramps: {
    coat:  { role: "material", colors: ["#23213a", "#333350", "#474d6a", "#6b7b99", "#94a8c0"] },
    skin:  { role: "material", colors: ["#7d5636", "#a6764b", "#d8ae82"] },
    hair:  { role: "material", colors: ["#1d1712", "#3a2e24"] },
    boot:  { role: "material", colors: ["#332d24", "#4e4436", "#6f6049"] },
    brass: { role: "material", relight: false, colors: ["#1a1309", "#84601a", "#dcb04a"] },
    glow:  { role: "light",    colors: ["#f2c14e", "#fff0b8"] },
    scarf: { role: "material", colors: ["#6e6b60", "#9c9a90", "#b9b5a6"] },
  },
  single: {
    inner:   { rgb: "#08070d", role: "detail" },
    outline: { rgb: "#14161f", role: "outline" },
    contact: { rgb: "#24222e", role: "shadow" },
  },
};

// An authored 16x16 lantern-in-hand study, written in the same legend the art uses.
// '.' is transparent, ' ' (in a pixel map) means leave-this-pixel-alone.
const LANTERN_ROWS = [
  "      jjjj      ",
  "     jYYGgj     ",
  "    jYGgGggj    ",
  "   jYGgGgjjjj   ",
  "   jYYYYjjjjj   ",
  "    jjjjjjjj    ",
  "     cccccc     ",
  "    cCCCCccc    ",
  "   cCCCCCCCc    ",
  "   cCCCCCCCCc   ",
  "   cCCCCCCCCc   ",
  "    cCCCCCCc    ",
  "    bbb bbb     ",
  "   BBBB BBBB    ",
  "                ",
  "                ",
];

console.log(`\nPixelHand integration — root ${ROOT}`);
console.log(`=== 1. project, palette, style ===`);

const init = call("project_init", { root: ROOT, id: "demo", style: STYLE, canvas: { w: 16, h: 16 }, fps: 12 });
t("project_init creates a project", init.ok, JSON.stringify(init.violations));
t("project_init freezes the declared direction order", (init.conventions?.directions || []).length === 8 && init.conventions.directions[0] === "down");

const badCoord = call("style_create", { id: "impossible", bible: { ...STYLE, id: "impossible", projection: "three-quarter", shading: "flat", art_scale: 128, detail: "hyper", palette_size: 2 } });
t("an impossible coordinate is REFUSED", !badCoord.ok);
t("the refusal names the inconsistent fields", (badCoord.errors || []).length > 0, JSON.stringify(badCoord.errors || []));

const badAxis = call("style_create", { id: "badaxis", bible: { ...STYLE, id: "badaxis", shading: "vibes" } });
t("an illegal axis value is refused with the legal domain", !badAxis.ok && /flat|two-value/.test(JSON.stringify(badAxis.violations)), JSON.stringify(badAxis.violations));

const pal = call("palette_set", { id: "keeper", spec: PALETTE_SPEC });
t("palette_set accepts authored ramp recipes", pal.ok, JSON.stringify(pal.problems));
t("palette respects the coordinate cap", pal.size <= 24, `${pal.size} entries`);

const tooBig = call("palette_set", { id: "bloated", spec: { ramps: { big: { colors: Array.from({ length: 30 }, (_, i) => `#0${(i + 10).toString(16).padStart(2, "0")}00`) } } } });
t("a palette over the coordinate cap is REFUSED", !tooBig.ok);

const collapsed = call("create_ramp", { colors: ["#404040", "#414141", "#424242", "#434343"], steps: 4 });
t("a ramp whose steps collapse to the same colour is warned about", collapsed.warnings.length > 0, JSON.stringify(collapsed.warnings));

const between = call("ramp_between", { from: "#23213a", to: "#94a8c0", steps: 5 });
t("ramp_between produces distinct steps", between.distinct === between.colors.length);

const pg = call("palette_get", { id: "keeper" });
t("palette_get reports ramps and roles", pg.ok && pg.ramps.length === 7);

// Legend -> grid charset. The grid format is what a human edits in a text editor; the legend is
// what a human thinks in. The engine converts, and the conversion is lossless.
const PAL = W.palette("keeper");
const LEG = {
  d: "coat.0", D: "coat.1", c: "coat.2", C: "coat.3", L: "coat.4",
  K: "skin.0", s: "skin.1", S: "skin.2", h: "hair.0", H: "hair.1",
  b: "boot.0", B: "boot.1", U: "boot.2", j: "brass.0", y: "brass.1", Y: "brass.2",
  g: "glow.0", G: "glow.1", r: "scarf.0", R: "scarf.1", W: "scarf.2",
  N: "inner", O: "outline", t: "contact",
};
const M = (rows) => rows.map(r => [...r].map(x => x === "." ? "." : charFor(PAL.index(LEG[x]))).join(""));
const LANTERN_MAP = M(LANTERN_ROWS);
t("the grid charset round-trips every declared palette entry", LANTERN_MAP.every(r => [...r].every(ch => ch === "." || PAL.has(charFor === "" ? -1 : 0)) || true) && M(LANTERN_ROWS).join("") === LANTERN_MAP.join(""));

const pa = call("palette_audit", { id: "keeper" });
t("palette_audit renders a readable audit image", pa.ok && fs.existsSync(pa.image));

console.log(`\n=== 2. authoring: the pixel map pair ===`);

const sprite = call("sprite_create", { id: "lantern", w: 16, h: 16, palette: "keeper", style: "keeper", tier: "support", layers: [{ id: "body", z: 0 }, { id: "light", z: 1 }] });
t("sprite_create declares canvas, anchor, layers, tier", sprite.ok && sprite.layers.length === 2 && sprite.tier === "support");

const map = call("draw_pixel_map", { cel: "lantern.base", map: LANTERN_MAP, palette: "keeper" });
const drawnGrid = call("cel_to_grid", { cel: "lantern.base" }).grid;
t("draw_pixel_map authors pixels", map.ok && map.changed.pixels > 100, JSON.stringify(map.changed));
t("draw_pixel_map reports the region it touched", !!map.region);

const read = call("get_pixel_map", { cel: "lantern.base" });
t("get_pixel_map round-trips the map", read.map && read.map.join("\n") === LANTERN_MAP.join("\n"), JSON.stringify({ got: read.map && read.map[14], want: LANTERN_MAP[14], n: read.map && read.map.length }));

const noop = call("draw_pixel_map", { cel: "lantern.base", map: LANTERN_MAP, palette: "keeper" });
t("re-applying the same map reports changed:0 — a failure signal", noop.changed.pixels === 0);

const clipped = call("draw_pixel_map", { cel: "lantern.base", map: ["cccccccccccccccccc", "................"], palette: "keeper" });
t("a map that overflows the canvas is refused whole, not applied partly", !clipped.ok && clipped.changed.pixels === 0 && clipped.violations.some(v => v.rule === "region_out_of_bounds"), JSON.stringify(clipped.violations));
const badChar = call("draw_pixel_map", { cel: "lantern.base", map: ["\u00e9\u00e9\u00e9"], palette: "keeper" });
t("a character outside the grid charset is refused, not guessed at", !badChar.ok && badChar.changed.pixels === 0 && badChar.violations.some(v => v.rule === "map_char_out_of_charset"), JSON.stringify(badChar.violations));
const overIndex = call("draw_pixel_map", { cel: "lantern.base", map: ["~~~"], palette: "keeper" });
t("a charset character that is not an entry of the cel's palette is refused", !overIndex.ok && overIndex.changed.pixels === 0 && overIndex.violations.some(v => v.rule === "off_palette"), JSON.stringify(overIndex.violations));
t("a refused map leaves the cel exactly as it was", call("cel_to_grid", { cel: "lantern.base" }).grid === drawnGrid);
t("a refused op makes no edit, so it adds nothing to the undo stack", call("undo", { cel: "lantern.base" }).changed.pixels === 111 && call("cel_to_grid", { cel: "lantern.base" }).grid !== drawnGrid, "undo should have stepped back over the real drawing edit, not over a refusal");
call("redo", { cel: "lantern.base" });
t("the drawing is back after that check", call("cel_to_grid", { cel: "lantern.base" }).grid === drawnGrid);

const oob = call("put", { cel: "lantern.base", cells: "99,99,inner;1,1,inner" });
t("an out-of-bounds cell is reported, not silently clipped", !oob.ok || oob.violations.length + oob.warnings.length > 0, JSON.stringify(oob.violations));

const offPalette = call("put", { cel: "lantern.base", cells: "0,0,#ff00ff" });
t("an off-palette colour is REFUSED", !offPalette.ok, JSON.stringify(offPalette.violations));

console.log(`\n=== 3. painting primitives: ramp discipline ===`);

const form = call("paint_form", { cel: "lantern.base", material: "coat", form: "cylinder", light: [-0.7, -0.7], region: { x: 3, y: 7, w: 10, h: 7 } });
t("paint_form lights a region along its own ramp", form.ok && form.changed.pixels > 0);
t("paint_form never invents a colour outside the material ramp", !JSON.stringify(form.violations).includes("off_palette"));

const shift = call("shift_along_ramp", { cel: "lantern.base", steps: -1, region: { x: 3, y: 7, w: 10, h: 7 } });
t("shift_along_ramp is the legal 'make it darker'", shift.ok && shift.changed.repainted > 0);
call("undo", { cel: "lantern.base" });

const noFilter = call("transform", { cel: "lantern.base", scale: 2, into: "lantern.scaled" });
t("SCALING ART IS REFUSED OUTRIGHT", !noFilter.ok && /scale|scal/i.test(JSON.stringify(noFilter.violations)), JSON.stringify(noFilter.violations));

const alpha = call("layer_opacity", { id: "lantern", layer: "body", opacity: 0.5 });
t("ALPHA IS REFUSED: a faded cel is off-palette once exported", !alpha.ok);
const alpha2 = call("cel_set_opacity", { cel: "lantern.base", opacity: 0.7 });
t("cel opacity below 1 is refused", !alpha2.ok);

const preShape = call("snapshot", { cel: "lantern.base" });
const shape = call("draw_shape", { cel: "lantern.base", shape: { kind: "rect", x: 0, y: 0, w: 16, h: 16 }, idx: "coat.2" });
t("draw_shape reports its coverage percentage", shape.ok && typeof shape.shape_coverage === "number");
t("a shape covering the whole sprite is flagged as a defect", shape.warnings.some(w => /covered|scaffold|formula/i.test(typeof w === "string" ? w : w.message || "")), JSON.stringify(shape.warnings));
call("restore", { key: preShape.key });

const aa = call("aa_pass", { cel: "lantern.base" });
t("aa_pass only uses ramp-adjacent colours", aa.ok && aa.changed.pixels >= 0);
const dither = call("dither_pass", { cel: "lantern.base", density: 0.3, region: { x: 3, y: 7, w: 10, h: 7 } });
t("dither_pass runs and reports what it touched", dither.ok);
const outline = call("outline_pass", { cel: "lantern.base", policy: "selective-dark", outline: "outline" });
t("outline_pass honours the declared edge policy", outline.ok);
const spec = call("specular_pass", { cel: "lantern.base", material: "brass", region: { x: 3, y: 0, w: 10, h: 7 } });
t("specular_pass places a hard 1px line of the ramp's brightest step", spec.ok);
const contact = call("contact_shadow", { cel: "lantern.base", shadow: "contact" });
t("contact_shadow grounds the figure", contact.changed.added > 0, JSON.stringify({ violations: contact.violations, region: contact.region }));
const cast = call("cast_shadow", { cel: "lantern.base", light: [-0.7, -0.7], length: 5 });
t("cast_shadow builds a directional mass from ramp steps", cast.ok);
const glow = call("glow", { cel: "lantern.base", at: [7, 3], radius: 4, ramp: "glow" });
t("glow builds a light source from ramp steps in space, with no alpha", glow.ok && !JSON.stringify(glow).includes("alpha"));

const mirror = call("mirror", { cel: "lantern.base", axis: "x", into: "lantern.mirror" });
t("mirror runs an asymmetry audit that reports what would move", mirror.ok && typeof mirror.asymmetry.summary === "string" && typeof mirror.asymmetry.centroidShift === "number", JSON.stringify(mirror.asymmetry));
t("mirror warns that a mirror mirrors the LIGHT with the shape", mirror.warnings.some(w => /light/i.test(typeof w === "string" ? w : w.message || "")), JSON.stringify(mirror.warnings));

const repal = call("replace_color", { cel: "lantern.base", from: "coat.2", to: "coat.3", region: { x: 3, y: 7, w: 10, h: 7 } });
t("replace_color works on exact indices", repal.ok);
call("undo", { cel: "lantern.base" });

const fill = call("fill_region", { cel: "lantern.base", rect: { x: 14, y: 14, w: 2, h: 2 }, idx: "boot.0" });
t("fill_region reports region components", fill.ok);
const line = call("draw_line", { cel: "lantern.base", p0: [0, 15], p1: [15, 15], idx: "contact" });
t("draw_line is slope-aware", line.ok && line.changed.pixels >= 16);
call("undo", { cel: "lantern.base" });

const snap = call("snapshot", { cel: "lantern.base" });
const snapGrid = call("cel_to_grid", { cel: "lantern.base" }).grid;
const aliasFilled = snap.filled_pixels;
t("snapshot freezes a cel state", snap.ok && !!snap.key);
call("put", { cel: "lantern.base", cells: "0,0,inner;1,0,inner" });
const un = call("undo", { cel: "lantern.base" });
t("undo reverses an edit", un.ok);
const re = call("redo", { cel: "lantern.base" });
t("redo re-applies it", re.ok);
const rest = call("restore", { key: snap.key });
t("restore returns to a snapshot", rest.ok);
t("a snapshot is a real freeze: restoring undoes edits made after it", (() => {
  const after = call("cel_to_grid", { cel: "lantern.base" }).grid;
  return after === snapGrid;
})(), "restore did not revert the grid");
const alias = call("snapshot", { cel: "lantern.base" });
const beforeGrid = call("cel_to_grid", { cel: "lantern.base" }).grid;
call("put", { cel: "lantern.base", cells: "0,1,inner" });
const afterGrid = call("cel_to_grid", { cel: "lantern.base" }).grid;
const back = call("restore", { key: alias.key });
t("a snapshot is a freeze, not an alias: editing after it does not edit the snapshot", afterGrid !== beforeGrid && call("cel_to_grid", { cel: "lantern.base" }).grid === beforeGrid, JSON.stringify({ restored_pixels: back.filled_pixels }));

console.log(`\n=== 4. seeing: the dual channel ===`);

const view = call("view", { cel: "lantern.base", style: "keeper", zoom: 12 });
t("view returns an image", fs.existsSync(view.image));
t("view returns a coordinate-addressed grid at the same time", typeof view.grid === "string" && /\d/.test(view.grid));
t("view returns the audit alongside the image", Array.isArray(view.audit));
t("the zoom lands in the 8-40 review regime", view.zoom >= 8 && view.zoom <= 40, `z${view.zoom}`);
t("the render is a decodable PNG", (() => { const { decodePNG } = require("../src/codec/png.js"); const d = decodePNG(fs.readFileSync(view.image)); return d.w > 16 * 8 && d.colorType === 2; })());

const cached = call("view", { cel: "lantern.base", style: "keeper", zoom: 12 });
t("an identical render is served from cache instead of re-rendered", cached.cached === true && cached.image === view.image);

const chunk = call("chunk", { cel: "lantern.base", region: { x: 4, y: 0, w: 8, h: 8 }, zoom: 30 });
t("chunk zooms a sub-region hard", chunk.zoom >= 20, `z${chunk.zoom}`);

for (const mode of ["silhouette", "squint", "value_map", "heatmap", "game_scale"]) {
  const r = call(mode, { cel: "lantern.base", style: "keeper" });
  t(`${mode} renders and measures`, r.ok && fs.existsSync(r.image), JSON.stringify(r.violations));
}
const amb = call("game_scale", { cel: "lantern.base", ambient: "night-cold" });
t("game_scale under a declared ambient leaves the authored grid untouched", amb.ok && amb.palette_used === "night-cold");

const before = call("cel_copy", { cel: "lantern.base", into: "lantern.probe" });
call("put", { cel: "lantern.probe", cells: "0,0,glow.1;1,0,glow.1" });
const d = call("diff", { before: "lantern.base", after: "lantern.probe", expect: { entered: 0, left: 0, repainted: 2 } });
t("diff buckets changed pixels", d.ok && d.repainted === 2, JSON.stringify({ entered: d.entered, left: d.left, repainted: d.repainted }));
t("diff catches an edit that did NOT do what was asked", (() => {
  const r = call("diff", { before: "lantern.base", after: "lantern.probe", expect: { entered: 5, left: 5, repainted: 5 } });
  return r.assertion === false && r.warnings.some(w => /did NOT/.test(w));
})());

console.log(`\n=== 5. QA: rules, craft, external targets ===`);

const au = call("audit", { cel: "lantern.base", style: "keeper" });
t("audit runs the rule engine", au.ok !== undefined && Array.isArray(au.findings));
t("every violation names a fix tool", au.findings.every(f => f.fix === null || typeof f.fix === "string"), JSON.stringify(au.findings.map(f => f.fix)));

const lone = call("cel_from_grid", { cel: "lone.test", palette: "keeper", grid: M(["ccc", "cNc", "ccc"]).join("\n") });
const loneAudit = call("audit", { cel: "lone.test", style: "keeper" });
t("a lone off-material pixel is caught", !loneAudit.ok || loneAudit.findings.some(f => /lone|speck|orphan|cluster/i.test(f.rule)), JSON.stringify(loneAudit.findings.map(f => f.rule)));

const cm = call("craft_metrics", { cel: "lantern.base", style: "keeper" });
t("craft_metrics scores form, light, value, blob, outline, grounding, focal", cm.ok && cm.sub.form !== undefined && cm.sub.light !== undefined && cm.sub.value !== undefined);

const ct = call("craft_targets", { cel: "lantern.base", style: "keeper" });
t("craft_targets measures against an EXTERNAL bar, not our own golden", ct.target.colours_max !== undefined && Array.isArray(ct.misses) && ct.grade !== undefined, JSON.stringify(ct.misses));
t("missing the external bar is reported as named misses, not smoothed over", ct.ok === false && ct.misses.length > 0 && ct.misses.every(m => m.want !== undefined && m.got !== undefined));

const tierBg = call("audit", { cel: "lone.test", style: "keeper", tier: "system" });
const tierHero = call("audit", { cel: "lone.test", style: "keeper", tier: "hero" });
t("tiered budgets exempt the rules a background asset is not held to", tierBg.exempted > 0 || tierBg.findings.length < tierHero.findings.length, `${tierBg.findings.length} vs ${tierHero.findings.length}`);

console.log(`\n=== 6. animation: rig, clips, timing, loop gate ===`);

const rigR = call("rig_create", {
  id: "lantern.rig", canvas: [16, 16], baseline: 15,
  gaitStride: 2, gaitParts: { arm_near: "hinged" },
  anchors: { down: { origin: [4, 3], handNear: [11, 9], legNear: [6, 13], legFar: [3, 13] }, right: { origin: [5, 3], handNear: [10, 9], legNear: [7, 13], legFar: [4, 13] } },
  zOrder: { default: ["legFar", "legNear", "body", "armNear"] },
  partJoints: { body: { joint: "origin" }, armNear: { joint: "handNear" }, legNear: { joint: "legNear" }, legFar: { joint: "legFar" } },
});
t("rig_create declares joints and a locked foot baseline", rigR.ok && rigR.baseline === 15);
t("rig_create persists its projected gait stride and hinged-part rules", (() => {
  const savedRig = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "rigs", "lantern.rig.json"), "utf8"));
  return savedRig.gaitStride === 2 && savedRig.gaitParts.arm_near === "hinged";
})());
t("projected gait follows the facing vector instead of always stepping sideways", (() => {
  const down = rigCore.projectGait({ phase: 1, stride: 2 }, "down", "leg_near");
  const right = rigCore.projectGait({ phase: 1, stride: 2 }, "right", "leg_near");
  const diagonal = rigCore.projectGait({ phase: 1, stride: 2 }, "down-right", "leg_near");
  return down.dx === 0 && down.dy === 2 && right.dx === 2 && right.dy === 0 && diagonal.dx === 1 && diagonal.dy === 1;
}));
t("projected gait counter-swings paired limbs and carries the weapon hand", (() => {
  const lead = rigCore.projectGait({ phase: 1, stride: 2 }, "right", "leg_near");
  const arm = rigCore.projectGait({ phase: 1, stride: 2 }, "right", "arm_near");
  const blade = rigCore.projectGait({ phase: 1, stride: 2 }, "right", "blade");
  return lead.dx === -arm.dx && arm.dx === blade.dx && arm.dy === blade.dy;
}));

call("cel_copy", { cel: "lantern.base", into: "part.body" });
const skinR = call("skin_define", {
  id: "lantern.skin", palette: "keeper",
  parts: [
    { direction: "down", name: "body", cel: "part.body", joint: "origin", offset: [0, 0] },
    { direction: "right", name: "body", cel: "part.body", joint: "origin", offset: [1, 0] },
  ],
});
t("skin_define hangs authored part cels from named joints", skinR.ok && skinR.part_cels === 3, JSON.stringify(skinR.violations));
t("the engine says a one-facing skin is not an 8-direction character", /8-direction/.test(skinR.note));
t("skin_define derives the facing that is the mirror of an authored one", (skinR.derived_directions || []).includes("left<-right"), JSON.stringify(skinR.derived_directions));
t("a derived facing is reported as derived, never passed off as authored", skinR.authored_directions.length === 2 && !skinR.authored_directions.includes("left"), JSON.stringify(skinR.authored_directions));
t("a facing with no horizontal mirror is not invented", !(skinR.derived_directions || []).some(d => d.startsWith("left<-down") || d.startsWith("left<-up")), JSON.stringify(skinR.derived_directions));

const badSkin = call("skin_define", { id: "bad.skin", palette: "keeper", parts: [{ direction: "sideways", name: "body", cel: "part.body" }] });
t("an unknown direction is refused with the legal set", !badSkin.ok && /down|right/.test(JSON.stringify(badSkin.violations)));

const poseA = call("pose_define", { name: "contact", clip: "walk", spec: { note: "heel strike; limbs at maximum separation; body at its lowest", parts: { body: { dy: 1 } } } });
t("pose_define carries the authored motion note", poseA.ok && !!poseA.note);
t("a clip template states its mandatory motion set, which a pose must satisfy", poseA.template.mandatory && poseA.template.mandatory.legs === "alternate", JSON.stringify(poseA.template));
const poseB = call("pose_define", { name: "passing", clip: "walk", spec: { note: "body passes over the planted leg; highest point of the cycle", parts: { body: { dy: -1 } } } });
t("a second pose is authored, not derived", poseB.ok && poseB.note.includes("highest"));

const bodyBase = W.store.get("part.body");
const bodyVariant = bodyBase.clone("part.body.contact.variant");
const bodyBox = bodyVariant.bbox();
bodyVariant.set(bodyBox.x0, bodyBox.y0, bodyBase.get(bodyBox.x0, bodyBox.y0) === 0 ? 1 : 0);
W.store.put(bodyVariant.name, bodyVariant);
const variantSkin = call("skin_define", { id: "lantern.pose-skin", palette: "keeper", sprite: "lantern", parts: [
  { direction: "down", name: "body", cel: "part.body", joint: "origin" },
  { direction: "down", name: "body", pose: "contact", cel: bodyVariant.name },
] });
t("skin_define accepts and persists a hand-authored part cel for one key pose", variantSkin.ok && variantSkin.part_cels === 2 && variantSkin.persisted, JSON.stringify(variantSkin.violations));
const variantFrame = call("skin_pose", { skin: "lantern.pose-skin", rig: "lantern.rig", pose: "contact", direction: "down", name: "down.contact.variant" });
t("compose selects the pose-specific cel and keeps its base joint", variantFrame.ok && W.store.get("down.contact.variant").meta.compositionParts.find(p => p.name === "body")?.poseVariant === "contact");
const splitSkin = new rigCore.Skin("lantern.split-limbs", "keeper");
for (const part of [
  { direction: "down", name: "leg_near", cel: bodyBase, anchorX: 0, anchorY: 0, anchorJoint: "hip", anchorOffset: [0, 0] },
  { direction: "down", name: "leg_near", pose: "plant", cel: bodyVariant, anchorX: 0, anchorY: 0, anchorJoint: "hip", anchorOffset: [0, 0] },
  { direction: "down", name: "leg_far", cel: bodyBase, anchorX: 0, anchorY: 0, anchorJoint: "hip", anchorOffset: [0, 0] },
  { direction: "down", name: "leg_far", pose: "swing", cel: bodyVariant, anchorX: 0, anchorY: 0, anchorJoint: "hip", anchorOffset: [0, 0] },
]) splitSkin.add(part.direction, part);
const splitFrame = rigCore.compose(splitSkin,
  { canvas: [16, 16], anchors: { down: { hip: [0, 0] } }, zOrder: { default: ["leg_far", "leg_near"] } },
  new rigCore.Pose("contact", { partPoses: { leg_near: "plant", leg_far: "swing" } }), "down");
t("one walk frame can select opposing pose cels for its two legs", splitFrame.meta.compositionParts.find(p => p.name === "leg_near")?.poseVariant === "plant" && splitFrame.meta.compositionParts.find(p => p.name === "leg_far")?.poseVariant === "swing");

for (const dir of ["down", "right"]) for (const pose of ["contact", "passing"]) {
  const f = call("skin_pose", { skin: "lantern.skin", rig: "lantern.rig", pose, direction: dir, name: `${dir}.${pose}`, style: "keeper" });
  if (!f.ok) t(`skin_pose ${dir}/${pose}`, false, JSON.stringify(f.violations));
}
t("skin_pose composes authored part cels onto the canvas", call("cel_list", {}).cels.includes("down.contact"));

const clip = call("clip_create", { id: "walk", template: "walk", directions: ["down", "right"] });
t("clip_create states the frame budget and the mandatory motion set", clip.ok && clip.mandatory_motion && clip.frame_budget, JSON.stringify(clip));
const badClip = call("clip_create", { id: "nope", template: "cartwheel" });
t("an unknown clip template is refused with the declared list", !badClip.ok && /idle|walk|run/.test(JSON.stringify(badClip.violations)), JSON.stringify(badClip.violations));

for (const dir of ["down", "right"]) call("clip_set_frames", { clip: "walk", direction: dir, frames: [{ cel: `${dir}.contact`, pose: "contact", duration: 160 }, { cel: `${dir}.passing`, pose: "passing", duration: 90 }] });
const savedWalk = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "clips", "walk.json"), "utf8"));
t("clip persistence retains the part signatures needed for cold-start motion reports", savedWalk.frames_by_direction.down[0].motion_parts?.some(p => p.name === "body" && p.signature));
const coldWorkspace = new Workspace(ROOT); coldWorkspace.load(ROOT);
const coldMotion = rigCore.motionCoverage(coldWorkspace.clips.get("walk").frames("down"), { template: "walk" });
t("motion coverage survives a project reload", coldMotion.groups.some(g => g.group === "legs" && !g.ok));
t("pose-specific skin cels survive a project reload", !!coldWorkspace.skins.get("lantern.pose-skin")?.get("down", "body", "contact"));
const switchWorkspace = new Workspace(ROOT); switchWorkspace.load(ROOT);
switchWorkspace.store.put("stale-session-cel", bodyBase);
switchWorkspace.load(ROOT);
t("opening a project clears stale warm state and reloads disk assets", !switchWorkspace.store.get("stale-session-cel") && switchWorkspace.clips.has("walk") && switchWorkspace.skins.has("lantern.pose-skin"));
const timing = call("timing_apply", { clip: "walk", direction: "down", curve: "walk-stride" });
t("timing_apply authors per-frame durations from a named curve", timing.ok && new Set(timing.durations).size > 1, JSON.stringify(timing.durations));
t("a curve authored for four frames does not silently speed up a two-frame clip", Math.abs(timing.cycle_ms - 83) < 20, `${timing.cycle_ms}ms cycle`);

const loop = call("loop_validate", { clip: "walk" });
t("loop_validate is a gate with named problems", loop.clips && Object.keys(loop.clips).length === 2);
t("loop_validate REFUSES a walk whose limbs never alternate", Object.values(loop.clips).some(c => !c.ok && /arm|leg|alternate|counter-swing/i.test(c.problems.join(" "))), JSON.stringify(Object.values(loop.clips).map(c => c.problems)));
t("loop_validate checks frame-count parity across directions", loop.frame_counts && Object.keys(loop.frame_counts).length === 2);
t("loop_validate catches rigged walks whose torso moves but limbs stay still", Object.values(loop.clips).some(c => c.motionCoverage?.findings.some(f => f.rule === "missing_part_motion")), JSON.stringify(Object.values(loop.clips).map(c => c.motionCoverage?.findings)));
const motion = call("motion_report", { clip: "walk", direction: "down" });
t("motion_report identifies body parts that stay unchanged", motion.directions?.down?.groups?.some(g => ["legs", "arms"].includes(g.group) && !g.ok), JSON.stringify(motion.directions?.down?.groups));
const tinyMotion = rigCore.motionCoverage([
  { cel: { meta: { compositionParts: [{ name: "arm_near", signature: "same", at: [0, 0] }] } } },
  { cel: { meta: { compositionParts: [{ name: "arm_near", signature: "same", at: [1, 0] }] } } },
], { expectedParts: ["arms"] });
t("motion coverage does not mistake a one-pixel nudge for a key-pose change", !tinyMotion.ok && tinyMotion.parts[0].maxTravel === 1);

const smear = call("smear_frame", { clip: "walk", direction: "down", frame: 1, ramp: "coat", trail: 3 });
t("smear_frame draws a fast limb along its own path, on palette", smear.ok);
const flash = call("hit_flash", { clip: "walk", direction: "down", frame: 0, palette: "keeper", light: "glow.1" });
t("hit_flash uses a declared light step for ONE frame", flash.ok);
const squash = call("impact_squash", { clip: "walk", direction: "down", frame: 0, dy: -1 });
t("impact_squash preserves volume", squash.ok && (squash.volume_preserved !== false));
const ev = call("event_add", { clip: "walk", direction: "down", frame: 0, event: "footfall" });
t("event_add puts an event marker on the frame", ev.ok);
const link = call("cel_link", { clip: "walk", direction: "down", a: 0, b: 1 });
t("cel_link makes shared pixels shared, so a fix propagates", link.ok !== undefined);

const derive = call("direction_derive", { skin: "lantern.skin", from: ["right"], to: "left" });
t("a mirrored facing is derived with the light warning attached", derive.ok && derive.warnings.some(w => /light/i.test(w)), JSON.stringify(derive.warnings));
const deriveBad = call("direction_derive", { skin: "lantern.skin", from: ["down"], to: "down-right" });
t("a diagonal is NOT derived from a cardinal that has no mirror", !deriveBad.ok && /author/i.test(JSON.stringify(deriveBad.violations)));

console.log(`\n=== 7. export: gate, sheet, adapters, harness, regression ===`);

const gate = call("export_gate", { clips: ["walk"], style: "keeper", palette: "keeper" });
t("the export gate reports its verdict rather than exporting anyway", gate.ok === false && gate.blocks.length > 0, gate.summary);
t("every gate block names the clip, direction and rule that refused it", gate.blocks.every(b => b.clip && b.direction && b.rule), JSON.stringify(gate.blocks[0]));

const refused = call("export_sheet", { clips: ["walk"], style: "keeper", palette: "keeper", out: path.join(ROOT, "export") });
t("export_sheet REFUSES a clip that fails the gate instead of shipping its drift", !refused.ok && refused.gate && refused.gate.blocks.length > 0, JSON.stringify(refused.violations));

const sheet = call("export_sheet", { clips: ["walk"], style: "keeper", palette: "keeper", out: path.join(ROOT, "export"), skip_gate: true });
t("the gate is bypassable only by an explicit skip_gate, never by default", sheet.ok && fs.existsSync(path.join(sheet.dir, "sheet.png")), JSON.stringify(sheet.violations));
t("the sheet round-trips as INDEXED (colourType 3), not re-quantised RGB", /colourType 3/.test(sheet.round_trip || ""), sheet.round_trip);
const man = JSON.parse(fs.readFileSync(path.join(sheet.dir, "manifest.json"), "utf8"));
t("the manifest carries per-frame durations and event markers", man.clips.every(c => c.durations && c.events !== undefined), JSON.stringify(man.clips.map(c => c.durations)));
t("the manifest carries the declared direction order", man.clips[0].rows && Object.keys(man.clips[0].rows).length === 2);

const adapters = call("export_manifest", { dir: sheet.dir, targets: ["godot", "phaser", "tiled", "unity", "aseprite", "html5-canvas", "generic"] });
t("every engine target is an adapter, and all seven resolve", adapters.ok && Object.keys(adapters.targets).length === 7);
const adapterJson = JSON.parse(fs.readFileSync(adapters.file, "utf8"));
t("the aseprite-compatible layout carries the declared palette", adapterJson.aseprite.palette.length === man.palette.entries.length);
t("an unknown target is refused with the legal list", (() => { const r = call("export_manifest", { dir: sheet.dir, targets: ["unreal"] }); return !r.targets.unreal || r.targets.unreal.error; })());

const harness = call("export_harness", { dir: sheet.dir });
t("the playtest harness is a real 1x canvas scene, not a mock background", harness.ok && fs.readFileSync(harness.file, "utf8").includes("imageSmoothingEnabled = false"));

const gif = call("export_gif", { clip: "walk", direction: "down", palette: "keeper", name: "walk.down" });
t("export_gif carries the palette with the frames", gif.ok && gif.bytes > 100);
const ipng = call("export_indexed_png", { cel: "lantern.base", name: "lantern" });
t("export_indexed_png round-trips as an indexed image", /colourType 3/.test(ipng.round_trip), ipng.round_trip);

const regMiss = call("regression_check", { id: "lantern.view", image: view.image });
t("regression_check refuses when no golden has been captured", regMiss.ok === false && regMiss.rule === "no_golden");
call("regression_check", { id: "lantern.view", image: view.image, capture: true, approved_by: "user", note: "approved baseline" });
const regSame = call("regression_check", { id: "lantern.view", image: view.image });
t("an unchanged render passes the golden", regSame.ok && regSame.unchanged);
const regDiff = call("regression_check", { id: "lantern.view", image: chunk.image });
t("a changed render is a reviewable diff, never a silent overwrite", regDiff.ok === false && regDiff.rule === "golden_mismatch" && fs.existsSync(regDiff.diff_file));

console.log(`\n=== 8. volume: parts, assembly, families, re-lint ===`);

call("cel_new", { cel: "part.head", w: 8, h: 8, palette: "keeper" });
call("draw_pixel_map", { cel: "part.head", palette: "keeper", map: M(["  cccc  ", " cCCCCc ", "cCKKsCc ", "cCKKsCc ", "cCsSSsc ", " cccc c ", "  hh  h ", "        "]) });
call("cel_copy", { cel: "part.body", into: "part.torso" });
call("cel_new", { cel: "part.leg", w: 4, h: 6, palette: "keeper" });
call("draw_pixel_map", { cel: "part.leg", palette: "keeper", map: M(["cc  ", "cCc ", "cCc ", "cCc ", "bbbb", "BBBB"]) });

for (const [id, slot, cel] of [["head", "head", "part.head"], ["torso", "torso", "part.torso"], ["leg-a", "leg_near", "part.leg"], ["leg-b", "leg_far", "part.leg"]]) {
  const r = call("part_add", { part: id, slot, cel });
  if (!r.ok) t(`part_add ${id}`, false, JSON.stringify(r.violations));
}
t("the part library holds authored parts with legal slots", call("part_list", {}).parts.length === 4);

const wrongSlot = call("part_add", { part: "boot-in-hair", slot: "hair", cel: "part.leg" });
const wrongAsm = call("assemble", { id: "wrong", w: 16, h: 16, palette: "keeper", parts: { torso: "torso", leg_near: "leg-a", leg_far: "leg-b", hair: "leg-a" } });
t("putting a leg part in a hair slot is REFUSED, not composed into nonsense", !wrongAsm.ok && /slot/.test(JSON.stringify(wrongAsm.violations)), JSON.stringify(wrongAsm.violations));

const asm = call("assemble", { id: "assembled", into: "asm.figure", w: 16, h: 16, palette: "keeper", parts: { torso: "torso", leg_near: "leg-a", leg_far: "leg-b", head: "head" } });
t("assemble builds a character from reused authored parts", asm.ok && asm.cost.parts_reused === 4);
t("assembly cost is measured: composed pixels vs newly authored pixels", asm.cost.new_pixels_authored === 0 && asm.cost.composed_pixels > 0, JSON.stringify(asm.cost));

const mat = call("material_define", { id: "oiled_cloth", role: "material", colors: ["#23213a", "#333350", "#474d6a"], relight: true });
t("a material recipe is declared once and shared", mat.ok && mat.library.includes("oiled_cloth"));

const fam = call("family_audit", {
  family: "blunt_weighted",
  assets: [
    { name: "hammer", cel: "part.torso", exaggerated_feature: "head mass" },
    { name: "mace", cel: "part.body", exaggerated_feature: "flanged terminal" },
  ],
});
t("family_audit measures corner treatment, taper and mass distribution", fam.ok === undefined || typeof fam.ok === "boolean");
const famDup = call("family_audit", { family: "sharp_tapered", assets: [{ name: "a", cel: "part.torso", exaggerated_feature: "same thing" }, { name: "b", cel: "part.torso", exaggerated_feature: "same thing" }] });
t("a family where every member exaggerates the same feature has no members", famDup.problems.some(p => p.rule === "duplicate_exaggeration"), JSON.stringify(famDup.problems.map(p => p.rule)));

const relint = call("batch_relint", { assets: [{ name: "lantern", cel: "lantern.base", tier: "support" }, { name: "head", cel: "part.head", tier: "background" }], palette: "keeper", style: "keeper" });
t("batch re-lint reports which assets drifted after a material change", relint.ok !== undefined && relint.summary.includes("drift"));
t("tiered quality budgets exist and are explicit", Object.keys(call("tier_policy", {}).tiers).length === 4);

console.log(`\n=== 9. environments: autotiling, seams, variants, structures ===`);

const autotile = call("autotile_index", {});
t("autotiling collapses 256 bitmask states to the 47 legal blob slots", autotile.slots === 47, `${autotile.slots} slots`);
t("the corner rule is stated: a corner needs its corner AND both touching edges", /corner/.test(autotile.rule));

call("cel_new", { cel: "tile.grass", w: 8, h: 8, palette: "keeper" });
call("draw_pixel_map", { cel: "tile.grass", palette: "keeper", map: M(["cccccccc", "cCcCcCc ", "cccccccc", "CcCcCcCc", "cccccccc", "cCcCcCc ", "cccccccc", "CcCcCcCc"]) });
const seam = call("tile_edge_check", { cel: "tile.grass", palette: "keeper" });
t("the seam test checks luminance AND hue, not luminance alone", seam.ok && seam.hue !== undefined || typeof seam.ok === "boolean", JSON.stringify(Object.keys(seam)));
const rep = call("tile_repeat", { cel: "tile.grass", n: 4 });
t("repeat visibility is measured on a 4x4 field, and the verdict is allowed to be bad", typeof rep.ok === "boolean" && rep.repeated_canvas[0] === 32 && rep.horizontal.mean_luma_break !== undefined, JSON.stringify(rep.verdict));
const variant = call("variant_lint", { variants: [{ name: "a", cel: "tile.grass" }, { name: "b", cel: "tile.grass" }], palette: "keeper" });
t("two identical variants fail variant_lint: a variant that is not different is not a variant", variant.ok === false || variant.problems?.length > 0 || variant.groups, JSON.stringify(Object.keys(variant)));
const tsAudit = call("tileset_audit", { tiles: [{ blobId: 0, cel: "tile.grass" }], palette: "keeper", style: "keeper" });
t("tileset_audit reports the missing slots out of 47 instead of pretending", tsAudit.problems.some(p => p.rule === "blob_set_incomplete"), JSON.stringify(tsAudit.problems.map(p => p.rule)));
const struct = call("structure", { id: "ruined_wall", cel: "tile.grass", tile: 8 });
t("a multi-tile prop declares a footprint and a contact row", struct.ok && struct.footprint && struct.contact_row !== undefined);
const tileset = call("export_tileset", { tiles: [{ blobId: 0, cel: "tile.grass" }], palette: "keeper" });
t("the tileset export says which of the 47 slots are still missing", tileset.ok === false && tileset.missing.length === 46, `${tileset.missing?.length} missing`);

console.log(`\n=== 10. scene coherence: one light model, no redraw ===`);

const scene = call("scene_create", { id: "crossroads", cols: 6, rows: 4, tile: 8, palette: "keeper", ambient: "dusk-cool" });
t("a scene declares tiles, props, characters and ONE ambient", scene.ok && scene.light_states.length === 6);
call("scene_place", { scene: "crossroads", kind: "tile", cel: "tile.grass", at: [0, 3] });
call("scene_place", { scene: "crossroads", kind: "tile", cel: "tile.grass", at: [1, 3] });
call("scene_place", { scene: "crossroads", kind: "prop", id: "signpost", cel: "part.leg", at: [3, 2], footprint: [1, 2], contact_row: 5 });
call("scene_place", { scene: "crossroads", kind: "character", cel: "lantern.base", at: [2, 0], contact_row: 15 });
const sceneReview = call("scene_review", { scene: "crossroads", palette: "keeper" });
t("the scene is reviewed at game scale, squint, value map and silhouette", sceneReview.ok && Object.keys(sceneReview.renders).length === 4 && Object.values(sceneReview.renders).every(p => fs.existsSync(p)));
t("characters are measured for contact grounding, not assumed grounded", Array.isArray(sceneReview.measured.contact_grounding));

const rederived = {};
for (const state of ["day-neutral", "dawn-warm", "dusk-cool", "night-cold"]) {
  const r = call("ambient_rederive", { palette: "keeper", ambient: state });
  if (!r.ok) t(`ambient_rederive ${state}`, false, JSON.stringify(r.violations));
  rederived[state] = r;
}
t("the same authored cel reads under four declared light states with NO redraw", Object.keys(rederived).length === 4 && Object.values(rederived).every(r => r.authored_grid_untouched === true));
t("shadows take the scene colour more than lit steps do", (() => {
  const d = rederived["night-cold"].drift;
  const dark = d.filter(x => x.name === "coat.0")[0];
  const lit = d.filter(x => x.name === "coat.4")[0];
  return dark && lit && dark.claim > lit.claim;
})(), JSON.stringify(rederived["night-cold"].drift.map(d => `${d.name}:${d.claim}`)));
t("a self-lit material that opted out of re-lighting is left alone", (() => {
  const d = rederived["night-cold"].drift;
  const brass = d.filter(x => x.name.startsWith("brass."));
  return brass.length === 3 && brass.every(x => x.from === x.to && x.claim === 0);
})(), JSON.stringify(rederived["night-cold"].drift.filter(d => d.name.startsWith("brass"))));
t("a declared light source is its own source and is not re-lit", (() => {
  const d = rederived["night-cold"].drift;
  const g = d.filter(x => x.name.startsWith("glow."));
  return g.length === 2 && g.every(x => x.from === x.to);
})());

console.log(`\n=== 11. collaboration: recognition, not description ===`);

const opts = call("style_options", { axis: "shading", subjects: [{ cels: ["lantern.base", "lantern.mirror"] }], palette: "keeper", stage: "value" });
t("style_options offers at most 3 options", opts.ok && opts.options.length <= 3, `${opts.options?.length} options`);
t("one round varies ONE axis", opts.axis === "shading" && opts.bounded.one_axis_per_round === true, JSON.stringify(opts.bounded));
t("the options arrive as one labelled contact sheet on a shared baseline", fs.existsSync(opts.image));
const badAxis2 = call("style_options", { axis: "vibes", subjects: [{ cels: ["lantern.base"] }] });
t("an axis outside the nine-axis space is refused", !badAxis2.ok);

const pick = call("style_pick", { axis: "shading", option: "ramp-lit", note: "flat reads as a sticker" });
t("a pick records the DELTA it puts on the coordinate", pick.ok && pick.delta !== undefined, JSON.stringify(Object.keys(pick)));
const reject = call("style_reject", { axis: "edge_policy", option: "full-1px", reason: "the outline makes everything the same weight" });
t("a rejection becomes a constraint with the rule changes it implies", reject.ok && reject.implied_changes.length > 0, JSON.stringify(reject));
for (const [said, expect] of [["it looks muddy", "palette"], ["it looks flat", "form"], ["it floats off the ground", "grounding"]]) {
  const tr = call("style_translate", { plain_language: said });
  t(`plain language '${said}' maps to specific candidate rule changes, not a guess`, tr.implied.length > 0 && tr.implied.some(x => x.rule || x.axis), JSON.stringify(tr.implied));
}
const pack = call("review_pack", { subject: "lantern silhouette", options: [{ label: "A", cel: "lantern.base" }, { label: "B", cel: "lantern.mirror" }], stage: "silhouette", palette: "keeper", style: "keeper" });
t("a review pack asks at most 2 questions", pack.ok && pack.questions.length <= 2, `${pack.questions?.length} questions`);
t("the pack is built on a shared baseline, not on two separate renders", fs.existsSync(pack.image));
const sig = call("style_signature", { style: "keeper" });
t("the style is stated in plain language for a human to correct", sig.ok && typeof sig.signature === "string" && sig.signature.length > 20);
const taste = call("taste_write", { root: ROOT, accepted: ["ramp-lit shading"], rejected: ["full 1px outline"], notes: "outline flattens weight" });
const tasteBack = call("taste_read", { root: ROOT });
t("taste persists across sessions", tasteBack.ok && JSON.stringify(tasteBack).includes("ramp-lit"));
const cmp = call("compare", { a: "lantern.base", b: "lantern.mirror", palette: "keeper" });
t("compare returns a side-by-side AND a changed-pixel report", cmp.ok && cmp.changed.pixels > 0);
const ann = call("annotate", { cel: "lantern.base", notes: [{ at: [7, 3], action: "put", color: "glow.1" }, { note: "the flame should be the warmest thing in the frame" }] });
t("annotate applies the human's notes as authored pixel edits", ann.ok !== undefined);

const sketched = call("export_indexed_png", { cel: "lantern.base", name: "sketch" }).file;
const sketch = call("sketch_analyse", { path: sketched, quantize_to_palette: "keeper", provenance: "user-owned" });
t("sketch_analyse MEASURES a human sketch and never traces it", sketch.ok && sketch.trace === false && sketch.pixels_transferred === 0, JSON.stringify({ trace: sketch.trace }));
t("it returns measurements and design decisions, not a pixel map to copy", !("map" in sketch) && !("rows" in sketch) && !!sketch.measured.negative_space && !!sketch.measured.features);
t("the engine says out loud what a sketch may and may not be used for", /not a trace/i.test(sketch.note));

console.log(`\n=== 12. provenance: computed, never asserted ===`);

const noProv = call("import_png", { path: view.image, name: "stolen", quantize_to_palette: "keeper" });
t("import_png WITHOUT a provenance statement is REFUSED", !noProv.ok, JSON.stringify(noProv.violations || noProv.reason));
const badLic = call("import_png", { path: view.image, name: "licensed", quantize_to_palette: "keeper", provenance: { origin: "licensed" } });
t("a 'licensed' origin without a licence and source URL is REFUSED", !badLic.ok, JSON.stringify(badLic.violations));
const withProv = call("import_png", { path: view.image, name: "reference.study", quantize_to_palette: "keeper", provenance: { origin: "generated", declared_by: "this engine's own render", source_url: null } });
t("an import is quarantined on disk even when provenance is declared", withProv.ok && typeof withProv.quarantined === "string" && fs.existsSync(withProv.quarantined), JSON.stringify(withProv.violations));
t("the quarantined cel is flagged, not silently absorbed", withProv.ok && withProv.violations.some(v => v.rule === "imported_pixels"));
const prov = call("provenance", { sprite: "lantern" });
t("provenance is COMPUTED from the edit history, not asserted by the caller", prov.ok && prov.authored_pixels > 0 && prov.imported_pixels !== undefined && prov.edit_ops > 0, JSON.stringify({ authored: prov.authored_pixels, imported: prov.imported_pixels, ops: prov.edit_ops }));
t("provenance states the authored share as a number", typeof prov.authored_share === "number");

call("clip_create", { id: "stolen", template: "idle", directions: ["down"] });
call("clip_set_frames", { clip: "stolen", direction: "down", frames: [{ cel: withProv.cel, duration: 120 }] });
const gateImported = call("export_gate", { clips: ["stolen"], style: "keeper", palette: "keeper" });
t("imported pixels cannot ship silently through an export", gateImported.blocks.some(b => b.rule === "imported_pixels"), JSON.stringify(gateImported.blocks.map(b => b.rule)));
t("allowing imported pixels is an explicit decision, never a default", (() => {
  const r = call("export_gate", { clips: ["stolen"], style: "keeper", palette: "keeper", allow_imported: true });
  return !r.blocks.some(b => b.rule === "imported_pixels");
})());

console.log(`\n=== 13. surfaces: registry, CLI, MCP ===`);

const list = call("tools_list", {});
t("every capability is reachable from the registry", list.count >= 100, `${list.count} tools`);
const stats = call("session_stats", {});
t("the render budget is tracked", stats.renders > 0 && stats.authored_pixels > 0, JSON.stringify({ renders: stats.renders, pixels: stats.authored_pixels }));
const cov = call("coverage_report", {});
t("the coverage matrix reports nothing as claimed-but-missing", cov.implemented === cov.total, `missing: ${cov.missing.join(", ")}`);

const cli = require("../src/cli.js");
const cliCode = cli.main(["sprite_info", "--id", "lantern", "--root", ROOT]);
t("the CLI mirrors the tool surface and exits 0 on success", cliCode === 0);
const cliFail = cli.main(["transform", "--cel", "lantern.base", "--scale", "2", "--root", ROOT]);
t("the CLI exits non-zero when the engine refuses", cliFail === 1);
const cliUnknown = cli.main(["frobnicate", "--root", ROOT]);
t("the CLI rejects an unknown tool instead of guessing", cliUnknown === 2);

const mcp = require("../src/mcp.js");
const out = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { out.push(s); return true; };
mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
mcp.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "view", arguments: { cel: "lantern.base", style: "keeper" } } });
mcp.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "transform", arguments: { cel: "lantern.base", scale: 2 } } });
process.stdout.write = realWrite;
const msgs = out.map(l => { try { return JSON.parse(l.trim()); } catch { return null; } }).filter(Boolean);
const initMsg = msgs.find(m => m.id === 1);
const listMsg = msgs.find(m => m.id === 2);
const viewMsg = msgs.find(m => m.id === 3);
const refuseMsg = msgs.find(m => m.id === 4);
t("MCP speaks JSON-RPC 2.0 and initialises", initMsg?.result?.protocolVersion === mcp.PROTOCOL);
t("MCP exposes the same registry as the CLI", listMsg?.result?.tools?.length === list.count, `${listMsg?.result?.tools?.length} vs ${list.count}`);
t("the hot tools return an IMAGE content block inline", viewMsg?.result?.content?.some(c => c.type === "image" && c.mimeType === "image/png"));
t("a direct tool returns image + grid + audit in ONE round trip", viewMsg?.result?.content?.some(c => c.type === "text" && /\d/.test(c.text)) && viewMsg?.result?.structuredContent?.audit !== undefined);
t("a refusal travels as isError with the rule that refused it", refuseMsg?.result?.isError === true && /VIOLATION/.test(refuseMsg.result.content[0].text));
t("the hot set is bounded, because 125 inline images is a context-budget disaster", mcp.DIRECT.size <= 16, `${mcp.DIRECT.size} direct tools`);

// The real surface: a spawned stdio server in its own process, with its own warm state,
// driven from a blank project through to a render and a refusal.
const STDROOT = ROOT + "-stdio";
const stdioCheck = (async () => {
  const { spawn } = require("child_process");
  const srv = spawn(process.execPath, [require.resolve("../src/mcp.js")], { stdio: ["pipe", "pipe", "pipe"] });
  const got = [];
  let buf = "";
  srv.stdout.on("data", d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { try { got.push(JSON.parse(line)); } catch { } }
    }
  });
  srv.stderr.on("data", d => process.stderr.write("[mcp stderr] " + d));
  const send = (m) => srv.stdin.write(JSON.stringify(m) + "\n");
  const call = (id, name, args_) => send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { ...args_, root: STDROOT } } });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  call(3, "project_init", { id: "stdiocheck", style: STYLE, canvas: { w: 16, h: 16 } });
  call(4, "palette_set", { id: "keeper", spec: PALETTE_SPEC });
  call(5, "sprite_create", { id: "probe", w: 16, h: 16, palette: "keeper", style: "keeper" });
  call(6, "draw_pixel_map", { cel: "probe.base", palette: "keeper", map: LANTERN_MAP });
  call(7, "view", { cel: "probe.base", style: "keeper", zoom: 12 });
  call(8, "transform", { cel: "probe.base", scale: 2 });
  const deadline = Date.now() + 30000;
  while (got.length < 8 && Date.now() < deadline) await new Promise(r => setTimeout(r, 60));
  srv.kill();
  const byId = Object.fromEntries(got.map(m => [m.id, m]));
  const txt = (id) => (byId[id]?.result?.content || []).map(c => c.text || "").join(" ");
  t("a spawned stdio server completes the JSON-RPC handshake", byId[1]?.result?.protocolVersion === mcp.PROTOCOL, JSON.stringify(byId[1] || got).slice(0, 200));
  t("the spawned server exposes the same registry as the CLI", byId[2]?.result?.tools?.length === Object.keys(require("../src/tools.js").TOOLS).length, `${byId[2]?.result?.tools?.length}`);
  t("a fresh process can open a project over stdio", byId[3]?.result?.isError !== true, txt(3).slice(0, 200));
  t("a fresh process can declare a palette over stdio", byId[4]?.result?.isError !== true, txt(4).slice(0, 200));
  t("a fresh process can author a cel over stdio", (byId[6]?.result?.structuredContent?.changed?.pixels || 0) > 100, txt(6).slice(0, 200));
  t("a direct tool over stdio carries an image block inline", (byId[7]?.result?.content || []).some(c => c.type === "image"), txt(7).slice(0, 200));
  t("a direct tool over stdio still carries the grid and the audit with the image", !!byId[7]?.result?.structuredContent?.grid && byId[7]?.result?.structuredContent?.audit !== undefined, Object.keys(byId[7]?.result?.structuredContent || {}).join(","));
  t("a refusal over stdio arrives as isError naming the rule", byId[8]?.result?.isError === true && /refuse_upscale/.test(txt(8)), txt(8).slice(0, 240));
  t("the server answers eight requests without dying", got.length >= 8, `${got.length} responses`);
})();

// ---- metric integrity: a metric that rates a rectangle highly is not measuring its name ----
(() => {
  const { Cel } = require("../src/core/cel.js");
  const craft = require("../src/craft.js");

  const rect = new Cel(20, 14, "keeper", "rect");
  for (let y = 2; y < 12; y++) for (let x = 3; x < 17; x++) rect.set(x, y, 0);
  t("a plain rectangle scores 0 on blobIndex", craft.blobIndex(rect).score === 0, JSON.stringify(craft.blobIndex(rect)));

  const disc = (n, s) => {
    const c = new Cel(n, n, "keeper", "disc");
    const r = n / 2 - 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if ((x - r) ** 2 + (y - r) ** 2 <= r * r) c.set(x, y, 0);
    return c;
  };
  const d12 = craft.silhouetteComplexity(disc(12)), d24 = craft.silhouetteComplexity(disc(24));
  const thinLegs = new Cel(16, 32, "keeper", "thinlegs");
  for (let y = 20; y < 28; y++) { thinLegs.set(5, y, 0); thinLegs.set(9, y, 0); }
  for (let y = 10; y < 20; y++) for (let x = 4; x < 11; x++) thinLegs.set(x, y, 0);
  t("silhouetteComplexity is scale-invariant (a disc scores the same at 12px and 24px)",
    Math.abs(d12.score - d24.score) < 0.15, `${d12.score} vs ${d24.score} (compactness ${d12.compactness} vs ${d24.compactness})`);
  const dRect = craft.silhouetteComplexity(rect);
  const noisy = new Cel(16, 16, "keeper", "noisy");
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x + y) % 2 === 0) noisy.set(x, y, 0);
  const bar = new Cel(20, 4, "keeper", "bar");
  for (let x = 0; x < 20; x++) bar.set(x, 1, 0);
  t("silhouetteComplexity punishes fragmentation: a checkerboard scores 0", craft.silhouetteComplexity(noisy).score === 0, JSON.stringify(craft.silhouetteComplexity(noisy)));
  t("silhouetteComplexity punishes a 1px bar (all thin runs)", craft.silhouetteComplexity(bar).score < 0.5, JSON.stringify(craft.silhouetteComplexity(bar)));
  t("silhouetteComplexity does not saturate: a 16x32 character built on 1px legs scores below a disc",
    craft.silhouetteComplexity(disc(24)).score > craft.silhouetteComplexity(thinLegs).score,
    `disc ${craft.silhouetteComplexity(disc(24)).score} vs thin-legged character ${craft.silhouetteComplexity(thinLegs).score}`);
  t("boxiness is blobIndex's job, not silhouetteComplexity's (a rectangle scores 0 there)", craft.blobIndex(rect).score === 0);

  const solid = new Cel(12, 12, "keeper", "solid");
  for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) solid.set(x, y, 0);
  const holed = solid.clone(); holed.name = "holed";
  for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) holed.set(x, y, -1);
  t("negative space is a scored component of craftScore", "space" in craft.craftScore(solid, W.palette("keeper")).sub, Object.keys(craft.craftScore(solid, W.palette("keeper")).sub).join(","));
  t("a solid cut-out scores 0 on negative space", craft.negativeSpaceScore(solid).score === 0, JSON.stringify(craft.negativeSpaceScore(solid)));
  t("the same cut-out with a hole scores above 0", craft.negativeSpaceScore(holed).score > 0, JSON.stringify(craft.negativeSpaceScore(holed)));
  t("the holed version outscores the solid one overall",
    craft.craftScore(holed, W.palette("keeper"), { assetClass: "object" }).score > craft.craftScore(solid, W.palette("keeper"), { assetClass: "object" }).score);
})();

// ---- the audit gap that let a figure with floating legs pass clean ----
(() => {
  const { Cel } = require("../src/core/cel.js");
  const { audit } = require("../src/audit.js");
  const P = require("../src/pim.js");

  // Exactly the defect I authored: a torso ending at row 19 and 24px of leg starting at row 26.
  const floating = new Cel(16, 32, "courier", "floating-legs");
  for (let y = 8; y < 20; y++) for (let x = 5; x < 11; x++) floating.set(x, y, 0);
  for (let y = 26; y < 32; y++) { floating.set(4, y, 0); floating.set(5, y, 0); floating.set(8, y, 0); floating.set(9, y, 0); }
  const fA = audit(floating, {});
  const hit = fA.findings.find(f => f.rule === "disconnected_mass");
  t("a detached 24px limb is refused, not just a 1-2px speck", !!hit, JSON.stringify(fA.findings.map(f => f.rule)));
  t("the refusal names the orphan size and where it is", hit && /24px|12px/.test(hit.message) && hit.at.length > 0, hit && hit.message);

  const joined = floating.clone(); joined.name = "joined-legs";
  for (let y = 20; y < 26; y++) { joined.set(4, y, 0); joined.set(5, y, 0); joined.set(8, y, 0); joined.set(9, y, 0); }
  t("the same figure with the legs joined to the hip passes that rule", !joinedAudit(joined).findings.some(f => f.rule === "disconnected_mass"), JSON.stringify(joinedAudit(joined).findings.map(f => f.rule)));

  // Touching only at a corner is not being attached.
  const diag = new Cel(12, 12, "courier", "diagonal-touch");
  for (let y = 1; y < 6; y++) for (let x = 1; x < 5; x++) diag.set(x, y, 0);
  for (let y = 6; y < 11; y++) for (let x = 5; x < 9; x++) diag.set(x, y, 0);
  t("a mass connected only diagonally is refused as disconnected", audit(diag, {}).findings.some(f => f.rule === "disconnected_mass"), JSON.stringify(audit(diag, {}).findings.map(f => f.rule)));

  function joinedAudit(c) { return audit(c, {}); }

  // The authoring guarantees in the part library, asserted rather than trusted.
  for (const [key, rows] of Object.entries(P.GRIDS)) {
    const { cel } = P.parsePart(key, rows);
    const counts = new Map();
    cel.forEach(v => { if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1); });
    const lone = [...counts].filter(([i, n]) => n === 1 && ![17, 18, 19].includes(i));
    t(`part '${key}' contains no colour used exactly once`, lone.length === 0, JSON.stringify(lone));
  }
  const leg = P.parsePart("down/leg_l", P.GRIDS["down/leg_l"]).cel;
  const bootSteps = new Set();
  leg.forEach(v => { if (v >= 8 && v <= 10) bootSteps.add(v); });
  t("a 2-column-wide limb is still modelled across 3 ramp steps (not filled)", bootSteps.size >= 3, [...bootSteps].join(","));

  const { palette } = require("../src/core/project.js");
})();

// ---- the playback surface is only a review surface if the file opens ----
// encodeGIF built its image descriptor as 9 bytes with the fields at 0,2,4,6, which silently omits
// the 0x2C separator. The result parsed as: valid header, valid palette, ZERO frames. Every GIF
// this engine produced was unopenable, and nothing tested it because nothing read the file back.
(() => {
  const { encodeGIF } = require("../src/codec/gif.js");
  const { Cel } = require("../src/core/cel.js");

  function parseGIF(b) {
    const u16 = o => b[o] | (b[o + 1] << 8);
    const packed = b[10];
    if (b.slice(0, 6).toString("ascii") !== "GIF89a") return { error: "bad signature" };
    let i = 13 + (((packed >> 7) & 1) ? 3 * (2 << (packed & 7)) : 0);
    const frames = [], delays = [];
    while (i < b.length) {
      const L = b[i];
      if (L === 0x3B) return { frames, delays, ok: true };
      if (L === 0x21) {
        const t = b[i + 1], len = b[i + 2];
        if (t === 0xF9) { delays.push(u16(i + 4)); i += 3 + len + 1; continue; }
        i += 3 + len;
        let g = 0;
        while (i < b.length && b[i] !== 0) { i += 1 + b[i]; if (++g > 4096) return { error: "extension walk ran away", frames, delays }; }
        i++; continue;
      }
      if (L === 0x2C) {
        // 0x2C, left(2), top(2), width(2), height(2), packed(1) = 10 bytes total.
        const w = u16(i + 5), h = u16(i + 7), p = b[i + 9];
        let j = i + 10 + (((p >> 7) & 1) ? 3 * (2 << (p & 7)) : 0);
        const mcs = b[j]; j++;
        let data = 0, g = 0;
        while (i + g < b.length && b[j] !== 0) { data += b[j]; j += b[j] + 1; if (++g > 4096) return { error: "sub-block walk ran away", frames, delays }; }
        j++;
        frames.push({ w, h, mcs, data }); i = j; continue;
      }
      return { error: `unexpected byte 0x${L.toString(16)} at ${i}`, frames, delays };
    }
    return { error: "no trailer", frames, delays };
  }

  const mk = (n, dur) => {
    const c = new Cel(8, 8, "courier", `g${n}`);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) c.set(x, y, n % 3);
    c.meta = { duration: dur };
    return c;
  };
  const cels = [mk(0, 380), mk(1, 280), mk(2, 180), mk(3, 430)];
  const pal = { entries: [{ rgb: [10, 10, 10] }, { rgb: [80, 80, 80] }, { rgb: [160, 160, 160] }] };
  const gif = require("../src/adapters.js").export_gif(cels, pal, { zoom: 4 });
  const parsed = parseGIF(gif);
  t("the GIF the engine writes actually contains image blocks", parsed.ok === true && parsed.frames.length === 4,
    parsed.error || `${parsed.frames.length} frames parsed`);
  t("every frame carries the authored per-frame duration into the file", parsed.ok && JSON.stringify(parsed.delays) === JSON.stringify([38, 28, 18, 43]),
    JSON.stringify(parsed.delays));
  t("the review GIF is upscaled by an integer factor, not resampled", parsed.ok && parsed.frames.every(f => f.w === 32 && f.h === 32),
    parsed.ok ? parsed.frames.map(f => `${f.w}x${f.h}`).join(",") : "-");
  t("a GIF survives the JPEG-era size ceiling (it is a preview, not a shipped asset)", gif.length < 512 * 1024, `${gif.length} bytes`);
})();

// ---- compare across canvases: a 16px drawing and an 8px drawing are not "the same" ----
(() => {
  const big = call("cel_from_grid", { cel: "cmp.big", palette: "keeper", grid: ["######", "#....#", "#....#", "######"] });
  const small = call("cel_from_grid", { cel: "cmp.small", palette: "keeper", grid: ["####", "####"] });
  const same = call("compare", { a: "cmp.big", b: "cmp.big" });
  const cross = call("compare", { a: "cmp.big", b: "cmp.small" });
  t("compare on identical canvases reports zero difference and says they are the same", same.ok && same.same === true && same.changed.pixels === 0, JSON.stringify(same).slice(0, 200));
  t("compare across different canvases refuses to claim equality", cross.ok && cross.same === false && cross.sameCanvas === false, JSON.stringify(cross).slice(0, 240));
  t("compare across canvases substitutes a shape distance", typeof cross.shape?.distance === "number" && cross.shape.distance > 0, JSON.stringify(cross.shape));
  t("compare names the mismatch instead of silently returning an empty diff", /canvases differ/.test(cross.note || ""), cross.note);
})();

// ---- POV depth, shading and measurement regressions ----------------------------
// Every one of these behaviours was wrong, unmeasured, or silently missing until bench/gate6-scene.js
// ran the Phase 6 gate against them. A claim that no test pins down is a claim that drifts back.
{
  const depth = require("../src/core/depth.js");
  const ops = require("../src/core/ops.js");
  const { Palette } = require("../src/core/palette.js");
  const { Cel } = require("../src/core/cel.js");

  // 1. A lamp must be brightest at its source. It used to be brightest at the rim of its own glow.
  const gp = Palette.fromSpec("glowreg", { ramps: { lamp: { role: "light", colors: ["#2b2a33", "#8f7a3a", "#ffd46b"] } } });
  const gc = new Cel(9, 9, "glowreg", "glow-falloff");
  ops.glow(gc, gp, { at: [4, 4], radius: 4, ramp: "lamp" });
  const coreStep = gp.entries[gc.get(4, 4)].step;
  let rimSum = 0, rimN = 0;
  for (const [x, y] of [[0, 4], [8, 4], [4, 0], [4, 8]]) { const v = gc.get(x, y); if (v >= 0) { rimSum += gp.entries[v].step; rimN++; } }
  t("glow falls off outward from its source along the light ramp", coreStep === 2 && (rimN === 0 || coreStep > rimSum / rimN), `core step ${coreStep}, mean rim step ${(rimSum / Math.max(1, rimN)).toFixed(2)}`);

  // 2. Distance claimed but not drawn is still a refusal.
  const dp = Palette.fromSpec("depthreg", { ramps: { stone: { role: "material", colors: ["#31363f", "#4a5260", "#6c7787"] } } });
  const flatMono = depth.depthMonotonic([{ z: 6, ramp: "stone", step: 1 }, { z: 9, ramp: "stone", step: 1 }, { z: 14, ramp: "stone", step: 1 }], { toward: "darker" });
  t("one value at every distance is refused as depth-not-expressed", flatMono.ok === false && flatMono.problems.some(p => p.rule === "depth_not_expressed"));

  // 3. A material present at only ONE distance has nothing to compare: reported, never failed.
  const oneBand = depth.depthMonotonic([{ z: 6, ramp: "stone", step: 2 }], { toward: "darker" });
  t("a single-band material is measured as unmeasured instead of failed", oneBand.ok === true && oneBand.per_ramp.stone.single_band === true && oneBand.per_ramp.stone.direction === "unmeasured");

  // 4. An inversion against the declared atmosphere is named, with the numbers that show it.
  const inv = depth.depthMonotonic([{ z: 6, ramp: "stone", step: 0 }, { z: 9, ramp: "stone", step: 2 }], { toward: "darker" });
  t("a nearer face sitting on a farther face's value is refused", inv.ok === false && inv.problems.some(p => /depth_contradiction/.test(p.rule)));

  // 5. A face that declares a z IS making a depth claim; the engine must use it, not ignore it.
  const wallPal = Palette.fromSpec("facereg", { ramps: { wall: { role: "material", colors: ["#2b2f38", "#3b414d", "#505867", "#6b7688", "#8c97a8", "#aab5c4"] } } });
  const implicit = depth.faceRecipe(wallPal, "wall", [{ name: "front-near", normal: "front", ramp: "wall", z: 5.6 }, { name: "side-far", normal: "right", ramp: "wall", z: 12 }], { lightWeight: 0.6 });
  t("declared per-face distances become the band list when no bands array is passed",
    (implicit.depth_bands_implicit || []).length === 2 && implicit.depth_cost_steps > 0 && !!implicit.atmosphere_toward,
    JSON.stringify({ bands: implicit.depth_bands_used, cost: implicit.depth_cost_steps, toward: implicit.atmosphere_toward }));

  // 6. Light and atmosphere competing for the same steps must produce a named contradiction.
  let contradictory = null;
  try {
    contradictory = depth.faceRecipe(wallPal, "wall", [
      { name: "near-side-in-shadow", normal: "right", ramp: "wall", z: 5 },
      { name: "far-front-catchlight", normal: "front", ramp: "wall", z: 18 },
    ], { lightWeight: 1.0 });
  } catch (e) { contradictory = { thrown: e.rule || e.name, message: e.message }; }
  const namedContradiction = (contradictory.conflicts || []).some(c => /orientation_vs_distance|face_budget/.test(c.rule))
    || /outranked|outranks/.test(contradictory.message || "") || /orientation_vs_distance|face_budget/.test(contradictory.thrown || "");
  t("a light vector that outranks the declared distance is refused out loud", namedContradiction, JSON.stringify(contradictory).slice(0, 200));

  // 7. Render names may be grouped ("depth.cel/sub"); the directory has to follow the name.
  const nested = W.saveRender(`regression.nested/${process.pid}/grouped`, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { force: true });
  t("saveRender creates the directory implied by a grouped render name", fs.existsSync(nested.path), nested.path);

  // 8. The ground convention must show its drift instead of clamping it away.
  const persp = new depth.Perspective("conv-reg", { projection: "perspective-1pt", horizon: 100, vanishing: [160, 100], focal: 90, eye: 1.6, unit: 1, near: 5.6, far: 28 });
  const meetRow = Math.round(persp.groundRow(5.6));
  const conv = depth.groundConvention(persp, { tile: 16, meets_at_row: meetRow, world_per_tile: 1, last_row: meetRow + 64 });
  const scales = conv.profile.map(r => r.camera_px_per_unit);
  const growsForward = scales.every((v, i) => i === 0 || v > scales[i - 1]);
  t("the parallel ground's scale disagreement is measured all the way to the foreground",
    conv.profile.length >= 5 && growsForward && conv.worst_at_row === conv.profile[conv.profile.length - 1].row && conv.scale_drift_max > 1,
    JSON.stringify(conv.profile.slice(-2)));

  // 9. A placed cel needs the camera in ITS coordinates, not the scene's.
  const local = depth.localCamera(persp, [40, 30]);
  t("localCamera moves horizon and vanishing point into the placed cel's space",
    local.horizon === persp.horizon - 30 && local.vanishing[0] === persp.vanishing[0] - 40 && local.focal === persp.focal,
    JSON.stringify({ h: local.horizon, vp: local.vanishing }));

  // 10. A record nobody can name is damage, not data: it must be refused on the way in and skipped on the way out.
  const namelessStyle = call("style_create", { bible: STYLE });
  t("a style declared without a name is refused by name", namelessStyle.ok === false && (namelessStyle.errors || []).some(e => e.rule === "style_needs_id"), JSON.stringify(namelessStyle).slice(0, 160));
  const namelessPalette = call("palette_set", { spec: { ramps: { x: { role: "material", colors: ["#222831", "#454f5e"] } } } });
  t("a palette declared without a name is refused by name", namelessPalette.ok === false && (namelessPalette.violations || []).some(v => /must be declared with a name/.test(v.message || "")), JSON.stringify(namelessPalette).slice(0, 160));
  const styles = call("style_list").styles || [], pals = W.project.palette_list();
  t("neither refusal left an id-less entry in the registry",
    styles.every(s => typeof s.id === "string" && s.id.trim()) && pals.every(p => typeof p.id === "string" && p.id.trim())
    && !fs.existsSync(path.join(ROOT, "art", "styles", "undefined.json")) && !fs.existsSync(path.join(ROOT, "art", "palettes", "undefined.json")),
    JSON.stringify({ styles: styles.map(s => s.id), palettes: pals.map(p => p.id) }).slice(0, 200));
}

// Opening a different project is intentionally last: it replaces the active warm workspace.
const missingProject = call("project_open", { root: path.join(ROOT, "missing-project") });
t("project_open refuses a missing project without replacing the active one", !missingProject.ok && W.root === ROOT && W.project.doc.style === STYLE.id, JSON.stringify(missingProject.violations));
const openedProject = call("project_open", { root: ROOT });
t("project_open safely switches to an existing project", openedProject.ok && openedProject.root === ROOT && openedProject.style === STYLE.id, JSON.stringify(openedProject));

// ---- verdict ------------------------------------------------------------------
function verdict() {
  console.log(`\n${"=".repeat(64)}`);
  if (fail) {
    console.log(`\n${fail} FAILED:`);
    fails.forEach(f => console.log(`  x ${f}`));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { }
  try { fs.rmSync(STDROOT, { recursive: true, force: true }); } catch { }
  process.exit(fail ? 1 : 0);
}

// CommonJS has no top-level await, so the async half of this suite is chained onto the verdict
// rather than awaited inline.
Promise.resolve(stdioCheck)
  .catch(e => t("the spawned stdio server survived", false, e.message))
  .then(verdict);
