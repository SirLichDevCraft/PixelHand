# Architecture

PixelHand separates pixel editing, project persistence, and model execution. The engine can be used without an LLM, and the same public tool dispatcher serves every integration.

```text
MCP client           CLI                 JavaScript application
src/mcp.js           src/cli.js          src/index.js
       \                 |                 /
                 src/execute.js
              contracts + durable calls
                         |
            tool implementations + core
                         |
           editable art/ + local .pixelhand/
```

## Public interfaces

- `src/mcp.js` handles stdio JSON-RPC, tool discovery, protocol negotiation, and image delivery.
- `src/cli.js` exposes the same operations to terminals and scripts.
- `src/index.js` provides `createEngine(root)`, a synchronous project-scoped facade.
- `src/contracts.js` defines individual schemas, tool profiles, validation, and help.
- `src/execute.js` routes validated calls, detects stale edits, coordinates writers, and checkpoints successful operations.

Integrations should use these entry points. Direct calls to legacy tool implementation functions bypass public recovery behavior.

## Pixels and projects

The core uses palette-indexed buffers with explicit transparency. Named palettes and material ramps keep edits precise. Saved cels use text grids alongside sprite metadata; rigs, clips, styles, and scene data are ordinary project files under `art/`.

`.pixelhand/session.json` stores recoverable working state, including unsaved warm cels, undo, workflows, and request receipts. Session writes use temporary files, flushing, and atomic rename. A writer lock and revision checks coordinate separate clients. Saved source assets and local session state serve different purposes; see [recovery](guide.md#durable-editing-and-recovery).

## Drawing, motion, and review

`src/core/` contains pixel operations, palettes, masks, audit rules, rigs, skeleton solving, clips, rendering, and export. `src/codec/` implements dependency-free image codecs. Joint solving supplies structural consistency; authored parts and pose corrections control the final pixel shapes.

Reviews expose native-scale art, silhouettes, values, contact sheets, and playback. Mechanical validity, style diagnostics, heuristic scores, and visual acceptance are separate results. Current review hashes include pixel and palette state so later edits invalidate prior acceptance.

## Optional inference

`src/agent.js` and the provider adapters run local or compatible hosted models over the public tool interface. `tools/run-agent.js` provides configuration, budgets, cancellation, and resumable transcripts. `tools/evaluate.js` runs independent briefs and records artifacts, usage, timing, and visual decisions.

No provider package is required by the engine. Credentials are supplied through named environment variables. Automated endpoint fixtures verify integration behavior; live output needs its own visual qualification.

## Repository map

| Directory | Purpose |
| --- | --- |
| `src/` | Engine, codecs, public interfaces, and optional inference |
| `test/` | Smoke, integration, and production regression checks |
| `examples/` | Small runnable examples using the public API |
| `showcase/` | Original artwork, editable projects, and previews |
| `art/` | Original development fixtures and authored project assets |
| `bench/` | Showcase authoring, craft gates, and coverage experiments |
| `probe/` | Historical feasibility experiments used by some craft gates |
| `configs/` | Provider configuration templates without credentials |
| `evaluation/` | Independent art briefs |
| `docs/archive/` | Historical design notes and measured findings |

Generated runs, packages, recovery state, and local provider configurations are ignored by Git. The npm archive includes the engine and current user documentation; development experiments and historical notes stay in the source repository.
