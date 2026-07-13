import { useCallback, useEffect, useRef } from 'react';
import type {
  AssetCreateEvent,
  AssetDeleteEvent,
  CellUpdateEvent,
  CellsBatchUpdateEvent,
  RowOrderChangeEvent,
} from '@/lib/types/collaboration';
import {
  cloneStoreValue,
  type ObservableAssetStore,
} from '@/lib/library/assetStore';

type UseLibraryRealtimeHandlersArgs = {
  assetStore: ObservableAssetStore;
  libraryId: string;
  pendingBatchInsertIdsRef: React.MutableRefObject<Set<string>>;
};

export function applyRowOrderChangeToAssetStore(
  assetStore: ObservableAssetStore,
  event: RowOrderChangeEvent,
  libraryId: string
): void {
  assetStore.transact(() => {
    for (const update of event.rowIndexUpdates ?? []) {
      const asset = assetStore.get(update.assetId);
      if (asset) assetStore.set({ ...asset, rowIndex: update.rowIndex });
    }
    for (const row of event.insertedRows ?? []) {
      if (assetStore.has(row.assetId)) continue;
      assetStore.set({
        id: row.assetId,
        libraryId,
        name: row.assetName,
        propertyValues: cloneStoreValue(row.propertyValues),
        created_at: row.createdAt,
        rowIndex: row.rowIndex,
      });
    }
  });
}

export function useLibraryRealtimeHandlers({
  assetStore,
  libraryId,
  pendingBatchInsertIdsRef,
}: UseLibraryRealtimeHandlersArgs) {
  const cellUpdateQueueRef = useRef<CellUpdateEvent[]>([]);
  const cellUpdateFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushCellUpdateQueue = useCallback(() => {
    const events = cellUpdateQueueRef.current;
    cellUpdateQueueRef.current = [];
    if (events.length === 0) return;

    assetStore.transact(() => {
      for (const event of events) {
        const asset = assetStore.get(event.assetId);
        if (!asset) continue;
        const currentValue = asset.propertyValues[event.propertyKey];
        if (JSON.stringify(currentValue) === JSON.stringify(event.newValue)) continue;
        const nextValue = cloneStoreValue(event.newValue);
        assetStore.set({
          ...asset,
          name: event.propertyKey === 'name' ? String(nextValue ?? '') : asset.name,
          propertyValues: {
            ...asset.propertyValues,
            [event.propertyKey]: nextValue,
          },
        });
      }
    });
  }, [assetStore]);

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
    if (assetStore.has(event.assetId)) return;
    if (pendingBatchInsertIdsRef.current.has(event.assetId)) return;
    assetStore.set({
      id: event.assetId,
      libraryId,
      name: event.assetName,
      propertyValues: cloneStoreValue(event.propertyValues),
      created_at:
        event.targetCreatedAt ||
        (event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString()),
      rowIndex: event.rowIndex,
    });
  }, [assetStore, libraryId, pendingBatchInsertIdsRef]);

  const handleAssetDeleteEvent = useCallback((event: AssetDeleteEvent) => {
    assetStore.delete(event.assetId);
  }, [assetStore]);

  const handleConflictEvent = useCallback((event: CellUpdateEvent, localValue: unknown) => {
    console.warn('[LibraryDataContext] Conflict detected:', event, localValue);
    handleCellUpdateEvent(event);
  }, [handleCellUpdateEvent]);

  const handleRowOrderChangeEvent = useCallback((event: RowOrderChangeEvent) => {
    applyRowOrderChangeToAssetStore(assetStore, event, libraryId);
  }, [assetStore, libraryId]);

  const handleCellsBatchUpdateEvent = useCallback((event: CellsBatchUpdateEvent) => {
    assetStore.transact(() => {
      for (const { assetId, propertyKey, newValue } of event.cells) {
        const asset = assetStore.get(assetId);
        if (!asset) continue;
        const nextValue =
          typeof newValue === 'number' && Number.isNaN(newValue)
            ? null
            : cloneStoreValue(newValue);
        assetStore.set({
          ...asset,
          name: propertyKey === 'name' ? String(nextValue ?? '') : asset.name,
          propertyValues:
            propertyKey === 'name'
              ? asset.propertyValues
              : { ...asset.propertyValues, [propertyKey]: nextValue },
        });
      }
    });
  }, [assetStore]);

  useEffect(() => () => {
    if (cellUpdateFlushTimerRef.current) clearTimeout(cellUpdateFlushTimerRef.current);
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
