// 2. Rivet driver - exaggerates SHANK REACH: the iron between the striking face and the hand is longer than it
// needs to be, which is what lets a riveter reach into a joint the rest of the tool cannot fit beside.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.axis = 11;
kit.pollW = 5;                                  // a small face, because the reach is the point of this one
kit.pollH = 3;
kit.pollY = 4;
kit.collarW = 6;                                // collar barely wider than the face it sits under
kit.bodyY = 8;                                  // the drive block sits high so the shank can run long below it
kit.bodyH = 9;
kit.bodyW = 9;
kit.bodyT = 2;
kit.barRows = [];                               // one open cavity inside: this tool is a tube, not a housing
kit.wrapW = 7;                                  // one-handed grip: reach costs weight you have to hold all day
kit.bolts = 2;
const built = A.frame(kit); const out = {};
out.id = "rivet_driver"; out.name = "Rivet driver"; out.rule_broken = "shank reach";
out.feature = "an iron run between face and hand longer than the job needs";
out.accent = "two bolts through a collar barely wider than them";
out.blocks = built.blocks;
out.cuts = [];
out.studs = built.studs;
module.exports = out;

