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
  it.each(segments)('%s has error and not-found boundaries', (segment) => {
    for (const file of ['error.tsx', 'not-found.tsx']) {
      expect(existsSync(path.join(repoRoot, segment, file))).toBe(true);
    }
  });

  // loading.tsx is intentionally NOT added on these segments. Auth is gated
  // client-side (DashboardLayout renders AuthForm when unauthenticated), so the
  // login screen lives inside the (dashboard) group and / redirects to /projects.
  // A route-level loading.tsx inserts a server Suspense fallback on the hot path
  // (/, /projects, /[projectId]) that races the client auth tree and delays
  // networkidle, flaking the E2E auth/nav suites. Keep these segments free of it.
  it.each(segments)('%s does not add a route-level loading boundary', (segment) => {
    expect(existsSync(path.join(repoRoot, segment, 'loading.tsx'))).toBe(false);
  });

  it.each(segments)('%s error boundary is resettable client component', (segment) => {
    const content = readFileSync(path.join(repoRoot, segment, 'error.tsx'), 'utf8');
    expect(content).toContain("'use client'");
    expect(content).toContain('reset');
    expect(content).toContain('Try again');
  });
});
