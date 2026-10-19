// The Lantern Keeper — rig, skin, poses. Benchmark subject for the 8-direction test.
// Declared personality: weary, diligent, unhurried. Hunched under a heavy oilskin coat.
//
// Revision 4 — whole-figure authoring, measured against the craft layer (src/craft.js).
// Design intent, stated before any pixel exists:
//   primary_read : a hooded figure carrying a light. Readable from the silhouette alone.
//   exaggerated  : the lantern — largest warm mass, and the only light in the scene.
//   simplified   : hands, lower coat, boots. Two features carry the read, not eight.
//   focal accent : the lantern flame, low-right, opposite the key light.
//   shape family : rounded tops, tapered sides, flat weighted bottoms; every end is blunt.
//   light        : key from the upper-left, plus the lantern as a declared SECOND source on
//                  the coat's lower-right. Two sources in one asset is what makes a night
//                  sprite feel inhabited rather than merely lit.
"use strict";

const { Cel } = require("../src/core/cel.js");
const { Palette } = require("../src/core/palette.js");
const { Skin, Pose, DIRECTIONS, MIRROR_OF, registerPalette } = require("../src/core/rig.js");
const P1 = require("./keeper-parts-1.js").PARTS;
const P2 = require("./keeper-parts-2.js").PARTS;
const P3 = require("./keeper-parts-3.js").PARTS;
const PARTS = { ...P1, ...P2, ...P3 };

const STYLE = {
  projection: "three-quarter", art_scale: 32, palette_size: 24, temperature: "warm-cool-hue-shift",
  edge_policy: "selective-dark", shading: "ramp-lit", detail: "moderate", motion: "4-frame", mood: "melancholy",
};

const LIGHT = [-0.7, -0.7];                 // key
const LIGHTS = [[-0.7, -0.7], [0.5, -0.4]]; // key + lantern

// Hand-mixed ramps: every step is a decision, not a filter output. Shadows drift cool and
// desaturate; lit areas drift warm and pale. Validated by Palette.auditRamps().
// The spec is data, not code: it is what gets written to art/palettes/keeper.json so the palette
// is reviewable and diffable as text rather than something a script rebuilds on every run.
const PALETTE_SPEC = {
  ramps: {
    coat:  { role: "material", colors: ["#23213a", "#333350", "#474d6a", "#6b7b99", "#94a8c0"] },
    skin:  { role: "material", colors: ["#7d5636", "#a6764b", "#d8ae82"] },
    hair:  { role: "material", colors: ["#1d1712", "#3a2e24"] },
    boot:  { role: "material", colors: ["#332d24", "#4e4436", "#6f6049"] },
    // Brass is self-lit: the flame is inside the lantern, so the scene's key light has no claim on
    // which side of the frame is bright. Opting out of re-lighting keeps the flame's own modelling
    // intact when a facing is mirrored.
    brass: { role: "material", relight: false, colors: ["#1a1309", "#84601a", "#dcb04a"] },
    glow:  { role: "light",    colors: ["#f2c14e", "#fff0b8"] },
    scarf: { role: "material", colors: ["#6e6b60", "#9c9a90", "#b9b5a6"] },
  },
  single: {
    inner:   { rgb: "#08070d", role: "detail" },  // hood interior, eyes, deepest crease: the darkest thing in the sprite
    outline: { rgb: "#14161f", role: "outline" },
    contact: { rgb: "#24222e", role: "shadow" },  // ground contact, not part of the figure
  },
};

const PALETTE = registerPalette(Palette.fromSpec("keeper", PALETTE_SPEC));

const LEGEND = {
  d: "coat.0", D: "coat.1", c: "coat.2", C: "coat.3", L: "coat.4",
  K: "skin.0", s: "skin.1", S: "skin.2",
  h: "hair.0", H: "hair.1",
  b: "boot.0", B: "boot.1", U: "boot.2",
  j: "brass.0", y: "brass.1", Y: "brass.2",
  g: "glow.0", G: "glow.1",
  r: "scarf.0", R: "scarf.1", W: "scarf.2",
  N: "inner", O: "outline", t: "contact",
};

const CANVAS = [26, 34];
const BASELINE = 31;   // bottom row of the boots, in every direction and every frame

function parsePart(key, block) {
  const rows = block.split("\n").map(r => r.replace(/\r$/, "")).filter(r => r.length > 0);
  const problems = [];
  const w = Math.max(...rows.map(r => r.length));
  rows.forEach((r, i) => { if (r.length !== w) problems.push(`row ${i} is ${r.length} wide, part is ${w} wide`); });
  for (const r of rows) for (const ch of r) if (ch !== "." && !LEGEND[ch]) problems.push(`legend char '${ch}' is undefined`);
  const cel = new Cel(w, rows.length, PALETTE.id, key);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] || ".";
      if (ch === ".") continue;
      const idx = PALETTE.index(LEGEND[ch]);
      if (idx < 0) problems.push(`palette entry '${LEGEND[ch]}' missing`);
      else cel.set(x, y, idx);
    }
  });
  return { cel, w, h: rows.length, problems };
}

// ---- rig ----------------------------------------------------------------------
// Anchors are per-direction joint positions in CANVAS coordinates. This is what makes
// "the foot stays on the ground" a property of the rig instead of a hope.
const RIG = {
  canvas: CANVAS,
  baseline: BASELINE,
  anchors: {
    down:  { origin: [1, 4], shoulderNear: [14, 15], shoulderFar: [6, 14], handNear: [15, 19], legNear: [9, 28], legFar: [3, 28] },
    right: { origin: [3, 4], shoulderNear: [10, 15], shoulderFar: [5, 14], handNear: [11, 19], legNear: [10, 28], legFar: [4, 28] },
    up:    { origin: [1, 4], shoulderNear: [14, 15], shoulderFar: [6, 14], handNear: [15, 19], legNear: [9, 28], legFar: [3, 28] },
    // Diagonals are authored from two approved cardinals: the joints interpolate between the
    // front and the profile rather than being derived from a nudge.
    "down-right": { origin: [2, 4], shoulderNear: [13, 15], shoulderFar: [5, 14], handNear: [14, 19], legNear: [8, 28], legFar: [2, 28] },
    "up-right":   { origin: [3, 4], shoulderNear: [13, 15], shoulderFar: [5, 14], handNear: [14, 19], legNear: [9, 28], legFar: [3, 28] },
  },
  zOrder: {
    default:      ["legFar", "legNear", "body", "armFar", "armNear", "lantern"],
    down:         ["legFar", "legNear", "body", "armNear", "lantern"],
    up:           ["legFar", "legNear", "body", "armNear", "lantern"],
    right:        ["legFar", "legNear", "body", "armFar", "armNear", "lantern"],
    "down-right": ["legFar", "legNear", "body", "armNear", "lantern"],
    "up-right":   ["legFar", "legNear", "body", "armNear", "lantern"],
  },
  // Where each part's top-left sits relative to its joint.
  partJoints: {
    body:    { joint: "origin",       offset: [0, 0] },
    legNear: { joint: "legNear",      offset: [0, 0] },
    legFar:  { joint: "legFar",       offset: [0, 0] },
    armNear: { joint: "shoulderNear", offset: [0, 0] },
    armFar:  { joint: "shoulderFar",  offset: [0, 0] },
    lantern: { joint: "handNear",     offset: [0, 0] },
  },
};

// ---- poses --------------------------------------------------------------------
// A pose is joint intent, authored once and applied per facing. dx/dy are part offsets
// from the rig joint. The arm counter-swing is explicit: a walk without it reads as a
// sliding mannequin (measured in Phase 0).
//
// Height rhythm is authored, not sinusoidal: contact is the lowest body position, passing
// is the highest, and the boots never leave the baseline except the one that is swinging.
const WALK = {
  contact: new Pose("contact", {
    note: "heel strike; limbs at maximum separation; body at its lowest",
    parts: { legNear: { dx: 3 }, legFar: { dx: -3 }, armNear: { dx: -2 }, armFar: { dx: 2 }, lantern: { dx: -2 }, body: { dy: 1 } },
    dirMods: { up: { armNear: { dx: 2 }, armFar: { dx: -2 }, lantern: { dx: -2 } } },
  }),
  down: new Pose("down", {
    note: "weight rolls onto the planted foot; swinging foot lifts off the ground",
    parts: { legNear: { dx: 1 }, legFar: { dx: 1, dy: -2 }, armNear: { dx: -1 }, armFar: { dx: 1 }, lantern: { dx: -1 }, body: { dy: 1 } },
    dirMods: { up: { armNear: { dx: 1 }, armFar: { dx: -1 }, lantern: { dx: -1 } } },
  }),
  passing: new Pose("passing", {
    note: "body passes over the planted leg; highest point of the cycle",
    parts: { legNear: { dx: -1 }, legFar: { dx: 2 }, armNear: { dx: 1 }, armFar: { dx: -1 }, lantern: { dx: 1, dy: -1 }, body: { dy: -1 } },
    dirMods: { up: { armNear: { dx: -1 }, armFar: { dx: 1 }, lantern: { dx: 1, dy: -1 } } },
  }),
  up: new Pose("up", {
    note: "toe push; heel raised; arms near crossing",
    parts: { legNear: { dy: -1 }, legFar: { dx: 2 }, armNear: { dx: 1 }, armFar: { dx: -1 }, lantern: { dx: 1 }, body: { dy: 0 } },
    dirMods: { up: { armNear: { dx: -1 }, armFar: { dx: 1 }, lantern: { dx: 1 } } },
  }),
};

// Idle is a breathing cycle: neutral, inhale, hunch, settle-with-sway. Four distinct frames;
// a held frame pretending to be animation is exactly what this engine exists to refuse.
const IDLE = {
  "idle-1": new Pose("idle-1", { note: "neutral stance", parts: {} }),
  "idle-2": new Pose("idle-2", { note: "breath in; shoulders rise 1px", parts: { body: { dy: -1 }, armNear: { dy: -1 }, armFar: { dy: -1 }, lantern: { dy: -1 } } }),
  "idle-3": new Pose("idle-3", { note: "breath out; shoulders drop 1px", parts: { body: { dy: 1 }, armNear: { dy: 1 }, armFar: { dy: 1 }, lantern: { dy: 1 } } }),
  "idle-4": new Pose("idle-4", { note: "settle; lantern swings once", parts: { armNear: { dx: 1 }, armFar: { dx: -1 }, lantern: { dx: 1, dy: 1 } } }),
};

// ---- build --------------------------------------------------------------------
const MIRROR_SOURCE = { left: "right", "down-left": "down-right", "up-left": "up-right" };

// Mirrored facings get mirrored anchors automatically. Only x flips: a mirror must never be
// allowed to move the foot baseline or the hip.
function deriveMirroredRig() {
  const W = CANVAS[0];
  for (const [target, source] of Object.entries(MIRROR_SOURCE)) {
    RIG.anchors[target] = {};
    for (const [joint, [x, y]] of Object.entries(RIG.anchors[source])) RIG.anchors[target][joint] = [W - 1 - x, y];
    RIG.zOrder[target] = [...RIG.zOrder[source]];
  }
}

function buildSkin() {
  deriveMirroredRig();
  const skin = new Skin("keeper", PALETTE.id);
  const problems = [];
  for (const [key, block] of Object.entries(PARTS)) {
    const [direction, name] = key.split("/");
    const parsed = parsePart(key, block);
    problems.push(...parsed.problems.map(p => `${key}: ${p}`));
    const j = RIG.partJoints[name];
    if (!j) throw new Error(`part '${name}' has no joint mapping`);
    skin.add(direction, {
      name, cel: parsed.cel, anchorJoint: j.joint, anchorOffset: [...j.offset],
      anchorX: 0, anchorY: 0,
      leanFactor: name === "lantern" ? 1.5 : name === "body" ? 0 : 0.5,
    });
  }
  for (const [target, src] of Object.entries(MIRROR_SOURCE)) skin.deriveMirror(target, src);
  return { skin, problems };
}

module.exports = { STYLE, PALETTE_SPEC, LIGHT, LIGHTS, PALETTE, LEGEND, RIG, WALK, IDLE, PARTS, buildSkin, parsePart, CANVAS, BASELINE };
