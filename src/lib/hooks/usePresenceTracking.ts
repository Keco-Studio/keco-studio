/**
 * usePresenceTracking Hook
 * 
 * Manages real-time presence tracking for collaborative editing.
 * Handles:
 * - User presence in library (online/away status)
 * - Active cell tracking (which cell user is editing)
 * - Heartbeat mechanism (30-second intervals)
 * - Presence join/leave notifications
 * - Cleanup on unmount
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  const updateActiveCell = useCallback((assetId: string | null, propertyKey: string | null) => {
    const newActiveCell = assetId && propertyKey ? { assetId, propertyKey } : null;
    activeCellRef.current = newActiveCell;

    // Update presence state
    if (channelRef.current && isTracking) {
      channelRef.current.track({
        userId,
        userName,
        userEmail,
        avatarColor,
        activeCell: newActiveCell,
        cursorPosition: cursorPositionRef.current,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      });
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

    console.log(`[Presence] Initializing tracking for library: ${libraryId}, user: ${userName}`);

    // Create the presence channel
    const channel = supabase.channel(`library:${libraryId}:presence`, {
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

      // Update presence users and check for joins/leaves
      setPresenceUsers((prevPresenceUsers) => {
        // Check for new joins
        newPresenceUsers.forEach((presence, presenceUserId) => {
          if (!prevPresenceUsers.has(presenceUserId)) {
            // New user joined - use ref to get latest callback
            if (onPresenceJoinRef.current) {
              onPresenceJoinRef.current(presence);
            }
          }
        });

        // Check for leaves
        prevPresenceUsers.forEach((presence, presenceUserId) => {
          if (!newPresenceUsers.has(presenceUserId)) {
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
      .on('presence', { event: 'leave' }, syncHandler);

    // Subscribe and track initial presence
    channel.subscribe(async (status) => {
      console.log('[Presence] Subscription status:', status);

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

        // Start heartbeat (every 30 seconds)
        heartbeatIntervalRef.current = setInterval(() => {
          if (channelRef.current && isTracking) {
            channelRef.current.track({
              userId,
              userName,
              userEmail,
              avatarColor,
              activeCell: activeCellRef.current,
              cursorPosition: cursorPositionRef.current,
              lastActivity: new Date().toISOString(),
              connectionStatus: 'online' as const,
            });
          }
        }, 30000);
      }
    });

    // Cleanup on unmount
    return () => {
      console.log(`[Presence] Cleaning up tracking for library: ${libraryId}`);

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
   * Note: Not memoized to always get fresh data from state
   */
  const getUsersEditingCell = (assetId: string, propertyKey: string): PresenceState[] => {
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

    return users;
  };

  /**
   * Get all active users (sorted by join time)
   * Note: Not memoized to always get fresh data from state
   */
  const getActiveUsers = (): PresenceState[] => {
    return Array.from(presenceUsers.values()).sort((a, b) => {
      return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    });
  };

  return {
    isTracking,
    presenceUsers: Array.from(presenceUsers.values()),
    activeUserCount: presenceUsers.size,
    updateActiveCell,
    updateCursorPosition,
    getUsersEditingCell,
    getActiveUsers,
  };
}

