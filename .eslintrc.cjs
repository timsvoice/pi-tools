module.exports = {
	root: true,
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
	},
	ignorePatterns: ["node_modules/", "dist/", "docs/", "pi-mono/"],
	rules: {
		complexity: ["error", 10],
	},
};
