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
const PRIMARY_CONFIG_PATH = [".pi", "extensions", "decision-pipeline.config.json"];
const LEGACY_CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "scribe", "PROMPT.md"];
const SCRIBE_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "scribe-state";
const DEFAULT_DECISIONS_DOCUMENT = "# Decision Log\n";

type ScribeState = {
	turnsSinceLastDecision: number;
	lastProcessedEntryId?: string;
	runsSkipped?: number;
	runsExecuted?: number;
	decisionsAppended?: number;
	noDecisionRuns?: number;
	failures?: number;
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

const asNonNegativeInt = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;

const countCandidateBlocks = (markdown: string): number => (markdown.match(/^### \[CANDIDATE\]/gm) ?? []).length;

async function readPipelineConfigText(cwd: string, readText: ScribeDeps["readText"]): Promise<string> {
	for (const pathParts of [PRIMARY_CONFIG_PATH, LEGACY_CONFIG_PATH]) {
		try {
			return await readText(join(cwd, ...pathParts));
		} catch {
			// try next path
		}
	}
	throw new Error("No config file found");
}

async function readConfiguredDecisionIntervalTurns(cwd: string, deps: ScribeDeps): Promise<number> {
	try {
		const configText = await readPipelineConfigText(cwd, deps.readText);
		return parseDecisionIntervalTurns(configText, DEFAULT_DECISION_INTERVAL_TURNS);
	} catch {
		return DEFAULT_DECISION_INTERVAL_TURNS;
	}
}

async function ensureDecisionsDocument(path: string, deps: ScribeDeps): Promise<void> {
	try {
		const existing = await deps.readText(path);
		if (existing.trim()) return;
	} catch {
		// bootstrap missing file
	}

	await deps.appendText(path, DEFAULT_DECISIONS_DOCUMENT);
}

export function createScribeAgentEndHandler(deps: ScribeDeps) {
	let turnsSinceLastDecision = 0;
	let lastProcessedEntryId: string | undefined;
	let runsSkipped = 0;
	let runsExecuted = 0;
	let decisionsAppended = 0;
	let noDecisionRuns = 0;
	let failures = 0;
	let lastPersistedState = "";
	let isRunning = false;

	const updateFooter = (ctx: ExtensionContext, interval: number) => {
		if (!ctx.hasUI) return;
		const text = `Scribe ${turnsSinceLastDecision}/${interval} | run:${runsExecuted} log:${decisionsAppended} skip:${runsSkipped}`;
		ctx.ui.setStatus("scribe", `\x1b[90m${text}\x1b[0m`);
	};

	const persistState = (pi: ExtensionAPI) => {
		const state: ScribeState = {
			turnsSinceLastDecision,
			lastProcessedEntryId,
			runsSkipped,
			runsExecuted,
			decisionsAppended,
			noDecisionRuns,
			failures,
		};
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
			latest = entry.data as ScribeState;
		}
		if (!latest) return;
		turnsSinceLastDecision = latest.turnsSinceLastDecision;
		lastProcessedEntryId = latest.lastProcessedEntryId;
		runsSkipped = asNonNegativeInt(latest.runsSkipped);
		runsExecuted = asNonNegativeInt(latest.runsExecuted);
		decisionsAppended = asNonNegativeInt(latest.decisionsAppended);
		noDecisionRuns = asNonNegativeInt(latest.noDecisionRuns);
		failures = asNonNegativeInt(latest.failures);
		lastPersistedState = JSON.stringify(latest);
	};

	return {
		hydrateState,
		updateFooter,
		async onAgentEnd(pi: ExtensionAPI, ctx: ExtensionContext) {
			if (isRunning) return;
			isRunning = true;

			try {
				const interval = await readConfiguredDecisionIntervalTurns(ctx.cwd, deps);
				const turnProgress = nextTurnCounter(turnsSinceLastDecision, interval);
				turnsSinceLastDecision = turnProgress.turnsSinceLastDecision;
				updateFooter(ctx, interval);
				if (!turnProgress.shouldRun) {
					runsSkipped++;
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				runsExecuted++;
				persistState(pi);
				updateFooter(ctx, interval);
				if (ctx.hasUI) ctx.ui.notify("Scribe: logging decisions...", "info");

				const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
				const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
				await deps.ensureDir(dirname(decisionsPath));
				await ensureDecisionsDocument(decisionsPath, deps);

				const model = ctx.model;
				if (!model) {
					noDecisionRuns++;
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) {
					noDecisionRuns++;
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				const [promptTemplate, branch] = await Promise.all([
					deps.readText(promptPath),
					Promise.resolve(ctx.sessionManager.getBranch()),
				]);

				const turnEntries = extractTurnEntries(branch);
				const turnSelection = selectNewTurns(turnEntries, lastProcessedEntryId);
				lastProcessedEntryId = turnSelection.newLastProcessedEntryId;
				persistState(pi);

				const recentTurns = turnSelection.newTurns.map((turn) => turn.line).join("\n").trim();
				if (!recentTurns) {
					noDecisionRuns++;
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

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
					noDecisionRuns++;
					persistState(pi);
					updateFooter(ctx, interval);
					if (ctx.hasUI) ctx.ui.notify("Scribe: no decisions made", "success");
					return;
				}

				await deps.appendText(decisionsPath, `\n${text}\n`);
				decisionsAppended += countCandidateBlocks(text);
				persistState(pi);
				updateFooter(ctx, interval);
				if (ctx.hasUI) ctx.ui.notify("Scribe: decisions logged", "success");
			} catch (error) {
				failures++;
				persistState(pi);
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
		const interval = await readConfiguredDecisionIntervalTurns(ctx.cwd, defaultDeps);
		handler.updateFooter(ctx, interval);
	});

	pi.on("session_switch", async (_event, ctx) => {
		handler.hydrateState(ctx);
		const interval = await readConfiguredDecisionIntervalTurns(ctx.cwd, defaultDeps);
		handler.updateFooter(ctx, interval);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handler.onAgentEnd(pi, ctx);
	});
}
