# Production workflow and release qualification

PixelHand provides the same validated tools through CLI, stdio MCP, and a project-scoped JavaScript API. The engine remains dependency-free. Model inference is a separate, optional runner.

The current upgrade is a release candidate. Engineering checks and live art-quality qualification are separate gates in [PRODUCTION.md](../PRODUCTION.md). A mock model test establishes interface behavior; it does not establish art quality.

## Installation

Use Node.js 20.3 or newer. From a checkout:

```sh
npm test
node src/cli.js help project_init
node src/mcp.js
```

There are no runtime dependencies to install. `npm pack` creates an installable archive containing the engine, configuration examples, evaluation briefs, and documentation. An npm account or registry publication is not required for local installation:

```sh
npm pack
npm install -g ./pixelhand-0.2.0-rc.1.tgz
pixelhand help project_init
```

Package version and MCP server version come from package.json. The engine, documentation, and original example artwork are available under the [MIT license](../LICENSE), including commercial use.

## MCP and model-sized toolsets

Existing clients can continue using `node /absolute/path/to/PixelHand/src/mcp.js`. The default `all` profile preserves tool discovery for existing integrations. Set `PIXELHAND_TOOLSET=core` for a smaller initial tool surface; `drawing`, `animation`, `review`, and `world` add their expert group to the core tools.

Example Zed context server:

```json
{
  "context_servers": {
    "pixelhand": {
      "command": "node",
      "args": ["/absolute/path/to/PixelHand/src/mcp.js"],
      "env": { "PIXELHAND_TOOLSET": "core" }
    }
  }
}
```

1. Call `tool_search` with a concrete term, such as `shadow` or `skeleton`.
2. Call `tool_help` for exact input fields and examples.
3. Invoke a discovered expert tool using `tool_call` with `{ "tool": "...", "arguments": { ... } }`.

Every tool has its own JSON Schema. Required fields, direction enums, dimensions, and unknown fields are checked before execution. A refusal names the rule and a repair path. CLI help returns the same contract. Nested recipe semantics are also validated by their engine modules.

The server negotiates supported MCP versions from 2024-11-05 through 2025-11-25. Results are serialized into text for all clients; newer clients also receive structuredContent. PNG reviews are returned inline. Playback produces a GIF plus a visible PNG strip with frame order and durations.

## Durable editing and recovery

Use `project_init` only for a new project and `project_open` to resume one. Public execution refuses to initialize over an existing project.

After a successful CLI, MCP, or public API operation, `.pixelhand/session.json` holds recoverable warm cels, undo and redo stacks, snapshots, poses, briefs, masks, and request receipts. Writes use temporary files, flush, and atomic rename. The directory is local recovery state and is gitignored. Ordinary saved sprites, palettes, grids, clips, rigs, and skins remain under `art/` and should be version-controlled.

Use `save_cel` to save a warm cel into a sprite's source files. Recovery state and portable saved assets serve different purposes. Back up `.pixelhand/` as well if work contains unsaved warm cels.

If a saved grid changes on disk, reopening prefers that external edit and clears stale undo history for the affected cel. The response reports reconciliation. If a second process saves while a long-running client is open, the stale writer receives `session_conflict`; call `project_open` to refresh. A live writer lock prevents simultaneous writes. A dead process's lock is recovered when its PID no longer exists.

If recovery JSON is damaged, opening fails explicitly and preserves any already-open workspace. Keep a backup of the damaged file for inspection, move it aside, and reopen to use saved `art/` files. Unsaved warm buffers cannot be reconstructed from saved sprites alone.

Direct calls to the legacy `TOOLS[name].run()` functions are low-level programmer APIs. They bypass the public dispatcher and its automatic checkpointing. Use the CLI, MCP, or `createEngine()` for production integrations.

## Art workflow

`asset_begin` records an original brief, constraints, cels, and whether animation is required. `asset_status` returns saved decisions, defects, taste preferences, and the next action.

Stages are `brief`, `silhouette`, `blocking`, `lighting`, `detail`, `motion`, `review`, `complete`. Static assets skip motion. `asset_advance` requires evidence and advances one stage. Completion requires attached art, no outstanding declared defects, a current accepted review, and mechanical validity. Animated assets also pass clip validation.

Use `mask_define` to name regions such as face, cloak, roof, or blade. `mask_edit` changes a material colour or ramp steps inside that region. `mask_protect` explicitly locks or unlocks the region; other drawing operations cannot change protected pixels. `edit_batch` applies supported drawing operations together and rolls back edits, undo history, and edit provenance if any operation refuses.

`draw_named_map` lets a model choose simple symbols and map them to palette names, for example `{ "map": [".ss.", ".LL."], "legend": { "s": "stone.1", "L": "light.0" } }`. Dots are transparent; spaces preserve existing pixels. `palette_get` also returns the exact native grid characters. The authored lantern example exercises the public API with this workflow:

```sh
node examples/lantern.js /path/to/a-new-lantern-project
```

This authored example is useful for installation checks; it is not a live-model quality result.

`get_pixel_map` returns a cel hash. Pass `expected_hash` to drawing tools when applying an edit based on a previous read. An outdated hash refuses the edit. `review_bundle` returns labelled art, silhouette, value, and native-scale PNGs. Its visual review hash includes the palette, so palette changes invalidate recorded acceptance.

`quality_report` distinguishes mechanical failures, style diagnostics, heuristic scores, and recorded visual acceptance. A weighted craft grade never counts as visual approval. Reviews are attributed records, not authenticated human identities. The separate evaluation review command records explicit release-qualification decisions.

Style bibles can declare `audit_policy` mapping style-rule names to `error`, `warn`, or `off`. Mechanical validity rules cannot be disabled. Flat shading does not require sculpted three-step form modelling. Explicit exception policies are appropriate for disconnected sparks, floating UI elements, and other intentional stylistic choices.

## Joint-driven animation

`skeleton_define` accepts named world-space joints and two-bone chains. Coordinates are `[lateral, forward, height]`, with ground at height zero. A joint may be an absolute triple or `{ "parent": "pelvis", "offset": [...] }`. Chains name root, middle, and tip joints, a stable bend plane, optional lengths, and bend limits in degrees. Zero bend is straight.

`skeleton_pose` solves targets and planted contacts while applying `root_motion`. Planted contacts have a fixed world-space point on the ground plane. It projects the solved joints into all eight facings and saves a pose usable by `skin_pose`. Camera fields are `origin`, `scale`, and `depth_scale`.

Example chain and planted contact:

```json
{
  "joints": { "hip": [0, 0, 14], "knee": [0, 3, 7], "ankle": [0, 0, 0] },
  "chains": [{ "root": "hip", "mid": "knee", "tip": "ankle", "bend": [0, 1, 0], "max_bend": 170 }]
}
```

```json
{
  "skeleton": "traveller",
  "name": "stance",
  "root_motion": [0, 0.5, 0],
  "contacts": { "ankle": { "point": [0, 0, 0], "planted": true } }
}
```

For a segment in `skin_define`, `joint` attaches its root. Optional `to_joint` attaches its end, and `bind: [dx, dy]` specifies the segment's direction and length in the authored artwork. `offset` positions the source image relative to the root joint. The composer inverse-samples authored pixels onto the projected bone, preserves width and palette indices, and uses joint depth for overlap. A collapsed projected bone refuses and requests an authored foreshortened variant.

Use separate authored upper and lower limbs, pose variants, and local corrections. The solver supplies structural consistency; every facing still needs visual review. `skeleton_preview` exposes joints and contacts. `skeleton_contacts` and clip validation detect planted-foot drift in world space, including root movement. Existing authored rigs remain supported.

## Local and API inference

Copy a configuration example from `configs/`. Ollama uses its native chat API. LM Studio and hosted services can use a chat-completions-compatible endpoint. Set the actual model name, endpoint, and vision capability. Set `vision` to true only for a model accepting image inputs. `local_only` requires a loopback endpoint and never falls back to a hosted service.

`quality_effort` controls mandatory vision critique/refinement cycles: `low` requires 3 passes, `medium` 5, and `high` 8. Each pass means the model receives a review image, makes a successful art edit, then receives a fresh review image to judge that edit. The runner prompts the model to identify concrete defects and will not accept an early final answer before the selected count. This spends additional model calls and time for stronger visual review. Text-only runs do not enforce passes; set `vision: true` for this control to take effect. Progress events and the run transcript report the selected effort and completed/required counts.

API credentials are read from the environment variable named by `api_key_env`; configuration files must not contain raw keys. Headers and provider error bodies are omitted from transcripts and diagnostics. Token usage comes from provider responses; missing usage is labelled incomplete. Dollar cost is null unless explicit `billing.input_per_million` and `billing.output_per_million` rates are configured. Rates are user-supplied, not fetched price estimates.

```sh
node tools/run-agent.js --config configs/local.json --doctor true
node tools/run-agent.js --config configs/local.json --root /path/to/new-art-project --brief brief.txt --out /path/to/run.json
node tools/run-agent.js --config configs/local.json --root /path/to/new-art-project --brief brief.txt --out /path/to/run.json --resume /path/to/run.json
node tools/run-agent.js --config configs/api.example.json --quality-effort high --root /path/to/new-art-project --brief brief.txt
```

The runner bounds rounds, calls, reported tokens, context bytes, request timeout, and elapsed time. SIGINT cancels requests. It processes tool calls sequentially, checkpoints pending calls and results, and uses persistent request receipts for retry idempotency. Budget checks stop subsequent requests; token budgets cannot undo usage already consumed by the last provider response. A text-only model leaves visual acceptance pending. `model_finished` means the model ended its turn, not that its art met the brief.

Runner file arguments stay inside the configured project root. Place owned reference images there before a run. MCP and direct API callers retain explicit filesystem paths for host-controlled imports and exports.

## Live quality qualification

Run the original briefs in `evaluation/briefs.json` through public tools, without custom authoring scripts:

```sh
node tools/evaluate.js --config configs/local.json --out /path/to/local-evaluation
node tools/evaluate.js --config configs/api.json --out /path/to/api-evaluation
```

Each report records saved artifacts and hashes, validity, style diagnostics, errors, tokens, latency, and optional configured cost. Inspect native-scale art and animation playback, then record an explicit decision:

```sh
node tools/evaluate.js --review /path/to/local-evaluation/report.json --task crooked-lantern --verdict accepted --reviewer artist-name --notes "Readable at native scale; light and silhouette match the brief."
```

Acceptance refuses if saved source artifacts changed after the run. A full production release needs the complete brief suite for both a local model and an API model, plus accepted visual reviews. Endpoint fixtures in automated tests are not live quality evidence. `PRODUCTION.md` records outstanding gates.

From a source checkout, `npm run check` verifies the engineering gates. `npm run release:check -- --local /path/to/local/report.json --api /path/to/api/report.json` additionally checks complete accepted live suites and unchanged artifacts. Without those reports it exits nonzero and records the missing evidence in `out/release-readiness.json`.

## JavaScript embedding

```js
const { createEngine } = require("pixelhand");
const engine = createEngine("/absolute/path/to/art-project");
engine.call("project_open", {});
const review = engine.call("review_bundle", { cel: "traveller/walk/down/f0" });
```

Calls are synchronous and scoped to the chosen root. Long-running inference is exposed separately by `src/agent.js`.
