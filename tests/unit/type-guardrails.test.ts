import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('type guardrails', () => {
  it('uses ESLint as the explicit-any guardrail', () => {
    expect(pkg.scripts.lint).toBe('eslint .');
    expect(pkg.scripts).not.toHaveProperty('lint:types');
  });

  it('does not keep the retired regex explicit-any scanner', () => {
    const scriptPath = path.join(repoRoot, 'scripts/check-no-explicit-any.ts');
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('removes explicit any from the typed API route slice', () => {
    const searchAssetsSource = readFileSync(
      path.join(repoRoot, 'src/app/api/search/assets/route.ts'),
      'utf8'
    );
    expect(searchAssetsSource).not.toMatch(/\bany\b/);
  });
});
