export const DEFAULT_DECISION_INTERVAL_TURNS = 3;
export const DEFAULT_EDITOR_RATE_MULTIPLIER = 3;

export function parseEditorConfig(configText) {
	let parsed;
	try {
		parsed = JSON.parse(String(configText ?? "{}"));
	} catch {
		parsed = {};
	}

	const decisionIntervalTurns =
		typeof parsed.decisionIntervalTurns === "number" &&
		Number.isInteger(parsed.decisionIntervalTurns) &&
		parsed.decisionIntervalTurns > 0
			? parsed.decisionIntervalTurns
			: DEFAULT_DECISION_INTERVAL_TURNS;

	const editorRateMultiplier =
		typeof parsed.editorRateMultiplier === "number" &&
		Number.isInteger(parsed.editorRateMultiplier) &&
		parsed.editorRateMultiplier > 0
			? parsed.editorRateMultiplier
			: DEFAULT_EDITOR_RATE_MULTIPLIER;

	return { decisionIntervalTurns, editorRateMultiplier };
}

export function computeEditorIntervalTurns(config) {
	return config.decisionIntervalTurns * config.editorRateMultiplier;
}

export function nextTurnCounter(turnsSinceLastEdit, interval) {
	const next = turnsSinceLastEdit + 1;
	if (next < interval) return { turnsSinceLastEdit: next, shouldRun: false };
	return { turnsSinceLastEdit: 0, shouldRun: true };
}

export function simpleHash(text) {
	const s = String(text ?? "");
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		hash = (hash << 5) - hash + s.charCodeAt(i);
		hash |= 0;
	}
	return `${s.length}:${hash}`;
}

export function extractResponseText(responseContent) {
	return (responseContent ?? [])
		.filter((c) => c?.type === "text" && typeof c?.text === "string")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

export function getCandidateBlocks(decisions) {
	return String(decisions ?? "")
		.split(/\n(?=### )/)
		.map((block) => block.trim())
		.filter((block) => block.startsWith("### [CANDIDATE]"));
}

export function markCandidatesReviewed(decisions) {
	return String(decisions ?? "").replace(/^### \[CANDIDATE\]/gm, "### [REVIEWED]");
}

export function buildPendingDecisionsDocument(candidateBlocks) {
	return ["# Decision Log", "", ...(candidateBlocks ?? [])].join("\n");
}

export function buildEditorPrompt(template, currentConventions, pendingDecisions) {
	return String(template ?? "")
		.replace("{currentConventions}", currentConventions)
		.replace("{newCandidates}", pendingDecisions);
}

export function defaultConventionsDocument() {
	return "# Conventions\n\n## Conflicts Requiring Review\nNone.\n\n## Active Decisions\n\n## Superseded Decisions\nNone.\n";
}

export function isEditorState(value) {
	if (!value || typeof value !== "object") return false;
	const turns = value.turnsSinceLastEdit;
	const hash = value.lastProcessedDecisionsHash;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (hash !== undefined && typeof hash !== "string") return false;
	return true;
}
