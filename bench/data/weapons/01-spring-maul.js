// 1. Spring maul - exaggerates COLLAR SIZE: the recoil housing is bigger than the tool it belongs to, so what is
// drawn at the other end is a heavy butt plate. An over-sprung weapon you can still swing.
"use strict";
const A = require("../arsenal.js");

const kit = {};
kit.axis = 11;                                  // every member is drawn about its own axis
kit.pollW = 9;                                  // the striking mass, deliberately modest next to what follows
kit.pollH = 3;
kit.pollY = 5;                                  // sitting low on the canvas so the body can dominate the middle
kit.collarW = 7;
kit.bolts = 3;                                  // brass fasteners through that joint
kit.bodyW = 14;                                 // THE exaggeration: a recoil housing this wide on a hand tool
kit.bodyH = 14;
kit.bodyY = 9;                                  // directly under the collar, so the housing carries the weapon
kit.bodyT = 2;                                  // wall thickness, per the family convention on mechanisms
kit.barRows = [11, 16];                         // two coil bars over three enclosed air pockets inside it
kit.barH = 3;
kit.wrapW = 9;                                  // a two-handed wrap, as wide as a maul grip has to be
kit.emblemY = 6;                                // a brass insignia stamped into the poll: where this weapon wants to be looked at
kit.emblemW = 3;                                // six brass cells clustered together - any bigger and the engine rightly calls it a flat fill
kit.emblemH = 2;

const built = A.frame(kit);                     // the kit lays out exactly these numbers and adds nothing else

const out = {};                                 // what the gate consumes: cells plus the declared exaggeration
out.id = "spring_maul";
out.name = "Spring maul";
out.rule_broken = "collar size";                // unique across the family; family_audit checks that no two claim it
out.feature = "a recoil housing wider than the tool it belongs to";
out.accent = "three brass bolts through the shoulder collar";
out.blocks = built.blocks;                      // each rect is a mass I named, at a place I chose, in a metal I picked out.blocks.cuts = [];                        // chamfers come from the family rule unless I name one extra out.studs = built.studs; module.exports = out; EOF 2>/dev/null || cat >> bench/data/weapons/01-spring-maul.js <<'EOF'
out.blocks = built.blocks;                      // each rect is a mass I named, at a place, in a metal I picked
out.cuts = [];                                  // chamfers come from the family rule unless I name an extra one
out.studs = built.studs;
module.exports = out;

