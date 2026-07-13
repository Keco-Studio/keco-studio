/** Composes the library channel lifecycle and broadcast API. */

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import type { CellUpdateEvent, OptimisticUpdate } from '@/lib/types/collaboration';
import { useLibraryChannel } from './realtime/useLibraryChannel';
import { useLibraryBroadcasts } from './realtime/useLibraryBroadcasts';
import type {
  ConnectionStatus,
  LibraryChannelRuntime,
  RealtimeSubscriptionConfig,
} from './realtime/types';

export type { ConnectionStatus, RealtimeSubscriptionConfig } from './realtime/types';

export function useRealtimeSubscription(config: RealtimeSubscriptionConfig) {
  const supabase = useSupabase();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const broadcastDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const optimisticUpdatesRef = useRef<Map<string, OptimisticUpdate>>(new Map());
  const queuedUpdatesRef = useRef<CellUpdateEvent[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');
  const [optimisticUpdates, setOptimisticUpdates] =
    useState<Map<string, OptimisticUpdate>>(new Map());
  const [queuedUpdates, setQueuedUpdates] = useState<CellUpdateEvent[]>([]);

  const addOptimisticUpdate = useCallback((update: OptimisticUpdate) => {
    setOptimisticUpdates((previous) => {
      const next = new Map(previous);
      next.set(`${update.assetId}-${update.propertyKey}`, update);
      optimisticUpdatesRef.current = next;
      return next;
    });
  }, []);

  const removeOptimisticUpdate = useCallback((assetId: string, propertyKey: string) => {
    setOptimisticUpdates((previous) => {
      const next = new Map(previous);
      next.delete(`${assetId}-${propertyKey}`);
      optimisticUpdatesRef.current = next;
      return next;
    });
  }, []);

  const queueUpdate = useCallback((event: CellUpdateEvent) => {
    setQueuedUpdates((previous) => {
      const next = [...previous, event];
      queuedUpdatesRef.current = next;
      return next;
    });
  }, []);

  const processQueuedUpdates = useCallback(async () => {
    if (!channelRef.current || queuedUpdatesRef.current.length === 0) return;
    const queued = queuedUpdatesRef.current;
    for (const event of queued) {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'cell:update',
        payload: event,
      });
    }
    queuedUpdatesRef.current = [];
    setQueuedUpdates([]);
  }, []);

  const runtimeRef = useRef<LibraryChannelRuntime>(null as unknown as LibraryChannelRuntime);
  runtimeRef.current = {
    config,
    optimisticUpdatesRef,
    removeOptimisticUpdate,
    processQueuedUpdates,
    setConnectionStatus,
    broadcastDebounceRef,
  };

  useLibraryChannel({
    supabase,
    libraryId: config.libraryId,
    channelRef,
    runtimeRef,
  });

  const broadcastRuntime = useMemo(() => ({
    channelRef,
    broadcastDebounceRef,
    connectionStatus,
    addOptimisticUpdate,
    removeOptimisticUpdate,
    queueUpdate,
  }), [addOptimisticUpdate, connectionStatus, queueUpdate, removeOptimisticUpdate]);
  const broadcasts = useLibraryBroadcasts(config, broadcastRuntime);

  return {
    connectionStatus,
    ...broadcasts,
    optimisticUpdates,
    queuedUpdatesCount: queuedUpdates.length,
  };
}
