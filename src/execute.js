"use strict";
const fs = require("fs");
const path = require("path");
const { TOOLS, W, ROOT, bad } = require("./tools.js");
const { validate } = require("./contracts.js");
const session = require("./core/session.js");
const { hashCel, stableJSON, within } = require("./core/storage.js");
const { createHash } = require("crypto");

const DISCOVERY = new Set([
  "tools_list",
  "tool_help",
  "tool_search",
  "coverage_report",
]);
let dispatching = false;
function execute(name, arguments_ = {}, context = {}) {
  const tool =
    typeof name === "string" && Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool)
    return bad(
      "unknown_tool",
      `No tool '${name}'. Use tool_search to discover it.`,
    );
  if (name === "tool_call") {
    const errors = validate(tool.inputSchema, arguments_);
    if (errors.length) return bad("invalid_arguments", errors.join("; "));
    if (arguments_.tool === "tool_call")
      return bad("nested_call", "Recursive tool_call is not supported");
    return execute(arguments_.tool, arguments_.arguments, context);
  }
  const args =
    arguments_ && typeof arguments_ === "object" && !Array.isArray(arguments_)
      ? { ...arguments_ }
      : arguments_;
  const routedRoot = args?.root;
  if (args && !["project_init", "project_open"].includes(name))
    delete args.root;
  const errors = validate(tool.inputSchema, args);
  if (errors.length)
    return bad("invalid_arguments", errors.join("; "), {
      fix: `tool_help '${name}'`,
    });
  let before, lock, lockPath;
  try {
    if (dispatching)
      return bad("nested_execution", "Nested execution is not supported");
    if (
      context.requestId &&
      (typeof context.requestId !== "string" ||
        context.requestId.length > 256 ||
        ["__proto__", "constructor", "prototype"].includes(context.requestId))
    )
      return bad(
        "invalid_request_id",
        "Request IDs must be non-reserved strings of at most 256 characters",
      );
    const preexistingProject =
      name === "project_init" &&
      fs.existsSync(path.join(routedRoot || W.root, "art", "project.json"));
    if (preexistingProject && !context.requestId)
      return bad(
        "project_exists",
        "This project already exists; use project_open to resume it",
      );
    if (preexistingProject && context.requestId) W.load(routedRoot || W.root);
    if (
      routedRoot &&
      !DISCOVERY.has(name) &&
      !["project_init", "project_open"].includes(name) &&
      path.resolve(routedRoot) !== path.resolve(W.root)
    )
      W.load(path.resolve(routedRoot));
    if (!W.project && !DISCOVERY.has(name) && name !== "project_init")
      W.load(routedRoot || ROOT);
    const operationRoot = ["project_init", "project_open"].includes(name)
      ? path.resolve(routedRoot || W.root)
      : W.root;
    if (
      !DISCOVERY.has(name) &&
      (W.project || name === "project_init") &&
      (name !== "project_open" ||
        fs.existsSync(path.join(operationRoot, "art", "project.json")))
    ) {
      const directory = within(operationRoot, ".pixelhand");
      fs.mkdirSync(directory, { recursive: true });
      lockPath = path.join(directory, "writer.lock");
      try {
        lock = fs.openSync(lockPath, "wx", 0o600);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        // A terminated process must not permanently strand the project.
        let owner;
        try {
          owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        } catch {
          return bad(
            "workspace_busy",
            "Recovery lock is unreadable; inspect .pixelhand/writer.lock before removing it",
          );
        }
        try {
          process.kill(owner.pid, 0);
          return bad(
            "workspace_busy",
            "Another process is editing this project; retry after it finishes",
          );
        } catch (probe) {
          if (probe.code !== "ESRCH")
            return bad(
              "workspace_busy",
              "Cannot establish whether the other writer has stopped",
            );
        }
        fs.unlinkSync(lockPath);
        lock = fs.openSync(lockPath, "wx", 0o600);
      }
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
      const recoveryPath = path.join(directory, "session.json");
      if (
        fs.existsSync(recoveryPath) &&
        !["project_init", "project_open"].includes(name)
      ) {
        const revision =
          JSON.parse(fs.readFileSync(recoveryPath, "utf8")).revision || 0;
        if (revision !== (W.sessionRevision || 0))
          return bad(
            "session_conflict",
            "A different process saved this project. Call project_open to refresh before editing.",
          );
      }
      if (W.project) before = session.capture(W);
    }
    const signature = createHash("sha256")
      .update(stableJSON([name, args]))
      .digest("hex");
    if (context.requestId && W.project) {
      const receipt = W.production.receipts?.[context.requestId];
      if (receipt)
        return receipt.signature === signature
          ? structuredClone(receipt.result)
          : bad(
              "request_conflict",
              "This request ID was already used for different arguments",
            );
    }
    if (preexistingProject)
      return bad(
        "project_exists",
        "This project already exists; use project_open to resume it",
      );
    if (args.expected_hash && args.cel) {
      const { cel } = require("./tools.js").celOf(args);
      if (hashCel(cel) !== args.expected_hash)
        return bad(
          "stale_cel",
          "The cel changed since it was reviewed. Read it again before applying this patch.",
        );
    }
    dispatching = true;
    const result = tool.run(args);
    W.calls++;
    if (result?.ok === false) {
      if (before && !["project_init", "project_open"].includes(name))
        session.restore(W, before);
      return result;
    }
    if (W.project && !DISCOVERY.has(name)) {
      if (context.requestId) {
        W.production.receipts ||= {};
        W.production.receipts[context.requestId] = {
          signature,
          result: JSON.parse(JSON.stringify(result)),
        };
        const ids = Object.keys(W.production.receipts);
        while (ids.length > 256) delete W.production.receipts[ids.shift()];
      }
      session.persist(W);
    }
    return result;
  } catch (e) {
    if (before && !["project_init", "project_open"].includes(name)) {
      try {
        session.restore(W, before);
      } catch {}
    }
    return bad(e.rule || "tool_failed", e.message);
  } finally {
    dispatching = false;
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

const CORE = new Set([
  "project_init",
  "project_open",
  "tool_help",
  "tool_search",
  "tool_call",
  "asset_begin",
  "asset_status",
  "asset_advance",
  "asset_review",
  "palette_get",
  "palette_set",
  "sprite_create",
  "cel_new",
  "draw_pixel_map",
  "draw_named_map",
  "put",
  "get_pixel_map",
  "save_cel",
  "view",
  "review_bundle",
  "quality_report",
  "mask_define",
  "mask_edit",
  "edit_batch",
  "undo",
  "snapshot",
  "restore",
  "export_indexed_png",
]);
function listTools(profile = "all") {
  if (
    !["all", "core", "drawing", "animation", "world", "review"].includes(
      profile,
    )
  )
    throw new Error(`Unknown toolset '${profile}'`);
  return Object.entries(TOOLS)
    .filter(
      ([name, t]) => profile === "all" || CORE.has(name) || t.group === profile,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, t]) => ({
      name,
      description: t.describe,
      inputSchema: t.inputSchema,
    }));
}
module.exports = { execute, listTools, CORE };
