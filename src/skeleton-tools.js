"use strict";
const skeleton = require("./core/skeleton.js");
const rig = require("./core/rig.js");
const { Cel } = require("./core/cel.js");
const ops = require("./core/ops.js");
const render = require("./render.js");
const {
  define,
  str,
  obj,
  arr,
  tuple,
  num,
  bool,
  dir,
} = require("./contracts.js");

function register({ tool, W, ok, bad }) {
  const state = () => {
    W.needProject();
    return W.production;
  };
  tool(
    "skeleton_define",
    "Declare hierarchical world-space joints, two-bone chains, bend planes and limits.",
    (a) => {
      skeleton.validateSkeleton(a.spec);
      if (["__proto__", "constructor", "prototype"].includes(a.id))
        return bad("invalid_name", "Reserved skeleton id");
      state().skeletons[a.id] = a.spec;
      return ok({
        skeleton: a.id,
        joints: Object.keys(a.spec.joints),
        chains: a.spec.chains.length,
      });
    },
  );
  tool(
    "skeleton_pose",
    "Solve joint chains and planted feet, project all eight facings, and save an authored pose for skin_pose.",
    (a) => {
      const spec = state().skeletons[a.skeleton];
      if (!spec) return bad("no_skeleton", `No skeleton '${a.skeleton}'`);
      const solved = skeleton.solve(spec, a),
        joints = {},
        depth = {};
      for (const d of rig.DIRECTIONS) {
        const projected = skeleton.project(
          solved.joints,
          d,
          a.camera || spec.camera,
        );
        joints[d] = projected.joints;
        depth[d] = projected.depth;
      }
      const pose = new rig.Pose(a.name, { ...a.spec, joints });
      pose.skeleton = { ...solved, id: a.skeleton, depth };
      W.poses.set(a.name, pose);
      return ok({
        pose: a.name,
        ...solved,
        projected: joints,
        note: "Attach authored upper and lower limb cels to these joints. Pixel corrections and facing-specific poses remain editable.",
      });
    },
  );
  tool(
    "skeleton_contacts",
    "Measure planted-foot drift and ground errors across saved poses, including root movement.",
    (a) => {
      const poses = a.poses.map((id) => W.poses.get(id)?.skeleton);
      if (poses.some((p) => !p))
        return bad(
          "no_skeleton_pose",
          "Every pose must be solved with skeleton_pose",
        );
      return ok(skeleton.contactReport(poses, a.tolerance));
    },
  );
  tool(
    "skeleton_preview",
    "Render a pose skeleton over an optional authored cel and return named joints and ground contacts.",
    (a) => {
      const pose = W.poses.get(a.pose),
        spec = state().skeletons[pose?.skeleton?.id];
      if (!pose?.skeleton || !spec)
        return bad("no_skeleton_pose", `No solved pose '${a.pose}'`);
      const p = W.palette(a.palette),
        joints = pose.joints[a.direction],
        base = a.cel ? W.store.get(a.cel) : null;
      const cel = base
        ? base.clone()
        : new Cel(a.w || 32, a.h || 40, a.palette, `skeleton.${a.pose}`);
      const idx =
        a.idx === undefined
          ? p.size - 1
          : typeof a.idx === "string"
            ? p.index(a.idx)
            : a.idx;
      for (const c of spec.chains)
        for (const [u, v] of [
          [c.root, c.mid],
          [c.mid, c.tip],
        ])
          ops.draw_line(cel, joints[u], joints[v], idx);
      const result = render.renderCel(cel, p, { zoom: a.zoom || 12 });
      return ok({
        image: W.saveRender(`skeleton.${a.pose}.${a.direction}`, result.buffer)
          .path,
        joints,
        contacts: pose.skeleton.contacts,
        diagnostics: pose.skeleton.diagnostics,
      });
    },
  );
  define("skeleton_define", "id! spec!", "animation", [], {
    spec: {
      type: "object",
      properties: {
        joints: obj,
        chains: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              id: str,
              root: str,
              mid: str,
              tip: str,
              bend: tuple(3),
              lengths: tuple(2),
              min_bend: num,
              max_bend: num,
            },
            required: ["root", "mid", "tip"],
            additionalProperties: false,
          },
        },
        camera: obj,
      },
      required: ["joints", "chains"],
      additionalProperties: false,
    },
  });
  define(
    "skeleton_pose",
    "skeleton! name! targets contacts root_motion camera spec",
    "animation",
    [],
    {
      skeleton: str,
      targets: { type: "object", additionalProperties: tuple(3) },
      contacts: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: { point: tuple(3), planted: bool },
          required: ["point", "planted"],
          additionalProperties: false,
        },
      },
      root_motion: tuple(3),
      camera: obj,
    },
  );
  define("skeleton_contacts", "poses! tolerance", "animation");
  define(
    "skeleton_preview",
    "pose! palette! direction! cel w h zoom idx",
    "animation",
  );
}
module.exports = { register };
