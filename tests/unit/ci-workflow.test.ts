import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('CI workflow gates', () => {
  it('runs lint, unit tests, and build in CI', () => {
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm run test:unit');
    expect(workflow).toContain('npm run build');
  });

  it('keeps local validate aligned with CI gates', () => {
    expect(pkg.scripts.validate).toBe('npm run lint && npm run test:unit && npm run build');
  });

  it('does not force unit tests to run serially', () => {
    // The unit suite is pure (no shared live DB / global mutable state), so
    // --runInBand only serializes work Jest can parallelize. Keep it off so CI
    // wall time scales with the worker pool, not the sum of suite times.
    expect(workflow).not.toContain('--runInBand');
    expect(pkg.scripts.validate).not.toContain('--runInBand');
  });

  it('uses the ESLint CLI instead of the removed Next lint command', () => {
    expect(pkg.scripts.lint).toBe('eslint .');
  });
});
