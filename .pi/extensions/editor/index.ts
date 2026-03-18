import { complete } from "@mariozechner/pi-ai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
	buildEditorPrompt,
	buildPendingDecisionsDocument,
	computeEditorIntervalTurns,
	defaultConventionsDocument,
	extractResponseText,
	getCandidateBlocks,
	isEditorState,
	markCandidatesReviewed,
	nextTurnCounter,
	parseEditorConfig,
	simpleHash,
} from "./core.mjs";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const DEFAULT_EDITOR_RATE_MULTIPLIER = 3;
const CONFIG_PATH = [".pi", "extensions", "decision-pipeline.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const OUTPUT_PATH = ["docs", "conventions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "editor", "PROMPT.md"];
const CONVENTIONS_TEMPLATE_PATH = [".pi", "extensions", "editor", "CONVENTIONS_TEMPLATE.md"];
const EDITOR_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "editor-state";
const REQUIRED_CONVENTIONS_HEADINGS = ["# Conventions", "## Active Decisions"];
const DEFAULT_DECISIONS_DOCUMENT = "# Decision Log\n";

type EditorState = {
	turnsSinceLastEdit: number;
	lastProcessedDecisionsHash?: string;
	runsSkipped?: number;
	runsExecuted?: number;
	conventionsUpdates?: number;
	noChangeRuns?: number;
	invalidOutputSkips?: number;
	failures?: number;
};

type EditorDeps = {
	readText: (path: string) => Promise<string>;
	writeText: (path: string, text: string) => Promise<void>;
	ensureDir: (path: string) => Promise<void>;
	complete: typeof complete;
};

const defaultDeps: EditorDeps = {
	readText: (path) => readFile(path, "utf8"),
	writeText: (path, text) => writeFile(path, text, "utf8"),
	ensureDir: (path) => mkdir(path, { recursive: true }),
	complete,
};

const asNonNegativeInt = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;

const hasRequiredConventionsSections = (text: string): boolean =>
	REQUIRED_CONVENTIONS_HEADINGS.every((heading) => text.includes(heading));

async function readPipelineConfigText(cwd: string, readText: EditorDeps["readText"]): Promise<string> {
	return readText(join(cwd, ...CONFIG_PATH));
}

async function readConfiguredEditorIntervalTurns(cwd: string, deps: EditorDeps): Promise<number> {
	try {
		const configText = await readPipelineConfigText(cwd, deps.readText);
		return computeEditorIntervalTurns(parseEditorConfig(configText));
	} catch {
		return DEFAULT_DECISION_INTERVAL_TURNS * DEFAULT_EDITOR_RATE_MULTIPLIER;
	}
}

export function createEditorAgentEndHandler(deps: EditorDeps) {
	let turnsSinceLastEdit = 0;
	let lastProcessedDecisionsHash: string | undefined;
	let runsSkipped = 0;
	let runsExecuted = 0;
	let conventionsUpdates = 0;
	let noChangeRuns = 0;
	let invalidOutputSkips = 0;
	let failures = 0;
	let lastPersistedState = "";
	let isRunning = false;

	const updateFooter = (ctx: ExtensionContext, interval: number) => {
		if (!ctx.hasUI) return;
		const text = `Editor ${turnsSinceLastEdit}/${interval} | run:${runsExecuted} upd:${conventionsUpdates} skip:${runsSkipped}`;
		ctx.ui.setStatus("editor", `\x1b[90m${text}\x1b[0m`);
	};

	const persistState = (pi: ExtensionAPI) => {
		const state: EditorState = {
			turnsSinceLastEdit,
			lastProcessedDecisionsHash,
			runsSkipped,
			runsExecuted,
			conventionsUpdates,
			noChangeRuns,
			invalidOutputSkips,
			failures,
		};
		const serialized = JSON.stringify(state);
		if (serialized === lastPersistedState) return;
		pi.appendEntry(STATE_CUSTOM_TYPE, state);
		lastPersistedState = serialized;
	};

	const hydrateState = (ctx: ExtensionContext) => {
		let latest: EditorState | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== STATE_CUSTOM_TYPE) continue;
			if (!isEditorState(entry.data)) continue;
			latest = entry.data as EditorState;
		}
		if (!latest) return;
		turnsSinceLastEdit = latest.turnsSinceLastEdit;
		lastProcessedDecisionsHash = latest.lastProcessedDecisionsHash;
		runsSkipped = asNonNegativeInt(latest.runsSkipped);
		runsExecuted = asNonNegativeInt(latest.runsExecuted);
		conventionsUpdates = asNonNegativeInt(latest.conventionsUpdates);
		noChangeRuns = asNonNegativeInt(latest.noChangeRuns);
		invalidOutputSkips = asNonNegativeInt(latest.invalidOutputSkips);
		failures = asNonNegativeInt(latest.failures);
		lastPersistedState = JSON.stringify(latest);
	};

	const readCurrentConventions = async (cwd: string, outputPath: string): Promise<string> => {
		try {
			const existing = await deps.readText(outputPath);
			if (existing.trim()) return existing;
		} catch {
			// fallthrough
		}

		try {
			const template = await deps.readText(join(cwd, ...CONVENTIONS_TEMPLATE_PATH));
			if (template.trim()) return `${template.trim()}\n`;
		} catch {
			// fallthrough
		}

		return defaultConventionsDocument();
	};

	const readOrBootstrapDecisions = async (decisionsPath: string): Promise<string> => {
		try {
			const existing = await deps.readText(decisionsPath);
			if (existing.trim()) return existing;
		} catch {
			// bootstrap missing file
		}

		await deps.writeText(decisionsPath, DEFAULT_DECISIONS_DOCUMENT);
		return DEFAULT_DECISIONS_DOCUMENT;
	};

	return {
		hydrateState,
		updateFooter,
		async onAgentEnd(pi: ExtensionAPI, ctx: ExtensionContext) {
			if (isRunning) return;
			isRunning = true;

			try {
				const editorIntervalTurns = await readConfiguredEditorIntervalTurns(ctx.cwd, deps);
				const turnProgress = nextTurnCounter(turnsSinceLastEdit, editorIntervalTurns);
				turnsSinceLastEdit = turnProgress.turnsSinceLastEdit;
				updateFooter(ctx, editorIntervalTurns);
				if (!turnProgress.shouldRun) {
					runsSkipped++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					return;
				}

				runsExecuted++;
				persistState(pi);
				updateFooter(ctx, editorIntervalTurns);
				if (ctx.hasUI) ctx.ui.notify("Editor: consolidating decisions...", "info");

				const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
				const outputPath = join(ctx.cwd, ...OUTPUT_PATH);
				const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
				await deps.ensureDir(dirname(outputPath));

				const decisions = await readOrBootstrapDecisions(decisionsPath);
				if (!decisions.trim()) {
					noChangeRuns++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					return;
				}

				const decisionsHash = simpleHash(decisions);
				if (decisionsHash === lastProcessedDecisionsHash) {
					noChangeRuns++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					if (ctx.hasUI) ctx.ui.notify("Editor: no decision changes", "success");
					return;
				}

				const candidateBlocks = getCandidateBlocks(decisions);
				if (candidateBlocks.length === 0) {
					noChangeRuns++;
					lastProcessedDecisionsHash = decisionsHash;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					if (ctx.hasUI) ctx.ui.notify("Editor: no unreviewed decisions", "success");
					return;
				}

				const model = ctx.model;
				if (!model) {
					noChangeRuns++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					return;
				}
				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) {
					noChangeRuns++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					return;
				}

				const [currentConventions, promptTemplate] = await Promise.all([
					readCurrentConventions(ctx.cwd, outputPath),
					deps.readText(promptPath),
				]);
				const pendingDecisions = buildPendingDecisionsDocument(candidateBlocks);
				const prompt = buildEditorPrompt(promptTemplate, currentConventions, pendingDecisions);

				const response = await deps.complete(
					model,
					{
						systemPrompt: EDITOR_SYSTEM_PROMPT,
						messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
					},
					{ apiKey },
				);

				const text = extractResponseText(response.content);
				if (!text) {
					noChangeRuns++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					if (ctx.hasUI) ctx.ui.notify("Editor: no output", "success");
					return;
				}

				const normalizedOutput = `${text.trim()}\n`;
				if (!hasRequiredConventionsSections(normalizedOutput)) {
					invalidOutputSkips++;
					persistState(pi);
					updateFooter(ctx, editorIntervalTurns);
					if (ctx.hasUI) {
						ctx.ui.notify("Editor: skipped write (missing required conventions sections)", "warning");
					}
					return;
				}

				const reviewedDecisions = markCandidatesReviewed(decisions);
				await Promise.all([
					deps.writeText(outputPath, normalizedOutput),
					deps.writeText(decisionsPath, reviewedDecisions),
				]);
				conventionsUpdates++;
				lastProcessedDecisionsHash = simpleHash(reviewedDecisions);
				persistState(pi);
				updateFooter(ctx, editorIntervalTurns);
				if (ctx.hasUI) ctx.ui.notify("Editor: updated docs/conventions.md", "success");
			} catch (error) {
				failures++;
				persistState(pi);
				if (ctx.hasUI) {
					ctx.ui.notify(`Editor failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
				}
			} finally {
				isRunning = false;
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	const handler = createEditorAgentEndHandler(defaultDeps);

	pi.on("session_start", async (_event, ctx) => {
		handler.hydrateState(ctx);
		const interval = await readConfiguredEditorIntervalTurns(ctx.cwd, defaultDeps);
		handler.updateFooter(ctx, interval);
	});

	pi.on("session_switch", async (_event, ctx) => {
		handler.hydrateState(ctx);
		const interval = await readConfiguredEditorIntervalTurns(ctx.cwd, defaultDeps);
		handler.updateFooter(ctx, interval);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handler.onAgentEnd(pi, ctx);
	});
}
