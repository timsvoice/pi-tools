# Conventions

## Conflicts Requiring Review
None.

## Active Decisions

### `complete()` always receives a non-empty `systemPrompt`
**Decision:** Every `complete()` call must include a non-empty `systemPrompt`.
**Why:** Some providers reject calls without instructions.

### Model calls route through `ctx.model`
**Decision:** Use `ctx.model` for all model invocations; never hardcode provider/model pairs.
**Why:** Hardcoding diverges from session configuration and breaks compatibility.

### Functional core, injected side effects
**Decision:** Keep scribe/editor decision logic pure; inject file I/O and LLM operations.
**Why:** Preserves determinism and testability.

### CLI flag exclusion must ignore missing flags
**Decision:** Only exclude indices for flags that are actually found; never exclude index `-1`.
**Project Impact:**
  ✓ `if (flagIndex !== -1) excludeIndices.add(flagIndex, flagIndex + 1)`
  ✗ `excludeIndices.add(flagIndex, flagIndex + 1) // when flagIndex may be -1`

### Scribe extension is self-contained under `.pi/extensions`
**Decision:** Scribe lives entirely under `.pi/extensions/` as a self-contained extension and must not modify core Pi agent logic (may use global settings).
**Why:** Isolation avoids coupling to core internals and keeps the skill portable.

## Superseded Decisions
None.
