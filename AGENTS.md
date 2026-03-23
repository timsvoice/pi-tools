## TDD

Use test-driven development by default:

1. Write a failing test for the expected external behavior.
2. Implement the minimum change to pass.
3. Refactor while keeping tests green.

Update tests when behavior/contracts change, not for internal refactors alone.

## Workflow (per task)

1. Run all tests (including promptfoo) before every commit.
2. Run the full test suite after changes when validating work; promptfoo is only required before commits.
3. Run formatters/linters/type checks.
4. Make focused, atomic commits.

When possible, separate refactors from behavior changes.

## Documentation Discipline

- When behavior/contracts change, update operator-facing docs in the same change (runbook/checklist/README as applicable).
- Keep project-agnostic policy in `AGENTS.md`; move domain specifics to project docs.

## Quality Gates

- Enforce formatting, linting, and static analysis in CI.
- Use pre-commit hooks to catch issues locally.
- Avoid merging changes that skip validation gates.

## Error Handling

- Fail fast on invalid inputs, missing dependencies, or bad config.
- Error messages must include:
  - what failed,
  - why it failed,
  - exact fix path.

## Security & Privacy

- Never commit secrets.
- Use environment variables or secret managers.
- Redact sensitive values and PII in logs and artifacts by default.
- Conduct a security audit before every commit

## Communication Style

- Use a dry, economical tone.
- Avoid praise, flattery, and celebratory language.
- Do not use obsequious phrasing or unnecessary agreement.
- Challenge assumptions directly when evidence is weak or risks are high.
- Prefer precise, actionable statements over motivational commentary.

## Model Selection
- never independently update a prescribed model used for inference or testing
- use only the service provider and model specified by the user
- when unsure, ask the user their preference
- this avoids unforeseen costs