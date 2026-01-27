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
  } = config;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, OptimisticUpdate>>(new Map());
  const [queuedUpdates, setQueuedUpdates] = useState<CellUpdateEvent[]>([]);
  
  // Track recent broadcasts to prevent processing our own database updates
  const recentBroadcastsRef = useRef<Map<string, number>>(new Map());

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
    const event = payload.payload as CellUpdateEvent;

    console.log('[useRealtimeSubscription] 📥 Cell update received:', {
      assetId: event.assetId,
      propertyKey: event.propertyKey,
      fromUserId: event.userId,
      currentUserId,
      isOwnBroadcast: event.userId === currentUserId,
    });

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      console.log('[useRealtimeSubscription] ⏭️ Ignoring own broadcast');
      return;
    }

    const optimistic = getOptimisticUpdate(event.assetId, event.propertyKey);

    if (optimistic && optimistic.timestamp < event.timestamp) {
      // Conflict detected: remote update is newer than our optimistic update
      console.log('[useRealtimeSubscription] ⚠️ Conflict detected, remote wins');
      onConflict(event, optimistic.newValue);
      removeOptimisticUpdate(event.assetId, event.propertyKey);
    } else if (!optimistic) {
      // No conflict, apply the update
      console.log('[useRealtimeSubscription] ✅ Applying remote update');
      onCellUpdate(event);
    } else {
      console.log('[useRealtimeSubscription] ⏭️ Ignoring old remote update (our optimistic is newer)');
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
   * Broadcast a cell update to all other clients
   * Debounced to 500ms to reduce network traffic
   */
  const broadcastCellUpdate = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any
  ): Promise<void> => {
    if (!channelRef.current) {
      console.warn('Cannot broadcast: channel not initialized');
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
      clearTimeout(existingTimer);
    }

    // Debounce broadcast: wait 500ms before sending
    const debounceTimer = setTimeout(async () => {
      try {
        // If disconnected, queue the update
        if (connectionStatus !== 'connected') {
          setQueuedUpdates(prev => [...prev, event]);
          broadcastDebounceRef.current.delete(cellKey);
          return;
        }

        if (!channelRef.current) {
          return;
        }

        await channelRef.current.send({
          type: 'broadcast',
          event: 'cell:update',
          payload: event,
        });
        
        console.log('[useRealtimeSubscription] 📤 Cell update broadcasted:', {
          assetId,
          propertyKey,
          userId: currentUserId,
          libraryId: event.assetId.split('-')[0], // First part of UUID
        });

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
      console.log('[useRealtimeSubscription] ❌ Not initializing - missing libraryId or supabase', {
        hasLibraryId: !!libraryId,
        hasSupabase: !!supabase,
      });
      return;
    }

    console.log('[useRealtimeSubscription] 🚀 Initializing for library:', libraryId);
    
    const channelName = `library:${libraryId}:edits`;
    setConnectionStatus('connecting');

    // Create the edit broadcast channel
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: false }, // Fire-and-forget for speed
      },
    });

    channelRef.current = channel;

    // Set up broadcast event listeners (for fast updates)
    channel
      .on('broadcast', { event: 'cell:update' }, handleCellUpdateEvent)
      .on('broadcast', { event: 'asset:create' }, handleAssetCreateEvent)
      .on('broadcast', { event: 'asset:delete' }, handleAssetDeleteEvent)
      // Add database subscription as backup (ensures updates even if broadcast fails)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'library_asset_values',
        },
        async (payload) => {
          // Extract field_id and new value from the database update
          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          
          if (newRecord && newRecord.asset_id && newRecord.field_id) {
            // Check if this is our own recent broadcast (to prevent infinite loops)
            const cellKey = `${newRecord.asset_id}-${newRecord.field_id}`;
            const recentBroadcastTime = recentBroadcastsRef.current.get(cellKey);
            
            if (recentBroadcastTime && Date.now() - recentBroadcastTime < 2000) {
              return;
            }
            
            // Verify that this asset belongs to our library
            // (to avoid processing updates from other libraries)
            try {
              const { data: assetData } = await supabase
                .from('library_assets')
                .select('library_id')
                .eq('id', newRecord.asset_id)
                .single();
              
              if (!assetData || assetData.library_id !== libraryId) {
                return;
              }
              
              // Check if value actually changed
              const oldValueStr = JSON.stringify(oldRecord?.value_json);
              const newValueStr = JSON.stringify(newRecord.value_json);
              
              if (oldValueStr === newValueStr) {
                return;
              }
              
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
              // Silently fail
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
          
          if (newRecord && newRecord.id && newRecord.name) {
            // Fetch property values for this asset
            const { data: values } = await supabase
              .from('library_asset_values')
              .select('field_id, value_json')
              .eq('asset_id', newRecord.id);
            
            const propertyValues: Record<string, any> = {};
            values?.forEach((v: any) => {
              propertyValues[v.field_id] = v.value_json;
            });
            
            // Create a synthetic AssetCreateEvent
            const syntheticEvent: AssetCreateEvent = {
              type: 'asset:create',
              userId: '', // Unknown user (from database)
              userName: 'Another user',
              assetId: newRecord.id,
              assetName: newRecord.name,
              propertyValues,
              timestamp: Date.now(),
            };
            
            handleAssetCreateEvent({ payload: syntheticEvent });
          }
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
      if (payload.status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
        processQueuedUpdates(); // Process any queued updates
      } else if (payload.status === 'CHANNEL_ERROR') {
        setConnectionStatus('disconnected');
        
        // Attempt reconnection after 2 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          setConnectionStatus('reconnecting');
          channel.subscribe();
        }, 2000);
      }
    });

    // Subscribe to the channel
    channel.subscribe((status) => {
      console.log('[useRealtimeSubscription] 📡 Subscription status:', status, 'for library:', libraryId);
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
        console.log('[useRealtimeSubscription] ✅ CONNECTED to edits channel for library:', libraryId);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnectionStatus('disconnected');
        console.log('[useRealtimeSubscription] ❌ DISCONNECTED from edits channel for library:', libraryId);
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
  ]);

  return {
    connectionStatus,
    broadcastCellUpdate,
    broadcastAssetCreate,
    broadcastAssetDelete,
    optimisticUpdates,
    queuedUpdatesCount: queuedUpdates.length,
  };
}

