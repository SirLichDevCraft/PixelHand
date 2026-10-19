// Lantern clamp - exaggerates FASTENER DENSITY: bolts everywhere the kit would normally leave plain.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "lantern_clamp";
kit.name = "Lantern clamp";
kit.exaggerates = "fastener density";   // unique across the ten members
kit.note = "five bolts through its shoulder collar and five more along its upper rail"
kit.accentNote = "the fasteners themselves: brass where every other member keeps brass to a plate"
kit.axis = 11;   // drawn about its own axis, like every other member
kit.bolts = 5;   // THE exaggeration: a collar this bolted is what the member is for
kit.wrapW = 7;   // one hand, so the clamp body can stay the size it is
kit.extra = [];  // parts this member brings that the kit does not prescribe
kit.extra.push(...A.studRun(11, 9, 5));   // a second row of fasteners along the frame top rail
module.exports = A.member(kit);
