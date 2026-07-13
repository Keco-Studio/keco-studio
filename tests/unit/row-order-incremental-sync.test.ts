import { describe, expect, it } from '@jest/globals';
import { applyRowOrderChangeToAssetStore } from '@/components/libraries/hooks/useLibraryRealtimeHandlers';
import { ObservableAssetStore } from '@/lib/library/assetStore';
import type { RowOrderChangeEvent } from '@/lib/types/collaboration';

describe('incremental row order sync', () => {
  it('applies inserted rows and shifted indices without a server reload', () => {
    const assetStore = new ObservableAssetStore();
    assetStore.set({ id: 'asset-existing', libraryId: 'library-1', name: 'Existing', propertyValues: {}, rowIndex: 2 });

    const event: RowOrderChangeEvent = {
      type: 'roworder:change',
      userId: 'other-user',
      userName: 'Other user',
      timestamp: Date.now(),
      insertedRows: [{
        assetId: 'asset-inserted',
        assetName: 'Inserted',
        propertyValues: { 'field-1': 'Value' },
        createdAt: '2026-07-13T00:00:00.000Z',
        rowIndex: 2,
      }],
      rowIndexUpdates: [{ assetId: 'asset-existing', rowIndex: 3 }],
    };

    applyRowOrderChangeToAssetStore(assetStore, event, 'library-1');

    expect(assetStore.get('asset-existing')?.rowIndex).toBe(3);
    const inserted = assetStore.get('asset-inserted');
    expect(inserted?.name).toBe('Inserted');
    expect(inserted?.rowIndex).toBe(2);
    expect(inserted?.propertyValues['field-1']).toBe('Value');
  });
});
