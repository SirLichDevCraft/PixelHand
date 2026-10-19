# Contributing to PixelHand

Bug fixes, reproducible model failures, clearer tool feedback, documentation improvements, and original art examples are welcome. For a large feature, open an issue describing the intended behavior before investing in the implementation.

## Development setup

Use Node.js 20.3 or newer. The core has no runtime dependencies.

```sh
git clone https://github.com/SirLichDevCraft/PixelHand.git
cd PixelHand
npm test
```

Create a branch for your change. Keep generated output under `out/`, and keep provider keys in environment variables. Local configuration files such as `configs/local.json` and `configs/api.json` are ignored.

## Making a change

- Use the public dispatcher for integrations so validation and recovery remain consistent across MCP, CLI, and JavaScript.
- Update tool contracts and help when changing tool behavior. Preserve readable existing projects and explicit refusals.
- Add regression coverage for behavior changes, especially persistence, codecs, contracts, and animation. Documentation-only changes do not need new tests.
- Keep mechanical validity, style diagnostics, and visual acceptance separate. Include a native-scale preview and contact sheet or GIF when changing rendered art or motion.
- Retain editable source and an authoring path for artwork. Describe visual properties rather than borrowing a named game's identity.

## Checks

```sh
npm test
npm run check
npm pack --dry-run
```

`npm run check` includes the automated tests and engineering checks. A full `npm run release:check` additionally requires accepted live local/API evaluation reports; ordinary contributions do not need to supply those reports. See the [workflow guide](docs/guide.md#live-quality-qualification).

## Pull requests and issues

Explain the problem, the resulting behavior, and how you checked it. Include a minimal reproduction for bugs, plus the operating system, Node version, interface, and relevant tool arguments. Remove credentials and private project content from transcripts.

For visual defects, include the brief, native-scale render, and frame/facing information. A passing audit is useful evidence alongside the image.

Contributions are accepted under the repository's [MIT license](LICENSE). You must have permission to contribute the material. Report security issues through the [security policy](SECURITY.md).
