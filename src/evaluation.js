"use strict";
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { Project } = require("./core/project.js");
const { audit } = require("./audit.js");
const { readJSON, writeJSON } = require("./core/storage.js");
const { runTask } = require("./agent.js");
const { execute } = require("./execute.js");
const { W } = require("./tools.js");

const digest = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function inspect(root, brief) {
  const artifacts = [],
    diagnostics = [],
    problems = [];
  if (!fs.existsSync(path.join(root, "art", "project.json")))
    return {
      ok: false,
      artifacts,
      diagnostics,
      problems: ["No project was created"],
    };
  const p = Project.open(root);
  let count = 0;
  for (const [id, sprite] of p.sprites)
    for (const key of Object.keys(sprite.cels)) {
      const cel = p.readCel(id, key);
      if (!cel) {
        problems.push(`Missing cel ${id}/${key}`);
        continue;
      }
      count++;
      const file = path.join(root, "art", "sprites", id, sprite.cels[key]);
      artifacts.push({ file, sha256: digest(file) });
      const palette = p.palette_get(cel.paletteId);
      const valid =
        palette &&
        cel.bbox() &&
        [...cel.counts().keys()].every((i) => i >= 0 && i < palette.size);
      if (!valid) problems.push(`Empty or palette-invalid cel ${id}/${key}`);
      if (palette) {
        const report = audit(cel, {
          palette,
          style: p.style_get(sprite.style),
        });
        diagnostics.push({
          cel: `${id}/${key}`,
          errors: report.errors,
          warnings: report.warns,
          findings: report.findings,
        });
      }
    }
  if (p.sprites.size < brief.minimum_sprites)
    problems.push(
      `Expected at least ${brief.minimum_sprites} saved sprites; found ${p.sprites.size}`,
    );
  if (count < brief.minimum_cels)
    problems.push(
      `Expected at least ${brief.minimum_cels} saved cels; found ${count}`,
    );
  if (brief.minimum_clip_directions) {
    const clips = [...W.clips.values()];
    const clip = clips.find(
      (c) =>
        c.directions.length >= brief.minimum_clip_directions &&
        c.directions.every(
          (d) => c.frames(d).length >= brief.minimum_frames_per_direction,
        ),
    );
    if (!clip)
      problems.push(
        "No saved clip meets the requested facing and frame counts",
      );
    else {
      const checked = execute("loop_validate", { clip: clip.id });
      if (!checked.ok) problems.push("Animation validation failed");
    }
  }
  function sources(directory) {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? sources(path.join(directory, entry.name))
          : entry.isFile() && /\.(json|grid)$/.test(entry.name)
            ? [path.join(directory, entry.name)]
            : [],
      );
  }
  const source_artifacts = sources(path.join(root, "art")).map((file) => ({
    file,
    sha256: digest(file),
  }));
  return {
    ok: problems.length === 0,
    sprites: p.sprites.size,
    cels: count,
    artifacts,
    source_artifacts,
    diagnostics,
    problems,
  };
}
async function evaluate({ config, output, briefs, signal, onProgress }) {
  const report = {
    version: 1,
    created: new Date().toISOString(),
    model: config.model,
    provider: config.provider,
    local_only: config.local_only === true,
    mode: "live-model-evaluation",
    tasks: [],
    passed: false,
  };
  const file = path.join(output, "report.json");
  if (fs.existsSync(file))
    throw new Error(
      "Evaluation report exists; choose a new output directory to preserve prior evidence",
    );
  for (const brief of briefs) {
    if (!/^[a-z0-9-]+$/.test(brief.id))
      throw new Error(
        "Brief IDs must contain lowercase letters, digits and hyphens",
      );
    const root = path.resolve(output, "projects", brief.id);
    if (fs.existsSync(root))
      throw new Error(`Evaluation project '${brief.id}' already exists`);
    const run = await runTask({
      config,
      root,
      brief: brief.brief,
      output: path.join(root, "out", "agent-run.json"),
      limits: config.limits,
      signal,
      onProgress,
    });
    const evidence = inspect(root, brief);
    report.tasks.push({
      id: brief.id,
      brief: brief.brief,
      status: run.status,
      rounds: run.rounds,
      calls: run.calls,
      tool_errors: run.errors,
      elapsed_ms: run.elapsed_ms,
      prompt_tokens: run.prompt_tokens,
      completion_tokens: run.completion_tokens,
      usage_complete: run.usage_complete,
      cost_usd: run.cost_usd,
      ...evidence,
      visual: { status: "pending" },
    });
    writeJSON(file, report);
    if (signal?.aborted) break;
  }
  return report;
}
function review(file, id, { verdict, reviewer, notes }) {
  if (
    !["accepted", "rejected"].includes(verdict) ||
    !reviewer?.trim() ||
    !notes?.trim()
  )
    throw new Error(
      "Review needs accepted/rejected verdict, reviewer and concrete notes",
    );
  const report = readJSON(file),
    task = report.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`No task '${id}' in report`);
  if (!task.artifacts.length)
    throw new Error("There are no saved artifacts to review");
  for (const artifact of [...task.artifacts, ...(task.source_artifacts || [])])
    if (
      !fs.existsSync(artifact.file) ||
      digest(artifact.file) !== artifact.sha256
    )
      throw new Error(
        "Artifacts changed after evaluation; create a new evaluation before accepting them",
      );
  task.visual = {
    status: verdict,
    reviewer,
    notes,
    at: new Date().toISOString(),
    source: "explicit-review-command",
  };
  report.passed =
    report.tasks.length > 0 &&
    report.tasks.every(
      (t) =>
        t.ok && t.status === "model_finished" && t.visual.status === "accepted",
    );
  writeJSON(file, report);
  return report;
}
module.exports = { evaluate, inspect, review };
