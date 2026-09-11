import { describe, expect, it } from '@jest/globals';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import {
  ASSET_GRID_SIZES,
  getAssetGridMetadata,
  getAssetGridPreviewUrl,
  getVisibleAssetFocusIndex,
  nextAssetGridSize,
} from '@/components/libraries/utils/assetGridPresentation';

const properties: PropertyConfig[] = [
  { id: 'image', key: 'image', name: 'Image', valueType: 'other', dataType: 'image', orderIndex: 0 },
  { id: 'title', key: 'title', name: 'Title', valueType: 'string', dataType: 'string', orderIndex: 1 },
  { id: 'empty', key: 'empty', name: 'Empty', valueType: 'string', dataType: 'string', orderIndex: 2 },
  { id: 'count', key: 'count', name: 'Count', valueType: 'number', dataType: 'int', orderIndex: 3 },
];

function makeRow(propertyValues: Record<string, unknown>): AssetRow {
  return { id: 'asset-1', libraryId: 'library-1', name: 'Asset 1', propertyValues };
}

describe('asset grid presentation', () => {
  it('enlarges and shrinks tiles within fixed bounds', () => {
    expect(nextAssetGridSize(2, -100)).toBe(3);
    expect(nextAssetGridSize(2, 100)).toBe(1);
    expect(nextAssetGridSize(ASSET_GRID_SIZES.length - 1, -100)).toBe(
      ASSET_GRID_SIZES.length - 1,
    );
    expect(nextAssetGridSize(0, 100)).toBe(0);
  });

  it('ignores wheel events without a vertical direction', () => {
    expect(nextAssetGridSize(2, 0)).toBe(2);
  });

  it('moves a virtualized focus target into the visible asset range', () => {
    expect(getVisibleAssetFocusIndex(3, 12, 23)).toBe(12);
    expect(getVisibleAssetFocusIndex(18, 12, 23)).toBe(18);
    expect(getVisibleAssetFocusIndex(30, 12, 23)).toBe(12);
  });

  it('uses an image field URL from object or persisted JSON values', () => {
    expect(
      getAssetGridPreviewUrl(
        makeRow({ image: { url: 'https://example.test/a.png', fileType: 'image/png' } }),
        properties,
      ),
    ).toBe('https://example.test/a.png');
    expect(
      getAssetGridPreviewUrl(
        makeRow({ image: JSON.stringify({ url: 'blob:https://example.test/id', fileType: 'image/webp' }) }),
        properties,
      ),
    ).toBe('blob:https://example.test/id');
  });

  it('rejects unsafe image URLs and non-image media', () => {
    expect(
      getAssetGridPreviewUrl(
        makeRow({ image: { url: 'javascript:alert(1)', fileType: 'image/png' } }),
        properties,
      ),
    ).toBeNull();
    expect(
      getAssetGridPreviewUrl(
        makeRow({ image: { url: 'https://example.test/a.pdf', fileType: 'application/pdf' } }),
        properties,
      ),
    ).toBeNull();
  });

  it('returns non-empty non-image metadata up to the requested limit', () => {
    expect(
      getAssetGridMetadata(makeRow({ title: 'Hero', empty: '', count: 3 }), properties, 2),
    ).toEqual([
      { label: 'Title', value: 'Hero' },
      { label: 'Count', value: '3' },
    ]);
  });
});
