import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

jest.mock('server-only', () => ({}));

import { broadcastDocumentStateReset } from '@/lib/documents/documentStateResetBroadcaster';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

describe('document state reset broadcaster', () => {
  it('sends an Agent reset on the private document channel and cleans it up', async () => {
    const send = jest.fn(async () => ({ status: 'ok' }));
    const unsubscribe = jest.fn(async () => 'ok');
    const channel = {
      subscribe(callback: (status: string) => void) {
        callback('SUBSCRIBED');
        return channel;
      },
      send,
      unsubscribe,
    } as unknown as RealtimeChannel;
    const removeChannel = jest.fn(async () => 'ok');
    const channelFactory = jest.fn(() => channel);
    const setAuth = jest.fn(async () => undefined);
    const client = {
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'caller-token' } }, error: null })) },
      realtime: { setAuth },
      channel: channelFactory,
      removeChannel,
    } as unknown as SupabaseClient;

    await broadcastDocumentStateReset(client, {
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      mode: 'collaborative',
      markdown: '# Proposed',
      yjsStateBase64: 'replacement-state',
      updateTail: [],
      token: { epoch: 3, revision: 5 },
      updatedAt: '2026-07-15T00:01:00.000Z',
    });

    expect(channelFactory).toHaveBeenCalledWith(`doc-collab:${DOCUMENT_ID}`, {
      config: { private: true, broadcast: { self: false } },
    });
    expect(setAuth).toHaveBeenCalledWith('caller-token');
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'document-state-reset',
      payload: {
        v: 1,
        documentId: DOCUMENT_ID,
        epoch: 3,
        revision: 5,
        reason: 'agent',
        updatedAt: '2026-07-15T00:01:00.000Z',
      },
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it('sends a normalization reset with the committed token', async () => {
    const send = jest.fn(async () => ({ status: 'ok' }));
    const channel = {
      subscribe(callback: (status: string) => void) {
        callback('SUBSCRIBED');
        return channel;
      },
      send,
      unsubscribe: jest.fn(async () => 'ok'),
    } as unknown as RealtimeChannel;
    const client = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: { access_token: 'caller-token' } },
          error: null,
        })),
      },
      realtime: { setAuth: jest.fn(async () => undefined) },
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(async () => 'ok'),
    } as unknown as SupabaseClient;
    const state = {
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      mode: 'collaborative' as const,
      markdown: '# Normalized',
      yjsStateBase64: 'normalized-state',
      updateTail: [],
      token: { epoch: 4, revision: 8 },
      updatedAt: '2026-07-17T01:00:00.000Z',
    };

    await broadcastDocumentStateReset(client, state, 'normalization');

    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'document-state-reset',
      payload: {
        v: 1,
        documentId: DOCUMENT_ID,
        epoch: 4,
        revision: 8,
        reason: 'normalization',
        updatedAt: '2026-07-17T01:00:00.000Z',
      },
    });
  });
});
