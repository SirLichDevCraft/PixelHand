#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { runTask } = require("../src/agent.js");
const { createProvider } = require("../src/inference.js");
async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || !argv[i + 1])
      throw new Error(
        "Expected --config file [--brief file --root directory --out transcript.json --resume transcript.json]",
      );
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.config)
    throw new Error("Pass --config with an inference configuration JSON file");
  const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
  if (args.doctor === "true") {
    console.log(JSON.stringify(await createProvider(config).probe(), null, 2));
    return;
  }
  if (!args.root || !args.brief)
    throw new Error(
      "Pass --root and --brief; the brief is an original art brief text file",
    );
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Stopped by user"));
  process.once("SIGINT", cancel);
  try {
    const result = await runTask({
      config,
      root: path.resolve(args.root),
      brief: fs.readFileSync(args.brief, "utf8"),
      output: args.out || path.join(args.root, "out", "agent-run.json"),
      resume: args.resume,
      limits: config.limits,
      signal: controller.signal,
      onProgress: (e) => process.stderr.write(JSON.stringify(e) + "\n"),
    });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          rounds: result.rounds,
          calls: result.calls,
          errors: result.errors,
          prompt_tokens: result.prompt_tokens,
          completion_tokens: result.completion_tokens,
          usage_complete: result.usage_complete,
          elapsed_ms: result.elapsed_ms,
          error: result.error,
        },
        null,
        2,
      ),
    );
    if (result.status !== "model_finished") process.exitCode = 1;
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
