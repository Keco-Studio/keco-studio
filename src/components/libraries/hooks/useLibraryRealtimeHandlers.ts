import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type {
  AssetCreateEvent,
  AssetDeleteEvent,
  CellUpdateEvent,
  CellsBatchUpdateEvent,
  RowOrderChangeEvent,
} from '@/lib/types/collaboration';

type UseLibraryRealtimeHandlersArgs = {
  yDoc: Y.Doc;
  yAssets: Y.Map<Y.Map<unknown>>;
  pendingBatchInsertIdsRef: React.MutableRefObject<Set<string>>;
};

function cloneForYjs(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return value;
}

export function applyRowOrderChangeToYAssets(
  yDoc: Y.Doc,
  yAssets: Y.Map<Y.Map<unknown>>,
  event: RowOrderChangeEvent
): void {
  yDoc.transact(() => {
    for (const update of event.rowIndexUpdates ?? []) {
      yAssets.get(update.assetId)?.set('row_index', update.rowIndex);
    }

    for (const row of event.insertedRows ?? []) {
      if (yAssets.has(row.assetId)) continue;
      const yAsset = new Y.Map<unknown>();
      yAsset.set('name', row.assetName);
      yAsset.set('created_at', row.createdAt);
      yAsset.set('row_index', row.rowIndex);
      const yPropertyValues = new Y.Map<unknown>();
      for (const [fieldId, value] of Object.entries(row.propertyValues)) {
        yPropertyValues.set(fieldId, cloneForYjs(value));
      }
      yAsset.set('propertyValues', yPropertyValues);
      yAssets.set(row.assetId, yAsset);
    }
  });
}

export function useLibraryRealtimeHandlers({
  yDoc,
  yAssets,
  pendingBatchInsertIdsRef,
}: UseLibraryRealtimeHandlersArgs) {
  const cellUpdateQueueRef = useRef<CellUpdateEvent[]>([]);
  const cellUpdateFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushCellUpdateQueue = useCallback(() => {
    const events = cellUpdateQueueRef.current;
    cellUpdateQueueRef.current = [];
    if (events.length === 0) return;

    yDoc.transact(() => {
      for (const event of events) {
        const yAsset = yAssets.get(event.assetId);
        if (!yAsset) continue;
        const yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown> | undefined;
        if (!yPropertyValues) continue;
        const currentValue = yPropertyValues.get(event.propertyKey);
        if (JSON.stringify(currentValue) === JSON.stringify(event.newValue)) continue;

        const valueForYjs = cloneForYjs(event.newValue);
        yPropertyValues.set(event.propertyKey, valueForYjs);
        if (event.propertyKey === 'name') {
          yAsset.set('name', valueForYjs ?? '');
        }
      }
    });
  }, [yAssets, yDoc]);

  const handleCellUpdateEvent = useCallback((event: CellUpdateEvent) => {
    cellUpdateQueueRef.current.push(event);
    if (cellUpdateFlushTimerRef.current) clearTimeout(cellUpdateFlushTimerRef.current);
    const delay = cellUpdateQueueRef.current.length > 1 ? 50 : 16;
    cellUpdateFlushTimerRef.current = setTimeout(() => {
      cellUpdateFlushTimerRef.current = null;
      flushCellUpdateQueue();
    }, delay);
  }, [flushCellUpdateQueue]);

  const handleAssetCreateEvent = useCallback((event: AssetCreateEvent) => {
    if (yAssets.has(event.assetId)) return;
    if (pendingBatchInsertIdsRef.current.has(event.assetId)) return;

    const yAsset = new Y.Map<unknown>();
    yAsset.set('name', event.assetName);

    const yPropertyValues = new Y.Map<unknown>();
    Object.entries(event.propertyValues).forEach(([fieldId, value]) => {
      yPropertyValues.set(fieldId, cloneForYjs(value));
    });
    yAsset.set('propertyValues', yPropertyValues);

    const createdAt =
      event.targetCreatedAt ||
      (event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString());
    yAsset.set('created_at', createdAt);
    if (typeof event.rowIndex === 'number') {
      yAsset.set('row_index', event.rowIndex);
    }

    yDoc.transact(() => {
      yAssets.set(event.assetId, yAsset);
    });
  }, [pendingBatchInsertIdsRef, yAssets, yDoc]);

  const handleAssetDeleteEvent = useCallback((event: AssetDeleteEvent) => {
    yDoc.transact(() => {
      yAssets.delete(event.assetId);
    });
  }, [yAssets, yDoc]);

  const handleConflictEvent = useCallback((event: CellUpdateEvent, localValue: unknown) => {
    console.warn('[LibraryDataContext] Conflict detected:', event, localValue);
    handleCellUpdateEvent(event);
  }, [handleCellUpdateEvent]);

  const handleRowOrderChangeEvent = useCallback((event: RowOrderChangeEvent) => {
    applyRowOrderChangeToYAssets(yDoc, yAssets, event);
  }, [yAssets, yDoc]);

  const handleCellsBatchUpdateEvent = useCallback((event: CellsBatchUpdateEvent) => {
    if (event.cells.length === 0) return;
    yDoc.transact(() => {
      for (const { assetId, propertyKey, newValue } of event.cells) {
        const yAsset = yAssets.get(assetId);
        if (!yAsset) continue;
        let valueForYjs = cloneForYjs(newValue);
        if (typeof newValue === 'number' && Number.isNaN(newValue)) {
          valueForYjs = null;
        }
        if (propertyKey === 'name') {
          yAsset.set('name', valueForYjs ?? '');
        } else {
          const yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown> | undefined;
          yPropertyValues?.set(propertyKey, valueForYjs);
        }
      }
    });
  }, [yAssets, yDoc]);

  useEffect(() => {
    return () => {
      if (cellUpdateFlushTimerRef.current) {
        clearTimeout(cellUpdateFlushTimerRef.current);
        cellUpdateFlushTimerRef.current = null;
      }
    };
  }, []);

  return {
    handleCellUpdateEvent,
    handleAssetCreateEvent,
    handleAssetDeleteEvent,
    handleConflictEvent,
    handleRowOrderChangeEvent,
    handleCellsBatchUpdateEvent,
  };
}
