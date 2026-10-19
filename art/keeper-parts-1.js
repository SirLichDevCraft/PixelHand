// Authored parts, part 1 of 2: DOWN and RIGHT. (Revision 4 — whole-figure authoring.)
//
// One continuous body cel per facing: hood, head, scarf, shoulders and coat are one form, so
// the silhouette is unbroken and the light models across what used to be part seams. Only the
// boots and the lantern arm are separate, because only they move.
//
// Proportions (measured, not eyeballed): the figure is 27px tall and the hood is 9px of it.
// An earlier pass gave the head 12 of 27 and it read as a bobble-headed action figure.
//
// Outline discipline (selective-dark, dark scene): the lit top-left edge carries NO outline —
// the coat.4 rim separates the figure from a dark background by itself. Outline appears on the
// shadow side and under overhangs, where separation actually needs it.
//
// Light: key from the top-left. The lantern is a second source, so the coat's lower-right lifts
// back up toward coat.3 near the flame. Two sources, one asset.
//
// Coat structure, left to right: lit rim | lit panel with short staggered folds | the lit edge of
// the overlapping front flap | the opening seam (deepest value in the coat) | mid panel | lantern
// bounce | the arm's cast shadow | the deep pocket the sleeve hangs in | outline. The waist steps
// in 1px for five rows and the hem flares back out: a straight side is a brick.
//
// Occlusion is authored, not assumed. An earlier pass put the coat's modelling at columns 15-17
// and the sleeve at 14-18, so every interesting coat pixel was hidden behind the arm and the
// scarf lost two thirds of its mass. The modelling now lives where it is actually visible.
"use strict";

const PARTS = {
  // ---- DOWN: facing the camera. 19 wide x 24 tall, placed at (1,4).
  "down/body": `
.....LLLCcDO.......
....OLLLCCCcDO.....
...OLLLCCcccDO.....
..OLLLCNNNNNNcDO...
..OLLLSSSssKKcDO...
..OLLLSNNsNNKcDO...
..OLLLSShHHKKcDO...
..OLLLSHHhHHKcDO...
..OLLLsHHHHHscDO...
.OLLLCCRWWWRrrcDO..
LLLLCCCRWWWrrccDDDO
LLCcccCDdccccDdddDO
LLcDccCDdccccDdddDO
LLcDccCDdccccDdddDO
LLcDccCDdccccDdddDO
.LCcccCDdccccDdddDO
.LCcDcCDdccccDdddDO
.LCcDcCDdccccDdddDO
.LCcDcCDdccccDdddDO
.LCCccCDdccccDdddDO
LCCDccCDdccCcDdddDO
LCCDccCDdccCcDdddDO
LCCDccCDdccDccdddDO
LCCCC.CDdccDccdddDO`,

  // Near sleeve + hand. Its top row deliberately matches the shoulder row it lands on: a sleeve
  // whose first row is three ramp steps above the coat behind it reads as a pasted-on wedge.
  // Lit down its left edge, outlined on its right, hanging in the deepest pocket of the coat.
  "down/armNear": `
OCCC.
OLCCD
OLCcO
OLCcO
OLCcO
OLCcs
OSSSK
OSSSO`,

  // Boots: instep, upper, sole, then the ground's contact shadow. The sole is the darkest row and
  // the contact shadow is narrower than the boot: a contact shadow as wide as the object that
  // casts it is what makes a character look like it is floating in a puddle.
  "down/legNear": `
.UUUU.
.UU...
bBBBBb
..tt..`,

  "down/legFar": `
.Bbb..
.B....
bbbbb.
..t...`,

  // The lantern: handle with air under it, a cap wider than the body, glass with a flame core
  // broken by the brass centre bar, and a base. The exaggerated feature and the focal accent:
  // the air under the handle is what makes it read as something being held, not a glowing blob.
  "down/lantern": `
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
