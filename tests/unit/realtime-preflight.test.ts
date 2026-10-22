import { describe, expect, it } from '@jest/globals';

import {
  runRealtimePreflight,
  type RealtimePreflightClient,
} from '../../scripts/lib/realtimePreflight';

function createClientPair(): {
  clients: RealtimePreflightClient[];
  received: () => boolean;
  signedInEmails: () => string[];
  channelOptions: () => unknown[];
  removedChannels: () => number;
} {
  let broadcastReceived = false;
  const signedInEmails: string[] = [];
  const channelOptions: unknown[] = [];
  let removedChannels = 0;
  const listeners: Array<(payload: { payload: unknown }) => void> = [];

  const createClient = (): RealtimePreflightClient => ({
    auth: {
      signInWithPassword: async ({ email }) => {
        signedInEmails.push(email);
        return {
          data: {
            session: { access_token: 'session-token' },
            user: { id: `user-${signedInEmails.length}` },
          },
          error: null,
        };
      },
    },
    channel: (_topic, options) => {
      channelOptions.push(options);
      let listener: ((payload: { payload: unknown }) => void) | null = null;
      const channel = {
        on: (_type: 'broadcast', _filter: { event: string }, callback: (payload: { payload: unknown }) => void) => {
          listener = callback;
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          if (listener) listeners.push(listener);
          callback('SUBSCRIBED');
          return channel;
        },
        httpSend: async (_event: string, payload: unknown) => {
          listeners.forEach((current) => current({ payload }));
          broadcastReceived = true;
          return { success: true };
        },
        unsubscribe: async () => undefined,
      };
      return channel;
    },
    removeChannel: async () => {
      removedChannels += 1;
    },
  });

  return {
    clients: [createClient(), createClient()],
    received: () => broadcastReceived,
    signedInEmails: () => signedInEmails,
    channelOptions: () => channelOptions,
    removedChannels: () => removedChannels,
  };
}

describe('Realtime CI preflight', () => {
  it('rejects an incomplete Supabase environment before attempting a connection', async () => {
    await expect(
      runRealtimePreflight({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        },
        createClient: () => {
          throw new Error('must not create client');
        },
        timeoutMs: 10,
      })
    ).rejects.toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  });

  it('requires two authenticated subscriptions to exchange a broadcast', async () => {
    const pair = createClientPair();
    let nextClient = 0;
    let cleanupCalled = false;

    await expect(
      runRealtimePreflight({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        },
        createClient: () => pair.clients[nextClient++]!,
        createPrivateTopic: async () => ({
          topic: 'folders:project:00000000-0000-4000-8000-000000000001',
          cleanup: async () => {
            cleanupCalled = true;
          },
        }),
        timeoutMs: 100,
      })
    ).resolves.toEqual({ authenticatedClients: 2, broadcastDelivered: true });

    expect(pair.received()).toBe(true);
    expect(pair.signedInEmails()).toEqual([
      'seed-empty@mailinator.com',
      'seed-empty-2@mailinator.com',
    ]);
    expect(pair.channelOptions()).toEqual([
      { config: { private: true, broadcast: { ack: true, self: false } } },
      { config: { private: true, broadcast: { ack: true, self: false } } },
    ]);
    expect(cleanupCalled).toBe(true);
    expect(pair.removedChannels()).toBe(2);
  });

  it('stops before creating a private topic when authentication fails', async () => {
    let privateTopicCreated = false;
    const failedClient: RealtimePreflightClient = {
      auth: {
        signInWithPassword: async () => ({
          data: { session: null, user: null },
          error: new Error('bad auth'),
        }),
      },
      channel: () => {
        throw new Error('must not create channel');
      },
      removeChannel: async () => undefined,
    };

    await expect(
      runRealtimePreflight({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        },
        createClient: () => failedClient,
        createPrivateTopic: async () => {
          privateTopicCreated = true;
          throw new Error('must not create private topic');
        },
        timeoutMs: 100,
      })
    ).rejects.toThrow('Realtime preflight failed: bad auth');

    expect(privateTopicCreated).toBe(false);
  });

  it('rejects overrides that configure the same account twice', async () => {
    const pair = createClientPair();

    await expect(
      runRealtimePreflight({
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
          REALTIME_PREFLIGHT_EMAIL: 'same@example.com',
          REALTIME_PREFLIGHT_RECEIVER_EMAIL: 'same@example.com',
        },
        createClient: () => pair.clients[0]!,
        createPrivateTopic: async () => {
          throw new Error('must not create private topic');
        },
        timeoutMs: 100,
      })
    ).rejects.toThrow('must use distinct email addresses');
  });
});
