export const DEFAULT_DECISION_INTERVAL_TURNS = 3;
export const DEFAULT_EDITOR_RATE_MULTIPLIER = 3;

export function parseDecisionIntervalTurns(configText, fallback = DEFAULT_DECISION_INTERVAL_TURNS) {
	if (!configText || typeof configText !== "string") return fallback;
	try {
		const parsed = JSON.parse(configText);
		const value = parsed?.decisionIntervalTurns;
		if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	} catch {
		// ignore
	}
	return fallback;
}

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

export function nextTurnCounter(turnsSinceLastRun, interval) {
	const next = turnsSinceLastRun + 1;
	if (next < interval) {
		return { turnsSinceLastRun: next, shouldRun: false };
	}
	return { turnsSinceLastRun: 0, shouldRun: true };
}

export function extractTurnEntries(branch) {
	const turns = [];
	for (const entry of branch ?? []) {
		if (!entry || entry.type !== "message") continue;
		if (entry.message?.role !== "user" && entry.message?.role !== "assistant") continue;
		const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
		const text = content
			.filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (!text) continue;
		turns.push({ entryId: entry.id, line: `${entry.message.role}: ${text}` });
	}
	return turns;
}

export function selectNewTurns(turnEntries, lastProcessedEntryId) {
	if (!Array.isArray(turnEntries) || turnEntries.length === 0) {
		return { newTurns: [], newLastProcessedEntryId: lastProcessedEntryId };
	}

	let startIndex = 0;
	if (lastProcessedEntryId) {
		const idx = turnEntries.findIndex((turn) => turn.entryId === lastProcessedEntryId);
		startIndex = idx >= 0 ? idx + 1 : 0;
	}

	const newTurns = turnEntries.slice(startIndex);
	const newLastProcessedEntryId = turnEntries[turnEntries.length - 1].entryId;
	return { newTurns, newLastProcessedEntryId };
}

export function buildScribePrompt(template, recentTurns) {
	return String(template ?? "").replace("{recentTurns}", recentTurns);
}

export function buildEditorPrompt(template, currentConventions, pendingDecisions) {
	return String(template ?? "")
		.replace("{currentConventions}", currentConventions)
		.replace("{newCandidates}", pendingDecisions);
}

export function extractResponseText(responseContent) {
	return (responseContent ?? [])
		.filter((c) => c?.type === "text" && typeof c?.text === "string")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

export function keepCandidateBlocks(markdown) {
	const text = String(markdown ?? "").trim();
	if (!text) return "";
	const blocks = text
		.split(/\n(?=### \[CANDIDATE\])/)
		.map((b) => b.trim())
		.filter((b) => b.startsWith("### [CANDIDATE]"));
	return blocks.join("\n\n").trim();
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

export function defaultConventionsDocument() {
	return "# Conventions\n\n## Conflicts Requiring Review\nNone.\n\n## Active Decisions\n\n## Superseded Decisions\nNone.\n";
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

export function isScribeState(value) {
	if (!value || typeof value !== "object") return false;
	const turns = value.turnsSinceLastDecision;
	const lastId = value.lastProcessedEntryId;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (lastId !== undefined && typeof lastId !== "string") return false;
	return true;
}

export function isEditorState(value) {
	if (!value || typeof value !== "object") return false;
	const turns = value.turnsSinceLastEdit;
	const hash = value.lastProcessedDecisionsHash;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (hash !== undefined && typeof hash !== "string") return false;
	return true;
}
