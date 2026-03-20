import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { join } from "node:path";

export type PipelineDeps = {
	readText: (path: string) => Promise<string>;
	writeText?: (path: string, text: string) => Promise<void>;
	appendText?: (path: string, text: string) => Promise<void>;
	ensureDir: (path: string) => Promise<void>;
	complete: (...args: any[]) => Promise<any>;
};

export type PipelinePrepareResult<Context> = {
	prompt: string | null;
	context?: Context;
	noOutputMessage?: string;
};

export type PipelineApplyResult = {
	appliedCount?: number;
	noOutput?: boolean;
	invalidOutput?: boolean;
	noOutputMessage?: string;
};

export type PipelineConfig<State, Context> = {
	name: string;
	stateCustomType: string;
	deps: PipelineDeps;
	systemPrompt: string;
	promptPathSegments: string[];
	getInterval: (ctx: ExtensionContext, deps: PipelineDeps) => Promise<number>;
	getTurns: (state: State) => number;
	setTurns: (state: State, value: number) => void;
	incrementRunsSkipped: (state: State) => void;
	incrementRunsExecuted: (state: State) => void;
	incrementOutputsApplied: (state: State, count: number) => void;
	incrementNoOutputRuns: (state: State) => void;
	incrementFailures: (state: State) => void;
	incrementInvalidOutputSkips?: (state: State) => void;
	updateFooter: (ctx: ExtensionContext, interval: number, state: State) => void;
	initState: () => State;
	isState: (value: unknown) => value is State;
	normalizeState?: (state: State) => State;
	extractResponseText: (responseContent: any) => string;
	prepare: (
		ctx: ExtensionContext,
		deps: PipelineDeps,
		state: State,
		promptTemplate: string,
	) => Promise<PipelinePrepareResult<Context>>;
	apply: (
		ctx: ExtensionContext,
		deps: PipelineDeps,
		state: State,
		responseText: string,
		context: Context | undefined,
	) => Promise<PipelineApplyResult>;
	notifications?: {
		start?: string;
		success?: string;
		noOutput?: string;
		invalidOutput?: string;
		failurePrefix?: string;
	};
};

const nextTurnCounter = (turnsSinceLastRun: number, interval: number) => {
	const next = turnsSinceLastRun + 1;
	if (next < interval) {
		return { turnsSinceLastRun: next, shouldRun: false };
	}
	return { turnsSinceLastRun: 0, shouldRun: true };
};

export function createPromptPipeline<State, Context>(config: PipelineConfig<State, Context>) {
	let state: State = config.initState();
	let lastPersistedState = JSON.stringify(state);
	let isRunning = false;

	const normalizeState = (value: State) => (config.normalizeState ? config.normalizeState(value) : value);

	const persistState = (pi: ExtensionAPI) => {
		const serialized = JSON.stringify(state);
		if (serialized === lastPersistedState) return;
		pi.appendEntry(config.stateCustomType, state as unknown as Record<string, unknown>);
		lastPersistedState = serialized;
	};

	const hydrateState = (ctx: ExtensionContext) => {
		let latest: State | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== config.stateCustomType) continue;
			if (!config.isState(entry.data)) continue;
			latest = entry.data as State;
		}
		if (!latest) return;
		state = normalizeState(latest);
		lastPersistedState = JSON.stringify(state);
	};

	const updateFooter = (ctx: ExtensionContext, interval: number) => {
		config.updateFooter(ctx, interval, state);
	};

	const notify = (ctx: ExtensionContext, message?: string, type: "info" | "success" | "warning" = "info") => {
		if (!message || !ctx.hasUI) return;
		ctx.ui.notify(message, type);
	};

	return {
		hydrateState,
		updateFooter,
		async onAgentEnd(pi: ExtensionAPI, ctx: ExtensionContext) {
			if (isRunning) return;
			isRunning = true;

			try {
				const interval = await config.getInterval(ctx, config.deps);
				const turnProgress = nextTurnCounter(config.getTurns(state), interval);
				config.setTurns(state, turnProgress.turnsSinceLastRun);
				updateFooter(ctx, interval);
				if (!turnProgress.shouldRun) {
					config.incrementRunsSkipped(state);
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				config.incrementRunsExecuted(state);
				persistState(pi);
				updateFooter(ctx, interval);
				notify(ctx, config.notifications?.start, "info");

				const promptTemplate = await config.deps.readText(join(ctx.cwd, ...config.promptPathSegments));
				const preparation = await config.prepare(ctx, config.deps, state, promptTemplate);
				if (!preparation.prompt) {
					config.incrementNoOutputRuns(state);
					persistState(pi);
					updateFooter(ctx, interval);
					notify(ctx, preparation.noOutputMessage ?? config.notifications?.noOutput, "success");
					return;
				}

				const model = ctx.model;
				if (!model) {
					config.incrementNoOutputRuns(state);
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				const apiKey = await ctx.modelRegistry.getApiKey(model);
				if (!apiKey) {
					config.incrementNoOutputRuns(state);
					persistState(pi);
					updateFooter(ctx, interval);
					return;
				}

				const response = await config.deps.complete(
					model,
					{
						systemPrompt: config.systemPrompt,
						messages: [
							{
								role: "user",
								content: [{ type: "text", text: preparation.prompt }],
								timestamp: Date.now(),
							},
						],
					},
					{ apiKey },
				);

				const text = config.extractResponseText(response.content);
				if (!text) {
					config.incrementNoOutputRuns(state);
					persistState(pi);
					updateFooter(ctx, interval);
					notify(ctx, config.notifications?.noOutput, "success");
					return;
				}

				const applyResult = await config.apply(ctx, config.deps, state, text, preparation.context);
				if (applyResult.invalidOutput) {
					config.incrementInvalidOutputSkips?.(state);
					persistState(pi);
					updateFooter(ctx, interval);
					notify(ctx, config.notifications?.invalidOutput, "warning");
					return;
				}

				if (applyResult.noOutput || !applyResult.appliedCount) {
					config.incrementNoOutputRuns(state);
					persistState(pi);
					updateFooter(ctx, interval);
					notify(ctx, applyResult.noOutputMessage ?? config.notifications?.noOutput, "success");
					return;
				}

				config.incrementOutputsApplied(state, applyResult.appliedCount);
				persistState(pi);
				updateFooter(ctx, interval);
				notify(ctx, config.notifications?.success, "success");
			} catch (error) {
				config.incrementFailures(state);
				persistState(pi);
				if (ctx.hasUI) {
					const prefix = config.notifications?.failurePrefix ?? `${config.name} failed:`;
					ctx.ui.notify(`${prefix} ${error instanceof Error ? error.message : String(error)}`, "warning");
				}
			} finally {
				isRunning = false;
			}
		},
	};
}
