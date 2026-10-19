// T3 — the authored art data: rig geometry, per-facing part grids, walk/attack poses, timing.
//
// Everything organic here is a hand-placed pixel map. Letters are materials, not shapes:
//   w wool (hood + coat)      h hide (breeches)     t boot (boots)
//   s skin (face, hands)      i iron (the blade)    d haft (grip)
//   + brass (the declared focal accent: belt plate, crossguard, pommel)
//   . air
// Fixed-colour details (two pixels of eye per facing) are placed as explicit marks after the shared
// lighting model runs, because authorAsset models regions along ramps and an eye is not a ramp.
//
// ONE character, eight facings, one baseline (row 29), one hip line (row 22), one head height
// (rows 5..22 body). A facing changes what the camera sees; it does not change the figure's size.
//
// Which side carries the weapon follows from the projection, not from taste: the camera sits at +y,
// so for facing f the near side of the body is character-right = (-fy, fx):
//   down -> weapon viewer-left        up        -> weapon viewer-right
//   right -> weapon on the NEAR side  left      -> weapon on the FAR side (drawn before the torso)
//   down-right -> near                up-right  -> near
//   down-left  -> far                 up-left   -> far
// The weapon is fused into the weapon-side arm part: hand, grip, crossguard and blade are one drawn
// mass, so the sword cannot detach from the hand in any pose, in any facing (docs/03 §1 step 4).
"use strict";

const CANVAS = [32, 32];
const BASELINE = 29;          // sole row: shared by every facing and every frame
const HIPLINE = 22;           // body grid ends here, legs start at 23 — one hip line for all 8 facings

// ---- rig joints (art pixels), per facing -----------------------------------------
const JOINTS = {
  down:       { hip: [15, HIPLINE], head: [15, 7], shoulder_r: [11, 11], shoulder_l: [21, 11] },
  "down-right": { hip: [14, HIPLINE], head: [14, 7], shoulder_r: [10, 11], shoulder_l: [19, 11] },
  right:      { hip: [14, HIPLINE], head: [13, 7], shoulder_r: [16, 11], shoulder_l: [7, 11] },
  "up-right": { hip: [15, HIPLINE], head: [15, 7], shoulder_r: [19, 11], shoulder_l: [8, 11] },
  up:         { hip: [15, HIPLINE], head: [15, 7], shoulder_r: [20, 11], shoulder_l: [11, 11] },
  "up-left":  { hip: [16, HIPLINE], head: [16, 7], shoulder_r: [21, 11], shoulder_l: [12, 11] },
  left:       { hip: [17, HIPLINE], head: [18, 7], shoulder_r: [23, 11], shoulder_l: [15, 11] },
  "down-left": { hip: [17, HIPLINE], head: [17, 7], shoulder_r: [20, 11], shoulder_l: [10, 11] },
};

// absolute placement of each part in its neutral pose: [x, y, w, h]. Offsets are derived from JOINTS.
const LAYOUT = {
  down:       { body: [11, 5, 10, 18], arm_r: [6, 11, 6, 16], arm_l: [21, 11, 3, 9], leg_r: [11, 23, 4, 7], leg_l: [17, 23, 4, 7] },
  "down-right": { body: [10, 5, 9, 18], arm_r: [5, 11, 6, 16], arm_l: [19, 11, 3, 9], leg_r: [10, 23, 4, 7], leg_l: [15, 23, 4, 7] },
  right:      { body: [9, 5, 8, 18], arm_r: [15, 11, 7, 16], arm_l: [5, 11, 4, 9], leg_r: [12, 23, 4, 7], leg_l: [9, 23, 4, 7] },
  "up-right": { body: [10, 5, 9, 18], arm_r: [18, 11, 6, 16], arm_l: [7, 11, 3, 9], leg_r: [15, 23, 4, 7], leg_l: [10, 23, 4, 7] },
  up:         { body: [11, 5, 10, 18], arm_r: [20, 11, 6, 16], arm_l: [8, 11, 3, 9], leg_r: [17, 23, 4, 7], leg_l: [11, 23, 4, 7] },
  "up-left":  { body: [13, 5, 9, 18], arm_r: [21, 11, 6, 16], arm_l: [10, 11, 3, 9], leg_r: [17, 23, 4, 7], leg_l: [12, 23, 4, 7] },
  left:       { body: [15, 5, 8, 18], arm_r: [19, 11, 7, 16], arm_l: [14, 11, 4, 9], leg_r: [18, 23, 4, 7], leg_l: [15, 23, 4, 7] },
  "down-left": { body: [13, 5, 9, 18], arm_r: [20, 11, 6, 16], arm_l: [10, 11, 3, 9], leg_r: [17, 23, 4, 7], leg_l: [12, 23, 4, 7] },
};

// z-order per facing = what the camera sees. Far limbs first, near limbs over them.
const ZORDER = {
  default: ["leg_l", "leg_r", "body", "arm_l", "arm_r"],
  down: ["leg_l", "leg_r", "body", "arm_l", "arm_r"],
  "down-right": ["leg_l", "leg_r", "body", "arm_l", "arm_r"],
  right: ["arm_l", "leg_l", "body", "leg_r", "arm_r"],
  "up-right": ["leg_l", "leg_r", "body", "arm_l", "arm_r"],
  up: ["leg_l", "leg_r", "body", "arm_l", "arm_r"],
  "up-left": ["arm_r", "leg_l", "leg_r", "body", "arm_l"],
  left: ["arm_r", "leg_l", "leg_r", "body", "arm_l"],
  "down-left": ["arm_r", "leg_l", "leg_r", "body", "arm_l"],
};

// Hand-declared ramp bias per part per facing: how many ramp steps that mass sits DOWN, because the
// key light is fixed at the upper LEFT OF THE SCREEN and a mass on the shadow side of the figure does
// not get to re-light itself just because it is a separate part. This is pim.js's decision (one light
// field for every part) written down as numbers so it is visible in git. 0 = lit side.
const BIAS = {
  down:       { body: 0, arm_r: 0, arm_l: -1, leg_r: 0, leg_l: -1 },
  "down-right": { body: 0, arm_r: 0, arm_l: -1, leg_r: 0, leg_l: -1 },
  right:      { body: 0, arm_r: 0, arm_l: -1, leg_r: 0, leg_l: -1 },
  "up-right": { body: -1, arm_r: 0, arm_l: -1, leg_r: 0, leg_l: -1 },
  up:         { body: -1, arm_r: -1, arm_l: 0, leg_r: -1, leg_l: 0 },
  "up-left":  { body: -1, arm_r: -1, arm_l: 0, leg_r: -1, leg_l: 0 },
  left:       { body: 0, arm_r: -1, arm_l: 0, leg_r: -1, leg_l: 0 },
  "down-left": { body: 0, arm_r: -1, arm_l: 0, leg_r: -1, leg_l: 0 },
};

// ---- the part library ------------------------------------------------------------
const GRIDS = {
  // ============ DOWN — front view. Face lit from the upper left, hood framing it. ==========
  "down/body": [
    "...wwww...",
    "..wwwwww..",
    ".wwwwwwww.",
    ".wwssssww.",
    ".wwssssww.",
    ".wssssssw.",
    "wwwwwwwwww",
    "wwwwwwwwww",
    "wwwwwwwwww",
    ".wwwwwwww.",
    ".wwwwwwww.",
    "..wwwwww..",
    ".wwwwwwww.",
    "www+++wwww",
    "www+++wwww",
    "wwwwwwwwww",
    "wwwwwwwwww",
    ".wwwwwwww.",
  ],
  // weapon arm: sleeve, hand, grip, brass crossguard, blade carried point-down at his side.
  "down/arm_r": [
    "...www",
    "...www",
    "...www",
    "...www",
    "..wwww",
    "..wwww",
    "..ww..",
    "..sss.",
    "..ddd.",
    "..ddd.",
    ".+++++",
    ".iiii.",
    "..iii.",
    "..iii.",
    "..ii..",
    "...i..",
  ],
  "down/arm_l": [
    "www",
    "www",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    "sss",
  ],
  "down/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "down/leg_l": ["hhhh", "hhhh", ".hhh", "ttt.", "tttt", "tttt", "tttt"],

  // ===== DOWN-RIGHT — three-quarter front turned to screen-right. Near (right) side larger. ====
  // One column narrower than the front view; the near shoulder is a row higher because the body has
  // rotated into the camera, and the face opening shifts toward the lit upper-left.
  "down-right/body": [
    "..wwwww..",
    ".wwwwwww.",
    "wwwwwwwww",
    "wwsssswww",
    "wwsssswww",
    ".wsssssww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
    ".wwwwwww.",
    "..wwwww..",
    ".wwwwwww.",
    "ww+++wwww",
    "ww+++wwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
  ],
  "down-right/arm_r": [
    "...www",
    "...www",
    "..wwww",
    "..wwww",
    "..wwww",
    "..ww..",
    "..sss.",
    "..ddd.",
    "..ddd.",
    ".+++++",
    ".iiii.",
    "..iii.",
    "..iii.",
    "..ii..",
    "...i..",
    "......",
  ],
  "down-right/arm_l": [
    "www",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    "sss",
  ],
  "down-right/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "down-right/leg_l": ["hhhh", "hhhh", ".hhh", "ttt.", "tttt", "tttt", "tttt"],

  // =============== RIGHT — profile facing screen-right. His right side is toward us. =========
  "right/body": [
    "...wwwww",
    "..wwwwww",
    ".wwwwwww",
    ".wwsssss",
    ".wwsssss",
    ".wssssss",
    "wwwwwwww",
    "wwwwwwww",
    "wwwwwwww",
    ".wwwwwww",
    ".wwwwwww",
    "..wwwww.",
    ".wwwwwww",
    "ww+++www",
    "ww+++www",
    "wwwwwwww",
    "wwwwwwww",
    ".wwwwwww",
  ],
  // near (weapon) arm: hand forward of the hip, blade angled down-forward, tip ahead of the stride.
  "right/arm_r": [
    ".www...",
    ".www...",
    ".www...",
    ".wwww..",
    ".wwww..",
    ".www...",
    ".ssss..",
    ".ddd...",
    "+++++..",
    ".iiii..",
    "..iiii.",
    "...iii.",
    "....ii.",
    ".....i.",
    ".......",
    ".......",
  ],
  // far arm, behind him: drawn before the torso so only the swing past his back reads.
  "right/arm_l": [
    "www.",
    "www.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ss.",
  ],
  "right/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "right/leg_l": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],

  // =============== UP-RIGHT — three-quarter back turned to screen-right. ====================
  // Back view: no face; the hood covers the head. The belt plate is still visible (the belt wraps).
  "up-right/body": [
    "..wwwww..",
    ".wwwwwww.",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
    ".wwwwwww.",
    "..wwwww..",
    ".wwwwwww.",
    "wwww++www",
    "wwww++www",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
  ],
  "up-right/arm_r": [
    "...www",
    "...www",
    "...www",
    "..wwww",
    "..wwww",
    "..ww..",
    "..sss.",
    "..ddd.",
    "..ddd.",
    ".+++++",
    ".iiii.",
    "..iii.",
    "..iii.",
    "..ii..",
    "...i..",
    "......",
  ],
  "up-right/arm_l": [
    "www",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    ".ss",
  ],
  "up-right/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "up-right/leg_l": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],

  // ============================ UP — back view. =============================================
  "up/body": [
    "...wwww...",
    "..wwwwww..",
    ".wwwwwwww.",
    ".wwwwwwww.",
    ".wwwwwwww.",
    ".wwwwwwww.",
    "wwwwwwwwww",
    "wwwwwwwwww",
    "wwwwwwwwww",
    ".wwwwwwww.",
    ".wwwwwwww.",
    "..wwwwww..",
    ".wwwwwwww.",
    "wwww+++www",
    "wwww+++www",
    "wwwwwwwwww",
    "wwwwwwwwww",
    ".wwwwwwww.",
  ],
  "up/arm_r": [
    "www...",
    "www...",
    "wwww..",
    "wwww..",
    "wwww..",
    "..ww..",
    ".sss..",
    ".ddd..",
    ".ddd..",
    "+++++.",
    ".iiii.",
    ".iii..",
    ".iii..",
    ".ii...",
    ".i....",
    "......",
  ],
  "up/arm_l": [
    "www",
    "www",
    "www",
    "www",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    "sss",
  ],
  "up/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "up/leg_l": ["hhhh", "hhhh", ".hhh", "ttt.", "tttt", "tttt", "tttt"],

  // =============== UP-LEFT — three-quarter back turned to screen-left. =====================
  "up-left/body": [
    "..wwwww..",
    ".wwwwwww.",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
    ".wwwwwww.",
    "..wwwww..",
    ".wwwwwww.",
    "www++wwww",
    "www++wwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
  ],
  "up-left/arm_r": [
    "...www",
    "...www",
    "..wwww",
    "..wwww",
    "..wwww",
    "..ww..",
    "..sss.",
    "..ddd.",
    "..ddd.",
    ".+++++",
    ".iiii.",
    "..iii.",
    "..iii.",
    "..ii..",
    "...i..",
    "......",
  ],
  "up-left/arm_l": [
    "www",
    "www",
    "www",
    "www",
    ".ww",
    ".ww",
    ".ww",
    ".ww",
    "sss",
  ],
  "up-left/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "up-left/leg_l": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],

  // =============== LEFT — profile facing screen-left. His left side is toward us. ==========
  // The torso is the authored mirror of the right-facing torso (docs/03 §1: mirroring a facing is
  // standard craft); what is re-authored here is the asymmetry — which arm carries the blade, and
  // the far arm's swing behind him.
  "left/body": [
    "wwwww...",
    "wwwwww..",
    "wwwwwww.",
    "sssssww.",
    "sssssww.",
    "ssssssw.",
    "wwwwwwww",
    "wwwwwwww",
    "wwwwwwww",
    "wwwwwww.",
    "wwwwwww.",
    ".wwwww..",
    "wwwwwww.",
    "www+++ww",
    "www+++ww",
    "wwwwwwww",
    "wwwwwwww",
    "wwwwwww.",
  ],
  // far (weapon) arm: grip behind the torso, blade angled down-forward past his chest.
  "left/arm_r": [
    "...www.",
    "...www.",
    "...www.",
    "..wwww.",
    "..wwww.",
    "...www.",
    "..ssss.",
    "...ddd.",
    "..+++++",
    "..iiii.",
    ".iiii..",
    ".iii...",
    ".ii....",
    ".i.....",
    ".......",
    ".......",
  ],
  // near arm
  "left/arm_l": [
    ".www",
    ".www",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ww.",
    ".ss.",
  ],
  "left/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "left/leg_l": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],

  // =============== DOWN-LEFT — three-quarter front turned to screen-left. ==================
  "down-left/body": [
    "..wwwww..",
    ".wwwwwww.",
    "wwwwwwwww",
    "wwwssssww",
    "wwwssssww",
    "wwsssssw.",
    "wwwwwwwww",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
    ".wwwwwww.",
    "..wwwww..",
    ".wwwwwww.",
    "wwww++www",
    "wwww++www",
    "wwwwwwwww",
    "wwwwwwwww",
    ".wwwwwww.",
  ],
  "down-left/arm_r": [
    "www...",
    "www...",
    "wwww..",
    "wwww..",
    "wwww..",
    "..ww..",
    ".sss..",
    ".ddd..",
    ".ddd..",
    "+++++.",
    ".iiii.",
    ".iii..",
    ".iii..",
    ".ii...",
    ".i....",
    "......",
  ],
  "down-left/arm_l": [
    "www",
    "www",
    "www",
    "www",
    "www",
    ".ww",
    ".ww",
    ".ww",
    "sss",
  ],
  "down-left/leg_r": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
  "down-left/leg_l": ["hhhh", "hhhh", "hhh.", ".ttt", "tttt", "tttt", "tttt"],
};

// Two pixels of eye per facing, on the facings that have a face (the four front-ish ones).
// Part-local coordinates. Nothing else is drawn on the face: docs/03 §6 — silhouette first.
const MARKS = {
  "down/body": [[3, 4, "eye"], [6, 4, "eye"]],
  "down-right/body": [[3, 4, "eye"], [5, 4, "eye"]],
  "down-left/body": [[4, 4, "eye"], [6, 4, "eye"]],
  "right/body": [[4, 4, "eye"], [6, 4, "eye"]],
  "left/body": [[2, 4, "eye"], [4, 4, "eye"]],
};

// ---- materials: grid letter -> ramp name ----------------------------------------
const MAP = { w: "wool", h: "hide", t: "boot", s: "skin", i: "iron", d: "haft" };

// ---- the direction set, frozen at project_init (docs/03 §1) --------------------
const DIRECTIONS = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];
const CARDINALS = ["down", "right", "up", "left"];
const DIAGONALS = ["down-right", "up-right", "up-left", "down-left"];

/**
 * WALK — six frames per facing, one rhythm for all eight facings.
 * Four key poses (contact / down / passing / up) plus a second contact and a second up, so the
 * cycle has two strides in it rather than the same stride twice. A hold is a LONGER DURATION on a
 * distinct frame (see TIMING), never a duplicated cel.
 * Arms oppose legs in every base pose (loop_validate requires two moving arm parts).
 * dirMods change the STRIDE per facing: a side view gets a full fore-aft stride, a front/back view
 * sees that same stride foreshortened, so its arms swing vertically instead.
 */
const WALK_POSES = [
  {
    name: "contact", weight: 1.4, headBob: 1,
    note: "heel down, stride at its widest, body at its lowest.",
    parts: { leg_r: { dx: -1 }, leg_l: { dx: 1 }, arm_r: { dx: 1 }, arm_l: { dx: -1 }, body: { dy: 1 } },
    dirMods: {
      down:  { leg_r: { dx: -1 }, leg_l: { dx: 1 }, arm_r: { dx: 0, dy: 1 }, arm_l: { dx: 0, dy: -1 } },
      up:    { leg_r: { dx: -1 }, leg_l: { dx: 1 }, arm_r: { dx: 0, dy: -1 }, arm_l: { dx: 0, dy: 1 } },
      right: { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: 1 }, arm_l: { dx: -1 } },
      left:  { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: -1 }, arm_l: { dx: 1 } },
      "down-right": { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: 0, dy: 1 }, arm_l: { dx: -1 } },
      "up-right":   { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: 0, dy: -1 }, arm_l: { dx: -1 } },
      "down-left":  { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 1 }, arm_l: { dx: 0, dy: 1 } },
      "up-left":    { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 1 }, arm_l: { dx: 0, dy: -1 } },
    },
  },
  {
    name: "down", weight: 1.0, headBob: 1,
    note: "weight lands on the front foot; the body sinks as it absorbs the step.",
    parts: { leg_r: { dx: -1 }, leg_l: { dx: 0 }, arm_r: { dx: 1 }, arm_l: { dx: -1 }, body: { dy: 1 } },
    dirMods: {
      down:  { arm_r: { dx: 0, dy: 0 }, arm_l: { dx: 0, dy: 0 }, leg_r: { dx: -1 }, leg_l: { dx: 0 } },
      up:    { arm_r: { dx: 0, dy: 0 }, arm_l: { dx: 0, dy: 0 }, leg_r: { dx: -1 }, leg_l: { dx: 0 } },
      right: { leg_r: { dx: -1 }, leg_l: { dx: 0 }, arm_r: { dx: 1, dy: 0 }, arm_l: { dx: -1 } },
      left:  { leg_r: { dx: 0 }, leg_l: { dx: -1 }, arm_r: { dx: -1 }, arm_l: { dx: 1 } },
      "down-right": { leg_r: { dx: -1 }, leg_l: { dx: 0 }, arm_r: { dx: 0, dy: 0 }, arm_l: { dx: -1 } },
      "up-right":   { leg_r: { dx: -1 }, leg_l: { dx: 0 }, arm_r: { dx: 0, dy: 0 }, arm_l: { dx: -1 } },
      "down-left":  { leg_r: { dx: 0 }, leg_l: { dx: -1 }, arm_r: { dx: 1 }, arm_l: { dx: 0, dy: 0 } },
      "up-left":    { leg_r: { dx: 0 }, leg_l: { dx: -1 }, arm_r: { dx: 1 }, arm_l: { dx: 0, dy: 0 } },
    },
  },
  {
    name: "passing", weight: 0.8, headBob: -1,
    note: "one leg vertical and bearing weight, the other swinging under; body at its tallest.",
    parts: { leg_r: { dx: 0 }, leg_l: { dx: 0, dy: -1 }, arm_r: { dx: 0 }, arm_l: { dx: 0 }, body: { dy: 0 } },
    dirMods: {
      right: { leg_l: { dx: 1, dy: -1 } }, left: { leg_l: { dx: -1, dy: -1 } },
      "down-right": { leg_l: { dx: 1, dy: -1 } }, "up-right": { leg_l: { dx: 1, dy: -1 } },
      "down-left": { leg_l: { dx: -1, dy: -1 } }, "up-left": { leg_l: { dx: -1, dy: -1 } },
    },
  },
  {
    name: "up", weight: 1.0, headBob: -1,
    note: "push off the back foot; the highest frame of the cycle.",
    parts: { leg_r: { dx: 1 }, leg_l: { dx: -1 }, arm_r: { dx: -1 }, arm_l: { dx: 1 }, body: { dy: -1 } },
    dirMods: {
      down:  { arm_r: { dx: 0, dy: -1 }, arm_l: { dx: 0, dy: 1 } },
      up:    { arm_r: { dx: 0, dy: 1 }, arm_l: { dx: 0, dy: -1 } },
      right: { leg_r: { dx: 1 }, leg_l: { dx: -2 } },
      left:  { leg_r: { dx: -2 }, leg_l: { dx: 1 } },
      "down-right": { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 0, dy: -1 } },
      "up-right":   { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 0, dy: 1 } },
      "down-left":  { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_l: { dx: 0, dy: -1 } },
      "up-left":    { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_l: { dx: 0, dy: 1 } },
    },
  },
  {
    name: "contact2", weight: 1.4, headBob: 1,
    note: "the other heel down: same contact shape, opposite lead foot.",
    parts: { leg_r: { dx: 1 }, leg_l: { dx: -1 }, arm_r: { dx: -1 }, arm_l: { dx: 1 }, body: { dy: 1 } },
    dirMods: {
      down:  { arm_r: { dx: 0, dy: -1 }, arm_l: { dx: 0, dy: 1 } },
      up:    { arm_r: { dx: 0, dy: 1 }, arm_l: { dx: 0, dy: -1 } },
      right: { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: -1 }, arm_l: { dx: 1 } },
      left:  { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: 1 }, arm_l: { dx: -1 } },
      "down-right": { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 0, dy: -1 }, arm_l: { dx: 1 } },
      "up-right":   { leg_r: { dx: 1 }, leg_l: { dx: -2 }, arm_r: { dx: 0, dy: 1 }, arm_l: { dx: 1 } },
      "down-left":  { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: -1 }, arm_l: { dx: 0, dy: -1 } },
      "up-left":    { leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_r: { dx: -1 }, arm_l: { dx: 0, dy: 1 } },
    },
  },
  {
    name: "up2", weight: 1.0, headBob: -1,
    note: "second push-off, handing off to the first contact so the loop does not stutter.",
    parts: { leg_r: { dx: -1 }, leg_l: { dx: 1 }, arm_r: { dx: 1 }, arm_l: { dx: -1 }, body: { dy: -1 } },
    dirMods: {
      down:  { arm_r: { dx: 0, dy: 1 }, arm_l: { dx: 0, dy: -1 } },
      up:    { arm_r: { dx: 0, dy: -1 }, arm_l: { dx: 0, dy: 1 } },
      right: { leg_r: { dx: -1 }, leg_l: { dx: 2 } },
      left:  { leg_r: { dx: 2 }, leg_l: { dx: -1 } },
      "down-right": { leg_r: { dx: -1 }, leg_l: { dx: 2 }, arm_r: { dx: 0, dy: 1 } },
      "up-right":   { leg_r: { dx: -1 }, leg_l: { dx: 2 }, arm_r: { dx: 0, dy: -1 } },
      "down-left":  { leg_r: { dx: 2 }, leg_l: { dx: -1 }, arm_l: { dx: 0, dy: 1 } },
      "up-left":    { leg_r: { dx: 2 }, leg_l: { dx: -1 }, arm_l: { dx: 0, dy: -1 } },
    },
  },
];

/**
 * ATTACK — five frames per facing on the attack2 template
 * (anticipation / wind / action / follow-through / recovery; mandatory: anticipation longer than
 * the swing, and the weapon must overshoot). The weapon arm is one mass, so the whole
 * hand-grip-blade unit lifts, whips down and overshoots past neutral.
 */
const ATTACK_POSES = [
  {
    name: "anticipation", weight: 1.2, headBob: -1,
    note: "weight drawn back, weapon lifted high and behind: this is where weight reads.",
    parts: { arm_r: { dy: -4, dx: -1 }, body: { dy: -1 }, leg_r: { dx: -1 }, arm_l: { dx: 1, dy: 1 } },
    dirMods: {
      down: { arm_r: { dy: -3, dx: 0 } }, up: { arm_r: { dy: -3, dx: 0 } },
      left: { arm_r: { dy: -3, dx: 1 } }, "down-left": { arm_r: { dy: -3, dx: 1 } }, "up-left": { arm_r: { dy: -3, dx: 1 } },
    },
  },
  {
    name: "wind", weight: 1.0, headBob: 0,
    note: "the body coils; the far arm comes up for counterbalance.",
    parts: { arm_r: { dy: -5, dx: -2 }, body: { dy: 0 }, leg_r: { dx: -2 }, leg_l: { dx: 1 }, arm_l: { dx: 2, dy: -1 } },
    dirMods: {
      down: { arm_r: { dy: -4, dx: -1 } }, up: { arm_r: { dy: -4, dx: 1 } },
      left: { arm_r: { dy: -4, dx: 2 } }, "down-left": { arm_r: { dy: -4, dx: 2 } }, "up-left": { arm_r: { dy: -4, dx: 2 } },
    },
  },
  {
    name: "action", weight: 1.6, headBob: 1,
    note: "the cut: the weapon drops and drives forward, the body follows it down.",
    parts: { arm_r: { dy: 3, dx: 3 }, body: { dy: 1 }, leg_r: { dx: 1 }, arm_l: { dx: -2, dy: 1 } },
    dirMods: {
      down: { arm_r: { dy: 2, dx: 1 } }, up: { arm_r: { dy: 2, dx: -1 } },
      left: { arm_r: { dy: 2, dx: -2 } }, "down-left": { arm_r: { dy: 2, dx: -2 } }, "up-left": { arm_r: { dy: 2, dx: -2 } },
    },
  },
  {
    name: "follow_through", weight: 1.1, headBob: 1,
    note: "the blade overshoots past neutral — mandatory on the attack2 template.",
    parts: { arm_r: { dy: 2, dx: 4 }, body: { dy: 1 }, leg_r: { dx: 2 }, leg_l: { dx: -1 }, arm_l: { dx: -2, dy: 2 } },
    dirMods: {
      down: { arm_r: { dy: 1, dx: 2 } }, up: { arm_r: { dy: 1, dx: -2 } },
      left: { arm_r: { dy: 1, dx: -3 } }, "down-left": { arm_r: { dy: 1, dx: -3 } }, "up-left": { arm_r: { dy: 1, dx: -3 } },
    },
  },
  {
    name: "recovery", weight: 1.0, headBob: 0,
    note: "brought back to the carry pose the next anticipation starts from.",
    parts: { arm_r: { dy: 0, dx: 1 }, body: { dy: 0 }, leg_r: { dx: 1 }, arm_l: { dx: -1, dy: 0 } },
    dirMods: {
      left: { arm_r: { dy: 0, dx: -1 } }, "down-left": { arm_r: { dy: 0, dx: -1 } }, "up-left": { arm_r: { dy: 0, dx: -1 } },
    },
  },
];

// Authored per-frame durations in ms, ONE rhythm for all eight facings (the claim this proves).
// A hold is a longer duration on its own frame; no frame is repeated to make a hold.
const TIMING = {
  walk: {
    fps: 12,
    order: ["contact", "down", "passing", "up", "contact2", "up2"],
    ms: [130, 175, 190, 150, 130, 150],          // cycle 925ms; the holds are down(175) and passing(190)
    events: { contact: ["footstep"], contact2: ["footstep"] },
  },
  attack: {
    fps: 16,
    order: ["anticipation", "wind", "action", "follow_through", "recovery"],
    ms: [330, 150, 90, 160, 240],                // cycle 970ms; anticipation(330) > action(90)
    events: { action: ["hitbox_active", "sfx.slash"], follow_through: ["sfx.follow"] },
  },
};

module.exports = { CANVAS, BASELINE, HIPLINE, JOINTS, LAYOUT, ZORDER, BIAS, GRIDS, MARKS, MAP, DIRECTIONS, CARDINALS, DIAGONALS, WALK_POSES, ATTACK_POSES, TIMING };
