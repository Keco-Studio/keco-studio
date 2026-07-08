import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const e2eRoot = path.join(repoRoot, 'tests/e2e');
const helperPath = 'tests/e2e/utils/auth-storage.ts';

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return collectFiles(fullPath);
    return entry.endsWith('.ts') ? [fullPath] : [];
  });
}

function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

describe('e2e auth storage helpers', () => {
  it('centralizes Supabase auth-token waits so tests check both browser storages', () => {
    const helperSource = readFileSync(path.join(repoRoot, helperPath), 'utf8');
    expect(helperSource).toContain('sessionStorage');
    expect(helperSource).toContain('localStorage');

    const offenders = collectFiles(e2eRoot)
      .map((file) => ({ file: relative(file), source: readFileSync(file, 'utf8') }))
      .filter(({ file }) => file !== helperPath)
      .filter(({ source }) => source.includes('auth-token'))
      .filter(
        ({ source }) =>
          source.includes('Object.keys(sessionStorage)') ||
          source.includes('sessionStorage.getItem(key)')
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
