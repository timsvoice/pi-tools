# Conventions

## Conflicts Requiring Review
None.

## Active Decisions

### Staff-engineer authority and implementation-oriented output policy for editor prompt
- **Decision:** Conventions/editor outputs must use an authoritative staff-engineer voice and prioritize concrete, implementation-ready guidance over abstract summaries.
- **Why:** Implicit tone/style previously produced inconsistent, low-actionability documentation.
- **Project impact:** Future prompt and documentation updates should preserve direct engineering guidance unless explicitly changed.
- **Invalidation:** Revisit if audience/objective shifts away from implementation guidance or evidence shows reduced effectiveness.

### Require `systemPrompt` in `complete()` calls
- **Decision:** All `complete()` calls on the active provider/model path must include a `systemPrompt`.
- **Why:** Provider behavior requires instructions; missing prompts caused empty/failed responses.
- **Project impact:** Invocation/adapter layers must enforce prompt injection and fail fast or emit explicit diagnostics when absent.
- **Invalidation:** Revisit if provider/API semantics change to make instructions optional.

### Use active session model (`ctx.model`) for inference routing
- **Decision:** Runtime model selection defaults to `ctx.model`; avoid hardcoded provider/model IDs in normal paths.
- **Why:** Hardcoded models caused brittle, environment-specific divergence from live runtime context.
- **Project impact:** Scribe/editor inference and routing changes must remain session-context aligned; any model pinning must be explicit and justified.
- **Invalidation:** Revisit if compliance/capability/cost constraints require strict pinning.

### Incremental decision extraction with checkpointed unseen turns
- **Decision:** Decision extraction runs on configured intervals and processes only turns unseen since the previous checkpoint.
- **Why:** Full-history reprocessing created duplicate/noisy entries and unnecessary churn.
- **Project impact:** Recorder/scheduler changes must preserve incremental checkpoints or provide a stronger idempotent dedup design.
- **Invalidation:** Revisit if per-turn capture becomes mandatory or a superior idempotency mechanism replaces interval gating.

### Validate candidate format before decision-log persistence
- **Decision:** Append to `docs/decisions.md` only entries that match the required candidate decision format; drop malformed/non-decision output.
- **Why:** Raw LLM appends polluted the canonical log with invalid/noisy content.
- **Project impact:** Any logging pipeline rewrite must keep conservative validation/filtering before writes.
- **Invalidation:** Revisit if structured, schema-validated outputs guarantee valid decision objects.

### Bootstrap decision log file invariant
- **Decision:** Ensure `docs/decisions.md` exists and is initialized with `# Decision Log` before any read/append operations.
- **Why:** Implicit creation on append but not read caused asymmetric failures.
- **Project impact:** Shared file-access paths must preserve deterministic bootstrap behavior across scribe/editor flows.
- **Invalidation:** Revisit if decision storage moves away from this file/path model.

### Functional core with dependency-injected runtimes
- **Decision:** Keep scribe/editor decision logic in pure core modules; route side effects (LLM, file I/O) through injected typed dependencies.
- **Why:** Separation improves determinism, testability, and isolation from external services.
- **Project impact:** New features should maintain pure-core boundaries and support unit tests without real external integrations.
- **Invalidation:** Revisit if platform constraints or indirection costs materially outweigh testability/maintainability gains.

### Convention intake is aggressively compressed for durable signal
- **Decision:** Conventions curation must retain only minimal, durable project-level rules; prefer excluding borderline items over admitting noisy ones.
- **Why:** Long-term usefulness depends on high signal density and avoiding accumulation of session-level noise.
- **Project impact:** Prompting, extraction, and editing should enforce strict inclusion gates and aggressive dedup/compression.
- **Invalidation:** Revisit if the team decides broader historical capture is more valuable than strict noise suppression.

## Superseded Decisions

### Canonical shared pipeline config with legacy fallback
- **Decision:** Use `.pi/extensions/decision-pipeline.config.json` as primary config with fallback to `.pi/extensions/scribe.config.json`.
- **Why superseded:** Replaced by strict single-source config without legacy fallback.
- **Superseded by:** Unify extension config on `decision-pipeline.config.json`.

### Distinguish durable conventions from operational policies
- **Decision:** Separate long-lived conventions from tunable operational policies.
- **Why superseded:** Durable high-signal intake/compression policy now directly governs what enters conventions and absorbs this categorization intent.
- **Superseded by:** Convention intake is aggressively compressed for durable signal.
