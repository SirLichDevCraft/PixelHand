# PixelHand

[![Tests](https://github.com/SirLichDevCraft/PixelHand/actions/workflows/test.yml/badge.svg)](https://github.com/SirLichDevCraft/PixelHand/actions/workflows/test.yml)

**A hand-placed 2D pixel-art engine directed through tools and MCP.** PixelHand keeps sprites as palette-indexed pixels and editable text grids, then helps an artist or agent render, inspect, audit and refine them at native game scale.

The strongest results come from a clear design brief, authored pixels, visual review and iteration. The current release candidate adds durable workflows and local/API model execution; [production release gates](PRODUCTION.md) track qualification.

## Showcases

### Rowan — eight-direction walk

An original 32 × 40 character with eight authored facings, a four-pose walk cycle, rigged limb layering and frame-by-frame review.

![Rowan walking across eight authored facings](showcase/hero/preview/walk-all-directions.gif)

[Open the eight-facing contact sheet](showcase/hero/preview/walk-contact.png) · [See per-facing GIFs and audit details](showcase/hero/README.md)

### Farmhouse

A hand-authored building study rendered through PixelHand's palette and inspection workflow.

![Farmhouse study rendered by PixelHand](showcase/farmhouse/preview.png)

## What the engine provides

- Palette-indexed cels and text-grid source that can be reviewed and changed precisely.
- Style bibles, material ramps, and palette-aware drawing operations.
- Renders for silhouette, value, game-scale, contact sheets, animation playback and diffs.
- Deterministic audits for palette use, clusters, silhouette, grounding and other craft rules.
- Authored rigs, named joints, occlusion order, key poses and multi-direction clips.
- PNG/GIF previews, export gates, and persistence in ordinary project files.
- A CLI and a stdio MCP server, so game tools and coding agents can direct the same engine.

## Try it

Requires Node.js 20 or newer. PixelHand has no runtime package dependencies.

```sh
npm test
node src/cli.js list
node bench/showcase-hero.js
```

The showcase command writes its previews under `showcase/hero/preview/`.

For installation, compact model toolsets, recovery, skeleton authoring, local/API inference, and live quality evaluation, see the [production workflow guide](docs/12-production.md).

## MCP

Run the stdio server from the repository:

```sh
node src/mcp.js
```

For Zed, add a local context server in `settings.json` and use the local path to this checkout:

```json
{
  "context_servers": {
    "pixelhand": {
      "command": "node",
      "args": ["/path/to/PixelHand/src/mcp.js"],
      "env": {}
    }
  }
}
```

Use `project_open` with the root of an existing PixelHand game project before editing it. Use `project_init` only to create a new art project. Render and inspect the result after edits; animation should be reviewed across every frame and facing before export.

## Project status

PixelHand 0.2 is a release candidate. [`PRODUCTION.md`](PRODUCTION.md) tracks engineering and live model qualification separately. [`PLAN.md`](PLAN.md) retains the original development evidence and coverage work. Showcases demonstrate the authored workflow; model quality is evaluated on independent briefs with explicit visual review.

## License

No open-source license is currently provided. Public visibility does not grant permission to reuse or redistribute the code or artwork.
