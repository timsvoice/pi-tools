# Plan and Requirements: pi-scribe

## Purpose
pi-scribe is a project-local pi extension that captures durable engineering decisions and conventions from conversation history. It runs on `agent_end` events, synthesizes recent turns into candidate decisions, and curates a high-signal `.scribe/CONVENTIONS.md` document. The goal is to preserve long-lived project rules while minimizing noise.

## Scope
### In scope
- Capture and append decision candidates to `.scribe/DECISIONS.md`.
- Curate `.scribe/CONVENTIONS.md` via the editor prompt.
- Provide lightweight UI feedback while background tasks run.
- Enforce safety constraints for model calls and file writes.
- Keep operational guidance aligned with pi extension examples (`status-line.ts`, `reload-runtime.ts`, `trigger-compact.ts`).

### Out of scope
- Custom tools or commands.
- UI customization beyond status text (e.g., spinners, notifications like `titlebar-spinner.ts` or `notify.ts`).
- Workflow automation outside pi’s extension lifecycle.
- Test harnesses or CI coverage (none in repo).

## Stakeholders and Assumptions
- Primary users: engineers running pi interactively.
- The extension runs unattended; it must not block or prompt the user.
- Provider credentials are configured externally (settings or `/login`).

## Functional Requirements
1. **Cadence**: Run scribe every 1 turn and editor every 3 turns.
2. **Prompting**: Use prompt templates from `extensions/scribe/prompts/`.
3. **Input windowing**: Base scribe input on the most recent N user turns, preserving order.
4. **Outputs**:
   - `.scribe/DECISIONS.md` is append-only, includes a header when empty, and stores a markdown decision template derived from the scribe JSON output.
   - `.scribe/CONVENTIONS.md` is fully rewritten each editor run.
5. **UI feedback**: While running, display `Scribing...` or `Editorializing...` via the working message indicator (clears on completion).
6. **UI counters**: Always show turn counters in the footer: `Scribe X/1` and `Editor Y/3` (when `ctx.hasUI`).
7. **Run status**: Show last run outcome + timestamp in the footer (e.g., `Scribe ✓ 12:34`, `Editor ✗ 12:34`).
8. **Error messaging**: Fail fast with actionable errors and surface them in the working message indicator for debugging.

## Non-Functional Requirements
- **Safety**: Serialize file mutations with `withFileMutationQueue()`.
- **Bounded output**: Enforce line/byte limits before writing to disk.
- **Resilience**: Background task failures must be logged and not crash the session.
- **Compatibility**: Must operate with `ctx.hasUI === false` and in non-interactive modes.
- **Operational guard (optional)**: Skip runs when `ctx.getContextUsage()` is near limits or a compaction is imminent (pattern from `trigger-compact.ts`).
- **Security**: No secrets stored in the repo; API keys via provider settings only.

## Quality Gates
- **Linting**: Biome `recommended` ruleset; `npm run lint` is required.
- **Complexity budget**: Max cyclomatic complexity 10 per function (ESLint `complexity` rule).
- **Security audit**: `npm run audit` (dependency audit, secret scan via gitleaks, SAST via semgrep, SBOM via cyclonedx). Requires `gitleaks` and `semgrep` binaries installed. SBOM is generated as an untracked artifact under `sbom/`.

## Project Structure
- `extensions/scribe/index.ts`: core extension logic and event handler registration.
- `extensions/scribe/prompts/`:
  - `scribe.md`: extracts candidate decisions.
  - `editor.md`: merges candidates into `.scribe/CONVENTIONS.md`.
- `.scribe/DECISIONS.md`: append-only record of decision candidates.
- `.scribe/CONVENTIONS.md`: curated, compact set of active conventions.

## Architecture (Runtime Flow)
1. `agent_end` fires.
2. Extension increments an in-memory turn counter.
3. On cadence:
   - **Scribe run**: collect recent turns, fill `scribe.md`, call the active model, append to `.scribe/DECISIONS.md`.
   - **Editor run**: read `.scribe/DECISIONS.md`, fill `editor.md`, call the active model, rewrite `.scribe/CONVENTIONS.md`.
4. Writes are serialized per-file using `withFileMutationQueue()`.
5. While tasks are running, the UI shows `Scribing...` or `Editorializing...` via the working message indicator.
6. The footer shows counters: `Scribe X/1`, `Editor Y/3`, plus last run status (`Scribe ✓ HH:MM`, `Editor ✓ HH:MM`).

## Implementation Notes
- **Event handler**: `pi.on("agent_end", handler)`; run scribe/editor asynchronously.
- **Model execution**: use `ctx.model` and `ctx.modelRegistry.getApiKey()`; throw when missing.
- **Prompt templating**: replace `{recentTurns}`, `{currentConventions}`, `{newCandidates}`; never emit placeholders.
- **Windowing**: count user turns only; ignore non-user/assistant roles.
- **Output guarding**: enforce size limits; if exceeded, throw with a fix path.
- **UI feedback**: use `ctx.ui.setWorkingMessage("Scribing...")` / `ctx.ui.setWorkingMessage("Editorializing...")`; clear by calling `ctx.ui.setWorkingMessage()`.
- **UI counters**: update `ctx.ui.setStatus("scribe-count", theme.fg("dim", "Scribe X/1"))` and `ctx.ui.setStatus("editor-count", theme.fg("dim", "Editor Y/3"))` on every turn; guard with `ctx.hasUI`.
- **Run status**: update `ctx.ui.setStatus("scribe-last", theme.fg("dim", "Scribe ✓ HH:MM"))` and `ctx.ui.setStatus("editor-last", theme.fg("dim", "Editor ✓ HH:MM"))` on completion (or ✗ on failure).
- **Reload behavior**: changes to extensions require `/reload` for hot-reload testing (see `reload-runtime.ts`).
- **Error handling**: catch background errors, log, notify via `ctx.ui.notify`, and surface a working-message error string.

## Acceptance Criteria
- Decision candidates are appended at the 1-turn cadence without blocking user interaction.
- Conventions are rewritten at the 3-turn cadence using the editor prompt.
- Working message updates appear during runs and clear afterward.
- Footer counters update each turn with `Scribe X/1` and `Editor Y/3`.
- Footer run status updates with `Scribe ✓ HH:MM` / `Editor ✓ HH:MM` (or ✗ on failure).
- Output size limits are enforced; over-limit outputs emit actionable errors.
- Concurrent edits by built-in tools do not race with scribe writes.
- The extension remains functional with `ctx.hasUI === false`.

## Risks and Mitigations
- **Prompt drift produces noise** → Keep prompts strict; prefer false negatives.
- **Large model outputs** → Enforce truncation and fail fast.
- **Concurrent file writes** → Use `withFileMutationQueue()`.
- **Missing model/API key** → Fail fast with fix path.
- **Context window pressure** → Optionally skip runs near limits (pattern from `trigger-compact.ts`).

## Testing Strategy
- Keep pure logic (prompt filling, windowing, decision/convention builders) isolated and unit-testable.
- Use dependency injection for model execution and file writes to allow deterministic tests without network or disk access.
- Cover side-effect boundaries with integration tests using temp directories and stubbed model output.
- Validate error paths (missing model/API key, oversized output) via targeted tests with mocked dependencies.

## Validation Plan
- Manual interactive run in pi; verify cadence and file outputs.
- Induce missing model/API key to confirm error messaging.
- Concurrent edit with `write` tool to confirm no race corruption.
- Verify working message updates clear when runs complete.

## Rollout / Rollback
- Rollout: update `extensions/scribe/index.ts` and reload extensions (`/reload`, see `reload-runtime.ts`).
- Rollback: revert the extension file and reload; remove generated docs if needed.
