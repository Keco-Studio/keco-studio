import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('asset explorer grid wiring', () => {
  it('virtualizes grid rows, responds to wheel zoom, and uses the existing fallback icon', () => {
    const source = read('src/components/libraries/components/LibraryAssetsGrid.tsx');

    expect(source).toContain('useVirtualizer');
    expect(source).toContain('nextAssetGridSize');
    expect(source).toContain("@/assets/images/AssetTableIcon.svg");
    expect(source).toContain('data-testid="library-assets-grid"');
    expect(source).not.toContain('rows.map((row');
    expect(source).toContain('onError');
    expect(source).toContain('aria-rowindex');
    expect(source).toContain('aria-colindex');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("closest('[data-asset-card]')");
  });

  it('defaults the library to grid while retaining the existing table view', () => {
    const source = read('src/components/libraries/LibraryAssetsTable.tsx');

    expect(source).toContain("useState<'grid' | 'table'>('grid')");
    expect(source).toContain('<LibraryAssetsGrid');
    expect(source).toContain('aria-label="Grid view"');
    expect(source).toContain('aria-label="Table view"');
    expect(source).toContain('<LibraryAssetsTableBody');
    expect(source).toContain('handleAssetViewModeChange');
    expect(source).toContain('preferTargetRow: true');
  });

  it('selects the context-clicked grid row without reusing hidden table selections', () => {
    const source = read('src/components/libraries/hooks/useContextMenu.ts');

    expect(source).toContain('preferTargetRow?: boolean');
    expect(source).toContain('setSelectedRowIds(new Set([row.id]))');
    expect(source).toContain('setSelectedCells(new Set())');
  });
});
