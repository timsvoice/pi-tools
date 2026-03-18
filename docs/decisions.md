# Decision Log

### [CANDIDATE] Require `systemPrompt` in `complete()` calls for codex responses
**Type:** CONSTRAINT
**Decision:** The extension must include a `systemPrompt` when calling `complete()` in this provider/model path.
**Why:** Diagnostics showed successful invocation with empty content until response metadata revealed `stopReason=error` and provider error detail `"Instructions are required"`, establishing a hard API requirement.
**Invalidation:** Revisit if provider behavior changes or model adapter semantics are updated such that instructions are optional.
**Status:** candidate

### [CANDIDATE] Use session active model (`ctx.model`) instead of hardcoded provider/model
**Type:** ARCHITECTURAL
**Decision:** Model selection was switched from a hardcoded registry lookup to the active session model via `ctx.model`.
**Why:** Hardcoding introduced environment-specific fragility and made behavior diverge from the actual model context in use.
**Invalidation:** Revisit if scribe needs strict model pinning for consistency/compliance and that requirement outweighs runtime compatibility.
**Status:** candidate

### [CANDIDATE] Throttle decision logging and send only unseen turns
**Type:** ARCHITECTURAL
**Decision:** Decision generation now runs every configurable N turns and only includes messages added since the last trigger.
**Why:** Repeatedly sending overlapping history produced duplicate decision entries; interval-based triggering plus incremental slicing reduces duplication and prompt churn.
**Invalidation:** Revisit if important decisions are being missed between intervals or if a stronger idempotency/dedup strategy replaces turn-count gating.
**Status:** candidate

### [CANDIDATE] Require `systemPrompt` when calling `complete()`
**Type:** CONSTRAINT  
**Decision:** The extension must include a `systemPrompt` in `complete()` calls to the active model/provider path.  
**Why:** Testing showed responses were empty until diagnostics revealed provider error `Instructions are required`; adding `systemPrompt` produced valid text output immediately.  
**Invalidation:** Revisit if provider/model behavior changes such that instructions are optional, or if a different API path is adopted with different requirements.  
**Status:** candidate

### [CANDIDATE] Use session active model (`ctx.model`) instead of hardcoded model selection
**Type:** ARCHITECTURAL  
**Decision:** The scribe extension should call the currently active session model (`ctx.model`) rather than resolving a hardcoded provider/model pair.  
**Why:** Hardcoded model selection contributed to brittle behavior and limited compatibility; aligning with session model reduces coupling and matches runtime context.  
**Invalidation:** Revisit if scribe requires a dedicated model with guaranteed capabilities/cost profile that differs from the session model.  
**Status:** candidate

### [CANDIDATE] Trigger decision logging at fixed turn intervals and only on unseen turns
**Type:** ARCHITECTURAL  
**Decision:** Decision extraction runs every configured `decisionIntervalTurns` and sends only new user/assistant turns since the last trigger.  
**Why:** Continuous reprocessing of the same conversation caused duplicate and noisy entries in `docs/decisions.md`; interval + incremental input reduces duplication and focuses outputs.  
**Invalidation:** Revisit if higher fidelity is needed (e.g., per-turn capture), or if a more robust checkpointing mechanism (e.g., entry-id based tracking) replaces count-based slicing.  
**Status:** candidate

Love this prompt. It’s clear and strict in the right ways.

I’d make just two tiny tweaks for even better precision:

1) In **Output rules**, add:
- “Do not output placeholders or commentary.”

2) In **Required format**, enforce one more constraint:
- “If any required field is unknown, omit the candidate.”

If you want, I can provide the final tightened `PROMPT.md` text with those edits applied verbatim.

### [CANDIDATE] Filter and gate LLM decision-log writes by strict entry format
**Type:** CONSTRAINT  
**Decision:** The decision recorder should append to `docs/decisions.md` only blocks that match the required candidate-entry format (e.g., start with `### [CANDIDATE]`) instead of appending raw model output verbatim.  
**Why:** Raw-output appends allowed non-decision commentary and malformed content into the canonical log, reducing trust and creating maintenance noise; strict gating trades recall for log integrity.  
**Project Impact:** Future recorder changes must preserve a validation/filter step before file writes, and malformed or extra assistant text must be dropped rather than persisted.  
**Invalidation:** Revisit if the system moves to structured/function-call outputs with schema validation that guarantees only valid decision objects are produced.  
**Status:** candidate
