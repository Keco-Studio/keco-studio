import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { ObservableAssetStore } from '@/lib/library/assetStore';
import { applyReferenceSyncToLocalState } from '@/lib/library/referenceSync';
import { queryKeys } from '@/lib/utils/queryKeys';

describe('asset store reference sync', () => {
  it('applies cloned reference updates and invalidates scoped caches', async () => {
    const assetStore = new ObservableAssetStore();
    assetStore.set({
      id: 'referencing-asset', libraryId: 'library-1', name: 'Shop',
      propertyValues: { 'ref-field': [{ displayValue: 'Old' }] },
    });
    const invalidateQueries = jest.fn<(options: unknown) => Promise<void>>(() => Promise.resolve());
    const nextReferenceValue = [{ assetId: 'source-asset', fieldId: 'name', displayValue: 'New' }];

    applyReferenceSyncToLocalState({
      refUpdates: [{
        referencingAssetId: 'referencing-asset',
        referencingFieldId: 'ref-field',
        referencingLibraryId: 'library-1',
        newReferenceValue: nextReferenceValue,
      }],
      libraryId: 'library-1',
      assetStore,
      queryClient: { invalidateQueries } as unknown as QueryClient,
    });

    const storedValue = assetStore.get('referencing-asset')?.propertyValues['ref-field'];
    expect(storedValue).toEqual(nextReferenceValue);
    expect(storedValue).not.toBe(nextReferenceValue);
    await Promise.resolve();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets('library-1'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.asset('referencing-asset'),
    });
  });
});
