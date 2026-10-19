// Rig, skin and pose. Animation is authored as rig + key poses, never as a formula
// applied to a sprite. Phase 0 produced a walk cycle by formula and it was wrong in
// every way that matters (sliding legs, merged legs, detached torso, no counter-swing),
// so the engine refuses to animate without a rig.
"use strict";

const { Cel, TRANSPARENT } = require("./cel.js");
const { bonePixels } = require("./bone-raster.js");

const PALETTES = new Map();
function registerPalette(p) { PALETTES.set(p.id, p); return p; }
function paletteOf(skin) { return PALETTES.get(skin.paletteId) || null; }

const DIRECTIONS = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];
// Screen-space projection of each facing. Gait travels along this vector, rather than
// translating every leg sideways regardless of where the character is looking.
const DIRECTION_VECTORS = {
  down: [0, 1], "down-right": [Math.SQRT1_2, Math.SQRT1_2], right: [1, 0],
  "up-right": [Math.SQRT1_2, -Math.SQRT1_2], up: [0, -1],
  "up-left": [-Math.SQRT1_2, -Math.SQRT1_2], left: [-1, 0],
  "down-left": [-Math.SQRT1_2, Math.SQRT1_2],
};
const CARDINALS = ["down", "right", "up", "left"];
// Horizontal mirror pairs. Mirroring a facing is standard craft; mirroring up<->down is not.
const MIRROR_OF = {
  right: "left", left: "right",
  "down-right": "down-left", "down-left": "down-right",
  "up-right": "up-left", "up-left": "up-right",
  down: null, up: null,
};
// Key poses of a walk, in cycle order.
const WALK_POSES = ["contact", "down", "passing", "up"];

/**
 * Re-light a mirrored cel.
 *
 * Mirroring a facing is standard craft. Mirroring the LIGHT is not: a key light from the top-left
 * is a property of the scene, not of the character, so a naive mirror produces a figure lit from
 * its own right side. Measured, that is a light_direction error on every mirrored facing, and it
 * is the single most common way a mirrored sprite sheet looks subtly wrong in a lit scene.
 *
 * The correction an artist actually performs is "flip the horizontal shading, keep the vertical
 * shading": the crown of a hood stays lit because it is at the top, but whichever side of the
 * form faces the key light becomes the lit side. So work per connected region of a material, not
 * per pixel. Find where a region's bright steps sit relative to its dark steps. If the offset is
 * mostly along x, the region is modelled across the light and its steps are reflected about the
 * middle of the ramp. If the offset is mostly along y, the region is modelled top-to-bottom (a
 * boot lit on its instep and shadowed on its sole) and it is left exactly as authored.
 *
 * A per-pixel gradient test does not work here and did not: a lit rim is a vertical line of the
 * brightest step, so its horizontal gradient is zero and it looks like vertical modelling, which
 * leaves the rim on the shadow side after the mirror.
 *
 * Non-material roles are never touched: an outline is still an outline, a flame is still a flame.
 * A ramp may also opt out entirely with `relight: false` for a self-lit material, where the light
 * source is inside the object and the key light has no claim on it.
 */
function relightMirrored(cel, palette) {
  if (!palette) return cel;
  const byRamp = new Map();
  for (const e of palette.entries) {
    if (!e.ramp) continue;
    if (!byRamp.has(e.ramp)) byRamp.set(e.ramp, { n: 0, optOut: false });
    const r = byRamp.get(e.ramp);
    r.n = Math.max(r.n, (e.step ?? 0) + 1);
    if (e.relight === false) r.optOut = true;
  }
  const seen = new Int8Array(cel.w * cel.h);      // 1 = visited, 2 = inverted
  const at = (x, y) => (x < 0 || y < 0 || x >= cel.w || y >= cel.h) ? -1 : cel.get(x, y);
  let changed = 0;
  for (let y0 = 0; y0 < cel.h; y0++) for (let x0 = 0; x0 < cel.w; x0++) {
    const i0 = at(x0, y0);
    if (i0 < 0 || seen[y0 * cel.w + x0]) continue;
    const e0 = palette.entries[i0];
    if (!e0 || !e0.ramp || e0.role !== "material") continue;
    const meta = byRamp.get(e0.ramp);
    if (!meta || meta.optOut || meta.n < 2) continue;

    // Collect one connected region of this material.
    // Connectivity is by RAMP, not by palette index: a coat is one region made of five steps,
    // and treating each step as its own region means no region ever contains both a lit step and a
    // dark step, so nothing is ever judged and nothing is ever flipped.
    const sameRamp = (q) => { const e = palette.entries[cel.idx[q]]; return !!e && e.ramp === e0.ramp; };
    const cells = [];
    const stack = [y0 * cel.w + x0];
    seen[y0 * cel.w + x0] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % cel.w, y = (p - x) / cel.w;
      cells.push([x, y, palette.entries[cel.idx[p]].step]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h) continue;
        const q = ny * cel.w + nx;
        if (seen[q] || !sameRamp(q)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (cells.length < 4) continue;

    const mid = (meta.n - 1) / 2;
    let lit = 0, dark = 0, lx = 0, ly = 0, dx0 = 0, dy0 = 0;
    for (const [x, y, s] of cells) {
      if (s > mid) { lit++; lx += x; ly += y; }
      else if (s < mid) { dark++; dx0 += x; dy0 += y; }
    }
    if (!lit || !dark) continue;                  // a flat region has no modelling to flip
    const offX = Math.abs(lx / lit - dx0 / dark);
    const offY = Math.abs(ly / lit - dy0 / dark);
    if (offX <= offY) continue;                   // modelled top-to-bottom: leave the author's values
    for (const [x, y, s] of cells) {
      const next = meta.n - 1 - s;
      if (next === s) continue;
      const target = palette.entries.findIndex(p => p.ramp === e0.ramp && p.step === next);
      if (target < 0) continue;
      cel.set(x, y, target);
      changed++;
    }
  }
  cel.meta = { ...cel.meta, relit: true, relitPixels: changed };
  return cel;
}

function mirrorCel(cel, name) {
  const out = new Cel(cel.w, cel.h, cel.paletteId, name || cel.name + ".mirror");
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++)
    out.idx[y * out.w + (out.w - 1 - x)] = cel.idx[y * cel.w + x];
  out.offset = [-cel.offset[0], cel.offset[1]];
  out.meta = { ...cel.meta, mirroredFrom: cel.name };
  if (cel.meta.anchor) out.meta.anchor = [cel.w - 1 - cel.meta.anchor[0], cel.meta.anchor[1]];
  return out;
}

/**
 * Re-apply the edge policy to a mirrored cel.
 *
 * The authored facing puts its outline on the shadow side, which is what `selective-dark` means in
 * a dark scene: the lit rim separates itself from the background by value, so an outline there is
 * dead weight, and the outline is spent only where separation actually needs it. Mirroring moves
 * that outline onto the lit side, which is the opposite of the policy and is what makes a lazily
 * mirrored sprite look like it has a dark halo down one side.
 *
 * So: drop outline pixels that are touching lit material, then put outline back on the shadow-side
 * silhouette edge. Both tests are local to the outline pixel and the material pixels it touches.
 */
function reEdgeMirrored(cel, palette) {
  if (!palette) return cel;
  const midOf = new Map();
  for (const e of palette.entries) {
    if (!e.ramp) continue;
    const n = palette.ramp(e.ramp).length;
    midOf.set(e.ramp, (n - 1) / 2);
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= cel.w || y >= cel.h) ? -1 : cel.get(x, y);
  const outlineIdx = palette.index("outline");
  if (outlineIdx < 0) return cel;

  let dropped = 0, added = 0;
  for (let y = 0; y < cel.h; y++) for (let x = 0; x < cel.w; x++) {
    if (cel.get(x, y) !== outlineIdx) continue;
    const steps = [];
    let ramp = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = at(x + dx, y + dy);
      if (i < 0) continue;
      const e = palette.entries[i];
      if (e && e.ramp && e.role === "material") { steps.push(e.step); ramp = ramp || e.ramp; }
    }
    const mid = ramp ? midOf.get(ramp) : undefined;
    if (!steps.length || mid === undefined) continue;
    const lit = steps.filter(s => s > mid).length;
    const dark = steps.filter(s => s <= mid).length;
    if (lit > dark) { cel.set(x, y, -1); dropped++; }   // lit rim: value does the separating, not ink
  }

  // Shadow-side edge: the last pixel of a form on its right or bottom, where the form is dark.
  for (let y = cel.h - 1; y >= 0; y--) for (let x = cel.w - 1; x >= 0; x--) {
    const i = cel.get(x, y);
    if (i < 0) continue;
    const e = palette.entries[i];
    if (!e || !e.ramp || e.role !== "material") continue;
    const mid = midOf.get(e.ramp);
    if (mid === undefined || e.step > mid) continue;      // lit pixels do not get ink
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cel.w || ny >= cel.h) continue;
      if (cel.get(nx, ny) !== -1) continue;
      // Only the true outer edge: nothing else of any material further along that direction.
      let further = false;
      for (let k = 1; k <= 2; k++) {
        const j = at(nx + dx * k, ny + dy * k);
        if (j >= 0 && palette.entries[j]?.role === "material") { further = true; break; }
      }
      if (further) continue;
      cel.set(nx, ny, outlineIdx);
      added++;
    }
  }
  cel.meta = { ...cel.meta, reEdged: true, outlineDropped: dropped, outlineAdded: added };
  return cel;
}

/**
 * A part is a small authored cel plus the joint it hangs from. `pose` supplies an optional
 * hand-authored key-pose override; it replaces the base cel while inheriting its joint/pivot.
 * { name, cel, pose?, anchor: [x,y], role }
 */
class Skin {
  constructor(id, paletteId) { this.id = id; this.paletteId = paletteId; this.parts = new Map(); }
  add(direction, part) {
    if (!DIRECTIONS.includes(direction)) { const e = new Error(`unknown direction '${direction}'. Legal declared directions: ${DIRECTIONS.join(", ")}`); e.rule = "unknown_direction"; throw e; };
    if (part.anchorX === undefined) { const e = new Error(`part '${part.name}' has no anchor`); e.rule = "missing_anchor"; throw e; };
    if (part.pose !== undefined && (typeof part.pose !== "string" || !part.pose.trim())) { const e = new Error(`part '${part.name}' has an invalid pose variant`); e.rule = "bad_pose_variant"; throw e; };
    const key = part.pose ? `${direction}/@${part.pose}/${part.name}` : `${direction}/${part.name}`;
    this.parts.set(key, { ...part, direction });
    return this;
  }
  get(direction, name, pose = null) {
    const base = this.parts.get(`${direction}/${name}`);
    const variant = pose ? this.parts.get(`${direction}/@${pose}/${name}`) : null;
    return variant ? { ...base, ...variant } : base || variant;
  }
  forDirection(direction) {
    return [...this.parts.values()].filter(p => p.direction === direction);
  }
  /** Derive a mirrored facing from an authored one. */
  deriveMirror(target, source) {
    const src = MIRROR_OF[source];
    if (!src) { const e = new Error(`direction '${target}' cannot be mirrored; '${source}' has no horizontal mirror`); e.rule = "no_mirror_source"; throw e; };
    for (const p of this.forDirection(source)) {
      const mc = mirrorCel(p.cel, `${target}/${p.name}`);
      // relightMirrored(mc, paletteOf(this));
      // reEdgeMirrored(mc, paletteOf(this));
      // The offset must mirror too, or the part lands on the wrong side of the mirrored joint.
      const mo = p.anchorOffset ? [-p.anchorOffset[0] - p.cel.w + 1, p.anchorOffset[1]] : p.anchorOffset;
      this.add(target, {
        ...p, cel: mc, anchorOffset: mo, anchorX: p.cel.w - 1 - p.anchorX,
        ...(p.bindVector ? {bindVector:[-p.bindVector[0],p.bindVector[1]]} : {}),
        flip: !p.flip, derivedFrom: `${source}/${p.name}`,
      });
    }
    return this;
  }
  authoredDirections() {
    const s = new Set();
    for (const p of this.parts.values()) if (!p.derivedFrom) s.add(p.direction);
    return [...s];
  }
  derivedDirections() {
    const s = new Set();
    for (const p of this.parts.values()) if (p.derivedFrom) s.add(p.direction);
    return [...s];
  }
}

/**
 * A pose carries per-part joint intent (offsets, visibility, lean, bob) and selects any
 * direction/pose-specific cels from the skin. Large silhouette changes belong in those authored
 * cels, not in increasingly large translations.
 * { name, parts: { [partName]: { dx, dy, hide } }, lean, headBob, weight, note }
 */
class Pose {
  constructor(name, spec = {}) {
    this.name = name;
    this.parts = spec.parts || {};
    this.partPoses = spec.partPoses || {};  // select opposing limb key poses inside one whole-body frame
    this.dirMods = spec.dirMods || {};      // per-facing tweaks: a facing changes the stride, not the pose
    this.gait = spec.gait || null;           // heading-relative gait phase projected by the rig
    this.lean = spec.lean || 0;
    this.headBob = spec.headBob || 0;
    this.weight = spec.weight ?? 0;
    this.offset = spec.offset || [0, 0];
    this.note = spec.note || "";
    this.joints = spec.joints || {};
    this.skeleton = spec.skeleton || null;
    this.zOrder = spec.zOrder || null;
  }
  /** Modifiers for a facing, merged over the base pose per part. */
  modFor(partName, direction) {
    const base = this.parts[partName] || {};
    const dir = this.dirMods[direction]?.[partName];
    return dir ? { ...base, ...dir } : base;
  }
}

/** Project one local gait phase onto the screen axis of a facing. */
function projectGait(gait, direction, partName, defaultStride = 2) {
  if (!gait || !Number.isFinite(gait.phase)) return { dx: 0, dy: 0 };
  let factor = 0;
  if (/^leg_near$/i.test(partName)) factor = 1;
  else if (/^leg_far$/i.test(partName)) factor = -1;
  else if (/^arm_near$/i.test(partName) || /^blade$/i.test(partName)) factor = -1;
  else if (/^arm_far$/i.test(partName)) factor = 1;
  if (!factor) return { dx: 0, dy: 0 };
  const vector = DIRECTION_VECTORS[direction];
  if (!vector) return { dx: 0, dy: 0 };
  const distance = (gait.stride ?? defaultStride) * gait.phase * factor;
  return { dx: Math.round(vector[0] * distance), dy: Math.round(vector[1] * distance) };
}

/**
 * Compose one cel: skin parts placed per pose, in the direction's occlusion order.
 * Occlusion is explicit per direction — this is what prevents "merged limbs".
 */
function compose(skin, rig, pose, direction, opts = {}) {
  const w = opts.w ?? rig.canvas[0], h = opts.h ?? rig.canvas[1];
  const cel = new Cel(w, h, skin.paletteId, opts.name || `${pose.name}.${direction}`);
  let order = pose.zOrder?.[direction] || rig.zOrder[direction] || rig.zOrder.default;
  if (!order) { const e = new Error(`rig has no z-order for direction '${direction}'`); e.rule = "rig_incomplete"; throw e; };
  const baseAnchors = rig.anchors[direction];
  const anchors = baseAnchors ? { ...baseAnchors, ...pose.joints?.[direction] } : null;
  if (!anchors) { const e = new Error(`rig has no anchors for direction '${direction}'`); e.rule = "rig_incomplete"; throw e; };
  if (pose.skeleton?.depth?.[direction] && !pose.zOrder?.[direction]) {
    const depth = pose.skeleton.depth[direction];
    order = [...order].sort((a,b) => {
      const jointA = skin.get(direction,a,pose.partPoses[a] || pose.name)?.anchorJoint;
      const jointB = skin.get(direction,b,pose.partPoses[b] || pose.name)?.anchorJoint;
      const partA=skin.get(direction,a,pose.partPoses[a] || pose.name),partB=skin.get(direction,b,pose.partPoses[b] || pose.name);
      const zA=((depth[jointA] ?? 0)+(depth[partA?.endJoint] ?? depth[jointA] ?? 0))/2;
      const zB=((depth[jointB] ?? 0)+(depth[partB?.endJoint] ?? depth[jointB] ?? 0))/2;
      return zA-zB;
    });
  }

  const placed = [];
  const compositionParts = [];
  const collisions = [];
  const owner = new Map();          // pixel -> part name that last wrote it
  const classOf = (n) => (n.startsWith("leg") ? "leg" : n.startsWith("arm") ? "arm" : n);
  for (const partName of order) {
    const partPose = pose.partPoses[partName] || pose.name;
    const part = skin.get(direction, partName, partPose);
    if (!part) continue;
    const mod = pose.modFor(partName, direction);
    if (mod.hide) { placed.push({ partName, hidden: true }); compositionParts.push({ name: partName, hidden: true }); continue; }
    const joint = anchors[part.anchorJoint] ?? [part.anchorX, part.anchorY];
    const baseX = joint[0] + (part.anchorOffset?.[0] ?? 0);
    const baseY = joint[1] + (part.anchorOffset?.[1] ?? 0);
    const gait = projectGait(pose.gait, direction, partName, rig.gaitStride ?? 2);
    const dx = (mod.dx ?? 0) + gait.dx + (part.flip ? -1 : 1) * (pose.lean || 0) * (part.leanFactor ?? 0);
    const dy = (mod.dy ?? 0) + gait.dy + (part.bobFactor ? Math.round(pose.headBob * part.bobFactor) : 0);
    const gaitMode = rig.gaitParts?.[partName] || null;
    const boneEnd=part.endJoint?anchors[part.endJoint]:null;
    if(part.endJoint&&!boneEnd)throw Object.assign(new Error(`Missing end joint '${part.endJoint}'`),{rule:"rig_incomplete"});
    compositionParts.push({ name: partName, source: part.cel.name, poseVariant: part.pose || null,
      signature: `${celSignature(part.cel)}${boneEnd?`@bone:${boneEnd[0]-joint[0]},${boneEnd[1]-joint[1]}`:""}${gaitMode && (gait.dx || gait.dy) ? `@${gaitMode}:${gait.dx},${gait.dy}` : ""}`,
      at: [baseX + dx, baseY + dy], gait: gaitMode ? [gait.dx, gait.dy] : null, hidden: false });
    const out = new Cel(part.cel.w, part.cel.h, skin.paletteId, part.cel.name);
    out.idx = Int16Array.from(part.cel.idx);
    const hingeY = joint[1] - baseY;
    const distalSpan = Math.max(1, out.h - 1 - hingeY);
    const placePixel=(px,py,v)=>{
      if (!cel.inBounds(px, py)) return;
      const prev = owner.get(py * cel.w + px);
      if (prev !== undefined && classOf(prev) === classOf(partName) && prev !== partName) {
        // Overlap between two limbs of the same kind is NORMAL in a side view - the near leg
        // is in front of the far leg. It is only a defect when the boundary is invisible,
        // i.e. the two limbs are the same colour there and merge into one mass.
        const under = cel.get(px, py);
        const a = skin.paletteId ? paletteOf(skin)?.entries[under] : null;
        const b = paletteOf(skin)?.entries[v];
        const invisible = !a || !b || Math.abs(a.value - b.value) < 0.10;
        if (invisible && collisions.length < 40) collisions.push({ x: px, y: py, parts: [prev, partName], colours: [a?.name, b?.name] });
      }
      owner.set(py * cel.w + px, partName);
      cel.set(px, py, v);
    };
    if(boneEnd){
      for(const pixel of bonePixels(part,[joint[0]+dx,joint[1]+dy],[boneEnd[0]+dx,boneEnd[1]+dy],[w,h]))placePixel(pixel.x,pixel.y,pixel.index);
    } else for (let sy = 0; sy < out.h; sy++) for (let sx = 0; sx < out.w; sx++) {
      const v = out.idx[sy * out.w + sx];
      if (v === TRANSPARENT) continue;
      const t = gaitMode === "hinged" ? Math.max(0, Math.min(1, (sy - hingeY) / distalSpan)) : 0;
      const gx = gaitMode === "held" ? gait.dx : gaitMode === "hinged" ? Math.round(gait.dx * t) : 0;
      const gy = gaitMode === "held" ? gait.dy : gaitMode === "hinged" ? Math.round(gait.dy * t) : 0;
      placePixel(baseX+dx+sx+gx,baseY+dy+sy+gy,v);
    }
    placed.push({ partName, at: [baseX + dx, baseY + dy] });
  }
  cel.offset = pose.offset || [0, 0];
  // A derived facing is a mirror of an authored one. That is legitimate craft for the shape, but a
  // mirror mirrors the LIGHT with it, so the shading of a derived facing disagrees with a fixed
  // scene key light. Recording it here means every downstream report can say which facings are
  // authored and which still need to be, instead of emitting a generic light_direction error that
  // reads like a mistake in the drawing rather than a gap in the facing set.
  const derived = order.filter(n => skin.get(direction, n, pose.partPoses[n] || pose.name)?.derivedFrom).map(n => skin.get(direction, n, pose.partPoses[n] || pose.name).derivedFrom);
  cel.meta = { label: opts.label || `${pose.name}`, note: opts.note || pose.note, pose: pose.name, direction,
    gait: pose.gait ? { ...pose.gait, heading: direction } : null,
    placed: placed.map(p => p.partName), collisions, compositionParts,
    ...(pose.skeleton ? { skeleton: pose.skeleton } : {}),
    mirroredFacing: derived.length > 0, mirroredFrom: derived[0] || null };
  return cel;
}

function celSignature(cel) {
  // Stable, dependency-free fingerprint of authored part pixels. Position is stored separately so
  // the motion report can distinguish a pose-specific redraw from a part that was merely moved.
  let h = 0x811c9dc5;
  const mix = n => { h ^= n & 0xffff; h = Math.imul(h, 0x01000193) >>> 0; };
  mix(cel.w); mix(cel.h);
  for (const v of cel.idx) mix(v);
  return h.toString(16).padStart(8, "0");
}

/** Report whether a clip changes the authored parts its motion requires. */
function motionCoverage(frames, opts = {}) {
  const perPart = new Map();
  const normalized = frames.map(f => f.cel ? f : { cel: f });
  for (const f of normalized) {
    for (const p of f.cel.meta?.compositionParts || []) {
      if (p.hidden) continue;
      if (!perPart.has(p.name)) perPart.set(p.name, []);
      perPart.get(p.name).push({ signature: p.signature, at: p.at });
    }
  }
  const parts = [...perPart.entries()].map(([name, states]) => {
    const shapes = new Set(states.map(s => s.signature));
    const positions = new Set(states.map(s => `${s.at[0]},${s.at[1]}`));
    const first = states[0]?.at || [0, 0];
    const maxTravel = Math.max(0, ...states.map(s => Math.abs(s.at[0] - first[0]) + Math.abs(s.at[1] - first[1])));
    const shapeChanged = shapes.size > 1;
    const meaningful = shapeChanged || maxTravel >= (opts.minTravel ?? 2);
    return { name, frames: states.length, distinctPoses: new Set(states.map(s => `${s.signature}@${s.at[0]},${s.at[1]}`)).size,
      shapeVariants: shapes.size, shapeChanged, positionVariants: positions.size, maxTravel, meaningful };
  });
  const moving = new Set(parts.filter(p => p.meaningful).map(p => p.name));
  const expected = opts.expectedParts || (opts.template === "walk" ? ["legs", "arms"] : []);
  const groups = expected.map(group => {
    const re = group === "legs" ? /^leg/i : group === "arms" ? /^arm/i : new RegExp(group, "i");
    const members = parts.filter(p => re.test(p.name));
    return { group, parts: members.map(p => p.name), moving: members.filter(p => p.meaningful).map(p => p.name),
      shapeChanged: members.filter(p => p.shapeChanged).map(p => p.name), ok: members.length > 0 && members.some(p => p.meaningful) };
  });
  const findings = groups.filter(g => !g.ok).map(g => ({ rule: "missing_part_motion", part: g.group,
    message: g.parts.length ? `no ${g.group} part changes shape or travels at least ${opts.minTravel ?? 2}px across the clip` : `the rig has no authored ${g.group} parts` }));
  return { ok: findings.length === 0, frameCount: normalized.length, parts, groups, movingParts: [...moving],
    coverage: parts.length ? +(moving.size / parts.length).toFixed(2) : 0,
    shapeCoverage: parts.length ? +(parts.filter(p => p.shapeChanged).length / parts.length).toFixed(2) : 0, findings };
}

function blitOnto(dst, src, x, y, info = {}) {
  for (let sy = 0; sy < src.h; sy++) for (let sx = 0; sx < src.w; sx++) {
    const v = src.idx[sy * src.w + sx];
    if (v === TRANSPARENT) continue;
    const dx = x + sx, dy = y + sy;
    if (!dst.inBounds(dx, dy)) continue;
    const existing = dst.get(dx, dy);
    if (existing !== TRANSPARENT && existing !== v) {
      // Two parts fighting for the same pixel. Not an error in itself — but it is where
      // "merged limbs" hide, so it is recorded rather than silently overwritten.
      info.collisions = info.collisions || [];
      if (info.collisions.length < 20) info.collisions.push({ x: dx, y: dy, part: info.partName, over: existing, to: v });
    }
    dst.set(dx, dy, v);
  }
  return info.collisions || [];
}

/**
 * loop_validate is an export gate, not a report. A clip that fails it does not ship.
 */
function loopValidate(frames, opts = {}) {
  const problems = [];
  const info = [];
  if (!frames.length) return { ok: false, problems: ["no frames"], info };

  const boxes = frames.map(f => f.cel.bbox());
  if (boxes.some(b => !b)) problems.push("one or more frames are empty");

  // foot baseline stability: the character must not slide or float
  const feet = frames.map(f => { const b = f.cel.bbox(); return b ? b.y1 : null; });
  const footSpread = Math.max(...feet.filter(v => v !== null)) - Math.min(...feet.filter(v => v !== null));
  info.footSpread = footSpread;
  if (footSpread > (opts.maxFootSpread ?? 1))
    problems.push(`foot baseline moves ${footSpread}px across the cycle — the character is floating or sinking`);

  // horizontal anchor: a walking character pivots around the hip, it does not teleport
  const cx = frames.map(f => { const b = f.cel.bbox(); return b ? (b.x0 + b.x1) / 2 : null; });
  const cxSpread = Math.max(...cx.filter(v => v !== null)) - Math.min(...cx.filter(v => v !== null));
  info.anchorSpread = +cxSpread.toFixed(2);
  if (cxSpread > (opts.maxAnchorSpread ?? 3))
    problems.push(`silhouette centre shifts ${cxSpread.toFixed(1)}px — reads as sliding, not stepping`);

  // silhouette area stability: volume must be preserved between key poses
  const areas = frames.map(f => (f.cel.bbox() || { area: 0 }).area);
  info.areas = areas;
  const aSpread = Math.max(...areas) - Math.min(...areas);
  const aRatio = aSpread / Math.max(1, Math.round(areas.reduce((s, v) => s + v, 0) / areas.length));
  info.areaSpread = aSpread; info.areaRatio = +aRatio.toFixed(2);
  if (aRatio > (opts.maxAreaRatio ?? 0.28))
    problems.push(`silhouette area varies ${aSpread}px (${(aRatio*100).toFixed(0)}%) across the cycle — the character inflates and deflates`);

  // merged limbs: near and far limb pixels overlapping each other
  const collisions = frames.flatMap(f => f.collisions || []);
  info.collisions = collisions.length;
  if (collisions.length > (opts.maxCollisions ?? 10))
    problems.push(`${collisions.length} part-boundary collisions across the cycle — limbs are merging into one mass`);

  // cycle continuity: last frame must hand off smoothly to the first
  const a = frames[frames.length - 1].cel, b = frames[0].cel;
  let delta = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (a.get(x, y) !== b.get(x, y)) delta++;
  info.loopDelta = delta;
  const avg = frames.reduce((s, f, i) => {
    if (i === 0) return 0;
    let d = 0; for (let y = 0; y < f.cel.h; y++) for (let x = 0; x < f.cel.w; x++) if (f.cel.get(x,y) !== frames[i-1].cel.get(x,y)) d++;
    return s + d;
  }, 0) / Math.max(1, frames.length - 1);
  info.avgFrameDelta = Math.round(avg);
  if (delta > avg * (opts.loopTolerance ?? 2.6))
    problems.push(`loop seam is ${delta} pixels of change vs an average step of ${Math.round(avg)} — the cycle will stutter on repeat`);

  // duplicate frames: a cycle with two identical frames is a held frame pretending to be animation
  const seen = new Map();
  frames.forEach((f, i) => { const k = f.cel.toGridRows().join("|"); if (seen.has(k)) problems.push(`frames ${seen.get(k)} and ${i} are pixel-identical`); else seen.set(k, i); });

  if (opts.poses) {
    const names = frames.map(f => f.poseName);
    if (names.join(",") !== opts.poses.join(",")) problems.push(`pose order is ${names.join(",")}, expected ${opts.poses.join(",")}`);
  }
  if (opts.requireCounterSwing) {
    const armKeys = new Set(frames.flatMap(f => Object.keys(f.pose?.parts || {})).filter(k => /^arm/i.test(k)));
    const projectedGait = frames.some(f => {
      const gait = f.pose?.gait || f.cel.meta?.gait;
      return gait && Number.isFinite(gait.phase);
    });
    if (armKeys.size < 2 && !projectedGait)
      problems.push(`only ${armKeys.size} arm part(s) move across the cycle — a walk without arm counter-swing reads as a sliding mannequin`);
    if (frames.some(f => f.cel.meta?.compositionParts?.length)) {
      const motion = motionCoverage(frames, { template: "walk" });
      info.motionCoverage = motion;
      problems.push(...motion.findings.map(f => f.message));
    }
  }

  if (frames.some(f => f.cel.meta?.skeleton)) {
    if (frames.some(f => !f.cel.meta?.skeleton)) problems.push("Only some frames carry solved skeleton contacts");
    else {
      const contact = require("./skeleton.js").contactReport(frames.map(f => f.cel.meta.skeleton));
      info.contacts = contact;
      if (!contact.ok) problems.push(contact.measured_contacts ? "Planted feet drift or leave the ground plane" : "Skeleton clip has no declared planted contacts");
    }
  }
  return { ok: problems.length === 0, problems, info };
}

module.exports = { DIRECTIONS, DIRECTION_VECTORS, CARDINALS, MIRROR_OF, WALK_POSES, Skin, Pose, projectGait, compose, mirrorCel, loopValidate, motionCoverage, blitOnto, registerPalette, paletteOf };
