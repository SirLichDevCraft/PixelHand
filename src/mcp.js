#!/usr/bin/env node
// The MCP surface. JSON-RPC 2.0 over stdio, newline-delimited, zero dependencies — same engine,
// same tool registry as the CLI, different door.
//
// `direct` exposure: the hot tools return an image content BLOCK inline, so image + grid + audit
// arrive in one round trip instead of costing a second read() on a written file. The spike
// (src/spike-mcp.js) settled that this actually reaches the model as an image before the engine
// was built around the assumption.
//
// Configure in pi:
//   { "mcpServers": { "pixelhand": { "command": "node", "args": ["/path/to/PixelHand/src/mcp.js"] } } }
"use strict";

const fs = require("fs");
const { TOOLS, W, ROOT, OUT } = require("./tools.js");

const PROTOCOL = "2024-11-05";
const SERVER = { name: "pixelhand", version: "1.0.0" };

/**
 * The hot set. These are the tools used in the author -> render -> judge -> audit -> fix loop,
 * so they carry the image inline. Everything else returns a path plus structured content and
 * leaves the read to the caller, because a 125-tool surface that returns 125 images is a
 * context-budget disaster.
 */
const DIRECT = new Set([
  "view", "chunk", "contact_sheet", "contact_grid", "onion", "play", "silhouette",
  "squint", "value_map", "game_scale", "diff", "heatmap", "audit", "style_options", "review_pack",
]);

/** Argument shapes are declared loosely on purpose: the engine validates SEMANTICS (ramp legality,
 *  style conformance, provenance) far more strictly than it validates JSON shapes. A tool that
 *  refuses an illegal colour move is worth more than a tool that refuses a missing comma. */
const SCHEMA_BASE = {
  type: "object",
  properties: {
    cel: { type: "string", description: "cel id in warm state, or 'sprite/key' for a cel on disk" },
    sprite: { type: "string" }, cel_key: { type: "string" },
    palette: { type: "string", description: "palette id declared in the project" },
    style: { type: "string", description: "style bible id" },
    region: { type: "object", description: "{x,y,w,h} or {x0,y0,x1,y1}" },
    zoom: { type: "number", description: "integer upscale factor; the engine clamps to the 8-40 regime for review renders" },
  },
  additionalProperties: true,
};

const toolList = Object.keys(TOOLS).sort().map(name => ({
  name,
  description: TOOLS[name].describe + (DIRECT.has(name) ? " [direct: returns the image inline]" : ""),
  inputSchema: SCHEMA_BASE,
}));

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

function imageBlocks(res) {
  const out = [];
  for (const key of ["image", "file", "dir"]) {
    const p = res[key];
    if (typeof p !== "string") continue;
    const candidates = key === "dir" ? [`${p}/sheet.png`, `${p}/playtest.html`] : [p];
    for (const f of candidates) {
      if (!fs.existsSync(f) || !/\.png$/i.test(f)) continue;
      out.push({ type: "image", data: fs.readFileSync(f).toString("base64"), mimeType: "image/png" });
    }
  }
  return out;
}

function textOf(res) {
  const parts = [];
  if (res.ok === false) parts.push("REFUSED by the engine.");
  if (res.changed && (res.changed.pixels || res.changed.added || res.changed.removed)) {
    parts.push(`changed: +${res.changed.added} added, -${res.changed.removed} removed, ~${res.changed.repainted} repainted (${res.changed.pixels} total)`);
  } else if (res.ok !== false && !res.grid) {
    parts.push("changed: NOTHING — zero pixels touched. Treat that as a failure signal.");
  }
  if (res.region) parts.push(`region: x${res.region.x0}-${res.region.x1} y${res.region.y0}-${res.region.y1}`);
  for (const v of res.violations || []) parts.push(`VIOLATION ${v.rule}: ${v.message}${v.fix ? ` -> fix with ${v.fix}` : ""}`);
  for (const w of res.warnings || []) parts.push(`warn: ${typeof w === "string" ? w : `${w.rule}: ${w.message}`}`);
  if (res.audit_text) parts.push(res.audit_text);
  if (res.grid) parts.push(res.grid);
  if (res.legend) parts.push(res.legend);
  if (res.image) parts.push(`image file: ${res.image}${res.zoom ? ` (zoom ${res.zoom})` : ""}`);
  return parts.join("\n");
}

function handle(msg) {
  const id = msg.id;
  if (msg.method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER } });
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  if (msg.method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: toolList } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const tool = TOOLS[name];
    if (!tool) return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `no tool '${name}'` }], isError: true } });
    const args = msg.params?.arguments || {};
    let res;
    try {
      if (!W.project) { try { W.load(args.root || ROOT); } catch { /* the tool may create the project itself */ } }
      res = tool.run(args);
    } catch (e) {
      // A refusal is not an error. "That cel does not exist", "that direction is not declared"
      // — the engine saying no for a named reason, in the same shape as a violation.
      const refused = e.rule ? `${name}: REFUSED\n  VIOLATION ${e.rule}: ${e.message}` : `${name}: ERROR ${e.message}`;
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: refused }], isError: true } });
    }
    const content = [{ type: "text", text: textOf(res) || `${name}: ok` }];
    if (DIRECT.has(name)) content.push(...imageBlocks(res));
    const structured = { ...res };
    if (structured.grid && structured.grid.length > 4000) structured.grid = structured.grid.slice(0, 4000) + "\n... (truncated; the full grid is in the image and in the cel file)";
    delete structured.audit_text; delete structured.legend;
    return send({ jsonrpc: "2.0", id, result: { content, structuredContent: structured, isError: res.ok === false } });
  }
  if (msg.method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
  if (msg.method === "prompts/list") return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + msg.method } });
}

if (require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      try { handle(msg); } catch (e) { if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: e.message } }); }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

module.exports = { handle, toolList, DIRECT, SERVER, PROTOCOL };
