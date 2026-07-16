/**
 * Jest configuration.
 *
 * Authored as .mjs (not .ts) so `jest` can load it on a clean checkout without
 * requiring ts-node to compile the config file (see issue #162).
 *
 * @type {import('jest').Config}
 */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Both tests/ (the main suite) and src/ (colocated script-parser regression
  // tests from issue #162) — omitting src/ silently skips those in CI.
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+[\\\\/]sanctionedMdxParser\\.ts$': '<rootDir>/tests/helpers/esbuild-jest-transformer.cjs',
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
};

export default config;
