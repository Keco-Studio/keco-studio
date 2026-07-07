import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');
const lineCount = (file: string) => read(file).split(/\r?\n/).length;

describe('library module decomposition guard', () => {
  it('keeps the library data provider as a composition surface', () => {
    const source = read('src/lib/contexts/LibraryDataContext.tsx');

    expect(existsSync(path.join(repoRoot, 'src/lib/library/yjsAssetHydration.ts'))).toBe(true);
    expect(source).toContain('hydrateYAssetsFromRows');
    expect(source).toContain('hydrateYAssetsFromSnapshot');
    expect(source).toContain('touchLibraryUpdatedAt');
    expect(source).not.toContain('async function touchLibraryUpdatedAt');
    expect(lineCount('src/lib/contexts/LibraryDataContext.tsx')).toBeLessThan(1060);
  });

  it('keeps the library assets table as a composition surface', () => {
    const source = read('src/components/libraries/LibraryAssetsTable.tsx');

    expect(existsSync(path.join(repoRoot, 'src/components/libraries/utils/tableStructure.ts'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'src/components/libraries/hooks/useLibraryTableStructure.ts'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'src/components/libraries/components/SectionTabs.tsx'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'src/components/libraries/components/LibraryTableTopBar.tsx'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'src/components/libraries/components/ViewerBanner.tsx'))).toBe(true);
    expect(source).toContain('useLibraryTableStructure');
    expect(source).toContain('LibraryTableTopBar');
    expect(source).not.toContain('const { groups, orderedProperties } = useMemo');
    expect(source).not.toContain('const { scriptColumns, hasScriptColumns } = useMemo');
    expect(lineCount('src/components/libraries/LibraryAssetsTable.tsx')).toBeLessThan(2150);
  });
});
