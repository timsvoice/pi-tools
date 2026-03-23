type DecisionOutput = {
	status: "decision" | "no_decision";
	title: string;
	type: string;
	decision: string;
	why: string;
	impact: string;
	invalidation: string;
};

const DECISION_FIELDS: Array<Exclude<keyof DecisionOutput, "status">> = [
	"title",
	"type",
	"decision",
	"why",
	"impact",
	"invalidation",
];

const parseDecisionOutput = (output: string): DecisionOutput => {
	const trimmed = output.trim();
	if (!trimmed) {
		throw new Error(
			"Scribe extension failed to parse decision output: empty output. Fix: ensure the model returns JSON for decision capture.",
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Scribe extension failed to parse decision output: invalid JSON (${message}). Fix: ensure the scribe prompt returns a single JSON object.`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			"Scribe extension failed to parse decision output: JSON must be an object. Fix: ensure the scribe prompt returns a single JSON object.",
		);
	}

	const payload = parsed as Record<string, unknown>;
	const status = payload.status;
	if (typeof status !== "string") {
		throw new Error(
			"Scribe extension failed to parse decision output: missing status. Fix: ensure status is a string.",
		);
	}
	if (status !== "decision" && status !== "no_decision") {
		throw new Error(
			'Scribe extension failed to parse decision output: invalid status. Fix: ensure status is "decision" or "no_decision".',
		);
	}

	const decision: DecisionOutput = {
		status,
		title: "",
		type: "",
		decision: "",
		why: "",
		impact: "",
		invalidation: "",
	};

	for (const field of DECISION_FIELDS) {
		const value = payload[field];
		if (typeof value === "string") {
			decision[field] = value;
		}
	}

	return decision;
};

const formatDecisionTemplate = (decision: DecisionOutput): string =>
	[
		`## ${decision.title}`,
		"",
		`- Status: ${decision.status}`,
		`- Title: ${decision.title}`,
		`- Type: ${decision.type}`,
		`- Decision: ${decision.decision}`,
		`- Why: ${decision.why}`,
		`- Impact: ${decision.impact}`,
		`- Invalidation: ${decision.invalidation}`,
		"",
	].join("\n");

export const buildDecisionsContent = (existing: string, output: string): string | null => {
	const parsed = parseDecisionOutput(output);
	if (parsed.status === "no_decision") {
		return null;
	}

	const trimmedExisting = existing.trim();
	const header = trimmedExisting.length === 0 ? "# Decisions\n\n" : `${trimmedExisting}\n\n`;
	return `${header}${formatDecisionTemplate(parsed)}`;
};

export const buildConventionsContent = (output: string): string | null => {
	const trimmedOutput = output.trim();
	if (!trimmedOutput) {
		return null;
	}
	return `${trimmedOutput}\n`;
};
