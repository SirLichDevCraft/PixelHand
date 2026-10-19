// The Phase 4 weapon family's design language, expressed as primitives rather than forty rows of
// characters per asset. See bench/gate4-weapons.js for the coordinate declaration and the gate.
//
// WHY THIS NOTATION FOR THIS FAMILY. docs/09 forbids procedural drawing primitives for organic form: a
// formula tracing a curve is exactly what produced the walk cycle that started this project. A machined
// mechanism is the opposite case: its masses ARE rectangles at stated dimensions and a chamfer on every
// convex corner IS the family rule. Each member declares its own dimensions and placements by hand — no
// defaults inferred, nothing randomised, no shape fitted — these primitives lay out exactly what was
// declared, and the resulting cel is committed to disk as an explicit text grid a human can read, edit and
// diff. Organic assets stay cell-authored (src/pim.js); mechanical ones are authored as dimensions. Both
// routes end in hand-decided pixels and both are measured by the same gates. That choice is recorded here,
// in PLAN section 5A and in docs/13 rather than applied quietly.
"use strict";

const CW = 32, CH = 32;                                       // the declared art scale
const MATS = ["iron", "gunmetal", "leather", "ember"];         // material ramps available in this palette

function rect(x, y, w, h, m) { return { x: x, y: y, w: w, h: h, m: m }; }
function cut(x, y) { return { x: x, y: y }; }
function stud(x, y) { return { x: x, y: y }; }

/** Chamfer the convex corners of a mass: one cell off each end of its horizontal runs. */
function chamfers(x, y, w, h) {
  if (w < 3 || h < 2) return [];                       // a two-wide member cannot afford its corners cut
  const out = [cut(x, y), cut(x + w - 1, y)];          // top-left and top-right
  if (h >= 3) out.push(cut(x, y + h - 1), cut(x + w - 1, y + h - 1));
  return out;
}

/** The shaft: the spine every other mass hangs from, running from row `top` to row `bottom`. */
function shaft(s, w, top, bottom) { return [rect(s, top, w, bottom - top + 1, "iron")]; }

/** A flush band of a different metal at an unchanged silhouette width — this family's joint language. */
function band(s, y, w, h, m) { return [rect(s, y, w, h, m || "gunmetal")]; }

/**
 * A cage: four walls enclosing `plates` internal bars whose top rows I name. The enclosed air between
 * the walls and the bars is what carries the negative-space score for this family — holes that read as
 * structure rather than as bites out of a silhouette. Walls are `t` cells thick.
 */
function cage(x, y, w, h, t, plates, pt) {
  const blocks = [];
  blocks.push(rect(x, y, w, t, "gunmetal"));                       // top rail
  blocks.push(rect(x, y + h - t, w, t, "gunmetal"));               // bottom rail
  blocks.push(rect(x, y + t, t, h - 2 * t, "gunmetal"));           // left post
  blocks.push(rect(x + w - t, y + t, t, h - 2 * t, "gunmetal"));   // right post
  for (const top of plates) blocks.push(rect(x + t, top, w - 2 * t, pt || 2, "iron"));
  return blocks;
}

/** The grip rule every member obeys: a gunmetal ferrule over four rows of leather wrap. */
function grip(s, w) {
  return [rect(s, 24, w, 1, "gunmetal"), rect(s, 25, w, 4, "leather")];
}

/**
 * A machined butt plate one cell wider than the wrap on each side. It does two jobs: it is where a struck
 * mechanism reacts, and it puts mass at the hand end so a member with an exaggerated working end still
 * measures 'even' rather than head-heavy.
 */
function butt(s, w) { return [rect(s - 1, 29, w + 2, 2, "gunmetal")]; }

/** A serrated edge: `n` teeth of width `tw` and height `th`, starting at x, on row y. */
function teeth(x, y, n, tw, th) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rect(x + i * (tw + 1), y, tw, th, "iron"));
  return out;
}

/** A ground edge: `rows` bands, each shifted inward by `dx` cells and narrowed by `dw` cells. */
function grind(x, y, w, rows, dx, dw, m) {
  const out = [];
  for (let i = 0; i < rows; i++) out.push(rect(x + i * dx, y + i, Math.max(1, w - i * dw), 1, m || "iron"));
  return out;
}

/** A mass placed by its axis rather than its left edge: this family is built around the line you swing it along. */
function centered(cx, w, y, h, m) { return [rect(cx - Math.floor(w / 2), y, w, h, m || "iron")]; }

/** A row of `n` bolts spaced two cells apart, centred on the axis. Fasteners are this family's decoration. */
function studRun(cx, y, n) {
  const out = []; const x0 = cx - Math.floor((n - 1) / 2) * 2;
  for (let i = 0; i < n; i++) out.push(stud(x0 + i * 2, y));
  return out;
}

/** A cage placed by axis instead of left edge. plates=[] gives a closed frame with one enclosed interior. */
function cageAt(cx, y, w, h, t, plates, pt) { return cage(cx - Math.floor(w / 2), y, w, h, t, plates || [], pt); }

/** A plate of focal-accent cells: this family states where to look with brass, not with an outline. */
function accentPlate(cx, y, w, h) {
  const out = []; const x0 = cx - Math.floor(w / 2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(stud(x0 + i, y + j));
  return out;
}


/**
 * The kit every member of this family is built from, so the family reads as one language: a working mass at the
 * top, a shoulder collar bolted to it, a framed body around the middle, a short shank into the wrap. Each member
 * names its own dimensions and adds one signature part of its own - teeth, a ground edge, an ember band, a loop -
 * which is where the design variety lives. Nothing here decides a shape for me: I give the numbers, this lays them out.
 */
/** The row directly under whatever head this kit declares: where its shoulder collar has to sit. */
function shoulderRow(kit) {
  return (kit.pollY === undefined ? BASE.pollY : kit.pollY) + (kit.pollH === undefined ? BASE.pollH : kit.pollH);
}

/** Which columns the declared head actually covers, so signature parts can hang off it honestly. */
function crownCols(kit) {
  const cx = kit.axis === undefined ? Math.floor(CW / 2) : kit.axis;   // every member declares its own axis; this is only a fallback
  const w = kit.pollW === undefined ? BASE.pollW : kit.pollW;
  return [cx - Math.floor(w / 2), cx + Math.floor(w / 2) - 1];
}
function frame(kit) {
  for (const key of Object.keys(BASE)) if (kit[key] === undefined) kit[key] = BASE[key];   // a member names only what it exaggerates
  if (kit.collarY === undefined) kit.collarY = shoulderRow(kit);   // the collar sits where the declared head ends
  const cx = kit.axis, out = [];
  out.push(...centered(cx, kit.pollW, kit.pollY, kit.pollH, kit.pollM || "iron"));
  out.push(...centered(cx, kit.collarW, kit.collarY, 1, "gunmetal"));            // the shoulder joint
  const by = kit.bodyY, bh = kit.bodyH;
  out.push(...cageAt(cx, by, kit.bodyW, bh, kit.bodyT, kit.barRows || [], kit.barH || 2));   // framed body
  const sTop = by + bh;                                                          // shank fills what is left of it
  if (sTop < 24) out.push(...centered(cx, kit.shankW || Math.max(3, kit.bodyW - 6), sTop, 24 - sTop, "iron"));
  const gw = kit.wrapW || 9, ws = cx - Math.floor(gw / 2);                      // the wrap width I chose for this member
  out.push(...grip(ws, gw));                                                    // ferrule + leather wrap, family rule
  out.push(...butt(ws, gw));                                                    // butt plate reacting the strike

  const studs = kit.bolts ? studRun(cx, kit.collarY, kit.bolts) : [];           // fasteners are this family's ornament
  if (kit.emblemY !== undefined) studs.push(...accentPlate(cx, kit.emblemY, kit.emblemW || 3, kit.emblemH || 2));
  return { axis: cx, blocks: out, studs };
}

module.exports = { CW, CH, MATS,
  shoulderRow: shoulderRow,
  crownCols: crownCols,
  rect: rect,
  cut: cut,
  stud: stud,
  chamfers: chamfers,
  shaft: shaft,
  band: band,
  cage: cage,
  cageAt: cageAt,
  grip: grip,
  butt: butt,
  teeth: teeth,
  grind: grind,
  centered: centered,
  studRun: studRun,
  accentPlate: accentPlate,
  frame: frame,
  member: member };

/** One member of the family: the kit numbers plus what this member declares itself to be exaggerated about. */
function member(kit) {
  const built = frame(kit);
  const own = kit.extra || [];
  const drawn = own.filter((b) => b.w && b.h);          // signature parts that have dimensions get drawn
  const fasteners = own.filter((b) => !b.w && !b.h);   // single cells join the accent row rather than the body
  return {
    id: kit.id,
    name: kit.name,
    rule_broken: kit.exaggerates,
    feature: kit.note,
    accent: kit.accentNote,
    blocks: built.blocks.concat(drawn),
    cuts: [],
    studs: built.studs.concat(fasteners),
  };
}

// The family's default proportions: what a mechanism in this set looks like when nothing about it is exaggerated.
const BASE = {};                                // a member overrides only the numbers it is exaggerating
BASE.pollW = 9;                                 // the working mass at the top
BASE.pollH = 3;                                 // ...and how deep that mass is
BASE.pollY = 5;                                 // where the working mass sits on the plate
BASE.collarW = 7;                               // the shoulder joint band
BASE.bodyW = 13;                                // the framed body around the middle of the weapon
BASE.bodyH = 14;                                // ...tall enough to read as a mechanism rather than a fitting
BASE.bodyT = 2;                                 // wall thickness this family machines its frames with
BASE.bodyY = 9;                                 // directly under the collar, so the body carries the weapon
BASE.barRows = [11, 16];                        // two internal bars over three enclosed air pockets
BASE.barH = 3;                                  // bars this deep so they read as parts, not as hatching

// The grip is fixed by the family rule rather than by each member: same ferrule row, four rows of wrap, butt plate.
BASE.wrapW = 9;                                 // a two-handed wrap unless a member says otherwise
BASE.bolts = 2;                                   // fasteners kept sparse so accent clusters stay readable

