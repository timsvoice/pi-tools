# Prompt Evaluation Design (Promptfoo + LLM-as-a-Judge)

## Status
Proposed (not implemented)

## Context
The scribe/editor pipeline is highly prompt-driven. We have improved quality with iterative prompt edits, but current tuning is manual and hard to validate consistently.

We need a repeatable evaluation process that:
- catches regressions,
- quantifies quality changes,
- and optimizes for our project objective:
  - minimize noise,
  - maximize durable signal,
  - preserve meaning,
  - produce useful output for coding agents and supervising humans.

## Goals
1. Establish an offline prompt evaluation loop for both:
   - `scribe/prompts/scribe.md` (candidate extraction precision), and
   - `scribe/prompts/editor.md` (consolidation/compression quality).
2. Use LLM-as-a-judge rubrics for nuanced quality dimensions.
3. Add hard-fail checks for known bad patterns.
4. Enable baseline-vs-candidate prompt comparisons before merges.
5. Prepare for CI gating in a later phase.

## Non-goals
- Replacing runtime extensions or prompt execution path.
- Perfect objective truth labeling for every case.
- Building a full analytics platform in v1.

## High-level approach
Use Promptfoo with two eval tracks and shared fixture sets.

### Track A: Scribe extraction quality
Input: conversation segments (`recentTurns`).
Output under test: candidate decision blocks.

Primary focus:
- precision over recall,
- exclusion of tactical/session noise,
- avoidance of placeholder leakage,
- detection of durable policy decisions when applicable.

### Track B: Editor consolidation quality
Input:
- current conventions,
- new candidate decisions.
Output under test: full revised `conventions.md`.

Primary focus:
- signal density,
- dedup/merge quality,
- meaningful compression,
- preservation of decision semantics,
- exclusion of migration/process noise from active decisions.

## Fixture design
Create realistic fixtures under `evals/fixtures/`.

### Scribe fixtures
Each fixture includes:
- `recentTurns` (derived from real sessions, sanitized),
- expected behavior:
  - `emit`: yes/no,
  - optional expected concepts/tags,
  - optional forbidden patterns.

Fixture categories:
- true durable architectural decision,
- local refactor noise,
- debugging chatter,
- migration mechanics,
- prompt/process-policy conversation (allowed only when durable governance rule),
- duplicate/rephrased decision.

### Editor fixtures
Each fixture includes:
- `currentConventions`,
- `newCandidates`,
- expected quality assertions:
  - merged duplicates,
  - excluded tactical noise,
  - conflict handling,
  - superseded handling where explicit,
  - no template/meta leakage.

## Judge strategy (LLM-as-a-judge)
Use rubric-based judges with 1–5 scoring per dimension.

### Scribe rubric dimensions
- `project_scope`
- `durability`
- `non_obvious_rationale`
- `noise_exclusion`
- `format_validity`
- `signal_density`

### Editor rubric dimensions
- `meaning_preservation`
- `deduplication_quality`
- `compression_quality`
- `noise_exclusion`
- `actionability`
- `document_clarity`

### Hard-fail checks (string/rule based)
Fail immediately if output contains:
- placeholder/template artifacts (e.g. `{Short title}`, `{...}`),
- prompt meta text copied into final document,
- clearly excluded migration/process noise in active decisions,
- invalid required section headers in editor output.

## Baseline vs candidate workflow
For each prompt change:
1. Run eval set with baseline prompts.
2. Run eval set with candidate prompts.
3. Compare:
   - hard-fail counts (must not increase),
   - aggregate rubric score delta,
   - key dimension deltas (`noise_exclusion`, `meaning_preservation`, `signal_density`).
4. Review worst regressions with fixture-level diffs.

Decision rule (initial):
- Reject if any new hard-fail appears.
- Prefer candidate only if net quality improves or remains flat with clear qualitative benefits.

## Proposed repository layout
```text
evals/
  promptfoo.yaml
  fixtures/
    scribe/
      *.yaml
    editor/
      *.yaml
  rubrics/
    scribe-judge.md
    editor-judge.md
  baselines/
    scribe.prompt.md
    editor.prompt.md
```

## Implementation phases
### Phase 0 (this doc)
- Design and alignment.

### Phase 1 (local/manual)
- Add Promptfoo config + 10–15 fixtures per track.
- Run locally and tune rubrics.
- Validate that results correlate with human judgment.

### Phase 2 (regression-ready)
- Expand to 25–40 fixtures total.
- Introduce baseline-vs-candidate comparison script.
- Add summary report output for PR discussion.

### Phase 3 (CI gating)
- Run eval on PRs touching prompts/decision pipeline.
- Gate on hard-fails and agreed score thresholds.

## Risks and mitigations
- **Judge drift / inconsistency**
  - Mitigation: fixed judge prompts, periodic rubric review, spot-check with human review.
- **Overfitting to fixtures**
  - Mitigation: rotate/add fixtures from real recent sessions.
- **Cost/latency**
  - Mitigation: keep fixture sizes tight, use smaller judge models where acceptable.
- **False confidence from numeric scores**
  - Mitigation: include qualitative regression examples in reports.

## Success criteria
- Fewer noisy entries reaching `docs/conventions.md`.
- Fewer duplicate/rephrased decisions.
- Clear improvement in actionability for future engineering work.
- Prompt changes can be evaluated before merge with objective signals and reproducible outputs.

## Open questions
1. Which model(s) should be used for generation vs judging?
2. What score thresholds are strict enough without blocking useful iteration?
3. Should prompt eval run on every PR or only when prompt/extension files change?
4. Do we want a small hand-labeled “golden” subset with stronger binary assertions?
