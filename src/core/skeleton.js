"use strict";
const { refuse } = require("./storage.js");
const { DIRECTIONS } = require("./rig.js");
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, t) => a.map((v) => v * t);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const length = (a) => Math.hypot(...a);
function point(p) {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))
    refuse(
      "skeleton_point",
      "Joint coordinates must be finite [lateral, forward, height] triples",
    );
  return [...p];
}
function unit(p) {
  const n = length(p);
  if (n < 1e-9)
    refuse("skeleton_axis", "A bone or bend direction has zero length");
  return mul(p, 1 / n);
}

function resolveJoints(spec) {
  const joints = {},
    visiting = new Set();
  function resolve(id) {
    if (joints[id]) return joints[id];
    if (visiting.has(id))
      refuse("skeleton_cycle", `Joint hierarchy contains a cycle at '${id}'`);
    if (!Object.hasOwn(spec.joints || {}, id))
      refuse("skeleton_joint", `Missing joint '${id}'`);
    visiting.add(id);
    const value = spec.joints[id];
    joints[id] = Array.isArray(value)
      ? point(value)
      : add(resolve(value.parent), point(value.offset));
    visiting.delete(id);
    return joints[id];
  }
  for (const id of Object.keys(spec.joints || {})) resolve(id);
  if (!Object.keys(joints).length)
    refuse("skeleton_empty", "A skeleton needs named joints");
  return joints;
}
function validateSkeleton(spec) {
  const joints = resolveJoints(spec),
    used = new Set();
  if (!(spec.chains || []).length)
    refuse("skeleton_empty", "Declare at least one two-bone joint chain");
  for (const c of spec.chains) {
    if (
      ![c.root, c.mid, c.tip].every((id) => Object.hasOwn(joints, id)) ||
      new Set([c.root, c.mid, c.tip]).size !== 3
    )
      refuse(
        "skeleton_chain",
        "Each chain needs three distinct existing joints: root, mid, tip",
      );
    if (used.has(c.mid) || used.has(c.tip))
      refuse(
        "skeleton_chain",
        "Chains may share roots, but cannot solve the same middle or tip joint twice",
      );
    used.add(c.mid);
    used.add(c.tip);
    const sizes = c.lengths || [
      length(sub(joints[c.mid], joints[c.root])),
      length(sub(joints[c.tip], joints[c.mid])),
    ];
    if (sizes.length !== 2 || !sizes.every((n) => Number.isFinite(n) && n > 0))
      refuse("skeleton_length", "Bone lengths must be positive finite numbers");
    if (
      (c.min_bend ?? 0) < 0 ||
      (c.max_bend ?? 165) > 180 ||
      (c.min_bend ?? 0) > (c.max_bend ?? 165)
    )
      refuse(
        "skeleton_limit",
        "Bend limits must satisfy 0 <= min_bend <= max_bend <= 180 degrees",
      );
    if (c.bend) unit(point(c.bend));
  }
  return joints;
}

// World-space two-bone IK. Zero bend is straight. The bend plane is explicit,
// so knees cannot choose a different side from frame to frame.
function solveChain(root, target, sizes, bend, limits) {
  const [l1, l2] = sizes,
    delta = sub(target, root),
    d = length(delta);
  const min = (limits[0] * Math.PI) / 180,
    max = (limits[1] * Math.PI) / 180;
  const reach = (angle) =>
    Math.sqrt(Math.max(0, l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(angle)));
  if (d < 1e-8 || d < reach(max) - 1e-6 || d > reach(min) + 1e-6)
    refuse(
      "unreachable_target",
      `Target distance ${d.toFixed(3)} is outside the chain's allowed reach [${reach(max).toFixed(3)}, ${reach(min).toFixed(3)}]`,
    );
  const axis = unit(delta);
  let side = sub(bend, mul(axis, dot(bend, axis)));
  if (length(side) < 1e-6) {
    const fallback = Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    side = sub(fallback, mul(axis, dot(fallback, axis)));
  }
  side = unit(side);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const mid = add(root, add(mul(axis, along), mul(side, height)));
  return {
    mid,
    tip: [...target],
    bend_degrees:
      (Math.acos(
        Math.max(-1, Math.min(1, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2))),
      ) *
        180) /
      Math.PI,
  };
}
function solve(spec, pose = {}) {
  const rest = validateSkeleton(spec),
    motion = point(pose.root_motion || [0, 0, 0]);
  const joints = Object.fromEntries(
    Object.entries(rest).map(([id, p]) => [id, add(p, motion)]),
  );
  const contacts = pose.contacts || {},
    targets = pose.targets || {},
    diagnostics = [];
  for (const id of Object.keys(targets)) {
    if (!spec.chains.some((c) => c.tip === id))
      refuse(
        "skeleton_joint",
        `Target '${id}' is not a chain tip; move the body using root_motion`,
      );
    point(targets[id]);
  }
  for (const [id, c] of Object.entries(contacts)) {
    if (
      !Object.hasOwn(rest, id) ||
      !spec.chains.some((chain) => chain.tip === id)
    )
      refuse("skeleton_contact", `Contact '${id}' is not a chain tip`);
    point(c.point);
    if (c.planted && Math.abs(c.point[2]) > 1e-6)
      refuse(
        "skeleton_ground",
        `Planted contact '${id}' must be on the z=0 ground plane`,
      );
  }
  for (const c of spec.chains) {
    const sizes = c.lengths || [
      length(sub(rest[c.mid], rest[c.root])),
      length(sub(rest[c.tip], rest[c.mid])),
    ];
    const contact = contacts[c.tip],
      target = contact?.planted
        ? contact.point
        : targets[c.tip] || joints[c.tip];
    const result = solveChain(
      joints[c.root],
      point(target),
      sizes,
      c.bend || [0, 1, 0],
      [c.min_bend ?? 0, c.max_bend ?? 165],
    );
    joints[c.mid] = result.mid;
    joints[c.tip] = result.tip;
    const errors = [
      Math.abs(length(sub(joints[c.mid], joints[c.root])) - sizes[0]),
      Math.abs(length(sub(joints[c.tip], joints[c.mid])) - sizes[1]),
    ];
    diagnostics.push({
      chain: c.id || c.tip,
      bend: result.bend_degrees,
      bone_length_error: Math.max(...errors),
      planted: !!contact?.planted,
      contact_error: contact?.planted
        ? length(sub(joints[c.tip], contact.point))
        : null,
    });
  }
  return { joints, root_motion: motion, contacts, diagnostics };
}
function project(joints, direction, camera = {}) {
  const facing = DIRECTIONS.indexOf(direction);
  if (facing < 0)
    refuse("skeleton_direction", `Unknown direction '${direction}'`);
  const angle = (facing * Math.PI) / 4,
    co = Math.cos(angle),
    si = Math.sin(angle),
    scale = camera.scale ?? 1,
    depthScale = camera.depth_scale ?? 0.5,
    origin = camera.origin || [16, 36];
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(depthScale) ||
    depthScale < 0 ||
    !Array.isArray(origin) ||
    origin.length !== 2 ||
    !origin.every(Number.isFinite)
  )
    refuse(
      "skeleton_camera",
      "Camera needs positive scale, nonnegative depth_scale, and a finite origin pair",
    );
  const projected = {},
    depth = {};
  for (const [id, p] of Object.entries(joints)) {
    const [x, y, z] = point(p),
      screenX = x * co + y * si,
      screenDepth = -x * si + y * co;
    projected[id] = [
      Math.round(origin[0] + screenX * scale),
      Math.round(origin[1] + screenDepth * depthScale * scale - z * scale),
    ];
    depth[id] = screenDepth;
  }
  return { joints: projected, depth };
}
function contactReport(poses, tolerance = 0.01) {
  const problems = [],
    feet = {},
    previous = new Map();
  let measured = 0;
  poses.forEach((pose, i) => {
    for (const [id, c] of Object.entries(pose.contacts || {})) {
      if (!c.planted) {
        previous.delete(id);
        continue;
      }
      measured++;
      const p = pose.joints[id],
        groundError = Math.abs(p[2]),
        pinError = length(sub(p, c.point));
      const last = previous.get(id),
        drift = last && last.frame === i - 1 ? length(sub(p, last.point)) : 0;
      (feet[id] ||= []).push({
        frame: i,
        ground_error: groundError,
        pin_error: pinError,
        planted_drift: drift,
      });
      if (Math.max(groundError, pinError, drift) > tolerance)
        problems.push({
          frame: i,
          foot: id,
          ground_error: groundError,
          pin_error: pinError,
          planted_drift: drift,
        });
      previous.set(id, { frame: i, point: p });
    }
  });
  return {
    ok: measured > 0 && problems.length === 0,
    measured_contacts: measured,
    feet,
    problems,
    note: measured
      ? "Contacts measured in world space, including root movement"
      : "No planted contacts declared; foot locking is unmeasured",
  };
}
module.exports = {
  validateSkeleton,
  resolveJoints,
  solveChain,
  solve,
  project,
  contactReport,
};
