"use strict";
const fs = require("fs");
const path = require("path");
const { createProvider } = require("./inference.js");
const { execute, listTools } = require("./execute.js");
const { imageBlocks } = require("./mcp.js");
const { W, Workspace } = require("./tools.js");
const { writeJSON, readJSON, within } = require("./core/storage.js");
const { randomUUID } = require("crypto");

const SYSTEM = `You are directing PixelHand to author original, palette-indexed pixel art.
Use tool_help for exact schemas, tool_search to discover expert tools, and tool_call to invoke them.
Create or resume the saved asset brief. Develop silhouette before colour detail. Use named masks to protect approved regions.
Inspect review_bundle images. Revise the largest visual defect before adding detail. Heuristic scores are diagnostics, never evidence that an image looks good.
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
                ? "\nImages are supplied for visual review."
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
