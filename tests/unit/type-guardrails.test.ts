import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('type guardrails', () => {
  it('wires explicit-any guard into lint', () => {
    expect(pkg.scripts['lint:types']).toBe('tsx scripts/check-no-explicit-any.ts');
    expect(pkg.scripts.lint).toBe('eslint . && npm run lint:types');
  });

  it('scans the high-risk API route touched by this batch', () => {
    const scriptPath = path.join(repoRoot, 'scripts/check-no-explicit-any.ts');
    expect(existsSync(scriptPath)).toBe(true);

    const scriptSource = readFileSync(scriptPath, 'utf8');
    expect(scriptSource).toContain('src/app/api/search/assets/route.ts');
  });

  it('removes explicit any from the typed API route slice', () => {
    const searchAssetsSource = readFileSync(
      path.join(repoRoot, 'src/app/api/search/assets/route.ts'),
      'utf8'
    );
    expect(searchAssetsSource).not.toMatch(/\bany\b/);
  });
});
