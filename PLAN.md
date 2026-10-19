# Roadmap

PixelHand 0.2 is a release candidate. The core engine, durable tool execution, authored animation, and local/API runner are implemented. [PRODUCTION.md](PRODUCTION.md) records the evidence required for a stable release.

## Before 1.0

- Run the complete independent brief suite against a local model and an API model.
- Review final art at native scale and animated playback across every frame and facing; retain explicit acceptance and failed attempts.
- Qualify joint-driven motion on new characters, including planted-foot behavior and authored corrections.
- Record actual latency, usage, and configured cost for model runs.
- Confirm the supported Windows/Linux and Node.js matrix through CI.

## Further work

- Expand reviewed examples across projections, asset scales, palette budgets, and asset types.
- Demonstrate repeated asset production with reusable parts and measured iteration cost.
- Improve guidance and diagnostics using defects observed in real model runs.

## Completed foundations

- Palette-indexed cels, editable grids, PNG/GIF rendering, and export.
- Style rules, ramps, deterministic audits, review surfaces, tiles, and scenes.
- Authored rigs, clips, joint chains, ground contacts, and eight-facing projection.
- Shared tool contracts across MCP, CLI, and JavaScript.
- Persistent sessions, undo, conflicts, checkpoints, masks, and saved art workflows.
- Optional local/API inference and evaluation with explicit visual review.

The [original development plan](docs/archive/development-plan.md) and [design notes](docs/archive/README.md) are retained as historical evidence.
