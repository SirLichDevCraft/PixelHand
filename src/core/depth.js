// Depth, perspective, and the difference between them.
//
// "Add depth" in most engines means a brightness filter and a z-buffer. Neither is available here:
// the cel is palette-indexed, there is no alpha anywhere, and every operation must move a pixel
// ALONG its material's ramp rather than multiplying its colour. So depth in this engine is two
// things, both authored, both measurable:
//
//   1. GEOMETRY. A declared horizon, vanishing point, camera height and focal length. Given those,
//      the screen height of a world object is height * focal / distance. That is a number, so the
//      engine can check whether the pixels you actually placed obey it. A cel that declares
//      "perspective" and draws two bays the same height is flat, and saying so is the whole point.
//
//   2. VALUE. Distance is expressed by choosing a DIFFERENT STEP of the same material ramp for the
//      farther region - never by darkening it. A ramp has a fixed number of steps, so depth cueing
//      competes with form modelling for those steps, and the engine reports that competition instead
//      of hiding it.
//
// Everything here is a claim the audit can falsify.
"use strict";

const { TRANSPARENT } = require("./cel.js");

// ---- the geometry ---------------------------------------------------------------

class Perspective {
  /**
   * horizon: the screen row of the horizon.
   * vanishing: [x, y] - for 1-point perspective y must equal horizon.
   * focal: pixels * world units per pixel of screen height at distance 1.
   * eye: camera height in world units. A building's base sits BELOW the horizon by eye*focal/z.
   * unit: world size of one tile, so footprints can be spoken about in tiles.
   */
  constructor(id, opts = {}) {
    this.id = id;
    this.projection = opts.projection || "perspective-1pt";
    this.horizon = opts.horizon ?? null;
    this.vanishing = opts.vanishing ?? null;
    this.focal = opts.focal ?? 64;
    this.eye = opts.eye ?? 1.7;
    this.unit = opts.unit ?? 1;
    this.near = opts.near ?? 1;
    this.far = opts.far ?? 6;
    if (this.horizon == null || !this.vanishing) {
      const e = new Error("perspective needs a horizon row and a vanishing point; without them there is nothing to converge toward");
      e.rule = "perspective_underdetermined"; throw e;
    }
    if (this.projection === "perspective-1pt" && this.vanishing[1] !== this.horizon) {
      const e = new Error(`1-point perspective puts every receding parallel on the horizon: vanishing y=${this.vanishing[1]} but horizon=${this.horizon}`);
      e.rule = "vanishing_off_horizon"; throw e;
    }
    if (this.focal <= 0 || this.eye <= 0) { const e = new Error("focal and eye must both be positive"); e.rule = "perspective_invalid"; throw e; }
  }

  /** Screen distance from the horizon for a world height h at depth z. Positive is above the horizon. */
  heightAt(h, z) { return (h * this.focal) / z; }
  groundRow(z) { return this.horizon + (this.eye * this.focal) / z; }
  topRow(h, z) { return this.horizon - ((h - this.eye) * this.focal) / z; }
  screenX(x, z) { return this.vanishing[0] + (x * this.focal) / z; }
  /** Screen height of a world-height-h object at depth z. This is the number the audit checks. */
  screenHeight(h, z) { return (h * this.focal) / z; }

  /** Screen pixels per world unit at this distance. */
  scaleAt(z) { return this.focal / z; }
  /** Invert the ground plane: the contact row IS the distance. */
  zFromRow(row) {
    if (row <= this.horizon) { const e = new Error(`row ${row} is at or above the horizon ${this.horizon}: no ground plane there`); e.rule = "row_above_horizon"; throw e; }
    return (this.eye * this.focal) / (row - this.horizon);
  }
  /** World point -> screen cell. yUp is height above the ground plane. */
  project(x, yUp, z) { return { x: this.screenX(x, z), y: this.groundRow(z) - (yUp * this.focal) / z, z }; }

  /**
   * Foreshortening ratio: how much smaller the far thing must be drawn than the near thing.
   * If the art does not show roughly this ratio, the perspective is declared and not drawn.
   */
  foreshorten(zNear, zFar) {
    if (zNear <= 0 || zFar <= zNear) { const e = new Error(`need 0 < zNear(${zNear}) < zFar(${zFar})`); e.rule = "depth_band_invalid"; throw e; }
    return zNear / zFar;
  }

  bands(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.near + (this.far - this.near) * (i / Math.max(1, n - 1)));
    return out;
  }

  toManifest() {
    return { id: this.id, projection: this.projection, horizon: this.horizon, vanishing: this.vanishing, focal: this.focal, eye: this.eye, unit: this.unit, near: this.near, far: this.far };
  }
}

/**
 * Put the camera into the cel's own coordinate space.
 *
 * A structure is normally authored on its own canvas and placed into the scene later. The camera is
 * declared in SCENE rows; the pixels are in LOCAL rows. Every geometry check needs both in one space,
 * and the author should not have to pre-subtract an offset from every edge they declare.
 */
function localCamera(persp, place) {
  if (!place || !persp) return persp;
  const [dx, dy] = place;
  return new Perspective(`${persp.id}@local`, { ...persp.toManifest(),
    horizon: persp.horizon - dy, vanishing: [persp.vanishing[0] - dx, persp.vanishing[1] - dy] });
}

// ---- depth as ramp steps, never as brightness ------------------------------------

/**
 * Assign a contiguous slice of one material's ramp to the depth bands.
 * `toward` is "lighter" or "darker": which way this scene's atmosphere pulls distant things.
 * The slice is monotonic by construction, so a farther band can never end up with a nearer band's
 * value by accident - which is the single most common way generated depth fails.
 */
function depthSlice(palette, rampId, bands, toward = "lighter") {
  const list = palette.ramp(rampId);
  if (!list || list.length < 2) {
    const e = new Error(`ramp '${rampId}' has ${list ? list.length : 0} step(s); depth cueing needs at least 2 to move along`);
    e.rule = "depth_needs_ramp"; throw e;
  }
  if (bands.length > list.length) {
    const e = new Error(`${bands.length} depth bands but ramp '${rampId}' has only ${list.length} steps; two bands would share a value and read as the same distance`);
    e.rule = "depth_bands_exceed_ramp"; throw e;
  }
  const steps = list.length;
  const room = steps - bands.length;                       // steps left over for form modelling
  const span = bands.length;                               // how many distinct values depth gets
  const out = [];
  for (let i = 0; i < bands.length; i++) {
    // i=0 is the nearest band. "lighter" means distance pulls toward the top of the ramp.
    const k = toward === "lighter"
      ? Math.min(steps - 1, (room >> 1) + i)
      : Math.max(0, steps - 1 - (room >> 1) - i);
    out.push({ z: bands[i], index: list[k], step: palette.entries[list[k]].step });
  }
  return { ramp: rampId, steps, span, roomForForm: room, bands: out, toward,
    note: room === 0 ? "the ramp is fully spent on depth: no steps remain to model form within a face" : null };
}

/**
 * Re-step a region along its own material ramp according to its depth band.
 * This is the legal version of "make it recede": the index changes to another step of the SAME
 * ramp. There is no multiplication of rgb anywhere in this file.
 */
function depthShade(cel, palette, rampId, band, region) {
  const list = palette.ramp(rampId);
  if (!list) { const e = new Error(`no ramp '${rampId}' in palette '${palette.id}'`); e.rule = "no_ramp"; throw e; }
  const target = list[palette.entries[band.index].step];
  const [x0, y0, x1, y1] = region;
  let moved = 0, already = 0, offRamp = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const v = cel.get(x, y);
    if (v === TRANSPARENT) continue;
    const e = palette.entries[v];
    if (!e || e.ramp !== rampId) { offRamp++; continue; }
    if (v === target) { already++; continue; }
    cel.set(x, y, target);
    moved++;
  }
  return { ok: true, changed: { pixels: moved, added: 0, removed: 0, repainted: moved },
    region: [x0, y0, x1, y1], z: band.z, used: palette.entries[target].name,
    off_ramp_pixels: offRamp, unchanged: already,
    note: "value moved along the material's own ramp; no colour was created and nothing was multiplied" };
}

// ---- the measurable claims -------------------------------------------------------

/**
 * Do the pixels actually recede?
 *
 * The author declares the receding edges they intended (a roofline, a base line, the top of a
 * colonnade). The engine then checks two separate things, because a declaration that is never
 * checked against pixels is a wish:
 *   a) the edge is REAL - most of its sampled points are filled pixels in the cel;
 *   b) it CONVERGES - extended, it meets the declared vanishing point within a tolerance.
 */
function convergenceAudit(cel, persp, edges = [], opts = {}) {
  const tolPx = opts.tolerance ?? 2.5;
  const minCoverage = opts.coverage ?? 0.7;
  const out = [];
  for (const e of edges) {
    const [ax, ay] = e.from, [bx, by] = e.to;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 3) { out.push({ edge: e.name ?? `${ax},${ay}->${bx},${by}`, verdict: "too_short", message: "an edge under 3px cannot carry a vanishing point" }); continue; }

    let filled = 0, sampled = 0;
    for (let t = 0; t <= 1; t += 1 / Math.max(8, Math.round(len * 2))) {
      const x = Math.round(ax + dx * t), y = Math.round(ay + dy * t);
      if (!cel.inBounds(x, y)) continue;
      sampled++;
      if (cel.get(x, y) !== TRANSPARENT) filled++;
    }
    const coverage = sampled ? filled / sampled : 0;

    // Where does this line, extended, cross the horizon row?
    const [vx, vy] = persp.vanishing;
    let hitsHorizon = null, diverging = false;
    if (dy !== 0) {
      const t = (vy - ay) / dy;
      const xAtHorizon = ax + dx * t;
      hitsHorizon = xAtHorizon;
      // t < 0 means the line converges BEHIND the viewer: it is opening up, not receding.
      if (t <= 0) diverging = true;
    }
    const miss = hitsHorizon == null ? null : Math.abs(hitsHorizon - vx);
    const real = coverage >= minCoverage;
    const converges = !diverging && miss != null && miss <= tolPx;
    out.push({
      edge: e.name ?? `${ax},${ay}->${bx},${by}`,
      coverage: +coverage.toFixed(2),
      crosses_horizon_at: hitsHorizon == null ? null : +hitsHorizon.toFixed(1),
      off_vanishing_by: miss == null ? null : +miss.toFixed(1),
      verdict: !real ? "not_drawn" : diverging ? "diverging" : converges ? "converges" : "parallel",
      message: !real ? `only ${Math.round(coverage * 100)}% of this declared edge is filled pixels - the edge is declared, not drawn`
        : diverging ? "this edge widens away from the vanishing point: it recedes the wrong way"
        : converges ? `meets the horizon ${miss.toFixed(1)}px from the declared vanishing point`
        : `meets the horizon ${miss == null ? "never" : miss.toFixed(1)}px from the vanishing point (tolerance ${tolPx}px): this is a parallel projection, not perspective`,
    });
  }
  const bad = out.filter(o => o.verdict !== "converges");
  return { ok: out.length > 0 && bad.length === 0, checked: out.length, failures: bad.length, edges: out };
}

/**
 * Is value monotonic with distance?
 * Each region carries the depth band it was authored at. For one material, the mean ramp step must
 * move in ONE direction as distance increases. A nearer face ending up darker than a farther face
 * is the exact signature of depth applied by accident.
 */
function depthMonotonic(readings, opts = {}) {
  // readings: [{ z, ramp, step }]
  // `toward` is the scene's declared atmosphere: "darker" pulls distance down the ramp (clear air,
  // dusk), "lighter" pulls it up (fog, haze, aerial perspective). It used to be ignored here and
  // ANY increase counted as an inversion, which refused every foggy scene as a contradiction while
  // accepting every dusk one. The convention is now part of the measurement.
  const toward = opts.toward === "lighter" ? "lighter" : opts.toward === "darker" ? "darker" : null;
  const byRamp = new Map();
  for (const r of readings) {
    if (!byRamp.has(r.ramp)) byRamp.set(r.ramp, []);
    byRamp.get(r.ramp).push(r);
  }
  const problems = [];
  const perRamp = {};
  for (const [ramp, rs] of byRamp) {
    rs.sort((a, b) => a.z - b.z);
    const steps = rs.map(r => r.step);
    const zs = rs.map(r => r.z);
    // One reading is not a comparison. A material that only appears at one distance cannot express
    // or contradict an atmosphere, so it is reported as unmeasured rather than failed.
    if (rs.length < 2) {
      perRamp[ramp] = { direction: "unmeasured", toward: toward ?? null, steps, z: zs, inversions: 0, single_band: true };
      continue;
    }
    // Which way distance is *supposed* to move this material along its ramp. When the scene has
    // declared an atmosphere, that declaration decides; otherwise the art's own first transition
    // sets it and every later transition must agree with it.
    const wantLighter = toward ? toward === "lighter"
      : (steps.length > 1 ? steps[steps.length - 1] >= steps[0] : true);
    let inversions = 0;
    for (let i = 1; i < steps.length; i++) {
      if (wantLighter ? steps[i] < steps[i - 1] : steps[i] > steps[i - 1]) inversions++;
    }
    const direction = !steps.length || new Set(steps).size === 1 ? "none"
      : wantLighter ? "lighter-with-distance" : "darker-with-distance";
    const flat = new Set(steps).size === 1;
    perRamp[ramp] = { direction, toward: toward ?? `inferred (${direction})`, steps, z: zs, inversions };
    if (flat) problems.push({ ramp, rule: "depth_not_expressed", message: `ramp '${ramp}' uses one value at every depth: distance is claimed and not drawn` });
    else if (inversions) problems.push({ ramp, rule: "depth_contradiction", message: `${inversions} of ${steps.length - 1} transitions move against the declared atmosphere (${toward ?? direction}): ${zs.map((z, k) => `z${(+z).toFixed(1)}=step${steps[k]}`).join(" -> ")}. A nearer face sitting on a farther face's value is what makes depth look applied rather than drawn` });
  }
  return { ok: problems.length === 0, problems, per_ramp: perRamp };
}

/**
 * Occlusion must agree with distance. A prop whose contact row is LOWER on screen is nearer; it must
 * be drawn after (over) a prop whose contact row is higher. Getting this wrong is what makes a
 * building look like a decal on the sky.
 */
function occlusionAudit(placed) {
  // placed: [{ id, contactRow, z, drawOrder }]
  const problems = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.contactRow === b.contactRow) continue;
    const nearer = a.contactRow > b.contactRow ? a : b;
    const farther = nearer === a ? b : a;
    if ((nearer.drawOrder ?? 0) < (farther.drawOrder ?? 0)) {
      problems.push({ rule: "occlusion_inverted", nearer: nearer.id, farther: farther.id,
        message: `'${nearer.id}' contacts the ground at row ${nearer.contactRow} (nearer than '${farther.id}' at row ${farther.contactRow}) but is drawn before it, so the farther thing covers the nearer one` });
    }
    if (nearer.z != null && farther.z != null && nearer.z > farther.z) {
      problems.push({ rule: "depth_contact_conflict", nearer: nearer.id, farther: farther.id,
        message: `'${nearer.id}' sits lower on screen (nearer) but declares z=${nearer.z} against '${farther.id}' z=${farther.z}: the declared distance and the drawn distance disagree` });
    }
  }
  return { ok: problems.length === 0, problems, checked: placed.length * (placed.length - 1) / 2 };
}

/**
 * The headline test for "do we have POV depth": the near face and the far face of one structure must
 * be drawn at roughly the ratio the geometry demands. Draw them equal and the building is flat no
 * matter what the style coordinate says.
 */
function foreshortenAudit(persp, zNear, zFar, drawnNearH, drawnFarH, opts = {}) {
  const tol = opts.tolerance ?? 0.18;
  const expected = persp.foreshorten(zNear, zFar);
  const actual = drawnFarH / drawnNearH;
  const error = Math.abs(actual - expected) / expected;
  const ok = error <= tol;
  return {
    ok, expected: +expected.toFixed(3), actual: +actual.toFixed(3), error: +(error * 100).toFixed(1),
    rule: ok ? null : "flat_perspective",
    message: ok
      ? `far face is ${(actual * 100).toFixed(0)}% of the near face; geometry asked for ${(expected * 100).toFixed(0)}%`
      : `far face is ${(actual * 100).toFixed(0)}% of the near face but geometry at z=${zNear}->${zFar} demands ${(expected * 100).toFixed(0)}%. ${actual > expected ? "The far part is too big: this is a parallel projection wearing a perspective label." : "The far part is too small: the recession is exaggerated past the declared focal length."}`,
  };
}

// ---- faces: the half people mean by "shading" ----------------------------------
//
// A structure is not a silhouette with a gradient dropped on it. It is a set of FACES, each with
// a normal, a material, and a distance. The light decides which faces catch it; the ramp decides
// how much room each face gets to model its own form. Compile that declaration into ramp-step
// bands and the "shader" is deterministic, reviewable, and falsifiable by measurement.
//
// There is still no brightness filter anywhere in this file: a face gets *which steps of its own
// material* it is allowed to paint with. That is the whole difference.

// Screen/world axes used throughout: x right, y DOWN (screen rows), z toward the viewer.
const FACE_NORMALS = {
  front:  [0, 0, 1],
  back:   [0, 0, -1],
  left:   [-1, 0, 0],
  right:  [1, 0, 0],
  top:    [0, -1, 0],     // a roof, a shelf top, a pavement
  bottom: [0, 1, 0],
  "roof-shallow": [-0.35, -0.92, 0.17],
  "roof-steep":   [-0.8, -0.55, 0.25],
  "recess":       [0, 0, 0.35],   // a doorway set back into a lit face
};

const norm3 = (v) => { const m = Math.hypot(v[0], v[1], v[2] ?? 0) || 1; return [v[0] / m, v[1] / m, (v[2] ?? 0) / m]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * (b[2] ?? 0);
const normalOf = (f) => Array.isArray(f.normal) ? norm3(f.normal) : norm3(FACE_NORMALS[f.normal] || FACE_NORMALS.front);

/**
 * Compile a light declaration + a face list into a ramp-step band per face.
 *
 * Two independent claims can both want the same ramp steps:
 *   - ORIENTATION: the roof catches more light than the front, which catches more than the side.
 *   - DISTANCE:    the far end of the wall sits further along the atmosphere.
 * When both are declared, the engine intersects them and reports the leftover. If the leftover is
 * zero, the material cannot model form *and* recede at the same time - which is a design decision
 * to make now, at declaration, not a bug to discover in the render at 3am.
 */
function faceRecipe(palette, rampId, faces, opts = {}) {
  const list = palette.ramp(rampId);
  if (!list || list.length < 2) {
    const e = new Error(`ramp '${rampId}' has ${list ? list.length : 0} step(s); a shaded structure needs at least 2`);
    e.rule = "face_needs_ramp"; throw e;
  }
  const L = norm3(opts.light?.vector ?? [-0.6, -0.6, 0.5]);
  const S = list.length;
  const F = faces.length;
  const span = Math.max(1, Math.floor(S / F));
  const conflicts = [];
  if (span * F > S) conflicts.push({ rule: "face_budget", message: `ramp '${rampId}' has ${S} step(s) for ${F} face(s): each face needs its own band and the darkest face would be pushed off the end of the ramp. Add a step, merge two faces into one material, or accept that one face is flat.` });

  // Two independent claims order the same ramp: ORIENTATION (the light) and DISTANCE (the
  // atmosphere). They used to be applied one after the other, so declaring depth silently
  // overwrote the light and every face ended up ordered by geometry instead of by illumination.
  // The allocation now follows ONE composite ranking that carries both claims, spends the leftover
  // steps on the brighter end (that is where the eye reads the form), and names the contradiction
  // out loud when the two claims cannot both hold.
  const ranked = faces.map((f, i) => ({ ...f, i, normal: normalOf(f), facing: +dot3(normalOf(f), L).toFixed(4) }))
    .sort((a, b) => b.facing - a.facing);                       // ties keep the authored order
  let implicitDepthBands = null;
  const zsDeclared = [...new Set(ranked.map(f => f.z).filter(v => v != null))].sort((a, b) => a - b);
  // A face that declares a distance IS making a depth claim, whether or not the author also passed
  // a bands array. Treat the declared z values as the band list rather than silently ignoring them:
  // an ignored claim is a shading decision made by accident.
  const bandsIn = opts.depth?.bands?.length ? opts.depth.bands : (zsDeclared.length > 1 ? zsDeclared : null);
  const towardOpt = opts.depth?.toward ?? opts.toward ?? "darker";
  const slice = bandsIn ? depthSlice(palette, rampId, bandsIn, towardOpt) : null;
  if (slice && !opts.depth) implicitDepthBands = zsDeclared;
  const wO = slice ? Math.max(0, Math.min(1, opts.lightWeight ?? 0.55)) : 1;
  const faceSpan = (x) => { const lo = Math.min(...ranked.map(q => q.facing)), hi = Math.max(...ranked.map(q => q.facing)); return hi - lo || 1; };
  const nearNorm = (z) => {
    if (!slice || z == null || zsDeclared.length < 2) return 1;
    const k = zsDeclared.findIndex(z2 => Math.abs(z2 - z) < 1e-6);
    return 1 - (k / (zsDeclared.length - 1));                   // nearest earns the top of the ramp
  };
  const composite = ranked.map(f => ({ ...f, lightClaim: +(((f.facing - Math.min(...ranked.map(q => q.facing))) / faceSpan())).toFixed(4), distanceClaim: +nearNorm(f.z).toFixed(4) }))
    .map(f => ({ ...f, score: +(wO * f.lightClaim + (1 - wO) * f.distanceClaim).toFixed(4) }))
    .sort((a, b) => b.score - a.score || b.facing - a.facing);

  const F2 = composite.length;
  const baseSpan = Math.max(1, Math.floor(S / F2));
  const leftOver = S - baseSpan * F2;
  let cursorTop = S - 1;
  const out = [];
  composite.forEach((f, rank) => {
    const sp = baseSpan + (rank < leftOver ? 1 : 0);            // spare steps go to the brighter end
    const hi = cursorTop;
    const lo = Math.max(0, hi - sp + 1);
    cursorTop = lo - 1;
    const band = { lo, hi, steps: list.slice(lo, hi + 1), roomForForm: hi - lo };
    let depth = null;
    if (slice) {
      const mine = slice.bands.find(b => f.z != null && Math.abs(b.z - f.z) < 1e-6) ?? slice.bands[Math.min(rank, slice.bands.length - 1)];
      depth = { z: mine.z, atmosphere_step: palette.entries[mine.index].step, toward: slice.toward,
        band_used: [lo, hi], steps_spent_on_depth: slice.span, left_for_form: slice.roomForForm };
      if (hi - lo === 0) conflicts.push({ rule: "depth_spends_the_face", face: f.name, message: `face '${f.name}' at z=${mine.z}: the ramp is fully spent on ${F2} distance bands, so this face is one flat value. Either drop a depth band, give '${rampId}' a longer ramp, or let this face recede by silhouette alone.` });
    }
    out.push({ name: f.name, ramp: rampId, normal: f.normal, facing: f.facing, rank, region: f.region ?? null,
      light_rank: ranked.findIndex(q => q.name === f.name), distance_rank: f.z == null ? null : zsDeclared.indexOf(f.z),
      claims: { light: f.lightClaim, distance: f.distanceClaim, weight_light: wO },
      band, depth, z: f.z ?? null });
  });

  // Both claims must survive the allocation, or the art has to be told which one gave way.
  const mid = (x) => (x.band.lo + x.band.hi) / 2;
  const byZ = out.filter(o => o.z != null).sort((a, b) => a.z - b.z);
  for (let i = 1; i < byZ.length; i++) {
    const a = byZ[i - 1], b = byZ[i];
    const worse = slice?.toward === "lighter" ? mid(b) < mid(a) : mid(b) > mid(a);
    if (worse) conflicts.push({ rule: "orientation_vs_distance", faces: [a.name, b.name], severity: "error",
      message: `'${a.name}' (z=${a.z}) sits on steps ${a.band.lo}-${a.band.hi} while the farther '${b.name}' (z=${b.z}) sits higher up at ${b.band.lo}-${b.band.hi}: with lightWeight=${wO} the light outranked the atmosphere. Lower lightWeight, give '${rampId}' more steps, or move one face to its own material.` });
  }
  const byFacing = [...out].sort((a, b) => b.facing - a.facing);
  for (let i = 1; i < byFacing.length; i++) {
    const a = byFacing[i - 1], b = byFacing[i];
    if (Math.abs(a.facing - b.facing) < 0.05) continue;         // same orientation: distance may order them
    if (mid(b) > mid(a)) conflicts.push({ rule: "orientation_vs_distance", faces: [a.name, b.name], severity: "error",
      message: `'${a.name}' faces the light better (${a.facing}) but was given steps ${a.band.lo}-${a.band.hi}, darker than the worse-facing '${b.name}' at ${b.band.lo}-${b.band.hi}: with lightWeight=${wO} the atmosphere outranked the light. Raise lightWeight, lengthen '${rampId}', or re-declare which of these two is actually lit.` });
  }

  // A 3+ step gap between two neighbouring faces is the same ramp_jump the audit refuses, just
  // arriving from the design side. Catch it before the pixels exist.
  for (let i = 1; i < out.length; i++) {
    const drop = out[i - 1].band.lo - out[i].band.hi;
    if (drop >= 3) conflicts.push({ rule: "face_seam", faces: [out[i - 1].name, out[i].name], message: `'${out[i - 1].name}' bottoms out at step ${out[i - 1].band.lo} while '${out[i].name}' tops out at step ${out[i].band.hi}: ${out[i - 1].band.lo - out[i].band.hi} steps apart. Where those two faces meet, the audit will report a ramp_jump.` });
  }
  const flat = out.filter(f => f.band.hi === f.band.lo);
  const depthCost = slice && byZ.length > 1 ? Math.abs(mid(byZ[0]) - mid(byZ[byZ.length - 1])) : 0;
  return {
    ok: !conflicts.some(c => (c.severity || "error") === "error"), ramp: rampId, steps: S, faces: F, band_span: baseSpan,
    light: L, faces_out: out, conflicts,
    claims_compete: !!slice && wO < 1,
    light_weight: wO,
    depth_bands_used: slice ? (bandsIn.map(z => +z.toFixed(3))) : null,
    depth_bands_implicit: implicitDepthBands ? implicitDepthBands.map(z => +z.toFixed(3)) : null,
    depth_cost_steps: +depthCost.toFixed(2),
    atmosphere_toward: slice?.toward ?? null,
    leftover_steps_to_brighter_end: leftOver,
    flat_faces: flat.map(f => f.name),
    note: flat.length ? `${flat.length} face(s) got a 1-step band: they are flat by design, which is a decision to state, not an oversight to hide` : null,
  };
}

/**
 * Paint each face with its band, modelling ACROSS THE FACE'S OWN EXTENT row by row.
 *
 * The row-wise measurement is not a detail: it is the bug that a 52px leg was modelled in 2 of
 * 3 boot values because a two-column-wide leg sits in the middle of its bounding box and never
 * reaches either end of its ramp. A receding wall face is the same trap at building scale.
 *
 * Falloff is two-axis: value drops along x AND along y, each weighted by the light and normalised
 * by the extent that axis actually has in this face.
 */
function shadeFaces(cel, palette, recipe, opts = {}) {
  const list = palette.ramp(recipe.ramp);
  const L = recipe.light;
  const report = [];
  for (const f of recipe.faces_out) {
    const reg = f.region;
    if (!reg) { report.push({ face: f.name, skipped: "no region declared" }); continue; }
    const [x0, y0, x1, y1] = reg;
    const band = f.band;
    const room = band.hi - band.lo;
    let moved = 0, already = 0, offRamp = 0;
    const used = new Map();
    // Pass 1: every row measured across its OWN filled extent, restricted to this material.
    const rows = [];
    for (let y = Math.max(0, y0); y <= Math.min(cel.h - 1, y1); y++) {
      let xa = -1, xb = -1;
      for (let x = Math.max(0, x0); x <= Math.min(cel.w - 1, x1); x++) {
        const v = cel.get(x, y);
        if (v < 0) continue;
        const e = palette.entries[v];
        if (!e || e.ramp !== recipe.ramp) continue;
        if (xa < 0) xa = x;
        xb = x;
      }
      if (xa >= 0) rows.push({ y, xa, xb });
    }
    if (!rows.length) { report.push({ face: f.name, region: reg, band: [band.lo, band.hi], skipped: `no '${recipe.ramp}' pixels inside the declared region`, pixels: 0, steps_used: [], flat: false }); continue; }

    // Pass 2: brightness falls off along BOTH axes of the light, each normalised by the extent that
    // axis actually has in this face. One-axis-only falloff is why a shaded wall reads as stripes
    // repeated on every row instead of a plane lit from above.
    const wx = Math.abs(L[0]), wy = Math.abs(L[1] ?? 0), wsum = wx + wy || 1;
    const yTop = rows[0].y, yBot = rows[rows.length - 1].y, extY = yBot - yTop || 1;
    for (const { y, xa, xb } of rows) {
      const extX = xb - xa || 1;
      for (let x = xa; x <= xb; x++) {
        const v = cel.get(x, y);
        const e = palette.entries[v];
        if (!e || e.ramp !== recipe.ramp) { offRamp++; continue; }
        // 1.0 on the side the light reaches first, 0.0 on the side it never reaches.
        const bx = L[0] < 0 ? (xb - x) / extX : (x - xa) / extX;
        const by = !L[1] ? 0 : (L[1] < 0 ? (yBot - y) / extY : (y - yTop) / extY);
        const t = Math.max(0, Math.min(1, (wx * bx + wy * by) / wsum));
        const step = band.lo + Math.round(t * room);
        const target = list[step];
        used.set(step, (used.get(step) || 0) + 1);
        if (v === target) { already++; continue; }
        cel.set(x, y, target);
        moved++;
      }
    }
    report.push({
      face: f.name, region: reg, band: [band.lo, band.hi], room_for_form: room,
      rows_measured: rows.length,
      falloff_axes: { x_weight: +(wx / wsum).toFixed(2), y_weight: +(wy / wsum).toFixed(2) },
      steps_used: [...used.keys()].sort((a, b) => a - b),
      pixels: moved + already, changed: moved, already_correct: already, off_ramp_pixels: offRamp,
      flat: room === 0,
    });
  }
  return { ok: true, ramp: recipe.ramp, faces: report,
    changed: { pixels: report.reduce((s, r) => s + (r.changed || 0), 0), added: 0, removed: 0, repainted: report.reduce((s, r) => s + (r.changed || 0), 0) },
    note: "every pixel moved to another step of its own material's ramp; no colour was created and nothing was multiplied" };
}

/**
 * Did the pixels obey the declaration? Measure the faces from the ART, not from the recipe.
 * A face declared brighter than its neighbour, painted darker, is the exact failure mode of
 * "shading applied as a filter": the light was declared and the pixels never agreed to it.
 */
function faceAudit(cel, palette, recipe) {
  const acc = new Map();
  for (const f of recipe.faces_out) {
    if (!f.region) continue;
    const [x0, y0, x1, y1] = f.region;
    let sum = 0, n = 0, steps = new Set();
    for (let y = Math.max(0, y0); y <= Math.min(cel.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(cel.w - 1, x1); x++) {
      const v = cel.get(x, y);
      if (v < 0) continue;
      const e = palette.entries[v];
      if (!e || e.ramp !== recipe.ramp) continue;
      sum += e.step; n++; steps.add(e.step);
    }
    acc.set(f.name, { declared: [f.band.lo, f.band.hi], facing: f.facing, mean_step: n ? +(sum / n).toFixed(2) : null, pixels: n, distinct_steps: steps.size });
  }
  const problems = [];
  const ordered = recipe.faces_out.filter(f => acc.get(f.name)?.pixels).sort((a, b) => b.facing - a.facing);
  for (let i = 1; i < ordered.length; i++) {
    const a = acc.get(ordered[i - 1].name), b = acc.get(ordered[i].name);
    if (a.mean_step == null || b.mean_step == null) continue;
    if (a.mean_step < b.mean_step) problems.push({ rule: "face_value_order", faces: [ordered[i - 1].name, ordered[i].name],
      message: `'${ordered[i - 1].name}' faces the light better (${a.facing}) but is painted at mean step ${a.mean_step}, darker than '${ordered[i].name}' at ${b.mean_step}: the declared light and the drawn light disagree` });
  }
  for (const f of ordered) {
    const a = acc.get(f.name);
    if (a.pixels && a.distinct_steps === 1 && f.band.hi > f.band.lo)
      problems.push({ rule: "flat_face", face: f.name, message: `'${f.name}' was given steps ${f.band.lo}-${f.band.hi} to model its own form and used one (${a.mean_step}): a face with a band and no gradient is a flat mass wearing a name` });
  }
  // Seam measurement across the actual boundary between two faces of the same material.
  const seams = [];
  for (let i = 0; i < recipe.faces_out.length; i++) for (let j = i + 1; j < recipe.faces_out.length; j++) {
    const A = recipe.faces_out[i], B = recipe.faces_out[j];
    if (!A.region || !B.region) continue;
    let worst = 0, at = null, pairs = 0;
    for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
      const inA = inside(A.region, x, y), inB = inside(B.region, x, y);
      if (!inA && !inB) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const o = { x: x + dx, y: y + dy };
        const one = (inA && inside(B.region, o.x, o.y)) || (inB && inside(A.region, o.x, o.y));
        if (!one) continue;
        const va = cel.get(x, y), vb = cel.get(o.x, o.y);
        if (va < 0 || vb < 0) continue;
        const ea = palette.entries[va], eb = palette.entries[vb];
        if (!ea.ramp || ea.ramp !== eb.ramp) continue;
        pairs++;
        const d = Math.abs(ea.step - eb.step);
        if (d > worst) { worst = d; at = { x, y }; }
      }
    }
    if (worst >= 3) seams.push({ rule: "face_seam", faces: [A.name, B.name], at, worst_step_gap: worst, message: `'${A.name}' meets '${B.name}' with a ${worst}-step jump across the shared edge (${pairs} boundary pair(s)): the two faces read as two objects, not two faces of one object` });
  }
  return { ok: problems.length === 0 && seams.length === 0, faces: Object.fromEntries(acc), problems, seams };
}

const inside = (reg, x, y) => x >= reg[0] && x <= reg[2] && y >= reg[1] && y <= reg[3];

/**
 * Cast shadow geometry, derived from the light vector rather than painted by hand.
 *
 * The silhouette is sheared onto the ground plane along the light ray. The engine proposes the
 * cells and the ramp steps (darkest at the contact, monotonic toward the tip); the author places
 * them. It refuses a shadow that lands on top of the object casting it, which is the usual way a
 * generated shadow looks like a stain.
 */
function shadowFootprint(cel, opts = {}) {
  const L = opts.light?.vector ?? [-0.6, -0.6];
  const groundRow = opts.groundRow;
  if (groundRow == null) { const e = new Error("a cast shadow needs a ground row: the plane it falls onto"); e.rule = "shadow_needs_ground"; throw e; }
  if (L[1] >= 0) { const e = new Error(`light vector ${L.join(",")} points downward: light from below puts the shadow above the object, which is a different drawing`); e.rule = "shadow_light_from_below"; throw e; }
  const strength = opts.strength ?? 1;
  const shear = (-L[0]) / Math.abs(L[1]);            // light from the left throws the shadow right
  const maxDrop = opts.maxDrop ?? Math.max(2, Math.round(cel.h * 0.35 * strength));
  const bb = cel.bbox();
  if (!bb) return { ok: false, rule: "empty_cel", cells: [], message: "nothing to cast a shadow from" };
  const cells = [];
  const onObject = [];
  for (let y = bb.y0; y <= Math.min(bb.y1, groundRow); y++) {
    const h = groundRow - y;                          // height above the plane, in art pixels
    if (h < 0) continue;
    const dx = Math.round(shear * h * strength);
    for (let x = 0; x < cel.w; x++) {
      if (cel.get(x, y) < 0) continue;
      const sx = x + dx, sy = groundRow;
      if (!cel.inBounds(sx, sy)) continue;
      if (cel.get(sx, sy) >= 0) { onObject.push({ x: sx, y: sy }); continue; }
      cells.push({ x: sx, y: sy, height: h });
    }
  }
  // Monotonic by construction: contact darkest, tip lightest. A shadow whose far end is darker
  // than its near end is the same depth_contradiction signature, one metre closer.
  const maxH = Math.max(1, ...cells.map(c => c.height));
  const steps = opts.steps ?? 3;
  for (const c of cells) c.band = Math.min(steps - 1, Math.floor((c.height / maxH) * steps));
  const byBand = {};
  for (const c of cells) byBand[c.band] = (byBand[c.band] || 0) + 1;
  return {
    ok: true, ground_row: groundRow, shear: +shear.toFixed(3), strength, max_drop: maxDrop,
    cells: cells.slice(0, opts.limit ?? 4000), count: cells.length, per_band: byBand,
    rule: null,
    overlaps_object: onObject.length, overlap_note: onObject.length ? `${onObject.length} proposed shadow cell(s) land on the object itself and were dropped; a shadow that sits on its caster reads as dirt` : null,
    note: "cells are a proposal in the ground plane; place them with put/draw_pixel_map using the declared shadow ramp, darkest at the contact",
  };
}

// ---- distance measured off the art, not off the declaration --------------------

/** Mean ramp step per region, for the monotonicity test. Regions are the author's claim about
 *  which pixels are at which distance; the engine's job is to check the pixels agree. */
function depthReadings(cel, palette, regions) {
  const out = [];
  for (const r of regions) {
    const [x0, y0, x1, y1] = r.region;
    const byRamp = new Map();
    for (let y = Math.max(0, y0); y <= Math.min(cel.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(cel.w - 1, x1); x++) {
      const v = cel.get(x, y);
      if (v < 0) continue;
      const e = palette.entries[v];
      if (!e?.ramp) continue;
      const a = byRamp.get(e.ramp) || { sum: 0, n: 0 };
      a.sum += e.step; a.n++;
      byRamp.set(e.ramp, a);
    }
    for (const [ramp, a] of byRamp) out.push({ region: r.name, z: r.z, ramp, step: +(a.sum / a.n).toFixed(3), pixels: a.n });
  }
  return out;
}

/**
 * The ground plane is a claim with a number attached to it.
 *
 * Given the horizon, the eye height and the focal length, a contact row *is* a distance:
 *     z = eye * focal / (contactRow - horizon)
 * So the engine can derive how far the drawing says the object is, then check the object's drawn
 * height against its declared world height at that distance. A building whose base sits on the
 * wrong row is either floating or sunk, and this is the rule that says so.
 */
function horizonAudit(persp, placed, opts = {}) {
  const tolRow = opts.tolerance ?? 1.5;
  const problems = [];
  const derived = [];
  for (const p of placed) {
    const base = p.baseRow ?? p.contactRow;
    if (base == null) continue;
    if (base <= persp.horizon) {
      problems.push({ rule: "floating_above_horizon", id: p.id, message: `'${p.id}' contacts the ground at row ${base}, at or above the horizon row ${persp.horizon}: nothing below eye level can meet the ground above the horizon. It is floating, or the horizon is wrong.` });
      continue;
    }
    const z = (persp.eye * persp.focal) / (base - persp.horizon);
    const expected = persp.groundRow(z);
    if (Math.abs(expected - base) > tolRow) problems.push({ rule: "ground_plane_mismatch", id: p.id, message: `'${p.id}' stands on row ${base}; the declared camera puts its distance z=${z.toFixed(2)} at row ${expected.toFixed(1)}. The base row and the declared distance disagree by ${Math.abs(expected - base).toFixed(1)}px.` });
    const rec = { id: p.id, contact_row: base, z: +z.toFixed(3) };
    if (p.worldHeight != null) {
      const want = persp.screenHeight(p.worldHeight, z);
      const got = p.drawnHeight ?? null;
      if (got != null) {
        const err = Math.abs(got - want) / want;
        rec.world_height = p.worldHeight; rec.want_px = +want.toFixed(1); rec.drawn_px = got; rec.error_pct = +(err * 100).toFixed(1);
        if (err > (opts.heightTolerance ?? 0.15)) problems.push({ rule: "elevation_mismatch", id: p.id, message: `'${p.id}' is ${p.worldHeight} world units tall at z=${z.toFixed(2)}, which this camera renders as ${want.toFixed(1)}px; the art draws ${got}px (${(err * 100).toFixed(0)}% off). Either the height, the distance or the focal length is wrong.` });
      }
    }
    derived.push(rec);
  }
  return { ok: problems.length === 0, problems, derived, horizon: persp.horizon, eye: persp.eye, focal: persp.focal };
}

/** Repeated world features must shrink at the rate the camera says they should. */
function elevationAudit(persp, repeats, opts = {}) {
  const tol = opts.tolerance ?? 0.15;
  const problems = [];
  const byFeature = new Map();
  for (const r of repeats) (byFeature.get(r.feature) || byFeature.set(r.feature, []).get(r.feature)).push(r);
  for (const [feature, rs] of byFeature) {
    if (rs.length < 2) continue;
    const sorted = [...rs].sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const want = persp.foreshorten(a.z, b.z);
      const got = b.drawnHeight / a.drawnHeight;
      const err = Math.abs(got - want) / want;
      if (err > tol) problems.push({ rule: "repeat_not_foreshortened", feature, message: `'${feature}' at z=${a.z} is drawn ${a.drawnHeight}px and at z=${b.z} is drawn ${b.drawnHeight}px (${got.toFixed(2)}); the camera demands ${want.toFixed(2)}. Repeated elements drawn the same size at different distances are the clearest tell of a flat structure.` });
    }
  }
  return { ok: problems.length === 0, problems, checked: repeats.length };
}

/** Occlusion ordering: the engine proposes the draw order, and names every inversion. */
function occlusionSort(placed) {
  const sorted = [...placed].sort((a, b) => (a.contactRow ?? 0) - (b.contactRow ?? 0));
  const problems = [];
  placed.forEach((p, i) => {
    const want = sorted.findIndex(s => s.id === p.id);
    if (p.drawOrder != null && p.drawOrder !== want) problems.push({ id: p.id, rule: "draw_order_off", declared: p.drawOrder, should_be: want, contact_row: p.contactRow });
  });
  return { ok: problems.length === 0, order: sorted.map((p, i) => ({ draw_order: i, id: p.id, contact_row: p.contactRow, z: p.z ?? null })), problems };
}

/**
 * Parallax: layers at different distances must move at rates proportional to their distance.
 * Exported so a real engine can consume it; authored here so the art and the camera agree.
 */
function parallaxPlan(layers, persp) {
  const bad = [];
  const ls = layers.map(l => ({ ...l, factor: +(1 / (l.z ?? 1)).toFixed(4) })).sort((a, b) => b.z - a.z);
  const fastest = ls.length ? ls[0].factor : 1;
  for (const l of ls) l.parallax = +(l.factor / fastest).toFixed(4);
  for (let i = 1; i < ls.length; i++) if (ls[i].parallax >= ls[i - 1].parallax) bad.push({ rule: "parallax_inverted", layer: ls[i].id, message: `'${ls[i].id}' (z=${ls[i].z}) moves as fast as or faster than the nearer '${ls[i - 1].id}' (z=${ls[i - 1].z}): the nearer layer must move more, or the camera is lying` });
  const seen = new Map();
  for (const l of ls) { if (seen.has(l.z)) bad.push({ rule: "parallax_same_plane", layer: l.id, message: `'${l.id}' and '${seen.get(l.z)}' are both at z=${l.z} but are declared as separate layers: same plane, same rate, or merge them` }); else seen.set(l.z, l.id); }
  return { ok: bad.length === 0, layers: ls, problems: bad, note: "parallax factors are relative to the nearest layer; multiply by the camera's own scroll in the engine" };
}

/**
 * THE headline question: "we drew a building — does it have point-of-view depth?"
 *
 * Four independent claims, each falsifiable, all four must hold:
 *   GEOMETRY  the receding edges actually converge on the declared vanishing point
 *   SCALE     the far face is actually smaller by the ratio the camera demands
 *   VALUE     the material actually steps along its ramp with distance, monotonically
 *   GROUND    the contact rows agree with the camera, and nearer things are drawn over farther ones
 * A cel that passes three of four is a drawing with a perspective *label* on it.
 */
function povAudit({ persp, cel, palette, edges, faces, depthRegions, placed, repeats, recipe, opts = {} }) {
  // One space for every number this audit reads: whatever space the CEL lives in.
  const cam = localCamera(persp, opts.place);
  const toward = opts.toward ?? opts.depth?.toward ?? null;
  const checks = {};
  if (edges?.length) checks.convergence = convergenceAudit(cel, cam, edges, opts);
  if (faces?.length && palette) {
    const rec = recipe || faceRecipe(palette, faces[0].ramp, faces, { light: opts.light, depth: opts.depth });
    checks.faces = faceAudit(cel, palette, rec);
    checks.recipe = rec;
  }
  if (depthRegions?.length && palette) {
    const readings = depthReadings(cel, palette, depthRegions);
    checks.value = depthMonotonic(readings, { toward });
    const byZ = [...new Set(depthRegions.map(r => r.z))].sort((a, b) => a - b);
    checks.depth_bands = byZ;
    // The near face and the far face of ONE structure, measured in pixels, against the ratio the
    // camera demands. This is the single test that separates a building from a decal.
    const withH = depthRegions.filter(r => r.drawnHeight);
    const near = withH.find(r => r.z === byZ[0]), far = withH.find(r => r.z === byZ[byZ.length - 1]);
    if (near && far && far.z > near.z) checks.foreshortening = foreshortenAudit(persp, near.z, far.z, near.drawnHeight, far.drawnHeight, opts);
  }
  if (opts.foreshorten) checks.foreshortening = foreshortenAudit(cam, opts.foreshorten.zNear, opts.foreshorten.zFar, opts.foreshorten.nearHeight, opts.foreshorten.farHeight, opts);
  if (placed?.length) {
    checks.ground = horizonAudit(cam, placed, opts);
    checks.occlusion = occlusionAudit(placed);
    checks.occlusion_order = occlusionSort(placed);
  }
  if (repeats?.length) checks.repeats = elevationAudit(cam, repeats, opts);
  const failed = Object.entries(checks).filter(([k, v]) => k !== "recipe" && v && v.ok === false).map(([k]) => k);
  const flat = checks.foreshortening && checks.foreshortening.ok === false;
  return {
    ok: failed.length === 0,
    verdict: failed.length === 0
      ? "this structure has point-of-view depth: converging edges, foreshortened scale, monotonic distance value, and a ground plane the camera agrees with"
      : `no point-of-view depth yet. Failed: ${failed.join(", ")}${flat ? ` (${checks.foreshortening.message})` : ""}`,
    checks, failed,
  };
}

/**
 * The ground convention, and the price of it.
 *
 * Almost every 2D street scene draws its ground as a parallel tile grid and its buildings in
 * one-point perspective. That is a CONVENTION, not a camera, and the honest engine says where the
 * two meet and how far apart they drift. Declaring it means the audit can check the one place they
 * must agree - the row a building's base lands on - instead of letting a scene quietly hold two
 * incompatible scale systems and calling it style.
 */
function groundConvention(persp, ground) {
  if (!ground) return null;
  const tile = ground.tile ?? 16;
  const meets = ground.meets_at_row;
  if (meets == null) { const e = new Error("a parallel ground convention needs meets_at_row: the row where it takes over from the camera"); e.rule = "ground_needs_meet_row"; throw e; }
  const zAtMeet = persp.zFromRow(meets);
  const camPxPerUnit = persp.scaleAt(zAtMeet);
  const groundPxPerUnit = tile / (ground.world_per_tile ?? 1);
  // Sample forward from the meeting row to the bottom of the drawn ground. Clamping at the declared
  // near row hid the entire drift: everything in front of zNear is exactly where a fixed tile size
  // starts lying about scale.
  const lastRow = Math.max(meets, ground.last_row != null ? ground.last_row : meets + tile * 6);
  const rows = [];
  for (let row = meets; ; row += tile) {
    const r2 = Math.min(row, lastRow);
    const z = Math.max(0.05, persp.zFromRow(r2));
    const cam = persp.scaleAt(z);
    const drift = groundPxPerUnit / cam;
    rows.push({ row: r2, z: +z.toFixed(2), camera_px_per_unit: +cam.toFixed(2), ground_px_per_unit: +groundPxPerUnit.toFixed(2), drift: +drift.toFixed(3), tiles_are_bigger_by: +(1 / drift).toFixed(3) });
    if (r2 >= lastRow) break;
  }
  const worst = Math.max(...rows.map(r => Math.max(r.drift, 1 / r.drift)));
  const worstRow = rows.reduce((a, b) => (Math.max(b.drift, 1 / b.drift) > Math.max(a.drift, 1 / a.drift) ? b : a), rows[0]);
  return {
    ok: Math.abs(camPxPerUnit - groundPxPerUnit) / camPxPerUnit <= (ground.tolerance ?? 0.25),
    meets_at_row: meets, z_at_meet: +zAtMeet.toFixed(3),
    camera_px_per_unit_at_meet: +camPxPerUnit.toFixed(2), ground_px_per_unit: +groundPxPerUnit.toFixed(2),
    profile: rows,
    scale_drift_max: +worst.toFixed(3),
    worst_at_row: worstRow.row,
    note: worst > 1.5
      ? `the parallel ground and the camera agree at row ${meets} (z=${zAtMeet.toFixed(2)}) and disagree by ${worst.toFixed(2)}x at row ${worstRow.row} (z=${worstRow.z}): there the tiles draw ${worstRow.tiles_are_bigger_by >= 1 ? `${worstRow.tiles_are_bigger_by.toFixed(2)}x smaller than the camera says` : `${(1 / worstRow.drift).toFixed(2)}x bigger than the camera says`} per world unit. That is the price of the convention; state it in the bible rather than discovering it in the render.`
      : "the two scale systems stay within one tile of each other across the drawn ground",
  };
}

module.exports = {
  Perspective, depthSlice, depthShade, convergenceAudit, depthMonotonic, occlusionAudit, foreshortenAudit,
  FACE_NORMALS, faceRecipe, shadeFaces, faceAudit, shadowFootprint, depthReadings, horizonAudit,
  elevationAudit, occlusionSort, parallaxPlan, povAudit, groundConvention, localCamera, norm3, dot3,
};
