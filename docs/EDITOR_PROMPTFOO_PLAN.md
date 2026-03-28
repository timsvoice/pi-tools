# Plan: Promptfoo Harness for the Editor Prompt

## Objective

Build a promptfoo evaluation harness for `extensions/scribe/prompts/editor.md` that tests the editor's output quality against a rubric extracted from the prompt's own requirements. The editor prompt will be rebuilt from scratch; the tests are the fixed specification.

## Background

The scribe prompt (`scribe.md`) already has a promptfoo harness (`promptfooconfig.yaml` + `tests/promptfoo/scribe.tests.yaml`). The editor prompt has no equivalent. The editor takes two inputs — `currentConventions` and `newCandidates` — and produces a revised `.scribe/CONVENTIONS.md` markdown document.

## Artifacts

| File | Action |
|---|---|
| `promptfooconfig.editor.yaml` | Create. Separate config for independent execution. |
| `tests/promptfoo/editor.tests.yaml` | Create. Test cases derived from the rubric below. |
| `extensions/scribe/prompts/editor.md` | Blank. Implementing agent rebuilds from scratch. |

## Provider

`openrouter:openai/gpt-5-mini` with `temperature: 0`, matching the scribe harness.

## Assertion Strategy

Tests use two assertion types, chosen by what the criterion actually tests:

### Deterministic assertions (JavaScript)

Used for **structural properties** where the expected output is binary and surface-level: presence/absence of headings, tokens, fences, or preamble text. These are fast, cheap, and fully reproducible.

Applies to: R1, R2, R7, R8, R11.

### LLM-as-judge assertions (`llm-rubric`)

Used for **semantic properties** where the quality criterion requires understanding meaning, not matching strings. Keyword counting and section-splitting are poor proxies for "did the model merge two entries?" or "is the rule faithfully preserved?" The judge evaluates the intent directly.

Applies to: R3, R4, R5, R6, R9, R10, R12.

### Dual assertions

Semantic tests should include a deterministic structural gate as a fast-fail check (e.g., "output starts with `# Conventions`") before the more expensive judge call. This catches gross structural failures without spending a model call.

### Judge examples: PASS and FAIL

Every `llm-rubric` assertion must include one PASS example and one FAIL example. Without examples, the judge applies its own interpretation of the rubric, which drifts across runs.

**Guidelines for examples:**

- **One PASS, one FAIL per assertion.** No more.
- **Illustrate the boundary, not the obvious.** The FAIL example should be *close* to passing — that's where the judge needs the most help. An obviously wrong output doesn't calibrate anything.
- **Keep them short.** A few lines each. The example demonstrates the grading threshold, not a complete document.
- **FAIL examples prevent leniency.** Judges tend to pass marginal output. A near-miss FAIL anchors the boundary.

### Whitespace tolerance

Deterministic assertions must tolerate variable whitespace between headings and content. Models routinely emit a blank line after a markdown heading.

**Do not use:** `output.includes("## Heading\nNone.")`

**Use instead:** regex like `/## Conflicts Requiring Review\s+None\./` or normalize whitespace before matching.

This applies to all tests that check for `None.` after a section heading.

### Cost implication

Each `llm-rubric` assertion is one additional model call. With 7 semantic tests, that's 7 extra calls per run on `gpt-5-mini`. Marginal cost, meaningful reliability gain.

## Rubric

Extracted from the existing editor prompt's requirements. Each criterion maps to one or more test assertions.

### R1: Valid markdown, no preamble *(deterministic)*

Output starts with `# Conventions`. No JSON fences wrapping the document. No introductory sentences like "Here is the updated document".

### R2: Required sections present *(deterministic)*

Output contains all three sections:
- `## Conflicts Requiring Review`
- `## Active Decisions`
- `## Superseded Decisions`

### R3: Inclusion gates enforced *(llm-rubric)*

Only decisions that satisfy all four gates appear in Active Decisions:
1. Durable default rule, constraint, or interface expectation.
2. Applies beyond one local edit/session.
3. A future engineer could make a wrong choice without it.
4. Rationale is not obvious from code alone.

Judge examples:

> **PASS:** Active Decisions contains an entry about API boundary validation (durable, project-wide, non-obvious). The local rename candidate does not appear anywhere in Active Decisions.
>
> **FAIL:** Active Decisions contains both the API boundary validation rule and an entry like "Rename the helper to reduce clutter" — the latter is a local, session-scoped edit that fails gate 2.

### R4: Explicit removals enforced *(llm-rubric)*

The following never appear in Active Decisions:
- Migration or temporary compatibility details.
- Prompt wording/style or documentation-process policy.
- UI/status/notification behavior.
- Debugging history or one-off implementation narrative.
- Duplicate/rephrased entries.

Judge examples:

> **PASS:** Active Decisions contains only the existing Node.js 22+ rule. The migration/legacy fallback candidate does not appear in any section.
>
> **FAIL:** Active Decisions contains an entry like "Keep the legacy fallback during migration" or Conflicts lists it as a contradiction — it should be silently ignored, not tracked.

### R5: Compression *(llm-rubric)*

Overlapping candidates merge into a single canonical entry. No duplicate entries in the output.

Judge examples:

> **PASS:** A single entry like "All persistence writes must go through the data layer" that covers both candidates in one consolidated rule.
>
> **FAIL:** Two separate entries like "All persistence writes must go through the data layer APIs" and "Writes should only be performed via the data layer" — these are the same rule stated twice.

### R6: Meaning preservation *(llm-rubric)*

The core rule from a valid candidate survives in Active Decisions. Compression must not distort the decision.

Judge examples:

> **PASS:** The output contains a rule about feature flags being served by the config service, not environment variables — preserving the original candidate's meaning.
>
> **FAIL:** The output compresses the candidate to "Use a config service" — dropping the constraint that environment variables must not be used, which distorts the original rule.

### R7: No placeholder/template token leakage *(deterministic)*

Output contains no `{Short title}`, `{...}`, or similar template tokens.

### R8: No meta commentary *(deterministic)*

No "Note:", "Summary:", or explanatory text outside the document structure.

### R9: Conflicts escalated, not resolved *(llm-rubric)*

When a new candidate contradicts an existing active decision, the contradiction appears in `## Conflicts Requiring Review`. The editor does not silently resolve it.

Judge examples:

> **PASS:** The Conflicts section identifies the contradiction between blocking writes (crash safety) and async writes (throughput), presenting both positions without choosing one.
>
> **FAIL:** The Active Decisions section contains only "Use async writes for throughput" — the editor silently replaced the existing blocking-writes decision without flagging the conflict.

### R10: Superseded decisions tracked *(llm-rubric)*

When a new candidate explicitly replaces an existing decision, the old decision moves to `## Superseded Decisions`.

Judge examples:

> **PASS:** The Superseded section contains the old env-var feature flags decision. The Active section contains the new config-service feature flags decision. Both are in the correct section.
>
> **FAIL:** The Active section contains both the old env-var decision and the new config-service decision — the editor failed to move the replaced decision to Superseded.

### R11: Empty sections handled *(deterministic)*

When no conflicts or superseded decisions exist, the section contains `None.`

### R12: Conciseness *(llm-rubric)*

Entries are rule-form statements, not narrative retelling of the conversation.

Judge examples:

> **PASS:** "Validate outbound webhook payloads against the receiver's schema before sending."
>
> **FAIL:** "After discussing webhook reliability, we decided that outbound payloads should be validated because third parties kept rejecting them." — this retells the conversation rather than stating the rule.

## Test Cases

Each test provides `currentConventions` and `newCandidates` as vars. Assertion type is noted per case.

### 1. Integrates a new valid decision

- **Input**: Existing convention about Node.js 22+. New candidate about API boundary validation (passes all inclusion gates).
- **Asserts**:
  - *(deterministic)* R1, R2 — valid structure.
  - *(llm-rubric)* R6 — output contains the new decision's core rule (API boundary + validation) and preserves the existing Node.js convention.

### 2. Rejects a migration/temporary candidate

- **Input**: Existing convention about Node.js 22+. New candidate about keeping a legacy fallback during migration.
- **Asserts**:
  - *(deterministic)* R1 — valid structure.
  - *(llm-rubric)* R4 — the migration/legacy candidate does not appear in any section. Existing Node.js rule preserved.

### 3. Merges overlapping candidates

- **Input**: Two candidates that describe the same rule (both about data-layer write ownership, worded differently).
- **Asserts**:
  - *(deterministic)* R1 — valid structure.
  - *(llm-rubric)* R5 — Active Decisions contains one consolidated entry covering the rule, not two separate entries.

### 4. Preserves existing decisions when no candidates

- **Input**: Existing convention document with one active decision. `newCandidates` is "No new candidates."
- **Asserts**:
  - *(deterministic)* R1, R2 — valid structure.
  - *(deterministic)* R11 — Conflicts and Superseded sections contain `None.` (use whitespace-tolerant regex).
  - *(deterministic)* Existing Node.js 22 decision still present (keyword check).

### 5. Detects and escalates conflicts

- **Input**: Existing decision says "blocking writes for crash safety". New candidate says "async writes for throughput".
- **Asserts**:
  - *(deterministic)* R2 — sections present.
  - *(llm-rubric)* R9 — Conflicts section identifies the contradiction without resolving it.

### 6. Moves superseded decision

- **Input**: Existing decision about feature flags via env vars. New candidate explicitly replaces it with feature flags via config service.
- **Asserts**:
  - *(deterministic)* R2 — sections present.
  - *(llm-rubric)* R10 — old decision in Superseded, new decision in Active.

### 7. Strips duplicate of existing convention

- **Input**: Existing decision about Node.js 22+. New candidate that restates the same rule.
- **Asserts**:
  - *(deterministic)* R1 — valid structure.
  - *(llm-rubric)* R5 — Active Decisions contains exactly one Node.js entry, not two.

### 8. Outputs clean markdown structure

- **Input**: Any valid input pair.
- **Asserts**:
  - *(deterministic)* R1, R2, R7, R8 — starts with `# Conventions`, all sections present, no template tokens, no meta commentary.

### 9. Handles empty candidates gracefully

- **Input**: Existing conventions with one active decision. `newCandidates` is empty string or "No new candidates."
- **Asserts**:
  - *(deterministic)* R1, R2 — valid structure.
  - *(deterministic)* R11 — Conflicts and Superseded sections contain `None.` (use whitespace-tolerant regex).
  - *(deterministic)* Existing decision still present (keyword check).

### 10. No placeholder leakage

- **Input**: Candidates containing template-like tokens (`{Short title}`, `{...}`). One candidate has a valid rule after the template prefix.
- **Asserts**:
  - *(deterministic)* R7 — output contains none of those tokens.
  - *(llm-rubric)* The valid rule content ("standard cache keys for all lookups") is evaluated for inclusion. If the rule is durable and project-scoped, it should appear in Active Decisions without the template prefix. If the candidate is treated as garbage due to the prefix, it may be absent — either outcome is acceptable as long as no template tokens leak.

### 11. Inclusion gates filter local edits

- **Input**: Existing convention about Node.js 22+. Two candidates: one durable (API boundary validation), one local (rename a helper for clarity).
- **Asserts**:
  - *(deterministic)* R1 — valid structure.
  - *(llm-rubric)* R3 — the durable candidate appears in Active Decisions; the local candidate does not.

### 12. Concise rule-form output

- **Input**: Empty conventions. One candidate with full context (decision + why + impact + invalidation).
- **Asserts**:
  - *(deterministic)* R1 — valid structure.
  - *(llm-rubric)* R12 — the Active Decisions entry is a concise rule statement, not a narrative retelling.

## Prompt Requirements

The editor prompt (`extensions/scribe/prompts/editor.md`) must address these concerns. The implementing agent starts from a blank file and iterates until tests pass.

### Prompt Engineering Techniques

The prompt must use the following techniques. These are not optional — each addresses a known failure mode or improves output consistency.

#### 1. Role / persona

Open the prompt with a role statement. This anchors the model's behavior and reduces drift into generic assistant patterns.

The role is: **conventions document editor**. The model maintains a curated engineering conventions file. It is not a general assistant, not a decision-maker, and not a summarizer. It integrates, filters, and formats.

Example opening: *"You are a conventions document editor. You maintain `.scribe/CONVENTIONS.md` — a curated set of durable engineering rules for a codebase."*

#### 2. N-shot examples

Include short input/output examples covering the distinct operations the editor performs. Each example should be minimal — just enough to demonstrate the operation, not a full document.

**Required example operations** (one example per operation, in this order):

1. **Add a valid candidate** — candidate passes inclusion gates → appears in Active Decisions.
2. **Reject an invalid candidate** — candidate is local/temporary/migration → silently ignored, document unchanged.
3. **Merge overlapping candidates** — two candidates about the same rule → one canonical entry.
4. **Escalate a conflict** — candidate contradicts existing decision → both appear in Conflicts section.
5. **Supersede a decision** — candidate explicitly replaces existing → old moves to Superseded, new to Active.

**Example format guidelines:**
- Use a consistent delimiter (e.g., `---`) between examples.
- Show the input (currentConventions + newCandidates) and the expected output for each.
- Keep each example to the minimum lines needed. A full three-section document per example is fine as long as most sections say `None.`
- Do not include examples for purely structural properties (R1, R2, R7, R8, R11) — the format rules cover those.

#### 3. Decision tree / if-then classification

Present the candidate-handling logic as an explicit ordered flowchart, not prose paragraphs. The model should evaluate each candidate against the tree in order.

**Required decision tree:**

```
For each candidate:
1. Is it local, temporary, migration, legacy, UI, debug, or a rename/cleanup? → Ignore. Do not add to any section.
2. Does it contain template tokens ({...}, {Short title}, etc.)? → Strip the tokens. Evaluate the remaining content from step 1.
3. Does it restate an existing Active Decision? → Ignore. Keep the original wording.
4. Does it explicitly say replace/supersede/deprecate an existing decision? → Move the old decision to Superseded. Add the new one to Active.
5. Does it contradict an existing Active Decision without explicit replacement? → Add a conflict entry to Conflicts Requiring Review naming both sides. Do not modify Active or Superseded.
6. Does it overlap with another new candidate? → Merge into one canonical entry.
7. Otherwise → Add to Active Decisions as a concise rule statement.
```

This ordering matters. Earlier steps take priority (e.g., a migration candidate that also contradicts an existing decision is still ignored at step 1, not escalated at step 5).

#### 4. Output anchoring

Explicitly instruct the model that its first output token must be `# Conventions`. This prevents preamble drift ("Here is the updated document...", "Sure, ...", etc.).

Example instruction: *"Your output must begin with `# Conventions` — no preceding text, fences, or blank lines."*

#### 5. Negative constraints ranked by failure frequency

List the most common failure modes prominently, ordered by how often they occur in practice. Do not bury these in a long rules section.

**Failure modes to highlight (in this order):**
1. Adding narrative or rationale to entries (most common).
2. Echoing template/placeholder tokens from input.
3. Adding preamble text before `# Conventions`.
4. Including meta commentary ("Note:", "Summary:").
5. Resolving conflicts instead of escalating them.

These should appear as a concise "never do this" block near the output rules, not scattered across the prompt.

### Techniques NOT to use

| Technique | Why not |
|---|---|
| **Chain-of-thought / scratchpad** | Promptfoo captures raw output. Any reasoning text fails the "no preamble" tests (R1, R8). The extension runtime expects clean markdown. |
| **Self-consistency / multiple passes** | Single-call constraint from the extension runtime. |
| **XML-structured output** | Output is markdown. XML wrapping contradicts the format requirement. |

### Content requirements

The prompt must also include these elements:

1. **Template variable slots**: `{{currentConventions}}` and `{{newCandidates}}`.
2. **Output format**: markdown only, starts with `# Conventions`, three sections in order (Conflicts, Active, Superseded), `None.` for empty sections.
3. **Inclusion/exclusion rules**: durable conventions only; ignore local, temporary, migration, legacy, UI, debug, and duplicate candidates.
4. **Conflict handling**: contradictions go to Conflicts section without resolution.
5. **Supersession handling**: explicit replacement triggers move old decision to Superseded.
6. **Merge/compression**: overlapping candidates become one canonical entry.
7. **Duplicate suppression**: candidates restating existing decisions are ignored.
8. **Conciseness**: entries are rule-form; no rationale, narrative, or conversation retelling.
9. **Placeholder/template safety**: never echo template tokens like `{Short title}` or `{...}` into output.
10. **No preamble or meta commentary**: no "Here is the updated document", "Note:", "Summary:", or fences.

### Prompt structure (recommended order)

1. Role statement.
2. Input slots (`{{currentConventions}}`, `{{newCandidates}}`).
3. Decision tree (candidate classification logic).
4. Output format rules + output anchoring.
5. Negative constraints (ranked by failure frequency).
6. N-shot examples (one per operation type).

## Execution

### Implementing agent's loop

1. Run `npx promptfoo eval -c promptfooconfig.editor.yaml`
2. Read failures.
3. Edit `extensions/scribe/prompts/editor.md` only.
4. Repeat until all tests pass.

### Constraints on the implementing agent

- **May edit**: `extensions/scribe/prompts/editor.md`, `tests/promptfoo/editor.tests.yaml`
- **May not edit**: `promptfooconfig.editor.yaml`
- **May not edit**: `docs/EDITOR_PROMPTFOO_PLAN.md`
- The plan is the specification. Tests implement it. The prompt is built to pass the tests.

### Running independently

```bash
# Editor tests only
npx promptfoo eval -c promptfooconfig.editor.yaml

# Scribe tests only (existing)
npx promptfoo eval -c promptfooconfig.yaml

# Both (pre-commit requirement per AGENTS.md)
npx promptfoo eval -c promptfooconfig.yaml && npx promptfoo eval -c promptfooconfig.editor.yaml
```

## Risks

| Risk | Mitigation |
|---|---|
| LLM output is non-deterministic even at temp 0 | Structural assertions for binary properties; judge assertions for semantic ones. |
| Judge grading drifts across runs | Every `llm-rubric` includes PASS and FAIL examples anchoring the boundary. |
| Conflict detection is subjective | Test case uses an obvious, unambiguous contradiction. |
| Merge/compression tests are brittle | Judge evaluates consolidation semantically, not by keyword count. |
| Whitespace variation causes false failures | All `None.` checks use whitespace-tolerant regex, not literal `\n` matching. |
| Keyword-ban assertions reject valid output | R4 uses `llm-rubric` instead of keyword negation to evaluate exclusion semantically. |
| Model cost | `gpt-5-mini` keeps per-eval cost low. 12 test cases + 7 judge calls = 19 calls per run. |
