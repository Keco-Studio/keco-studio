import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/admin/GameAssetsPage.tsx'),
  'utf8',
);

describe('admin assets gallery zoom wiring', () => {
  it('intercepts modified wheel events and exposes bounded size controls', () => {
    expect(source).toContain('nextAssetGridSize');
    expect(source).toContain('DEFAULT_ASSET_GRID_SIZE_INDEX');
    expect(source).toContain('isAssetGridListMode');
    expect(source).toContain('data-asset-layout={listMode ? \'list\' : \'grid\'}');
    expect(source).toContain('listMode={listMode}');
    expect(source).toContain("element.addEventListener('wheel', handleWheel, { passive: false })");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('data-testid="game-assets-grid"');
    expect(source).toContain('data-testid="asset-size-controls"');
    expect(source).toContain('aria-label="Decrease asset size"');
    expect(source).toContain('aria-label="Increase asset size"');
  });
});
