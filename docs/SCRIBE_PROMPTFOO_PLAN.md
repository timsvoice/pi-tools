# Plan: Improve Scribe Promptfoo Harness with LLM-as-Judge

## Objective

Add `llm-rubric` assertions to the scribe prompt's existing promptfoo harness to test semantic quality — meaning preservation, faithful compression, and conciseness — where keyword matching is an inadequate proxy.

## Background

The scribe prompt (`extensions/scribe/prompts/scribe.md`) has a promptfoo harness (`promptfooconfig.yaml` + `tests/promptfoo/scribe.tests.yaml`) with 10 test cases, all using deterministic JavaScript assertions. The positive tests (1, 3, 4) use keyword matching to verify decision content, which can pass on outputs that contain the right words but the wrong meaning.

## Artifacts

| File | Action |
|---|---|
| `tests/promptfoo/scribe.tests.yaml` | Modify. Add judge assertions to tests 1, 3, 4. Add test 11. |
| `extensions/scribe/prompts/scribe.md` | Do not modify unless a test failure reveals a prompt defect. |
| `promptfooconfig.yaml` | No change. |

## Provider

`openrouter:openai/gpt-5-mini` with `temperature: 0` (existing config, unchanged).

## Assertion Strategy

Follows the same dual-assertion pattern established in the editor harness (`docs/EDITOR_PROMPTFOO_PLAN.md`).

### What stays deterministic

**Negative tests (2, 5, 6, 7, 8, 9):** These check `status === "no_decision"` with all fields empty. Binary structural property. No ambiguity. No judge needed.

**Test 10 (json-only output):** Purely structural — valid JSON, no fences, no preamble. No judge needed.

### What gets a judge

**Positive tests (1, 3, 4):** Currently use keyword matching (`includes("npm test")`, `includes("api boundary")`, `includes("data layer")`) as a proxy for meaning. A judge evaluates the actual semantic property: is the decision faithful to the conversation?

**New test 11:** Tests meaning preservation under compression — a property only a judge can evaluate.

### Dual assertion pattern

For tests 1, 3, 4, and 11:
1. **Deterministic gate (keep/simplify):** Valid JSON, correct `status`, all fields non-empty, length bounds.
2. **Judge assertion (add):** Evaluates meaning fidelity, compression quality, and conciseness.

The deterministic gate catches structural failures cheaply. The judge catches semantic failures that keywords miss.

### Judge examples: PASS and FAIL

Every `llm-rubric` assertion must include one PASS example and one FAIL example, following the guidelines in `docs/EDITOR_PROMPTFOO_PLAN.md`:

- One PASS, one FAIL per assertion.
- FAIL example should be close to passing (boundary calibration).
- Keep examples short.

## Changes to Existing Tests

### Test 1: captures explicit project policy

**Current deterministic assertion (simplify):**

Remove keyword checks (`includes("npm test")`, `includes("commit")`). Keep:
- Valid JSON parse.
- `status === "decision"`.
- All non-status fields are non-empty strings.

**Add judge assertion:**

```yaml
- type: llm-rubric
  value: |-
    PASS if the decision field faithfully captures the rule "all changes must run npm test before commit" and the why, impact, and invalidation fields contain meaningful content derived from the conversation (not filler or restatements of the decision).
    FAIL if the decision field distorts the rule, or if the why/impact/invalidation fields are generic filler unrelated to the conversation.

    PASS example:
    {"status":"decision","title":"Run npm test before commit","type":"CONSTRAINT","decision":"All changes must run npm test before commit.","why":"Avoids shipping untested changes.","impact":"No commits without green tests.","invalidation":"CI enforces pre-merge tests."}

    FAIL example:
    {"status":"decision","title":"Testing policy","type":"CONSTRAINT","decision":"Run npm test and commit frequently.","why":"Testing is important.","impact":"Better code quality.","invalidation":"When no longer needed."}
```

### Test 3: captures durable API boundary decision

**Current deterministic assertion (simplify):**

Remove keyword checks (`includes("api boundary")`, `includes("validation")`). Keep:
- Valid JSON parse.
- `status === "decision"`.
- All non-status fields are non-empty strings.
- `decision.length < 220`.

**Add judge assertion:**

```yaml
- type: llm-rubric
  value: |-
    PASS if the decision field states that the API boundary owns input validation and internal services must not validate raw request payloads. The meaning must match the conversation — not just contain the right keywords.
    FAIL if the decision field contains the keywords "API boundary" and "validation" but distorts the rule (e.g., says validation is optional, or assigns ownership to internal services).

    PASS example:
    {"status":"decision","title":"API boundary owns input validation","type":"INTERFACE","decision":"Validate raw request payloads at the API boundary; internal services must not validate raw request payloads.","why":"Shared validation rules drifted and caused inconsistent behavior.","impact":"All new endpoints must validate at the API boundary before calling service logic.","invalidation":"Introduce a dedicated validation service used by all layers."}

    FAIL example:
    {"status":"decision","title":"API validation","type":"INTERFACE","decision":"The API boundary has validation for request payloads.","why":"Validation is needed.","impact":"Endpoints should validate.","invalidation":"Not specified."}
```

### Test 4: collapses repeated rationale into one rule

**Current deterministic assertion (simplify):**

Remove keyword check (`includes("data layer")`). Keep:
- Valid JSON parse.
- `status === "decision"`.
- All non-status fields are non-empty strings.
- `decision.length < 220`.

**Add judge assertion:**

```yaml
- type: llm-rubric
  value: |-
    PASS if the decision field is a concise rule about data-layer write ownership (all persistence writes go through the data layer), stated as a durable invariant — not a narrative retelling of the conversation.
    FAIL if the decision retells the conversation ("we discussed...", "after noticing drift...") or is vague enough to be useless as a rule.

    PASS example:
    {"status":"decision","title":"Data layer owns persistence writes","type":"ARCHITECTURAL","decision":"All persistence writes must go through the data layer.","why":"Direct writes caused inconsistent validation.","impact":"New features must route writes through data layer APIs.","invalidation":"The data layer is replaced."}

    FAIL example:
    {"status":"decision","title":"Write discussion","type":"ARCHITECTURAL","decision":"We discussed avoiding mixing persistence writes into business logic and decided the data layer should handle it.","why":"It caused problems before.","impact":"Things should go through the data layer.","invalidation":"If we change our minds."}
```

## New Test

### Test 11: meaning preservation under compression

Tests that a specific constraint survives compression. The conversation contains a decision with a scoping constraint ("only in production, not staging") that is easy to drop when summarizing.

**Input:**

```yaml
- description: preserves scoping constraint under compression
  vars:
    recentTurns: |-
      User: We keep getting alert fatigue from staging errors.
      Assistant: Staging noise is a known problem.
      User: What about just reducing the alert volume?
      Assistant: That risks missing real issues.
      User: Decision: Enable error alerting only in production, not staging. Why: staging generates false positives that desensitize the team to real production errors. Impact: alerting config must check the environment before firing. Invalidate if staging stability reaches production-grade reliability.
      Assistant: Noted.
```

**Assertions:**

```yaml
  assert:
    - type: javascript
      value: |
        let parsed;
        try {
          parsed = JSON.parse(output);
        } catch {
          return false;
        }
        return parsed.status === "decision"
          && typeof parsed.decision === "string"
          && parsed.decision.trim().length > 0
          && parsed.decision.length < 220
          && parsed.why.trim().length > 0
          && parsed.impact.trim().length > 0
          && parsed.invalidation.trim().length > 0;
    - type: llm-rubric
      value: |-
        PASS if the decision field preserves both sides of the scoping constraint: alerting is enabled in production AND disabled in staging. Both parts must be present — dropping "not staging" distorts the rule.
        FAIL if the decision mentions production alerting but omits the staging exclusion, or generalizes to "enable alerting" without the environment constraint.

        PASS example:
        {"status":"decision","title":"Production-only error alerting","type":"CONSTRAINT","decision":"Enable error alerting only in production; do not alert on staging errors.","why":"Staging false positives desensitize the team to real production errors.","impact":"Alerting config must check the environment before firing.","invalidation":"Staging stability reaches production-grade reliability."}

        FAIL example:
        {"status":"decision","title":"Error alerting","type":"CONSTRAINT","decision":"Enable error alerting to catch production issues.","why":"Errors need to be caught.","impact":"Set up alerting.","invalidation":"When not needed."}
```

## Tests NOT Changed

| Test | Description | Why no change |
|---|---|---|
| 2 | ignores local refactor | Binary: `no_decision` with empty fields. Deterministic is exact. |
| 5 | ignores UX copy tweak | Same — binary no_decision check. |
| 6 | ignores session-only choice | Same. |
| 7 | ignores temporary debug logging | Same. |
| 8 | ignores migration mechanics | Same. |
| 9 | ignores placeholder chatter | Same. |
| 10 | enforces json-only output | Structural — valid JSON, no fences, no preamble. |

## Execution

### Implementing agent's loop

1. Run `npx promptfoo eval -c promptfooconfig.yaml`
2. Read failures.
3. If a judge assertion fails, edit `extensions/scribe/prompts/scribe.md` to address the semantic gap.
4. Do not edit `tests/promptfoo/scribe.tests.yaml` or `promptfooconfig.yaml` unless a test has a defect (not a prompt issue).
5. Repeat until all tests pass.

### Constraints on the implementing agent

- **May edit**: `tests/promptfoo/scribe.tests.yaml` (to implement changes from this plan), `extensions/scribe/prompts/scribe.md` (if tests reveal prompt defects).
- **May not edit**: `promptfooconfig.yaml`, `docs/SCRIBE_PROMPTFOO_PLAN.md`.
- This plan is the specification.

### Running

```bash
# Scribe tests only
npx promptfoo eval -c promptfooconfig.yaml

# Both harnesses (pre-commit requirement per AGENTS.md)
npx promptfoo eval -c promptfooconfig.yaml && npx promptfoo eval -c promptfooconfig.editor.yaml
```

## Cost Impact

| Before | After |
|---|---|
| 10 tests × 1 call = 10 calls | 11 tests × 1 call + 4 judge calls = 15 calls |

4 additional `gpt-5-mini` calls per run. Marginal cost.

## Risks

| Risk | Mitigation |
|---|---|
| Judge drifts on meaning fidelity | PASS/FAIL examples anchor the grading boundary. FAIL examples are near-misses, not obvious failures. |
| Removing keyword checks from tests 1/3/4 reduces deterministic coverage | Judge covers the same property more accurately. Structural gate still catches format issues. |
| New test 11 is too specific (production/staging) | The test exercises a general property (scoping constraints survive compression). The specific domain is arbitrary. |
| Prompt changes to pass judge assertions break existing negative tests | Run full suite after each edit. Negative tests are strict — any `status !== "no_decision"` is a clear failure. |
