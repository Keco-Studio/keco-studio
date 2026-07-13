/**
 * useRealtimeSubscription Hook
 * 
 * Manages Supabase Realtime subscriptions for collaborative editing.
 * Handles:
 * - Cell update broadcasts
 * - Asset creation/deletion events
 * - Conflict detection and resolution
 * - Optimistic updates management
 * - Connection status tracking
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { resolveConflict } from '@/lib/realtime/conflict-resolution';
import {
  advanceRealtimeConnection,
  type RealtimeConnectionPhase,
} from '@/lib/realtime/reconnect-reconciliation';
import type {
  CellUpdateEvent,
  AssetCreateEvent,
  AssetDeleteEvent,
  OptimisticUpdate,
  RowOrderChangeEvent,
  CellsBatchUpdateEvent,
} from '@/lib/types/collaboration';

export type RealtimeSubscriptionConfig = {
  libraryId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
  avatarColor: string;
  onCellUpdate: (event: CellUpdateEvent) => void;
  onAssetCreate: (event: AssetCreateEvent) => void;
  onAssetDelete: (event: AssetDeleteEvent) => void;
  onConflict: (event: CellUpdateEvent, localValue: any) => void;
  /** Callback for row order changes, such as insert above/below or batch reordering. */
  onRowOrderChange?: (event: RowOrderChangeEvent) => void;
  /** Callback for batched cell updates, such as Clear Content. */
  onCellsBatchUpdate?: (event: CellsBatchUpdateEvent) => void;
  /** Reconcile authoritative data after a disconnected channel resubscribes. */
  onReconnect?: () => void | Promise<void>;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export function useRealtimeSubscription(config: RealtimeSubscriptionConfig) {
  const supabase = useSupabase();
  const {
    libraryId,
    currentUserId,
    currentUserName,
    currentUserEmail,
    avatarColor,
    onCellUpdate,
    onAssetCreate,
    onAssetDelete,
    onConflict,
    onRowOrderChange,
    onCellsBatchUpdate,
    onReconnect,
  } = config;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, OptimisticUpdate>>(new Map());
  const [queuedUpdates, setQueuedUpdates] = useState<CellUpdateEvent[]>([]);

  const optimisticUpdatesRef = useRef<Map<string, OptimisticUpdate>>(new Map());
  const queuedUpdatesRef = useRef<CellUpdateEvent[]>([]);
  const handlersRef = useRef({
    currentUserId,
    onCellUpdate,
    onAssetCreate,
    onAssetDelete,
    onConflict,
    onRowOrderChange,
    onCellsBatchUpdate,
    onReconnect,
  });
  handlersRef.current = {
    currentUserId,
    onCellUpdate,
    onAssetCreate,
    onAssetDelete,
    onConflict,
    onRowOrderChange,
    onCellsBatchUpdate,
    onReconnect,
  };

  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /**
   * Add an optimistic update to the tracking map
   */
  const addOptimisticUpdate = useCallback((update: OptimisticUpdate) => {
    const cellKey = `${update.assetId}-${update.propertyKey}`;
    setOptimisticUpdates(prev => {
      const next = new Map(prev);
      next.set(cellKey, update);
      optimisticUpdatesRef.current = next;
      return next;
    });
  }, []);

  /**
   * Remove an optimistic update from the tracking map
   */
  const removeOptimisticUpdate = useCallback((assetId: string, propertyKey: string) => {
    const cellKey = `${assetId}-${propertyKey}`;
    setOptimisticUpdates(prev => {
      const next = new Map(prev);
      next.delete(cellKey);
      optimisticUpdatesRef.current = next;
      return next;
    });
  }, []);

  /**
   * Check if there's a pending optimistic update for a cell
   */
  const getOptimisticUpdate = useCallback((assetId: string, propertyKey: string): OptimisticUpdate | undefined => {
    const cellKey = `${assetId}-${propertyKey}`;
    return optimisticUpdatesRef.current.get(cellKey);
  }, []);

  /**
   * Handle incoming cell update events with conflict detection
   */
  const handleCellUpdateEvent = useCallback((payload: any) => {
    // console.log('[useRealtimeSubscription] 📨 Received broadcast message:', payload);
    const event = payload.payload as CellUpdateEvent;
    const { currentUserId, onCellUpdate, onConflict } = handlersRef.current;
    // console.log('[useRealtimeSubscription] Event details:', { 
    //   eventUserId: event.userId, 
    //   currentUserId, 
    //   assetId: event.assetId, 
    //   propertyKey: event.propertyKey,
    //   newValue: event.newValue 
    // });

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      // console.log('[useRealtimeSubscription] 🚫 Ignoring own broadcast');
      return;
    }

    // console.log('[useRealtimeSubscription] ✅ Processing broadcast from another user');
    const optimistic = getOptimisticUpdate(event.assetId, event.propertyKey);

    if (optimistic) {
      const resolution = resolveConflict(optimistic, event);
      if (resolution.winner === 'remote') {
        onConflict(event, optimistic.newValue);
        removeOptimisticUpdate(event.assetId, event.propertyKey);
      }
    } else {
      // No conflict, apply the update
      // console.log('[useRealtimeSubscription] ✅ No conflict, applying update');
      onCellUpdate(event);
    }
  }, [getOptimisticUpdate, removeOptimisticUpdate]);

  /**
   * Handle incoming asset creation events
   */
  const handleAssetCreateEvent = useCallback((payload: any) => {
    const event = payload.payload as AssetCreateEvent;
    const { currentUserId, onAssetCreate } = handlersRef.current;

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      return;
    }

    onAssetCreate(event);
  }, []);

  /**
   * Handle incoming asset deletion events
   */
  const handleAssetDeleteEvent = useCallback((payload: any) => {
    const event = payload.payload as AssetDeleteEvent;
    const { currentUserId, onAssetDelete } = handlersRef.current;

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      return;
    }

    onAssetDelete(event);
  }, []);

  /**
   * Handle incoming row order change events.
   * Filter out our own broadcasts: the sender already called loadInitialData()
   * inside createAsset, so processing our own event again would trigger a
   * redundant full data refresh (yAssets.clear + repopulate), causing the
   * newly inserted row to flicker (appear → disappear → reappear).
   */
  const handleRowOrderChangeEvent = useCallback((payload: any) => {
    const { currentUserId, onRowOrderChange } = handlersRef.current;
    if (!onRowOrderChange) return;
    const event = payload.payload as RowOrderChangeEvent;
    if (event.userId === currentUserId) return;

    onRowOrderChange(event);
  }, []);

  /**
   * Handle incoming cells batch update events (e.g. Clear Content).
   * Like Delete Row, collaborators receive and apply every change at once.
   */
  const handleCellsBatchUpdateEvent = useCallback((payload: any) => {
    const { currentUserId, onCellsBatchUpdate } = handlersRef.current;
    if (!onCellsBatchUpdate) return;
    const event = payload.payload as CellsBatchUpdateEvent;
    if (event.userId === currentUserId) return;
    onCellsBatchUpdate(event);
  }, []);

  const queueUpdate = useCallback((event: CellUpdateEvent) => {
    setQueuedUpdates((previous) => {
      const next = [...previous, event];
      queuedUpdatesRef.current = next;
      return next;
    });
  }, []);

  /**
   * Broadcast a cell update to all other clients
   * Debounced to 500ms to reduce network traffic
   */
  const broadcastCellUpdate = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any,
    updatedAt?: string | null
  ): Promise<void> => {
    // console.log('[useRealtimeSubscription] broadcastCellUpdate called:', { 
    //   assetId, 
    //   propertyKey, 
    //   hasChannel: !!channelRef.current,
    //   connectionStatus 
    // });
    
    if (!channelRef.current) {
      console.warn('[useRealtimeSubscription] ❌ Cannot broadcast: channel not initialized');
      return;
    }

    const cellKey = `${assetId}-${propertyKey}`;
    const timestamp = Date.now();
    const event: CellUpdateEvent = {
      type: 'cell:update',
      userId: currentUserId,
      userName: currentUserName,
      avatarColor,
      assetId,
      propertyKey,
      newValue,
      oldValue,
      timestamp,
      updatedAt,
    };

    // console.log('[useRealtimeSubscription] Created broadcast event:', event);

    // Add to optimistic updates
    addOptimisticUpdate({
      assetId,
      propertyKey,
      newValue,
      timestamp,
      updatedAt,
      userId: currentUserId,
    });

    // Clear existing debounce timer for this cell
    const existingTimer = broadcastDebounceRef.current.get(cellKey);
    if (existingTimer) {
      // console.log('[useRealtimeSubscription] Clearing existing debounce timer');
      clearTimeout(existingTimer);
    }

    // For complex objects (image/file metadata), broadcast immediately without debounce
    // For simple values, debounce to 500ms to reduce network traffic
    const isComplexObject = newValue !== null && typeof newValue === 'object' && 
                            (newValue.url || newValue.path || newValue.fileName);
    const debounceDelay = isComplexObject ? 0 : 500;
    
    // console.log('[useRealtimeSubscription] Setting up debounce timer:', debounceDelay, 'ms', 
                // isComplexObject ? '(complex object, no debounce)' : '(simple value, debounced)');
    
    const debounceTimer = setTimeout(async () => {
      // console.log('[useRealtimeSubscription] ⏰ Debounce timer fired, checking connection status:', connectionStatus);
      
      // For immediate broadcasts (debounceDelay=0), check if channel is still valid
      if (debounceDelay === 0 && !channelRef.current) {
        console.warn('[useRealtimeSubscription] ❌ Channel lost during immediate broadcast, queuing update');
        queueUpdate(event);
        broadcastDebounceRef.current.delete(cellKey);
        return;
      }
      
      try {
        // If disconnected, queue the update
        if (connectionStatus !== 'connected') {
          console.warn('[useRealtimeSubscription] ⚠️ Not connected, queuing update. Status:', connectionStatus);
          queueUpdate(event);
          broadcastDebounceRef.current.delete(cellKey);
          return;
        }
        
        // console.log('[useRealtimeSubscription] ✅ Connection status is connected, proceeding with broadcast');

        if (!channelRef.current) {
          return;
        }

        // console.log('[useRealtimeSubscription] 📤 Sending broadcast:', { 
        //   type: 'broadcast',
        //   event: 'cell:update',
        //   payload: event,
        //   channel: channelRef.current 
        // });
        
        const sendResult = await channelRef.current.send({
          type: 'broadcast',
          event: 'cell:update',
          payload: event,
        });
        
        // console.log('[useRealtimeSubscription] 📤 Broadcast send result:', sendResult);
        
        // Remove optimistic update after successful broadcast
        setTimeout(() => {
          removeOptimisticUpdate(assetId, propertyKey);
        }, 100);
        
        broadcastDebounceRef.current.delete(cellKey);
      } catch (error) {
        console.error('Failed to broadcast cell update:', error);
        // Keep optimistic update on error
        broadcastDebounceRef.current.delete(cellKey);
      }
    }, 500); // 500ms debounce delay

    broadcastDebounceRef.current.set(cellKey, debounceTimer);
  }, [
    currentUserId,
    currentUserName,
    avatarColor,
    connectionStatus,
    addOptimisticUpdate,
    removeOptimisticUpdate,
    queueUpdate,
  ]);

  /**
   * Broadcast an asset creation to all other clients
   */
  const broadcastAssetCreate = useCallback(async (
    assetId: string,
    assetName: string,
    propertyValues: Record<string, any>,
    options?: {
      insertAfterRowId?: string;
      insertBeforeRowId?: string;
      targetCreatedAt?: string;
    }
  ): Promise<void> => {
    if (!channelRef.current) {
      console.warn('Cannot broadcast: channel not initialized');
      return;
    }

    const event: AssetCreateEvent = {
      type: 'asset:create',
      userId: currentUserId,
      userName: currentUserName,
      assetId,
      assetName,
      propertyValues,
      timestamp: Date.now(),
      insertAfterRowId: options?.insertAfterRowId,
      insertBeforeRowId: options?.insertBeforeRowId,
      targetCreatedAt: options?.targetCreatedAt,
    };

    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'asset:create',
        payload: event,
      });
    } catch (error) {
      console.error('Failed to broadcast asset creation:', error);
    }
  }, [currentUserId, currentUserName]);

  /**
   * Broadcast an asset deletion to all other clients
   */
  const broadcastAssetDelete = useCallback(async (
    assetId: string,
    assetName: string
  ): Promise<void> => {
    if (!channelRef.current) {
      console.warn('Cannot broadcast: channel not initialized');
      return;
    }

    const event: AssetDeleteEvent = {
      type: 'asset:delete',
      userId: currentUserId,
      userName: currentUserName,
      assetId,
      assetName,
      timestamp: Date.now(),
    };

    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'asset:delete',
        payload: event,
      });
    } catch (error) {
      console.error('Failed to broadcast asset deletion:', error);
    }
  }, [currentUserId, currentUserName]);

  /**
   * Broadcast a batch of cell updates in one message (e.g. Clear Content).
   * Like Delete Row, send every change in one message with no debounce.
   */
  const broadcastCellsBatchUpdate = useCallback(async (
    cells: Array<{
      assetId: string;
      propertyKey: string;
      newValue: any;
      oldValue?: any;
      updatedAt?: string | null;
    }>
  ): Promise<void> => {
    if (!channelRef.current || cells.length === 0) return;

    const event: CellsBatchUpdateEvent = {
      type: 'cells:batch-update',
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now(),
      cells,
    };

    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'cells:batch-update',
        payload: event,
      });
    } catch (error) {
      console.error('Failed to broadcast cells batch update:', error);
    }
  }, [currentUserId, currentUserName]);

  /**
   * Broadcast a row order change hint to all clients.
   * The event does not carry rowIndex details; callers usually reload from the
   * database so server order stays authoritative.
   */
  const broadcastRowOrderChange = useCallback(async (): Promise<void> => {
    if (!channelRef.current) {
      console.warn('Cannot broadcast row order change: channel not initialized');
      return;
    }

    const event: RowOrderChangeEvent = {
      type: 'roworder:change',
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now(),
    };

    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'roworder:change',
        payload: event,
      });
    } catch (error) {
      console.error('Failed to broadcast row order change:', error);
    }
  }, [currentUserId, currentUserName]);

  /**
   * Process queued updates after reconnection
   */
  const processQueuedUpdates = useCallback(async () => {
    const queued = queuedUpdatesRef.current;
    if (queued.length === 0 || !channelRef.current) {
      return;
    }

    for (const event of queued) {
      try {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'cell:update',
          payload: event,
        });
      } catch (error) {
        console.error('Failed to send queued update:', error);
      }
    }

    queuedUpdatesRef.current = [];
    setQueuedUpdates([]);
  }, []);

  /**
   * Initialize the realtime channel and subscriptions
   */
  useEffect(() => {
    if (!libraryId || !supabase) {
      return;
    }

    
    const channelName = `library:${libraryId}:edits`;
    // console.log('[useRealtimeSubscription] 🔌 Creating channel:', channelName, 'for user:', currentUserId);
    setConnectionStatus('connecting');

    // Create the edit broadcast channel
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: false }, // Fire-and-forget for speed
      },
    });

    channelRef.current = channel;
    let connectionPhase: RealtimeConnectionPhase = 'initial';

    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        setConnectionStatus('reconnecting');
        channel.subscribe();
      }, 2000);
    };

    const handleChannelStatus = (status: string) => {
      const transition = advanceRealtimeConnection(connectionPhase, status);
      connectionPhase = transition.phase;

      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
        void processQueuedUpdates();
        const reconnect = handlersRef.current.onReconnect;
        if (transition.shouldReconcile && reconnect) {
          void (async () => {
            try {
              await reconnect();
            } catch (error) {
              console.error('[useRealtimeSubscription] Reconnect reconciliation failed:', error);
            }
          })();
        }
        return;
      }

      if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        setConnectionStatus('disconnected');
        scheduleReconnect();
      }
    };

    // Set up broadcast event listeners (for fast updates)
    // console.log('[useRealtimeSubscription] 📡 Setting up broadcast listeners');
    channel
      .on('broadcast', { event: 'cell:update' }, (payload) => {
        // console.log('[useRealtimeSubscription] 📨 Broadcast event received: cell:update', payload);
        handleCellUpdateEvent(payload);
      })
      .on('broadcast', { event: 'asset:create' }, (payload) => {
        // console.log('[useRealtimeSubscription] 📨 Broadcast event received: asset:create', payload);
        handleAssetCreateEvent(payload);
      })
      .on('broadcast', { event: 'asset:delete' }, (payload) => {
        // console.log('[useRealtimeSubscription] 📨 Broadcast event received: asset:delete', payload);
        handleAssetDeleteEvent(payload);
      })
      .on('broadcast', { event: 'roworder:change' }, (payload) => {
        handleRowOrderChangeEvent(payload);
      })
      .on('broadcast', { event: 'cells:batch-update' }, (payload) => {
        handleCellsBatchUpdateEvent(payload);
      });

    // Handle system events for connection status
    channel.on('system', {}, (payload) => {
      if (payload.status === 'CHANNEL_ERROR') {
        console.error('[useRealtimeSubscription] ❌ Channel error');
      }
      handleChannelStatus(String(payload.status ?? ''));
    });

    // Subscribe to the channel
    // console.log('[useRealtimeSubscription] 🚀 Subscribing to channel...');
    channel.subscribe((status) => {
      handleChannelStatus(status);
    });

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Clear all debounce timers
      broadcastDebounceRef.current.forEach(timer => clearTimeout(timer));
      broadcastDebounceRef.current.clear();

      channel.unsubscribe();
      channelRef.current = null;
      setConnectionStatus('disconnected');
    };
  }, [libraryId, supabase]);

  return {
    connectionStatus,
    broadcastCellUpdate,
    broadcastAssetCreate,
    broadcastAssetDelete,
    broadcastCellsBatchUpdate,
    broadcastRowOrderChange,
    optimisticUpdates,
    queuedUpdatesCount: queuedUpdates.length,
  };
}
