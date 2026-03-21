module.exports = {
	root: true,
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
	},
	ignorePatterns: ["node_modules/", "dist/", "docs/"],
	rules: {
		complexity: ["error", 10],
	},
};
