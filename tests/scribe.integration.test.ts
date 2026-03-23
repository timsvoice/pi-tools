import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";
import {
	createAgentEndHandler,
	execEditor,
	execScribe,
	executePrompt,
} from "../.pi/extensions/scribe/index.ts";

type MessageEntry = { type: "message"; message: { role: string; content: string } };

type StubContext = {
	cwd: string;
	hasUI: boolean;
	ui: {
		theme?: { fg: (token: string, text: string) => string };
		setStatus: (key: string, value?: string) => void;
		setWorkingMessage: (message?: string) => void;
		notify: (message: string, level: "info" | "warning" | "error") => void;
	};
	model?: { provider: string; id: string } | null;
	modelRegistry: { getApiKey: (model: { provider: string; id: string }) => Promise<string | null> };
	completeFn?: (
		model: { provider: string; id: string },
		input: {
			systemPrompt?: string;
			messages: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp: number;
			}>;
		},
		options: { apiKey: string },
	) => Promise<{ content: Array<{ type: string; text: string }> }>;
	sessionManager: {
		getBranch: () => Array<{ type: string; message?: { role?: string; content?: unknown } }>;
	};
};

const createTempDir = async () => mkdtemp(join(tmpdir(), "scribe-test-"));

const buildDecisionOutput = (
	overrides: Partial<
		Record<"status" | "title" | "type" | "decision" | "why" | "impact" | "invalidation", string>
	> = {},
) =>
	JSON.stringify({
		status: "decision",
		title: "Decision A",
		type: "CONSTRAINT",
		decision: "Do the thing.",
		why: "not stated",
		impact: "Teams do the thing.",
		invalidation: "not stated",
		...overrides,
	});

const createContext = (options: {
	cwd: string;
	branch?: MessageEntry[];
	hasUI?: boolean;
	model?: { provider: string; id: string } | null;
	apiKey?: string | null;
	completeFn?: StubContext["completeFn"];
	statusCalls?: Array<[string, string | undefined]>;
	workingCalls?: Array<string | undefined>;
}) => {
	const calls = options.statusCalls ?? [];
	const workingCalls = options.workingCalls ?? [];
	return {
		cwd: options.cwd,
		hasUI: options.hasUI ?? true,
		ui: {
			theme: {
				fg: (_token: string, text: string) => text,
			},
			setStatus: (key: string, value?: string) => {
				calls.push([key, value]);
			},
			setWorkingMessage: (message?: string) => {
				workingCalls.push(message);
			},
			notify: () => undefined,
		},
		model: options.model === undefined ? { provider: "test", id: "model" } : options.model,
		modelRegistry: {
			getApiKey: async () => (options.apiKey === undefined ? "key" : options.apiKey),
		},
		completeFn: options.completeFn,
		sessionManager: {
			getBranch: () => options.branch ?? [],
		},
	} satisfies StubContext;
};

test("execScribe appends decisions and uses mutation queue", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "scribe.md");
	await writeFile(promptPath, "{{recentTurns}} {Short title}");
	const branch: MessageEntry[] = [
		{ type: "message", message: { role: "user", content: "u1" } },
		{ type: "message", message: { role: "assistant", content: "a1" } },
	];
	const ctx = createContext({ cwd, branch });
	let queueCalled = false;
	let queuedPath = "";
	const queue = async (path: string, fn: () => Promise<void>) => {
		queueCalled = true;
		queuedPath = path;
		await fn();
	};

	const output = buildDecisionOutput();
	await execScribe(promptPath, ctx, 1, async () => output, { queue });

	const decisionsPath = resolve(cwd, ".scribe", "DECISIONS.md");
	const content = await readFile(decisionsPath, "utf-8");
	assert.equal(
		content,
		[
			"# Decisions",
			"",
			"## Decision A",
			"",
			"- Status: decision",
			"- Title: Decision A",
			"- Type: CONSTRAINT",
			"- Decision: Do the thing.",
			"- Why: not stated",
			"- Impact: Teams do the thing.",
			"- Invalidation: not stated",
			"",
		].join("\n"),
	);
	assert.equal(queueCalled, true);
	assert.equal(queuedPath, decisionsPath);
});

test("execScribe enforces output limits", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "scribe.md");
	await writeFile(promptPath, "{{recentTurns}} {Short title}");
	const branch: MessageEntry[] = [{ type: "message", message: { role: "user", content: "u1" } }];
	const ctx = createContext({ cwd, branch });
	const huge = "a".repeat(60 * 1024);

	await assert.rejects(() => execScribe(promptPath, ctx, 1, async () => huge), /output exceeded/i);
});

test("execScribe fails fast when queue is invalid", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "scribe.md");
	await writeFile(promptPath, "{{recentTurns}} {Short title}");
	const branch: MessageEntry[] = [{ type: "message", message: { role: "user", content: "u1" } }];
	const ctx = createContext({ cwd, branch });

	const output = buildDecisionOutput();
	await assert.rejects(
		() =>
			execScribe(promptPath, ctx, 1, async () => output, {
				queue: {} as unknown as (path: string, fn: () => Promise<void>) => Promise<void>,
			}),
		/queue unavailable/i,
	);
});

test("execEditor rewrites conventions when decisions exist", async () => {
	const cwd = await createTempDir();
	await mkdir(resolve(cwd, ".scribe"), { recursive: true });
	await writeFile(resolve(cwd, ".scribe", "DECISIONS.md"), "# Decisions\n\nDecision");
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{{currentConventions}}\n{{newCandidates}}\n{Short title}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	const conventionsPath = resolve(cwd, ".scribe", "CONVENTIONS.md");
	const content = await readFile(conventionsPath, "utf-8");
	assert.equal(content, "Convention\n");
});

test("execEditor fails fast when queue is invalid", async () => {
	const cwd = await createTempDir();
	await mkdir(resolve(cwd, ".scribe"), { recursive: true });
	await writeFile(resolve(cwd, ".scribe", "DECISIONS.md"), "# Decisions\n\nDecision");
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{{currentConventions}}\n{{newCandidates}}\n{Short title}");
	const ctx = createContext({ cwd });

	await assert.rejects(
		() =>
			execEditor(promptPath, ctx, async () => "Convention", {
				queue: {} as unknown as (path: string, fn: () => Promise<void>) => Promise<void>,
			}),
		/queue unavailable/i,
	);
});

test("executePrompt includes a system prompt", async () => {
	const cwd = await createTempDir();
	let seenSystemPrompt: string | undefined;
	const ctx = createContext({
		cwd,
		completeFn: async (_model, input) => {
			seenSystemPrompt = input.systemPrompt;
			return { content: [{ type: "text", text: "Model output" }] };
		},
	});

	await executePrompt("Prompt text", ctx);

	assert.ok(seenSystemPrompt?.trim().length);
});

test("execEditor is a no-op when decisions are missing", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{{currentConventions}}\n{{newCandidates}}\n{Short title}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	await assert.rejects(
		() => readFile(resolve(cwd, ".scribe", "CONVENTIONS.md"), "utf-8"),
		/ENOENT/,
	);
});

test("createAgentEndHandler triggers cadence", async () => {
	const cwd = await createTempDir();
	const ctx = createContext({ cwd, hasUI: false });
	let scribeCalls = 0;
	let editorCalls = 0;

	const handler = createAgentEndHandler({
		execScribeFn: async () => {
			scribeCalls += 1;
		},
		execEditorFn: async () => {
			editorCalls += 1;
		},
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
		now: () => new Date(2026, 0, 1, 12, 34).getTime(),
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
		await setImmediate();
	}

	assert.equal(scribeCalls, 30);
	assert.equal(editorCalls, 10);
});

test("createAgentEndHandler times out hanging runs", async () => {
	const cwd = await createTempDir();
	const statusCalls: Array<[string, string | undefined]> = [];
	const ctx = createContext({ cwd, statusCalls });
	let scribeCalls = 0;

	const handler = createAgentEndHandler({
		execScribeFn: async () => {
			scribeCalls += 1;
			return new Promise<void>(() => undefined);
		},
		execEditorFn: async () => undefined,
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
		now: () => new Date(2026, 0, 1, 12, 34).getTime(),
		runTimeoutMs: 5,
	});

	await handler({}, ctx);
	await setTimeout(20);

	assert.equal(scribeCalls, 1);
	assert.ok(
		statusCalls.some((call) => call[0] === "scribe-last" && call[1] === "| Scribe ✗ 12:34"),
	);
});

test("createAgentEndHandler sets counters", async () => {
	const cwd = await createTempDir();
	const statusCalls: Array<[string, string | undefined]> = [];
	const workingCalls: Array<string | undefined> = [];
	const ctx = createContext({ cwd, statusCalls, workingCalls });

	const handler = createAgentEndHandler({
		execScribeFn: async () => undefined,
		execEditorFn: async () => undefined,
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
		now: () => new Date(2026, 0, 1, 12, 34).getTime(),
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
		await setImmediate();
	}
	await setImmediate();

	assert.ok(workingCalls.includes("Scribing..."));
	assert.ok(workingCalls.includes("Editorializing..."));
	assert.ok(workingCalls.includes(undefined));
	assert.ok(
		statusCalls.some((call) => call[0] === "scribe-last" && call[1] === "| Scribe ✓ 12:34"),
	);
	assert.ok(statusCalls.some((call) => call[0] === "editor-last" && call[1] === "Editor ✓ 12:34"));
	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 1/1"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 1/3"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 3/3"));
});

test("session_start seeds counter status", async () => {
	const cwd = await createTempDir();
	const statusCalls: Array<[string, string | undefined]> = [];
	const ctx = createContext({ cwd, statusCalls });
	let sessionStart: ((event: unknown, ctx: StubContext) => Promise<void>) | null = null;
	const pi = {
		on: (event: string, handler: (event: unknown, ctx: StubContext) => Promise<void>) => {
			if (event === "session_start") {
				sessionStart = handler;
			}
		},
	};

	const extension = await import("../.pi/extensions/scribe/index.ts");
	extension.default(pi as unknown as { on: typeof pi.on });

	if (!sessionStart) {
		throw new Error("session_start handler not registered");
	}
	await sessionStart({}, ctx);

	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 0/1"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 0/3"));
});

test("executePrompt fails fast when model or api key missing", async () => {
	const cwd = await createTempDir();
	const noModelCtx = createContext({ cwd, model: null });
	await assert.rejects(() => executePrompt("prompt", noModelCtx), /no active model/i);

	const noKeyCtx = createContext({ cwd, apiKey: null });
	await assert.rejects(() => executePrompt("prompt", noKeyCtx), /missing api key/i);
});
