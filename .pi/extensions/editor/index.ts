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
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const OUTPUT_PATH = ["docs", "conventions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "editor", "PROMPT.md"];
const CONVENTIONS_TEMPLATE_PATH = [".pi", "extensions", "editor", "CONVENTIONS_TEMPLATE.md"];
const EDITOR_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "editor-state";

type EditorState = {
	turnsSinceLastEdit: number;
	lastProcessedDecisionsHash?: string;
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

export function createEditorAgentEndHandler(deps: EditorDeps) {
	let turnsSinceLastEdit = 0;
	let lastProcessedDecisionsHash: string | undefined;
	let lastPersistedState = "";
	let isRunning = false;

	const persistState = (pi: ExtensionAPI) => {
		const state: EditorState = { turnsSinceLastEdit, lastProcessedDecisionsHash };
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
			latest = entry.data;
		}
		if (!latest) return;
		turnsSinceLastEdit = latest.turnsSinceLastEdit;
		lastProcessedDecisionsHash = latest.lastProcessedDecisionsHash;
		lastPersistedState = JSON.stringify(latest);
	};

	const readEditorIntervalTurns = async (cwd: string): Promise<number> => {
		try {
			const configText = await deps.readText(join(cwd, ...CONFIG_PATH));
			return computeEditorIntervalTurns(parseEditorConfig(configText));
		} catch {
			return DEFAULT_DECISION_INTERVAL_TURNS * DEFAULT_EDITOR_RATE_MULTIPLIER;
		}
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

	return {
		hydrateState,
		async onAgentEnd(pi: ExtensionAPI, ctx: ExtensionContext) {
			if (isRunning) return;
			isRunning = true;

			try {
				const editorIntervalTurns = await readEditorIntervalTurns(ctx.cwd);
				const turnProgress = nextTurnCounter(turnsSinceLastEdit, editorIntervalTurns);
				turnsSinceLastEdit = turnProgress.turnsSinceLastEdit;
				if (!turnProgress.shouldRun) {
					persistState(pi);
					return;
				}

				persistState(pi);
				if (ctx.hasUI) ctx.ui.notify("Editor: consolidating decisions...", "info");

				const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
				const outputPath = join(ctx.cwd, ...OUTPUT_PATH);
				const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
				await deps.ensureDir(dirname(outputPath));

				const decisions = await deps.readText(decisionsPath);
				if (!decisions.trim()) return;

				const decisionsHash = simpleHash(decisions);
				if (decisionsHash === lastProcessedDecisionsHash) {
					if (ctx.hasUI) ctx.ui.notify("Editor: no decision changes", "success");
					return;
				}

				const candidateBlocks = getCandidateBlocks(decisions);
				if (candidateBlocks.length === 0) {
					lastProcessedDecisionsHash = decisionsHash;
					persistState(pi);
					if (ctx.hasUI) ctx.ui.notify("Editor: no unreviewed decisions", "success");
					return;
				}

				const model = ctx.model;
				if (!model) return;
				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) return;

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
					if (ctx.hasUI) ctx.ui.notify("Editor: no output", "success");
					return;
				}

				const reviewedDecisions = markCandidatesReviewed(decisions);
				await Promise.all([
					deps.writeText(outputPath, `${text.trim()}\n`),
					deps.writeText(decisionsPath, reviewedDecisions),
				]);
				lastProcessedDecisionsHash = simpleHash(reviewedDecisions);
				persistState(pi);
				if (ctx.hasUI) ctx.ui.notify("Editor: updated docs/conventions.md", "success");
			} catch (error) {
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
	});

	pi.on("session_switch", async (_event, ctx) => {
		handler.hydrateState(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await handler.onAgentEnd(pi, ctx);
	});
}
