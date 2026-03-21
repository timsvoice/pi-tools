import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { complete, type Message } from "@mariozechner/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Get the turn counts for editor and scribe
 * from the config file
 */

type AgentMessage = { role?: string; content?: unknown };

type ScribeConfig = {
	decisionIntervalTurns: number;
	editorRateMultiplier: number;
};

const baseDir = dirname(fileURLToPath(import.meta.url));

export const fillPromptTemplate = (template: string, replacements: Record<string, string>) => {
	let filled = template;
	for (const [key, value] of Object.entries(replacements)) {
		filled = filled.replaceAll(`{${key}}`, value);
	}
	return filled;
};

const getPrompt = (path: string, replacements: Record<string, string>) => {
	/*
	 * Take in the path of a prompt markdown template file and
	 * fill the given content into the prompt markdown file
	 */
	const template = readFileSync(path, "utf-8");
	return fillPromptTemplate(template, replacements);
};

const writeToFile = (path: string, content: string) => {
	/*
	 * Write the given content to the file at the given path
	 */
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, content, "utf-8");
};

export type PromptExecutor = (prompt: string, ctx: ExtensionContext) => Promise<string>;

const executePrompt: PromptExecutor = async (prompt: string, ctx: ExtensionContext) => {
	/*
	 * Execute the given prompt using the active session ctx.model
	 * and call using complete()
	 * return the result
	 */
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
	const text = response.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text;
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
			userTurns += 1;
			if (userTurns > windowTurns) {
				break;
			}
		}

		recentMessages.unshift(message);
	}

	return recentMessages;
};

export const shouldTrigger = (turnCount: number, interval: number) =>
	interval > 0 && turnCount % interval === 0;

export const computeEditorInterval = (decisionInterval: number, multiplier: number) =>
	decisionInterval * multiplier;

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

export const execScribe = async (
	promptPath: string,
	ctx: ExtensionContext,
	windowTurns: number,
	promptExecutor: PromptExecutor = executePrompt,
) => {
	/*
	 * Execute the scribe prompt
	 * fill the messages into the prompt
	 * append the results to the DECISIONS.md file
	 */
	const branch = ctx.sessionManager.getBranch();
	const recentMessages = selectRecentMessages(branch, windowTurns);
	if (recentMessages.length === 0) {
		return;
	}

	const recentTurns = recentMessages
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

	const prompt = getPrompt(promptPath, { recentTurns });
	const output = await promptExecutor(prompt, ctx);
	if (!output) {
		return;
	}

	const safeOutput = enforceOutputLimit(output, "scribe");
	const decisionsPath = resolve(ctx.cwd, "docs", "DECISIONS.md");

	await withFileMutationQueue(decisionsPath, async () => {
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
) => {
	/*
	 * Execute the editor prompt
	 * get the decisions from the DECISIONS.md file
	 * fill the decisions into the editor prompt
	 * return the new file and write to CONVENTIONS.md
	 */
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

	await withFileMutationQueue(conventionsPath, async () => {
		writeToFile(conventionsPath, nextContent);
	});
};

export const createAgentEndHandler = (options?: {
	promptExecutor?: PromptExecutor;
	execScribeFn?: typeof execScribe;
	execEditorFn?: typeof execEditor;
	configPath?: string;
	scribePromptPath?: string;
	editorPromptPath?: string;
}) => {
	let turnCount = 0;
	let config: ScribeConfig | null = null;
	let scribeRunning = false;
	let editorRunning = false;

	return async (_event: unknown, ctx: ExtensionContext) => {
		turnCount += 1;

		if (!config) {
			const projectConfigPath = resolve(ctx.cwd, ".pi", "extensions", "scribe.config.json");
			const globalConfigPath = resolve(
				homedir(),
				".pi",
				"agent",
				"extensions",
				"scribe.config.json",
			);
			const configPath = options?.configPath
				? options.configPath
				: existsSync(projectConfigPath)
					? projectConfigPath
					: globalConfigPath;
			if (!existsSync(configPath)) {
				throw new Error(
					`Scribe extension failed to load config. Missing config at ${projectConfigPath} and ${globalConfigPath}. Fix: create the file with decisionIntervalTurns and editorRateMultiplier.`,
				);
			}

			let rawConfig: unknown;
			try {
				rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
			} catch (error) {
				throw new Error(
					`Scribe extension failed to parse config at ${configPath}: ${error instanceof Error ? error.message : "unknown error"}. Fix: ensure the file is valid JSON with decisionIntervalTurns and editorRateMultiplier.`,
				);
			}

			const candidate = rawConfig as Partial<ScribeConfig>;
			if (
				!candidate ||
				typeof candidate.decisionIntervalTurns !== "number" ||
				candidate.decisionIntervalTurns <= 0 ||
				typeof candidate.editorRateMultiplier !== "number" ||
				candidate.editorRateMultiplier <= 0
			) {
				throw new Error(
					`Scribe extension failed to load config at ${configPath}: invalid values. Fix: set decisionIntervalTurns and editorRateMultiplier to positive numbers.`,
				);
			}

			config = {
				decisionIntervalTurns: Math.floor(candidate.decisionIntervalTurns),
				editorRateMultiplier: Math.floor(candidate.editorRateMultiplier),
			};
		}

		const decisionInterval = config.decisionIntervalTurns;
		const editorInterval = computeEditorInterval(decisionInterval, config.editorRateMultiplier);
		const scribePath = options?.scribePromptPath ?? join(baseDir, "prompts", "scribe.md");
		const editorPath = options?.editorPromptPath ?? join(baseDir, "prompts", "editor.md");
		const promptExecutor = options?.promptExecutor ?? executePrompt;
		const scribeFn = options?.execScribeFn ?? execScribe;
		const editorFn = options?.execEditorFn ?? execEditor;

		if (shouldTrigger(turnCount, decisionInterval) && !scribeRunning) {
			scribeRunning = true;
			void scribeFn(scribePath, ctx, decisionInterval, promptExecutor)
				.catch((error) => {
					reportError(ctx, "scribe run", error);
				})
				.finally(() => {
					scribeRunning = false;
				});
		}

		if (shouldTrigger(turnCount, editorInterval) && !editorRunning) {
			editorRunning = true;
			void editorFn(editorPath, ctx, promptExecutor)
				.catch((error) => {
					reportError(ctx, "editor run", error);
				})
				.finally(() => {
					editorRunning = false;
				});
		}
	};
};

const main = (pi: ExtensionAPI) => {
	/*
	 * use the pi.on('agent_end') event to conditionally trigger
	 * on each agent_end see if the TURN_COUNTS is divisible by the editor and scribe turn counts
	 * if it is, execute the relevent prompt function async
	 */
	pi.on("agent_end", createAgentEndHandler());
};

export default main;
