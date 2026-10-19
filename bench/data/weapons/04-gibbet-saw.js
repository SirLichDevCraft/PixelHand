// Gibbet saw - exaggerates TOOTH COUNT: a serrated crown wider than its frame, with teeth hung off its shoulders.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "gibbet_saw";   // how the family report names this member
kit.name = "Gibbet saw";
kit.exaggerates = "tooth count";   // unique across the ten members
kit.note = "a crown fifteen cells wide with four machined teeth hung from its shoulders, over a frame as deep as the plate allows"
kit.accentNote = "two bolts through a collar narrower than the crown it carries"
kit.axis = 11;   // drawn about its own axis, like every other member
kit.pollW = 15;  // THE exaggeration: a crown this wide is only there to hang teeth from
kit.pollH = 3;   // ...and this deep, so it reads as a machined rack rather than as a plate
kit.pollY = 2;
kit.collarW = 11;  // stepped in from the crown, as the family steps in everywhere else
kit.bodyY = 6;
kit.bodyH = 14;    // a normal frame under an abnormal head, which is what keeps the mass along the tool
kit.bodyW = 9;     // deliberately narrow so the teeth have somewhere clear to hang
kit.barRows = [10, 15];   // two bars inside that frame, per the family default
kit.extra = [];   // parts this member brings that the kit does not prescribe
const [crownL, crownR] = A.crownCols(kit);   // where its declared crown actually reaches
const shoulder = A.shoulderRow(kit);        // the row directly under it
kit.extra.push(...A.teeth(crownL + 1, shoulder, 2, 2, 3));   // two teeth hung from the crown's left shoulder
kit.extra.push(...A.teeth(crownR - 4, shoulder, 2, 2, 3));    // ...and two from its right
module.exports = A.member(kit);
