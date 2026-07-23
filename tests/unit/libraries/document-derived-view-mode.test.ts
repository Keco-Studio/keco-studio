import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveLibraryViewMode } from '@/components/libraries/libraryViewMode';

describe('document-derived library view mode', () => {
  it('derives each library view from its own immutable export type', () => {
    expect(resolveLibraryViewMode('script')).toBe('script');
    expect(resolveLibraryViewMode('table')).toBe('table');
    expect(resolveLibraryViewMode(null)).toBe('table');
    expect(resolveLibraryViewMode(undefined)).toBe('table');
  });

  it('does not keep derived view mode in sticky component state', () => {
    const table = readFileSync(
      resolve(process.cwd(), 'src/components/libraries/LibraryAssetsTable.tsx'),
      'utf8'
    );
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx'),
      'utf8'
    );

    expect(table).toContain('resolveLibraryViewMode(library?.documentExportType)');
    expect(table).not.toMatch(/useState<['"]table['"] \| ['"]script['"]>/);
    expect(page).toContain('key={library.id}');
  });
});
