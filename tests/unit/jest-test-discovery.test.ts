import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';

/**
 * Guards issue #162: the script-parser regression tests live under src/, not
 * tests/. They were converted to @jest/globals but jest never collected them
 * because `roots` excluded src/ — CI reported green while they never executed.
 * This asserts jest's own resolver discovers them, testing behavior (what CI
 * actually runs) rather than a config string.
 */
describe('jest test discovery', () => {
  const listed = execFileSync('npx', ['jest', '--listTests'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  it.each([
    'src/lib/script-parser/parser.e2e.test.ts',
    'src/lib/script-parser/parser.structured.test.ts',
    'src/lib/script-parser/parser.superset.test.ts',
  ])('collects %s', (relPath) => {
    expect(listed).toContain(relPath);
  });
});
