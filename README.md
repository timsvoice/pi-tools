# pi-scribe

Project-local pi extensions for maintaining a durable technical decision reference.

## Primary objective

Optimize project decision memory for future decision quality by minimizing noise, maximizing durable signal, and preserving only guidance that materially helps coding agents and supervising humans make correct engineering choices.

## What this does

This repo contains two extensions that run on `agent_end`:

1. **Scribe** (`.pi/extensions/scribe/`)
   - Reads recent conversation turns.
   - Extracts high-signal project decisions.
   - Appends new decision candidates to `docs/decisions.md` as `### [CANDIDATE] ...` blocks.

2. **Editor** (`.pi/extensions/editor/`)
   - Runs less frequently than scribe.
   - Reads only unreviewed candidate decisions from `docs/decisions.md`.
   - Merges them into the current `docs/conventions.md`.
   - Rewrites `docs/conventions.md` as the single canonical output.
   - Marks processed candidates in `docs/decisions.md` as `### [REVIEWED] ...`.

---

## Repository structure

- `.pi/extensions/scribe/index.ts` — scribe runtime wiring and side effects
- `.pi/extensions/scribe/core.mjs` — pure scribe logic
- `.pi/extensions/scribe/PROMPT.md` — scribe extraction prompt
- `.pi/extensions/editor/index.ts` — editor runtime wiring and side effects
- `.pi/extensions/editor/core.mjs` — pure editor logic
- `.pi/extensions/editor/PROMPT.md` — editor merge/consolidation prompt
- `.pi/extensions/editor/CONVENTIONS_TEMPLATE.md` — default conventions doc scaffold
- `.pi/extensions/decision-pipeline.config.json` — shared cadence config
- `docs/decisions.md` — append-only candidate/reviewed decision log
- `docs/conventions.md` — canonical consolidated conventions document

---

## Configuration

Edit:

`.pi/extensions/decision-pipeline.config.json`

```json
{
  "decisionIntervalTurns": 2,
  "editorRateMultiplier": 2
}
```

- `decisionIntervalTurns`: how often scribe runs.
- `editorRateMultiplier`: editor runs every `decisionIntervalTurns * editorRateMultiplier` turns.

Example above means:
- scribe every 2 turns
- editor every 4 turns

---

## Runtime behavior

### Scribe

- Filters session branch to `user` and `assistant` text turns.
- Sends only turns not yet processed (entry-id checkpoint).
- Keeps only markdown blocks starting with `### [CANDIDATE]`.
- Appends accepted blocks to `docs/decisions.md`.
- Shows footer progress (`Scribe X/N`).

### Editor

- Selects only `### [CANDIDATE]` blocks from `docs/decisions.md`.
- Builds prompt with:
  - current `docs/conventions.md` (or template/default)
  - pending candidate decisions
- Rewrites `docs/conventions.md` with model output.
- Rewrites `docs/decisions.md` changing `### [CANDIDATE]` to `### [REVIEWED]`.

---

## State & reliability

Both extensions persist internal state via custom session entries:

- `scribe-state`
- `editor-state`

This preserves counters/checkpoints across reloads and session switches.

Both extensions also include a run guard (`isRunning`) to avoid overlapping executions.

---

## Testing

Core logic is extracted into pure modules and covered by unit tests.

Run tests:

```bash
node --test .pi/extensions/tests/*.test.mjs
```

Test files:
- `.pi/extensions/tests/scribe-core.test.mjs`
- `.pi/extensions/tests/editor-core.test.mjs`

---

## Usage

1. Start pi in this project.
2. Run `/reload` after extension/prompt/config changes.
3. Chat normally.
4. Inspect:
   - `docs/decisions.md` for candidate/reviewed entries
   - `docs/conventions.md` for consolidated project conventions
