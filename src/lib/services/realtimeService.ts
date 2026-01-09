/**
 * Realtime Service
 * 
 * Utility functions for managing realtime collaboration features.
 * Provides helpers for:
 * - Cell edit validation
 * - Event payload construction
 * - Conflict detection
 * - User state management
 */

import type {
  CellUpdateEvent,
  AssetCreateEvent,
  AssetDeleteEvent,
  OptimisticUpdate,
} from '@/lib/types/collaboration';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';

/**
 * Validate if a cell update event is valid
 */
export function isValidCellUpdateEvent(event: any): event is CellUpdateEvent {
  return (
    event &&
    event.type === 'cell:update' &&
    typeof event.userId === 'string' &&
    typeof event.userName === 'string' &&
    typeof event.avatarColor === 'string' &&
    typeof event.assetId === 'string' &&
    typeof event.propertyKey === 'string' &&
    typeof event.timestamp === 'number'
  );
}

/**
 * Validate if an asset create event is valid
 */
export function isValidAssetCreateEvent(event: any): event is AssetCreateEvent {
  return (
    event &&
    event.type === 'asset:create' &&
    typeof event.userId === 'string' &&
    typeof event.userName === 'string' &&
    typeof event.assetId === 'string' &&
    typeof event.assetName === 'string' &&
    typeof event.propertyValues === 'object' &&
    typeof event.timestamp === 'number'
  );
}

/**
 * Validate if an asset delete event is valid
 */
export function isValidAssetDeleteEvent(event: any): event is AssetDeleteEvent {
  return (
    event &&
    event.type === 'asset:delete' &&
    typeof event.userId === 'string' &&
    typeof event.userName === 'string' &&
    typeof event.assetId === 'string' &&
    typeof event.assetName === 'string' &&
    typeof event.timestamp === 'number'
  );
}

/**
 * Create a cell update event payload
 */
export function createCellUpdateEvent(
  userId: string,
  userName: string,
  assetId: string,
  propertyKey: string,
  newValue: any,
  oldValue?: any
): CellUpdateEvent {
  return {
    type: 'cell:update',
    userId,
    userName,
    avatarColor: getUserAvatarColor(userId),
    assetId,
    propertyKey,
    newValue,
    oldValue,
    timestamp: Date.now(),
  };
}

/**
 * Create an asset creation event payload
 */
export function createAssetCreateEvent(
  userId: string,
  userName: string,
  assetId: string,
  assetName: string,
  propertyValues: Record<string, any>
): AssetCreateEvent {
  return {
    type: 'asset:create',
    userId,
    userName,
    assetId,
    assetName,
    propertyValues,
    timestamp: Date.now(),
  };
}

/**
 * Create an asset deletion event payload
 */
export function createAssetDeleteEvent(
  userId: string,
  userName: string,
  assetId: string,
  assetName: string
): AssetDeleteEvent {
  return {
    type: 'asset:delete',
    userId,
    userName,
    assetId,
    assetName,
    timestamp: Date.now(),
  };
}

/**
 * Check if a remote update conflicts with a local optimistic update
 * Returns true if there's a conflict (remote is newer)
 */
export function hasConflict(
  remoteEvent: CellUpdateEvent,
  optimisticUpdate: OptimisticUpdate | undefined
): boolean {
  if (!optimisticUpdate) {
    return false;
  }

  // Conflict if remote timestamp is newer than optimistic timestamp
  return remoteEvent.timestamp > optimisticUpdate.timestamp;
}

/**
 * Debounce helper for cell updates
 * Returns a debounced function that delays execution
 */
export function createDebounceHelper<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle helper for presence updates
 * Returns a throttled function that limits execution rate
 */
export function createThrottleHelper<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastRun >= limit) {
      // Execute immediately
      func(...args);
      lastRun = now;
    } else {
      // Schedule for later
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        func(...args);
        lastRun = Date.now();
        timeoutId = null;
      }, limit - (now - lastRun));
    }
  };
}

/**
 * Get a unique cell key for tracking optimistic updates
 */
export function getCellKey(assetId: string, propertyKey: string): string {
  return `${assetId}-${propertyKey}`;
}

/**
 * Parse a cell key back into assetId and propertyKey
 */
export function parseCellKey(cellKey: string): { assetId: string; propertyKey: string } | null {
  const parts = cellKey.split('-');
  if (parts.length !== 2) {
    return null;
  }
  return {
    assetId: parts[0],
    propertyKey: parts[1],
  };
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  if (diffSecs < 5) {
    return 'just now';
  } else if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Check if two values are deeply equal (for conflict detection)
 */
export function areValuesEqual(value1: any, value2: any): boolean {
  // Handle primitive types
  if (value1 === value2) {
    return true;
  }

  // Handle null and undefined
  if (value1 == null || value2 == null) {
    return value1 === value2;
  }

  // Handle arrays
  if (Array.isArray(value1) && Array.isArray(value2)) {
    if (value1.length !== value2.length) {
      return false;
    }
    return value1.every((item, index) => areValuesEqual(item, value2[index]));
  }

  // Handle objects
  if (typeof value1 === 'object' && typeof value2 === 'object') {
    const keys1 = Object.keys(value1);
    const keys2 = Object.keys(value2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    return keys1.every(key => areValuesEqual(value1[key], value2[key]));
  }

  return false;
}

/**
 * Sanitize a value for broadcasting (remove functions, circular refs, etc.)
 */
export function sanitizeValue(value: any): any {
  try {
    // JSON stringify/parse removes functions and handles circular refs
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('Failed to sanitize value:', error);
    return null;
  }
}

/**
 * Check if the connection should show a warning (slow updates)
 */
export function shouldShowSlowConnectionWarning(
  lastUpdateTimestamp: number,
  threshold: number = 5000
): boolean {
  const now = Date.now();
  return now - lastUpdateTimestamp > threshold;
}

/**
 * Get connection status color for UI
 */
export function getConnectionStatusColor(status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'): string {
  switch (status) {
    case 'connected':
      return '#52c41a'; // Green
    case 'connecting':
    case 'reconnecting':
      return '#faad14'; // Yellow
    case 'disconnected':
      return '#ff4d4f'; // Red
    default:
      return '#d9d9d9'; // Gray
  }
}

/**
 * Get connection status label for UI
 */
export function getConnectionStatusLabel(status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Unknown';
  }
}

