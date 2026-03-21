# pi-scribe

Project-local pi extension that captures durable decisions and conventions from recent conversation turns.

## Install / Load
- Place in `.pi/extensions/scribe/` (this repo already does).
- Start pi from the repo root and run `/reload` to hot-load changes.

## Behavior
- Runs on `agent_end`.
- Scribe cadence: every 1 turn (temporary for manual testing).
- Editor cadence: every 3 turns (temporary for manual testing).
- Working message shows `Scribing...` / `Editorializing...` during runs.
- Footer counters show `Scribe X/1` and `Editor Y/3` each turn.

## Outputs
- `docs/DECISIONS.md` (append-only, header on first write)
- `docs/CONVENTIONS.md` (fully rewritten per editor run)

## Testing
```bash
npm test
npm run lint
npm run lint:complexity
```

## Security audit
```bash
npm run audit
```
Requires `gitleaks` and `semgrep` binaries installed. SBOM is generated as an untracked artifact under `sbom/`.
