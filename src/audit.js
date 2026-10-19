// The audit layer: mechanical rules with coordinates. Its whole purpose is to spend
// human and model attention on form and light by catching the two hundred small errors itself.
"use strict";

const { components, silhouetteOf } = require("./core/style.js");
const craft = require("./craft.js");

const RULES = [];
const HARD_RULES = new Set(["unauthorised_colour", "palette_magnitude", "region_out_of_bounds", "empty_cel", "audit_rule_failed"]);
const rule = (id, severity, describe) => RULES.push({ id, severity, describe });

// A finding that only says "wrong" costs a round trip. A finding that says which pixel and
// what to do with it is fixed without re-looking at the render.
const fix = (text) => ({ fix: text });

// ---- silhouette / structure ----------------------------------------------------

rule("lone_pixel", "error", (cel, ctx) => {
  const counts = cel.counts();
  const ACCENT_ROLES = new Set(["accent", "detail", "light", "outline"]);
  const hits = [];
  for (const [i, n] of counts) {
    if (n !== 1) continue;
    if (ACCENT_ROLES.has(ctx.palette?.entries[i]?.role)) continue;
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) if (cel.get(x, y) === i) hits.push({ x, y, index: i });
  }
  if (!hits.length) return null;
  return { count: hits.length, at: hits.slice(0, 16), ...fix("delete each lone pixel, or give it a neighbour of the same ramp step"),
    message: `${hits.length} lone pixel(s): a colour used exactly once reads as dirt, not detail. Merge it into a cluster or delete it.` };
});

rule("detached_speck", "error", (cel) => {
  const comps = components(silhouetteOf(cel), cel.w, cel.h);
  const specks = comps.filter(c => c.n <= 2);
  if (!specks.length) return null;
  const at = specks.flatMap(c => c.cells.map(p => ({ x: p % cel.w, y: (p - p % cel.w) / cel.w }))).slice(0, 16);
  return { count: specks.length, at, message: `${specks.length} disconnected speck(s) of 1-2 px — the silhouette is not one continuous shape.` };
});

// detached_speck only looked at 1-2 px specks, so a whole detached limb - 24 pixels of leg floating
// six rows below a torso that ends at row 19 - audited clean. It was caught by reading the composed
// frame, which is exactly the expensive attention this layer is supposed to spend elsewhere.
// Anything bigger than a speck that is not 4-connected to the main mass is a refusal.
rule("disconnected_mass", "error", (cel, ctx) => {
  const comps = components(silhouetteOf(cel), cel.w, cel.h).filter(c => c.n > 2).sort((a, b) => b.n - a.n);
  if (comps.length <= 1) return null;
  if (ctx.allow_disconnected) return null;
  const w = cel.w;
  const orphans = comps.slice(1);
  const at = orphans.flatMap(c => c.cells.map(p => ({ x: p % w, y: (p - p % w) / w }))).slice(0, 16);
  return {
    count: orphans.length, at,
    ...fix(`join each listed mass to the main silhouette, or delete it; a piece that only touches the figure diagonally is not attached`),
    message: `${orphans.length} disconnected mass(es) of >2px (${orphans.map(c => c.n + "px").join(", ")}) not 4-connected to the ${comps[0].n}px main silhouette — a limb, or an object, that floats`,
  };
});

rule("enclosed_void", "warn", (cel) => {
  const w = cel.w, h = cel.h, solid = silhouetteOf(cel);
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if ((y===0||y===h-1||x===0||x===w-1) && !solid[y*w+x]) stack.push(y*w+x);
  while (stack.length) {
    const p = stack.pop(); if (outside[p]) continue; outside[p] = 1;
    const px = p % w, py = (p - px) / w;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=px+dx, ny=py+dy; if (nx<0||ny<0||nx>=w||ny>=h) continue;
      const q = ny*w+nx; if (!solid[q] && !outside[q]) stack.push(q);
    }
  }
  const holes = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid[y*w+x] && !outside[y*w+x]) holes.push({ x, y });
  if (!holes.length) return null;
  const tiny = holes.filter(p => {
    // a 1x1 or 1x2 enclosed void is almost certainly an accident; a deliberate hole is bigger
    const seen = new Set([p.y*w+p.x]); let n = 0; const st = [p.y*w+p.x];
    while (st.length) { const q = st.pop(); n++; const qx=q%w, qy=(q-qx)/w;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx=qx+dx, ny=qy+dy; if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const r=ny*w+nx; if(!solid[r] && !seen.has(r) && !outside[r]) { seen.add(r); st.push(r); } } }
    return n <= 2;
  });
  if (!tiny.length) return null;
  return { count: tiny.length, at: tiny.slice(0, 12), message: `${tiny.length} tiny enclosed void(s) (1-2 px). If this is a deliberate hole, make it big enough to read.` };
});

rule("staircase_edge", "warn", (cel) => {
  // a diagonal edge built entirely of 1px steps reads as a jaggy
  const solid = silhouetteOf(cel);
  let jags = 0; const at = [];
  for (let y = 1; y < cel.h; y++) for (let x = 1; x < cel.w; x++) {
    const a = solid[y*cel.w+x], b = solid[(y-1)*cel.w+x-1];
    const c = solid[(y-1)*cel.w+x], d = solid[y*cel.w+x-1];
    if (a && b && !c && !d) { jags++; if (at.length < 12) at.push({ x, y }); }
  }
  if (jags < 3) return null;
  return { count: jags, at, message: `${jags} single-pixel staircase corner(s). A 1px step on a diagonal reads as a jag; thicken the slope or flatten it.` };
});

// ---- palette / shading --------------------------------------------------------

rule("off_ramp_colour", "warn", (cel, ctx) => {
  const { palette } = ctx; if (!palette) return null;
  const hits = [];
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const i = cel.get(x, y); if (i < 0) continue;
    const e = palette.entries[i];
    if (e.role === "outline" || e.role === "accent" || e.role === "light" || e.role === "detail") continue;
    if (!e.ramp) continue;
    let sameRampNeighbour = false, materialNeighbour = false;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const j = cel.get(x+dx, y+dy); if (j < 0) continue;
      const f = palette.entries[j];
      if (f.ramp && f.ramp === e.ramp) { sameRampNeighbour = true; break; }
      // an outline neighbour is a deliberate edge, not a stranding: a lit rim touching the
      // outline is correct craft and must not be flagged
      if (f.role !== "outline") materialNeighbour = true;
    }
    if (materialNeighbour && !sameRampNeighbour) {
      if (hits.length < 16) hits.push({ x, y, index: i, colour: e.name });
    }
  }
  if (!hits.length) return null;
  return { count: hits.length, at: hits, ...fix("re-pick each pixel to a step of its own ramp that touches a pixel of that ramp"),
    message: `${hits.length} material pixel(s) touch no pixel of their own ramp — the colour is stranded, which reads as muddiness.` };
});

rule("ramp_jump", "error", (cel, ctx) => {
  const { palette } = ctx; if (!palette) return null;
  const at = []; let n = 0, dbl = 0, adj = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const a = cel.get(x, y); if (a < 0) continue;
    const ea = palette.entries[a]; if (!ea.ramp) continue;
    for (const [dx,dy] of [[1,0],[0,1]]) {
      const b = cel.get(x+dx, y+dy); if (b < 0) continue;
      const eb = palette.entries[b]; if (!eb.ramp || eb.ramp !== ea.ramp) continue;
      adj++;
      const d = Math.abs(ea.step - eb.step);
      if (d >= 3) { n++; if (at.length < 12) at.push({ x, y, from: ea.name, to: eb.name }); }
      else if (d === 2) dbl++;
    }
  }
  if (n) return { count: n, at, ...fix("insert the intermediate ramp step between each pair, or move to a neighbouring step"),
    message: `${n} adjacent same-material pair(s) skip 3+ ramp steps.` };
  if (adj && dbl / adj > 0.35) return { severity_override: "warn", count: dbl, message: `${Math.round(dbl/adj*100)}% of same-material adjacencies skip a step: the form is striped.` };
  return null;
});

// "Muddy" has a specific signature: a colour from one material used as an interpolated seam
// between two pixels of a *different* material. That is what makes materials bleed.
rule("cross_material_aa", "error", (cel, ctx) => {
  const { palette } = ctx; if (!palette) return null;
  const at = []; let n = 0;
  const rampOf = (i) => (i >= 0 ? palette.entries[i]?.ramp : null);
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const m = cel.get(x, y); if (m < 0) continue;
    const rm = rampOf(m); if (!rm) continue;
    for (const [ax, ay, bx, by] of [[-1,0,1,0],[0,-1,0,1]]) {
      const a = cel.get(x+ax, y+ay), b = cel.get(x+bx, y+by);
      if (a < 0 || b < 0) continue;
      const ra = rampOf(a), rb = rampOf(b);
      if (!ra || ra !== rb) continue;               // neighbours must be one material
      if (ra === rm) continue;                      // and this pixel must be a different one
      const em = palette.entries[m], ea = palette.entries[a];
      if (em.role === "outline" || em.role === "light" || em.role === "detail") continue;
      // a genuine seam-smear sits BETWEEN its neighbours in value
      const vb = palette.entries[b].value, vm = em.value, va = ea.value;
      if (!(Math.min(va, vb) <= vm && vm <= Math.max(va, vb))) continue;
      if (Math.abs(vm - va) > 0.30) continue;
      n++; if (at.length < 12) at.push({ x, y, seam: em.name, between: ea.name });
    }
  }
  if (!n) return null;
  return { count: n, at, message: `${n} pixel(s) of one material sit between two pixels of another — that is anti-aliasing across a material boundary, and it is what reads as muddiness.` };
});

// Two materials whose boundary is less than a value step apart disappear at game scale.
rule("boundary_invisible", "warn", (cel, ctx) => {
  const { palette } = ctx; if (!palette) return null;
  const at = []; let n = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    const a = cel.get(x, y); if (a < 0) continue;
    const ea = palette.entries[a];
    for (const [dx,dy] of [[1,0],[0,1]]) {
      const b = cel.get(x+dx, y+dy); if (b < 0) continue;
      const eb = palette.entries[b];
      if (a === b) continue;
      if (ea.role === "outline" || eb.role === "outline") continue;
      if (ea.ramp && ea.ramp === eb.ramp) continue;      // inside one material a soft seam is shading, not a lost part
      // A contact shadow is *supposed* to sit close to the value of the object casting it; that
      // is what makes it a shadow instead of a hole. Grounding is measured separately by
      // craft.contactGrounding, so exempting it here does not leave grounding unmeasured.
      if (ea.role === "shadow" || eb.role === "shadow") continue;
      const sep = craft.separation(ea.rgb, eb.rgb);
      if (!sep.separable) { n++; if (at.length < 12) at.push({ x, y, a: ea.name, b: eb.name, valueGap: +sep.dv.toFixed(3), hueGap: Math.round(sep.dh) }); }
    }
  }
  if (n < 4) return null;
  return { count: n, at, ...fix("separate those two parts with a value step, an outline pixel, or a darker seam"),
    message: `${n} boundary pair(s) between different materials are inseparable: too close in value, and either the same hue or too desaturated for hue to carry the boundary — at game scale those parts fuse.` };
});

rule("dither_detected", "warn", (cel, ctx) => {
  // A single checkerboard is texture. Two or more adjacent checkerboard cells is a dither
  // pattern, which is what actually reads as noise on a silhouette or a face.
  const grid = [];
  for (let y = 0; y + 1 < cel.h; y++) {
    const row = [];
    for (let x = 0; x + 1 < cel.w; x++) {
      const a = cel.get(x, y), b = cel.get(x+1, y+1), c = cel.get(x+1, y), d = cel.get(x, y+1);
      row.push(a >= 0 && b === a && c >= 0 && d === a && c !== a ? 1 : 0);
    }
    grid.push(row);
  }
  const at = []; let runs = 0;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    if (!grid[y][x]) continue;
    const horiz = x + 1 < grid[y].length && grid[y][x+1];
    const vert = y + 1 < grid.length && grid[y+1][x];
    if (horiz || vert) { runs++; if (at.length < 10) at.push({ x, y }); }
  }
  if (!runs) return null;
  if (ctx.style?.detail === "dense-grain") return { severity_override: "info", count: runs, at, message: "dither present and permitted by the coordinate" };
  return { count: runs, at, message: `${runs} connected dither cell(s) found while the coordinate declares detail='${ctx.style?.detail}'. Dither on a silhouette or a face reads as noise.` };
});

rule("unauthorised_colour", "error", (cel, ctx) => {
  const { palette } = ctx; if (!palette) return null;
  const bad = [...cel.counts().keys()].filter(i => !palette.has(i));
  if (!bad.length) return null;
  return { colours: bad, message: `indices ${bad.join(",")} are not in palette '${palette.id}'. The cel cannot contain a colour the bible did not authorise.` };
});

rule("palette_magnitude", "error", (cel, ctx) => {
  const cap = ctx.style?.palette_size; if (!cap) return null;
  const used = cel.counts().size;
  if (used <= cap) return null;
  return { used, cap, message: `uses ${used} colours; coordinate caps at ${cap}.` };
});

// ---- geometry / scoping -------------------------------------------------------

rule("region_out_of_bounds", "error", (cel, ctx) => {
  const bad = (ctx.requests || []).filter(r => r.outOfBounds);
  if (!bad.length) return null;
  return { count: bad.length, at: bad.slice(0, 12), message: `${bad.length} edit(s) targeted pixels outside the cel. They were dropped, not applied.` };
});

rule("edit_noop", "warn", (cel, ctx) => {
  const noop = (ctx.requests || []).filter(r => r.changed === false);
  if (!noop.length) return null;
  return { count: noop.length, at: noop.slice(0, 12), message: `${noop.length} edit(s) wrote a colour the pixel already had. Usually means the wrong palette index was intended.` };
});

rule("scoping_collided", "error", (cel, ctx) => {
  const c = (ctx.requests || []).filter(r => r.collided);
  if (!c.length) return null;
  return { count: c.length, at: c.slice(0, 12), message: `${c.length} edit(s) landed on a region owned by a different part. The part boundary was respected; the edit was rejected.` };
});

rule("empty_cel", "error", (cel) => {
  if (cel.bbox()) return null;
  return { message: "cel contains no pixels at all." };
});

rule("bbox_jitter", "warn", (cel, ctx) => {
  const prev = ctx.previousBbox; if (!prev) return null;
  const bb = cel.bbox(); if (!bb) return null;
  const dx = bb.x0 - prev.x0, dy = bb.y0 - prev.y0;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null;
  return { dx, dy, message: `silhouette bounding box moved (${dx},${dy}) between frames. A body does not teleport; this reads as jitter.` };
});

// ---- craft layer: the rules that catch "correct but lifeless" ------------------
// These exist because the mechanical rules above are necessary and not sufficient.
// A cel can pass every rule above and still be a flat, unlit, ungrounded blob.

rule("flat_mass", "error", (cel, ctx) => {
  if (ctx.style?.shading === "flat" || ctx.style?.shading === "unlit") return null;
  const f = craft.formModelling(cel, ctx.palette);
  if (!f.flat.length) return null;
  return { count: f.flat.length, at: f.flat.map(x => ({ material: x.material, area: x.area, stepsUsed: x.stepsUsed, available: x.available, at: x.at[0] })),
    ...fix("model each listed region with at least 3 ramp steps across its area, following the declared light direction"),
    message: `${f.flat.length} large flat fill(s): ` + f.flat.map(x => `'${x.material}' ${x.area}px in ${x.stepsUsed.length}/${x.available} steps`).join("; ") +
      ` — a mass this size painted in one or two values is filled, not modelled` };
});

rule("light_direction", "error", (cel, ctx) => {
  const l = craft.lightCoherence(cel, ctx.palette, ctx.light ?? [-0.7, -0.7]);
  const bad = l.offenders.filter(o => o.reason.includes("opposite side"));
  const off = l.offenders.filter(o => !o.reason.includes("opposite side"));
  if (!bad.length && !off.length) return null;
  // A derived facing is a mirror of an authored one, and a mirror mirrors the light with the shape.
  // The shading inside that facing is internally consistent; it is the facing set that is short.
  // Calling that a drawing error sends me off to repaint pixels that are already right.
  const mirrored = cel.meta?.mirroredFacing;
  if (mirrored) {
    return { severity_override: "warn", count: l.offenders.length, checked: l.checked, agreed: l.agreed,
      at: l.offenders.slice(0, 8), ...fix(`author '${cel.meta.direction}' as its own facing instead of deriving it from ${cel.meta.mirroredFrom}; a mirror cannot keep a fixed scene key light`),
      message: `${l.offenders.length}/${l.checked} modelled region(s) disagree with the scene key light because '${cel.meta.direction}' is derived by mirroring ${cel.meta.mirroredFrom} — the shading is internally consistent, the facing set is short` };
  }
  return { severity_override: bad.length ? "error" : "warn", count: l.offenders.length, checked: l.checked, agreed: l.agreed,
    at: l.offenders.slice(0, 8), ...fix("move the lit steps of each listed region toward the light side of that region"),
    message: `${l.offenders.length}/${l.checked} modelled region(s) disagree with the declared light direction (${(ctx.light || [-0.7, -0.7]).join(",")}): ` +
      l.offenders.slice(0, 4).map(o => `'${o.material}' ${o.reason}`).join("; ") };
});

rule("value_structure", "warn", (cel, ctx) => {
  const v = craft.valueStructure(cel, ctx.palette, ctx);
  if (v.score >= 0.55) return null;
  return { severity_override: v.score < 0.35 ? "error" : "warn", ...v,
    ...fix("widen the luminance range: the darkest third and the brightest third of the sprite must both be present"),
    message: `value spread ${v.range} (p10 ${v.p10} → p90 ${v.p90}, sd ${v.sd}, dark share ${v.darkShare}, lit share ${v.litShare}) — the sprite sits in one narrow band and will not read at distance` };
});

rule("blob_silhouette", "warn", (cel) => {
  const b = craft.blobIndex(cel);
  if (b.fill < 0.80 || b.score > 0.55) return null;
  return { ...b, ...fix("break the outline: a hem, a limb, a strap or negative air inside the bounding box"),
    message: `silhouette fills ${(b.fill*100).toFixed(0)}% of its own ${b.box[0]}x${b.box[1]} bounding box with ${b.rowWidthVariety} distinct row widths — that is a brick, not a shape` };
});

rule("outline_discipline", "warn", (cel, ctx) => {
  const o = craft.outlineUsage(cel, ctx.palette);
  const policy = ctx.style?.edge_policy;
  if (!o.boundary || o.ratio === 0) return null;
  if (policy === "full-1px") return null;
  if (o.ratio < 0.86) return null;
  return { ...o, ...fix("remove outline from the lit side and from interior boundaries; keep it where the silhouette meets the background"),
    message: `${(o.ratio*100).toFixed(0)}% of the silhouette boundary is outline while the coordinate declares '${policy}' — a full outline replaces modelling with a border and flattens the form` };
});

rule("no_contact_ground", "warn", (cel, ctx) => {
  const g = craft.contactGrounding(cel, ctx.palette);
  if (g.present) return null;
  return { ...g, ...fix("put the darkest value of the sprite at the feet, 1-2px wide beyond the contact edge"),
    message: `nothing at the feet is darker than the body (foot ${g.bottomLuma} vs body ${g.bodyMean}) — the asset floats like a sticker instead of standing on the ground` };
});

rule("no_focal_accent", "warn", (cel, ctx) => {
  const f = craft.focalAccent(cel, ctx.palette);
  if (f.score >= 0.5) return null;
  return { severity_override: f.score < 0.25 ? "error" : "warn", ...f,
    ...fix("build one accent cluster of >=6 px at the identifying detail; keep every other accent cluster smaller"),
    message: f.message || `focal hierarchy ${f.score}: largest accent cluster ${f.largest}px of ${f.totalAccent} accent px across ${f.clusters} cluster(s) — nothing is declared as the thing the eye should land on` };
});

rule("parts_fuse", "warn", (cel, ctx) => {
  const s = craft.partSeparation(cel, ctx.palette);
  if (s.score > 0.86) return null;
  return { ...s, ...fix("for each listed pair, insert a darker seam or a value step between the two materials"),
    message: `${s.mergedCount}/${s.pairs} material boundaries are under 0.05 luminance apart — those parts read as one mass` };
});

rule("cluster_character", "warn", (cel, ctx) => {
  const c = craft.clusterStats(cel, ctx.palette);
  if (c.score > 0.45) return null;
  return { ...c, ...fix("paint in 2-4px clusters; break slabs with a ramp step, merge lone pixels into neighbours"),
    message: `cluster profile ${c.lone} lone / ${c.mid} hand-sized (2-6px) / ${c.slab} slab(s) of >24px — hand-made art paints in clusters, generated art paints in noise and slabs` };
});

// ---- depth / perspective ------------------------------------------------------
// These rules only fire when the asset declares a camera. Depth is not a look that gets applied
// to everything: it is a claim, and a claim is only auditable once it has been written down.

rule("depth_not_drawn", "error", (cel, ctx) => {
  if (!ctx.depth?.regions?.length || !ctx.palette) return null;
  const { depthReadings, depthMonotonic } = require("./core/depth.js");
  const mono = depthMonotonic(depthReadings(cel, ctx.palette, ctx.depth.regions), { toward: ctx.depth.toward });
  if (mono.ok) return null;
  const first = mono.problems[0];
  return { ...first, at: [], severity: "error",
    ...fix(`depth_shade each declared region with its own band from depth_slice ('${first.ramp}' ramp); distance moves ALONG the ramp, never by darkening everything`),
    message: first.message };
});

// The camera speaks in SCENE rows. A structure is usually authored on its own canvas and placed into
// the scene afterwards, so the audit needs to know where it was put: without a placement there is no
// way to tell "this cel's row 53" from "the street's row 173". Missing placement is reported instead
// of skipped silently.
rule("structure_floats", "error", (cel, ctx) => {
  const p = ctx.perspective;
  if (!p) return null;
  const bb = cel.bbox();
  if (!bb) return null;
  const place = ctx.place ?? cel.meta?.place ?? null;
  if (!place) return {
    at: [{ x: bb.x0, y: bb.y1 }], severity_override: "warn",
    ...fix(`pass place:[x,y] (or set meta.place on the sprite) so the audit can compare this cel's rows against the camera's horizon`),
    message: `a camera is declared but this cel does not say where it sits in the scene, so its ground contact cannot be checked`,
  };
  const horizon = p.horizon - place[1];
  if (bb.y1 <= horizon) return {
    at: [{ x: bb.x0, y: bb.y1 }],
    ...fix(`move the base below local row ${horizon} (scene row ${p.horizon}), or re-declare the horizon: a structure cannot meet the ground above the viewer's eye level`),
    message: `the lowest pixel of this structure is local row ${bb.y1} (scene row ${bb.y1 + place[1]}), at or above the declared horizon row ${p.horizon}: nothing below eye level touches the ground above the horizon`,
  };
  return null;
});

rule("faces_disobey_the_light", "error", (cel, ctx) => {
  if (!ctx.faces?.recipe || !ctx.palette) return null;
  const { faceAudit } = require("./core/depth.js");
  const r = faceAudit(cel, ctx.palette, ctx.faces.recipe);
  if (r.ok) return null;
  const bad = [...r.problems, ...r.seams];
  const first = bad[0];
  return {
    rule: first.rule, at: first.at ? [first.at] : [], severity: "error",
    ...fix(`face_shade with the declared recipe: each face paints inside the band its orientation earned, across the face's own extent`),
    message: bad.map(b => b.message).join(" | "),
  };
});

rule("edges_do_not_converge", "error", (cel, ctx) => {
  if (!ctx.perspective || !ctx.edges?.length) return null;
  const { convergenceAudit, localCamera } = require("./core/depth.js");
  const r = convergenceAudit(cel, localCamera(ctx.perspective, ctx.place ?? cel.meta?.place ?? null), ctx.edges);
  if (r.ok) return null;
  const bad = r.edges.filter(e => e.verdict !== "converges");
  return {
    at: [], count: bad.length,
    ...fix(`redraw each listed edge so that, extended, it meets the vanishing point (${ctx.perspective.vanishing.join(",")}); or re-declare the projection as parallel and stop claiming perspective`),
    message: bad.map(e => `'${e.edge}' ${e.verdict}: ${e.message}`).join(" | "),
  };
});

function audit(cel, ctx = {}) {
  const findings = [];
  const policy = ctx.style?.audit_policy || {};
  for (const r of RULES) {
    let f = null;
    try { f = r.describe(cel, ctx); } catch (e) { findings.push({ rule: "audit_rule_failed", severity: "error", category: "mechanical", message: `${r.id}: ${e.message}` }); continue; }
    if (!f) continue;
    const setting = policy[r.id];
    if (setting && !["error", "warn", "off"].includes(setting)) { findings.push({ rule: "audit_rule_failed", severity: "error", category: "mechanical", message: `Invalid policy for ${r.id}` }); continue; }
    if (setting === "off" && !HARD_RULES.has(r.id)) continue;
    const severity = HARD_RULES.has(r.id) ? "error" : setting || f.severity_override || r.severity;
    findings.push({ rule: r.id, ...f, severity, category: HARD_RULES.has(r.id) ? "mechanical" : "style" });
  }
  const craft_ = ctx.palette ? craft.craftScore(cel, ctx.palette, ctx) : null;
  const errors = findings.filter(f => f.severity === "error").length;
  const warns = findings.filter(f => f.severity === "warn").length;
  const hardErrors = findings.filter(f => f.category === "mechanical" && f.severity === "error");
  return { ok: errors === 0, errors, warns, findings, craft: craft_, mechanical: { ok: hardErrors.length === 0, errors: hardErrors.length, findings: hardErrors },
    summary: `${cel.name}: ${errors} error / ${warns} warn` + (craft_ ? ` | craft ${craft_.score} (${craft_.grade}) weakest: ${craft_.weakest.join(", ")}` : "") };
}

/** Compact human/agent-readable rendering of an audit. One line per finding, coordinates first. */
function formatAudit(result, opts = {}) {
  const out = [result.summary];
  if (result.craft) out.push(`  craft sub-scores: ` + Object.entries(result.craft.sub).map(([k, v]) => `${k}=${Math.round(v * 100)}`).join(" "));
  for (const f of result.findings.slice(0, opts.max || 24)) {
    const where = f.at && f.at.length ? ` @ ${f.at.slice(0, 6).map(p => p.x === undefined ? p.material : `${p.x},${p.y}`).join(" ")}` : "";
    out.push(`  [${f.severity}] ${f.rule}${where}: ${f.message}`);
    if (f.fix) out.push(`      fix: ${f.fix}`);
  }
  if (result.findings.length > (opts.max || 24)) out.push(`  ... ${result.findings.length - (opts.max || 24)} more`);
  return out.join("\n");
}

module.exports = { audit, formatAudit, RULES };
