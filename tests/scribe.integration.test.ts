import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	createAgentStartHandler,
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
	sessionManager: {
		getBranch: () => Array<{ type: string; message?: { role?: string; content?: unknown } }>;
	};
};

const createTempDir = async () => mkdtemp(join(tmpdir(), "scribe-test-"));

const createContext = (options: {
	cwd: string;
	branch?: MessageEntry[];
	hasUI?: boolean;
	model?: { provider: string; id: string } | null;
	apiKey?: string | null;
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
		sessionManager: {
			getBranch: () => options.branch ?? [],
		},
	} satisfies StubContext;
};

test("execScribe appends decisions and uses mutation queue", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "scribe.md");
	await writeFile(promptPath, "{recentTurns} {Short title}");
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

	await execScribe(promptPath, ctx, 1, async () => "Decision A", { queue });

	const decisionsPath = resolve(cwd, "docs", "DECISIONS.md");
	const content = await readFile(decisionsPath, "utf-8");
	assert.equal(content, "# Decisions\n\nDecision A\n");
	assert.equal(queueCalled, true);
	assert.equal(queuedPath, decisionsPath);
});

test("execScribe enforces output limits", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "scribe.md");
	await writeFile(promptPath, "{recentTurns} {Short title}");
	const branch: MessageEntry[] = [{ type: "message", message: { role: "user", content: "u1" } }];
	const ctx = createContext({ cwd, branch });
	const huge = "a".repeat(60 * 1024);

	await assert.rejects(() => execScribe(promptPath, ctx, 1, async () => huge), /output exceeded/i);
});

test("execEditor rewrites conventions when decisions exist", async () => {
	const cwd = await createTempDir();
	await mkdir(resolve(cwd, "docs"), { recursive: true });
	await writeFile(resolve(cwd, "docs", "DECISIONS.md"), "# Decisions\n\nDecision");
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{currentConventions}\n{newCandidates}\n{Short title}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	const conventionsPath = resolve(cwd, "docs", "CONVENTIONS.md");
	const content = await readFile(conventionsPath, "utf-8");
	assert.equal(content, "Convention\n");
});

test("execEditor is a no-op when decisions are missing", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{currentConventions}\n{newCandidates}\n{Short title}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	await assert.rejects(() => readFile(resolve(cwd, "docs", "CONVENTIONS.md"), "utf-8"), /ENOENT/);
});

test("createAgentStartHandler triggers cadence", async () => {
	const cwd = await createTempDir();
	const ctx = createContext({ cwd, hasUI: false });
	let scribeCalls = 0;
	let editorCalls = 0;

	const handler = createAgentStartHandler({
		execScribeFn: async () => {
			scribeCalls += 1;
		},
		execEditorFn: async () => {
			editorCalls += 1;
		},
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
		await Promise.resolve();
	}

	assert.equal(scribeCalls, 30);
	assert.equal(editorCalls, 10);
});

test("createAgentStartHandler sets and clears status", async () => {
	const cwd = await createTempDir();
	const statusCalls: Array<[string, string | undefined]> = [];
	const workingCalls: Array<string | undefined> = [];
	const ctx = createContext({ cwd, statusCalls, workingCalls });

	const handler = createAgentStartHandler({
		execScribeFn: async () => undefined,
		execEditorFn: async () => undefined,
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
		await Promise.resolve();
	}

	assert.ok(workingCalls.includes("Scribing..."));
	assert.ok(workingCalls.includes("Editorializing..."));
	assert.ok(workingCalls.includes(undefined));
	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 1/1"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 1/3"));
	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 1/1"));
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
