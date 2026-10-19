# Rowan - woodland pathfinder

An original 32 x 40 pixel-art hero built with PixelHand. Rowan has eight separately authored facings and a four-pose walk cycle. The rig projects arm motion along each facing, keeps the sword with the hand, layers far limbs behind the torso, and selects opposing planted/swing leg cels while keeping each hip pinned. It includes 64 base part cels plus 48 authored leg-pose cels.

Run `node bench/showcase-hero.js` from the repository root to rebuild the project and previews.

## Previews

- `preview/rowan-down.png` - clean enlarged portrait
- `preview/walk-contact.png` - all 32 frames, arranged by facing and pose
- `preview/walk-silhouettes.png` - silhouette review sheet
- `preview/walk-all-directions.gif` - all eight facings in one animation
- `preview/walk-{direction}.gif` - one looping GIF for each facing
- `preview/showcase.json` - frame timing, audit, and gate reports

The 8 x 4 walk passes `loop_validate` in every facing: at most 1 px foot spread, no limb collisions, and a 0.4 s cycle at 10 fps. The motion report finds meaningful changes in both arms and legs, with alternating pose-specific leg shapes. The stricter export gate still refuses the draft for lighting consistency, flat material patches, and stray-pixel findings. Those are retained in `preview/showcase.json`; this is a rendered, reviewable character draft, not a claim that every art-quality gate passes.
