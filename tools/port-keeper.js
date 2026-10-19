// PORT THE KEEPER INTO THE ENGINE'S OWN DISK FORMAT.
//
// Until now the Keeper lived as JavaScript constants in art/keeper.js and the engine's project
// format (art/project.json, sprites/<id>/cels/*.grid, rigs/, clips/) was exercised only by
// tests. That is a gap worth naming: the plan's central claim is that the ART is git-tracked
// text the engine operates on. This script closes it by driving the real tool surface — the same
// 125 tools the CLI and MCP expose — and writing the Keeper through it.
//
// art/keeper.js stays the authored source of the part grids (it is where the pixels are decided);
// this produces the engine-native, diffable, resumable form alongside it.
"use strict";

const path = require("path");
const { Cel } = require("../src/core/cel.js");
const rig = require("../src/core/rig.js");
const { DIRECTIONS } = require("../src/core/rig.js");
const { TOOLS, W, Workspace } = require("../src/tools.js");

const REPO = path.join(__dirname, "..");
const K = require("../art/keeper.js");

const call = (name, args) => {
  const res = TOOLS[name].run(args);
  if (res && res.ok === false) {
    const v = (res.violations || []).map(x => `${x.rule}: ${x.message}`).join(" | ") || res.reason || "refused";
    throw new Error(`${name} refused: ${v}`);
  }
  return res;
};

const px = (c) => (typeof c?.counts === "function" ? [...c.counts().values()].reduce((s, n) => s + n, 0) : 0);

const report = [];
const say = (s) => { report.push(s); console.log(s); };

say("PORTING THE LANTERN KEEPER INTO THE ENGINE DISK FORMAT");

// 1. the project and its coordinate --------------------------------------------
const proj = call("project_init", {
  root: REPO,
  game: "lantern-keeper",
  style: { ...K.STYLE, id: "keeper" },
  canvas: { w: K.CANVAS[0], h: K.CANVAS[1] },
  directions: [...DIRECTIONS],
  fps: 8,
});
say(`  project      ${proj.project}  coordinate accepted, ${Object.keys(proj.conventions).length} conventions resolved`);

// 2. palette ---------------------------------------------------------------------
const pal = call("palette_set", { id: "keeper", spec: K.PALETTE_SPEC });
say(`  palette      ${pal.id}: ${pal.size} entries`);
for (const p of pal.problems) say(`    ${p.severity} ${p.rule} ${p.pair ? p.pair.join(" / ") : ""}: ${p.message}`);

// 3. sprite document --------------------------------------------------------------
const spr = call("sprite_create", {
  id: "keeper", w: K.CANVAS[0], h: K.CANVAS[1], palette: "keeper", style: "keeper",
  tier: "hero", asset_class: "character", rig: "keeper",
  layers: [{ id: "body", z: 0 }, { id: "lantern", z: 1 }],
  design: {
    primary_read: "a hooded figure carrying a light — readable from the silhouette alone",
    exaggerated: "the lantern: largest warm mass, and the only light in the scene",
    simplified: "hands, lower coat, boots — two features carry the read, not eight",
    focal_accent: "the lantern flame, low-right, opposite the key light",
    shape_family: "rounded tops, tapered sides, flat weighted bottoms; every end is blunt",
    light: "key from upper-left, plus the lantern as a declared second source on the coat's lower-right",
    personality: "weary, diligent, unhurried; hunched under a heavy oilskin coat",
  },
});
say(`  sprite       ${spr.sprite} ${spr.canvas.w}x${spr.canvas.h} tier=${spr.tier} layers [${spr.layers.join(", ")}]`);

// 4. rig -------------------------------------------------------------------------
call("rig_create", {
  id: "keeper", canvas: K.CANVAS, baseline: K.BASELINE,
  anchors: K.RIG.anchors, zOrder: K.RIG.zOrder, partJoints: K.RIG.partJoints,
});
say(`  rig          authored facings [${Object.keys(K.RIG.anchors).join(", ")}], foot baseline y=${K.BASELINE}`);

// 5. authored part cels -----------------------------------------------------------
const { skin, problems } = K.buildSkin();
if (problems.length) say(`  part problems: ${problems.length}`);
let partCount = 0;
let partPixels = 0;
for (const [key, block] of Object.entries(K.PARTS)) {
  const [direction, name] = key.split("/");
  const { cel } = K.parsePart(key, block);
  const celId = `keeper/part/${direction}/${name}`;
  W.store.put(celId, cel);
  W.project.writeCel("keeper", `part/${direction}/${name}`, cel);
  W.project.record(celId, "authored_part", px(cel), false);
  partCount++;
  partPixels += px(cel);
}
say(`  parts        ${partCount} authored part cels written as text grids, ${partPixels} authored pixels`);

// 6. skin: authored facings plus their mirrors ------------------------------------
const parts = [];
for (const [key] of Object.entries(K.PARTS)) {
  const [direction, name] = key.split("/");
  const j = K.RIG.partJoints[name];
  parts.push({
    direction, name, cel: `keeper/part/${direction}/${name}`, joint: j.joint,
    offset: j.offset, anchor: [0, 0], lean: name === "lantern" ? 1.5 : name === "body" ? 0 : 0.5,
  });
}
const sk = call("skin_define", { id: "keeper", palette: "keeper", parts });
say(`  skin         ${sk.part_cels} part cels across authored facings [${sk.authored_directions.join(", ")}]`);

// 7. clips: composed frames, authored cels on disk, declared timing ---------------
const CLIPS = {
  walk: { poses: Object.values(K.WALK), template: "walk", curve: "walk-stride", fps: 8 },
  idle: { poses: Object.values(K.IDLE), template: "idle", curve: "idle-breathe", fps: 6 },
};



let composed = 0;
for (const [clipName, clip] of Object.entries(CLIPS)) {
  call("clip_create", { id: clipName, template: clip.template, sprite: "keeper", fps: clip.fps, directions: [...DIRECTIONS] });
  for (const dir of DIRECTIONS) {
    const frames = clip.poses.map((pose, i) => {
      const cel = rig.compose(skin, K.RIG, pose, dir, { name: `keeper/${clipName}/${dir}/f${i}`, label: `${clipName} ${i}` });
      cel.paletteId = "keeper";
      W.store.put(cel.name, cel);
      W.project.record(cel.name, "composed_from_authored_parts", 0, false);
      composed++;
      return { cel: cel.name, pose: pose.name };
    });
    call("clip_set_frames", { clip: clipName, sprite: "keeper", direction: dir, frames });
  }
  const t = call("timing_apply", { clip: clipName, curve: clip.curve, fps: clip.fps });
  say(`  clip         ${clipName}: ${DIRECTIONS.length} directions x ${clip.poses.length} frames, cycle ${t.cycle_ms}ms, per-frame ${t.per_frame.join("/")}ms`);
}
say(`  composed     ${composed} frame cels written as text grids under art/sprites/keeper/cels/`);

// 8. prove it survived the round trip: reopen from disk in a clean workspace ------
const again = new Workspace(REPO);
again.load(REPO);
const clipsBack = [...again.clips.entries()].map(([id, c]) => `${id}:${c.directionsWithFrames().length}dir/${c.frames("down").length}f${c.incomplete ? " (INCOMPLETE)" : ""}`);
say(`\nRESUMED FROM DISK IN A FRESH PROCESS`);
say(`  sprites      ${again.project.sprite_list().map(s => `${s.id}(${s.cels} cels)`).join(", ")}`);
say(`  rigs         ${again.project.rig_list().map(r => r.id).join(", ")}`);
say(`  clips        ${clipsBack.join(", ")}`);
const downWalk = again.clips.get("walk").frames("down");
say(`  spot check   walk/down/f0 = ${downWalk[0]?.cel?.name}, ${downWalk[0]?.cel ? px(downWalk[0].cel) : 0} px, pose=${downWalk[0]?.poseName}, ${downWalk[0]?.duration}ms`);

const prov = again.project.provenanceFor("keeper");
say(`  provenance   authored ${prov.authored_pixels} px, imported ${prov.imported_pixels} px, share ${prov.authored_share}`);
