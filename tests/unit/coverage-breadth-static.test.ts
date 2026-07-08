import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredCoverageFiles = [
  'tests/unit/auth/proxy-policy.test.ts',
  'tests/unit/auth/supabase-server-client.test.ts',
  'tests/unit/project-delete-server-boundary.test.ts',
  'tests/unit/api-libraries-route.test.ts',
  'tests/unit/api-search-assets-route.test.ts',
  'tests/unit/api-export-route.test.ts',
  'tests/unit/services-touched-breadth.test.ts',
  'tests/unit/yjs-collaboration-smoke.test.ts',
];

describe('coverage breadth guard', () => {
  it('keeps Batch D coverage across auth, API routes, services, and Yjs/collaboration', () => {
    const missing = requiredCoverageFiles.filter((file) => !existsSync(path.join(repoRoot, file)));
    expect(missing).toEqual([]);
  });

  it('covers the API routes named by the completion spec', () => {
    const routeTests = [
      ['tests/unit/api-libraries-route.test.ts', 'src/app/api/projects/[projectId]/libraries/route'],
      ['tests/unit/api-search-assets-route.test.ts', 'src/app/api/search/assets/route'],
      ['tests/unit/api-export-route.test.ts', 'src/app/api/export/route'],
    ];

    const missingImports = routeTests
      .filter(([testFile, routeImport]) => {
        const fullPath = path.join(repoRoot, testFile);
        const aliasImport = routeImport.replace(/^src\//, '@/');
        if (!existsSync(fullPath)) return true;
        const source = readFileSync(fullPath, 'utf8');
        return !source.includes(routeImport) && !source.includes(aliasImport);
      })
      .map(([testFile]) => testFile);

    expect(missingImports).toEqual([]);
  });
});
