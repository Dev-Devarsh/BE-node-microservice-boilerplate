/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: ['**/*.test.ts', '**/*.spec.ts'],
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'^@config/(.*)$': '<rootDir>/src/config/$1',
		'^@shared/(.*)$': '<rootDir>/src/shared/$1',
		'^@modules/(.*)$': '<rootDir>/src/modules/$1',
	},
	collectCoverageFrom: [
		'src/**/*.ts',
		'!src/**/*.d.ts',
		'!src/**/index.ts',
		'!src/server.ts',
	],
	coverageThreshold: {
		global: {
			branches: 70,
			functions: 80,
			lines: 80,
			statements: 80,
		},
	},
	clearMocks: true,
	restoreMocks: true,
};
