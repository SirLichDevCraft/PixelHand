// Ember wrench - exaggerates JAW SPAN:
// jaws opened wider than any fastener they were meant to turn, with the joint under them heat softened
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "ember_wrench";   // how the family report names this member
kit.name = "Ember wrench";
kit.exaggerates = "jaw span";   // unique across the ten members
kit.note = "a jaw seventeen cells across on a hand tool, over a frame widened to carry it";
kit.accentNote = "two bolts through a collar much narrower than the jaw above them";
kit.axis = 11;   // drawn about its own axis, like every other member
kit.pollW = 17;  // THE exaggeration: jaws this wide on a hand weapon
kit.pollH = 3;
kit.pollY = 4;
kit.collarW = 11;  // the collar is nearly as wide as the jaw: that is how the weight gets carried down
kit.bodyY = 8;
kit.bodyH = 13;    // deep enough that the mass ends up along the whole tool rather than at its end
kit.bodyT = 3;
kit.bodyW = 13;    // ...and this wide for the same reason
kit.barRows = [11, 15];
kit.barH = 3;
kit.wrapW = 11;  // THE answer: a grip this wide is the leverage a jaw that span needs
kit.bolts = 2;
kit.extra = [];   // parts this member brings that the kit does not prescribe
for (const b of A.band(4, 8, 15, 2)) kit.extra.push(b);   // the joint under the jaw, in ember rather than iron
module.exports = A.member(kit);

