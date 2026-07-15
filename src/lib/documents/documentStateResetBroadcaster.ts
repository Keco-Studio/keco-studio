import type { SupabaseClient } from '@supabase/supabase-js';
import { documentCollabTopic } from './documentCollaborationProtocol';
import type { AuthoritativeDocumentState } from './documentStateTypes';

const SUBSCRIBE_TIMEOUT_MS = 2_000;

export async function broadcastDocumentStateReset(
  client: SupabaseClient,
  state: AuthoritativeDocumentState
): Promise<void> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Document reset broadcast requires an authenticated caller');
  }
  await client.realtime.setAuth(data.session.access_token);
  const channel = client.channel(documentCollabTopic(state.documentId), {
    config: { private: true, broadcast: { self: false } },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Document reset channel subscription timed out')),
        SUBSCRIBE_TIMEOUT_MS
      );
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(error ?? new Error(`Document reset channel ${status.toLowerCase()}`));
        }
      });
    });

    const result = await channel.send({
      type: 'broadcast',
      event: 'document-state-reset',
      payload: {
        v: 1,
        documentId: state.documentId,
        epoch: state.token.epoch,
        revision: state.token.revision,
        reason: 'agent',
        updatedAt: state.updatedAt,
      },
    });
    if (result !== 'ok' && (result as { status?: string })?.status !== 'ok') {
      throw new Error(`Document reset broadcast failed: ${String(result)}`);
    }
  } finally {
    await channel.unsubscribe();
    await client.removeChannel(channel);
  }
}
