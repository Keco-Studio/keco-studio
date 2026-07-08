import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

describe('TypeScript strictness API slice guard', () => {
  it('configures no-explicit-any as error for API routes and warn elsewhere', () => {
    const source = read('eslint.config.mjs');

    expect(source).toContain("from 'typescript-eslint'");
    expect(source).toContain("files: ['src/app/api/**/*.{ts,tsx}']");
    expect(source).toContain("'@typescript-eslint/no-explicit-any': 'error'");
    expect(source).toContain("files: ['src/**/*.{ts,tsx}']");
    expect(source).toContain("ignores: ['src/app/api/**/*.{ts,tsx}']");
    expect(source).toContain("'@typescript-eslint/no-explicit-any': 'warn'");
  });

  it('adds a strict scoped tsconfig for API route typechecking', () => {
    const tsconfig = JSON.parse(read('tsconfig.api.json')) as {
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    };

    expect(tsconfig.compilerOptions?.noImplicitAny).toBe(true);
    expect(tsconfig.compilerOptions?.strictNullChecks).toBe(true);
    expect(tsconfig.include).toEqual(['src/app/api/**/*.ts', 'src/app/api/**/*.tsx']);
  });

  it('keeps the explicit-any guard focused on the three named API routes', () => {
    const source = read('scripts/check-no-explicit-any.ts');

    expect(source).toContain("src/app/api/projects/[projectId]/libraries/route.ts");
    expect(source).toContain('src/app/api/search/assets/route.ts');
    expect(source).toContain('src/app/api/export/route.ts');
  });
});
