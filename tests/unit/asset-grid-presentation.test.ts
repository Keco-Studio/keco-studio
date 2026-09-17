import { describe, expect, it } from '@jest/globals';
import {
  ASSET_GRID_SIZES,
  DEFAULT_ASSET_GRID_SIZE_INDEX,
  getAdminAssetTargetRowHeight,
  isAssetGridListMode,
  nextAssetGridSize,
} from '@/components/libraries/utils/assetGridPresentation';

describe('asset grid presentation', () => {
  it('keeps 100% as the default and exposes a 10% compact lower bound', () => {
    expect(ASSET_GRID_SIZES[DEFAULT_ASSET_GRID_SIZE_INDEX]?.label).toBe('100%');
    expect(ASSET_GRID_SIZES[0]?.label).toBe('10%');
    expect(isAssetGridListMode(0)).toBe(true);
    expect(isAssetGridListMode(DEFAULT_ASSET_GRID_SIZE_INDEX)).toBe(false);
    expect(nextAssetGridSize(0, 100)).toBe(0);
  });

  it('maps shared size levels to admin gallery row heights', () => {
    expect(getAdminAssetTargetRowHeight(1)).toBeLessThan(
      getAdminAssetTargetRowHeight(DEFAULT_ASSET_GRID_SIZE_INDEX),
    );
    expect(getAdminAssetTargetRowHeight(DEFAULT_ASSET_GRID_SIZE_INDEX)).toBe(168);
    expect(getAdminAssetTargetRowHeight(ASSET_GRID_SIZES.length - 1)).toBeGreaterThan(
      getAdminAssetTargetRowHeight(DEFAULT_ASSET_GRID_SIZE_INDEX),
    );
  });

  it('enlarges and shrinks tiles within fixed bounds', () => {
    expect(nextAssetGridSize(DEFAULT_ASSET_GRID_SIZE_INDEX, -100)).toBe(
      DEFAULT_ASSET_GRID_SIZE_INDEX + 1,
    );
    expect(nextAssetGridSize(DEFAULT_ASSET_GRID_SIZE_INDEX, 100)).toBe(
      DEFAULT_ASSET_GRID_SIZE_INDEX - 1,
    );
    expect(nextAssetGridSize(ASSET_GRID_SIZES.length - 1, -100)).toBe(
      ASSET_GRID_SIZES.length - 1,
    );
    expect(nextAssetGridSize(0, 100)).toBe(0);
  });

  it('ignores wheel events without a vertical direction', () => {
    expect(nextAssetGridSize(DEFAULT_ASSET_GRID_SIZE_INDEX, 0)).toBe(
      DEFAULT_ASSET_GRID_SIZE_INDEX,
    );
  });

});
