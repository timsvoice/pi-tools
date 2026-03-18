import { complete } from "@mariozechner/pi-ai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const DEFAULT_EDITOR_RATE_MULTIPLIER = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const OUTPUT_PATH = ["docs", "conventions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "editor", "PROMPT.md"];
const CONVENTIONS_TEMPLATE_PATH = [".pi", "extensions", "editor", "CONVENTIONS_TEMPLATE.md"];
const EDITOR_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";
const STATE_CUSTOM_TYPE = "editor-state";

type EditorConfig = {
	decisionIntervalTurns: number;
	editorRateMultiplier: number;
};

type EditorState = {
	turnsSinceLastEdit: number;
	lastProcessedDecisionsHash?: string;
};

async function getEditorConfig(cwd: string): Promise<EditorConfig> {
	try {
		const configPath = join(cwd, ...CONFIG_PATH);
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as { decisionIntervalTurns?: unknown; editorRateMultiplier?: unknown };

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
	} catch {
		return {
			decisionIntervalTurns: DEFAULT_DECISION_INTERVAL_TURNS,
			editorRateMultiplier: DEFAULT_EDITOR_RATE_MULTIPLIER,
		};
	}
}

function simpleHash(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash << 5) - hash + text.charCodeAt(i);
		hash |= 0;
	}
	return `${text.length}:${hash}`;
}

function extractResponseText(responseContent: Array<{ type: string; text?: string }>): string {
	return responseContent
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

function getCandidateBlocks(decisions: string): string[] {
	return decisions
		.split(/\n(?=### )/)
		.map((block) => block.trim())
		.filter((block) => block.startsWith("### [CANDIDATE]"));
}

function markCandidatesReviewed(decisions: string): string {
	return decisions.replace(/^### \[CANDIDATE\]/gm, "### [REVIEWED]");
}

function isEditorState(value: unknown): value is EditorState {
	if (!value || typeof value !== "object") return false;
	const turns = (value as { turnsSinceLastEdit?: unknown }).turnsSinceLastEdit;
	const hash = (value as { lastProcessedDecisionsHash?: unknown }).lastProcessedDecisionsHash;
	if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0) return false;
	if (hash !== undefined && typeof hash !== "string") return false;
	return true;
}

async function readCurrentConventions(cwd: string, outputPath: string): Promise<string> {
	try {
		const existing = await readFile(outputPath, "utf8");
		if (existing.trim()) return existing;
	} catch {
		// fall through to template/default
	}

	const templatePath = join(cwd, ...CONVENTIONS_TEMPLATE_PATH);
	try {
		const template = await readFile(templatePath, "utf8");
		if (template.trim()) return `${template.trim()}\n`;
	} catch {
		// fall through to default
	}

	return "# Conventions\n\n## Conflicts Requiring Review\nNone.\n\n## Active Decisions\n\n## Superseded Decisions\nNone.\n";
}

export default function (pi: ExtensionAPI) {
	let turnsSinceLastEdit = 0;
	let lastProcessedDecisionsHash: string | undefined;
	let lastPersistedState = "";
	let isRunning = false;

	const persistState = () => {
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

	pi.on("session_start", async (_event, ctx) => {
		hydrateState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		hydrateState(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (isRunning) return;
		isRunning = true;

		try {
			const config = await getEditorConfig(ctx.cwd);
			const editorIntervalTurns = config.decisionIntervalTurns * config.editorRateMultiplier;

			turnsSinceLastEdit += 1;
			if (turnsSinceLastEdit < editorIntervalTurns) {
				persistState();
				return;
			}

			turnsSinceLastEdit = 0;
			persistState();
			if (ctx.hasUI) ctx.ui.notify("Editor: consolidating decisions...", "info");

			const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
			const outputPath = join(ctx.cwd, ...OUTPUT_PATH);
			const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
			await mkdir(dirname(outputPath), { recursive: true });

			const decisions = await readFile(decisionsPath, "utf8");
			if (!decisions.trim()) return;

			const decisionsHash = simpleHash(decisions);
			if (decisionsHash === lastProcessedDecisionsHash) {
				if (ctx.hasUI) ctx.ui.notify("Editor: no decision changes", "success");
				return;
			}

			const candidateBlocks = getCandidateBlocks(decisions);
			if (candidateBlocks.length === 0) {
				lastProcessedDecisionsHash = decisionsHash;
				persistState();
				if (ctx.hasUI) ctx.ui.notify("Editor: no unreviewed decisions", "success");
				return;
			}

			const model = ctx.model;
			if (!model) return;

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) return;

			const currentConventions = await readCurrentConventions(ctx.cwd, outputPath);
			const pendingDecisions = ["# Decision Log", "", ...candidateBlocks].join("\n");
			const promptTemplate = await readFile(promptPath, "utf8");
			const prompt = promptTemplate
				.replace("{currentConventions}", currentConventions)
				.replace("{newCandidates}", pendingDecisions);

			const response = await complete(
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

			await writeFile(outputPath, `${text.trim()}\n`, "utf8");
			const reviewedDecisions = markCandidatesReviewed(decisions);
			await writeFile(decisionsPath, reviewedDecisions, "utf8");
			lastProcessedDecisionsHash = simpleHash(reviewedDecisions);
			persistState();
			if (ctx.hasUI) ctx.ui.notify("Editor: updated docs/conventions.md", "success");
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Editor failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		} finally {
			isRunning = false;
		}
	});
}
