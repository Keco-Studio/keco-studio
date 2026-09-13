import { describe, expect, it } from '@jest/globals';
import {
  ASSET_GRID_SIZES,
  DEFAULT_ASSET_GRID_SIZE_INDEX,
  isAssetGridListMode,
  nextAssetGridSize,
} from '@/components/libraries/utils/assetGridPresentation';

describe('compact asset grid scale', () => {
  it('keeps the Windows-style scale order with 10% as the list endpoint', () => {
    expect(ASSET_GRID_SIZES.map((size) => size.label)).toEqual([
      '10%',
      '25%',
      '40%',
      '60%',
      '75%',
      '100%',
      '125%',
      '150%',
    ]);
    expect(DEFAULT_ASSET_GRID_SIZE_INDEX).toBe(5);
    expect(ASSET_GRID_SIZES[0]?.layout).toBe('list');
    expect(ASSET_GRID_SIZES.slice(1).every((size) => size.layout === 'grid')).toBe(true);
  });

  it('only enables list mode at the smallest scale', () => {
    expect(isAssetGridListMode(0)).toBe(true);
    expect(isAssetGridListMode(DEFAULT_ASSET_GRID_SIZE_INDEX)).toBe(false);
    expect(isAssetGridListMode(ASSET_GRID_SIZES.length - 1)).toBe(false);
  });

  it('reaches the compact endpoint and remains bounded while zooming', () => {
    let index = DEFAULT_ASSET_GRID_SIZE_INDEX;
    for (let step = 0; step < 20; step += 1) index = nextAssetGridSize(index, 120);
    expect(index).toBe(0);
    expect(isAssetGridListMode(index)).toBe(true);

    for (let step = 0; step < 20; step += 1) index = nextAssetGridSize(index, -120);
    expect(index).toBe(ASSET_GRID_SIZES.length - 1);
    expect(isAssetGridListMode(index)).toBe(false);
  });
});
