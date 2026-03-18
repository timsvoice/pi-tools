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
