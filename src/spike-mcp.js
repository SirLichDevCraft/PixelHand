// Phase 1 spike: the smallest possible MCP server that returns an IMAGE.
// Zero dependencies: hand-rolled JSON-RPC 2.0 over stdio, newline-delimited.
//
// Purpose is narrow and deliberate: settle ONE question before any real engine work —
// does an image content block from a `direct`-exposure MCP tool actually reach the
// model as an image in pi? If yes, `view` returns image+grid+audit in one round trip.
// If no, the engine is unchanged and the image comes from read() on a written file.
//
// Test it locally without pi at all:
//   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
//     '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
//     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
//     '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"spike_view","arguments":{}}}' \
//     | node src/spike-mcp.js
"use strict";
const { encodePNG, upscaleNearest } = require("../probe/png.js");

// A tiny known pattern with a deliberate defect, so "did I really see it" is checkable.
const ART = [
  "1111111111111111",
  "1222222222222221",
  "1223333333322211",
  "1233333333332211",
  "1223333333322211",
  "1222333332222211",
  "1222233222222211",
  "1222222222222211",
  "1222222222222211",
  "1222222222222211",
  "1111111111111111",
];
const PAL = { "1": [26, 26, 34], "2": [92, 138, 84], "3": [176, 214, 120] };
const W = ART[0].length, H = ART.length, Z = 36;

function render() {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // deliberate defect: one lone magenta pixel at art (11,4)
      const ch = (x === 11 && y === 4) ? "X" : ART[y][x];
      const c = ch === "X" ? [214, 78, 168] : PAL[ch];
      const o = (y * W + x) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  return encodePNG(W * Z, H * Z, upscaleNearest(W, H, rgb, Z, 3));
}

const TOOLS = [{
  name: "spike_view",
  description: "Returns one PNG image block plus a text payload. Used only to verify image transport.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

function handle(msg) {
  if (!msg || !msg.method) return;
  const id = msg.id;
  if (msg.method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "pixelhand-spike", version: "0.0.1" },
    }});
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    const png = render();
    return send({ jsonrpc: "2.0", id, result: {
      content: [
        { type: "text", text: `spike: ${W}x${H} art at Z=${Z}, render ${W * Z}x${H * Z}. Known defect: lone magenta pixel at art (11,4).` },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ],
      structuredContent: { ok: true, art: [W, H], zoom: Z, known_defect: { at: [11, 4], colour: "magenta" } },
      isError: false,
    }});
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + msg.method } });
}

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
