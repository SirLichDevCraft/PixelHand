"use strict";
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync, spawn } = require("child_process");
const { execute, listTools } = require("../src/execute.js");
const { W, TOOLS, Workspace } = require("../src/tools.js");
const { validate } = require("../src/contracts.js");
const { hashCel, within } = require("../src/core/storage.js");
const skeleton = require("../src/core/skeleton.js");
const { createProvider } = require("../src/inference.js");
const { runTask } = require("../src/agent.js");
const { resultOf } = require("../src/mcp.js");

const STYLE = {
  id: "test",
  projection: "side",
  art_scale: 16,
  palette_size: 8,
  temperature: "grey-value",
  edge_policy: "none",
  shading: "flat",
  detail: "pristine",
  motion: "static",
  mood: "sterile",
};
let root;
function call(name, args = {}) {
  const r = execute(name, args);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pixelhand-prod-"));
  call("project_init", {
    root,
    game: "production-test",
    style: STYLE,
    directions: ["down"],
  });
  call("palette_set", {
    id: "test",
    spec: {
      ramps: {
        stone: { role: "material", colors: ["#222222", "#666666", "#aaaaaa"] },
      },
      single: { spark: { rgb: "#eeeeee", role: "accent" } },
    },
  });
  call("cel_new", { cel: "prop", w: 16, h: 16, palette: "test" });
});
afterEach(() => {
  const resolved = path.resolve(root),
    prefix = path.join(os.tmpdir(), "pixelhand-prod-");
  assert.ok(resolved.startsWith(prefix));
  fs.rmSync(resolved, { recursive: true, force: true });
});

test("every tool has an individual schema and examples obey their contract", () => {
  for (const [name, t] of Object.entries(TOOLS)) {
    assert.equal(t.inputSchema.type, "object", name);
    for (const example of t.examples)
      assert.deepEqual(validate(t.inputSchema, example), [], name);
  }
  assert.ok(
    new Set(listTools().map((t) => JSON.stringify(t.inputSchema))).size > 80,
  );
  assert.ok(listTools("core").length < 35);
  assert.ok(Buffer.byteLength(JSON.stringify(listTools("core"))) < 35000);
  assert.equal(
    execute("draw_pixel_map", { cel: "prop" }).violations[0].rule,
    "invalid_arguments",
  );
  assert.equal(
    execute("cel_new", {
      cel: "huge",
      w: 10000000,
      h: 10000000,
      palette: "test",
    }).ok,
    false,
  );
});

test("edits, undo, snapshots and authored poses survive a different process", () => {
  call("put", { cel: "prop", cells: "2,3,stone.1" });
  const snap = call("snapshot", { cel: "prop" }).snapshot;
  call("put", { cel: "prop", cells: "2,3,stone.2" });
  call("pose_define", { name: "contact", spec: { parts: { arm: { dx: 1 } } } });
  const fresh = new Workspace(root);
  fresh.load();
  assert.equal(fresh.store.get("prop").get(2, 3), 2);
  assert.equal(fresh.poses.get("contact").parts.arm.dx, 1);
  assert.equal(fresh.store.undoStep("prop").ok, true);
  assert.equal(fresh.store.get("prop").get(2, 3), 1);
  assert.equal(fresh.store.restore(snap).ok, true);
  const child = spawnSync(
    process.execPath,
    [
      require.resolve("../src/cli.js"),
      "get_pixel_map",
      "--root",
      root,
      "--cel",
      "prop",
      "--json",
      "true",
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.ok(JSON.parse(child.stdout).grid);
});

test("an atomic edit batch rolls back earlier edits, undo history, and provenance", () => {
  const original = hashCel(W.store.get("prop")),
    depth = W.store.depth("prop"),
    history = W.project.historyFor("prop").length;
  const result = execute("edit_batch", {
    operations: [
      { tool: "put", arguments: { cel: "prop", cells: "3,3,stone.1" } },
      { tool: "put", arguments: { cel: "prop", cells: "4,4,not-a-colour" } },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(hashCel(W.store.get("prop")), original);
  assert.equal(W.store.depth("prop"), depth);
  assert.equal(W.project.historyFor("prop").length, history);
  assert.equal(new Workspace(root).load().doc.id, "production-test");
});

test("named masks protect approved pixels and reject stale patches", () => {
  call("put", { cel: "prop", cells: "3,3,stone.1;4,3,stone.1" });
  call("mask_define", {
    cel: "prop",
    name: "face",
    region: { x: 3, y: 3, w: 1, h: 1 },
    protect: true,
  });
  const original = hashCel(W.store.get("prop"));
  assert.equal(
    execute("put", { cel: "prop", cells: "3,3,stone.2;4,3,stone.2" })
      .violations[0].rule,
    "protected_pixels",
  );
  assert.equal(hashCel(W.store.get("prop")), original);
  assert.equal(
    execute("put", { cel: "prop", cells: "5,3,stone.2", expected_hash: "old" })
      .violations[0].rule,
    "stale_cel",
  );
  call("mask_protect", { cel: "prop", mask: "face", protect: false });
  call("mask_edit", { cel: "prop", mask: "face", steps: 1 });
  assert.equal(W.store.get("prop").get(3, 3), 2);
  assert.equal(W.store.get("prop").get(4, 3), 1);
});

test("art workflow resumes with evidence and cannot skip review", () => {
  call("asset_begin", {
    asset: "lantern",
    brief: "A crooked stone lantern with a bright small window",
    cels: ["prop"],
  });
  assert.equal(
    execute("asset_advance", {
      asset: "lantern",
      stage: "complete",
      evidence: "looks good",
    }).ok,
    false,
  );
  call("asset_advance", {
    asset: "lantern",
    stage: "silhouette",
    evidence: "Three distinct options considered; choose the crooked roof",
  });
  const fresh = new Workspace(root);
  fresh.load();
  assert.equal(fresh.production.assets.lantern.stage, "silhouette");
  assert.match(
    call("asset_status", { asset: "lantern" }).next_action,
    /silhouette/i,
  );
  assert.equal(
    call("quality_report", { cel: "prop" }).visual.status,
    "unreviewed",
  );
});

test("text-only MCP clients receive actual results and legacy protocol omits newer fields", () => {
  const res = execute("tools_list", {}),
    modern = resultOf("tools_list", res),
    legacy = resultOf("tools_list", res, "2024-11-05");
  assert.equal(
    JSON.parse(modern.content[0].text).count,
    Object.keys(TOOLS).length,
  );
  assert.equal(legacy.structuredContent, undefined);
  assert.equal(JSON.parse(legacy.content[0].text).count, res.count);
  assert.equal(
    modern.content[0].text.includes("Treat that as a failure"),
    false,
  );
});

test("playback returns a visible PNG strip as well as a GIF", () => {
  call("clip_create", { id: "walk", template: "walk", directions: ["down"] });
  call("cel_copy", { cel: "prop", into: "other" });
  call("put", { cel: "other", cells: "4,5,stone.1" });
  call("clip_set_frames", {
    clip: "walk",
    direction: "down",
    frames: [
      { cel: "prop", pose: "contact", duration: 100 },
      { cel: "other", pose: "passing", duration: 150 },
    ],
  });
  const result = call("play", { clip: "walk", palette: "test", zoom: 4 });
  assert.ok(
    fs
      .readFileSync(result.preview_image)
      .subarray(1, 4)
      .equals(Buffer.from("PNG")),
  );
  assert.ok(resultOf("play", result).content.some((c) => c.type === "image"));
});

const RIG = {
  joints: { hip: [0, 0, 14], knee: [0, 3, 7], ankle: [0, 0, 0] },
  chains: [
    { root: "hip", mid: "knee", tip: "ankle", bend: [0, 1, 0], max_bend: 170 },
  ],
  camera: { origin: [16, 36], scale: 1, depth_scale: 0.5 },
};
test("joint solver preserves bone lengths, knee direction and planted feet while the body moves", () => {
  const poses = [0, 0.5, 1].map((y) =>
    skeleton.solve(RIG, {
      root_motion: [0, y, 0],
      contacts: { ankle: { point: [0, 0, 0], planted: true } },
    }),
  );
  for (const pose of poses) {
    assert.ok(pose.diagnostics[0].bone_length_error < 1e-8);
    assert.ok(pose.joints.knee[1] > 0);
    assert.deepEqual(pose.joints.ankle, [0, 0, 0]);
  }
  assert.equal(skeleton.contactReport(poses).ok, true);
  assert.throws(
    () => skeleton.solve(RIG, { targets: { ankle: [0, 50, 0] } }),
    /allowed reach/,
  );
  const drift = structuredClone(poses);
  drift[1].joints.ankle[0] += 1;
  assert.equal(skeleton.contactReport(drift).ok, false);
  const down = skeleton.project({ p: [0, 4, 0] }, "down"),
    right = skeleton.project({ p: [0, 4, 0] }, "right");
  assert.deepEqual(down.joints.p, [16, 38]);
  assert.deepEqual(right.joints.p, [20, 36]);
});

test("skeleton poses persist projected joints for the authored skin composer", () => {
  call("skeleton_define", { id: "body", spec: RIG });
  call("skeleton_pose", {
    skeleton: "body",
    name: "stance",
    contacts: { ankle: { point: [0, 0, 0], planted: true } },
  });
  const fresh = new Workspace(root);
  fresh.load();
  assert.equal(Object.keys(fresh.poses.get("stance").joints).length, 8);
  assert.equal(fresh.poses.get("stance").skeleton.contacts.ankle.planted, true);
});

test("unsafe names and symlink ancestors cannot escape a project directory", () => {
  for (const name of [
    "../outside",
    "safe/../../outside",
    "C:\\outside",
    "/outside",
  ])
    assert.throws(() => within(root, name));
  const original = W.root;
  assert.equal(
    execute("project_open", { root: path.join(root, "missing") }).ok,
    false,
  );
  assert.equal(W.root, original);
  const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "pixelhand-link-target-"),
    ),
    link = path.join(root, "escape");
  try {
    fs.symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => within(root, "escape", "outside.png"), /link outside/);
  } finally {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.rmdirSync(outside);
  }
});

test("saved grids edited by a person take precedence over a stale warm cache", () => {
  call("sprite_create", {
    id: "prop",
    w: 16,
    h: 16,
    palette: "test",
    style: "test",
  });
  call("put", { cel: "prop", cells: "2,3,stone.1" });
  call("save_cel", { cel: "prop", sprite: "prop", cel_key: "base" });
  call("put", { cel: "prop", cells: "2,3,stone.2" });
  const saved = W.project.readCel("prop", "base");
  saved.set(2, 3, 0);
  const file = path.join(
    root,
    "art",
    "sprites",
    "prop",
    W.project.sprite_info("prop").cels.base,
  );
  fs.writeFileSync(file, saved.toGrid());
  const opened = call("project_open", { root });
  assert.equal(W.store.get("prop").get(2, 3), 0);
  assert.equal(opened.warnings[0].rule, "external_cel_edit");
});

test("request receipts prevent duplicate edits after a runner restart", () => {
  const first = execute(
    "put",
    { cel: "prop", cells: "2,3,stone.1" },
    { requestId: "run:edit-1" },
  );
  assert.equal(first.ok, true);
  const depth = W.store.depth("prop");
  call("project_open", { root });
  const repeated = execute(
    "put",
    { cells: "2,3,stone.1", cel: "prop" },
    { requestId: "run:edit-1" },
  );
  assert.deepEqual(repeated, first);
  assert.equal(W.store.depth("prop"), depth);
  assert.equal(
    execute(
      "put",
      { cel: "prop", cells: "2,3,stone.2" },
      { requestId: "run:edit-1" },
    ).violations[0].rule,
    "request_conflict",
  );
});

test("a stale writer refuses to overwrite a different process's saved edits", () => {
  const child = spawnSync(
    process.execPath,
    [
      require.resolve("../src/cli.js"),
      "put",
      "--root",
      root,
      "--cel",
      "prop",
      "--cells",
      "3,3,stone.2",
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(
    execute("put", { cel: "prop", cells: "4,4,stone.1" }).violations[0].rule,
    "session_conflict",
  );
  call("project_open", { root });
  assert.equal(W.store.get("prop").get(3, 3), 2);
});

test("art review is invalidated when a material palette changes", () => {
  call("put", { cel: "prop", cells: "3,3,stone.1" });
  call("asset_begin", {
    asset: "prop",
    brief: "A simple stone icon",
    cels: ["prop"],
  });
  call("asset_review", {
    asset: "prop",
    verdict: "accepted",
    reviewer: "test reviewer",
    evidence: "Reviewed the current colours",
  });
  assert.equal(
    call("quality_report", { cel: "prop", asset: "prop" }).visual.status,
    "accepted",
  );
  call("palette_set", {
    id: "test",
    spec: {
      ramps: {
        stone: { role: "material", colors: ["#111122", "#333355", "#777799"] },
      },
      single: { spark: { rgb: "#eeeeff", role: "accent" } },
    },
  });
  assert.equal(
    call("quality_report", { cel: "prop", asset: "prop" }).visual.status,
    "unreviewed",
  );
});

test("a bone-attached authored segment follows the solved joint direction without new colours", () => {
  const { Cel } = require("../src/core/cel.js");
  const { bonePixels } = require("../src/core/bone-raster.js");
  const c = new Cel(3, 9, "test", "shin");
  for (let y = 0; y < 9; y++) c.set(1, y, y === 8 ? 2 : 1);
  const pixels = [
    ...bonePixels(
      { cel: c, anchorOffset: [-1, 0], bindVector: [0, 8] },
      [4, 4],
      [12, 4],
      [16, 16],
    ),
  ];
  assert.ok(pixels.some((p) => p.x === 12 && p.y === 4 && p.index === 2));
  assert.ok(pixels.some((p) => p.x === 4 && p.y === 4 && p.index === 1));
  assert.ok(pixels.every((p) => [1, 2].includes(p.index)));
});

test("PNG imports decode grayscale alpha and reject corruption or unsupported filters", () => {
  const { decodePNG, chunk, encodeRGB } = require("../src/codec/png.js"),
    zlib = require("zlib");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 4;
  const file = Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 40, 0, 120, 200]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const decoded = decodePNG(file);
  assert.deepEqual([...decoded.alpha], [0, 200]);
  assert.deepEqual([...decoded.rgb], [40, 40, 40, 120, 120, 120]);
  const damaged = encodeRGB(1, 1, Buffer.from([1, 2, 3]));
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decodePNG(damaged), /checksum/);
  const wrongFilter = Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([5, 40, 0, 120, 200]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePNG(wrongFilter), /scanline filter/);
});

test("named maps use palette names and refuse unknown symbols without partially painting", () => {
  call("draw_named_map", {
    cel: "prop",
    map: [".dd.", ".ll."],
    legend: { d: "stone.0", l: "stone.2" },
    x: 1,
    y: 2,
  });
  assert.equal(W.store.get("prop").get(2, 2), 0);
  assert.equal(W.store.get("prop").get(2, 3), 2);
  const original = hashCel(W.store.get("prop"));
  assert.equal(
    execute("draw_named_map", {
      cel: "prop",
      map: ["dd", "dz"],
      legend: { d: "stone.1" },
    }).ok,
    false,
  );
  assert.equal(hashCel(W.store.get("prop")), original);
  assert.ok(
    call("palette_get", { id: "test" }).legend.some(
      (e) => e.name === "stone.0" && typeof e.char === "string",
    ),
  );
});

test("MCP recovers after malformed JSON and negotiates a compact legacy session", () => {
  const messages = [
    "not-json",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "tools_list", arguments: {} },
    }),
  ];
  const child = spawnSync(
    process.execPath,
    [require.resolve("../src/mcp.js")],
    {
      encoding: "utf8",
      input: messages.join("\n") + "\n",
      env: { ...process.env, PIXELHAND_TOOLSET: "core" },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  const replies = child.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].result.protocolVersion, "2024-11-05");
  assert.equal(replies[2].result.tools.length, listTools("core").length);
  assert.equal(replies[3].result.structuredContent, undefined);
  assert.equal(
    JSON.parse(replies[3].result.content[0].text).count,
    Object.keys(TOOLS).length,
  );
});

test("a warm-only clip and scene remain usable after restarting the engine", () => {
  call("put", { cel: "prop", cells: "2,2,stone.1" });
  call("clip_create", { id: "idle", template: "idle", directions: ["down"] });
  call("clip_set_frames", {
    clip: "idle",
    direction: "down",
    frames: [{ cel: "prop", pose: "rest", duration: 200 }],
  });
  call("scene_create", {
    id: "yard",
    cols: 2,
    rows: 2,
    tile: 16,
    palette: "test",
  });
  call("scene_place", { scene: "yard", kind: "tile", cel: "prop", at: [0, 0] });
  call("project_open", { root });
  assert.equal(W.clips.get("idle").frames("down")[0].cel.get(2, 2), 1);
  assert.equal(W.scenes.get("yard").composite().get(2, 2), 1);
  const checkpoint = call("snapshot", { cel: "prop" }).snapshot;
  call("put", { cel: "prop", cells: "2,2,stone.2" });
  call("restore", { snapshot: checkpoint });
  assert.equal(W.clips.get("idle").frames("down")[0].cel.get(2, 2), 1);
  assert.equal(W.scenes.get("yard").composite().get(2, 2), 1);
});

test("clip validation refuses a declared facing with no frames", () => {
  call("clip_create", {
    id: "incomplete",
    template: "walk",
    directions: ["down", "up"],
  });
  const checked = execute("loop_validate", { clip: "incomplete" });
  assert.equal(checked.ok, false);
  assert.match(checked.clips.up.problems[0], /no authored frames/);
});

async function server(handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${instance.address().port}`,
    close: () =>
      new Promise((resolve) => {
        instance.close(resolve);
        instance.closeAllConnections();
      }),
  };
}
test("both provider adapters exchange tool results and images over real HTTP", async () => {
  const requests = [];
  const endpoint = await server(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    requests.push({ url: req.url, body: text ? JSON.parse(text) : null });
    res.setHeader("Content-Type", "application/json");
    const native = req.url.startsWith("/api/");
    const message = {
      role: "assistant",
      content: "inspect",
      tool_calls: [
        {
          id: "call_test",
          function: {
            name: "tool_help",
            arguments: native
              ? { tool: "view" }
              : JSON.stringify({ tool: "view" }),
          },
        },
      ],
    };
    res.end(
      JSON.stringify(
        native
          ? { message, prompt_eval_count: 7, eval_count: 3 }
          : {
              choices: [{ message }],
              usage: { prompt_tokens: 7, completion_tokens: 3 },
            },
      ),
    );
  });
  try {
    for (const provider of ["ollama", "chat-completions"]) {
      const client = createProvider({
        provider,
        base_url: endpoint.url,
        model: "fixture",
        local_only: true,
        vision: true,
      });
      const response = await client.chat(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "Inspect" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
            ],
          },
        ],
        listTools("core"),
      );
      assert.equal(response.message.tool_calls[0].function.name, "tool_help");
      assert.equal(response.usage.prompt_tokens, 7);
    }
    assert.deepEqual(requests[0].body.messages[0].images, ["aGVsbG8="]);
    assert.equal(requests[1].body.messages[0].content[1].type, "image_url");
  } finally {
    await endpoint.close();
  }
});

test("agent loops are bounded, preserve tool results, and distinguish model finish from visual approval", async () => {
  let round = 0;
  const endpoint = await server(async (req, res) => {
    for await (const chunk of req) {
    }
    const message =
      round++ === 0
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "help",
                type: "function",
                function: { name: "tool_help", arguments: '{"tool":"view"}' },
              },
            ],
          }
        : { role: "assistant", content: "Ready for review" };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
    );
  });
  try {
    const output = path.join(root, "out", "run.json");
    const result = await runTask({
      config: {
        provider: "chat-completions",
        base_url: endpoint.url,
        model: "fixture",
      },
      root,
      brief: "Draw an original bent lantern",
      output,
      limits: { rounds: 2, calls: 2, tokens: 100 },
    });
    assert.equal(result.status, "model_finished");
    assert.equal(result.calls, 1);
    assert.equal(result.visual_approved, undefined);
    assert.ok(
      JSON.parse(fs.readFileSync(output, "utf8")).messages.some(
        (m) => m.role === "tool",
      ),
    );
  } finally {
    await endpoint.close();
  }
});

test("inference retries transient HTTP failures and respects request timeouts", async () => {
  let requests = 0;
  const endpoint = await server((req, res) => {
    req.resume();
    if (requests++ === 0) {
      res.statusCode = 429;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }),
    );
  });
  try {
    const p = createProvider({
      provider: "chat-completions",
      base_url: endpoint.url,
      model: "fixture",
      timeout_ms: 1000,
    });
    assert.equal(
      (await p.chat([{ role: "user", content: "hi" }], [])).message.content,
      "ok",
    );
    assert.equal(requests, 2);
  } finally {
    await endpoint.close();
  }
  const slow = await server((req) => req.resume());
  try {
    const p = createProvider({
      provider: "chat-completions",
      base_url: slow.url,
      model: "fixture",
      timeout_ms: 30,
    });
    await assert.rejects(
      p.chat([{ role: "user", content: "hi" }], []),
      /abort|timeout/i,
    );
  } finally {
    await slow.close();
  }
});

test("a cold-start fixture creates saved art through the runner and evaluation detects palette tampering", async () => {
  const { evaluate, review } = require("../src/evaluation.js");
  let round = 0;
  const endpoint = await server(async (req, res) => {
    req.resume();
    const commands =
      round++ === 0
        ? [
            [
              "project_init",
              {
                game: "evaluation-fixture",
                style: STYLE,
                directions: ["down"],
              },
            ],
            [
              "palette_set",
              {
                id: "test",
                spec: {
                  ramps: {
                    stone: { colors: ["#222222", "#666666", "#aaaaaa"] },
                  },
                },
              },
            ],
            [
              "sprite_create",
              { id: "fixture", w: 16, h: 16, palette: "test", style: "test" },
            ],
            [
              "draw_named_map",
              {
                cel: "fixture.base",
                map: [".ss.", ".ss."],
                legend: { s: "stone.1" },
              },
            ],
            [
              "save_cel",
              { cel: "fixture.base", sprite: "fixture", cel_key: "base" },
            ],
          ]
        : [];
    const message = {
      role: "assistant",
      content: commands.length ? "" : "Fixture complete",
      ...(commands.length
        ? {
            tool_calls: commands.map(([name, args], i) => ({
              id: `fixture_${i}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            })),
          }
        : {}),
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    );
  });
  try {
    const output = path.join(root, "evaluation"),
      config = {
        provider: "chat-completions",
        base_url: endpoint.url,
        model: "fixture",
        local_only: true,
        limits: { calls: 10, rounds: 3 },
      };
    const report = await evaluate({
      config,
      output,
      briefs: [
        {
          id: "fixture",
          brief: "Wire protocol fixture; not live art quality evidence",
          minimum_sprites: 1,
          minimum_cels: 1,
        },
      ],
    });
    assert.equal(
      report.tasks[0].ok,
      true,
      JSON.stringify({
        problems: report.tasks[0].problems,
        tools: JSON.parse(
          fs.readFileSync(
            path.join(output, "projects", "fixture", "out", "agent-run.json"),
            "utf8",
          ),
        ).messages.filter((m) => m.role === "tool"),
      }),
    );
    assert.equal(report.passed, false);
    const palette = path.join(
      output,
      "projects",
      "fixture",
      "art",
      "palettes",
      "test.json",
    );
    fs.appendFileSync(palette, " ");
    assert.throws(
      () =>
        review(path.join(output, "report.json"), "fixture", {
          verdict: "accepted",
          reviewer: "test",
          notes: "not a live visual judgement",
        }),
      /changed after evaluation/,
    );
  } finally {
    await endpoint.close();
  }
});
