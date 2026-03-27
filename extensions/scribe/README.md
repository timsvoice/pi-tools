# Scribe

Project-local pi extension that captures durable engineering decisions and curates a compact conventions document.

## What it does
- Runs on `agent_end`.
- Every 10 turns: extracts decision candidates from recent conversation history.
- Every 30 turns: merges candidates into a curated `.scribe/CONVENTIONS.md`.

## Outputs
- `.scribe/DECISIONS.md` — append-only list of decision candidates.
- `.scribe/CONVENTIONS.md` — rewritten each editor run.

## Prompts
- `extensions/scribe/prompts/scribe.md` — extracts decision candidates.
- `extensions/scribe/prompts/editor.md` — curates conventions.

## Cadence
- Scribe: every 10 turns.
- Editor: every 30 turns.

## Requirements
- Node.js >= 22 (see `.nvmrc`).
- Active model selection in Pi (`/model`).
- Provider API key configured (`/login` or settings).

## Load / run
Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/pi-tools/extensions/scribe"]
}
```

Start Pi from the repo root and run `/reload` after changes.

## UI behavior
- Working message shows `Scribing...` / `Editorializing...` while running.
- Footer counters show `Scribe X/10` and `Editor Y/30`.
- Footer last-run status shows `Scribe ✓ HH:MM` / `Editor ✓ HH:MM` (or ✗ on failure).

## Error handling
- Fails fast on missing model or API key with a clear fix path.
- Enforces output limits; oversized model responses error with guidance to tighten prompts.

## Docs
- `docs/PLAN.md` for requirements.
- `docs/IMPLEMENTATION.md` for implementation/testing notes.
