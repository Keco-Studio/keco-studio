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
    expect(workflow).toContain('npm run test:unit -- --runInBand');
    expect(workflow).toContain('npm run build');
  });

  it('keeps local validate aligned with CI gates', () => {
    expect(pkg.scripts.validate).toBe('npm run lint && npm run test:unit -- --runInBand && npm run build');
  });

  it('uses the ESLint CLI instead of the removed Next lint command', () => {
    expect(pkg.scripts.lint).toBe('eslint .');
  });
});
