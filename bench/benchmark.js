// BENCHMARK: one character, 8 directions, an animation per direction.
// This is the acceptance test the plan was built to pass. Everything it reports is measured.
"use strict";

const fs = require("fs");
const path = require("path");
const { compose, loopValidate, DIRECTIONS, WALK_POSES } = require("../src/core/rig.js");
const { audit } = require("../src/audit.js");
const { assertStyle, validateCoordinate } = require("../src/core/style.js");
const { renderCel, multiSheet, gridText } = require("../src/render.js");
const { buildSheet, buildManifest, writeExport, previewGif } = require("../src/export.js");
const { STYLE, PALETTE, RIG, WALK, IDLE, buildSkin, CANVAS } = require("../art/keeper.js");
const { decodePNG } = require("../src/codec/png.js");

const OUT = path.join(__dirname, "..", "out");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "cels"), { recursive: true });

const report = [];
const say = (s) => report.push(s);

// ---- 0. the coordinate must be legal before anything is drawn ------------------
const coord = validateCoordinate(STYLE);
say(`COORDINATE: ${coord.ok ? "accepted" : "REFUSED"}`);
coord.errors.forEach(e => say(`  error ${e.rule}: ${e.message}`));
coord.warnings.forEach(w => say(`  warn  ${w.rule}: ${w.message}`));

// ---- 1. skin --------------------------------------------------------------------
const { skin, problems } = buildSkin();
say(`\nSKIN: ${skin.authoredDirections().length} authored facings [${skin.authoredDirections().join(", ")}]`);
say(`      ${skin.derivedDirections().length} mirrored facings [${skin.derivedDirections().join(", ")}]`);
say(`      ${skin.parts.size} part cels, ${PALETTE.size} palette entries (coordinate cap ${STYLE.palette_size})`);
if (problems.length) { say(`  PART PROBLEMS (${problems.length}):`); problems.slice(0, 20).forEach(p => say(`    ${p}`)); }

// ---- 2. clips -------------------------------------------------------------------
const CLIPS = {
  walk: { poses: Object.values(WALK), fps: 8 },
  idle: { poses: Object.values(IDLE), fps: 6 },
};

const all = {};          // direction -> clip -> frames[]
const allFrames = [];
const auditFindings = [];
const styleViolations = [];

for (const dir of DIRECTIONS) {
  all[dir] = {};
  for (const [clipName, clip] of Object.entries(CLIPS)) {
    const frames = [];
    let previousBbox = null;
    clip.poses.forEach((pose, i) => {
      const cel = compose(skin, RIG, pose, dir, {
        name: `${clipName}.f${i}.${dir}`, label: `${clipName} ${i}`,
      });
      cel.meta.clip = clipName;
      cel.meta.duration = Math.round(1000 / clip.fps);
      const collisions = cel.meta.collisions || [];
      const a = audit(cel, { palette: PALETTE, style: STYLE, previousBbox });
      if (!a.ok || a.findings.length) auditFindings.push({ dir, clip: clipName, frame: i, pose: pose.name, findings: a.findings });
      const s = assertStyle(cel, STYLE, PALETTE, { assetClass: "character" });
      if (!s.ok) styleViolations.push({ dir, clip: clipName, frame: i, violations: s.violations });
      frames.push({ cel, poseName: pose.name, pose, collisions });
      allFrames.push(cel);
      previousBbox = cel.bbox();
      fs.writeFileSync(path.join(OUT, "cels", `${clipName}.f${i}.${dir}.grid`), cel.toGrid());
    });
    all[dir][clipName] = frames;
  }
}

say(`\nCELS COMPOSED: ${allFrames.length} (${DIRECTIONS.length} directions x ${Object.keys(CLIPS).length} clips)`);
say(`  written as text grids to out/cels/`);

// ---- 3. audit summary -----------------------------------------------------------
const byRule = new Map();
for (const f of auditFindings) for (const x of f.findings) {
  const k = `${x.rule}/${x.severity}`;
  byRule.set(k, (byRule.get(k) || 0) + (x.count || 1));
}
say(`\nAUDIT: ${allFrames.length - auditFindings.length}/${allFrames.length} cels clean`);
[...byRule.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => say(`  ${k} x${n}`));

const byStyleRule = new Map();
for (const v of styleViolations) for (const x of v.violations) byStyleRule.set(x.rule, (byStyleRule.get(x.rule) || 0) + 1);
say(`\nSTYLE ASSERT: ${allFrames.length - styleViolations.length}/${allFrames.length} cels conform`);
[...byStyleRule.entries()].forEach(([k, n]) => say(`  ${k} x${n}`));
if (styleViolations.length) {
  const first = styleViolations[0];
  say(`  first: ${first.dir}/${first.clip}#${first.frame}: ${first.violations.map(v => v.message).join(" | ")}`);
}

// ---- 4. loop validation ---------------------------------------------------------
say(`\nLOOP VALIDATE (${DIRECTIONS.length * Object.keys(CLIPS).length} clips):`);
let loopFails = 0;
for (const dir of DIRECTIONS) {
  for (const clipName of Object.keys(CLIPS)) {
    const frames = all[dir][clipName];
    const r = loopValidate(frames, {
      poses: clipName === "walk" ? WALK_POSES : frames.map(f => f.poseName),
      requireCounterSwing: clipName === "walk",
    });
    if (!r.ok) { loopFails++; say(`  FAIL ${dir}/${clipName}: ${r.problems.join(" | ")}`); }
    else say(`  ok   ${dir}/${clipName}  footSpread=${r.info.footSpread} anchorSpread=${r.info.anchorSpread} areaRatio=${r.info.areaRatio} collisions=${r.info.collisions} loopDelta=${r.info.loopDelta}`);
  }
}
say(`  ${loopFails} clip(s) failed the gate`);

// ---- 5. renders -----------------------------------------------------------------
const walkRows = DIRECTIONS.map(d => ({ label: d, cels: all[d].walk.map(f => f.cel) }));
const idleRows = DIRECTIONS.map(d => ({ label: d, cels: all[d].idle.map(f => f.cel) }));

const sheetColor = multiSheet(walkRows, PALETTE, { zoom: 5, labelW: 11, stamp: "WALK 4 poses x 8 directions - shared foot baseline" });
fs.writeFileSync(path.join(OUT, "bench_walk8.png"), sheetColor.buffer);

const sheetSil = multiSheet(walkRows, PALETTE, { zoom: 5, labelW: 11, mode: "silhouette", stamp: "WALK SILHOUETTES - shape only, no shading" });
fs.writeFileSync(path.join(OUT, "bench_walk8_silhouette.png"), sheetSil.buffer);

const sheetVal = multiSheet(walkRows, PALETTE, { zoom: 5, labelW: 11, mode: "value_map", stamp: "WALK VALUE MAP - form independent of hue" });
fs.writeFileSync(path.join(OUT, "bench_walk8_value.png"), sheetVal.buffer);

const sheetIdle = multiSheet(idleRows, PALETTE, { zoom: 5, labelW: 11, stamp: "IDLE 4 poses x 8 directions" });
fs.writeFileSync(path.join(OUT, "bench_idle8.png"), sheetIdle.buffer);

// one big cel at inspection zoom, with labels and legend
const hero = all["down"].walk[0].cel;
const heroRender = renderCel(hero, PALETTE, { zoom: 14 });
fs.writeFileSync(path.join(OUT, "bench_hero_down_contact.png"), heroRender.buffer);
fs.writeFileSync(path.join(OUT, "bench_hero_down.grid.txt"), gridText(hero, { labelEvery: 2 }));

// playback preview: every direction's walk in one animated GIF, palette-true
const gifFrames = [];
for (const dir of DIRECTIONS) for (const f of all[dir].walk) gifFrames.push(f.cel);
const gif = previewGif(gifFrames, PALETTE, { delay: 14 });
fs.writeFileSync(path.join(OUT, "bench_walk8.gif"), gif);

// ---- 6. export ------------------------------------------------------------------
const sheet = buildSheet(allFrames, { cols: 8, palette: PALETTE, duration: 125 });
const manifest = buildManifest(sheet, STYLE, PALETTE, { imageName: "sheet.png", provenance: { origin: "authored-in-engine", thirdPartyAssets: false, authoredParts: 30, mirroredParts: 18 } });
writeExport(path.join(OUT, "export"), sheet, manifest);
say(`\nEXPORT: sheet ${sheet.width}x${sheet.height} indexed PNG ${sheet.png.length} bytes, ${sheet.celCount} frames, palette ${sheet.palette.length} entries`);
const back = decodePNG(sheet.png);
say(`  round-trip check: decoded ${back.w}x${back.h} colourType ${back.colorType} palette ${back.palette.length}`);

// ---- 7. metrics -----------------------------------------------------------------
const areas = allFrames.map(c => (c.bbox() || { area: 0 }).area);
const colours = new Set(allFrames.flatMap(c => [...c.counts().keys()])).size;
const ns = allFrames.map(c => assertStyle(c, STYLE, PALETTE, { assetClass: "character" }).metrics.negativeSpace.enclosed);
say(`\nMETRICS: silhouette area min ${Math.min(...areas)} max ${Math.max(...areas)} mean ${Math.round(areas.reduce((a,b)=>a+b,0)/areas.length)}`);
say(`  distinct palette entries used across all 64 cels: ${colours}`);
say(`  enclosed negative space per cel: min ${Math.min(...ns)} max ${Math.max(...ns)}`);
say(`  authored part cels: ${Object.keys(require("../art/keeper.js").PARTS).length}; composed cels: ${allFrames.length}`);
say(`  cost: ${allFrames.length} cels from ${Object.keys(require("../art/keeper.js").PARTS).length} authored parts`);

fs.writeFileSync(path.join(OUT, "bench-report.txt"), report.join("\n"));
console.log(report.join("\n"));
