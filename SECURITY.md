# Security policy

Security fixes target the current development branch and latest release candidate. Older snapshots may need to be upgraded.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/SirLichDevCraft/PixelHand/security/advisories/new) for security reports. Include affected versions, a minimal reproduction, the expected impact, and any suggested fix. Do not include real API keys or private artwork.

Please keep unpatched vulnerabilities out of public issues. Ordinary bugs and art-quality problems belong in the issue tracker.

## Execution model

PixelHand is a local development tool with filesystem access under the account running it. MCP clients and scripts can request imports and exports; the direct interfaces are not a sandbox for untrusted callers. Run the server only for clients you trust.

Provider credentials belong in environment variables. Local provider configuration and generated transcripts should be reviewed before sharing.
