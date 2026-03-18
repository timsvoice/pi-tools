export const DEFAULT_DECISION_INTERVAL_TURNS = 3;

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

export function nextTurnCounter(turnsSinceLastDecision, interval) {
	const next = turnsSinceLastDecision + 1;
	if (next < interval) {
		return { turnsSinceLastDecision: next, shouldRun: false };
	}
	return { turnsSinceLastDecision: 0, shouldRun: true };
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

export function isScribeState(value) {
	if (!value || typeof value !== "object") return false;
	const turns = value.turnsSinceLastDecision;
	const lastId = value.lastProcessedEntryId;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (lastId !== undefined && typeof lastId !== "string") return false;
	return true;
}
