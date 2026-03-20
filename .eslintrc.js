/** @type {import('eslint').Linter.Config} */
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		project: './tsconfig.json',
	},
	plugins: ['@typescript-eslint', 'import'],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/strict-type-checked',
		'plugin:import/typescript',
		'prettier',
	],
	rules: {
		/* — Strict safety rules — */
		'no-console': 'warn',
		'no-return-await': 'off',
		'@typescript-eslint/return-await': ['error', 'in-try-catch'],
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/no-misused-promises': 'error',
		'@typescript-eslint/strict-boolean-expressions': 'error',
		'@typescript-eslint/no-unnecessary-condition': 'error',
		'@typescript-eslint/prefer-nullish-coalescing': 'error',

		/* — Import hygiene — */
		'import/order': [
			'error',
			{
				groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
				'newlines-between': 'always',
				alphabetize: { order: 'asc' },
			},
		],
		'import/no-duplicates': 'error',

		/* — Code style enforced at lint level — */
		'@typescript-eslint/explicit-function-return-type': [
			'warn',
			{ allowExpressions: true },
		],
		'@typescript-eslint/naming-convention': [
			'error',
			{ selector: 'interface', format: ['PascalCase'], prefix: ['I'] },
			{ selector: 'typeAlias', format: ['PascalCase'] },
			{ selector: 'enum', format: ['PascalCase'] },
		],
	},
	ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
};
