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

    // Ignore our own broadcasts
    if (event.userId === currentUserId) {
      return;
    }

    const optimistic = getOptimisticUpdate(event.assetId, event.propertyKey);

    if (optimistic && optimistic.timestamp < event.timestamp) {
      // Conflict detected: remote update is newer than our optimistic update
      onConflict(event, optimistic.newValue);
      removeOptimisticUpdate(event.assetId, event.propertyKey);
    } else if (!optimistic) {
      // No conflict, apply the update
      onCellUpdate(event);
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

        if (!channelRef.current) return;

        await channelRef.current.send({
          type: 'broadcast',
          event: 'cell:update',
          payload: event,
        });

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

    console.log(`Processing ${queuedUpdates.length} queued updates...`);

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

    console.log(`[Realtime] Initializing subscription for library: ${libraryId}`);
    setConnectionStatus('connecting');

    // Create the edit broadcast channel
    const channel = supabase.channel(`library:${libraryId}:edits`, {
      config: {
        broadcast: { ack: false }, // Fire-and-forget for speed
      },
    });

    channelRef.current = channel;

    // Set up event listeners
    channel
      .on('broadcast', { event: 'cell:update' }, handleCellUpdateEvent)
      .on('broadcast', { event: 'asset:create' }, handleAssetCreateEvent)
      .on('broadcast', { event: 'asset:delete' }, handleAssetDeleteEvent);

    // Handle system events for connection status
    channel.on('system', {}, (payload) => {
      console.log('[Realtime] System event:', payload);

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
          console.log('[Realtime] Attempting reconnection...');
          setConnectionStatus('reconnecting');
          channel.subscribe();
        }, 2000);
      }
    });

    // Subscribe to the channel
    channel.subscribe((status) => {
      console.log('[Realtime] Subscription status:', status);
      
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setConnectionStatus('disconnected');
      }
    });

    // Cleanup on unmount
    return () => {
      console.log(`[Realtime] Cleaning up subscription for library: ${libraryId}`);
      
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

