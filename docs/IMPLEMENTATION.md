# Implementation Plan: pi-scribe

## Goal
Implement a project-local pi extension that captures durable decisions and conventions per `docs/PLAN.md`. The agent must generate a full, runnable test suite before writing any implementation code. The task is complete only when all tests pass.

## Preconditions
- Prompts live at `.pi/extensions/scribe/prompts/` (`scribe.md`, `editor.md`).
- Extension entry point: `.pi/extensions/scribe/index.ts`.
- Output files: `docs/DECISIONS.md`, `docs/CONVENTIONS.md`.
- Cadence: scribe every 10 turns, editor every 30 turns.

## Delivery Phases
1. **Test Suite (must be first)**
   - Create a dedicated test directory (e.g., `tests/`), and define deterministic unit + integration tests.
   - Use dependency injection to mock model execution and file I/O.
   - Ensure tests cover error paths, output limits, UI status behavior, and file mutation queue usage.
   - All tests must fail before implementation code exists.
2. **Implementation**
   - Implement extension logic to satisfy tests and `docs/PLAN.md`.
3. **Verification**
   - Run the full test suite; only declare completion when green.

## Tooling and Test Runner
- Use Node’s built-in test runner (`node --test`) for all tests.
- Use TypeScript via `tsx` for test execution.
- Dependencies needed for tests:
  - `tsx`
  - `typescript`
  - `fast-check` (property tests for windowing and templating)
- Provide a single `npm test` script that runs the full suite.

## Test Suite Requirements
### Unit Tests (pure functions)
- **Prompt templating**
  - Replaces all placeholders with provided content.
  - Leaves no `{placeholder}` tokens in output.
- **Message windowing**
  - Selects most recent N user turns, preserves order, includes assistant replies adjacent to those turns.
  - Ignores non-user/assistant roles.
- **Decision/convention builders**
  - `DECISIONS.md` header inserted when empty; append-only behavior verified.
  - `CONVENTIONS.md` rewritten only when non-empty output.

### Test Harness Contracts
- **Mock ExtensionContext**
  - `ctx.cwd`, `ctx.hasUI`, `ctx.ui.setStatus`, `ctx.ui.notify`, `ctx.model`, `ctx.modelRegistry.getApiKey()`, `ctx.sessionManager.getBranch()`.
  - For `ctx.hasUI === false`, UI methods must be no-ops.
- **Mock ExtensionAPI**
  - Capture `pi.on("agent_end", handler)` registrations.
  - Provide a helper to invoke the handler with a stub context.
- **Prompt content contract**
  - `scribe.md` expects `{recentTurns}` token.
  - `editor.md` expects `{currentConventions}` and `{newCandidates}` tokens.
  - Tests should provide minimal templates with those tokens to avoid coupling to prompt prose.

### Integration Tests (side effects isolated)
- **Scribe run**
  - Given stubbed prompt output, appends to `docs/DECISIONS.md` in a temp directory.
  - Enforces output size limits and throws with fix path on violation.
- **Editor run**
  - Reads `docs/DECISIONS.md` and rewrites `docs/CONVENTIONS.md` with stubbed output.
  - No-op when decisions file missing or empty.
- **Cadence behavior**
  - Runs scribe on turn 10, editor on turn 30; does not run on other turns.
- **UI status feedback**
  - Sets `ctx.ui.setStatus("scribe", "Scribing...")` and clears on completion.
  - Sets `ctx.ui.setStatus("editor", "Editorializing...")` and clears on completion.
  - Guards against `ctx.hasUI === false`.
- **Error handling**
  - Missing model/API key results in actionable error message.
  - Background task errors are caught and logged (no unhandled rejection).

### Concurrency Safety
- Assert file writes use `withFileMutationQueue()` with absolute paths to prevent races.

## Dependencies and Scripts
- `package.json` must include:
  - `"test": "node --test --import tsx tests/**/*.test.ts"`
  - `devDependencies`: `tsx`, `typescript`, `fast-check`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`.

## Implementation Notes (must align with tests)
- Register `pi.on("agent_end", ...)` and run scribe/editor asynchronously.
- Use `ctx.model` and `ctx.modelRegistry.getApiKey()` for model execution; fail fast if missing.
- Enforce output limits (lines/bytes) before writing; throw with fix path when exceeded.
- Resolve paths with `resolve(ctx.cwd, ...)` and serialize writes with `withFileMutationQueue()`.
- Keep logic compatible with `ctx.hasUI === false`.
- Use `ctx.ui.setWorkingMessage()` for run feedback and clear on completion.
- Update footer counters each turn via `scribe-count`/`editor-count` keys using `theme.fg("dim", ...)` to match footer text color (currently 1/3 cadence for manual testing).

## Quality Gates
- `npm run lint` passes (Biome).
- `npm run lint:complexity` passes (max cyclomatic complexity 10).
- `npm run diff-budget` passes (≤ 500 total lines, ≤ 200 lines per file).
- `npm run audit` passes (dependency audit, gitleaks, semgrep, SBOM generation). Requires `gitleaks` and `semgrep` binaries installed. SBOM output is an untracked artifact under `sbom/`.

## Acceptance Criteria
- All tests pass in a closed loop.
- Extension behavior matches cadence, file outputs, error handling, and UI feedback rules in `docs/PLAN.md`.
- Quality gates pass.

## Execution Checklist (for the coding agent)
1. Create tests (unit + integration) and ensure they fail.
2. Implement minimal functionality to pass tests.
3. Refactor without changing behavior; keep tests green.
4. Run full suite and quality gates to verify completion.
