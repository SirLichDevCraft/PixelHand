// 3. Breach hammer - exaggerates HEAD MASS: a head too heavy for its shaft, answered by forging the socket that
// carries it out wide, so the weight lands along the whole weapon instead of hanging off the end of it.
"use strict";
const A = require("../arsenal.js"); const kit = {};
kit.axis = 11;
kit.pollW = 15;                                 // THE exaggeration: a breach hammer's head this wide on a hand tool
kit.pollH = 6;                                  // ...and this deep: it is a striking volume, not a plate
kit.pollY = 4;
kit.collarW = 12;                               // the collar steps in from the head but stays a machined band
kit.bodyW = 11;                                 // the socket block that carries the head's weight down the shaft
kit.bodyH = 9;                                  // ...and as deep as the head is tall, which is how it reads as an answer to it
kit.bodyT = 3;                                  // walls this thick because they are load bearing here
kit.shankW = 9;                                 // forged wide rather than narrowed: mass kept along the weapon
kit.wrapW = 9;                                  // two hands, because this one has to be swung
kit.bolts = 2;                                  // fasteners holding a heavy head onto a narrower frame
kit.barRows = [13, 16];                         // two bars inside the socket, so it reads as built rather than cast
kit.barH = 3;                                   // bars this deep because the walls around them are this thick
kit.emblemY = 6;                                // a brass plate stamped into the head itself
kit.emblemW = 3;                                // six brass cells: a larger single-value fill is refused as flat
kit.emblemH = 2;
kit.id = "breach_hammer";
kit.name = "Breach hammer";
kit.exaggerates = "head mass";                  // unique claim; family_audit checks no other member says it
kit.note = "a head too heavy for its shaft, answered by a socket forged as wide as the head is deep";
kit.accentNote = "a brass plate stamped into the face of the head";
module.exports = A.member(kit);

