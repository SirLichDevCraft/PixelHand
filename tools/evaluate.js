#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { evaluate, review } = require("../src/evaluation.js");
async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || !argv[i + 1])
      throw new Error("Expected --name value arguments");
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (args.review) {
    const result = review(args.review, args.task, {
      verdict: args.verdict,
      reviewer: args.reviewer,
      notes: args.notes,
    });
    console.log(
      JSON.stringify(
        {
          passed: result.passed,
          tasks: result.tasks.map((t) => ({ id: t.id, visual: t.visual })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!args.config || !args.out)
    throw new Error(
      "Pass --config provider.json --out a-new-evaluation-directory [--task brief-id]",
    );
  const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
  let briefs = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "evaluation", "briefs.json"),
      "utf8",
    ),
  );
  if (args.task) briefs = briefs.filter((b) => b.id === args.task);
  if (!briefs.length) throw new Error("No matching evaluation brief");
  const controller = new AbortController(),
    cancel = () => controller.abort(new Error("Stopped by user"));
  process.once("SIGINT", cancel);
  try {
    const report = await evaluate({
      config,
      output: path.resolve(args.out),
      briefs,
      signal: controller.signal,
      onProgress: (e) => process.stderr.write(JSON.stringify(e) + "\n"),
    });
    console.log(
      JSON.stringify(
        {
          report: path.join(args.out, "report.json"),
          passed: report.passed,
          tasks: report.tasks.map((t) => ({
            id: t.id,
            status: t.status,
            ok: t.ok,
            visual: t.visual.status,
          })),
        },
        null,
        2,
      ),
    );
    if (report.tasks.some((t) => !t.ok)) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}
if (require.main === module)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
