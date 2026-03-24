import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Message, complete } from "@mariozechner/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const SCRIBE_INTERVAL_TURNS = 1;
const EDITOR_INTERVAL_TURNS = 3;

const baseDir = dirname(fileURLToPath(import.meta.url));

type AgentMessage = { role?: string; content?: unknown };

export type PromptExecutor = (
	prompt: string,
	ctx: ExtensionContext,
	options?: { completeFn?: typeof complete },
) => Promise<string>;

export const fillPromptTemplate = (template: string, replacements: Record<string, string>) => {
	for (const key of Object.keys(replacements)) {
		if (!template.includes(`{{${key}}}`)) {
			throw new Error(`Prompt template missing required placeholder: ${key}.`);
		}
	}

	let filled = template;
	for (const [key, value] of Object.entries(replacements)) {
		filled = filled.replaceAll(`{{${key}}}`, value);
	}

	for (const key of Object.keys(replacements)) {
		if (filled.includes(`{{${key}}}`)) {
			throw new Error(`Prompt template has unresolved placeholder: ${key}.`);
		}
	}

	return filled;
};

const getPrompt = async (path: string, replacements: Record<string, string>) => {
	const template = await readFile(path, "utf-8");
	return fillPromptTemplate(template, replacements);
};

const writeToFile = async (path: string, content: string) => {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	await writeFile(path, content, "utf-8");
};

const getDecisionsPath = (ctx: ExtensionContext) => resolve(ctx.cwd, ".scribe", "DECISIONS.md");

const getConventionsPath = (ctx: ExtensionContext) => resolve(ctx.cwd, ".scribe", "CONVENTIONS.md");

export const executePrompt: PromptExecutor = async (
	prompt: string,
	ctx: ExtensionContext,
	options?: { completeFn?: typeof complete },
) => {
	const model = ctx.model;
	if (!model) {
		throw new Error(
			"Scribe extension failed to execute prompt: no active model. Fix: select a model with /model.",
		);
	}

	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!apiKey) {
		throw new Error(
			`Scribe extension failed to execute prompt: missing API key for ${model.provider}/${model.id}. Fix: configure the provider key in settings or run /login.`,
		);
	}

	const messages: Message[] = [
		{
			role: "user",
			content: [{ type: "text", text: prompt }],
			timestamp: Date.now(),
		},
	];

	const completeFn = options?.completeFn ?? complete;

	const response = await completeFn(
		model,
		{ systemPrompt: "Follow the user's instructions.", messages },
		{ apiKey },
	);

	const output = response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();

	return output;
};

export const selectRecentMessages = (
	entries: Array<{ type: string; message?: AgentMessage }>,
	windowTurns: number,
): AgentMessage[] => {
	const recentMessages: AgentMessage[] = [];
	// Buffer assistant replies until we confirm the associated user turn is within the window.
	const pendingAssistants: AgentMessage[] = [];
	let userTurns = 0;

	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.type !== "message") {
			continue;
		}

		const message = entry.message as AgentMessage;
		if (!message || (message.role !== "user" && message.role !== "assistant")) {
			continue;
		}

		if (message.role === "assistant") {
			pendingAssistants.push(message);
			continue;
		}

		if (userTurns + 1 > windowTurns) {
			break;
		}

		for (const assistant of pendingAssistants) {
			recentMessages.unshift(assistant);
		}
		pendingAssistants.length = 0;
		userTurns += 1;
		recentMessages.unshift(message);
	}

	return recentMessages;
};

const formatRecentTurns = (recentMessages: AgentMessage[]) =>
	recentMessages
		.map((message) => {
			const role = message.role === "user" ? "User" : "Assistant";
			const content = message.content;
			if (typeof content === "string") {
				return `${role}: ${content.trim()}`;
			}
			if (!Array.isArray(content)) {
				return `${role}:`;
			}
			const textParts = content
				.filter((block) => block && typeof block === "object" && "type" in block)
				.filter((block) => (block as { type?: string }).type === "text")
				.map((block) => (block as { text?: string }).text ?? "")
				.filter((text) => text.trim().length > 0);
			return textParts.length > 0 ? `${role}: ${textParts.join("\n")}` : `${role}:`;
		})
		.filter((line) => line.trim().length > 0)
		.join("\n\n");

const enforceOutputLimit = (output: string, label: string): string => {
	const truncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	if (truncation.truncated) {
		const limit = `${formatSize(truncation.maxBytes)} or ${truncation.maxLines} lines`;
		const observed = `${formatSize(truncation.totalBytes)}, ${truncation.totalLines} lines`;
		throw new Error(
			`Scribe extension failed to process ${label} output: output exceeded ${limit} (${observed}). Fix: tighten the ${label} prompt or reduce content volume.`,
		);
	}

	return truncation.content;
};

const reportError = (ctx: ExtensionContext, scope: string, error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Scribe extension ${scope} failed: ${message}`);
	if (ctx.hasUI) {
		ctx.ui.notify(`Scribe extension ${scope} failed: ${message}`, "error");
		ctx.ui.setWorkingMessage(`Scribe error: ${message}`);
	}
};

const withTimeout = async <T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> => {
	if (!timeoutMs || timeoutMs <= 0) {
		return promise;
	}

	let timeoutId: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(
				new Error(
					`Scribe extension ${label} timed out after ${timeoutMs}ms. Fix: increase timeout or reduce model latency.`,
				),
			);
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
};

const formatFooterText = (ctx: ExtensionContext, text: string) =>
	ctx.ui.theme ? ctx.ui.theme.fg("dim", text) : text;

const formatTimestamp = (timestamp: number) => {
	const date = new Date(timestamp);
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	return `${hours}:${minutes}`;
};

const updateCounters = (ctx: ExtensionContext, turnCount: number) => {
	if (!ctx.hasUI) {
		return;
	}
	const scribeStep = turnCount % SCRIBE_INTERVAL_TURNS || SCRIBE_INTERVAL_TURNS;
	const editorStep = turnCount % EDITOR_INTERVAL_TURNS || EDITOR_INTERVAL_TURNS;
	ctx.ui.setStatus(
		"scribe-count",
		formatFooterText(ctx, `Scribe ${scribeStep}/${SCRIBE_INTERVAL_TURNS}`),
	);
	ctx.ui.setStatus(
		"editor-count",
		formatFooterText(ctx, `Editor ${editorStep}/${EDITOR_INTERVAL_TURNS}`),
	);
};

const updateWorkingMessage = (
	ctx: ExtensionContext,
	options: { scribeRunning: boolean; editorRunning: boolean },
) => {
	if (!ctx.hasUI) {
		return;
	}
	if (options.editorRunning) {
		ctx.ui.setWorkingMessage("Editorializing...");
		return;
	}
	if (options.scribeRunning) {
		ctx.ui.setWorkingMessage("Scribing...");
		return;
	}
	ctx.ui.setWorkingMessage();
};

const setLastRunStatus = (
	ctx: ExtensionContext,
	kind: "scribe" | "editor",
	status: "success" | "failure",
	timestamp: number,
) => {
	if (!ctx.hasUI) {
		return;
	}
	const label = kind === "scribe" ? "| Scribe" : "Editor";
	const symbol = status === "success" ? "✓" : "✗";
	ctx.ui.setStatus(
		`${kind}-last`,
		formatFooterText(ctx, `${label} ${symbol} ${formatTimestamp(timestamp)}`),
	);
};

type DecisionOutput = {
	status: "decision" | "no_decision";
	title: string;
	type: string;
	decision: string;
	why: string;
	impact: string;
	invalidation: string;
};

const DECISION_FIELDS: Array<Exclude<keyof DecisionOutput, "status">> = [
	"title",
	"type",
	"decision",
	"why",
	"impact",
	"invalidation",
];

const parseDecisionPayload = (output: string): Record<string, unknown> => {
	const trimmed = output.trim();
	if (!trimmed) {
		throw new Error(
			"Scribe extension failed to parse decision output: empty output. Fix: ensure the model returns JSON for decision capture.",
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Scribe extension failed to parse decision output: invalid JSON (${message}). Fix: ensure the scribe prompt returns a single JSON object.`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			"Scribe extension failed to parse decision output: JSON must be an object. Fix: ensure the scribe prompt returns a single JSON object.",
		);
	}

	return parsed as Record<string, unknown>;
};

const parseDecisionStatus = (payload: Record<string, unknown>): DecisionOutput["status"] => {
	const status = payload.status;
	if (typeof status !== "string") {
		throw new Error(
			"Scribe extension failed to parse decision output: missing status. Fix: ensure status is a string.",
		);
	}
	if (status !== "decision" && status !== "no_decision") {
		throw new Error(
			'Scribe extension failed to parse decision output: invalid status. Fix: ensure status is "decision" or "no_decision".',
		);
	}
	return status;
};

const parseDecisionOutput = (output: string): DecisionOutput => {
	const payload = parseDecisionPayload(output);
	const status = parseDecisionStatus(payload);
	const decision: DecisionOutput = {
		status,
		title: "",
		type: "",
		decision: "",
		why: "",
		impact: "",
		invalidation: "",
	};

	for (const field of DECISION_FIELDS) {
		const value = payload[field];
		if (typeof value === "string") {
			decision[field] = value;
		}
	}

	return decision;
};

const formatDecisionTemplate = (decision: DecisionOutput): string =>
	[
		`## ${decision.title}`,
		"",
		`- Status: ${decision.status}`,
		`- Title: ${decision.title}`,
		`- Type: ${decision.type}`,
		`- Decision: ${decision.decision}`,
		`- Why: ${decision.why}`,
		`- Impact: ${decision.impact}`,
		`- Invalidation: ${decision.invalidation}`,
		"",
	].join("\n");

export const buildDecisionsContent = (existing: string, output: string): string | null => {
	const parsed = parseDecisionOutput(output);
	if (parsed.status === "no_decision") {
		return null;
	}

	const trimmedExisting = existing.trim();
	const header = trimmedExisting.length === 0 ? "# Decisions\n\n" : `${trimmedExisting}\n\n`;
	return `${header}${formatDecisionTemplate(parsed)}`;
};

export const buildConventionsContent = (output: string): string | null => {
	const trimmedOutput = output.trim();
	if (!trimmedOutput) {
		return null;
	}
	return `${trimmedOutput}\n`;
};

const resolveMutationQueue = (
	options: { queue?: (path: string, fn: () => Promise<void>) => Promise<void> } | undefined,
	label: string,
) => {
	const queue = options?.queue ?? withFileMutationQueue;
	if (typeof queue !== "function") {
		throw new Error(
			`Scribe extension failed to write ${label}: file mutation queue unavailable. Fix: upgrade @mariozechner/pi-coding-agent to >= 0.61.0 or remove the custom queue override.`,
		);
	}
	return queue;
};

export const execScribe = async (
	promptPath: string,
	ctx: ExtensionContext,
	windowTurns: number,
	promptExecutor: PromptExecutor = executePrompt,
	options?: { queue?: (path: string, fn: () => Promise<void>) => Promise<void> },
) => {
	const branch = ctx.sessionManager.getBranch();
	const recentMessages = selectRecentMessages(branch, windowTurns);
	if (recentMessages.length === 0) {
		return;
	}

	const recentTurns = formatRecentTurns(recentMessages);
	const prompt = await getPrompt(promptPath, { recentTurns });
	const output = await promptExecutor(prompt, ctx);
	if (!output) {
		return;
	}

	const safeOutput = enforceOutputLimit(output, "scribe");
	const decisionsPath = getDecisionsPath(ctx);
	const queue = resolveMutationQueue(options, "decisions");

	await queue(decisionsPath, async () => {
		const existing = existsSync(decisionsPath) ? await readFile(decisionsPath, "utf-8") : "";
		const nextContent = buildDecisionsContent(existing, safeOutput);
		if (!nextContent) {
			return;
		}
		await writeToFile(decisionsPath, nextContent);
	});
};

export const execEditor = async (
	promptPath: string,
	ctx: ExtensionContext,
	promptExecutor: PromptExecutor = executePrompt,
	options?: { queue?: (path: string, fn: () => Promise<void>) => Promise<void> },
) => {
	const decisionsPath = getDecisionsPath(ctx);
	if (!existsSync(decisionsPath)) {
		return;
	}

	const decisions = (await readFile(decisionsPath, "utf-8")).trim();
	if (!decisions) {
		return;
	}

	const conventionsPath = getConventionsPath(ctx);
	const currentConventions = existsSync(conventionsPath)
		? (await readFile(conventionsPath, "utf-8")).trim() || "None."
		: "None.";

	const prompt = await getPrompt(promptPath, {
		currentConventions,
		newCandidates: decisions,
	});
	const output = await promptExecutor(prompt, ctx);
	const safeOutput = enforceOutputLimit(output, "editor");
	const nextContent = buildConventionsContent(safeOutput);
	if (!nextContent) {
		return;
	}

	const queue = resolveMutationQueue(options, "conventions");
	await queue(conventionsPath, async () => {
		await writeToFile(conventionsPath, nextContent);
	});
};

type AgentEndHandlerOptions = {
	promptExecutor?: PromptExecutor;
	execScribeFn?: typeof execScribe;
	execEditorFn?: typeof execEditor;
	scribePromptPath?: string;
	editorPromptPath?: string;
	now?: () => number;
	runTimeoutMs?: number;
};

type ResolvedAgentEndOptions = {
	promptExecutor: PromptExecutor;
	execScribeFn: typeof execScribe;
	execEditorFn: typeof execEditor;
	scribePromptPath: string;
	editorPromptPath: string;
	now: () => number;
	runTimeoutMs: number;
};

const resolveAgentEndOptions = (options?: AgentEndHandlerOptions): ResolvedAgentEndOptions => ({
	promptExecutor: options?.promptExecutor ?? executePrompt,
	execScribeFn: options?.execScribeFn ?? execScribe,
	execEditorFn: options?.execEditorFn ?? execEditor,
	scribePromptPath: options?.scribePromptPath ?? join(baseDir, "prompts", "scribe.md"),
	editorPromptPath: options?.editorPromptPath ?? join(baseDir, "prompts", "editor.md"),
	now: options?.now ?? Date.now,
	runTimeoutMs: options?.runTimeoutMs ?? 60_000,
});

export const createAgentEndHandler = (options?: AgentEndHandlerOptions) => {
	let turnCount = 0;
	let scribeRunning = false;
	let editorRunning = false;
	const runOptions = resolveAgentEndOptions(options);

	return async (_event: unknown, ctx: ExtensionContext) => {
		turnCount += 1;

		const {
			scribePromptPath: scribePath,
			editorPromptPath: editorPath,
			promptExecutor,
			execScribeFn: scribeFn,
			execEditorFn: editorFn,
			now,
			runTimeoutMs,
		} = runOptions;

		updateCounters(ctx, turnCount);

		if (turnCount % SCRIBE_INTERVAL_TURNS === 0 && !scribeRunning) {
			scribeRunning = true;
			updateWorkingMessage(ctx, { scribeRunning, editorRunning });
			const run = withTimeout(
				scribeFn(scribePath, ctx, SCRIBE_INTERVAL_TURNS, promptExecutor),
				runTimeoutMs,
				"scribe run",
			)
				.then(() => {
					setLastRunStatus(ctx, "scribe", "success", now());
				})
				.catch((error) => {
					setLastRunStatus(ctx, "scribe", "failure", now());
					reportError(ctx, "scribe run", error);
				})
				.finally(() => {
					scribeRunning = false;
					updateWorkingMessage(ctx, { scribeRunning, editorRunning });
				});
			void run.catch((error) => {
				console.error("Scribe extension scribe run handler failed:", error);
			});
		}

		if (turnCount % EDITOR_INTERVAL_TURNS === 0 && !editorRunning) {
			editorRunning = true;
			updateWorkingMessage(ctx, { scribeRunning, editorRunning });
			const run = withTimeout(editorFn(editorPath, ctx, promptExecutor), runTimeoutMs, "editor run")
				.then(() => {
					setLastRunStatus(ctx, "editor", "success", now());
				})
				.catch((error) => {
					setLastRunStatus(ctx, "editor", "failure", now());
					reportError(ctx, "editor run", error);
				})
				.finally(() => {
					editorRunning = false;
					updateWorkingMessage(ctx, { scribeRunning, editorRunning });
				});
			void run.catch((error) => {
				console.error("Scribe extension editor run handler failed:", error);
			});
		}
	};
};

const main = (pi: ExtensionAPI) => {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		ctx.ui.setStatus("scribe-count", formatFooterText(ctx, `Scribe 0/${SCRIBE_INTERVAL_TURNS}`));
		ctx.ui.setStatus("editor-count", formatFooterText(ctx, `Editor 0/${EDITOR_INTERVAL_TURNS}`));
	});
	pi.on("agent_end", createAgentEndHandler());
};

export default main;
