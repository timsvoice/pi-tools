# pi-scribe

Project-local pi extension that captures durable decisions and conventions from recent conversation turns.

## Install / Load
- Place in `.pi/extensions/scribe/` (this repo already does).
- Start pi from the repo root and run `/reload` to hot-load changes.

## Requirements
- Node.js >= 22 (see `.nvmrc`).

## Behavior
- Runs on `agent_end`.
- Scribe cadence: every 1 turn.
- Editor cadence: every 3 turns.
- Working message shows `Scribing...` / `Editorializing...` during runs and clears on completion. Errors show as `Scribe error: ...`.
- Footer counters show `Scribe X/1` and `Editor Y/3` each turn.
- Footer shows last run status: `Scribe ✓ HH:MM`, `Editor ✓ HH:MM` (or ✗ on failure).

## Outputs
- `.scribe/DECISIONS.md` (append-only, header on first write). JSON model output is transformed into a markdown decision template containing all fields.
- `.scribe/CONVENTIONS.md` (fully rewritten per editor run)

## Testing
Before every commit, run all tests, including promptfoo.
```bash
npm test
npm run lint
npm run lint:complexity
npm run promptfoo
```

## Prompt evaluation (promptfoo)
```bash
# Requires OPENROUTER_API_KEY (see .example.env)
npm run promptfoo
```
Promptfoo uses `.pi/extensions/scribe/prompts/scribe.md` with `tests/promptfoo/scribe.tests.yaml` for include/exclude cases.

## Security audit
```bash
npm run audit
```
Requires `gitleaks` and `semgrep` binaries installed. SBOM is generated as an untracked artifact under `sbom/`.
