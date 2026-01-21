/**
 * usePresenceTracking Hook
 * 
 * Manages real-time presence tracking for collaborative editing.
 * Handles:
 * - User presence in library (online/away status)
 * - Active cell tracking (which cell user is editing)
 * - Heartbeat mechanism (5-second intervals for reliable updates)
 * - Presence join/leave notifications
 * - Broadcast-based backup mechanism for immediate sync
 * - Cleanup on unmount
 */

'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import type { PresenceState } from '@/lib/types/collaboration';

export type PresenceConfig = {
  libraryId: string;
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  onPresenceJoin?: (user: PresenceState) => void;
  onPresenceLeave?: (userId: string, userName: string) => void;
  debugLabel?: string; // Optional label for debugging
};

export type PresenceUpdate = {
  activeCell?: {
    assetId: string;
    propertyKey: string;
  } | null;
  cursorPosition?: {
    row: number;
    col: number;
  } | null;
};

export function usePresenceTracking(config: PresenceConfig) {
  const supabase = useSupabase();
  const {
    libraryId,
    userId,
    userName,
    userEmail,
    avatarColor,
    onPresenceJoin,
    onPresenceLeave,
    debugLabel = 'Unknown',
  } = config;

  const [presenceUsers, setPresenceUsers] = useState<Map<string, PresenceState>>(new Map());
  const [isTracking, setIsTracking] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeCellRef = useRef<{ assetId: string; propertyKey: string } | null>(null);
  const cursorPositionRef = useRef<{ row: number; col: number } | null>(null);
  
  // Store callbacks in refs to always use latest version without triggering re-subscription
  const onPresenceJoinRef = useRef(onPresenceJoin);
  const onPresenceLeaveRef = useRef(onPresenceLeave);
  
  // Update refs when callbacks change
  useEffect(() => {
    onPresenceJoinRef.current = onPresenceJoin;
    onPresenceLeaveRef.current = onPresenceLeave;
  }, [onPresenceJoin, onPresenceLeave]);

  /**
   * Update active cell being edited by current user
   */
  const updateActiveCell = useCallback(async (assetId: string | null, propertyKey: string | null) => {
    const newActiveCell = assetId && propertyKey ? { assetId, propertyKey } : null;
    activeCellRef.current = newActiveCell;

    console.log('[Presence] 🔄 Updating active cell:', {
      userName,
      assetId: assetId || 'null',
      propertyKey: propertyKey || 'null',
      isTracking,
    });

    // Update presence state
    if (channelRef.current && isTracking) {
      const presenceState = {
        userId,
        userName,
        userEmail,
        avatarColor,
        activeCell: newActiveCell,
        cursorPosition: cursorPositionRef.current,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      };
      
      // Track the update
      await channelRef.current.track(presenceState);
      
      // Send broadcast to immediately notify other users
      // This ensures faster sync than waiting for the presence sync event
      await channelRef.current.send({
        type: 'broadcast',
        event: 'presence_update',
        payload: {
          userId,
          userName,
          activeCell: newActiveCell,
          timestamp: new Date().toISOString(),
        },
      });
      
      console.log('[Presence] ✅ Active cell tracked and broadcasted:', {
        userName,
        assetId: assetId || 'null',
        propertyKey: propertyKey || 'null',
      });
    }
  }, [userId, userName, userEmail, avatarColor, isTracking, libraryId]);

  /**
   * Update cursor position (throttled to 10 updates/second maximum)
   */
  const lastCursorUpdateRef = useRef<number>(0);
  const updateCursorPosition = useCallback((row: number | null, col: number | null) => {
    const newPosition = row !== null && col !== null ? { row, col } : null;
    cursorPositionRef.current = newPosition;

    // Throttle to max 10 updates per second (100ms minimum between updates)
    const now = Date.now();
    if (now - lastCursorUpdateRef.current < 100) {
      return; // Skip this update, too soon
    }
    lastCursorUpdateRef.current = now;

    if (channelRef.current && isTracking) {
      channelRef.current.track({
        userId,
        userName,
        userEmail,
        avatarColor,
        activeCell: activeCellRef.current,
        cursorPosition: newPosition,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      });
    }
  }, [userId, userName, userEmail, avatarColor, isTracking]);


  /**
   * Initialize presence tracking
   */
  useEffect(() => {
    if (!libraryId || !supabase || !userId) {
      console.log(`[Presence] ⚠️ Skip tracking - libraryId: ${libraryId}, userId: ${userId}`);
      return;
    }

    console.log(`[Presence:${debugLabel}] 🚀 Initializing tracking for library: ${libraryId.slice(0, 8)}, user: ${userName}`);

    // Create the presence channel
    // Note: Multiple components can subscribe to the same channel
    const channelName = `library:${libraryId}:presence`;
    console.log(`[Presence:${debugLabel}] 📝 Creating channel: ${channelName}`);
    
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId, // Use userId as the unique key
        },
      },
    });

    channelRef.current = channel;
    console.log(`[Presence:${debugLabel}] 📝 Channel created, now subscribing...`);

    // Define presence sync handler inline to avoid dependency issues
    const syncHandler = () => {
      if (!channel) return;

      const state = channel.presenceState<PresenceState>();
      const newPresenceUsers = new Map<string, PresenceState>();

      // Process all presence states
      Object.entries(state).forEach(([key, presences]) => {
        if (presences && presences.length > 0) {
          const presence = presences[0] as PresenceState;
          
          // Don't include current user in the presence map
          if (presence.userId !== userId) {
            newPresenceUsers.set(presence.userId, presence);
          }
        }
      });

      console.log(`[Presence] 🔄 Sync for ${userName} in library ${libraryId}: ${newPresenceUsers.size} other user(s)`);

      // Update presence users and check for joins/leaves
      setPresenceUsers((prevPresenceUsers) => {
        // Check for new joins
        newPresenceUsers.forEach((presence, presenceUserId) => {
          if (!prevPresenceUsers.has(presenceUserId)) {
            console.log(`[Presence] ➕ ${presence.userName} joined (asset: ${presence.activeCell?.assetId?.slice(0, 8) || 'none'})`);
            // New user joined - use ref to get latest callback
            if (onPresenceJoinRef.current) {
              onPresenceJoinRef.current(presence);
            }
          } else {
            // Check if activeCell changed
            const prev = prevPresenceUsers.get(presenceUserId);
            if (prev && prev.activeCell?.assetId !== presence.activeCell?.assetId) {
              console.log(`[Presence] 🔄 ${presence.userName} switched asset: ${prev.activeCell?.assetId?.slice(0, 8) || 'none'} -> ${presence.activeCell?.assetId?.slice(0, 8) || 'none'}`);
            }
          }
        });

        // Check for leaves
        prevPresenceUsers.forEach((presence, presenceUserId) => {
          if (!newPresenceUsers.has(presenceUserId)) {
            console.log(`[Presence] ➖ ${presence.userName} left`);
            // User left - use ref to get latest callback
            if (onPresenceLeaveRef.current) {
              onPresenceLeaveRef.current(presenceUserId, presence.userName);
            }
          }
        });

        return newPresenceUsers;
      });
    };

    // Set up presence event listeners
    channel
      .on('presence', { event: 'sync' }, syncHandler)
      .on('presence', { event: 'join' }, syncHandler)
      .on('presence', { event: 'leave' }, syncHandler)
      // Listen for broadcast events as a backup mechanism
      .on('broadcast', { event: 'presence_update' }, ({ payload }) => {
        console.log('[Presence] Received broadcast update:', payload);
        // Trigger sync to update local state
        syncHandler();
      });

    // Subscribe and track initial presence
    console.log(`[Presence:${debugLabel}] 🔌 Calling channel.subscribe() for ${userName}...`);
    channel.subscribe(async (status) => {
      console.log(`[Presence:${debugLabel}] 📡 ${userName} subscription callback triggered, status:`, status);

      if (status === 'SUBSCRIBED') {
        // Track initial presence
        await channel.track({
          userId,
          userName,
          userEmail,
          avatarColor,
          activeCell: null,
          cursorPosition: null,
          lastActivity: new Date().toISOString(),
          connectionStatus: 'online' as const,
        });

        setIsTracking(true);
        console.log(`[Presence:${debugLabel}] ✅ isTracking set to TRUE for ${userName}`);
        
        // Force an immediate sync to get current presence state
        // This ensures we see other users right after joining
        setTimeout(() => {
          syncHandler();
        }, 100);
        
        console.log(`[Presence:${debugLabel}] ✅ ${userName} joined library ${libraryId}`);
      }
    });

    // Cleanup on unmount
    return () => {
      console.log(`[Presence:${debugLabel}] 🚪 ${userName} leaving library ${libraryId}, cleaning up channel`);

      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Untrack presence and unsubscribe
      if (channelRef.current) {
        channelRef.current.untrack();
        channelRef.current.unsubscribe();
      }

      channelRef.current = null;
      setIsTracking(false);
      setPresenceUsers(new Map());
    };
  }, [
    libraryId,
    supabase,
    userId,
    userName,
    userEmail,
    avatarColor,
  ]);

  /**
   * Get users currently editing a specific cell
   * Memoized to ensure stable reference but always returns fresh data
   * Users are sorted by lastActivity (earliest first), so users[0] is the first user who entered the cell
   */
  const getUsersEditingCell = useCallback((assetId: string, propertyKey: string): PresenceState[] => {
    const users: PresenceState[] = [];
    
    presenceUsers.forEach((presence) => {
      if (
        presence.activeCell &&
        presence.activeCell.assetId === assetId &&
        presence.activeCell.propertyKey === propertyKey
      ) {
        users.push(presence);
      }
    });

    // Sort by lastActivity time (earliest first)
    // This ensures users[0] is always the first user who entered the cell
    users.sort((a, b) => {
      return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    });

    return users;
  }, [presenceUsers]);

  /**
   * Get all active users (sorted by join time)
   * Memoized to ensure stable reference but always returns fresh data
   */
  const getActiveUsers = useCallback((): PresenceState[] => {
    return Array.from(presenceUsers.values()).sort((a, b) => {
      return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    });
  }, [presenceUsers]);

  // Memoize presenceUsers array to ensure it creates a new array reference when Map changes
  // This helps React detect changes and trigger re-renders in consuming components
  const presenceUsersArray = useMemo(() => {
    return Array.from(presenceUsers.values());
  }, [presenceUsers]);

  return {
    isTracking,
    presenceUsers: presenceUsersArray,
    activeUserCount: presenceUsers.size,
    updateActiveCell,
    updateCursorPosition,
    getUsersEditingCell,
    getActiveUsers,
  };
}

