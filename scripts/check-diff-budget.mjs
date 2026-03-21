import { execSync } from "node:child_process";

const TOTAL_BUDGET = 500;
const FILE_BUDGET = 200;

const run = (command) => execSync(command, { encoding: "utf8" }).trim();

const hasRef = (ref) => {
	try {
		run(`git rev-parse --verify ${ref}`);
		return true;
	} catch {
		return false;
	}
};

const baseRef = process.env.DIFF_BASE
	? process.env.DIFF_BASE
	: hasRef("origin/main")
		? "origin/main"
		: hasRef("main")
			? "main"
			: "HEAD~1";

const diff = run(`git diff --numstat ${baseRef}...HEAD`);

if (!diff) {
	process.exit(0);
}

let total = 0;
const offenders = [];

for (const line of diff.split("\n")) {
	const [addedRaw, deletedRaw, file] = line.split("\t");
	if (!file) continue;
	const added = Number.parseInt(addedRaw, 10) || 0;
	const deleted = Number.parseInt(deletedRaw, 10) || 0;
	const delta = added + deleted;
	total += delta;
	if (delta > FILE_BUDGET) {
		offenders.push({ file, delta });
	}
}

if (total > TOTAL_BUDGET || offenders.length > 0) {
	const lines = [
		`Diff budget exceeded. Total: ${total} (limit ${TOTAL_BUDGET}).`,
		...offenders.map((entry) => `File: ${entry.file} -> ${entry.delta} (limit ${FILE_BUDGET}).`),
	];
	console.error(lines.join("\n"));
	process.exit(1);
}
