import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
	buildConventionsContent,
	buildDecisionsContent,
	fillPromptTemplate,
	selectRecentMessages,
} from "../../extensions/scribe/index.ts";

test("fillPromptTemplate replaces required placeholders", () => {
	const template = "Hello {{name}}, welcome to {{place}}.";
	const result = fillPromptTemplate(template, { name: "Ada", place: "Lab" });
	assert.equal(result, "Hello Ada, welcome to Lab.");
});

test("fillPromptTemplate throws when required placeholder missing", () => {
	assert.throws(
		() => fillPromptTemplate("Hello {{name}}", { name: "Ada", place: "Lab" }),
		/missing required placeholder/i,
	);
});

test("fillPromptTemplate allows other braces", () => {
	const template = "Example {Short title} and {{name}}.";
	const result = fillPromptTemplate(template, { name: "Ada" });
	assert.equal(result, "Example {Short title} and Ada.");
});

test("selectRecentMessages includes last N user turns with assistants", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "one" } },
		{ type: "message", message: { role: "assistant", content: "a1" } },
		{ type: "message", message: { role: "user", content: "two" } },
		{ type: "message", message: { role: "assistant", content: "a2" } },
		{ type: "message", message: { role: "tool", content: "ignored" } },
		{ type: "message", message: { role: "user", content: "three" } },
		{ type: "message", message: { role: "assistant", content: "a3" } },
	];

	const result = selectRecentMessages(entries, 2);
	assert.deepEqual(
		result.map((message) => message.content),
		["two", "a2", "three", "a3"],
	);
});

test("selectRecentMessages skips orphan assistant messages", () => {
	const entries = [
		{ type: "message", message: { role: "assistant", content: "a0" } },
		{ type: "message", message: { role: "user", content: "u1" } },
		{ type: "message", message: { role: "assistant", content: "a1" } },
		{ type: "message", message: { role: "user", content: "u2" } },
		{ type: "message", message: { role: "assistant", content: "a2" } },
	];

	const result = selectRecentMessages(entries, 2);
	assert.deepEqual(
		result.map((message) => message.content),
		["u1", "a1", "u2", "a2"],
	);
});

test("selectRecentMessages preserves order for generated sequences", () => {
	const roleArb = fc.constantFrom("user", "assistant", "tool", "system");
	const entryArb = fc.record({
		type: fc.constant("message"),
		message: fc.record({
			role: roleArb,
			content: fc.string(),
		}),
	});

	fc.assert(
		fc.property(fc.array(entryArb, { minLength: 1, maxLength: 50 }), (entries) => {
			const result = selectRecentMessages(entries, 3);
			const indices = result.map((message) =>
				entries.findIndex((entry) => entry.message === message),
			);
			for (let i = 1; i < indices.length; i += 1) {
				assert.ok(indices[i - 1] <= indices[i]);
			}
		}),
	);
});

test("buildDecisionsContent appends with header when empty", () => {
	const output = JSON.stringify({
		status: "decision",
		title: "Run tests before commit",
		type: "CONSTRAINT",
		decision: "All tests must be run before each commit.",
		why: "not stated",
		impact: "Developers must execute the full test suite prior to committing changes.",
		invalidation: "not stated",
	});
	const result = buildDecisionsContent("", output);
	assert.equal(
		result,
		[
			"# Decisions",
			"",
			"## Run tests before commit",
			"",
			"- Status: decision",
			"- Title: Run tests before commit",
			"- Type: CONSTRAINT",
			"- Decision: All tests must be run before each commit.",
			"- Why: not stated",
			"- Impact: Developers must execute the full test suite prior to committing changes.",
			"- Invalidation: not stated",
			"",
		].join("\n"),
	);
});

test("buildDecisionsContent appends to existing content", () => {
	const existing = "# Decisions\n\nOld";
	const output = JSON.stringify({
		status: "decision",
		title: "New policy",
		type: "CONSTRAINT",
		decision: "Use the new template.",
		why: "Consistency",
		impact: "Standardized outputs",
		invalidation: "not stated",
	});
	const result = buildDecisionsContent(existing, output);
	assert.equal(
		result,
		[
			"# Decisions",
			"",
			"Old",
			"",
			"## New policy",
			"",
			"- Status: decision",
			"- Title: New policy",
			"- Type: CONSTRAINT",
			"- Decision: Use the new template.",
			"- Why: Consistency",
			"- Impact: Standardized outputs",
			"- Invalidation: not stated",
			"",
		].join("\n"),
	);
});

test("buildDecisionsContent allows missing fields", () => {
	const output = JSON.stringify({
		status: "decision",
	});
	assert.equal(
		buildDecisionsContent("", output),
		[
			"# Decisions",
			"",
			"## ",
			"",
			"- Status: decision",
			"- Title: ",
			"- Type: ",
			"- Decision: ",
			"- Why: ",
			"- Impact: ",
			"- Invalidation: ",
			"",
		].join("\n"),
	);
});

test("buildDecisionsContent returns null for no_decision", () => {
	const output = JSON.stringify({
		status: "no_decision",
		title: "",
		type: "",
		decision: "",
		why: "",
		impact: "",
		invalidation: "",
	});
	assert.equal(buildDecisionsContent("# Decisions", output), null);
});

test("buildConventionsContent returns null for empty output", () => {
	assert.equal(buildConventionsContent("\n\n"), null);
});

test("buildConventionsContent adds trailing newline", () => {
	assert.equal(buildConventionsContent("Rule"), "Rule\n");
});
