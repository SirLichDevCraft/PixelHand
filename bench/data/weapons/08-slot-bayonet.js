// Slot bayonet - exaggerates BLADE LENGTH: a blade longer than the weapon meant to hold it.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "slot_bayonet";
kit.name = "Slot bayonet";
kit.exaggerates = "blade length";   // unique across the ten members
kit.note = "a blade fourteen rows tall on a socket barely deeper than its own collar"
kit.accentNote = "two bolts through the collar that clamps that blade to its frame"
kit.axis = 11;   // drawn about its own axis, like every other member
kit.pollW = 6;   // THE exaggeration: this long and only this wide is a blade, not a head
kit.pollH = 14;  // ...and this long, which is why its tip corners chamfer away into a point
kit.pollY = 1;   // pushed as high in the plate as the canvas allows so the run reads all at once
kit.collarW = 9;   // the clamp has to be wider than the blade to read as a clamp at all
kit.bodyY = 16;   // a short socket, deliberately no wider than its own clamp
kit.bodyW = 9;  // THE answer to its own overhang: nothing down here is oversized
kit.bodyH = 6;   // THE answer: barely a socket at all, which is what makes the blade look wrong
kit.barRows = [];      // no bars - a socket is solid where it has to grip
module.exports = A.member(kit);

