import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Deliver a library edit broadcast via the explicit REST path.
 * Prefer this over channel.send(): when the socket cannot push, send() falls
 * back to REST with a deprecation warning and can drop under CI load.
 */
export async function sendLibraryBroadcast(
  channel: RealtimeChannel,
  event: string,
  payload: unknown
): Promise<void> {
  const result = await channel.httpSend(event, payload);
  if (result.success === false) {
    throw new Error(`Realtime broadcast failed: ${result.error}`);
  }
}
