import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';
import { applyRowOrderChangeToYAssets } from '@/components/libraries/hooks/useLibraryRealtimeHandlers';
import type { RowOrderChangeEvent } from '@/lib/types/collaboration';

describe('incremental row order sync', () => {
  it('applies inserted rows and shifted indices without a server reload', () => {
    const yDoc = new Y.Doc();
    const yAssets = yDoc.getMap<Y.Map<unknown>>('assets');
    const existing = new Y.Map<unknown>();
    existing.set('name', 'Existing');
    existing.set('propertyValues', new Y.Map<unknown>());
    existing.set('row_index', 2);
    yAssets.set('asset-existing', existing);

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

    applyRowOrderChangeToYAssets(yDoc, yAssets, event);

    expect(existing.get('row_index')).toBe(3);
    const inserted = yAssets.get('asset-inserted');
    expect(inserted?.get('name')).toBe('Inserted');
    expect(inserted?.get('row_index')).toBe(2);
    expect(
      (inserted?.get('propertyValues') as Y.Map<unknown>).get('field-1')
    ).toBe('Value');
  });
});
