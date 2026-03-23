import { readFile } from "node:fs/promises";

export type AgentMessage = { role?: string; content?: unknown };

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

export const getPrompt = async (path: string, replacements: Record<string, string>) => {
	const template = await readFile(path, "utf-8");
	return fillPromptTemplate(template, replacements);
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

export const formatRecentTurns = (recentMessages: AgentMessage[]) =>
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
