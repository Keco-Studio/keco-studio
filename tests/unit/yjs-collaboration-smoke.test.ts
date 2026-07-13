import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import { applyReferenceSyncToLocalState } from '@/lib/library/referenceSync';
import { queryKeys } from '@/lib/utils/queryKeys';

function createYAsset(name: string, propertyValues: Record<string, unknown>) {
  const yAsset = new Y.Map<unknown>();
  const yPropertyValues = new Y.Map<unknown>();
  Object.entries(propertyValues).forEach(([key, value]) => {
    yPropertyValues.set(key, value);
  });
  yAsset.set('name', name);
  yAsset.set('propertyValues', yPropertyValues);
  return { yAsset, yPropertyValues };
}

describe('Yjs collaboration reference sync smoke', () => {
  it('applies local reference updates into the in-memory Yjs asset map', async () => {
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    const { yAsset, yPropertyValues } = createYAsset('Shop', {
      'ref-field': [{ assetId: 'source-asset', fieldId: 'name', displayValue: 'Old' }],
    });
    yAssets.set('referencing-asset', yAsset);

    const invalidateQueries = jest.fn<(options: unknown) => Promise<void>>(() => Promise.resolve());
    const refetchQueries = jest.fn<(options: unknown) => Promise<void>>(() => Promise.resolve());
    const loadInitialData = jest.fn<() => Promise<void>>(() => Promise.resolve());
    const nextReferenceValue = [{ assetId: 'source-asset', fieldId: 'name', displayValue: 'New' }];

    applyReferenceSyncToLocalState({
      refUpdates: [
        {
          referencingAssetId: 'referencing-asset',
          referencingFieldId: 'ref-field',
          referencingLibraryId: 'library-1',
          newReferenceValue: nextReferenceValue,
        },
      ],
      libraryId: 'library-1',
      yDoc,
      yAssets,
      queryClient: { invalidateQueries, refetchQueries } as unknown as QueryClient,
      loadInitialData,
    });

    expect(yPropertyValues.get('ref-field')).toEqual(nextReferenceValue);
    expect(yPropertyValues.get('ref-field')).not.toBe(nextReferenceValue);
    expect(loadInitialData).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets('library-1'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.asset('referencing-asset'),
    });
  });
});
