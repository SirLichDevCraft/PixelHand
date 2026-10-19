#!/usr/bin/env node
// The CLI mirror of the tool surface. docs/01 §4: every capability is reachable from BOTH the
// CLI and MCP, and the CLI is the one that works in a shell script, a CI gate, or a terminal
// with no agent in the loop.
//
//   node src/cli.js list
//   node src/cli.js help view
//   node src/cli.js view --cel keeper.walk.f0 --style keeper --zoom 10
//   node src/cli.js put --cel keeper.walk.f0 --cells "12,9,lantern_hi;13,9,lantern_hi"
//   node src/cli.js audit --cel keeper/walk/f0 --tier support
//   node src/cli.js --json '{"tool":"view","cel":"keeper.walk.f0"}'
//
// Values are parsed as JSON when they look like JSON, otherwise as strings. `@file` reads a value
// from a file, which is how a 32-row pixel map gets passed without quoting hell.
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS, W, ROOT, OUT } = require("./tools.js");
const { execute } = require("./execute.js");

function parseValue(v) {
  if (v.startsWith("@")) return fs.readFileSync(v.slice(1), "utf8");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true" || v === "false") return v === "true";
  if (v === "null") return null;
  if (/^[[{]/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key === "json") {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) args.__output_json = true;
        else if (next === "true") { args.__output_json = true; i++; }
        else { args.__json = JSON.parse(argv[++i]); }
        continue;
      }
      if (key === "root") { args.__root = path.resolve(argv[++i]); continue; }
      if (key === "raw") { args.__raw = true; continue; }
      if (key === "quiet") { args.__quiet = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
      args[key.replace(/-/g, "_")] = parseValue(next);
      i++;
    } else positional.push(a);
  }
  return { args, positional };
}

function printResult(name, res, opts = {}) {
  if (opts.json_out) { process.stdout.write(JSON.stringify(res, null, 2) + "\n"); return; }
  const line = (s) => process.stdout.write(s + "\n");
  const status = res.ok === false ? "REFUSED" : "ok";
  line(`${name}: ${status}`);
  if (res.changed && (res.changed.pixels || res.changed.added || res.changed.removed)) {
    line(`  changed  +${res.changed.added} -${res.changed.removed} ~${res.changed.repainted} total ${res.changed.pixels}`);
  } else if (res.ok !== false && res.changed && require("./production-tools.js").EDITS.has(name)) {
    line("  changed  NOTHING. The tool ran and touched zero pixels — that is a failure signal, not a success.");
  }
  if (res.region) line(`  region   x${res.region.x0}-${res.region.x1} y${res.region.y0}-${res.region.y1}`);
  for (const v of res.violations || []) line(`  VIOLATION ${v.rule}: ${v.message}${v.fix ? ` -> ${v.fix}` : ""}`);
  for (const w of res.warnings || []) line(`  warn     ${typeof w === "string" ? w : `${w.rule}: ${w.message}`}`);
  if (res.image) line(`  image    ${res.image}${res.cached ? " (cached)" : ""}${res.zoom ? ` z${res.zoom}` : ""}`);
  if (res.grid) line(`\n${res.grid}\n`);
  if (res.audit_text) line(res.audit_text);
  const rest = { ...res };
  delete rest.ok; delete rest.changed; delete rest.region; delete rest.violations; delete rest.warnings;
  delete rest.image; delete rest.grid; delete rest.audit_text; delete rest.cached; delete rest.zoom;
  const keys = Object.keys(rest);
  if (keys.length) line(`\n${JSON.stringify(rest, null, 2)}`);
}

function main(argv) {
  let parsed;
  try { parsed=parseArgs(argv); } catch(e) {process.stderr.write(`Invalid command arguments: ${e.message}\n`);return 2;}
  const { args, positional } = parsed;
  const cmd = positional[0];
  if(args.version || cmd==="version"){process.stdout.write(require("../package.json").version+"\n");return 0;}

  if (!cmd || cmd === "list" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(`PixelHand — ${Object.keys(TOOLS).length} tools\n\n`);
    for (const k of Object.keys(TOOLS).sort()) process.stdout.write(`  ${k.padEnd(22)} ${TOOLS[k].describe}\n`);
    process.stdout.write(`\nproject root: ${ROOT}\nrender output: ${path.join(OUT, "inspect")}\n`);
    return 0;
  }
  if (cmd === "help") {
    const t = TOOLS[positional[1]];
    if (!t) { process.stderr.write(`no tool '${positional[1]}'\n`); return 2; }
    process.stdout.write(JSON.stringify({ name: positional[1], description: t.describe, inputSchema: t.inputSchema, examples: t.examples, group: t.group }, null, 2) + "\n");
    return 0;
  }
  const tool = TOOLS[cmd];
  if (!tool) { process.stderr.write(`no tool '${cmd}'. Try: node src/cli.js list\n`); return 2; }

  const input = args.__json ? { ...args.__json } : args;
  const root = args.__root || input.root || process.env.PIXELHAND_ROOT || ROOT;
  const jsonOut = args.__output_json === true || input.json === true || process.env.PIXELHAND_JSON === "1";
  delete input.__json; delete input.__raw; delete input.__quiet; delete input.__root;
  delete input.__output_json;
  if (input.root) delete input.root;
  delete input.json;

  try {
    if (!W.project) { try { W.load(root); } catch { /* tools that create a project supply their own root */ } }
    const res = execute(cmd, { ...input, root });
    printResult(cmd, res, { json_out: jsonOut });
    return res.ok === false ? 1 : 0;
  } catch (e) {
    // A refusal is not a crash. "That cel does not exist" is the engine saying no for a reason,
    // and it exits 1 like every other refusal.
    if (e.rule) {
      process.stderr.write(`${cmd}: REFUSED\n  VIOLATION ${e.rule}: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`${cmd}: ERROR ${e.message}\n`);
    if (process.env.PIXELHAND_TRACE) process.stderr.write(e.stack + "\n");
    return 3;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, parseArgs, parseValue };
