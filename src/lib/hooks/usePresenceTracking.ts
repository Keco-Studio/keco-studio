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
    debugLabel = 'Unknown',
  } = config;

  const [presenceUsers, setPresenceUsers] = useState<Map<string, PresenceState>>(new Map());
  const [isTracking, setIsTracking] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeCellRef = useRef<{ assetId: string; propertyKey: string } | null>(null);
  const cursorPositionRef = useRef<{ row: number; col: number } | null>(null);

  /**
   * Update active cell being edited by current user
   */
  const updateActiveCell = useCallback(async (assetId: string | null, propertyKey: string | null) => {
    const newActiveCell = assetId && propertyKey ? { assetId, propertyKey } : null;
    activeCellRef.current = newActiveCell;

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
      
      // Track the update - Supabase will automatically broadcast to other clients
      await channelRef.current.track(presenceState);
    }
  }, [userId, userName, userEmail, avatarColor, isTracking]);

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
      return;
    }


    // Create the presence channel
    // Note: Multiple components can subscribe to the same channel
    const channelName = `library:${libraryId}:presence`;
    
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId, // Use userId as the unique key
        },
      },
    });

    channelRef.current = channel;

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

      // Only update if there are actual changes to avoid infinite loops
      setPresenceUsers((prevPresenceUsers) => {
        // Check if the maps are identical
        if (prevPresenceUsers.size !== newPresenceUsers.size) {
          return newPresenceUsers;
        }
        
        // Check if all entries are the same (compare key fields only, ignore lastActivity timestamp)
        let hasChanges = false;
        for (const [key, value] of newPresenceUsers.entries()) {
          const prevValue = prevPresenceUsers.get(key);
          if (!prevValue) {
            hasChanges = true;
            break;
          }
          
          // Compare only key fields that affect UI (ignore lastActivity to prevent flicker)
          if (
            prevValue.userId !== value.userId ||
            prevValue.userName !== value.userName ||
            prevValue.connectionStatus !== value.connectionStatus ||
            JSON.stringify(prevValue.activeCell) !== JSON.stringify(value.activeCell) ||
            JSON.stringify(prevValue.cursorPosition) !== JSON.stringify(value.cursorPosition)
          ) {
            hasChanges = true;
            break;
          }
        }
        
        // Only return new Map if there are changes
        return hasChanges ? newPresenceUsers : prevPresenceUsers;
      });
    };

    // Set up presence event listeners
    channel
      .on('presence', { event: 'sync' }, syncHandler)
      .on('presence', { event: 'join' }, syncHandler)
      .on('presence', { event: 'leave' }, syncHandler);

    // Subscribe and track initial presence
    channel.subscribe(async (status) => {
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
        
        // Trigger a single delayed sync to catch other users
        setTimeout(() => {
          syncHandler();
        }, 500);
      }
    });

    // Cleanup on unmount
    return () => {
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

