#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeJSON } = require("../src/core/storage.js");
const { listTools } = require("../src/execute.js");

function walk(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory()
        ? walk(path.join(root, d.name))
        : d.name.endsWith(".js")
          ? [path.join(root, d.name)]
          : [],
    );
}
function qualify(file, local) {
  if (!file) return { ok: false, reason: "No live evaluation report supplied" };
  const report = JSON.parse(fs.readFileSync(file, "utf8")),
    required = require("../evaluation/briefs.json").map((b) => b.id);
  const tasks = report.tasks || [];
  if (report.mode !== "live-model-evaluation" || report.local_only !== local)
    return {
      ok: false,
      reason: "Evaluation mode or local/API scope does not match",
    };
  if (
    !required.every((id) =>
      tasks.some(
        (t) =>
          t.id === id &&
          t.ok &&
          t.status === "model_finished" &&
          t.visual?.status === "accepted",
      ),
    )
  )
    return {
      ok: false,
      reason:
        "Complete brief suite and explicit visual acceptance are required",
    };
  const { createHash } = require("crypto");
  for (const t of tasks)
    for (const a of [...(t.artifacts || []), ...(t.source_artifacts || [])])
      if (
        !fs.existsSync(a.file) ||
        createHash("sha256").update(fs.readFileSync(a.file)).digest("hex") !==
          a.sha256
      )
        return { ok: false, reason: "An evaluated artifact changed" };
  return { ok: true, model: report.model, tasks: tasks.length };
}
function main(argv) {
  const engineeringOnly = argv.includes("--engineering"),
    args = {};
  for (let i = 0; i < argv.length; i++)
    if (["--local", "--api"].includes(argv[i]))
      args[argv[i].slice(2)] = argv[++i];
  const root = path.join(__dirname, ".."),
    checks = [];
  const files = [
    ...walk(path.join(root, "src")),
    ...walk(path.join(root, "tools")),
    ...walk(path.join(root, "examples")),
  ];
  for (const file of files) {
    const r = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (r.status !== 0)
      checks.push({ gate: "syntax", ok: false, file, message: r.stderr });
  }
  if (!checks.length)
    checks.push({ gate: "syntax", ok: true, files: files.length });
  for (const script of [
    "smoke.test.js",
    "integration.test.js",
    "production.test.js",
  ]) {
    const params =
      script === "production.test.js"
        ? ["--test", path.join(root, "test", script)]
        : [path.join(root, "test", script)];
    const result = spawnSync(process.execPath, params, {
      encoding: "utf8",
      cwd: root,
      timeout: 120000,
    });
    checks.push({
      gate: script,
      ok: result.status === 0,
      summary: (result.stdout || "").trim().split(/\r?\n/).slice(-9).join("\n"),
      error: result.error?.message,
    });
    if (result.status !== 0)
      process.stderr.write((result.stdout || "") + (result.stderr || ""));
  }
  checks.push({
    gate: "tool-contracts",
    ok: true,
    all: listTools().length,
    core: listTools("core").length,
    core_schema_bytes: Buffer.byteLength(JSON.stringify(listTools("core"))),
  });
  const live = {
    local: qualify(args.local, true),
    api: qualify(args.api, false),
  };
  const result = {
    version: require("../package.json").version,
    at: new Date().toISOString(),
    engineering_ready: checks.every((c) => c.ok),
    production_ready: checks.every((c) => c.ok) && live.local.ok && live.api.ok,
    checks,
    live,
  };
  writeJSON(path.join(root, "out", "release-readiness.json"), result);
  console.log(JSON.stringify(result, null, 2));
  if (engineeringOnly ? !result.engineering_ready : !result.production_ready)
    process.exitCode = 1;
}
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { main, qualify };
