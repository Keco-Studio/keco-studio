/**
 * Labels for in-flight agent work shown while SSE is open.
 */

export type StreamActivity = 'connecting' | 'thinking' | 'writing' | 'tool' | 'processing';

export function streamActivityLabel(activity: StreamActivity): string {
  switch (activity) {
    case 'connecting':
      return 'Connecting…';
    case 'thinking':
      return 'Thinking…';
    case 'writing':
      return 'Writing…';
    case 'tool':
      return 'Running tool…';
    case 'processing':
      return 'Processing…';
  }
}

export function formatElapsedSeconds(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}
