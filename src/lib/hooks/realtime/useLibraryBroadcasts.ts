'use client';

import { useCallback } from 'react';
import type {
  AssetCreateEvent,
  AssetDeleteEvent,
  CellUpdateEvent,
  CellsBatchUpdateEvent,
  RowOrderChangeEvent,
  RowOrderChangePayload,
} from '@/lib/types/collaboration';
import { sendLibraryBroadcast } from '@/lib/realtime/sendLibraryBroadcast';
import type { LibraryBroadcastRuntime, RealtimeSubscriptionConfig } from './types';

export function useLibraryBroadcasts(
  config: RealtimeSubscriptionConfig,
  runtime: LibraryBroadcastRuntime
) {
  const { currentUserId, currentUserName, avatarColor } = config;

  const broadcastCellUpdate = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any,
    updatedAt?: string | null
  ) => {
    if (!runtime.channelRef.current) return;
    const cellKey = `${assetId}-${propertyKey}`;
    const event: CellUpdateEvent = {
      type: 'cell:update',
      userId: currentUserId,
      userName: currentUserName,
      avatarColor,
      assetId,
      propertyKey,
      newValue,
      oldValue,
      timestamp: Date.now(),
      updatedAt,
    };
    runtime.addOptimisticUpdate({
      assetId,
      propertyKey,
      newValue,
      timestamp: event.timestamp,
      updatedAt,
      userId: currentUserId,
    });

    const existingTimer = runtime.broadcastDebounceRef.current.get(cellKey);
    if (existingTimer) clearTimeout(existingTimer);
    const isComplexObject =
      newValue !== null &&
      typeof newValue === 'object' &&
      (newValue.url || newValue.path || newValue.fileName);
    const delay = isComplexObject ? 0 : 500;
    const timer = setTimeout(async () => {
      try {
        const channel = runtime.channelRef.current;
        if (!channel) {
          runtime.queueUpdate(event);
          return;
        }
        // httpSend works without a joined socket; do not queue solely on
        // connectionStatus or optimistic updates can block later remotes.
        await sendLibraryBroadcast(channel, 'cell:update', event);
        setTimeout(() => runtime.removeOptimisticUpdate(assetId, propertyKey), 100);
      } catch (error) {
        console.error('Failed to broadcast cell update:', error);
        runtime.queueUpdate(event);
      } finally {
        runtime.broadcastDebounceRef.current.delete(cellKey);
      }
    }, delay);
    runtime.broadcastDebounceRef.current.set(cellKey, timer);
  }, [avatarColor, currentUserId, currentUserName, runtime]);

  const broadcastAssetCreate = useCallback(async (
    assetId: string,
    assetName: string,
    propertyValues: Record<string, any>,
    options?: {
      insertAfterRowId?: string;
      insertBeforeRowId?: string;
      targetCreatedAt?: string;
    }
  ) => {
    const channel = runtime.channelRef.current;
    if (!channel) return;
    const event: AssetCreateEvent = {
      type: 'asset:create',
      userId: currentUserId,
      userName: currentUserName,
      assetId,
      assetName,
      propertyValues,
      timestamp: Date.now(),
      ...options,
    };
    await sendLibraryBroadcast(channel, 'asset:create', event);
  }, [currentUserId, currentUserName, runtime.channelRef]);

  const broadcastAssetDelete = useCallback(async (assetId: string, assetName: string) => {
    const channel = runtime.channelRef.current;
    if (!channel) return;
    const event: AssetDeleteEvent = {
      type: 'asset:delete',
      userId: currentUserId,
      userName: currentUserName,
      assetId,
      assetName,
      timestamp: Date.now(),
    };
    await sendLibraryBroadcast(channel, 'asset:delete', event);
  }, [currentUserId, currentUserName, runtime.channelRef]);

  const broadcastCellsBatchUpdate = useCallback(async (
    cells: CellsBatchUpdateEvent['cells']
  ) => {
    if (cells.length === 0) return;
    const channel = runtime.channelRef.current;
    if (!channel) return;
    const event: CellsBatchUpdateEvent = {
      type: 'cells:batch-update',
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now(),
      cells,
    };
    await sendLibraryBroadcast(channel, 'cells:batch-update', event);
  }, [currentUserId, currentUserName, runtime.channelRef]);

  const broadcastRowOrderChange = useCallback(async (changes: RowOrderChangePayload) => {
    const channel = runtime.channelRef.current;
    if (!channel) return;
    const event: RowOrderChangeEvent = {
      type: 'roworder:change',
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now(),
      ...changes,
    };
    await sendLibraryBroadcast(channel, 'roworder:change', event);
  }, [currentUserId, currentUserName, runtime.channelRef]);

  return {
    broadcastCellUpdate,
    broadcastAssetCreate,
    broadcastAssetDelete,
    broadcastCellsBatchUpdate,
    broadcastRowOrderChange,
  };
}
