// Authored parts, part 2 of 2: RIGHT (profile) and UP (back).
//
// The profile is genuinely narrower than the front: 15 columns against 19. A sprite that keeps
// the same width in every facing is a card, not a body seen in space. The sleeve is narrower too
// (4 columns against 5) for the same reason.
//
// In profile the face opening is 5 columns instead of 7 and sits on the leading side; the coat's
// front flap and opening seam move to the leading side; the legs split into a forward leg and a
// trailing leg instead of a pair side by side.
//
// From behind there is no face to read, so identity has to come from shape and light alone: the
// hood's rounded crown, hair peeking under it at the nape, the nape shadow band, the spine seam
// running down the middle of the coat, and the lantern still on the same side.
"use strict";

const PARTS = {
  // ---- RIGHT: profile, 15 wide x 24 tall, placed at (3,4).
  "right/body": `
....LLLCcDO....
...OLLLCCcDO...
..OLLLCCCccDO..
.OLLLCNNNNNcDO.
.OLLLCNSSsKcDO.
.OLLLCNSNNKcDO.
.OLLLCNSShKcDO.
.OLLLCNSHHKcDO.
.OLLLCNsHhccDO.
.OLLLCRWWWrrDO.
LLLLCCCcccccDDO
LLCcCcccccCDcDO
LLCcDcccccCDcDO
LLCcccccCCCDcDO
LLCcDcdddCCDcDO
.LCcCcdddCCDcDO
.LCcccdddCCDcDO
.LCcDcdddCCDcDO
.LCccDdddCCDcDO
.LCCcDdddCCDcDO
LCCcCcdddCCccDO
LCCcccdddCCccDO
LCCcccdddCcDcDO
LCCCc.dddcDccDO`,

  // Profile sleeve: seen from the side a limb is foreshortened, so it is one column narrower
  // than the front sleeve and the elbow leads.
  "right/armNear": `
OCC.
OLCO
OLcO
OLcO
OLcO
OLcs
OSSK
OSSO`,

  // Profile boot: ankle, instep, toe forward, sole. The toe points where the figure is going.
  "right/legNear": `
.UUUU.
.UU...
bBBBBb
..tt..`,

  "right/legFar": `
.Bbb..
.B....
bbbbb.
..t...`,

  "right/lantern": `
...jj...
..j..j..
.OjjjjO.
Oyyyyyj.
OjYYYYj.
OjgGGgj.
OjGGGGj.
OjYYYYj.
Ojjjjjj.`,

  // ---- UP: back view, 19 wide x 24 tall, placed at (1,4).
  "up/body": `
.....LLLCcDO.......
....OLLLCCCcDO.....
...OLLLCCcccDO.....
..OLLLCCCccDcDO....
..OLLLCCCccDcDO....
..OLLLCCcccDcDO....
..OLLLCChhccDcDO...
..OLLLChhhhDcDO....
..OLLLCNNNNNcDO....
.OLLLCCRWWWRrrcDO..
LLLLCCCccDccccccDdO
LLCcccCccDccccccDdO
LLCcDcCccDccccccDdO
LCccccCccDccccccDdO
LCcDccCccDccccccDdO
.LCccDcccDccccccDcO
.LCcccDccDccccccDcO
.LCcDccccDccccccDcO
.LCccDcccDccccccDcO
.LCCcDcccDccccccDcO
LCCcDccccDccccccDcO
LCCcccCccDccccccDcO
LCCcccCccDccccccDcO
LCCCc.CccDccccccDcO`,

  // From behind you see the back of the sleeve: no lit front edge, the light rakes across the
  // shoulder and falls off down the arm.
  "up/armNear": `
OCCCc
OLCCc
OLCcO
OLCcO
OLCcO
OLCcO
OLCcO
OLCcO`,

  "up/legNear": `
.UUUU.
.UU...
bBBBBb
..tt..`,

  "up/legFar": `
.Bbb..
.B....
bbbbb.
..t...`,

  "up/lantern": `
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
