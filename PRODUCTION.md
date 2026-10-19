# Production release gates

Production means that a fresh agent can create, review, resume, and export useful art through the documented interface. A passing codec suite or a high heuristic score alone does not establish that.

This document tracks the production upgrade requested on 2026-10-19. Existing projects and authored showcase art must remain readable.

| Gate | Required evidence | Status |
| --- | --- | --- |
| Tool contracts | Every advertised tool has its own validated inputs; CLI and MCP agree; compact discovery works | Implemented; schema coverage, compact discovery and CLI/API/MCP checks pass |
| Feedback | Text clients receive results; protocol versions negotiate; animation includes visible PNG frames | Implemented; JSON text fallback, protocol negotiation, PNG review and playback-strip checks pass |
| Recovery | Edits, checkpoints, poses, briefs, and preferences survive a fresh process; refused batches change nothing | Implemented; fresh-process, writer-conflict, external-grid, batch rollback and request-receipt checks pass |
| Art workflow | Saved stages, named masks, protected pixels, explicit visual review and actionable next steps | Implemented; saved stages, named symbol maps, protected masks and palette-aware review hashes tested |
| Animation | Constrained joint chains, ground contacts, consistent projection, contact diagnostics, authored corrections | Solver, projection, bone attachments and contact checks implemented; live motion review pending |
| Inference | Local and API endpoints, bounded agent loop, image delivery, cancellation, usage reporting | Native Ollama and chat-completions adapters pass HTTP fixtures, retries, timeouts and bounded-loop checks; live endpoints pending |
| Evaluation | Cold-start briefs run through public tools; cost/latency/errors recorded; independent visual decisions retained | Cold-start harness and source-hash review checks pass fixtures; live quality qualification pending |
| Release engineering | Windows/Linux and supported Node CI, regression tests, reproducible package, installation and recovery guide | 304 tests pass on this Windows host; archive installation checked separately; Windows/Linux Node 20/22/24 CI configured |
| Live model quality | Representative local and API model runs, original briefs, human review of final images and motion | Not run; no endpoint configured |

## Release policy

- Keep deterministic correctness, style diagnostics, and visual acceptance separate.
- Never label a heuristic grade as human visual approval.
- Do not mark a live evaluation passed using a mock endpoint or an authored showcase script.
- Record incomplete gates and failed runs. A model that exhausts its budget has not completed the task.
- Keep credentials in environment variables and outside project files and evaluation transcripts.
- Preserve the dependency-free engine core. Inference and hosting are separate entry points over the same tool contracts.
- Do not declare a stable 1.0 release until the gates above have evidence.
