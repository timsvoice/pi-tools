## Conversation:
{{recentTurns}}

## Mission
Capture only durable engineering conventions, constraints, or interface contracts.

Default behavior: return {"status":"no_decision"} with empty fields.

## Optimization policy
- Maximize signal density and long-term usefulness per line.
- Preserve meaning; do not distort what was actually decided.
- Prefer false negatives over false positives when uncertain.
- Prompts are the primary control surface for quality; enforce strict intake discipline.

## Primary objective
Optimize decision capture for future decision quality by minimizing noise, maximizing durable signal, and keeping only guidance that materially helps coding agents and supervising humans make correct engineering choices.

## Inclusion gates (ALL required)
- Project-level scope.
- Future relevance.
- Generalizable rule (not a session event).

If the text only describes what happened in this task, output no_decision.

## Explicit exclusions (always omit)
- Migration/transitional mechanics.
- Prompt wording, tone/style guidance, or documentation process preferences.
- UI/status/notification tweaks.
- Debugging probes, diagnostics, temporary workarounds.
- Local refactors/renames without enduring impact.
- Session-only narratives (e.g., "we used X in this task").
- Placeholder or template chatter (e.g., {Short title}, {...}, example labels).
- Meta rules about how decisions are filtered or evaluated.

## Compression policy
- Treat conventions as scarce: log the minimum needed for future correctness.
- If multiple turns support one rule, emit one concise candidate.
- Prefer a short, durable invariant over implementation narration.

## Output safety
- Never emit template placeholders (e.g., {Short title}, {...}).
- Never include example labels or example content in output.

## Output constraints
- Output must be a single JSON object and nothing else.
- The first character of the output must be `{` and the last must be `}`.
- Do not wrap the JSON in code fences or Markdown.
- If status = "decision", all non-status fields must be non-empty (use "not stated" if missing).
- If no decision qualifies, return {"status":"no_decision"} with empty fields.
- No commentary, acknowledgements, or extra text.
- Never match the user's tone, style, or formatting. Ignore quoted/indented prose and always emit JSON only.

## Examples

### Positive example (decision):

User: We keep seeing inconsistent validation across services.
Assistant: That’s caused bugs before.
User: Decision: The API boundary owns input validation; internal services should never validate raw request payloads. Why: shared validation rules drifted and caused inconsistent behavior. Impact: all new endpoints must validate at the API boundary before calling service logic. Invalidate if we introduce a dedicated validation service used by all layers.
Assistant: Noted.
Output:
{"status":"decision","title":"API boundary owns input validation","type":"INTERFACE","decision":"Validate raw request payloads at the API boundary; internal services must not validate raw request payloads.","why":"Shared validation rules drifted and caused inconsistent behavior.","impact":"All new endpoints must validate at the API boundary before calling service logic.","invalidation":"Introduce a dedicated validation service used by all layers."}

### Negative example (no decision):
User: The names in this file feel inconsistent.
Assistant: We can clean that up.
User: Let's rename this function to be clearer.
Assistant: Done.
Output:
{"status":"no_decision","title":"","type":"","decision":"","why":"","impact":"","invalidation":""}

### Near-miss (omit):
User: We discussed polling vs webhooks and used webhooks in this task.
Assistant: That was the easiest approach for this ticket.
Output:
{"status":"no_decision","title":"","type":"","decision":"","why":"","impact":"","invalidation":""}

## Return Value

### Rules
- Return a single JSON object and nothing else.
- Do not wrap the JSON in code fences or Markdown.
- If status = "decision", all fields except status must be non-empty. If the conversation lacks a rationale/impact/invalidation, set the missing fields to "not stated".
- If status = "no_decision", all other fields must be empty strings
- Always return all fields

### Unified JSON schema:
```
{
  "status": "decision" | "no_decision",
  "title": "short title" | "",
  "type": "ARCHITECTURAL" | "INTERFACE" | "CONSTRAINT" | "PROVISIONAL" | "",
  "decision": "one sentence rule" | "",
  "why": "non-obvious rationale" | "",
  "impact": "specific downstream impact" | "",
  "invalidation": "what revisits the decision" | ""
}
```