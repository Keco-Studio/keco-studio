import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const segments = [
  'src/app',
  'src/app/(dashboard)/[projectId]',
  'src/app/(dashboard)/[projectId]/[libraryId]',
  'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]',
];

describe('Next app route boundaries', () => {
  it.each(segments)('%s has error, loading, and not-found boundaries', (segment) => {
    for (const file of ['error.tsx', 'loading.tsx', 'not-found.tsx']) {
      expect(existsSync(path.join(repoRoot, segment, file))).toBe(true);
    }
  });

  it.each(segments)('%s error boundary is resettable client component', (segment) => {
    const content = readFileSync(path.join(repoRoot, segment, 'error.tsx'), 'utf8');
    expect(content).toContain("'use client'");
    expect(content).toContain('reset');
    expect(content).toContain('Try again');
  });

  it.each(segments)('%s loading boundary exposes status semantics', (segment) => {
    const content = readFileSync(path.join(repoRoot, segment, 'loading.tsx'), 'utf8');
    expect(content).toContain('role="status"');
  });
});
