import test from "node:test";
import assert from "node:assert/strict";

import {
	buildEditorPrompt,
	buildPendingDecisionsDocument,
	buildScribePrompt,
	computeEditorIntervalTurns,
	defaultConventionsDocument,
	extractResponseText,
	extractTurnEntries,
	getCandidateBlocks,
	keepCandidateBlocks,
	markCandidatesReviewed,
	nextTurnCounter,
	parseDecisionIntervalTurns,
	parseEditorConfig,
	selectNewTurns,
	simpleHash,
} from "../scribe/core.mjs";

test("parseDecisionIntervalTurns parses valid positive integer", () => {
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 7}', 3), 7);
});

test("parseDecisionIntervalTurns falls back on invalid values", () => {
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 0}', 3), 3);
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": -1}', 3), 3);
	assert.equal(parseDecisionIntervalTurns('{"decisionIntervalTurns": 2.5}', 3), 3);
	assert.equal(parseDecisionIntervalTurns("invalid-json", 3), 3);
});

test("parseEditorConfig reads both interval and multiplier", () => {
	const cfg = parseEditorConfig('{"decisionIntervalTurns":4,"editorRateMultiplier":3}');
	assert.deepEqual(cfg, { decisionIntervalTurns: 4, editorRateMultiplier: 3 });
});

test("parseEditorConfig falls back on invalid values", () => {
	const cfg = parseEditorConfig('{"decisionIntervalTurns":0,"editorRateMultiplier":-1}');
	assert.deepEqual(cfg, { decisionIntervalTurns: 3, editorRateMultiplier: 3 });
});

test("computeEditorIntervalTurns multiplies rates", () => {
	assert.equal(computeEditorIntervalTurns({ decisionIntervalTurns: 5, editorRateMultiplier: 3 }), 15);
});

test("nextTurnCounter gates execution until interval", () => {
	assert.deepEqual(nextTurnCounter(0, 3), { turnsSinceLastRun: 1, shouldRun: false });
	assert.deepEqual(nextTurnCounter(1, 3), { turnsSinceLastRun: 2, shouldRun: false });
	assert.deepEqual(nextTurnCounter(2, 3), { turnsSinceLastRun: 0, shouldRun: true });
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

test("getCandidateBlocks selects only candidate headings", () => {
	const decisions = `# Decision Log\n\n### [CANDIDATE] A\ntext\n\n### [REVIEWED] B\ntext\n\n### [CANDIDATE] C\ntext`;
	assert.deepEqual(getCandidateBlocks(decisions), ["### [CANDIDATE] A\ntext", "### [CANDIDATE] C\ntext"]);
});

test("markCandidatesReviewed updates all candidate headings", () => {
	const decisions = `### [CANDIDATE] A\n\n### [CANDIDATE] B`;
	assert.equal(markCandidatesReviewed(decisions), "### [REVIEWED] A\n\n### [REVIEWED] B");
});

test("buildPendingDecisionsDocument prepends decision log header", () => {
	assert.equal(buildPendingDecisionsDocument(["### [CANDIDATE] A"]), "# Decision Log\n\n### [CANDIDATE] A");
});

test("buildScribePrompt injects recent turns placeholder", () => {
	assert.equal(buildScribePrompt("x {recentTurns} y", "abc"), "x abc y");
});

test("buildEditorPrompt injects both placeholders", () => {
	const template = "cur={currentConventions}\nnew={newCandidates}";
	assert.equal(buildEditorPrompt(template, "C", "N"), "cur=C\nnew=N");
});

test("extractResponseText joins text blocks only", () => {
	const content = [
		{ type: "text", text: "one" },
		{ type: "toolCall", name: "x" },
		{ type: "text", text: "two" },
	];
	assert.equal(extractResponseText(content), "one\ntwo");
});

test("defaultConventionsDocument includes required sections", () => {
	const doc = defaultConventionsDocument();
	assert.match(doc, /# Conventions/);
	assert.match(doc, /## Conflicts Requiring Review/);
	assert.match(doc, /## Active Decisions/);
	assert.match(doc, /## Superseded Decisions/);
});

test("simpleHash stable for same text", () => {
	assert.equal(simpleHash("abc"), simpleHash("abc"));
	assert.notEqual(simpleHash("abc"), simpleHash("abcd"));
});
