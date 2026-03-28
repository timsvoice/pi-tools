import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import {
	type WindowResult,
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
		{ type: "message", id: "e1", message: { role: "user", content: "one" } },
		{ type: "message", id: "e2", message: { role: "assistant", content: "a1" } },
		{ type: "message", id: "e3", message: { role: "user", content: "two" } },
		{ type: "message", id: "e4", message: { role: "assistant", content: "a2" } },
		{ type: "message", id: "e5", message: { role: "tool", content: "ignored" } },
		{ type: "message", id: "e6", message: { role: "user", content: "three" } },
		{ type: "message", id: "e7", message: { role: "assistant", content: "a3" } },
	];

	const result = selectRecentMessages(entries, 2);
	assert.deepEqual(
		result.messages.map((message) => message.content),
		["two", "a2", "three", "a3"],
	);
	assert.equal(result.startEntryId, "e3");
	assert.equal(result.endEntryId, "e7");
});

test("selectRecentMessages skips orphan assistant messages", () => {
	const entries = [
		{ type: "message", id: "e1", message: { role: "assistant", content: "a0" } },
		{ type: "message", id: "e2", message: { role: "user", content: "u1" } },
		{ type: "message", id: "e3", message: { role: "assistant", content: "a1" } },
		{ type: "message", id: "e4", message: { role: "user", content: "u2" } },
		{ type: "message", id: "e5", message: { role: "assistant", content: "a2" } },
	];

	const result = selectRecentMessages(entries, 2);
	assert.deepEqual(
		result.messages.map((message) => message.content),
		["u1", "a1", "u2", "a2"],
	);
	assert.equal(result.startEntryId, "e2");
	assert.equal(result.endEntryId, "e5");
});

test("selectRecentMessages preserves order for generated sequences", () => {
	const roleArb = fc.constantFrom("user", "assistant", "tool", "system");
	let idCounter = 0;
	const entryArb = fc.record({
		type: fc.constant("message"),
		id: fc.constant("").map(() => `gen-${idCounter++}`),
		message: fc.record({
			role: roleArb,
			content: fc.string(),
		}),
	});

	fc.assert(
		fc.property(fc.array(entryArb, { minLength: 1, maxLength: 50 }), (entries) => {
			const result = selectRecentMessages(entries, 3);
			const indices = result.messages.map((message) =>
				entries.findIndex((entry) => entry.message === message),
			);
			for (let i = 1; i < indices.length; i += 1) {
				assert.ok(indices[i - 1] <= indices[i]);
			}
		}),
	);
});

test("selectRecentMessages returns null IDs for empty window", () => {
	const entries = [{ type: "message", id: "e1", message: { role: "tool", content: "ignored" } }];
	const result = selectRecentMessages(entries, 2);
	assert.equal(result.messages.length, 0);
	assert.equal(result.startEntryId, null);
	assert.equal(result.endEntryId, null);
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
	const provenance = { sessionId: "ses-001", startEntryId: "a1b2", endEntryId: "c3d4" };
	const result = buildDecisionsContent("", output, provenance);
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
			"- Session: ses-001",
			"- Window: a1b2..c3d4",
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
	const provenance = { sessionId: "ses-002", startEntryId: "x1", endEntryId: "x2" };
	const result = buildDecisionsContent(existing, output, provenance);
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
			"- Session: ses-002",
			"- Window: x1..x2",
			"",
		].join("\n"),
	);
});

test("buildDecisionsContent allows missing fields", () => {
	const output = JSON.stringify({
		status: "decision",
	});
	const provenance = { sessionId: "ses-003", startEntryId: "s1", endEntryId: "s2" };
	assert.equal(
		buildDecisionsContent("", output, provenance),
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
			"- Session: ses-003",
			"- Window: s1..s2",
			"",
		].join("\n"),
	);
});

test("buildDecisionsContent omits provenance when not provided", () => {
	const output = JSON.stringify({
		status: "decision",
		title: "No provenance",
		type: "CONSTRAINT",
		decision: "Rule.",
		why: "Reason.",
		impact: "Effect.",
		invalidation: "Never.",
	});
	const result = buildDecisionsContent("", output);
	assert.ok(result);
	assert.ok(!result.includes("Session:"));
	assert.ok(!result.includes("Window:"));
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
	const provenance = { sessionId: "ses-004", startEntryId: "s1", endEntryId: "s2" };
	assert.equal(buildDecisionsContent("# Decisions", output, provenance), null);
});

test("buildDecisionsContent sanitizes leading blockquote before parsing", () => {
	const output = [
		"> You know the feeling. You sit down with your agent.",
		JSON.stringify({
			status: "no_decision",
			title: "",
			type: "",
			decision: "",
			why: "",
			impact: "",
			invalidation: "",
		}),
	].join("\n");
	assert.equal(buildDecisionsContent("", output), null);
});

test("buildConventionsContent returns null for empty output", () => {
	assert.equal(buildConventionsContent("\n\n"), null);
});

test("buildConventionsContent adds trailing newline", () => {
	assert.equal(buildConventionsContent("Rule"), "Rule\n");
});
