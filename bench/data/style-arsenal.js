// The Phase 4 coordinate: hand-held mechanisms drawn upright on a plate for review and for the sheet.
//
// WHY THIS CELL AND NOT THE STREET'S. bench/gate6-scene.js declares perspective-1pt at art_scale 128 because
// its subject is a street seen from the middle of it; the engine refuses perspective on a small subject (it is
// one of the Phase-6 refusal cases). A weapon is drawn at arm's length in flat side view, so this family sits
// on a different cell of the same space: art_scale 32 - the size an object that fills a two-handed grip
// actually gets - with projection 'side'. What IS shared with the street is the light convention (the same dusk
// vector) and the brass accent colour, so an arsenal asset placed in the dusk street reads as lit by the same
// lamp. That continuity is deliberate; the differing cells are recorded here rather than hidden behind reuse.
"use strict";

const STYLE = {
  id: "arsenal-plate", projection: "side", art_scale: 32, palette_size: 24,
  temperature: "complementary-shadow", edge_policy: "selective-dark", shading: "ramp-lit",
  detail: "moderate", motion: "static", mood: "menacing", light_vector: [-0.6, -0.6, 0.5],
  signature: "machined iron under a low dusk sun, every joint visible as a change of metal",
};

// Hand-mixed ramp recipes (docs/02). Iron and gunmetal are the two metals this family joints with; the gap in
// value between them is what makes a collar readable without an outline. Leather sits warm against both so the
// grip reads as organic wrapping on a machined body, and ember is reserved for heated edges only.
const PALETTE_SPEC = {
  ramps: {
    iron:     { role: "material", base: "#6d7f9a", steps: 5, value: [0.245, 0.625], hueShift: 12, satCurve: [0.95, 0.72] },
    gunmetal: { role: "material", base: "#3b4553", steps: 4, value: [0.115, 0.365], hueShift: 4, satCurve: [0.6, 0.45] },
    leather:  { role: "material", base: "#6b4a2e", steps: 4, value: [0.195, 0.485], hueShift: 12, satCurve: [1.0, 0.8] },
    ember:   { role: "light", base: "#d9712a", steps: 3, value: [0.465, 0.875], hueShift: 10 },
    brass:   { role: "accent", relight: false, base: "#cf9a2c", steps: 3, value: [0.315, 0.635], hueShift: 10 },
  },
  single: {
    outline: { rgb: "#05060a", role: "outline" },
    contact: { rgb: "#120e1c", role: "shadow" },
    sheen:   { rgb: "#a9c6d8", role: "specular" },
  },
};

module.exports = { STYLE, PALETTE_SPEC };
