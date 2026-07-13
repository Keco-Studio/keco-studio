export type RealtimeConnectionPhase =
  | 'initial'
  | 'connected'
  | 'reconnect_pending';

export type RealtimeChannelStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED'
  | string;

export function advanceRealtimeConnection(
  phase: RealtimeConnectionPhase,
  status: RealtimeChannelStatus
): { phase: RealtimeConnectionPhase; shouldReconcile: boolean } {
  if (status === 'SUBSCRIBED') {
    return {
      phase: 'connected',
      shouldReconcile: phase === 'reconnect_pending',
    };
  }

  if (
    status === 'CHANNEL_ERROR' ||
    status === 'TIMED_OUT' ||
    status === 'CLOSED'
  ) {
    return { phase: 'reconnect_pending', shouldReconcile: false };
  }

  return { phase, shouldReconcile: false };
}
