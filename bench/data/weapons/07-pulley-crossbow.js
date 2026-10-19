// Pulley crossbow - exaggerates WINCH BULK: a housing far larger than the draw it is rated for.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.id = "pulley_crossbow";
kit.name = "Pulley crossbow";
kit.exaggerates = "winch bulk";   // unique across the ten members
kit.note = "a frame nineteen cells wide around a winch that needs half of it"
kit.accentNote = "a brass drum plate set into the open pocket behind its bars"
kit.axis = 11;   // drawn about its own axis, like every other member
kit.pollW = 9;
kit.pollH = 3;
kit.pollY = 4;
kit.collarW = 9;   // the shoulder collar under such a housing has to be this substantial
kit.bodyY = 8;
kit.bodyH = 15;   // THE exaggeration: depth this extreme on a hand weapon is deliberate over-build
kit.bodyW = 19;   // ...and width this extreme, which crowds the canvas on both sides
kit.bodyT = 3;   // walls thick enough that the housing reads as built rather than as a shell
kit.barRows = [11, 16];   // two bars inside it, so the bulk is visibly a frame and not a slab
kit.barH = 3;
kit.emblemY = 14;   // where its focal plate sits: in the pocket between those bars
module.exports = A.member(kit);

