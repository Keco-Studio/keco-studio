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
  /** 行顺序发生变更时的回调（例如 insert above/below 或批量重排） */
  onRowOrderChange?: (event: RowOrderChangeEvent) => void;
  /** 批量单元格更新回调（Clear Content 等场景，一次接收所有变更，效仿 Delete Row 的即时同步） */
  onCellsBatchUpdate?: (event: CellsBatchUpdateEvent) => void;
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
  } = config;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, OptimisticUpdate>>(new Map());
  const [queuedUpdates, setQueuedUpdates] = useState<CellUpdateEvent[]>([]);
  
  // Track recent broadcasts to prevent processing our own database updates
  const recentBroadcastsRef = useRef<Map<string, number>>(new Map());
  // 收到 cells:batch-update 后短时间忽略同批 cell 的 postgres_changes，避免协作者「一格一格清空」
  const recentBatchCellKeysRef = useRef<{ keys: Set<string>; at: number }>({ keys: new Set(), at: 0 });
  // Buffer postgres_changes INSERT events for library_assets to coalesce with roworder:change.
  // Without this, INSERT events arrive before roworder:change and cause rows to appear at
  // wrong positions (because local rows haven't been shifted yet) before loadInitialData() corrects them.
  const pendingPgInsertEventsRef = useRef<any[]>([]);
  const pgInsertCoalesceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      return next;
    });
  }, []);

  /**
   * Check if there's a pending optimistic update for a cell
   */
  const getOptimisticUpdate = useCallback((assetId: string, propertyKey: string): OptimisticUpdate | undefined => {
    const cellKey = `${assetId}-${propertyKey}`;
    return optimisticUpdates.get(cellKey);
  }, [optimisticUpdates]);

  /**
   * Handle incoming cell update events with conflict detection
   */
  const handleCellUpdateEvent = useCallback((payload: any) => {
    // console.log('[useRealtimeSubscription] 📨 Received broadcast message:', payload);
    const event = payload.payload as CellUpdateEvent;
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

    if (optimistic && optimistic.timestamp < event.timestamp) {
      // Conflict detected: remote update is newer than our optimistic update
      // console.log('[useRealtimeSubscription] ⚠️ Conflict detected, remote wins');
      onConflict(event, optimistic.newValue);
      removeOptimisticUpdate(event.assetId, event.propertyKey);
    } else if (!optimistic) {
      // No conflict, apply the update
      // console.log('[useRealtimeSubscription] ✅ No conflict, applying update');
      onCellUpdate(event);
    } else {
      // console.log('[useRealtimeSubscription] ⏭️ Local update is newer, ignoring');
    }
    // If optimistic.timestamp >= event.timestamp, ignore (our update is newer)
  }, [currentUserId, getOptimisticUpdate, onCellUpdate, onConflict, removeOptimisticUpdate]);

  /**
   * Handle incoming asset creation events
   */
  const handleAssetCreateEvent = useCallback((payload: any) => {
    const event = payload.payload as AssetCreateEvent;

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      return;
    }

    onAssetCreate(event);
  }, [currentUserId, onAssetCreate]);

  /**
   * Handle incoming asset deletion events
   */
  const handleAssetDeleteEvent = useCallback((payload: any) => {
    const event = payload.payload as AssetDeleteEvent;

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      return;
    }

    onAssetDelete(event);
  }, [currentUserId, onAssetDelete]);

  /**
   * Handle incoming row order change events.
   * Filter out our own broadcasts: the sender already called loadInitialData()
   * inside createAsset, so processing our own event again would trigger a
   * redundant full data refresh (yAssets.clear + repopulate), causing the
   * newly inserted row to flicker (appear → disappear → reappear).
   */
  const handleRowOrderChangeEvent = useCallback((payload: any) => {
    if (!onRowOrderChange) return;
    const event = payload.payload as RowOrderChangeEvent;
    if (event.userId === currentUserId) return;

    // Clear buffered postgres_changes INSERT events — loadInitialData() will bring in
    // all rows with correct row_index, so processing buffered INSERTs would only cause
    // rows to flash at wrong positions before being corrected.
    pendingPgInsertEventsRef.current = [];
    if (pgInsertCoalesceTimerRef.current) {
      clearTimeout(pgInsertCoalesceTimerRef.current);
      pgInsertCoalesceTimerRef.current = null;
    }

    onRowOrderChange(event);
  }, [currentUserId, onRowOrderChange]);

  /**
   * Handle incoming cells batch update events (e.g. Clear Content).
   * 效仿 Delete Row：一次性接收所有变更，协作者立即全部应用，无 debounce、无顺序问题。
   * 同时记录这批 cell，短时间忽略同批的 postgres_changes，避免「一格一格清空」。
   */
  const handleCellsBatchUpdateEvent = useCallback((payload: any) => {
    if (!onCellsBatchUpdate) return;
    const event = payload.payload as CellsBatchUpdateEvent;
    if (event.userId === currentUserId) return;
    const batchKeys = new Set(event.cells.map((c) => `${c.assetId}-${c.propertyKey}`));
    recentBatchCellKeysRef.current = { keys: batchKeys, at: Date.now() };
    setTimeout(() => {
      recentBatchCellKeysRef.current = { keys: new Set(), at: 0 };
    }, 2500);
    onCellsBatchUpdate(event);
  }, [currentUserId, onCellsBatchUpdate]);

  /**
   * Broadcast a cell update to all other clients
   * Debounced to 500ms to reduce network traffic
   */
  const broadcastCellUpdate = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any
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
    };

    // console.log('[useRealtimeSubscription] Created broadcast event:', event);

    // Add to optimistic updates
    addOptimisticUpdate({
      assetId,
      propertyKey,
      newValue,
      timestamp,
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
        setQueuedUpdates(prev => [...prev, event]);
        broadcastDebounceRef.current.delete(cellKey);
        return;
      }
      
      try {
        // If disconnected, queue the update
        if (connectionStatus !== 'connected') {
          console.warn('[useRealtimeSubscription] ⚠️ Not connected, queuing update. Status:', connectionStatus);
          setQueuedUpdates(prev => [...prev, event]);
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
        
        // Track this broadcast to prevent processing our own database update
        recentBroadcastsRef.current.set(cellKey, Date.now());
        
        // Clean up old broadcasts after 3 seconds
        setTimeout(() => {
          recentBroadcastsRef.current.delete(cellKey);
        }, 3000);

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
   * 效仿 Delete Row：无 debounce，一次发送所有变更，协作者一次性接收并应用。
   */
  const broadcastCellsBatchUpdate = useCallback(async (
    cells: Array<{ assetId: string; propertyKey: string; newValue: any }>
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
   * 事件本身不携带具体 rowIndex 列表，上层通常在收到事件后触发一次从 DB 的 reload，
   * 以 server 为准同步行序。
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
    if (queuedUpdates.length === 0 || !channelRef.current) {
      return;
    }

    for (const event of queuedUpdates) {
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

    setQueuedUpdates([]);
  }, [queuedUpdates]);

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
      })
      // Add database subscription as backup (ensures updates even if broadcast fails)
      // Listen to both UPDATE and INSERT events
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'library_asset_values',
        },
        async (payload) => {
          // console.log('[useRealtimeSubscription] 💾 Database UPDATE event received:', payload);
          // Extract field_id and new value from the database update
          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          
          if (newRecord && newRecord.asset_id && newRecord.field_id) {
            // Check if this is our own recent broadcast (to prevent infinite loops)
            const cellKey = `${newRecord.asset_id}-${newRecord.field_id}`;
            const recentBroadcastTime = recentBroadcastsRef.current.get(cellKey);
            
            if (recentBroadcastTime && Date.now() - recentBroadcastTime < 2000) return;

            const batch = recentBatchCellKeysRef.current;
            if (batch.keys.size > 0 && batch.keys.has(cellKey) && Date.now() - batch.at < 2500) return;

            try {
              const { data: assetData } = await supabase
                .from('library_assets')
                .select('library_id')
                .eq('id', newRecord.asset_id)
                .single();
              
              if (!assetData || assetData.library_id !== libraryId) {
                // console.log('[useRealtimeSubscription] ⏭️ Asset not in our library');
                return;
              }
              
              // Check if value actually changed
              const oldValueStr = JSON.stringify(oldRecord?.value_json);
              const newValueStr = JSON.stringify(newRecord.value_json);
              
              if (oldValueStr === newValueStr) {
                // console.log('[useRealtimeSubscription] ⏭️ Value unchanged');
                return;
              }
              
              // console.log('[useRealtimeSubscription] ✅ Creating synthetic event from database UPDATE');
              // Create a synthetic CellUpdateEvent from database change
              // Note: We don't have userName/avatarColor from database, so use placeholder
              const syntheticEvent: CellUpdateEvent = {
                type: 'cell:update',
                userId: '', // Unknown user (from database)
                userName: 'Another user',
                avatarColor: '#888888',
                assetId: newRecord.asset_id,
                propertyKey: newRecord.field_id,
                newValue: newRecord.value_json,
                oldValue: oldRecord?.value_json,
                timestamp: Date.now(),
              };
              
              handleCellUpdateEvent({ payload: syntheticEvent });
            } catch (error) {
              console.error('[useRealtimeSubscription] ❌ Error processing database UPDATE:', error);
            }
          }
        }
      )
      // Also listen to INSERT events (for null -> value transitions)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'library_asset_values',
        },
        async (payload) => {
          // console.log('[useRealtimeSubscription] 💾 Database INSERT event received:', payload);
          const newRecord = payload.new as any;
          
          if (newRecord && newRecord.asset_id && newRecord.field_id) {
            const cellKey = `${newRecord.asset_id}-${newRecord.field_id}`;
            const recentBroadcastTime = recentBroadcastsRef.current.get(cellKey);
            if (recentBroadcastTime && Date.now() - recentBroadcastTime < 2000) return;

            const batch = recentBatchCellKeysRef.current;
            if (batch.keys.size > 0 && batch.keys.has(cellKey) && Date.now() - batch.at < 2500) return;

            try {
              const { data: assetData } = await supabase
                .from('library_assets')
                .select('library_id')
                .eq('id', newRecord.asset_id)
                .single();
              if (!assetData || assetData.library_id !== libraryId) return;
              // Create a synthetic CellUpdateEvent from database INSERT
              const syntheticEvent: CellUpdateEvent = {
                type: 'cell:update',
                userId: '', // Unknown user (from database)
                userName: 'Another user',
                avatarColor: '#888888',
                assetId: newRecord.asset_id,
                propertyKey: newRecord.field_id,
                newValue: newRecord.value_json,
                oldValue: null, // INSERT means it was null before
                timestamp: Date.now(),
              };
              
              handleCellUpdateEvent({ payload: syntheticEvent });
            } catch (error) {
              console.error('[useRealtimeSubscription] ❌ Error processing database INSERT:', error);
            }
          }
        }
      )
      // Subscribe to asset creation events
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'library_assets',
          filter: `library_id=eq.${libraryId}`
        },
        async (payload) => {
          const newRecord = payload.new as any;
          // Accept any new row with id so collaborators see insert-above/insert-below (allow empty name)
          if (!newRecord?.id) return;

          let syntheticEvent: AssetCreateEvent;
          try {
            const { data: values } = await supabase
              .from('library_asset_values')
              .select('field_id, value_json')
              .eq('asset_id', newRecord.id);
            const propertyValues: Record<string, any> = {};
            values?.forEach((v: any) => {
              propertyValues[v.field_id] = v.value_json;
            });
            syntheticEvent = {
              type: 'asset:create',
              userId: '',
              userName: 'Another user',
              assetId: newRecord.id,
              assetName: newRecord.name ?? '',
              propertyValues,
              timestamp: Date.now(),
              targetCreatedAt: newRecord.created_at ?? new Date().toISOString(),
              rowIndex: typeof newRecord.row_index === 'number' ? newRecord.row_index : undefined,
            };
          } catch (err) {
            console.error('[useRealtimeSubscription] library_assets INSERT handler:', err);
            syntheticEvent = {
              type: 'asset:create',
              userId: '',
              userName: 'Another user',
              assetId: newRecord.id,
              assetName: newRecord.name ?? '',
              propertyValues: {},
              timestamp: Date.now(),
              targetCreatedAt: newRecord.created_at ?? new Date().toISOString(),
              rowIndex: typeof newRecord.row_index === 'number' ? newRecord.row_index : undefined,
            };
          }

          // Buffer the event instead of processing immediately.
          // postgres_changes INSERT events arrive BEFORE the roworder:change broadcast
          // (because DB INSERT triggers CDC immediately, while roworder:change is sent
          // only after the operator's loadInitialData() completes). Processing them
          // immediately would show rows at wrong positions because the collaborator's
          // local row_index values haven't been shifted yet.
          //
          // If roworder:change arrives within the window, the buffer is cleared and
          // loadInitialData() handles everything atomically. If not (e.g. broadcast
          // failure), the buffer is flushed as a fallback after 3s.
          pendingPgInsertEventsRef.current.push(syntheticEvent);
          if (pgInsertCoalesceTimerRef.current) clearTimeout(pgInsertCoalesceTimerRef.current);
          pgInsertCoalesceTimerRef.current = setTimeout(() => {
            // Fallback: no roworder:change arrived — process buffered events
            const events = [...pendingPgInsertEventsRef.current];
            pendingPgInsertEventsRef.current = [];
            pgInsertCoalesceTimerRef.current = null;
            for (const evt of events) {
              handleAssetCreateEvent({ payload: evt });
            }
          }, 3000);
        }
      )
      // Subscribe to library_assets UPDATE (e.g. name change) so yAsset.name syncs immediately
      // postgres_changes on library_asset_values uses field_id as propertyKey; only this path
      // emits propertyKey='name' so LibraryDataContext can update yAsset.set('name', ...).
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'library_assets',
          filter: `library_id=eq.${libraryId}`
        },
        (payload) => {
          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          if (!newRecord?.id) return;
          const newName = newRecord.name ?? '';
          const oldName = oldRecord?.name;
          if (oldName === newName) return;
          const syntheticEvent: CellUpdateEvent = {
            type: 'cell:update',
            userId: '',
            userName: 'Another user',
            avatarColor: '#888888',
            assetId: newRecord.id,
            propertyKey: 'name',
            newValue: newName,
            oldValue: oldName,
            timestamp: Date.now(),
          };
          handleCellUpdateEvent({ payload: syntheticEvent });
        }
      )
      // Subscribe to asset deletion events
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'library_assets',
          filter: `library_id=eq.${libraryId}`
        },
        (payload) => {
          const oldRecord = payload.old as any;
          
          if (oldRecord && oldRecord.id) {
            // Create a synthetic AssetDeleteEvent
            const syntheticEvent: AssetDeleteEvent = {
              type: 'asset:delete',
              userId: '', // Unknown user (from database)
              userName: 'Another user',
              assetId: oldRecord.id,
              assetName: oldRecord.name || 'Unknown',
              timestamp: Date.now(),
            };
            
            handleAssetDeleteEvent({ payload: syntheticEvent });
          }
        }
      );

    // Handle system events for connection status
    channel.on('system', {}, (payload) => {
      // console.log('[useRealtimeSubscription] 📡 System event:', payload);
      if (payload.status === 'SUBSCRIBED') {
        // console.log('[useRealtimeSubscription] ✅ Channel subscribed successfully');
        setConnectionStatus('connected');
        processQueuedUpdates(); // Process any queued updates
      } else if (payload.status === 'CHANNEL_ERROR') {
        console.error('[useRealtimeSubscription] ❌ Channel error');
        setConnectionStatus('disconnected');
        
        // Attempt reconnection after 2 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          // console.log('[useRealtimeSubscription] 🔄 Attempting to reconnect...');
          setConnectionStatus('reconnecting');
          channel.subscribe();
        }, 2000);
      }
    });

    // Subscribe to the channel
    // console.log('[useRealtimeSubscription] 🚀 Subscribing to channel...');
    channel.subscribe((status) => {
      // console.log('[useRealtimeSubscription] 📡 Subscribe callback status:', status);
      if (status === 'SUBSCRIBED') {
        // console.log('[useRealtimeSubscription] ✅ Successfully subscribed to channel');
        setConnectionStatus('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnectionStatus('disconnected');
      }
    });

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Clear all debounce timers
      broadcastDebounceRef.current.forEach(timer => clearTimeout(timer));
      broadcastDebounceRef.current.clear();

      // Clear postgres_changes INSERT coalesce timer
      if (pgInsertCoalesceTimerRef.current) {
        clearTimeout(pgInsertCoalesceTimerRef.current);
        pgInsertCoalesceTimerRef.current = null;
      }
      pendingPgInsertEventsRef.current = [];

      channel.unsubscribe();
      channelRef.current = null;
      setConnectionStatus('disconnected');
    };
  }, [
    libraryId,
    supabase,
    handleCellUpdateEvent,
    handleAssetCreateEvent,
    handleAssetDeleteEvent,
    processQueuedUpdates,
    handleRowOrderChangeEvent,
    handleCellsBatchUpdateEvent,
  ]);

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

