"use strict";
const fs = require("fs");
const path = require("path");
const { createProvider } = require("./inference.js");
const { execute, listTools } = require("./execute.js");
const { imageBlocks } = require("./mcp.js");
const { W, Workspace } = require("./tools.js");
const { writeJSON, readJSON, within } = require("./core/storage.js");
const { randomUUID } = require("crypto");

const QUALITY_PASSES = Object.freeze({ low: 3, medium: 5, high: 8 });
const REVIEW_TOOLS = new Set(["review_bundle", "review_pack", "scene_review", "view"]);
const EDIT_TOOLS = new Set([
  "aa_pass", "ambient_rederive", "assemble", "cast_shadow", "cel_copy",
  "cel_from_grid", "cel_link", "cel_new", "cel_offset", "cel_set_opacity",
  "clip_set_frames", "draw_line", "draw_named_map", "draw_pixel_map",
  "draw_shape", "edit_batch", "erase", "face_shade", "fill_region", "glow",
  "gradient_map", "layer_add", "layer_opacity", "layer_remove", "layer_reorder",
  "mask_define", "mask_edit", "mirror", "outline_pass", "paint_form", "part_add",
  "put", "quantise_to_palette", "replace_color", "save_cel", "scene_create",
  "scene_place", "shift_along_ramp", "smear_frame", "sprite_create", "sprite_delete",
  "stroke_shape", "timing_apply", "transform",
]);

const SYSTEM = `You are directing PixelHand to author original, palette-indexed pixel art.
Use tool_help for exact schemas, tool_search to discover expert tools, and tool_call to invoke them.
Create or resume the saved asset brief. Develop silhouette before colour detail. Use named masks to protect approved regions.
Inspect review_bundle images. Revise the largest visual defect before adding detail. Heuristic scores are diagnostics, never evidence that an image looks good.
For every quality pass, inspect the latest review image closely, name the most important visual defect, edit the art to address it, then render and inspect a fresh review image to judge that edit. Keep doing this for the configured number of passes; do not claim completion early. Raise concrete issues in silhouette, anatomy, perspective, contact, lighting, palette, material consistency, and stray pixels rather than giving reassuring generalities.
For animation author real key poses and review all frames and directions; use skeleton joint chains and planted-foot contacts.
Save useful cels to the project's sprite documents. Keep workflows and visual decisions current. Export only after mechanical validation.
If you cannot see images, explicitly leave visual acceptance unreviewed. Report incomplete work honestly. Never invent a human review.`;

async function runTask({
  config,
  root,
  brief,
  output,
  resume,
  limits = {},
  signal,
  onProgress = () => {},
}) {
  const provider = createProvider(config);
  const qualityEffort = config.quality_effort || "medium";
  const requiredQualityPasses = config.vision
    ? QUALITY_PASSES[qualityEffort]
    : 0;
  const maxRounds = limits.rounds ?? 40,
    maxCalls = limits.calls ?? 100,
    maxTokens = limits.tokens ?? 100000,
    maxMs = limits.elapsed_ms ?? 15 * 60 * 1000;
  if (
    ![maxRounds, maxCalls, maxTokens, maxMs].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  )
    throw new Error("Agent budgets must be positive integers");
  if (typeof brief !== "string" || !brief.trim())
    throw new Error("An original art brief is required");
  const started = Date.now(),
    tools = listTools(config.toolset || "core"),
    allowed = new Set(tools.map((t) => t.name));
  const record = resume
    ? readJSON(resume)
    : {
        version: 1,
        run_id: randomUUID(),
        model: config.model,
        provider: config.provider,
        root: path.resolve(root),
        brief,
        messages: [
          {
            role: "system",
            content:
              SYSTEM +
              `\nProject root: ${path.resolve(root)}` +
              (config.vision
                ? `\nImages are supplied for visual review. Quality effort is ${qualityEffort}: complete ${requiredQualityPasses} visual critique, edit, and fresh-image review passes before finishing.`
                : "\nThis run has no vision input; visual acceptance must remain unreviewed."),
          },
          { role: "user", content: brief },
        ],
        rounds: 0,
        calls: 0,
        errors: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        usage_complete: true,
        elapsed_ms: 0,
        events: [],
        pending_calls: [],
        pending_images: [],
        quality: {
          effort: qualityEffort,
          required_passes: requiredQualityPasses,
          completed_passes: 0,
          review_available: false,
          edited_since_review: false,
          awaiting_review_confirmation: false,
        },
      };
  if (
    record.version !== 1 ||
    record.root !== path.resolve(root) ||
    record.model !== config.model ||
    record.provider !== config.provider
  )
    throw new Error(
      "Resume transcript does not match the configured model and project",
    );
  record.quality ||= {
    completed_passes: 0,
    review_available: false,
    edited_since_review: false,
    awaiting_review_confirmation: false,
  };
  record.quality.effort = qualityEffort;
  record.quality.required_passes = requiredQualityPasses;
  record.quality.completed_passes ||= 0;
  const deadline = AbortSignal.timeout(Math.max(1, maxMs - record.elapsed_ms));
  const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  if (record.error) {
    record.previous_errors ||= [];
    record.previous_errors.push(record.error);
    delete record.error;
  }
  if (resume || fs.existsSync(path.join(record.root, "art", "project.json"))) {
    const opened = execute("project_open", { root: record.root });
    if (!opened.ok) throw new Error(opened.violations[0].message);
  } else Object.assign(W, new Workspace(record.root));
  function save(status, extra = {}) {
    record.status = status;
    Object.assign(record, extra);
    record.elapsed_ms += Date.now() - started - (record.elapsedThisRun || 0);
    record.elapsedThisRun = Date.now() - started;
    const rates = config.billing;
    record.cost_usd =
      record.usage_complete &&
      rates &&
      Number.isFinite(rates.input_per_million) &&
      Number.isFinite(rates.output_per_million)
        ? (record.prompt_tokens * rates.input_per_million +
            record.completion_tokens * rates.output_per_million) /
          1000000
        : null;
    if (output) {
      const persisted = { ...record };
      delete persisted.elapsedThisRun;
      writeJSON(output, persisted);
    }
  }
  let sameFailures = 0;
  try {
    onProgress({
      event: "quality_plan",
      effort: qualityEffort,
      required_passes: requiredQualityPasses,
      vision: config.vision === true,
    });
    if (record.elapsed_ms >= maxMs) {
      save("time_budget_exhausted");
      return record;
    }
    while (
      record.pending_calls?.length ||
      (record.rounds < maxRounds &&
        record.calls < maxCalls &&
        record.prompt_tokens + record.completion_tokens < maxTokens)
    ) {
      if (combined.aborted) throw combined.reason;
      const contextBytes = Buffer.byteLength(JSON.stringify(record.messages));
      if (contextBytes > (limits.context_bytes ?? 512000)) {
        save("context_budget_exhausted");
        return record;
      }
      if (!record.pending_calls?.length) {
        onProgress({
          event: "inference",
          round: record.rounds + 1,
          calls: record.calls,
        });
        save("running");
        const response = await provider.chat(record.messages, tools, combined);
        record.rounds++;
        if (record.quality.awaiting_review_confirmation) {
          record.quality.completed_passes++;
          record.quality.awaiting_review_confirmation = false;
          record.quality.review_available = true;
          record.events.push({
            event: "quality_pass",
            effort: qualityEffort,
            pass: record.quality.completed_passes,
            required_passes: requiredQualityPasses,
            at: new Date().toISOString(),
          });
          onProgress({
            event: "quality_pass",
            effort: qualityEffort,
            pass: record.quality.completed_passes,
            required_passes: requiredQualityPasses,
          });
        }
        if (
          response.usage.prompt_tokens === null ||
          response.usage.completion_tokens === null
        )
          record.usage_complete = false;
        record.prompt_tokens += response.usage.prompt_tokens || 0;
        record.completion_tokens += response.usage.completion_tokens || 0;
        record.messages.push(response.message);
        record.pending_calls = [...(response.message.tool_calls || [])];
        record.pending_images = [];
        if (!record.pending_calls.length) {
          if (record.quality.completed_passes < requiredQualityPasses) {
            record.messages.push({
              role: "user",
              content:
                `Quality effort ${qualityEffort} requires ${requiredQualityPasses} completed visual critique/edit/review passes; ${record.quality.completed_passes} are complete. Continue with a critical inspection of the latest image, make a concrete correction, and inspect a fresh review_bundle image after each edit. Do not finish yet.`,
            });
            save("running");
            continue;
          }
          save(
            response.finish_reason === "length"
              ? "output_truncated"
              : "model_finished",
            { answer: response.message.content },
          );
          return record;
        }
        save("running");
      }
      const calls = [...record.pending_calls];
      for (const call of calls) {
        let result;
        if (record.calls >= maxCalls)
          result = {
            ok: false,
            violations: [
              { rule: "call_budget", message: "Tool-call budget exhausted" },
            ],
          };
        else {
          record.calls++;
          try {
            const args = JSON.parse(call.function.arguments);
            const actualTool =
              call.function.name === "tool_call"
                ? args.tool
                : call.function.name;
            const actualArgs =
              call.function.name === "tool_call" ? args.arguments : args;
            let reviewImages = [];
            for (const field of ["path", "file", "image", "dir", "out"])
              if (typeof actualArgs?.[field] === "string") {
                const resolved = path.resolve(record.root, actualArgs[field]),
                  relative = path.relative(record.root, resolved);
                if (relative) within(record.root, relative);
                actualArgs[field] = resolved;
              }
            if (!allowed.has(call.function.name))
              result = {
                ok: false,
                violations: [
                  {
                    rule: "tool_not_exposed",
                    message:
                      "Use tool_help and tool_call for discovered expert tools",
                  },
                ],
              };
            else if (actualTool === "tool_call")
              result = {
                ok: false,
                violations: [
                  {
                    rule: "nested_call",
                    message: "Nested tool_call is not supported",
                  },
                ],
              };
            else if (
              actualTool === "project_open" &&
              path.resolve(actualArgs.root) !== record.root
            )
              result = {
                ok: false,
                violations: [
                  {
                    rule: "task_root",
                    message: "This task must stay in its configured project",
                  },
                ],
              };
            else
              result = execute(
                actualTool,
                { ...actualArgs, root: record.root },
                { requestId: `${record.run_id}:${call.id}` },
              );
            if (
              config.vision &&
              result.ok !== false &&
              REVIEW_TOOLS.has(actualTool)
            )
              reviewImages = imageBlocks(result, 2);
            if (
              config.vision &&
              result.ok !== false &&
              EDIT_TOOLS.has(actualTool) &&
              record.quality.review_available
            ) {
              record.quality.review_available = false;
              record.quality.edited_since_review = true;
            }
            if (reviewImages.length) {
              if (record.quality.edited_since_review) {
                record.quality.edited_since_review = false;
                record.quality.awaiting_review_confirmation = true;
              } else {
                record.quality.review_available = true;
              }
            }
          } catch (e) {
            result = {
              ok: false,
              violations: [{ rule: "invalid_tool_call", message: e.message }],
            };
          }
        }
        record.errors += result.ok === false ? 1 : 0;
        sameFailures = result.ok === false ? sameFailures + 1 : 0;
        record.messages.push({
          role: "tool",
          tool_call_id: call.id,
          tool_name: call.function.name,
          content: JSON.stringify(result),
        });
        record.events.push({
          tool: call.function.name,
          ok: result.ok !== false,
          at: new Date().toISOString(),
        });
        if (config.vision && result.ok !== false)
          for (const block of imageBlocks(result, 2))
            record.pending_images.push({
              type: "image_url",
              image_url: { url: `data:${block.mimeType};base64,${block.data}` },
            });
        record.pending_calls.shift();
        save("running");
        onProgress({
          event: "tool",
          tool: call.function.name,
          ok: result.ok !== false,
        });
      }
      if (record.pending_images.length)
        record.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "PixelHand review images from the preceding tool calls. Compare these with the brief before your next edit.",
            },
            ...record.pending_images.slice(0, 4),
          ],
        });
      record.pending_images = [];
      save("running");
      if (sameFailures >= 5) {
        save("repeated_tool_failures");
        return record;
      }
    }
    save("budget_exhausted");
  } catch (e) {
    save(
      signal?.aborted
        ? "cancelled"
        : deadline.aborted
          ? "time_budget_exhausted"
          : "provider_error",
      {
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
  return record;
}
module.exports = { runTask, SYSTEM };
