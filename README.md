# pi-scribe

Project-local pi extension that captures durable decisions and conventions from recent conversation turns.

## Install / Load
- Place in `.pi/extensions/scribe/` (this repo already does).
- Start pi from the repo root and run `/reload` to hot-load changes.

## Behavior
- Runs on `agent_end`.
- Scribe cadence: every 1 turn.
- Editor cadence: every 3 turns.
- Working message shows `Scribing...` / `Editorializing...` during runs and clears on completion. Errors show as `Scribe error: ...`.
- Footer counters show `Scribe X/1` and `Editor Y/3` each turn.
- Footer shows last run status: `Scribe ✓ HH:MM`, `Editor ✓ HH:MM` (or ✗ on failure).

## Outputs
- `docs/DECISIONS.md` (append-only, header on first write). JSON model output is transformed into a markdown decision template containing all fields.
- `docs/CONVENTIONS.md` (fully rewritten per editor run)

## Debug logging
Set `SCRIBE_DEBUG=1` (or `true/yes/on`) to capture prompt inputs and outputs. Every model call writes a JSON log to `.scribe/logs/` under the repo root with `kind: "model"`. Scribe/editor runs also emit their own logs (`kind: "scribe"` / `"editor"`). Files are created per call and include timestamp, kind, prompt, and output.

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
