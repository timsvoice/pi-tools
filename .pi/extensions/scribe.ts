import { complete } from "@mariozechner/pi-ai";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];
const DECISIONS_PATH = ["docs", "decisions.md"];
const PROMPT_TEMPLATE_PATH = [".pi", "extensions", "prompts", "PROMPT.md"];
const SCRIBE_SYSTEM_PROMPT = "You are a concise assistant. Reply with plain text only.";

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

function getAllTurnLines(ctx: ExtensionContext): string[] {
	return ctx.sessionManager
		.getBranch()
		.map((entry) => {
			if (entry.type !== "message") return "";
			if (entry.message.role !== "user" && entry.message.role !== "assistant") return "";
			const text = entry.message.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			return text ? `${entry.message.role}: ${text}` : "";
		})
		.filter(Boolean);
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

export default function (pi: ExtensionAPI) {
	let turnsSinceLastDecision = 0;
	let lastTriggeredMessageCount = 0;

	pi.on("agent_end", async (_event, ctx) => {
		const decisionIntervalTurns = await getDecisionIntervalTurns(ctx.cwd);

		turnsSinceLastDecision += 1;
		
		if (turnsSinceLastDecision < decisionIntervalTurns) {
			return;
		}

		turnsSinceLastDecision = 0;

		if (ctx.hasUI) ctx.ui.notify("Scribe: logging decisions...", "info");

		try {
			const decisionsPath = join(ctx.cwd, ...DECISIONS_PATH);
			const promptPath = join(ctx.cwd, ...PROMPT_TEMPLATE_PATH);
			await mkdir(dirname(decisionsPath), { recursive: true });

			const model = ctx.model;
			if (!model) {
				return;
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				return;
			}

			const promptTemplate = await readFile(promptPath, "utf8");
			const allTurns = getAllTurnLines(ctx);

			if (lastTriggeredMessageCount > allTurns.length) {
				lastTriggeredMessageCount = 0;
			}

			const newTurns = allTurns.slice(lastTriggeredMessageCount);
			lastTriggeredMessageCount = allTurns.length;

			const recentTurns = newTurns.join("\n");
			if (!recentTurns) {
				return;
			}

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
		}
	});
}
