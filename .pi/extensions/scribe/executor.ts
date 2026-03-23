import { type Message, complete } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type PromptExecutor = (
	prompt: string,
	ctx: ExtensionContext,
	options?: { completeFn?: typeof complete },
) => Promise<string>;

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
