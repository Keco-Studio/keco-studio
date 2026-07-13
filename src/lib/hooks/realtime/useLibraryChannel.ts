'use client';

import { useEffect, type MutableRefObject } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { resolveConflict } from '@/lib/realtime/conflict-resolution';
import {
  advanceRealtimeConnection,
  type RealtimeConnectionPhase,
} from '@/lib/realtime/reconnect-reconciliation';
import type {
  AssetCreateEvent,
  AssetDeleteEvent,
  CellUpdateEvent,
  CellsBatchUpdateEvent,
  RowOrderChangeEvent,
} from '@/lib/types/collaboration';
import type { LibraryChannelRuntime } from './types';

export function useLibraryChannel({
  supabase,
  libraryId,
  channelRef,
  runtimeRef,
}: {
  supabase: SupabaseClient;
  libraryId: string;
  channelRef: MutableRefObject<RealtimeChannel | null>;
  runtimeRef: MutableRefObject<LibraryChannelRuntime>;
}) {
  useEffect(() => {
    if (!libraryId) return;

    const runtime = () => runtimeRef.current;
    runtime().setConnectionStatus('connecting');
    const channel = supabase.channel(`library:${libraryId}:edits`, {
      config: { broadcast: { ack: false } },
    });
    channelRef.current = channel;
    let connectionPhase: RealtimeConnectionPhase = 'initial';
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const handleStatus = (status: string) => {
      const transition = advanceRealtimeConnection(connectionPhase, status);
      connectionPhase = transition.phase;
      if (status === 'SUBSCRIBED') {
        runtime().setConnectionStatus('connected');
        void runtime().processQueuedUpdates();
        if (transition.shouldReconcile) {
          const reconnect = runtime().config.onReconnect;
          if (reconnect) {
            void Promise.resolve(reconnect()).catch((error) => {
              console.error('[useLibraryChannel] Reconciliation failed:', error);
            });
          }
        }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        runtime().setConnectionStatus('disconnected');
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          runtime().setConnectionStatus('reconnecting');
          channel.subscribe();
        }, 2_000);
      }
    };

    channel
      .on('broadcast', { event: 'cell:update' }, (payload) => {
        const event = payload.payload as CellUpdateEvent;
        const current = runtime();
        if (event.userId === current.config.currentUserId) return;
        const key = `${event.assetId}-${event.propertyKey}`;
        const optimistic = current.optimisticUpdatesRef.current.get(key);
        if (!optimistic) {
          current.config.onCellUpdate(event);
          return;
        }
        if (resolveConflict(optimistic, event).winner === 'remote') {
          current.config.onConflict(event, optimistic.newValue);
          current.removeOptimisticUpdate(event.assetId, event.propertyKey);
        }
      })
      .on('broadcast', { event: 'asset:create' }, (payload) => {
        const event = payload.payload as AssetCreateEvent;
        const config = runtime().config;
        if (event.userId !== config.currentUserId) config.onAssetCreate(event);
      })
      .on('broadcast', { event: 'asset:delete' }, (payload) => {
        const event = payload.payload as AssetDeleteEvent;
        const config = runtime().config;
        if (event.userId !== config.currentUserId) config.onAssetDelete(event);
      })
      .on('broadcast', { event: 'roworder:change' }, (payload) => {
        const event = payload.payload as RowOrderChangeEvent;
        const config = runtime().config;
        if (event.userId !== config.currentUserId) config.onRowOrderChange?.(event);
      })
      .on('broadcast', { event: 'cells:batch-update' }, (payload) => {
        const event = payload.payload as CellsBatchUpdateEvent;
        const config = runtime().config;
        if (event.userId !== config.currentUserId) config.onCellsBatchUpdate?.(event);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'library_versions' },
        (payload) => runtime().config.onVersionChange?.(payload)
      )
      .on('system', {}, (payload) => handleStatus(String(payload.status ?? '')))
      .subscribe(handleStatus);

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      runtime().broadcastDebounceRef.current.forEach(clearTimeout);
      runtime().broadcastDebounceRef.current.clear();
      void channel.unsubscribe();
      channelRef.current = null;
      runtime().setConnectionStatus('disconnected');
    };
  }, [libraryId, supabase]);
}
