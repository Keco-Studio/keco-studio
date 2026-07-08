import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const dataContextPath = 'src/lib/contexts/LibraryDataContext.tsx';
const tablePath = 'src/components/libraries/LibraryAssetsTable.tsx';

const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');
const exists = (file: string) => existsSync(path.join(repoRoot, file));
const lineCount = (file: string) => read(file).split(/\r?\n/).length;
const countMatches = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return collectFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

const extractionFiles = [
  'src/components/libraries/hooks/useLibraryAssetMutations.ts',
  'src/components/libraries/hooks/useLibraryRealtimeHandlers.ts',
  'src/lib/library/referenceSync.ts',
  'src/components/libraries/components/LibraryAssetsTableBody.tsx',
  'src/components/libraries/components/LibraryAssetDetailDrawerWiring.tsx',
  'src/components/libraries/hooks/useLibraryAssetDetailDrawerUpdate.ts',
  'src/components/libraries/hooks/useLibrarySectionEditing.ts',
  'src/components/libraries/hooks/useLibraryTableFindReplaceWiring.ts',
];

const suppressionPattern = /@ts-ignore|@ts-expect-error|eslint-disable|\bas any\b|:\s*any\b/g;
const skipPattern = /it\.skip\s*\(|describe\.skip\s*\(|\.todo\s*\(|\bxit\s*\(/g;

describe('library module decomposition guard', () => {
  it('locks the accepted line-count thresholds from the completion spec', () => {
    expect(lineCount(tablePath)).toBeLessThanOrEqual(1300);
    expect(lineCount(dataContextPath)).toBeLessThanOrEqual(650);
  });

  it('keeps the library data provider as a composition surface', () => {
    const source = read(dataContextPath);

    expect(exists('src/lib/library/yjsAssetHydration.ts')).toBe(true);
    expect(exists('src/lib/library/updatedAt.ts')).toBe(true);
    expect(exists('src/components/libraries/hooks/useLibraryAssetMutations.ts')).toBe(true);
    expect(exists('src/components/libraries/hooks/useLibraryRealtimeHandlers.ts')).toBe(true);
    expect(exists('src/lib/library/referenceSync.ts')).toBe(true);

    const mutationsSource = read('src/components/libraries/hooks/useLibraryAssetMutations.ts');
    const referenceSyncSource = read('src/lib/library/referenceSync.ts');

    expect(source).toContain('hydrateYAssetsFromRows');
    expect(source).toContain('hydrateYAssetsFromSnapshot');
    expect(source).toContain('useLibraryAssetMutations');
    expect(source).toContain('useLibraryRealtimeHandlers');
    expect(source).toContain('applyReferenceSyncToLocalState');
    expect(source).toContain('syncReferencesAfterSourceChange');
    expect(mutationsSource).toContain('touchLibraryUpdatedAt');
    expect(referenceSyncSource).toContain('syncReferencesForSourceChanges');

    for (const inlineDefinition of [
      'const updateAssetField = useCallback',
      'const updateAssetName = useCallback',
      'const createAsset = useCallback',
      'const deleteAsset = useCallback',
      'const updateMultipleFields = useCallback',
      'const updateAssetsBatch = useCallback',
      'const handleCellUpdateEvent = useCallback',
      'const handleAssetCreateEvent = useCallback',
      'const handleAssetDeleteEvent = useCallback',
      'const handleConflictEvent = useCallback',
      'const handleRowOrderChangeEvent = useCallback',
      'const handleCellsBatchUpdateEvent = useCallback',
      'const applyReferenceSyncToLocalState = useCallback',
      'const syncReferencesAfterSourceChange = useCallback',
      'async function touchLibraryUpdatedAt',
    ]) {
      expect(source).not.toContain(inlineDefinition);
    }
  });

  it('keeps the library assets table as a composition surface', () => {
    const source = read(tablePath);

    expect(exists('src/components/libraries/utils/tableStructure.ts')).toBe(true);
    expect(exists('src/components/libraries/hooks/useLibraryTableStructure.ts')).toBe(true);
    expect(exists('src/components/libraries/components/LibraryAssetsTableBody.tsx')).toBe(true);
    expect(exists('src/components/libraries/components/LibraryAssetDetailDrawerWiring.tsx')).toBe(true);
    expect(exists('src/components/libraries/hooks/useLibrarySectionEditing.ts')).toBe(true);
    expect(exists('src/components/libraries/hooks/useLibraryTableFindReplaceWiring.ts')).toBe(true);

    expect(source).toContain('useLibraryTableStructure');
    expect(source).toContain('LibraryAssetsTableBody');
    expect(source).toContain('LibraryAssetDetailDrawerWiring');
    expect(source).toContain('useLibrarySectionEditing');
    expect(source).toContain('useLibraryTableFindReplaceWiring');

    for (const inlineBlock of [
      'const { groups, orderedProperties } = useMemo',
      'const { scriptColumns, hasScriptColumns } = useMemo',
      '<tbody className={styles.body}>',
      'displayRows.map((row, index) =>',
      'detailDrawerRowId && (() =>',
      'const handleSectionEditStart = useCallback',
      'const handleSectionEditEnd = useCallback',
      'const handleSelectSection = useCallback',
      'const handleAddSectionFromTabs = useCallback',
      "addEventListener('libraryCellSearchHighlightClear'",
    ]) {
      expect(source).not.toContain(inlineBlock);
    }
  });

  it('does not reintroduce Yjs offline persistence or LibraryDataContext data-sync dispatches', () => {
    const dataContextSource = read(dataContextPath);
    const yjsContextSource = read('src/lib/contexts/YjsContext.tsx');

    for (const source of [dataContextSource, yjsContextSource]) {
      expect(source).not.toContain('y-indexeddb');
      expect(source).not.toContain('IndexeddbPersistence');
      expect(source).not.toContain('repopulateWithResetPersistence');
      expect(source).not.toContain('library-${libraryId}');
      expect(source).not.toContain('asset-table-${libraryId}');
    }

    expect(dataContextSource).not.toContain('window.dispatchEvent');
  });

  it('prevents skip inflation and new suppression patterns in decomposition files', () => {
    const testFiles = collectFiles(path.join(repoRoot, 'tests'))
      .concat(collectFiles(path.join(repoRoot, 'src')).filter((file) => /\.test\.tsx?$/.test(file)));
    const activeSkipCount = testFiles.reduce(
      (total, file) => total + countMatches(readFileSync(file, 'utf8'), skipPattern),
      0
    );
    expect(activeSkipCount).toBe(0);

    const topLevelSuppressionCount = [dataContextPath, tablePath].reduce(
      (total, file) => total + countMatches(read(file), suppressionPattern),
      0
    );
    expect(topLevelSuppressionCount).toBeLessThanOrEqual(12);

    for (const file of extractionFiles.filter(exists)) {
      expect(read(file)).not.toMatch(suppressionPattern);
    }
  });
});
