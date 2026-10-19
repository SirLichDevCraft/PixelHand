// Great maul - exaggerates GRIP SCALE: a handle built for two hands, with everything else forged to match it.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "great_maul";
kit.name = "Great maul";
kit.exaggerates = "grip scale";   // unique across the ten members
kit.note = "a leather wrap fifteen cells wide, answered by a head thirteen across so the weight stays along the weapon"
kit.accentNote = "two bolts through a collar much narrower than the grip below them"
kit.axis = 11;   // drawn about its own axis, like every other member
kit.pollW = 13;  // THE answer: a head this wide is what makes an oversized grip carryable rather than front-heavy
kit.pollH = 4;
kit.pollY = 5;
kit.collarW = 9;   // stepped in from the head, as the family does everywhere else
kit.bodyY = 10;    // ...and the frame starts right below that
kit.bodyW = 15;    // ...and a body this wide, for the same reason
kit.bodyT = 3;     // walls thick enough that the bulk reads as machined rather than as slab
kit.wrapW = 15;  // THE exaggeration: two hands, which no other member in this family asks for
module.exports = A.member(kit);

