import { complete } from "@mariozechner/pi-ai";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
	buildScribePrompt,
	extractResponseText,
	extractTurnEntries,
	isScribeState,
	keepCandidateBlocks,
	nextTurnCounter,
	parseDecisionIntervalTurns,
	selectNewTurns,
} from "./core.mjs";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "scribe", "PROMPT.md"];
const SCRIBE_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "scribe-state";

type ScribeState = {
	turnsSinceLastDecision: number;
	lastProcessedEntryId?: string;
};

type ScribeDeps = {
	readText: (path: string) => Promise<string>;
	appendText: (path: string, text: string) => Promise<void>;
	ensureDir: (path: string) => Promise<void>;
	complete: typeof complete;
};

const defaultDeps: ScribeDeps = {
	readText: (path) => readFile(path, "utf8"),
	appendText: (path, text) => appendFile(path, text, "utf8"),
	ensureDir: (path) => mkdir(path, { recursive: true }),
	complete,
};

export function createScribeAgentEndHandler(deps: ScribeDeps) {
	let turnsSinceLastDecision = 0;
	let lastProcessedEntryId: string | undefined;
	let lastPersistedState = "";
	let isRunning = false;

	const updateFooter = (ctx: ExtensionContext, interval: number) => {
		if (!ctx.hasUI) return;
		const text = `Scribe ${turnsSinceLastDecision}/${interval}`;
		ctx.ui.setStatus("scribe", `\x1b[90m${text}\x1b[0m`);
	};

	const persistState = (pi: ExtensionAPI) => {
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

	const readDecisionIntervalTurns = async (cwd: string): Promise<number> => {
		try {
			const configPath = join(cwd, ...CONFIG_PATH);
			const configText = await deps.readText(configPath);
			return parseDecisionIntervalTurns(configText, DEFAULT_DECISION_INTERVAL_TURNS);
		} catch {
			return DEFAULT_DECISION_INTERVAL_TURNS;
		}
	};

	return {
		hydrateState,
		updateFooter,
		async onAgentEnd(pi: ExtensionAPI, ctx: ExtensionContext) {
			if (isRunning) return;
			isRunning = true;

			try {
				const interval = await readDecisionIntervalTurns(ctx.cwd);
				const turnProgress = nextTurnCounter(turnsSinceLastDecision, interval);
				turnsSinceLastDecision = turnProgress.turnsSinceLastDecision;
				updateFooter(ctx, interval);
				if (!turnProgress.shouldRun) {
					persistState(pi);
					return;
				}

				persistState(pi);
				if (ctx.hasUI) ctx.ui.notify("Scribe: logging decisions...", "info");

				const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
				const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
				await deps.ensureDir(dirname(decisionsPath));

				const model = ctx.model;
				if (!model) return;

				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) return;

				const [promptTemplate, branch] = await Promise.all([
					deps.readText(promptPath),
					Promise.resolve(ctx.sessionManager.getBranch()),
				]);

				const turnEntries = extractTurnEntries(branch);
				const turnSelection = selectNewTurns(turnEntries, lastProcessedEntryId);
				lastProcessedEntryId = turnSelection.newLastProcessedEntryId;
				persistState(pi);

				const recentTurns = turnSelection.newTurns.map((turn) => turn.line).join("\n").trim();
				if (!recentTurns) return;

				const prompt = buildScribePrompt(promptTemplate, recentTurns);
				const response = await deps.complete(
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

				await deps.appendText(decisionsPath, `\n${text}\n`);
				if (ctx.hasUI) ctx.ui.notify("Scribe: decisions logged", "success");
			} catch (error) {
				if (ctx.hasUI) {
					ctx.ui.notify(`Scribe failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
				}
			} finally {
				isRunning = false;
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	const handler = createScribeAgentEndHandler(defaultDeps);

	pi.on("session_start", async (_event, ctx) => {
		handler.hydrateState(ctx);
		const configPath = join(ctx.cwd, ...CONFIG_PATH);
		let interval = DEFAULT_DECISION_INTERVAL_TURNS;
		try {
			interval = parseDecisionIntervalTurns(await defaultDeps.readText(configPath), DEFAULT_DECISION_INTERVAL_TURNS);
		} catch {
			// keep default
		}
		handler.updateFooter(ctx, interval);
	});

	pi.on("session_switch", async (_event, ctx) => {
		handler.hydrateState(ctx);
		const configPath = join(ctx.cwd, ...CONFIG_PATH);
		let interval = DEFAULT_DECISION_INTERVAL_TURNS;
		try {
			interval = parseDecisionIntervalTurns(await defaultDeps.readText(configPath), DEFAULT_DECISION_INTERVAL_TURNS);
		} catch {
			// keep default
		}
		handler.updateFooter(ctx, interval);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handler.onAgentEnd(pi, ctx);
	});
}
