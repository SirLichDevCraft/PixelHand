# Documentation

Start with the [workflow guide](guide.md) for installation, agent connections, recovery, animation, and model execution.

| Guide | What it covers |
| --- | --- |
| [Installation and MCP](guide.md#installation) | Run from source, install a local archive, and connect an agent |
| [Art workflow](guide.md#art-workflow) | Briefs, stages, named pixel maps, masks, and visual acceptance |
| [Animation](guide.md#joint-driven-animation) | Joint chains, contacts, projection, authored parts, and review |
| [Local and API models](guide.md#local-and-api-inference) | Provider configuration, budgets, cancellation, and resumable runs |
| [Recovery](guide.md#durable-editing-and-recovery) | Saved assets, session state, conflicts, and external edits |
| [Architecture](architecture.md) | Public entry points, execution, storage, rendering, and inference |
| [Asset provenance](provenance.md) | Repository licensing, original artwork, and import records |
| [Release qualification](../PRODUCTION.md) | Evidence required for a stable release |
| [Contributing](../CONTRIBUTING.md) | Development setup, useful checks, bug reports, and pull requests |

## Examples

- [The Starfall Archive](../showcase/starfall/README.md): an original floating observatory scene with eight ambient animation frames and editable source.
- [Lantern](../examples/lantern.js): a small authored example using the public JavaScript API.
- [Rowan](../showcase/hero/README.md): an eight-facing character, animation previews, and audit results.
- [Farmhouse](../showcase/farmhouse/README.md): an editable building study and its authoring script.

## Development history

The [archive](archive/README.md) preserves early design notes and experimental findings. Those documents describe the project's development and can contain superseded proposals. Use the current workflow guide and tool contracts for supported behavior.
