import test from "node:test";
import assert from "node:assert/strict";

import {
	buildEditorPrompt,
	buildPendingDecisionsDocument,
	computeEditorIntervalTurns,
	defaultConventionsDocument,
	extractResponseText,
	getCandidateBlocks,
	markCandidatesReviewed,
	nextTurnCounter,
	parseEditorConfig,
	simpleHash,
} from "../editor/core.mjs";

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

test("nextTurnCounter gates editor execution", () => {
	assert.deepEqual(nextTurnCounter(0, 2), { turnsSinceLastEdit: 1, shouldRun: false });
	assert.deepEqual(nextTurnCounter(1, 2), { turnsSinceLastEdit: 0, shouldRun: true });
});

test("simpleHash stable for same text", () => {
	assert.equal(simpleHash("abc"), simpleHash("abc"));
	assert.notEqual(simpleHash("abc"), simpleHash("abcd"));
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

test("buildEditorPrompt injects both placeholders", () => {
	const template = "cur={currentConventions}\nnew={newCandidates}";
	assert.equal(buildEditorPrompt(template, "C", "N"), "cur=C\nnew=N");
});

test("extractResponseText keeps only text blocks", () => {
	const content = [{ type: "text", text: "x" }, { type: "toolCall" }, { type: "text", text: "y" }];
	assert.equal(extractResponseText(content), "x\ny");
});

test("defaultConventionsDocument includes required sections", () => {
	const doc = defaultConventionsDocument();
	assert.match(doc, /# Conventions/);
	assert.match(doc, /## Conflicts Requiring Review/);
	assert.match(doc, /## Active Decisions/);
	assert.match(doc, /## Superseded Decisions/);
});
