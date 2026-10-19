# PixelHand

[![Tests](https://github.com/SirLichDevCraft/PixelHand/actions/workflows/test.yml/badge.svg)](https://github.com/SirLichDevCraft/PixelHand/actions/workflows/test.yml)

**A hand-placed 2D pixel-art engine directed through tools and MCP.** PixelHand keeps sprites as palette-indexed pixels and editable text grids, then helps an artist or agent render, inspect, audit and refine them at native game scale.

It is an experimental engine, not a claim that AI can replace an art director. The strongest results come from a clear design brief, authored pixels, visual review and iteration.

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

PixelHand is under active development. Its plan records completed gates, open coverage work, known limitations and evaluation criteria in [`PLAN.md`](PLAN.md). The current showcase is evidence of the engine workflow, not a guarantee that every generated asset will meet the same quality without review.

## License

No open-source license is currently provided. Public visibility does not grant permission to reuse or redistribute the code or artwork.
