import { complete } from "@mariozechner/pi-ai";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_DECISION_INTERVAL_TURNS = 3;
const CONFIG_PATH = [".pi", "extensions", "scribe.config.json"];

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

export default function (pi: ExtensionAPI) {
	let turnsSinceLastDecision = 0;
	let lastTriggeredMessageCount = 0;
	const uiLogLines: string[] = [];

	const pushUiLog = (ctx: ExtensionContext, message: string) => {
		if (!ctx.hasUI) return;
		const time = new Date().toLocaleTimeString();
		uiLogLines.push(`${time} ${message}`);
		if (uiLogLines.length > 6) uiLogLines.shift();
		ctx.ui.setWidget("scribe", ["Scribe", ...uiLogLines]);
	};

	pi.on("agent_end", async (_event, ctx) => {
		const decisionIntervalTurns = await getDecisionIntervalTurns(ctx.cwd);

		turnsSinceLastDecision += 1;
		if (turnsSinceLastDecision < decisionIntervalTurns) {
			pushUiLog(ctx, `Waiting ${turnsSinceLastDecision}/${decisionIntervalTurns}`);
			return;
		}
		turnsSinceLastDecision = 0;

		pushUiLog(ctx, "Logging decisions...");
		if (ctx.hasUI) ctx.ui.notify("Scribe: logging decisions...", "info");

		try {
			const decisionsPath = join(ctx.cwd, "docs", "decisions.md");
			const promptPath = join(ctx.cwd, ".pi", "extensions", "prompts", "PROMPT.md");
			await mkdir(dirname(decisionsPath), { recursive: true });

			const model = ctx.model;
			if (!model) {
				pushUiLog(ctx, "Skipped: no model");
				return;
			}
			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				pushUiLog(ctx, "Skipped: no API key");
				return;
			}

			const promptTemplate = await readFile(promptPath, "utf8");
			const allTurns = ctx.sessionManager
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

			if (lastTriggeredMessageCount > allTurns.length) {
				lastTriggeredMessageCount = 0;
			}

			const newTurns = allTurns.slice(lastTriggeredMessageCount);
			lastTriggeredMessageCount = allTurns.length;

			const recentTurns = newTurns.join("\n");
			if (!recentTurns) {
				pushUiLog(ctx, "Skipped: no new turns");
				return;
			}
			const prompt = promptTemplate.replace("{recentTurns}", recentTurns);

			const response = await complete(
				model,
				{
					systemPrompt: "You are a concise assistant. Reply with plain text only.",
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{ apiKey },
			);

			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();

			if (!text) {
				pushUiLog(ctx, "Skipped: empty output");
				return;
			}
			await appendFile(decisionsPath, `\n${text}\n`, "utf8");
			pushUiLog(ctx, "Decisions logged");
			if (ctx.hasUI) ctx.ui.notify("Scribe: decisions logged", "success");
		} catch (error) {
			pushUiLog(ctx, "Error while logging decisions");
			if (ctx.hasUI) {
				ctx.ui.notify(`Scribe failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		}
	});
}
