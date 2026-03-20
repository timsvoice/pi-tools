# Decision Log

### [REVIEWED] Require `systemPrompt` in `complete()` calls for codex responses
**Type:** CONSTRAINT
**Decision:** The extension must include a `systemPrompt` when calling `complete()` in this provider/model path.
**Why:** Diagnostics showed successful invocation with empty content until response metadata revealed `stopReason=error` and provider error detail `"Instructions are required"`, establishing a hard API requirement.
**Invalidation:** Revisit if provider behavior changes or model adapter semantics are updated such that instructions are optional.
**Status:** candidate

### [REVIEWED] Use session active model (`ctx.model`) instead of hardcoded provider/model
**Type:** ARCHITECTURAL
**Decision:** Model selection was switched from a hardcoded registry lookup to the active session model via `ctx.model`.
**Why:** Hardcoding introduced environment-specific fragility and made behavior diverge from the actual model context in use.
**Invalidation:** Revisit if scribe needs strict model pinning for consistency/compliance and that requirement outweighs runtime compatibility.
**Status:** candidate

### [REVIEWED] Throttle decision logging and send only unseen turns
**Type:** ARCHITECTURAL
**Decision:** Decision generation now runs every configurable N turns and only includes messages added since the last trigger.
**Why:** Repeatedly sending overlapping history produced duplicate decision entries; interval-based triggering plus incremental slicing reduces duplication and prompt churn.
**Invalidation:** Revisit if important decisions are being missed between intervals or if a stronger idempotency/dedup strategy replaces turn-count gating.
**Status:** candidate

### [REVIEWED] Require `systemPrompt` when calling `complete()`
**Type:** CONSTRAINT  
**Decision:** The extension must include a `systemPrompt` in `complete()` calls to the active model/provider path.  
**Why:** Testing showed responses were empty until diagnostics revealed provider error `Instructions are required`; adding `systemPrompt` produced valid text output immediately.  
**Invalidation:** Revisit if provider/model behavior changes such that instructions are optional, or if a different API path is adopted with different requirements.  
**Status:** candidate

### [REVIEWED] Use session active model (`ctx.model`) instead of hardcoded model selection
**Type:** ARCHITECTURAL  
**Decision:** The scribe extension should call the currently active session model (`ctx.model`) rather than resolving a hardcoded provider/model pair.  
**Why:** Hardcoded model selection contributed to brittle behavior and limited compatibility; aligning with session model reduces coupling and matches runtime context.  
**Invalidation:** Revisit if scribe requires a dedicated model with guaranteed capabilities/cost profile that differs from the session model.  
**Status:** candidate

### [REVIEWED] Trigger decision logging at fixed turn intervals and only on unseen turns
**Type:** ARCHITECTURAL  
**Decision:** Decision extraction runs every configured `decisionIntervalTurns` and sends only new user/assistant turns since the last trigger.  
**Why:** Continuous reprocessing of the same conversation caused duplicate and noisy entries in `docs/decisions.md`; interval + incremental input reduces duplication and focuses outputs.  
**Invalidation:** Revisit if higher fidelity is needed (e.g., per-turn capture), or if a more robust checkpointing mechanism (e.g., entry-id based tracking) replaces count-based slicing.  
**Status:** candidate

### [REVIEWED] Filter and gate LLM decision-log writes by strict entry format
**Type:** CONSTRAINT  
**Decision:** The decision recorder should append to `docs/decisions.md` only blocks that match the required candidate-entry format (e.g., start with `### [CANDIDATE]`) instead of appending raw model output verbatim.  
**Why:** Raw-output appends allowed non-decision commentary and malformed content into the canonical log, reducing trust and creating maintenance noise; strict gating trades recall for log integrity.  
**Project Impact:** Future recorder changes must preserve a validation/filter step before file writes, and malformed or extra assistant text must be dropped rather than persisted.  
**Invalidation:** Revisit if the system moves to structured/function-call outputs with schema validation that guarantees only valid decision objects are produced.  
**Status:** candidate

### [REVIEWED] Functional core with dependency-injected runtimes for scribe/editor
**Type:** ARCHITECTURAL
**Decision:** The scribe and editor extensions were split into pure core modules, while side-effectful runtime handlers were restructured to use injected dependencies for file I/O and LLM calls.
**Why:** This chose testability and determinism over a simpler tightly-coupled implementation, enabling isolated unit tests and mock-based verification of behavior without real external services.
**Project Impact:** Future changes should keep domain logic in pure functions and route all external interactions through typed dependency interfaces; new features should be testable via core-only tests and mocked runtime tests.
**Invalidation:** Revisit if performance/complexity costs of indirection outweigh testability benefits, or if platform constraints require direct API binding.
**Status:** candidate

### [REVIEWED] Distinguish durable conventions from operational policies
**Type:** ARCHITECTURAL
**Decision:** Project documentation should separate long-lived architectural conventions from configurable operational policies, with interval-based logging behavior classified as operational.  
**Why:** This preserves a stable set of non-negotiable engineering rules while allowing tunable runtime strategies to evolve without creating false permanence in conventions docs.  
**Project Impact:** Future engineers must place new rules in the correct category, reducing documentation drift and preventing operational defaults from being treated as architectural constraints.  
**Invalidation:** Revisit if the team decides all documented rules must be equally binding and long-lived, or if operational behavior becomes fixed by external requirements.  
**Status:** candidate

### [REVIEWED] Establish staff-engineer authority and implementation-oriented output policy for editor prompt
**Type:** CONSTRAINT  
**Decision:** The editor prompt is explicitly set to act as a staff engineer producing authoritative conventions documents for engineers, with a durable style policy favoring concrete, implementation-oriented guidance over abstract summaries.  
**Why:** The alternative was leaving tone implicit or template-driven, which risked verbose, non-actionable outputs; making role and style explicit improves consistency, decision clarity, and practical usability for downstream implementers.  
**Project Impact:** Future prompt and documentation changes must preserve this authoritative, concrete, implementation-focused voice, and generated engineering docs should prioritize actionable conventions, rationale, and practical constraints.  
**Invalidation:** Revisit if the project changes target audience away from engineers, adopts a different documentation objective (e.g., exploratory/speculative writing), or evidence shows this policy reduces documentation effectiveness.  
**Status:** candidate

### [REVIEWED] Canonical shared pipeline config
**Type:** INTERFACE  
**Decision:** The extensions use `.pi/extensions/scribe.config.json` as the shared config.  
**Why:** This establishes a clear cross-extension configuration contract with a single source of truth.  
**Project Impact:** Future extension/config work should target `scribe.config.json` as the sole config path.  
**Invalidation:** Revisit if a new centralized config system replaces file-based extension config.  
**Status:** candidate

### [REVIEWED] Bootstrap `docs/decisions.md` when missing
**Type:** CONSTRAINT  
**Decision:** Both scribe and editor must create `docs/decisions.md` with a default `# Decision Log` header if it is missing or empty before any read/append flow.  
**Why:** The prior behavior created asymmetric failure modes (scribe could implicitly create on append while editor errored on read), and explicit bootstrapping was chosen over warning/fail behavior to make decision logging self-healing and deterministic.  
**Project Impact:** Any component that reads or writes the decision log should rely on and preserve this bootstrap invariant, preventing startup/order dependencies and eliminating missing-file error paths.  
**Invalidation:** Revisit if the project moves away from a file-based decision log, changes canonical path/format, or introduces a centralized document provisioning layer.  
**Status:** candidate

### [REVIEWED] Unify extension config on `scribe.config.json`
**Type:** INTERFACE
**Decision:** The project standardized both editor and scribe extensions on a single shared config file, `.pi/extensions/scribe.config.json`.
**Why:** Enforcing one canonical config path reduces ambiguity and silent misconfiguration risk across extensions.
**Project Impact:** Future extension work must read/write the unified config contract only, and migration/bootstrapping logic should assume a single source of truth for decision pipeline behavior.
**Invalidation:** Revisit if separate extension-specific configuration becomes necessary due to materially divergent runtime requirements that cannot be represented safely in one shared schema.
**Status:** candidate

### [REVIEWED] Convention intake is aggressively compressed for durable signal
**Type:** CONSTRAINT  
**Decision:** The conventions pipeline (scribe + editor) must prioritize maximum signal density and long-term usefulness, emitting only minimal, durable project-level decisions and omitting uncertain or noisy items.  
**Why:** The team explicitly prefers false negatives over false positives to prevent `docs/conventions.md` from accumulating low-value session noise.  
**Project Impact:** Prompt design and updates should enforce strict inclusion gates and compression behavior, with output treated as scarce and focused on stable engineering conventions.  
**Invalidation:** Revisit if the team later decides broader historical capture is more valuable than strict noise suppression.  
**Status:** candidate

### [REVIEWED] Scribe intake allows durable capture-policy decisions
**Type:** CONSTRAINT
**Decision:** Prompt/process discussions remain excluded from conventions capture unless they define a durable, project-level policy governing how decisions/conventions are captured and curated.
**Why:** Pure prompt chatter is usually noise, but stable intake-policy rules materially affect long-term decision quality and should be preserved.
**Project Impact:** Future scribe prompt updates should continue filtering transient prompt-tuning while admitting durable curation-policy decisions as valid candidates.
**Invalidation:** If the team changes policy to either fully exclude all prompt/process content or broadly include it regardless of durability.
**Status:** candidate

### [REVIEWED] Prompt quality changes must be evaluated with Promptfoo and LLM-as-a-judge
**Type:** CONSTRAINT
**Decision:** Changes to scribe/editor prompts should be validated through Promptfoo evaluations with LLM-as-a-judge scoring, using baseline-vs-candidate comparisons before adoption.
**Why:** Intuition-driven prompt tuning reached diminishing returns and lacked repeatable quality signals and regression detection.
**Project Impact:** Prompt updates should include eval fixtures, rubric-based judge scoring, and regression checks in the prompt iteration workflow.
**Invalidation:** If the project replaces Promptfoo/LLM-as-a-judge with another standardized evaluation framework that provides equivalent regression-safe prompt validation.
**Status:** candidate

### [REVIEWED] CLI argument parser must not filter index 0 when optional flag indices are absent
**Type:** CONSTRAINT
**Decision:** When parsing CLI arguments with optional flags, index-exclusion logic must guard against absent flags (index `-1`) to avoid accidentally filtering out the primary positional argument at index 0.
**Why:** `-1 + 1 = 0` causes the zeroth argument to be silently excluded, making the tool appear broken with no error pointing to the real cause — a subtle off-by-one class of bug.
**Project Impact:** Any CLI argument parsing in the project that uses index-based filtering for optional flags must only exclude indices for flags that were actually found.
**Invalidation:** If argument parsing is replaced by a structured parser library that handles positional vs flag arguments natively.
**Status:** candidate

### [REVIEWED] Pi skills are declarative SKILL.md-only packages
**Type:** ARCHITECTURAL
**Decision:** Pi skills consist of a single `SKILL.md` file containing tool descriptions and usage instructions; no scripts, `package.json`, or runtime dependencies belong in the skill folder.
**Why:** The agent executes commands via its built-in bash tool, so wrapper scripts and dependency trees add complexity without value. The `brave-search` pattern proved a declarative-only skill is sufficient.
**Project Impact:** New skills must follow the SKILL.md-only pattern. Existing skills carrying scripts or package manifests should be reduced to a single SKILL.md. Code review should reject skill PRs that introduce runtime artifacts.
**Invalidation:** If a skill requires server-side logic, persistent state, or dependencies that cannot be delegated to an external CLI.
**Status:** candidate

### [REVIEWED] Scribe extension must be self‑contained under .pi/extensions
**Type:** ARCHITECTURAL
**Decision:** The scribe skill must live entirely under `.pi/extensions/` as a single self‑contained extension and must not modify core Pi agent logic, while still using global settings.
**Why:** Keeping the extension isolated avoids coupling to core agent internals and makes the skill portable and maintainable.
**Project Impact:** All runtime code, prompts, and templates for scribe should reside within its extension folder; future changes should not touch core agent files.
**Invalidation:** If the project adopts a new extension system that requires shared core modifications.
**Status:** candidate
