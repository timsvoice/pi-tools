import { complete } from "@mariozechner/pi-ai";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "scribe", "PROMPT.md"];
const SCRIBE_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "scribe-state";

type TurnEntry = {
	entryId: string;
	line: string;
};

type ScribeState = {
	turnsSinceLastDecision: number;
	lastProcessedEntryId?: string;
};

async function getDecisionIntervalTurns(cwd: string): Promise<number> {
	try {
		const configPath = join(cwd, ...CONFIG_PATH);
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as { decisionIntervalTurns?: unknown };
		if (typeof parsed.decisionIntervalTurns === "number" && Number.isInteger(parsed.decisionIntervalTurns) && parsed.decisionIntervalTurns > 0) {
			return parsed.decisionIntervalTurns;
		}
	} catch {
		// ignore config errors and use default
	}
	return DEFAULT_DECISION_INTERVAL_TURNS;
}

function getTurnEntries(ctx: ExtensionContext): TurnEntry[] {
	const turns: TurnEntry[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "user" && entry.message.role !== "assistant") continue;
		const text = entry.message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (!text) continue;
		turns.push({ entryId: entry.id, line: `${entry.message.role}: ${text}` });
	}
	return turns;
}

function extractResponseText(responseContent: Array<{ type: string; text?: string }>): string {
	return responseContent
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

function keepCandidateBlocks(markdown: string): string {
	const text = markdown.trim();
	if (!text) return "";

	const blocks = text
		.split(/\n(?=### \[CANDIDATE\])/)
		.map((b) => b.trim())
		.filter((b) => b.startsWith("### [CANDIDATE]"));

	return blocks.join("\n\n").trim();
}

function isScribeState(value: unknown): value is ScribeState {
	if (!value || typeof value !== "object") return false;
	const turns = (value as { turnsSinceLastDecision?: unknown }).turnsSinceLastDecision;
	const lastId = (value as { lastProcessedEntryId?: unknown }).lastProcessedEntryId;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (lastId !== undefined && typeof lastId !== "string") return false;
	return true;
}

export default function (pi: ExtensionAPI) {
	let turnsSinceLastDecision = 0;
	let lastProcessedEntryId: string | undefined;
	let lastPersistedState = "";
	let isRunning = false;

	const updateFooter = (ctx: ExtensionContext, interval: number) => {
		if (!ctx.hasUI) return;
		const text = `Scribe ${turnsSinceLastDecision}/${interval}`;
		ctx.ui.setStatus("scribe", `\x1b[90m${text}\x1b[0m`);
	};

	const persistState = () => {
		const state: ScribeState = { turnsSinceLastDecision, lastProcessedEntryId };
		const serialized = JSON.stringify(state);
		if (serialized === lastPersistedState) return;
		pi.appendEntry(STATE_CUSTOM_TYPE, state);
		lastPersistedState = serialized;
	};

	const hydrateState = (ctx: ExtensionContext) => {
		let latest: ScribeState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== STATE_CUSTOM_TYPE) continue;
			if (!isScribeState(entry.data)) continue;
			latest = entry.data;
		}
		if (!latest) return;
		turnsSinceLastDecision = latest.turnsSinceLastDecision;
		lastProcessedEntryId = latest.lastProcessedEntryId;
		lastPersistedState = JSON.stringify(latest);
	};

	pi.on("session_start", async (_event, ctx) => {
		hydrateState(ctx);
		const interval = await getDecisionIntervalTurns(ctx.cwd);
		updateFooter(ctx, interval);
	});

	pi.on("session_switch", async (_event, ctx) => {
		hydrateState(ctx);
		const interval = await getDecisionIntervalTurns(ctx.cwd);
		updateFooter(ctx, interval);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (isRunning) return;
		isRunning = true;

		try {
			const decisionIntervalTurns = await getDecisionIntervalTurns(ctx.cwd);

			turnsSinceLastDecision += 1;
			updateFooter(ctx, decisionIntervalTurns);
			if (turnsSinceLastDecision < decisionIntervalTurns) {
				persistState();
				return;
			}

			turnsSinceLastDecision = 0;
			persistState();
			updateFooter(ctx, decisionIntervalTurns);
			if (ctx.hasUI) ctx.ui.notify("Scribe: logging decisions...", "info");

			const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
			const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
			await mkdir(dirname(decisionsPath), { recursive: true });

			const model = ctx.model;
			if (!model) return;

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) return;

			const promptTemplate = await readFile(promptPath, "utf8");
			const turnEntries = getTurnEntries(ctx);
			if (turnEntries.length === 0) return;

			let startIndex = 0;
			if (lastProcessedEntryId) {
				const idx = turnEntries.findIndex((turn) => turn.entryId === lastProcessedEntryId);
				startIndex = idx >= 0 ? idx + 1 : 0;
			}

			const newTurns = turnEntries.slice(startIndex);
			lastProcessedEntryId = turnEntries[turnEntries.length - 1]?.entryId;
			persistState();

			const recentTurns = newTurns.map((turn) => turn.line).join("\n").trim();
			if (!recentTurns) return;

			const prompt = promptTemplate.replace("{recentTurns}", recentTurns);
			const response = await complete(
				model,
				{
					systemPrompt: SCRIBE_SYSTEM_PROMPT,
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{ apiKey },
			);

			const text = keepCandidateBlocks(extractResponseText(response.content));
			if (!text) {
				if (ctx.hasUI) ctx.ui.notify("Scribe: no decisions made", "success");
				return;
			}

			await appendFile(decisionsPath, `\n${text}\n`, "utf8");
			if (ctx.hasUI) ctx.ui.notify("Scribe: decisions logged", "success");
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Scribe failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		} finally {
			isRunning = false;
		}
	});
}
