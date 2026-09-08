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
    '^.+[\\\\/](?:sanctionedMdxParser\\.ts|AssistantMarkdown\\.tsx)$': '<rootDir>/tests/helpers/esbuild-jest-transformer.cjs',
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Prefer asset/style stubs before the generic @/ rewrite so Jest never
    // tries to parse raw SVG/CSS from src/ (breaks PanelHeader and friends).
    '^@/assets/.*\\.svg$': '<rootDir>/tests/helpers/fileMock.cjs',
    '^@/.*\\.module\\.css$': '<rootDir>/tests/helpers/styleMock.cjs',
    '^@/.*\\.(css|less|scss|sass)$': '<rootDir>/tests/helpers/styleMock.cjs',
    '\\.svg$': '<rootDir>/tests/helpers/fileMock.cjs',
    '\\.module\\.css$': '<rootDir>/tests/helpers/styleMock.cjs',
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/helpers/styleMock.cjs',
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
