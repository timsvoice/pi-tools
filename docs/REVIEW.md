# Code Review: pi-scribe

## Summary

Solid single-file extension with clear separation of concerns, good error messages, and a disciplined quality gate setup. The prompts are well-crafted. Below are the issues worth addressing, ranked by impact.

---

## 1. `index.ts` is a 350-line monolith — extract modules

**Severity: Medium (maintainability)**

Everything lives in one file: prompt execution, message windowing, decision parsing, file I/O, UI orchestration, debug logging. This works now but is on the edge of the 200-line diff budget and 10-complexity limits simultaneously.

**Recommendation:** Split into focused modules under `.pi/extensions/scribe/`:
- `prompts.ts` — `fillPromptTemplate`, `getPrompt`, `formatRecentTurns`
- `decisions.ts` — `parseDecisionOutput`, `formatDecisionTemplate`, `buildDecisionsContent`, `buildConventionsContent`
- `executor.ts` — `executePrompt`
- `logging.ts` — `isDebugEnabled`, `writePromptLog`
- `index.ts` — handler wiring, cadence logic, UI updates only

This also makes the test imports cleaner (no importing everything from `index.ts`).

---

## 2. DECISIONS.md accumulates duplicates — no deduplication

**Severity: Medium (data quality)**

The actual `.scribe/DECISIONS.md` already shows the problem: "Require Node.js 22" appears three times with slight wording variations. The append-only design has no guard against the model extracting the same decision repeatedly across turns.

**Recommendation:** Before appending, do a lightweight title-similarity check (e.g., normalized Levenshtein or even exact-match on lowercased title). If a near-duplicate exists, skip the append. This keeps the editor's job tractable and prevents the conventions doc from being dominated by repeated entries.

---

## 3. Fire-and-forget async with `void` — silent failures in edge cases

**Severity: Medium (reliability)**

```ts
void scribeFn(scribePath, ctx, SCRIBE_INTERVAL_TURNS, promptExecutor)
  .then(...)
  .catch(...)
```

The `void` prefix is intentional (background task), but:
- If `.then()` or `.catch()` itself throws (e.g., `setStatus` throws due to a pi API change), that rejection is unhandled.
- The `scribeRunning`/`editorRunning` flags have no timeout — a hung model call permanently blocks future runs.

**Recommendation:**
- Wrap the entire `.then().catch().finally()` chain in a top-level `.catch(console.error)`.
- Add a timeout (e.g., 60s) to the model call or the overall scribe/editor execution. `AbortSignal.timeout()` is available in Node 22.

---

## 4. CI uses Node 20.16.0 but project requires Node ≥22

**Severity: High (correctness)**

`.nvmrc` says `22`, `.node-version` presumably says `22`, `package.json` engines says `>=22.0.0`, but `.github/workflows/ci.yml` pins `node-version: "20.16.0"`. CI is running on a version the project explicitly doesn't support.

**Fix:** Change CI to `node-version-file: '.nvmrc'` or hardcode `22`.

---

## 5. `.scribe/` output files are not gitignored

**Severity: Medium (hygiene)**

`.scribe/DECISIONS.md` and `.scribe/CONVENTIONS.md` are generated artifacts that vary per session and developer. They're tracked in git (they exist on disk and nothing in `.gitignore` excludes `.scribe/*.md`). The `.gitignore` only has `.scribe/` in the diff-budget ignore list, not the actual gitignore.

**Recommendation:** Add `.scribe/` to `.gitignore` unless you explicitly want these committed (which contradicts "per-session" generation). If they should be committed, document why.

---

## 6. `selectRecentMessages` includes orphan assistant messages at the start

**Severity: Low (correctness)**

When iterating backward, assistant messages before the first selected user turn get `unshift`ed into the result. For `windowTurns=2` with entries `[assistant, user, assistant, user, assistant]`, the leading assistant (belonging to a prior user turn) leaks into the window.

The guard `if (userTurns < windowTurns)` allows assistant messages before any user turn is counted. This is minor in practice since the model handles extra context gracefully, but it violates the documented contract of "most recent N user turns with their adjacent assistants."

---

## 7. Synchronous file reads in async paths

**Severity: Low (performance)**

`readFileSync` and `writeFileSync` are used inside `withFileMutationQueue` callbacks and in `getPrompt`. These block the event loop. Since this runs in a background task, it won't block the user, but it could delay other queued mutations.

**Recommendation:** Use `fs/promises` consistently. The integration tests already use `fs/promises` — the production code should match.

---

## 8. `completeFn` injection is a type-unsafe escape hatch

**Severity: Low (type safety)**

```ts
const completeFn =
  (ctx as ExtensionContext & { completeFn?: typeof complete }).completeFn ?? complete;
```

This casts `ctx` to smuggle in a test-only property. It works but bypasses the type system.

**Recommendation:** Accept `completeFn` as an explicit parameter to `executePrompt` (or pass it through the `options` bag in `createAgentEndHandler`), same as the other injected dependencies. The test seam is already there; make it first-class.

---

## 9. `process.env.SCRIBE_DEBUG` mutation in tests is not isolated

**Severity: Low (test reliability)**

Integration tests mutate `process.env.SCRIBE_DEBUG` with manual try/finally cleanup. If a test runner runs tests in parallel (Node's test runner does by default), these can interfere.

**Recommendation:** Either:
- Pass `debug: boolean` as an option to the functions that check it (dependency injection over environment inspection), or
- Use `test({ concurrency: 1 })` for the debug tests explicitly.

---

## 10. No `tsconfig.json` at the project root

**Severity: Low (DX)**

There's no `tsconfig.json` in the root. TypeScript is a devDependency but type-checking isn't in any script. `tsx` transpiles without checking. A type error in `index.ts` would only surface at runtime.

**Recommendation:** Add a root `tsconfig.json` and a `"typecheck": "tsc --noEmit"` script. Wire it into CI.

---

## 11. Promptfoo prompt is a full copy of `scribe.md`

**Severity: Low (maintenance)**

`tests/promptfoo/scribe.prompt.txt` is a verbatim copy of `.pi/extensions/scribe/prompts/scribe.md`. If one changes and the other doesn't, promptfoo tests diverge from production behavior silently.

**Recommendation:** Have promptfoo reference the source prompt directly (`file://.pi/extensions/scribe/prompts/scribe.md`) instead of maintaining a copy.

---

## 12. `pi-mono/` is vendored into the repo

**Severity: Low (repo hygiene)**

The entire `pi-mono` workspace is checked into the repo under `pi-mono/`. It's gitignored in diff-budget and semgrep, but it's still on disk and in the repo tree. This is confusing — is it a reference copy? A submodule? A vendored dependency?

**Recommendation:** Either make it a git submodule, reference it via npm, or remove it and document where to find it. Its presence inflates the repo and creates ambiguity.

---

## 13. Missing pre-commit hook at the root level

**Severity: Low (process)**

`AGENTS.md` says "Use pre-commit hooks to catch issues locally," but there's no `.husky/` or equivalent at the root. The one under `pi-mono/.husky/` is for the vendored copy.

**Recommendation:** Add a root-level pre-commit hook that runs `npm test && npm run lint && npm run lint:complexity`.

---

## Priority Order

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 4 | CI Node version mismatch | 5 min | High |
| 5 | `.scribe/` not gitignored | 5 min | Medium |
| 2 | Decision deduplication | 1–2 hrs | Medium |
| 1 | Extract modules from monolith | 1–2 hrs | Medium |
| 3 | Unhandled rejection + timeout | 30 min | Medium |
| 11 | Promptfoo prompt duplication | 10 min | Low |
| 10 | Add tsconfig + typecheck | 20 min | Low |
| 13 | Pre-commit hook | 15 min | Low |
| 8 | `completeFn` type safety | 15 min | Low |
| 9 | Env var mutation in tests | 20 min | Low |
| 7 | Sync file I/O | 30 min | Low |
| 6 | Orphan assistant messages | 20 min | Low |
| 12 | `pi-mono` vendoring | Decision | Low |

Items 4 and 5 are quick wins that should ship today. Item 2 is the most impactful design improvement — the append-only model without dedup will produce increasingly noisy input for the editor prompt over time.
