"use strict";
const { hashCel, refuse } = require("./core/storage.js");
const session = require("./core/session.js");
const { diff } = require("./core/cel.js");
const { charFor } = require("./core/cel.js");
const { audit } = require("./audit.js");
const render = require("./render.js");
const contracts = require("./contracts.js");
const { createHash } = require("crypto");

const STAGES = [
  "brief",
  "silhouette",
  "blocking",
  "lighting",
  "detail",
  "motion",
  "review",
  "complete",
];
const NEXT = {
  brief:
    "Declare canvas, palette, silhouette intent, focal feature and constraints; propose distinct silhouettes.",
  silhouette:
    "Compare silhouettes at native scale; record the chosen design before adding detail.",
  blocking:
    "Separate the main forms using named materials and masks. Check readability at game scale.",
  lighting:
    "Model the forms using the declared material ramps and a consistent light direction.",
  detail:
    "Add only details that support the focal feature. Compare with the approved silhouette.",
  motion:
    "Author key poses, review every facing and contact phase, and check foot locking.",
  review:
    "Render a review bundle; resolve defects; record an independent visual acceptance decision.",
  complete:
    "Export with the mechanical gate and retain the review record alongside the asset.",
};
const EDITS = new Set([
  "draw_pixel_map",
  "draw_named_map",
  "put",
  "fill_region",
  "draw_line",
  "draw_shape",
  "stroke_shape",
  "paint_form",
  "aa_pass",
  "dither_pass",
  "outline_pass",
  "specular_pass",
  "contact_shadow",
  "cast_shadow",
  "glow",
  "shift_along_ramp",
  "replace_color",
  "erase",
  "annotate",
]);

function register({ tool, TOOLS, W, celOf, paletteOfCel, ok, bad }) {
  function state() {
    W.needProject();
    return (W.production ||= { assets: {}, masks: {}, skeletons: {} });
  }
  function asset(id) {
    const a = state().assets[id];
    if (!a) refuse("no_asset", `No workflow '${id}'; call asset_begin first`);
    return a;
  }
  function reviewHash(cel) {
    return createHash("sha256")
      .update(cel.toGrid())
      .update(JSON.stringify(paletteOfCel(cel).toManifest()))
      .digest("hex");
  }
  const key = (cel, name) => `${cel}::${name}`;
  const safeName = (value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      ["__proto__", "constructor", "prototype"].includes(value)
    )
      refuse("invalid_name", "Expected a nonempty, non-reserved name");
    return value;
  };
  tool(
    "draw_named_map",
    "Author rows with your own simple symbols mapped to palette colour names; dot is transparent and space preserves pixels.",
    (a) => {
      const { cel, id } = celOf(a),
        p = paletteOfCel(cel),
        rows = typeof a.map === "string" ? a.map.split(/\r?\n/) : a.map,
        compiled = [];
      for (const row of rows) {
        let output = "";
        for (const symbol of row) {
          if (symbol === "." || symbol === " ") {
            output += symbol;
            continue;
          }
          if (!Object.hasOwn(a.legend, symbol))
            return bad("unknown_symbol", `No colour mapping for '${symbol}'`);
          const value = a.legend[symbol],
            index = typeof value === "string" ? p.index(value) : value;
          if (!Number.isInteger(index) || index < 0 || index >= p.size)
            return bad(
              "off_palette",
              `Symbol '${symbol}' references an undeclared palette colour`,
            );
          output += charFor(index);
        }
        compiled.push(output);
      }
      return TOOLS.draw_pixel_map.run({
        cel: id,
        map: compiled,
        x: a.x,
        y: a.y,
        expected_hash: a.expected_hash,
      });
    },
  );
  tool(
    "tool_help",
    "Get a tool's exact schema, working examples, and group before calling it.",
    (a) => {
      const t = Object.hasOwn(TOOLS, a.tool) ? TOOLS[a.tool] : null;
      if (!t) return bad("unknown_tool", `No tool '${a.tool}'`);
      return ok({
        name: a.tool,
        description: t.describe,
        inputSchema: t.inputSchema,
        examples: t.examples,
        group: t.group,
      });
    },
  );
  tool(
    "tool_search",
    "Find tools by name, description, or group. Use tool_help for the selected tool's arguments.",
    (a) => {
      const words = a.query.toLowerCase().split(/\s+/);
      const matches = Object.entries(TOOLS).filter(
        ([n, t]) =>
          (!a.group || t.group === a.group) &&
          words.every((w) => `${n} ${t.describe}`.toLowerCase().includes(w)),
      );
      return ok({
        total: matches.length,
        tools: matches.slice(0, a.limit || 8).map(([name, t]) => ({
          name,
          description: t.describe,
          group: t.group,
        })),
      });
    },
  );
  tool(
    "tool_call",
    "Call a discovered expert tool using its tool_help schema. All arguments are validated.",
    (a) => {
      if (["tool_call", "edit_batch"].includes(a.tool))
        return bad("nested_call", "Nested dispatch is not supported");
      return require("./execute.js").execute(a.tool, a.arguments);
    },
  );
  tool(
    "asset_begin",
    "Save an original art brief, constraints, references to owned cels, and workflow stage.",
    (a) => {
      const id = safeName(a.asset);
      if (state().assets[id])
        return bad(
          "asset_exists",
          `Workflow '${id}' already exists; use asset_status`,
        );
      const item = {
        id,
        brief: a.brief,
        constraints: a.constraints || [],
        cels: a.cels || [],
        animated: !!a.animated,
        stage: "brief",
        decisions: [],
        reviews: [],
        defects: [],
        updated: new Date().toISOString(),
      };
      state().assets[id] = item;
      return ok({ asset: item, next_action: NEXT.brief });
    },
  );
  tool(
    "asset_status",
    "Resume a brief with saved decisions, defects, taste, next action and current cel hashes.",
    (a) => {
      const item = asset(a.asset);
      const cels = item.cels.map((id) => {
        try {
          return { id, hash: hashCel(celOf({ cel: id }).cel) };
        } catch {
          return { id, missing: true };
        }
      });
      return ok({
        asset: item,
        cels,
        next_action: NEXT[item.stage],
        taste: TOOLS.taste_read.run({}),
      });
    },
  );
  tool(
    "asset_advance",
    "Advance one art stage with evidence. Completion requires a current accepted visual review and clean mechanical checks.",
    (a) => {
      const item = asset(a.asset),
        next = STAGES.indexOf(item.stage) + 1;
      const wanted = a.stage;
      const allowed =
        STAGES[next] === "motion" && !item.animated ? "review" : STAGES[next];
      if (wanted !== allowed)
        return bad(
          "stage_order",
          `Next stage is '${allowed}'; record evidence before advancing`,
        );
      if (wanted === "complete") {
        if (!item.cels.length)
          return bad("no_art", "Attach the authored cels before completion");
        const hashes = item.cels.map((id) =>
          reviewHash(celOf({ cel: id }).cel),
        );
        const review = item.reviews.at(-1);
        if (
          item.defects.length ||
          review?.verdict !== "accepted" ||
          JSON.stringify(review.hashes) !== JSON.stringify(hashes)
        )
          return bad(
            "visual_review_required",
            "Resolve defects and record acceptance for the current pixels before completion",
          );
        for (const id of item.cels) {
          const c = celOf({ cel: id }).cel;
          if (!audit(c, { palette: paletteOfCel(c) }).mechanical.ok)
            return bad(
              "mechanical_gate",
              `Cel '${id}' has unresolved correctness errors`,
            );
        }
        if (item.animated && !a.clip)
          return bad(
            "animation_review_required",
            "Pass the reviewed clip for animation validation",
          );
        if (a.clip) {
          const check = TOOLS.loop_validate.run({ clip: a.clip });
          if (!check.ok) return check;
        }
      }
      item.decisions.push({
        stage: item.stage,
        evidence: a.evidence,
        at: new Date().toISOString(),
      });
      item.stage = wanted;
      item.updated = new Date().toISOString();
      return ok({ asset: item, next_action: NEXT[wanted] });
    },
  );
  tool(
    "asset_review",
    "Record visual acceptance or rejection, reviewer, evidence, defects and the exact reviewed pixel hashes.",
    (a) => {
      const item = asset(a.asset);
      if (a.cels) item.cels = a.cels;
      const hashes = item.cels.map((id) => reviewHash(celOf({ cel: id }).cel));
      const review = {
        verdict: a.verdict,
        reviewer: a.reviewer,
        evidence: a.evidence,
        hashes,
        at: new Date().toISOString(),
      };
      item.reviews.push(review);
      item.defects = a.defects || [];
      return ok({ review, defects: item.defects, visual_approval: a.verdict });
    },
  );
  tool(
    "mask_define",
    "Name an editable pixel region; optionally protect it against all drawing operations.",
    (a) => {
      const { cel, id } = celOf(a);
      const name = safeName(a.name);
      const cells = [];
      if (a.region) {
        const r = a.region,
          x = r.x ?? r.x0,
          y = r.y ?? r.y0,
          w = r.w ?? r.x1 - x + 1,
          h = r.h ?? r.y1 - y + 1;
        if (x < 0 || y < 0 || x + w > cel.w || y + h > cel.h)
          return bad("mask_bounds", "Mask region leaves the canvas");
        for (let py = y; py < y + h; py++)
          for (let px = x; px < x + w; px++) cells.push([px, py]);
      } else
        for (const [x, y] of a.pixels || []) {
          if (!cel.inBounds(x, y))
            return bad("mask_bounds", `Mask pixel ${x},${y} leaves the canvas`);
          cells.push([x, y]);
        }
      if (!cells.length)
        return bad("empty_mask", "Supply a region or explicit pixels");
      state().masks[key(id, name)] = {
        cel: id,
        name,
        canvas: [cel.w, cel.h],
        pixels: cells,
        protect: !!a.protect,
      };
      return ok({ mask: name, pixels: cells.length, protected: !!a.protect });
    },
  );
  tool(
    "mask_list",
    "List named pixel masks and protection state for a cel.",
    (a) => {
      const { id } = celOf(a);
      return ok({
        masks: Object.values(state().masks)
          .filter((m) => m.cel === id)
          .map((m) => ({
            name: m.name,
            pixels: m.pixels.length,
            protect: m.protect,
          })),
      });
    },
  );
  tool(
    "mask_protect",
    "Lock or unlock a named region before applying edits.",
    (a) => {
      const { id } = celOf(a),
        mask = state().masks[key(id, a.mask)];
      if (!mask) return bad("no_mask", `No mask '${a.mask}'`);
      mask.protect = a.protect;
      return ok({ mask: a.mask, protected: mask.protect });
    },
  );
  tool(
    "mask_edit",
    "Repaint or shift material ramp steps inside one named mask; other pixels remain untouched.",
    (a) => {
      const { cel, id } = celOf(a),
        mask = state().masks[key(id, a.mask)];
      if (!mask) return bad("no_mask", `No mask '${a.mask}'`);
      const p = paletteOfCel(cel),
        cells = [];
      for (const [x, y] of mask.pixels) {
        const before = cel.get(x, y);
        if (before < 0 && a.idx === undefined) continue;
        let to =
          a.idx === undefined
            ? before
            : typeof a.idx === "string"
              ? p.index(a.idx)
              : a.idx;
        if (a.steps !== undefined && before >= 0) {
          const entry = p.entries[before],
            ramp = p.ramp(entry.ramp);
          if (!ramp.length)
            return bad("no_ramp", `Pixel ${x},${y} is outside a material ramp`);
          to =
            ramp[Math.max(0, Math.min(ramp.length - 1, entry.step + a.steps))];
        }
        if (!Number.isInteger(to) || to < -1 || to >= p.size)
          return bad("off_palette", "Mask edit references an invalid colour");
        cells.push({ x, y, to });
      }
      return TOOLS.put.run({ cel: id, cells });
    },
  );
  tool(
    "edit_batch",
    "Apply drawing operations atomically. Any refused edit rolls the entire batch back, including undo and provenance.",
    (a) => {
      for (const operation of a.operations) {
        if (!EDITS.has(operation.tool) && operation.tool !== "mask_edit")
          return bad(
            "batch_tool",
            `Tool '${operation.tool}' cannot be used in an edit batch`,
          );
        const errors = contracts.validate(
          TOOLS[operation.tool].inputSchema,
          operation.arguments,
        );
        if (errors.length) return bad("invalid_arguments", errors.join("; "));
      }
      const before = session.capture(W),
        records = [],
        record = W.project.record;
      W.project.record = (...args) => {
        records.push(args);
      };
      try {
        const results = [];
        for (const operation of a.operations) {
          if (
            operation.arguments.expected_hash &&
            hashCel(celOf(operation.arguments).cel) !==
              operation.arguments.expected_hash
          ) {
            session.restore(W, before);
            return bad(
              "stale_cel",
              "A batch operation targets an outdated cel",
              { rolled_back: true },
            );
          }
          const result = TOOLS[operation.tool].run(operation.arguments);
          if (result.ok === false) {
            session.restore(W, before);
            return { ...result, rolled_back: true };
          }
          results.push(result);
        }
        W.project.record = record;
        for (const args of records) record.apply(W.project, args);
        return ok({ results, atomic: true });
      } catch (e) {
        session.restore(W, before);
        return bad(e.rule || "batch_failed", e.message, { rolled_back: true });
      } finally {
        W.project.record = record;
      }
    },
  );
  tool(
    "quality_report",
    "Report correctness and style diagnostics separately from recorded visual acceptance.",
    (a) => {
      const { cel } = celOf(a),
        p = paletteOfCel(cel);
      const report = audit(cel, {
        palette: p,
        style: a.style ? W.styleOf(a.style) : null,
        assetClass: a.asset_class,
        allow_disconnected: a.allow_disconnected,
      });
      const review = a.asset ? asset(a.asset).reviews.at(-1) : null;
      const current = review?.hashes.includes(reviewHash(cel));
      return ok({
        mechanical: report.mechanical,
        diagnostics: report.findings.filter((f) => f.category !== "mechanical"),
        heuristic: report.craft,
        visual: {
          status: current ? review.verdict : "unreviewed",
          reviewer: current ? review.reviewer : null,
        },
        note: "Heuristic measurements are diagnostics; they do not establish visual quality.",
      });
    },
  );
  tool(
    "review_bundle",
    "PNG reviews for native scale, silhouette, value, and detail, plus the exact reviewed cel hash.",
    (a) => {
      const { cel } = celOf(a),
        p = paletteOfCel(cel);
      const images = [];
      for (const mode of ["view", "silhouette", "value_map"]) {
        const r = render.renderCel(cel, p, {
          mode,
          zoom: a.zoom || 10,
          legend: false,
        });
        images.push({
          mode,
          image: W.saveRender(`bundle.${cel.name}.${mode}`, r.buffer).path,
        });
      }
      const game = render.renderGameScale(cel, p, { zoom: 1 });
      images.push({
        mode: "game_scale",
        image: W.saveRender(`bundle.${cel.name}.game`, game.buffer).path,
      });
      return ok({
        images,
        hash: reviewHash(cel),
        cel_hash: hashCel(cel),
        grid: a.include_grid ? render.gridText(cel) : undefined,
        questions: [
          "Is the silhouette and focal feature readable at native scale?",
          "Does the form, light and motion express the brief?",
        ],
      });
    },
  );

  const { define, str, obj, arr, bool, choice, point, int } = contracts;
  define(
    "draw_named_map",
    "cel! map! legend! x y expected_hash",
    "drawing",
    [],
    {
      legend: {
        type: "object",
        additionalProperties: { type: ["string", "integer"] },
      },
    },
    {
      cel: "lantern.base",
      map: ["..rr..", ".rWWr.", "..rr.."],
      legend: { r: "stone.0", W: "light.1" },
    },
  );
  define("tool_help", "tool!", "discovery");
  define("tool_search", "query! group limit", "discovery", [], {
    limit: { ...int, minimum: 1, maximum: 20 },
  });
  define("tool_call", "tool! arguments!", "discovery");
  define(
    "asset_begin",
    "asset! brief! constraints cels animated",
    "workflow",
    [],
    { animated: bool },
  );
  define("asset_status", "asset!", "workflow");
  define("asset_advance", "asset! stage! evidence! clip", "workflow", [], {
    stage: choice(...STAGES),
  });
  define(
    "asset_review",
    "asset! verdict! reviewer! evidence! defects cels",
    "workflow",
    [],
    { verdict: choice("accepted", "rejected"), defects: arr(str) },
  );
  define("mask_define", "cel! name! region pixels protect", "drawing", [], {
    pixels: arr(point),
  });
  define("mask_list", "cel!", "drawing");
  define("mask_protect", "cel! mask! protect!", "drawing");
  define("mask_edit", "cel! mask! idx steps expected_hash", "drawing");
  define("edit_batch", "operations!", "drawing", [], {
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        properties: { tool: str, arguments: obj },
        required: ["tool", "arguments"],
        additionalProperties: false,
      },
    },
  });
  define(
    "quality_report",
    "cel! style asset asset_class allow_disconnected",
    "review",
  );
  define("review_bundle", "cel! zoom include_grid", "review");
}
module.exports = { register, STAGES, EDITS };
