import test from "node:test";
import assert from "node:assert/strict";

import {
	buildScribePrompt,
	extractResponseText,
	extractTurnEntries,
	keepCandidateBlocks,
	nextTurnCounter,
	parseDecisionIntervalTurns,
	selectNewTurns,
} from "../scribe/core.mjs";

test("parseDecisionIntervalTurns parses valid positive integer", () => {
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 7}', 3), 7);
});

test("parseDecisionIntervalTurns falls back on invalid values", () => {
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 0}', 3), 3);
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": -1}', 3), 3);
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 2.5}', 3), 3);
	assert.equal(parseDecisionIntervalTurns('invalid-json', 3), 3);
});

test("nextTurnCounter gates execution until interval", () => {
	assert.deepEqual(nextTurnCounter(0, 3), { turnsSinceLastDecision: 1, shouldRun: false });
	assert.deepEqual(nextTurnCounter(1, 3), { turnsSinceLastDecision: 2, shouldRun: false });
	assert.deepEqual(nextTurnCounter(2, 3), { turnsSinceLastDecision: 0, shouldRun: true });
});

test("extractTurnEntries keeps only user/assistant text blocks", () => {
	const branch = [
		{ type: "message", id: "1", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
		{ type: "message", id: "2", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
		{ type: "message", id: "3", message: { role: "toolResult", content: [{ type: "text", text: "ignore" }] } },
		{ type: "message", id: "4", message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] } },
	];

	assert.deepEqual(extractTurnEntries(branch), [
		{ entryId: "1", line: "user: hi" },
		{ entryId: "2", line: "assistant: hello" },
	]);
});

test("selectNewTurns slices after last processed entry id", () => {
	const entries = [
		{ entryId: "a", line: "user: 1" },
		{ entryId: "b", line: "assistant: 2" },
		{ entryId: "c", line: "user: 3" },
	];
	assert.deepEqual(selectNewTurns(entries, "b"), {
		newTurns: [{ entryId: "c", line: "user: 3" }],
		newLastProcessedEntryId: "c",
	});
});

test("keepCandidateBlocks removes non-candidate sections", () => {
	const input = `Header note\n\n### [CANDIDATE] A\n**Type:** ARCHITECTURAL\n\nNote in block\n\n### [CANDIDATE] B\n**Type:** INTERFACE\n\nTail note`;
	const output = keepCandidateBlocks(input);
	assert.match(output, /### \[CANDIDATE\] A/);
	assert.match(output, /### \[CANDIDATE\] B/);
	assert.doesNotMatch(output, /Header note/);
});

test("buildScribePrompt injects recent turns placeholder", () => {
	assert.equal(buildScribePrompt("x {recentTurns} y", "abc"), "x abc y");
});

test("extractResponseText joins text blocks only", () => {
	const content = [
		{ type: "text", text: "one" },
		{ type: "toolCall", name: "x" },
		{ type: "text", text: "two" },
	];
	assert.equal(extractResponseText(content), "one\ntwo");
});
