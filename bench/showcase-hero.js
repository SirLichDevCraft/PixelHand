// PixelHand showcase: an original woodland hero, rigged for eight authored facings.
// Run with: node bench/showcase-hero.js
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS, W } = require("../src/tools.js");
const { Cel } = require("../src/core/cel.js");
const rig = require("../src/core/rig.js");
const { encodeRGB } = require("../src/codec/png.js");

const ROOT = path.join(__dirname, "..", "showcase", "hero");
const OUT = path.join(ROOT, "preview");
const WID = 32, HEI = 40, BASELINE = 36;
const DIRS = rig.DIRECTIONS;
const STYLE = {
  id: "woodland-hero", projection: "side", art_scale: 32, palette_size: 24,
  temperature: "warm-cool-hue-shift", edge_policy: "full-1px", shading: "ramp-lit",
  detail: "moderate", motion: "4-frame", mood: "cozy-warm", light_vector: [-0.7, -0.7],
  signature: "deep forest cloak, ember scarf, brass compass clasp, and a leaf-shaped sword",
};
const PALETTE = {
  ramps: {
    cloak: { role: "material", colors: ["#263b42", "#315a59", "#4c8170", "#83a878"] },
    leather: { role: "material", colors: ["#493641", "#795043", "#b06b4b"] },
    skin: { role: "material", colors: ["#9e594b", "#d18462", "#f2bb79"] },
    steel: { role: "material", colors: ["#52636a", "#91a5a0", "#d2d5b6"] },
    hair: { role: "material", colors: ["#392e3a", "#65413e", "#9a5c42"] },
  },
  single: {
    ink: { rgb: "#211f2b", role: "outline" },
    ember: { rgb: "#e5674f", role: "accent" },
    brass: { rgb: "#f0c660", role: "accent" },
    glint: { rgb: "#f7e4a1", role: "highlight" },
  },
};

const reportOnly = new Set(["audit", "craft_metrics", "silhouette", "value_map", "squint", "loop_validate", "export_gate"]);
function call(name, args = {}) {
  const r = TOOLS[name].run(args);
  if (r?.ok === false && !reportOnly.has(name)) throw new Error(`${name}: ${r.reason || JSON.stringify(r.violations || r)}`);
  return r;
}
fs.mkdirSync(OUT, { recursive: true });
call("project_init", { root: ROOT, game: "woodland-hero-showcase", style: STYLE, canvas: { w: WID, h: HEI }, fps: 10, directions: DIRS });
call("palette_set", { id: "hero", spec: PALETTE });
call("sprite_create", {
  id: "rowan", w: WID, h: HEI, palette: "hero", style: STYLE.id, tier: "hero", asset_class: "character",
  anchor: { x: 16, y: BASELINE },
  design: {
    primary_read: "a young woodland sword-bearer in a broad travel cloak",
    exaggerated: "the swept hood and ember scarf silhouette the head; the leaf blade points the facing",
    focal_accent: "one bright brass compass clasp at the throat",
    shape_family: "hooded_pathfinder",
    provenance_note: "original PixelHand hand-authored showcase character; no game sprite imported",
  },
});
const pal = W.palette("hero");
const ci = name => { const i = pal.index(name); if (i < 0) throw new Error(`missing palette color ${name}`); return i; };

// Each component is authored in canvas coordinates per facing, then cropped to its own cel.
// Poses re-place the actual legs and arms around invariant joints; no whole-image translation.
function painter() {
  const data = new Int16Array(WID * HEI).fill(-1);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < WID && y < HEI) data[y * WID + x] = ci(c); };
  const rect = (x, y, w, h, c) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, c); };
  const poly = (pts, c) => {
    const ymin = Math.min(...pts.map(p => p[1])), ymax = Math.max(...pts.map(p => p[1]));
    for (let y = ymin; y <= ymax; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
        xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) put(x, y, c);
    }
    for (let i = 0; i < pts.length; i++) {
      let [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let s = 0; s <= n; s++) put(Math.round(x1 + (x2 - x1) * s / Math.max(1, n)), Math.round(y1 + (y2 - y1) * s / Math.max(1, n)), "ink");
    }
  };
  return { data, put, rect, poly };
}
function crop(data, name) {
  let x0 = WID, y0 = HEI, x1 = -1, y1 = -1;
  for (let y = 0; y < HEI; y++) for (let x = 0; x < WID; x++) if (data[y * WID + x] >= 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < x0) throw new Error(`empty part ${name}`);
  const c = new Cel(x1 - x0 + 1, y1 - y0 + 1, "hero", name);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c.set(x - x0, y - y0, data[y * WID + x]);
  return { cel: c, at: [x0, y0] };
}
const specs = {
  down:      { cx: 16, head: [12,5,8,8], cloak: [10,14,12,14], face: "front", weapon: [22,13,1] },
  downRight: { cx: 18, head: [14,5,8,8], cloak: [11,14,12,14], face: "diag", weapon: [24,13,1] },
  right:     { cx: 19, head: [15,6,8,7], cloak: [11,14,12,14], face: "side", weapon: [25,13,1] },
  upRight:   { cx: 18, head: [14,5,8,8], cloak: [11,14,12,14], face: "backdiag", weapon: [8,13,-1] },
  up:        { cx: 16, head: [12,5,8,8], cloak: [10,14,12,14], face: "back", weapon: [6,13,-1] },
  upLeft:    { cx: 14, head: [10,5,8,8], cloak: [9,14,12,14], face: "backdiag", weapon: [4,13,-1] },
  left:      { cx: 13, head: [9,6,8,7], cloak: [9,14,12,14], face: "side", weapon: [3,13,-1] },
  downLeft:  { cx: 14, head: [10,5,8,8], cloak: [9,14,12,14], face: "diag", weapon: [4,13,-1] },
};
const dirs = Object.fromEntries(Object.entries(specs).map(([k, v]) => [k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), v]));
const poseParts = [
  { name: "contact", gait: { phase: 1 }, partPoses: { leg_near: "plant_near", leg_far: "plant_far" }, parts: { body: { dy: 0 }, head: { dy: 0 }, cloak: { dy: 0 } }, weight: 0, note: "both feet land at the ends of a short stride" },
  { name: "down", gait: { phase: 0.35 }, partPoses: { leg_near: "plant_near", leg_far: "swing_far" }, parts: { body: { dy: 1 }, head: { dy: 1 }, cloak: { dy: 1 } }, weight: 0.3, note: "weight settles while the far foot lowers" },
  { name: "passing", gait: { phase: -0.35 }, partPoses: { leg_near: "swing_near", leg_far: "plant_far" }, parts: { body: { dy: 0 }, head: { dy: 0 }, cloak: { dy: 0 } }, weight: 1, note: "feet exchange roles under the hips" },
  { name: "up", gait: { phase: -1 }, partPoses: { leg_near: "swing_high_near", leg_far: "plant_far" }, parts: { body: { dy: -1 }, head: { dy: -1 }, cloak: { dy: -1 } }, weight: 0.4, note: "back foot pushes off; near leg recovers" },
];

const rigDef = { canvas: [WID, HEI], baseline: BASELINE, gaitStride: 1.4, gaitParts: { arm_near: "hinged", arm_far: "hinged", blade: "held" }, anchors: {}, zOrder: {}, partJoints: {}, limbWidth: { leg: 4, arm: 3 } };
const skinParts = [];
for (const [dir, s] of Object.entries(dirs)) {
  const cx = s.cx, [hx, hy, hw, hh] = s.head, [cx0, cy, cw, ch] = s.cloak;
  const [weaponX, weaponY] = s.weapon;
  rigDef.anchors[dir] = { origin: [0, 0], head: [cx, 8], shoulder: [cx, 16], hip: [cx, 27], feet: [cx, BASELINE], grip: [weaponX + 2, weaponY + 11] };
  // Far limbs sit behind the torso; near limbs overlap it. The old uniform order put both arms
  // in front, flattening every facing into the same paper cut-out.
  rigDef.zOrder[dir] = ["leg_far", "arm_far", "cloak", "body", "head", "leg_near", "arm_near", "blade"];
  rigDef.partJoints = { leg_far: { joint: "hip" }, leg_near: { joint: "hip" }, cloak: { joint: "origin" }, blade: { joint: "grip" }, body: { joint: "hip" }, head: { joint: "head" }, arm_far: { joint: "shoulder" }, arm_near: { joint: "shoulder" } };
  const add = (name, draw, pose = null) => {
    const p = painter(); draw(p); const key = pose ? `part/${dir}/${pose}/${name}` : `part/${dir}/${name}`;
    const { cel, at } = crop(p.data, `rowan/${key}`);
    const id = cel.name; W.store.put(id, cel); W.project.writeCel("rowan", key, cel);
    const joint = name === "head" ? "head" : name.startsWith("leg") || name === "body" ? "hip" : name.startsWith("arm") ? "shoulder" : name === "blade" ? "grip" : "origin";
    const pivot = rigDef.anchors[dir][joint];
    const partDef = { direction: dir, name, cel: id, cel_key: key, joint, offset: [at[0] - pivot[0], at[1] - pivot[1]] };
    if (pose) partDef.pose = pose;
    skinParts.push(partDef);
  };
  add("cloak", p => {
    // A short, split travel mantle leaves both arms and legs readable.
    p.poly([[cx0+2,cy],[cx0+cw-3,cy],[cx0+cw-1,cy+4],[cx0+cw-2,cy+ch-2],[cx0+cw-5,cy+ch],[cx0+cw/2,cy+ch-2],[cx0+2,cy+ch],[cx0,cy+4]], "cloak.1");
    p.poly([[cx0+3,cy+2],[cx0+cw-4,cy+2],[cx0+cw-4,cy+ch-3],[cx0+cw/2,cy+ch-4],[cx0+3,cy+ch-2]], "cloak.2");
    p.rect(cx0+2,cy+4,2,ch-7,"cloak.0");
    p.rect(cx0+4,cy+3,2,3,"cloak.3"); p.rect(cx0+cw-5,cy+4,1,4,"cloak.3");
    p.put(cx0+cw/2,cy+ch-2,"cloak.0");
  });
  add("body", p => {
    const torso = s.face === "side"
      ? [[cx-2,15],[cx+3,14],[cx+4,18],[cx+3,26],[cx+1,28],[cx-2,27],[cx-3,22],[cx-3,18]]
      : s.face === "backdiag"
        ? [[cx-4,15],[cx+3,14],[cx+4,18],[cx+3,26],[cx+1,28],[cx-3,27],[cx-5,23],[cx-5,18]]
        : s.face === "back"
          ? [[cx-3,14],[cx+3,14],[cx+5,18],[cx+4,26],[cx+2,28],[cx-2,28],[cx-4,26],[cx-5,18]]
          : [[cx-4,14],[cx+3,14],[cx+5,18],[cx+4,26],[cx+2,28],[cx-3,28],[cx-5,25],[cx-5,18]];
    p.poly(torso, "leather.1");
    p.rect(cx-4,19,1,4,"leather.0"); p.rect(cx+3,19,1,4,"leather.2");
    p.rect(cx-3,16,6,8,"cloak.0"); p.rect(cx-2,16,4,6,"cloak.1");
    p.rect(cx-2,17,2,2,"cloak.3"); p.rect(cx+1,21,1,2,"cloak.2");
    p.put(cx,15,"ember"); p.put(cx+1,15,"ember"); p.put(cx+1,16,"brass"); p.put(cx+1,17,"glint");
    p.rect(cx-4,26,8,2,"leather.2"); p.put(cx+2,27,"brass");
    if (s.face === "back" || s.face === "backdiag") { p.rect(cx-2,18,5,6,"leather.0"); p.put(cx,19,"leather.2"); }
  });
  add("head", p => {
    p.poly([[hx+2,hy],[hx+hw-2,hy],[hx+hw,hy+2],[hx+hw-1,hy+hh-2],[hx+hw-3,hy+hh],[hx+2,hy+hh],[hx,hy+hh-2],[hx,hy+2]], "skin.1");
    // swept dark hair/hood cap, with warm pixels at the lit edge
    p.poly([[hx,hy+3],[hx+1,hy],[hx+hw-2,hy-1],[hx+hw,hy+2],[hx+hw-2,hy+4],[hx+hw-5,hy+3],[hx+3,hy+5]], "hair.1");
    p.put(hx+2,hy+1,"hair.2"); p.put(hx+3,hy,"hair.2");
    if (s.face === "front" || s.face === "diag") {
      p.put(hx+2,hy+5,"ink"); p.put(hx+hw-3,hy+5,"ink");
      p.put(hx+2,hy+4,"glint"); p.put(hx+hw-3,hy+4,"glint");
      p.put(hx+4,hy+7,"skin.2"); p.put(hx+5,hy+7,"skin.2");
    } else if (s.face === "side") {
      const ex = dir === "right" ? hx+5 : hx+2;
      p.put(ex,hy+5,"ink"); p.put(ex,hy+4,"glint");
      p.put(dir === "right" ? hx+hw-1 : hx-1, hy+6, "skin.2");
    } else if (s.face === "backdiag") {
      p.rect(hx+2,hy+4,hw-4,4,"hair.0"); p.put(hx+2,hy+3,"hair.2");
    } else {
      p.rect(hx+1,hy+3,hw-2,5,"hair.0"); p.put(hx+2,hy+2,"hair.2"); p.put(hx+hw-3,hy+2,"hair.1");
    }
    // ember scarf tails wrap differently in front and rear views
    p.rect(cx-4,13,8,2,"ember"); p.put(cx+3,14,"glint");
    if (dir.includes("right")) p.poly([[cx+2,14],[cx+7,15],[cx+4,19],[cx+1,17]],"ember");
    else if (dir.includes("left")) p.poly([[cx-2,14],[cx-7,15],[cx-4,19],[cx-1,17]],"ember");
  });
  add("leg_far", p => { p.poly([[cx-7,27],[cx-4,27],[cx-4,31],[cx-5,34],[cx-8,34],[cx-8,32]],"leather.0"); p.rect(cx-8,33,4,2,"leather.2"); });
  add("leg_near", p => { p.poly([[cx+3,27],[cx+6,27],[cx+7,32],[cx+7,35],[cx+2,35],[cx+2,32]],"leather.1"); p.rect(cx+3,33,4,2,"leather.2"); p.put(cx+3,34,"brass"); });
  add("arm_far", p => { p.poly([[cx-4,16],[cx-2,16],[cx-3,20],[cx-5,24],[cx-7,23],[cx-6,20]],"leather.0"); p.put(cx-6,22,"skin.1"); });
  add("arm_near", p => {
    // The gloved hand overlaps the sword grip so the weapon reads as held.
    p.poly([[cx+3,16],[cx+5,16],[cx+6,20],[cx+7,22],[cx+6,24],[cx+3,23],[cx+2,20]],"leather.1");
    p.put(cx+6,22,"skin.2"); p.put(cx+5,23,"leather.2");
  });
  add("blade", p => {
    const [wx, wy, sign] = s.weapon;
    if (sign > 0) p.poly([[wx,wy+8],[wx+2,wy+8],[wx+3,wy+2],[wx+5,wy],[wx+4,wy+8],[wx+2,wy+11],[wx,wy+10]],"steel.1");
    else p.poly([[wx+5,wy+8],[wx+3,wy+8],[wx+2,wy+2],[wx,wy],[wx+1,wy+8],[wx+3,wy+11],[wx+5,wy+10]],"steel.1");
    p.put(wx+(sign>0?4:1),wy+2,"steel.2"); p.put(wx+(sign>0?3:2),wy+4,"steel.2");
    p.rect(wx+1,wy+9,4,1,"brass"); p.rect(wx+2,wy+10,2,3,"leather.1"); p.put(wx+2,wy+12,"brass");
  });
  // Each leg has planted, swing, and high-swing keys. The hip row is fixed in every key;
  // the knee and foot change shape instead of translating the entire leg off its joint.
  for (const poseName of ["plant", "swing", "swing_high"]) for (const near of [true, false]) {
    const name = near ? "leg_near" : "leg_far";
    const forwardX = Math.sign(rig.DIRECTION_VECTORS[dir][0]);
    const stride = poseName === "plant" ? (near ? 1 : -1) * forwardX : forwardX;
    const hipX = cx + (near ? 2 : -3);
    const footY = poseName === "plant" ? 35 : 34;
    const kneeX = hipX + (poseName === "swing_high" ? 3 : 2);
    const poseKey = `${poseName}_${near ? "near" : "far"}`;
    add(name, p => {
      const base = near ? "leather.1" : "leather.0";
      const lit = near ? "leather.2" : "leather.1";
      if (poseName === "plant") {
        p.poly([[hipX-1,27],[hipX+2,27],[hipX+3,31],[hipX+4,33],[hipX+4+stride,footY],[hipX+stride,footY],[hipX-1,32]],base);
        p.rect(hipX+1,29,1,3,lit);
        p.rect(Math.min(hipX+stride,hipX+4+stride),footY-1,3,1,"leather.2");
      } else {
        p.poly([[hipX,27],[hipX+3,27],[hipX+3,29],[kneeX,31],[kneeX-1+stride,32],[kneeX+stride,footY-1],[kneeX-1+stride,footY],[hipX-2+stride,footY],[hipX-2+stride,footY-1],[hipX-1,31]],base);
        p.rect(hipX+1,28,2,2,lit);
        p.rect(hipX+stride-1,footY-1,3,1,"leather.2");
      }
      p.put(hipX+stride, footY-1, "brass");
    }, poseKey);
  }
}

call("rig_create", { id: "rowan", canvas: [WID, HEI], baseline: BASELINE, anchors: rigDef.anchors, zOrder: rigDef.zOrder, partJoints: rigDef.partJoints, limbWidth: rigDef.limbWidth, gaitStride: rigDef.gaitStride, gaitParts: rigDef.gaitParts });
call("skin_define", { id: "rowan", palette: "hero", sprite: "rowan", parts: skinParts });
poseParts.forEach(p => call("pose_define", { name: p.name, clip: "walk", spec: p }));
call("clip_create", { id: "walk", template: "walk", sprite: "rowan", fps: 10, directions: DIRS });

const skin = W.skins.get("rowan");
for (const dir of DIRS) {
  const frames = poseParts.map((p, i) => {
    const cel = rig.compose(skin, rigDef, new rig.Pose(p.name, p), dir, { name: `rowan/walk/${dir}/f${i}` });
    cel.paletteId = "hero"; W.store.put(cel.name, cel);
    W.project.writeCel("rowan", `walk/${dir}/f${i}`, cel);
    return { cel: cel.name, pose: p.name };
  });
  call("clip_set_frames", { clip: "walk", sprite: "rowan", direction: dir, frames });
}
const timing = call("timing_apply", { clip: "walk", durations: [100, 100, 100, 100], fps: 10 });
const lv = call("loop_validate", { clip: "walk", expect_refusal: true });
const motion = call("motion_report", { clip: "walk" });
const allAudits = DIRS.flatMap(dir => poseParts.map((_, i) => call("audit", { cel: `rowan/walk/${dir}/f${i}`, style: STYLE.id, asset_class: "character" })));
const gate = call("export_gate", { clips: ["walk"], style: STYLE.id, palette: "hero", assetClass: "character" });
const sheet = call("contact_grid", { clip: "walk", palette: "hero", zoom: 5, mode: "view", stamp: "ROWAN — woodland pathfinder — 8 authored facings × 4 walk poses" });
const silhouette = call("contact_grid", { clip: "walk", palette: "hero", zoom: 5, mode: "silhouette", stamp: "ROWAN — silhouette check — 8 facings × 4 poses" });
const gif = call("play", { clip: "walk", palette: "hero", directions: ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"], zoom: 8 });

// A clean large single-frame portrait beside the engine's labeled contact sheets.
const previewCel = W.store.get("rowan/walk/down/f0");
const zoom = 12, rgb = Buffer.alloc(WID * zoom * HEI * zoom * 3);
for (let y = 0; y < HEI * zoom; y++) for (let x = 0; x < WID * zoom; x++) {
  const index = previewCel.get(Math.floor(x / zoom), Math.floor(y / zoom));
  const rgbColor = index < 0 ? [19, 21, 29] : pal.entries[index].rgb;
  const o = (y * WID * zoom + x) * 3;
  rgb[o] = rgbColor[0]; rgb[o + 1] = rgbColor[1]; rgb[o + 2] = rgbColor[2];
}
fs.writeFileSync(path.join(OUT, "rowan-down.png"), encodeRGB(WID * zoom, HEI * zoom, rgb));
const auditReport = call("audit", { cel: previewCel.name, style: STYLE.id, asset_class: "character" });
fs.copyFileSync(sheet.image, path.join(OUT, "walk-contact.png"));
fs.copyFileSync(silhouette.image, path.join(OUT, "walk-silhouettes.png"));
fs.copyFileSync(gif.image, path.join(OUT, "walk-all-directions.gif"));
for (const entry of gif.per_facing) fs.copyFileSync(entry.image, path.join(OUT, `walk-${entry.direction}.gif`));
const summary = {
  character: "Rowan, the woodland pathfinder", dimensions: `${WID}x${HEI}`, baseline: BASELINE,
  authoredDirections: DIRS, authoredParts: skinParts.length, frames: DIRS.length * poseParts.length,
  cycle: timing, loopValidation: lv.clips, contactSheet: "preview/walk-contact.png", silhouetteSheet: "preview/walk-silhouettes.png",
  motionCoverage: motion.directions,
  animation: "preview/walk-all-directions.gif",
  perFacing: gif.per_facing.map(entry => ({ direction: entry.direction, image: `preview/walk-${entry.direction}.gif` })),
  portrait: "preview/rowan-down.png",
  audit: { errors: auditReport.errors, warns: auditReport.warns, grade: auditReport.grade, craft: auditReport.craft, findings: auditReport.findings },
  auditAllFrames: { frames: allAudits.length, errors: allAudits.reduce((n, a) => n + a.errors, 0), warns: allAudits.reduce((n, a) => n + a.warns, 0) },
  exportGate: gate,
};
fs.writeFileSync(path.join(OUT, "showcase.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
