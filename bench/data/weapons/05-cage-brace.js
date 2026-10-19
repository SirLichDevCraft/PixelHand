// Cage brace - exaggerates WALL THICKNESS: walls so thick that the open space inside them is the exception rather than the point: a frame built to be leaned on.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "cage_brace";   // how this member is named by the family report
kit.name = "Cage brace";
kit.exaggerates = "wall thickness";   // unique across the ten: family_audit refuses a duplicate claim
kit.note = "iron walls four cells thick around a single bar, so the frame reads as load bearing rather than as a cage";
kit.accentNote = "a brass plate set into the one open pocket those thick walls leave";
kit.axis = 11;   // drawn about its own axis, like every other member in this family
kit.pollW = 9;
kit.pollH = 3;
kit.pollY = 5;
kit.collarW = 7;
kit.bodyY = 9;
kit.bodyH = 14;
kit.bodyT = 4;
kit.bodyW = 13;
kit.barRows = [12];
kit.barH = 3;
kit.wrapW = 9;
kit.bolts = 2;
kit.emblemY = 16;
kit.emblemW = 3;
kit.emblemH = 2;
module.exports = A.member(kit);

