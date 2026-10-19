#!/usr/bin/env node
"use strict";
const fs = require("fs");
const { execute, listTools } = require("./execute.js");
const { version } = require("../package.json");
const PROTOCOL = "2025-11-25";
const SUPPORTED = [PROTOCOL, "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "pixelhand", version };
const DIRECT = new Set([
  "view",
  "chunk",
  "contact_sheet",
  "contact_grid",
  "onion",
  "play",
  "silhouette",
  "squint",
  "value_map",
  "game_scale",
  "diff",
  "heatmap",
  "style_options",
  "review_pack",
  "review_bundle",
  "skeleton_preview",
]);
const toolList = listTools(process.env.PIXELHAND_TOOLSET || "all");
const MAX_MESSAGE = 8 * 1024 * 1024;
let negotiated = PROTOCOL;
function imageBlocks(res, limit = 4) {
  const candidates = [
    res.image,
    res.file,
    res.preview_image,
    ...(res.images || []).map((x) => x.image),
    ...Object.values(res.renders || {}),
  ];
  if (res.dir) candidates.push(`${res.dir}/sheet.png`);
  const out = [];
  for (const file of [...new Set(candidates)]) {
    if (out.length === limit) break;
    if (
      typeof file !== "string" ||
      !/\.png$/i.test(file) ||
      !fs.existsSync(file)
    )
      continue;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_MESSAGE / 2) continue;
    const bytes = fs.readFileSync(file);
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      continue;
    out.push({
      type: "image",
      data: bytes.toString("base64"),
      mimeType: "image/png",
    });
  }
  return out;
}
// Hosts that only forward text must receive the same data as structured clients.
function resultOf(name, res, protocol = negotiated) {
  const clean = JSON.parse(JSON.stringify(res));
  if (res.ok === false) clean.error_type = "VIOLATION";
  const result = {
    content: [{ type: "text", text: JSON.stringify(clean) }],
    isError: res.ok === false,
  };
  if (DIRECT.has(name) || res.preview_image || res.images)
    result.content.push(...imageBlocks(res));
  if (protocol >= "2025-06-18") result.structuredContent = clean;
  return result;
}
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
function handle(msg) {
  if (
    !msg ||
    typeof msg !== "object" ||
    Array.isArray(msg) ||
    msg.jsonrpc !== "2.0" ||
    typeof msg.method !== "string" ||
    (msg.id !== undefined &&
      typeof msg.id !== "number" &&
      typeof msg.id !== "string" &&
      msg.id !== null)
  )
    return send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid JSON-RPC request" },
    });
  const id = msg.id;
  if (msg.method.startsWith("notifications/")) return;
  if (id === undefined) return;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  if (msg.method === "initialize") {
    const requested = msg.params?.protocolVersion;
    negotiated = SUPPORTED.includes(requested) ? requested : PROTOCOL;
    return reply({
      protocolVersion: negotiated,
      capabilities: { tools: {} },
      serverInfo: SERVER,
      instructions:
        "Use tool_help for exact arguments. Work from a saved brief; inspect PNG reviews after edits. Heuristic grades do not establish visual acceptance. Edits recover from .pixelhand/session.json.",
    });
  }
  if (msg.method === "ping") return reply({});
  if (msg.method === "tools/list") {
    if (msg.params?.cursor)
      return send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "This list is not paginated; omit cursor",
        },
      });
    return reply({ tools: toolList });
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const res = execute(name, msg.params?.arguments ?? {});
    return reply(
      resultOf(name === "tool_call" ? msg.params?.arguments?.tool : name, res),
    );
  }
  return send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
}
function start() {
  let buffer = "",
    dropping = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (dropping) {
        dropping = false;
        continue;
      }
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_MESSAGE) {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Message exceeds 8 MiB" },
        });
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        });
        continue;
      }
      try {
        handle(message);
      } catch (e) {
        send({
          jsonrpc: "2.0",
          id: message?.id ?? null,
          error: { code: -32603, message: e.message },
        });
      }
    }
    if (Buffer.byteLength(buffer) > MAX_MESSAGE) {
      buffer = "";
      dropping = true;
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Message exceeds 8 MiB" },
      });
    }
  });
}
if (require.main === module) start();
module.exports = {
  handle,
  toolList,
  DIRECT,
  SERVER,
  PROTOCOL,
  SUPPORTED,
  imageBlocks,
  resultOf,
  start,
};
