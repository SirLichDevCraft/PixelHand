// Authored parts, part 3 of 3: the two 3/4 facings. Left, down-left and up-left are mirrored
// from right, down-right and up-right by the rig, so they are authored once here and never by
// hand.
//
// A 3/4 facing is not a nudge of a cardinal. It is its own width: 17 columns, between the front's
// 19 and the profile's 15. The side being turned away is compressed, the side being turned toward
// the camera keeps its full modelling, and the face opening slides toward the direction of travel.
//
// From the back-right the figure is still anonymous, but a sliver of cheek appears under the hood
// on the leading side. That single pixel is what tells you which way it has turned.
"use strict";

const PARTS = {
  // ---- DOWN-RIGHT: three-quarter front, 17 wide x 24 tall, placed at (2,4).
  "down-right/body": `
...LLLCcDO.......
..OLLLCCCcDO.....
.OLLLCCcccDO.....
OLLLCNNNNNNNcDO..
OLLLCSSSssKKcDO..
OLLLCSNNsNNKcDO..
OLLLCSShHHKKcDO..
OLLLCSHHhHHKcDO..
OLLLCsHHHHHscDO..
OLLLCCRWWWRrrcDO.
LLLCCCcccccccDDDO
LLCccCDdcccDdddDO
LLcDcCDdcccDdddDO
LLcDcCDdcccDdddDO
LLcDcCDdcccDdddDO
.LCccCDdcccDdddDO
.LCcDCDdcccDdddDO
.LCcDCDdcccDdddDO
.LCcDCDdcccDdddDO
.LCCcCDdcccDdddDO
LCDccCDdccCcDddDO
LCDccCDdccCcDddDO
LCDccCDdccDccddDO
LCCC.CDdccDccddDO`,

  "down-right/armNear": `
OCCC.
OLCCD
OLCcO
OLCcO
OLCcO
OLCcs
OSSSK
OSSSO`,

  "down-right/legNear": `
.UUUU.
.UU...
bBBBBb
..tt..`,

  "down-right/legFar": `
.Bbb..
.B....
bbbbb.
..t...`,

  "down-right/lantern": `
...jj...
..j..j..
.OjjjjO.
Oyyyyyj.
OjYYYYj.
OjgGGgj.
OjGGGGj.
OjYYYYj.
Ojjjjjj.`,

  // ---- UP-RIGHT: three-quarter back, 17 wide x 24 tall, placed at (3,4).
  "up-right/body": `
...LLLCcDO.......
..OLLLCCCcDO.....
.OLLLCCcccDO.....
OLLLCCCccDcDO....
OLLLCCCccDcDO....
OLLLCCcccDcDO....
OLLLCChhccDcDO...
OLLLChhhhDcDO....
OLLLCNNNNNscDO...
OLLLCCRWWWRrrcDO.
LLLCCCccDcccccDdO
LLCcccCcDcccccDdO
LLCcDcCcDcccccDdO
LCccccCcDcccccDdO
LCcDccCcDcccccDdO
.LCccDccDcccccDcO
.LCcccDcDcccccDcO
.LCcDcccDcccccDcO
.LCccDccDcccccDcO
.LCCcDccDcccccDcO
LCCcDcccDcccccDcO
LCCcccCcDcccccDcO
LCCcccCcDccDDcDcO
LCCCc.CcDcccccDcO`,

  "up-right/armNear": `
OCCCc
OLCCc
OLCcO
OLCcO
OLCcO
OLCcO
OLCcO
OLCcO`,

  "up-right/legNear": `
.UUUU.
.UU...
bBBBBb
..tt..`,

  "up-right/legFar": `
.Bbb..
.B....
bbbbb.
..t...`,

  "up-right/lantern": `
...jj...
..j..j..
.OjjjjO.
Oyyyyyj.
OjYYYYj.
OjgGGgj.
OjGGGGj.
OjYYYYj.
Ojjjjjj.`,
};

module.exports = { PARTS };
