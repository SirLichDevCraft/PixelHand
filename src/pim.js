// Pim's part library: the authored pieces the rig assembles into 4 facings x 4 walk frames.
//
// Stage 1 found a defect I authored: at the front, the satchel and the right arm were one mass,
// so he had no visible right arm. Fixed by moving the bag BELOW the hand and giving the arm its
// own column of air. Back view adopts variant B (bag on the back); variant A stays in the record
// as a rejected option, not deleted.
"use strict";

const { Cel, TRANSPARENT } = require("./core/cel.js");

// ---- colour ---------------------------------------------------------------------
// The parts above are SHAPE. Left monochrome they trip flat_mass, value_structure and
// no_focal_accent, and the export gate refuses them - which is the gate working, not the gate
// being annoying.
//
// Light is a property of the SCENE, not of the part. Shading each part inside its own bounding box
// looks fine until the rig moves it: an arm lit from its own left edge lands beside a torso that is
// dark on that side, and the seam is a 3-step ramp jump - ramp_jump, caused by the animation rather
// than by the drawing. So the step here is read off the CANVAS coordinate against one fixed
// reference box, and every part of one material samples the same field. A part that moves one pixel
// changes its shading by at most one step, because that is what moving one pixel under a fixed light
// does.
const RAMP_BASE = { coat: 0, bag: 4, boot: 8, skin: 11, hat: 14 };
const RAMP_STEPS = { coat: 4, bag: 4, boot: 3, skin: 3, hat: 3 };
const MATERIAL = { body: "coat", arm_l: "coat", arm_r: "coat", bag: "bag", leg_l: "boot", leg_r: "boot" };
// The body part carries three materials: the cap, the face, the coat.
const BODY_BANDS = [[0, 2, "hat"], [3, 6, "skin"], [7, 17, "coat"]];

// Shading is done per REGION, not per part and not per whole sprite. A cap is four pixels wide; a
// field read off the canvas diagonal gives it one value across all four, which is flat_mass - a mass
// filled rather than modelled. A region is modelled across its own extent, lit from the upper left,
// so a 4px cap still gets three steps and still agrees with the light vector.
function regionsOf(cel, materialAt) {
  const seen = new Int16Array(cel.w * cel.h).fill(-1);
  const out = [];
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    if (cel.get(x, y) === TRANSPARENT || seen[y * cel.w + x] >= 0) continue;
    const m = materialAt(x, y);
    const cells = [];
    const stack = [[x, y]];
    seen[y * cel.w + x] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!cel.inBounds(nx, ny) || seen[ny * cel.w + nx] >= 0) continue;
        if (cel.get(nx, ny) === TRANSPARENT || materialAt(nx, ny) !== m) continue;
        seen[ny * cel.w + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    out.push({ material: m, cells });
  }
  return out;
}
// The declared focal accent, placed rather than implied. docs/09: an accent you did not put there
// is not an accent.
const ACCENT = {
  "down/bag": [[2, 2, 17], [3, 2, 17]],
  "right/bag": [[1, 4, 17], [2, 4, 17]],
  "up/bag": [[5, 3, 17], [6, 3, 17]],
  // Two pixels of eye, and nothing else. The design says "no face beyond two pixels of eye".
  "down/body": [[4, 4, 18], [7, 4, 18], [10, 17, 17]],
  "right/body": [[6, 4, 18], [10, 17, 17]],
  "up/body": [[10, 17, 17]],
};
// The sole row is the darkest thing on the figure. That is what makes him stand ON something.
const SOLE = 20;

function colourPart(key, cel, at) {
  const name = key.split("/")[1];
  const dir = key.split("/")[0];
  const materialAt = (x, y) => name === "body"
    ? (BODY_BANDS.find(b => y >= b[0] && y <= b[1]) || [0, 0, "coat"])[2]
    : MATERIAL[name];
  for (const region of regionsOf(cel, materialAt)) {
    const steps = RAMP_STEPS[region.material];
    const ys = region.cells.map(c => c[1]);
    const y0 = Math.min(...ys), y1 = Math.max(...ys), hSpan = y1 - y0;
    // tx is measured across each row's own filled extent, not across the region's bounding box.
    // A leg is two columns wide for most of its height and four at the boot; a bbox-relative tx
    // leaves the narrow part stuck in the middle of the ramp, so the whole limb lands on one step.
    // That is flat_mass: 52 pixels of boot in two of three values, filled rather than modelled.
    const byRow = new Map();
    for (const [x, y] of region.cells) { if (!byRow.has(y)) byRow.set(y, []); byRow.get(y).push(x); }
    for (const [y, xs] of byRow) {
      const xlo = Math.min(...xs), xhi = Math.max(...xs);
      const ty = hSpan ? (y - y0) / hSpan : 0;
      for (const x of xs) {
        const tx = xhi > xlo ? (x - xlo) / (xhi - xlo) : 0.5;
        const v = 0.8 * (1 - tx) + 0.2 * (1 - ty);          // light from the upper left
        cel.set(x, y, RAMP_BASE[region.material] + Math.max(0, Math.min(steps - 1, Math.round(v * (steps - 1)))));
      }
    }
  }
  for (const [x, y, idx] of ACCENT[key] || []) if (cel.get(x, y) !== TRANSPARENT) cel.set(x, y, idx);
  if (name.startsWith("leg")) for (let x = 0; x < cel.w; x++) if (cel.get(x, cel.h - 1) !== TRANSPARENT) cel.set(x, cel.h - 1, SOLE);
  repairSingletons(cel);
  return cel;
}

// The audit's own prescribed fix, applied where the fault actually appears: after composition.
// Two parts of one material meeting at a seam can still put step 0 next to step 3, because each was
// modelled across its own extent. Bridging the seam on the composed frame - rather than pre-
// compensating every part for every pose it might ever be put into - is what "insert the intermediate
// ramp step" means when there is no room to insert a pixel.
function smoothRamps(cel, palette) {
  if (!palette) return { cel, bridges: 0 };
  let bridges = 0;
  for (let pass = 0; pass < 8; pass++) {
    let moved = 0;
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const a = cel.get(x, y); if (a < 0) continue;
      const ea = palette.entries[a]; if (!ea || !ea.ramp) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const b = cel.get(x + dx, y + dy); if (b < 0) continue;
        const eb = palette.entries[b]; if (!eb || !eb.ramp || eb.ramp !== ea.ramp) continue;
        const d = Math.abs(ea.step - eb.step);
        if (d < 3) continue;
        // Move whichever of the two has more same-material neighbours of its own step: that one is
        // the interior of a mass, and the other is the seam pixel that should not have been extreme.
        const sameCount = (px, py, step) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([ox, oy]) => cel.get(px + ox, py + oy)).filter(i => i >= 0 && palette.entries[i] && palette.entries[i].ramp === ea.ramp && palette.entries[i].step === step).length;
        const moveA = sameCount(x, y, ea.step) <= sameCount(x + dx, y + dy, eb.step);
        const [mx, my, from, to] = moveA ? [x, y, ea, eb] : [x + dx, y + dy, eb, ea];
        const stepTo = from.step + Math.sign(to.step - from.step);
        const list = palette.ramp(ea.ramp);
        const idx = list ? list[stepTo] : undefined;
        if (idx == null) continue;
        cel.set(mx, my, idx);
        bridges++; moved++;
      }
    }
    if (!moved) break;
  }
  return { cel, bridges };
}

// "A colour used exactly once reads as dirt, not detail." Rather than hope the ramp formula never
// produces one, the authoring pass fixes it: a singleton pixel joins the step its neighbours use.
// This runs on the part, before the rig composes anything, so the fault is removed where it was
// made instead of being reported after four facings have inherited it.
// The declared accent and the two pixels of eye are exempt: audit exempts accent / detail / light /
// outline roles from lone_pixel, and a face is allowed to be exactly two pixels.
const PROTECTED = new Set([17, 18, 19]);

function repairSingletons(cel) {
  for (let pass = 0; pass < 6; pass++) {
    const counts = new Map();
    cel.forEach((v, x, y) => { if (v !== TRANSPARENT) counts.set(v, (counts.get(v) || 0) + 1); });
    let fixed = 0;
    for (const [idx, n] of counts) {
      if (n !== 1 || PROTECTED.has(idx)) continue;
      let at = null;
      cel.forEach((v, x, y) => { if (v === idx && !at) at = { x, y }; });
      if (!at) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => cel.get(at.x + dx, at.y + dy))
        .filter(v => v !== TRANSPARENT && (counts.get(v) || 0) > 1);
      if (!near.length) continue;
      near.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));
      cel.set(at.x, at.y, near[0]);
      fixed++;
    }
    if (!fixed) break;
  }
  return cel;
}

const CANVAS = [16, 32];
const BASELINE = 31;                 // the boot sole row. It never moves.

const LAYOUT = {
  down:  { body: [2, 2, 12, 18], arm_l: [2, 11, 2, 8], arm_r: [12, 11, 2, 8], bag: [11, 19, 5, 7], leg_l: [3, 20, 4, 12], leg_r: [7, 20, 4, 12] },
  right: { body: [3, 2, 11, 18], arm_r: [7, 13, 2, 6], bag: [11, 11, 4, 8], leg_l: [5, 20, 4, 12], leg_r: [6, 20, 4, 12] },
  up:    { body: [2, 2, 12, 18], arm_l: [1, 11, 2, 8], arm_r: [13, 11, 2, 8], bag: [3, 10, 12, 11], leg_l: [3, 20, 4, 12], leg_r: [7, 20, 4, 12] },
};

const GRIDS = {
  // Front. Arms separated from the torso by a column of air each side, closed at the shoulder
  // line and at the belt. The bag hangs from the belt BELOW the hand, with its own air column.
  "down/body": [
    "...####.....", "..######....", "..######....", "..######....", "..######....",
    "...####.....", "....##......", "..######....", "############", "...######...",
    "...######...", "...######...", "...######...", "...######...", "...######...",
    "...######...", "...######...", "############",
  ],
  "down/arm_l": ["##", "##", "##", "##", "##", "##", "##", "##"],
  "down/arm_r": ["##", "##", "##", "##", "##", "##", "##", "##"],
  // The bag carries a strap. Without one, swinging the bag one pixel sideways or down left it
  // touching nothing: disconnected_mass refused 4 of 16 frames. A carried object that can leave the
  // person carrying it is an animation fault, not a drawing fault, and no still frame shows it.
  // The front-facing bag hangs from the belt with its whole top edge on the belt row. It used to
  // reach up through a one-column strap, and cross_material_aa refused it correctly: one column of
  // leather between two columns of cloth is how anti-aliasing looks, and it is how a strap looks when
  // the strap is too thin to be a strap.
  "down/bag": [".####", ".####", ".####", ".####", ".####", ".####", "#####"],
  // Legs run hip to sole. They were 6px tall and started at row 26 while the torso ended at row 19,
  // which produced a figure with six rows of nothing between it and its boots: detached limbs,
  // caught by looking at the composed frame and by no metric whatsoever.
  // The knee is a two-row bulge so the joint is visible; the boot is two columns wider than the leg
  // because the design says the boots are two sizes too big.
  "down/leg_l": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],
  "down/leg_r": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],

  // Right-facing. The bag hangs from the strap in FRONT of the body: a column of air between
  // torso and bag, closed above by the strap line and below by the bag's own base.
  "right/body": [
    "...####....", "..######...", "..######...", "..######...", "..#####....",
    "...####....", "...##......", "..#####....", ".#######...", ".########..",
    ".#########.", ".######....", ".######....", ".######....", ".######....",
    ".######....", ".##########", "..####.....",
  ],
  "right/arm_r": ["##", "##", "##", "##", "##", "##"],
  "right/bag": ["#...", "#...", "####", "####", "####", "####", "####", "####"],
  "right/leg_l": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],
  "right/leg_r": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],

  // Back, variant B. The bag is ON the back: one mass wider than the head and wider than the
  // legs, shoulder to hem. The arms sit outside it. From behind you know what he is carrying.
  "up/body": [
    "...####.....", "..######....", "..######....", "..######....", "..######....",
    "...####.....", "....##......", "..######....", "############", "..########..",
    "..########..", "..########..", "..########..", "..########..", "..########..",
    "..########..", "..########..", "############",
  ],
  "up/arm_l": ["##", "##", "##", "##", "##", "##", "##", "##"],
  "up/arm_r": ["##", "##", "##", "##", "##", "##", "##", "##"],
  "up/bag": [
    "############", "############", "############", "############", "############",
    "############", "############", "############", ".##########.", "..######....",
    "..######....",
  ],
  "up/leg_l": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],
  "up/leg_r": [".##.", ".##.", ".##.", ".###", ".###", ".##.", ".##.", ".##.", ".##.", ".##.", "####", "####"],
};

const JOINTS = {
  body:  { joint: "hip", offset: [0, 0] },
  arm_l: { joint: "shoulder_l", offset: [0, 0] },
  arm_r: { joint: "shoulder_r", offset: [0, 0] },
  bag:   { joint: "hip", offset: [0, 0] },
  leg_l: { joint: "hip", offset: [0, 0] },
  leg_r: { joint: "hip", offset: [0, 0] },
};

const RIG = {
  canvas: CANVAS,
  baseline: BASELINE,
  anchors: {
    down:  { hip: [7, 19], shoulder_l: [2, 10], shoulder_r: [12, 10], head: [7, 2] },
    right: { hip: [7, 19], shoulder_l: [4, 10], shoulder_r: [9, 10], head: [7, 2] },
    // 'left' is the mirror of 'right': the joints mirror too, or the limbs land on the wrong side.
    left:  { hip: [8, 19], shoulder_l: [11, 10], shoulder_r: [6, 10], head: [8, 2] },
    up:    { hip: [7, 19], shoulder_l: [1, 10], shoulder_r: [13, 10], head: [7, 2] },
  },
  partJoints: JOINTS,
  zOrder: {
    default: ["body", "leg_l", "leg_r", "arm_l", "arm_r", "bag"],
    up: ["leg_l", "leg_r", "body", "arm_l", "arm_r", "bag"],
  },
};

// Four poses, authored once, reused across every facing. A facing changes the stride, not the
// pose. In every frame at least one foot has dy 0 — that is what keeps the baseline honest.
const WALK = [
  {
    name: "contact", weight: 1.4, headBob: 0,
    note: "both feet down, the stride at its widest. The heavy frame.",
    parts: { leg_l: { dx: -1 }, leg_r: { dx: 1 }, arm_l: { dx: 1 }, arm_r: { dx: -1 }, bag: { dx: 1 } },
    // The stride is bounded by the hip, not by what looks like a big step. dx -2 / +2 on the side
    // facing moved each leg's whole top edge outside the four columns of hip the coat hem covers,
    // and both legs detached from the body - refused by disconnected_mass in 3 of 16 frames.
    // A leg stays attached by keeping its top row inside the hip columns in every frame.
    dirMods: {
      down: { arm_l: { dx: 0, dy: 1 }, arm_r: { dx: 0, dy: -1 }, bag: { dx: 0 } },
      up:   { arm_l: { dx: 0, dy: -1 }, arm_r: { dx: 0, dy: 1 }, bag: { dx: 0 } },
      right: { leg_l: { dx: -2 }, leg_r: { dx: 1 } },
      left:  { leg_l: { dx: 2 }, leg_r: { dx: -1 }, arm_l: { dx: -1 }, arm_r: { dx: 1 }, bag: { dx: -1 } },
    },
  },
  {
    name: "down", weight: 1.0, headBob: 1,
    note: "weight settles onto the front foot; the body drops one pixel.",
    parts: { leg_l: { dx: -1 }, leg_r: { dx: 0 }, arm_l: { dx: 1 }, arm_r: { dx: -1 }, bag: { dx: 1, dy: 1 } },
    dirMods: {
      right: { leg_l: { dx: -1 }, leg_r: { dx: 0 }, bag: { dx: 1 } },
      left: { leg_l: { dx: 1 }, leg_r: { dx: 0 }, arm_l: { dx: 0 }, arm_r: { dx: 0 }, bag: { dx: -1, dy: 1 } },
      down: { arm_l: { dx: 0, dy: 0 }, arm_r: { dx: 0, dy: 0 }, bag: { dx: 0, dy: 1 } },
      up: { arm_l: { dx: 0, dy: 0 }, arm_r: { dx: 0, dy: 0 }, bag: { dx: 0, dy: 1 } },
    },
  },
  {
    name: "passing", weight: 0.8, headBob: -1,
    note: "one leg vertical and bearing weight, the other swinging under. The body rises.",
    parts: { leg_l: { dx: 0 }, leg_r: { dx: 0, dy: -1 }, arm_l: { dx: 0 }, arm_r: { dx: 0 }, bag: { dx: 0, dy: -1 } },
    dirMods: { right: { leg_l: { dx: 0 }, leg_r: { dx: 1, dy: -1 }, bag: { dx: 0 } }, left: { leg_l: { dx: 0 }, leg_r: { dx: -1, dy: -1 }, arm_l: { dx: 1 }, arm_r: { dx: -1 }, bag: { dx: 0 } }, up: { bag: { dx: 0, dy: 0 } } },
  },
  {
    name: "up", weight: 1.0, headBob: -1,
    note: "push off the back foot; the highest frame of the cycle.",
    parts: { leg_l: { dx: 1 }, leg_r: { dx: -1 }, arm_l: { dx: -1 }, arm_r: { dx: 1 }, bag: { dx: -1 } },
    dirMods: {
      right: { leg_l: { dx: 1 }, leg_r: { dx: -2 }, bag: { dx: 1 } },
      left: { leg_l: { dx: -1 }, leg_r: { dx: 2 }, arm_l: { dx: -1 }, arm_r: { dx: 1 }, bag: { dx: -1 } },
      down: { arm_l: { dx: 0, dy: -1 }, arm_r: { dx: 0, dy: 1 }, bag: { dx: 0 } },
      up: { arm_l: { dx: 0, dy: 1 }, arm_r: { dx: 0, dy: -1 }, bag: { dx: 0 } },
    },
  },
];

const IDLE = [
  { name: "breathe-1", weight: 1, headBob: 0, parts: {} },
  { name: "breathe-2", weight: 1, headBob: -1, parts: { bag: { dy: -1 } } },
];

function parsePart(key, rows) {
  const dir = key.split("/")[0];
  const [x, y, w, h] = LAYOUT[dir][key.split("/")[1]];
  if (rows[0].length !== w || rows.length !== h) {
    const e = new Error(`part '${key}' grid is ${rows[0].length}x${rows.length}, layout says ${w}x${h}`);
    e.rule = "part_layout_mismatch"; throw e;
  }
  const cel = new Cel(w, h, "courier", key);
  rows.forEach((r, ry) => { for (let rx = 0; rx < w; rx++) if (r[rx] === "#") cel.set(rx, ry, 0); });
  colourPart(key, cel, [x, y]);
  return { cel, offset: [x, y] };
}

function buildSkin(rigMod) {
  const rigLib = require("./core/rig.js");
  const { Skin } = rigLib;
  const skin = new Skin("pim", "courier");
  const problems = [];
  for (const [key, rows] of Object.entries(GRIDS)) {
    const [direction, name] = key.split("/");
    const { cel, offset } = parsePart(key, rows);
    const j = RIG.partJoints[name];
    skin.add(direction, {
      name, cel, anchorX: 0, anchorY: 0, anchorJoint: j.joint,
      anchorOffset: offset, leanFactor: name.startsWith("arm") ? 0.6 : name === "bag" ? 1.2 : 0,
      bobFactor: name === "body" ? 1 : 0,
    });
  }
  skin.deriveMirror("left", "right");
  // A skin with only some facings authored is not a finished skin. The engine derives the mirror
  // facing itself rather than waiting for someone to remember: docs/03 makes mirroring a
  // mechanical consequence, and a facing that silently does not exist is worse than a wrong one.
  for (const [src, mirror] of Object.entries(rigLib.MIRROR_OF)) {
    if (skin.authoredDirections().includes(src) && !skin.authoredDirections().includes(mirror)) skin.deriveMirror(mirror, src);
  }
  return { skin, problems };
}

module.exports = { CANVAS, BASELINE, LAYOUT, GRIDS, JOINTS, RIG, WALK, IDLE, parsePart, colourPart, regionsOf, smoothRamps, buildSkin };
