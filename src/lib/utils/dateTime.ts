/**
 * DateTime Utilities
 * 
 * Timezone-aware date/time formatting and manipulation.
 */

/**
 * Format a timestamp in the user's local timezone
 * @param timestamp ISO string or Date object
 * @param format 'relative' | 'short' | 'long' | 'time'
 * @returns Formatted string in user's local timezone
 */
export function formatTimestamp(
  timestamp: string | Date,
  format: 'relative' | 'short' | 'long' | 'time' = 'relative'
): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  
  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  switch (format) {
    case 'relative':
      return formatRelativeTime(date);
    
    case 'short':
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
    
    case 'long':
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      }).format(date);
    
    case 'time':
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
    
    default:
      return formatRelativeTime(date);
  }
}

/**
 * Format a date as relative time (e.g., "5 minutes ago")
 * @param date Date to format
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 10) return 'Just now';
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
  if (diffMinutes === 1) return '1 minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 4) return `${diffWeeks} weeks ago`;
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;
  if (diffYears === 1) return '1 year ago';
  return `${diffYears} years ago`;
}

/**
 * Get user's timezone
 * @returns IANA timezone identifier (e.g., "America/New_York")
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert UTC timestamp to user's local time
 * @param utcTimestamp ISO string in UTC
 * @returns Date object in user's local timezone
 */
export function utcToLocal(utcTimestamp: string): Date {
  return new Date(utcTimestamp);
}

/**
 * Format timestamp with explicit timezone display
 * @param timestamp ISO string or Date
 * @returns Formatted string with timezone
 */
export function formatWithTimezone(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const timezone = getUserTimezone();
  
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  }).format(date);
}

/**
 * Check if a timestamp is within a certain time range
 * @param timestamp ISO string or Date
 * @param maxAgeMs Maximum age in milliseconds
 * @returns true if timestamp is within range
 */
export function isWithinTimeRange(timestamp: string | Date, maxAgeMs: number): boolean {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs <= maxAgeMs;
}

/**
 * Check if a timestamp is stale (older than threshold)
 * @param timestamp ISO string or Date
 * @param thresholdSeconds Threshold in seconds (default: 60)
 * @returns true if timestamp is stale
 */
export function isStaleTimestamp(timestamp: string | Date, thresholdSeconds = 60): boolean {
  return !isWithinTimeRange(timestamp, thresholdSeconds * 1000);
}

