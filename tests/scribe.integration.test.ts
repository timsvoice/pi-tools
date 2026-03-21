import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
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
		setStatus: (key: string, value?: string) => void;
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
}) => {
	const calls = options.statusCalls ?? [];
	return {
		cwd: options.cwd,
		hasUI: options.hasUI ?? true,
		ui: {
			setStatus: (key: string, value?: string) => {
				calls.push([key, value]);
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
	await writeFile(promptPath, "{recentTurns}");
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
	await writeFile(promptPath, "{recentTurns}");
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
	await writeFile(promptPath, "{currentConventions}\n{newCandidates}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	const conventionsPath = resolve(cwd, "docs", "CONVENTIONS.md");
	const content = await readFile(conventionsPath, "utf-8");
	assert.equal(content, "Convention\n");
});

test("execEditor is a no-op when decisions are missing", async () => {
	const cwd = await createTempDir();
	const promptPath = join(cwd, "editor.md");
	await writeFile(promptPath, "{currentConventions}\n{newCandidates}");
	const ctx = createContext({ cwd });

	await execEditor(promptPath, ctx, async () => "Convention");

	await assert.rejects(() => readFile(resolve(cwd, "docs", "CONVENTIONS.md"), "utf-8"), /ENOENT/);
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
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
	}

	assert.equal(scribeCalls, 3);
	assert.equal(editorCalls, 1);
});

test("createAgentEndHandler sets and clears status", async () => {
	const cwd = await createTempDir();
	const statusCalls: Array<[string, string | undefined]> = [];
	const ctx = createContext({ cwd, statusCalls });

	const handler = createAgentEndHandler({
		execScribeFn: async () => undefined,
		execEditorFn: async () => undefined,
		promptExecutor: async () => "",
		scribePromptPath: join(cwd, "scribe.md"),
		editorPromptPath: join(cwd, "editor.md"),
	});

	for (let i = 0; i < 30; i += 1) {
		await handler({}, ctx);
	}

	await Promise.resolve();

	assert.ok(statusCalls.some((call) => call[0] === "scribe" && call[1] === "Scribing..."));
	assert.ok(statusCalls.some((call) => call[0] === "editor" && call[1] === "Editorializing..."));
	assert.ok(statusCalls.some((call) => call[0] === "scribe" && call[1] === undefined));
	assert.ok(statusCalls.some((call) => call[0] === "editor" && call[1] === undefined));
	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 1/10"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 1/30"));
	assert.ok(statusCalls.some((call) => call[0] === "scribe-count" && call[1] === "Scribe 10/10"));
	assert.ok(statusCalls.some((call) => call[0] === "editor-count" && call[1] === "Editor 30/30"));
});

test("executePrompt fails fast when model or api key missing", async () => {
	const cwd = await createTempDir();
	const noModelCtx = createContext({ cwd, model: null });
	await assert.rejects(() => executePrompt("prompt", noModelCtx), /no active model/i);

	const noKeyCtx = createContext({ cwd, apiKey: null });
	await assert.rejects(() => executePrompt("prompt", noKeyCtx), /missing api key/i);
});
