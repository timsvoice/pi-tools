import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
	buildConventionsContent,
	buildDecisionsContent,
	fillPromptTemplate,
	selectRecentMessages,
} from "../.pi/extensions/scribe/index.ts";

test("fillPromptTemplate replaces placeholders and leaves no tokens", () => {
	const template = "Hello {name}, welcome to {place}.";
	const result = fillPromptTemplate(template, { name: "Ada", place: "Lab" });
	assert.equal(result, "Hello Ada, welcome to Lab.");
	assert.equal(/\{[^}]+\}/.test(result), false);
});

test("fillPromptTemplate throws when placeholders remain", () => {
	assert.throws(
		() => fillPromptTemplate("Hello {name} {missing}", { name: "Ada" }),
		/placeholder/i,
	);
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
	const result = buildDecisionsContent("", "Decision 1");
	assert.equal(result, "# Decisions\n\nDecision 1\n");
});

test("buildDecisionsContent appends to existing content", () => {
	const existing = "# Decisions\n\nOld";
	const result = buildDecisionsContent(existing, "New");
	assert.equal(result, "# Decisions\n\nOld\n\nNew\n");
});

test("buildConventionsContent returns null for empty output", () => {
	assert.equal(buildConventionsContent("\n\n"), null);
});

test("buildConventionsContent adds trailing newline", () => {
	assert.equal(buildConventionsContent("Rule"), "Rule\n");
});
