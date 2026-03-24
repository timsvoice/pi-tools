# Extensions

Extensions live under the top-level `extensions/` directory. Each extension owns its entrypoint, prompts, and documentation under `docs/extensions/<extension>/`.

## Layout
- `extensions/<extension>/index.ts`: extension entrypoint
- `extensions/<extension>/prompts/`: prompt templates
- `docs/extensions/<extension>/`: extension-specific docs (plan, implementation, runbook)

## Current extensions
- `scribe`: `extensions/scribe/`
