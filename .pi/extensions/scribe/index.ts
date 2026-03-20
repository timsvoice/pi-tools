import { complete } from "@mariozechner/pi-ai";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { createPromptPipeline } from "./pipeline";

import {
	buildEditorPrompt,
	buildPendingDecisionsDocument,
	buildScribePrompt,
	computeEditorIntervalTurns,
	defaultConventionsDocument,
	extractResponseText,
	extractTurnEntries,
	getCandidateBlocks,
	isEditorState,
	isScribeState,
	keepCandidateBlocks,
	markCandidatesReviewed,
	parseDecisionIntervalTurns,
	parseEditorConfig,
	selectNewTurns,
	simpleHash,
} from "./core.mjs";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const DEFAULT_EDITOR_RATE_MULTIPLIER = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const OUTPUT_PATH = ["docs", "conventions.md"];
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIBE_PROMPT_PATH = [join(EXTENSION_DIR, "prompts", "scribe.md")];
const EDITOR_PROMPT_PATH = [join(EXTENSION_DIR, "prompts", "editor.md")];
const EDITOR_TEMPLATE_PATH = [join(EXTENSION_DIR, "prompts", "editor-conventions-template.md")];
const SCRIBE_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const EDITOR_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const SCRIBE_STATE_CUSTOM_TYPE = "scribe-state";
const EDITOR_STATE_CUSTOM_TYPE = "editor-state";
const DEFAULT_DECISIONS_DOCUMENT = "# Decision Log\n";
const REQUIRED_CONVENTIONS_HEADINGS = ["# Conventions", "## Active Decisions"];

export type ScribeState = {
	turnsSinceLastDecision: number;
	lastProcessedEntryId?: string;
	runsSkipped?: number;
	runsExecuted?: number;
	decisionsAppended?: number;
	noDecisionRuns?: number;
	failures?: number;
};

export type EditorState = {
	turnsSinceLastEdit: number;
	lastProcessedDecisionsHash?: string;
	runsSkipped?: number;
	runsExecuted?: number;
	conventionsUpdates?: number;
	noChangeRuns?: number;
	invalidOutputSkips?: number;
	failures?: number;
};

export type ScribeDeps = {
	readText: (path: string) => Promise<string>;
	appendText: (path: string, text: string) => Promise<void>;
	ensureDir: (path: string) => Promise<void>;
	complete: typeof complete;
};

export type EditorDeps = {
	readText: (path: string) => Promise<string>;
	writeText: (path: string, text: string) => Promise<void>;
	ensureDir: (path: string) => Promise<void>;
	complete: typeof complete;
};

const defaultScribeDeps: ScribeDeps = {
	readText: (path) => readFile(path, "utf8"),
	appendText: (path, text) => appendFile(path, text, "utf8"),
	ensureDir: (path) => mkdir(path, { recursive: true }),
	complete,
};

const defaultEditorDeps: EditorDeps = {
	readText: (path) => readFile(path, "utf8"),
	writeText: (path, text) => writeFile(path, text, "utf8"),
	ensureDir: (path) => mkdir(path, { recursive: true }),
	complete,
};

const asNonNegativeInt = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;

const countCandidateBlocks = (markdown: string): number => (markdown.match(/^### \[CANDIDATE\]/gm) ?? []).length;

const buildScribeState = (overrides?: Partial<ScribeState>): ScribeState => ({
	turnsSinceLastDecision: 0,
	runsSkipped: 0,
	runsExecuted: 0,
	decisionsAppended: 0,
	noDecisionRuns: 0,
	failures: 0,
	...overrides,
});

const buildEditorState = (overrides?: Partial<EditorState>): EditorState => ({
	turnsSinceLastEdit: 0,
	runsSkipped: 0,
	runsExecuted: 0,
	conventionsUpdates: 0,
	noChangeRuns: 0,
	invalidOutputSkips: 0,
	failures: 0,
	...overrides,
});

const normalizeScribeState = (state: ScribeState): ScribeState => ({
	turnsSinceLastDecision: asNonNegativeInt(state.turnsSinceLastDecision),
	lastProcessedEntryId: typeof state.lastProcessedEntryId === "string" ? state.lastProcessedEntryId : undefined,
	runsSkipped: asNonNegativeInt(state.runsSkipped),
	runsExecuted: asNonNegativeInt(state.runsExecuted),
	decisionsAppended: asNonNegativeInt(state.decisionsAppended),
	noDecisionRuns: asNonNegativeInt(state.noDecisionRuns),
	failures: asNonNegativeInt(state.failures),
});

const normalizeEditorState = (state: EditorState): EditorState => ({
	turnsSinceLastEdit: asNonNegativeInt(state.turnsSinceLastEdit),
	lastProcessedDecisionsHash:
		typeof state.lastProcessedDecisionsHash === "string" ? state.lastProcessedDecisionsHash : undefined,
	runsSkipped: asNonNegativeInt(state.runsSkipped),
	runsExecuted: asNonNegativeInt(state.runsExecuted),
	conventionsUpdates: asNonNegativeInt(state.conventionsUpdates),
	noChangeRuns: asNonNegativeInt(state.noChangeRuns),
	invalidOutputSkips: asNonNegativeInt(state.invalidOutputSkips),
	failures: asNonNegativeInt(state.failures),
});

const hasRequiredConventionsSections = (text: string): boolean =>
	REQUIRED_CONVENTIONS_HEADINGS.every((heading) => text.includes(heading));

async function readPipelineConfigText(cwd: string, readText: ScribeDeps["readText"]): Promise<string> {
	return readText(join(cwd, ...CONFIG_PATH));
}

export async function readConfiguredDecisionIntervalTurns(cwd: string, deps: ScribeDeps): Promise<number> {
	try {
		const configText = await readPipelineConfigText(cwd, deps.readText);
		return parseDecisionIntervalTurns(configText, DEFAULT_DECISION_INTERVAL_TURNS);
	} catch {
		return DEFAULT_DECISION_INTERVAL_TURNS;
	}
}

export async function readConfiguredEditorIntervalTurns(cwd: string, deps: EditorDeps): Promise<number> {
	try {
		const configText = await readPipelineConfigText(cwd, deps.readText);
		return computeEditorIntervalTurns(parseEditorConfig(configText));
	} catch {
		return DEFAULT_DECISION_INTERVAL_TURNS * DEFAULT_EDITOR_RATE_MULTIPLIER;
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

const readCurrentConventions = async (cwd: string, outputPath: string, deps: EditorDeps): Promise<string> => {
	try {
		const existing = await deps.readText(outputPath);
		if (existing.trim()) return existing;
	} catch {
		// fallthrough
	}

	try {
		const template = await deps.readText(join(cwd, ...EDITOR_TEMPLATE_PATH));
		if (template.trim()) return `${template.trim()}\n`;
	} catch {
		// fallthrough
	}

	return defaultConventionsDocument();
};

const readOrBootstrapDecisions = async (decisionsPath: string, deps: EditorDeps): Promise<string> => {
	try {
		const existing = await deps.readText(decisionsPath);
		if (existing.trim()) return existing;
	} catch {
		// bootstrap missing file
	}

	await deps.writeText(decisionsPath, DEFAULT_DECISIONS_DOCUMENT);
	return DEFAULT_DECISIONS_DOCUMENT;
};

export function createScribeAgentEndHandler(deps: ScribeDeps) {
	return createPromptPipeline<ScribeState, { decisionsPath: string }>({
		name: "Scribe",
		stateCustomType: SCRIBE_STATE_CUSTOM_TYPE,
		deps,
		systemPrompt: SCRIBE_SYSTEM_PROMPT,
		promptPathSegments: SCRIBE_PROMPT_PATH,
		getInterval: (ctx, pipelineDeps) => readConfiguredDecisionIntervalTurns(ctx.cwd, pipelineDeps as ScribeDeps),
		getTurns: (state) => state.turnsSinceLastDecision,
		setTurns: (state, value) => {
			state.turnsSinceLastDecision = value;
		},
		incrementRunsSkipped: (state) => {
			state.runsSkipped = asNonNegativeInt(state.runsSkipped) + 1;
		},
		incrementRunsExecuted: (state) => {
			state.runsExecuted = asNonNegativeInt(state.runsExecuted) + 1;
		},
		incrementOutputsApplied: (state, count) => {
			state.decisionsAppended = asNonNegativeInt(state.decisionsAppended) + count;
		},
		incrementNoOutputRuns: (state) => {
			state.noDecisionRuns = asNonNegativeInt(state.noDecisionRuns) + 1;
		},
		incrementFailures: (state) => {
			state.failures = asNonNegativeInt(state.failures) + 1;
		},
		updateFooter: (ctx, interval, state) => {
			if (!ctx.hasUI) return;
			const text = `Scribe ${state.turnsSinceLastDecision}/${interval} | run:${state.runsExecuted ?? 0} log:${
				state.decisionsAppended ?? 0
			} skip:${state.runsSkipped ?? 0}`;
			ctx.ui.setStatus("scribe", `\x1b[90m${text}\x1b[0m`);
		},
		initState: () => buildScribeState(),
		isState: isScribeState,
		normalizeState: (state) => normalizeScribeState(state),
		extractResponseText,
		prepare: async (ctx, pipelineDeps, state, promptTemplate) => {
			const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
			await pipelineDeps.ensureDir(dirname(decisionsPath));
			await ensureDecisionsDocument(decisionsPath, pipelineDeps as ScribeDeps);

			const branch = ctx.sessionManager.getBranch();
			const turnEntries = extractTurnEntries(branch);
			const turnSelection = selectNewTurns(turnEntries, state.lastProcessedEntryId);
			state.lastProcessedEntryId = turnSelection.newLastProcessedEntryId;

			const recentTurns = turnSelection.newTurns.map((turn) => turn.line).join("\n").trim();
			if (!recentTurns) {
				return { prompt: null, context: { decisionsPath } };
			}

			const prompt = buildScribePrompt(promptTemplate, recentTurns);
			return { prompt, context: { decisionsPath } };
		},
		apply: async (_ctx, pipelineDeps, _state, responseText, context) => {
			const decisionsPath = context?.decisionsPath;
			if (!decisionsPath) return { noOutput: true };
			const text = keepCandidateBlocks(responseText);
			if (!text) return { noOutput: true };
			await (pipelineDeps.appendText?.(decisionsPath, `\n${text}\n`) ?? Promise.resolve());
			return { appliedCount: countCandidateBlocks(text) };
		},
		notifications: {
			start: "Scribe: logging decisions...",
			success: "Scribe: decisions logged",
			noOutput: "Scribe: no decisions made",
			failurePrefix: "Scribe failed:",
		},
	});
}

export function createEditorAgentEndHandler(deps: EditorDeps) {
	return createPromptPipeline<EditorState, {
		decisions: string;
		decisionsPath: string;
		outputPath: string;
	}>({
		name: "Editor",
		stateCustomType: EDITOR_STATE_CUSTOM_TYPE,
		deps,
		systemPrompt: EDITOR_SYSTEM_PROMPT,
		promptPathSegments: EDITOR_PROMPT_PATH,
		getInterval: (ctx, pipelineDeps) => readConfiguredEditorIntervalTurns(ctx.cwd, pipelineDeps as EditorDeps),
		getTurns: (state) => state.turnsSinceLastEdit,
		setTurns: (state, value) => {
			state.turnsSinceLastEdit = value;
		},
		incrementRunsSkipped: (state) => {
			state.runsSkipped = asNonNegativeInt(state.runsSkipped) + 1;
		},
		incrementRunsExecuted: (state) => {
			state.runsExecuted = asNonNegativeInt(state.runsExecuted) + 1;
		},
		incrementOutputsApplied: (state, count) => {
			state.conventionsUpdates = asNonNegativeInt(state.conventionsUpdates) + count;
		},
		incrementNoOutputRuns: (state) => {
			state.noChangeRuns = asNonNegativeInt(state.noChangeRuns) + 1;
		},
		incrementFailures: (state) => {
			state.failures = asNonNegativeInt(state.failures) + 1;
		},
		incrementInvalidOutputSkips: (state) => {
			state.invalidOutputSkips = asNonNegativeInt(state.invalidOutputSkips) + 1;
		},
		updateFooter: (ctx, interval, state) => {
			if (!ctx.hasUI) return;
			const text = `Editor ${state.turnsSinceLastEdit}/${interval} | run:${state.runsExecuted ?? 0} upd:${
				state.conventionsUpdates ?? 0
			} skip:${state.runsSkipped ?? 0}`;
			ctx.ui.setStatus("editor", `\x1b[90m${text}\x1b[0m`);
		},
		initState: () => buildEditorState(),
		isState: isEditorState,
		normalizeState: (state) => normalizeEditorState(state),
		extractResponseText,
		prepare: async (ctx, pipelineDeps, state, promptTemplate) => {
			const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
			const outputPath = join(ctx.cwd, ...OUTPUT_PATH);
			await pipelineDeps.ensureDir(dirname(outputPath));

			const decisions = await readOrBootstrapDecisions(decisionsPath, pipelineDeps as EditorDeps);
			if (!decisions.trim()) {
				return {
					prompt: null,
					context: { decisions, decisionsPath, outputPath },
					noOutputMessage: "Editor: no decision changes",
				};
			}

			const decisionsHash = simpleHash(decisions);
			if (decisionsHash === state.lastProcessedDecisionsHash) {
				return {
					prompt: null,
					context: { decisions, decisionsPath, outputPath },
					noOutputMessage: "Editor: no decision changes",
				};
			}

			const candidateBlocks = getCandidateBlocks(decisions);
			if (candidateBlocks.length === 0) {
				state.lastProcessedDecisionsHash = decisionsHash;
				return {
					prompt: null,
					context: { decisions, decisionsPath, outputPath },
					noOutputMessage: "Editor: no unreviewed decisions",
				};
			}

			const currentConventions = await readCurrentConventions(ctx.cwd, outputPath, pipelineDeps as EditorDeps);
			const pendingDecisions = buildPendingDecisionsDocument(candidateBlocks);
			const prompt = buildEditorPrompt(promptTemplate, currentConventions, pendingDecisions);
			return { prompt, context: { decisions, decisionsPath, outputPath } };
		},
		apply: async (_ctx, pipelineDeps, state, responseText, context) => {
			if (!context) return { noOutput: true };
			const normalizedOutput = `${responseText.trim()}\n`;
			if (!normalizedOutput.trim()) return { noOutput: true };
			if (!hasRequiredConventionsSections(normalizedOutput)) {
				return { invalidOutput: true };
			}

			const reviewedDecisions = markCandidatesReviewed(context.decisions);
			await Promise.all([
				pipelineDeps.writeText?.(context.outputPath, normalizedOutput),
				pipelineDeps.writeText?.(context.decisionsPath, reviewedDecisions),
			]);
			state.lastProcessedDecisionsHash = simpleHash(reviewedDecisions);
			return { appliedCount: 1 };
		},
		notifications: {
			start: "Editor: consolidating decisions...",
			success: "Editor: updated docs/conventions.md",
			noOutput: "Editor: no decision changes",
			invalidOutput: "Editor: skipped write (missing required conventions sections)",
			failurePrefix: "Editor failed:",
		},
	});
}

export default function (pi: ExtensionAPI) {
	const scribeHandler = createScribeAgentEndHandler(defaultScribeDeps);
	const editorHandler = createEditorAgentEndHandler(defaultEditorDeps);

	const updateFooters = async (ctx: ExtensionContext) => {
		const [scribeInterval, editorInterval] = await Promise.all([
			readConfiguredDecisionIntervalTurns(ctx.cwd, defaultScribeDeps),
			readConfiguredEditorIntervalTurns(ctx.cwd, defaultEditorDeps),
		]);
		scribeHandler.updateFooter(ctx, scribeInterval);
		editorHandler.updateFooter(ctx, editorInterval);
	};

	pi.on("session_start", async (_event, ctx) => {
		scribeHandler.hydrateState(ctx);
		editorHandler.hydrateState(ctx);
		await updateFooters(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		scribeHandler.hydrateState(ctx);
		editorHandler.hydrateState(ctx);
		await updateFooters(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await scribeHandler.onAgentEnd(pi, ctx);
		await editorHandler.onAgentEnd(pi, ctx);
	});
}
