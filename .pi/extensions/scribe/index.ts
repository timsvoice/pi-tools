import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export type PromptExecutor = (prompt: string, ctx: ExtensionContext) => Promise<string>;

export const fillPromptTemplate = (template: string, replacements: Record<string, string>) => {
	for (const key of Object.keys(replacements)) {
		if (!template.includes(`{${key}}`)) {
			throw new Error(`Prompt template missing required placeholder: ${key}.`);
		}
	}

	let filled = template;
	for (const [key, value] of Object.entries(replacements)) {
		filled = filled.replaceAll(`{${key}}`, value);
	}

	for (const key of Object.keys(replacements)) {
		if (filled.includes(`{${key}}`)) {
			throw new Error(`Prompt template has unresolved placeholder: ${key}.`);
		}
	}

	return filled;
};

const getPrompt = (path: string, replacements: Record<string, string>) => {
	const template = readFileSync(path, "utf-8");
	return fillPromptTemplate(template, replacements);
};

const writeToFile = (path: string, content: string) => {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, content, "utf-8");
};

export const executePrompt: PromptExecutor = async (prompt: string, ctx: ExtensionContext) => {
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

	const response = await complete(model, { messages }, { apiKey });
	return response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
};

export const selectRecentMessages = (
	entries: Array<{ type: string; message?: AgentMessage }>,
	windowTurns: number,
): AgentMessage[] => {
	const recentMessages: AgentMessage[] = [];
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

		if (message.role === "user") {
			if (userTurns + 1 > windowTurns) {
				break;
			}
			userTurns += 1;
			recentMessages.unshift(message);
			continue;
		}

		if (userTurns < windowTurns) {
			recentMessages.unshift(message);
		}
	}

	return recentMessages;
};

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
	}
};

const formatFooterText = (ctx: ExtensionContext, text: string) =>
	ctx.ui.theme ? ctx.ui.theme.fg("dim", text) : text;

export const buildDecisionsContent = (existing: string, output: string): string | null => {
	const trimmedOutput = output.trim();
	if (!trimmedOutput) {
		return null;
	}

	const trimmedExisting = existing.trim();
	const header = trimmedExisting.length === 0 ? "# Decisions\n\n" : `${trimmedExisting}\n\n`;
	return `${header}${trimmedOutput}\n`;
};

export const buildConventionsContent = (output: string): string | null => {
	const trimmedOutput = output.trim();
	if (!trimmedOutput) {
		return null;
	}
	return `${trimmedOutput}\n`;
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
	const prompt = getPrompt(promptPath, { recentTurns });
	const output = await promptExecutor(prompt, ctx);
	if (!output) {
		return;
	}

	const safeOutput = enforceOutputLimit(output, "scribe");
	const decisionsPath = resolve(ctx.cwd, "docs", "DECISIONS.md");
	const queue = options?.queue ?? withFileMutationQueue;

	await queue(decisionsPath, async () => {
		const existing = existsSync(decisionsPath) ? readFileSync(decisionsPath, "utf-8") : "";
		const nextContent = buildDecisionsContent(existing, safeOutput);
		if (!nextContent) {
			return;
		}
		writeToFile(decisionsPath, nextContent);
	});
};

export const execEditor = async (
	promptPath: string,
	ctx: ExtensionContext,
	promptExecutor: PromptExecutor = executePrompt,
	options?: { queue?: (path: string, fn: () => Promise<void>) => Promise<void> },
) => {
	const decisionsPath = resolve(ctx.cwd, "docs", "DECISIONS.md");
	if (!existsSync(decisionsPath)) {
		return;
	}

	const decisions = readFileSync(decisionsPath, "utf-8").trim();
	if (!decisions) {
		return;
	}

	const conventionsPath = resolve(ctx.cwd, "docs", "CONVENTIONS.md");
	const currentConventions = existsSync(conventionsPath)
		? readFileSync(conventionsPath, "utf-8").trim() || "None."
		: "None.";

	const prompt = getPrompt(promptPath, {
		currentConventions,
		newCandidates: decisions,
	});
	const output = await promptExecutor(prompt, ctx);
	const safeOutput = enforceOutputLimit(output, "editor");
	const nextContent = buildConventionsContent(safeOutput);
	if (!nextContent) {
		return;
	}

	const queue = options?.queue ?? withFileMutationQueue;
	await queue(conventionsPath, async () => {
		writeToFile(conventionsPath, nextContent);
	});
};

export const createAgentEndHandler = (options?: {
	promptExecutor?: PromptExecutor;
	execScribeFn?: typeof execScribe;
	execEditorFn?: typeof execEditor;
	scribePromptPath?: string;
	editorPromptPath?: string;
}) => {
	let turnCount = 0;
	let scribeRunning = false;
	let editorRunning = false;

	return async (_event: unknown, ctx: ExtensionContext) => {
		turnCount += 1;

		const scribePath = options?.scribePromptPath ?? join(baseDir, "prompts", "scribe.md");
		const editorPath = options?.editorPromptPath ?? join(baseDir, "prompts", "editor.md");
		const promptExecutor = options?.promptExecutor ?? executePrompt;
		const scribeFn = options?.execScribeFn ?? execScribe;
		const editorFn = options?.execEditorFn ?? execEditor;

		if (ctx.hasUI) {
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
		}

		const updateWorkingMessage = () => {
			if (!ctx.hasUI) {
				return;
			}
			if (editorRunning) {
				ctx.ui.setWorkingMessage("Editorializing...");
				return;
			}
			if (scribeRunning) {
				ctx.ui.setWorkingMessage("Scribing...");
				return;
			}
			ctx.ui.setWorkingMessage();
		};

		if (turnCount % SCRIBE_INTERVAL_TURNS === 0 && !scribeRunning) {
			scribeRunning = true;
			updateWorkingMessage();
			void scribeFn(scribePath, ctx, SCRIBE_INTERVAL_TURNS, promptExecutor)
				.catch((error) => {
					reportError(ctx, "scribe run", error);
				})
				.finally(() => {
					scribeRunning = false;
					updateWorkingMessage();
				});
		}

		if (turnCount % EDITOR_INTERVAL_TURNS === 0 && !editorRunning) {
			editorRunning = true;
			updateWorkingMessage();
			void editorFn(editorPath, ctx, promptExecutor)
				.catch((error) => {
					reportError(ctx, "editor run", error);
				})
				.finally(() => {
					editorRunning = false;
					updateWorkingMessage();
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
