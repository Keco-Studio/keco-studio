import type { SupabaseClient } from '@supabase/supabase-js';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { encodeBase64 } from '@/lib/documents/documentCollaborationProtocol';
import { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import type {
  AuthoritativeDocumentState,
  DurableYjsUpdate,
} from '@/lib/documents/documentStateTypes';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function encodedRoot(text = 'seed'): string {
  const doc = new Y.Doc();
  doc.get('root', Y.XmlText).insert(0, text);
  const encoded = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

function collaborativeState(): AuthoritativeDocumentState {
  return {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    mode: 'collaborative',
    markdown: '# Seed',
    yjsStateBase64: encodedRoot(),
    updateTail: [],
    token: { epoch: 2, revision: 4 },
    updatedAt: '2026-07-14T12:00:00.000Z',
  };
}

function mapUpdate(key: string, value: string): string {
  const doc = new Y.Doc();
  doc.getMap('peer').set(key, value);
  const encoded = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

type Handler = (message: { payload: unknown }) => void | Promise<void>;

class FakeChannel {
  readonly handlers = new Map<string, Handler>();
  readonly send = jest.fn(async () => ({ status: 'ok' }));
  readonly unsubscribe = jest.fn(async () => 'ok');
  subscribeCallback: ((status: string, error?: Error) => void) | null = null;

  on(_type: string, filter: { event: string }, handler: Handler) {
    this.handlers.set(filter.event, handler);
    return this;
  }

  subscribe(callback: (status: string, error?: Error) => void) {
    this.subscribeCallback = callback;
    callback('SUBSCRIBED');
    return this;
  }

  async emit(event: string, payload: unknown) {
    await this.handlers.get(event)?.({ payload });
  }
}

function makeHarness(overrides: {
  state?: AuthoritativeDocumentState;
  role?: 'admin' | 'editor' | 'viewer';
  append?: (
    client: SupabaseClient,
    input: { updates: DurableYjsUpdate[] }
  ) => Promise<{ acceptedIds: string[] }>;
  compact?: () => Promise<AuthoritativeDocumentState>;
} = {}) {
  const channel = new FakeChannel();
  const channelFactory = jest.fn(() => channel);
  const setAuth = jest.fn(async () => undefined);
  const removeChannel = jest.fn(async () => 'ok');
  const supabase = {
    realtime: { setAuth },
    channel: channelFactory,
    removeChannel,
  } as unknown as SupabaseClient;
  const state = overrides.state ?? collaborativeState();
  const gateway = {
    read: jest.fn(async () => state),
    initialize: jest.fn(async () => collaborativeState()),
    appendUpdates: jest.fn(
      overrides.append ??
        (async (_client: SupabaseClient, input: { updates: DurableYjsUpdate[] }) => ({
          acceptedIds: input.updates.map((update) => update.id),
        }))
    ),
    compact: jest.fn(
      overrides.compact ??
        (async () => ({
          ...collaborativeState(),
          token: { epoch: 2, revision: 5 },
        }))
    ),
  };
  const onCompacted = jest.fn(async () => undefined);
  const session = new DocumentCollaborationSession({
    supabase,
    gateway,
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    accessToken: 'local-access-token',
    role: overrides.role ?? 'editor',
    user: { name: 'Editor', color: '#1677ff' },
    batchWindowMs: 75,
    compactionBackoffMs: 250,
    compactionJitterRatio: 0,
    onCompacted,
  });
  return {
    channel,
    channelFactory,
    gateway,
    removeChannel,
    onCompacted,
    session,
    setAuth,
  };
}

async function connectReady(session: DocumentCollaborationSession) {
  const connecting = session.connect();
  await Promise.resolve();
  session.attachBinding();
  await connecting;
}

describe('DocumentCollaborationSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('authorizes and subscribes to one private document channel before ready', async () => {
    const { session, setAuth, channelFactory } = makeHarness();
    const statuses: string[] = [];
    session.subscribe((state) => statuses.push(state.status));

    await connectReady(session);

    expect(setAuth).toHaveBeenCalledWith('local-access-token');
    expect(channelFactory).toHaveBeenCalledWith(`doc-collab:${DOCUMENT_ID}`, {
      config: {
        private: true,
        broadcast: { self: false },
        presence: { key: USER_ID },
      },
    });
    expect(statuses).toEqual(
      expect.arrayContaining(['authorizing', 'connecting', 'hydrating', 'syncing', 'ready'])
    );
    expect(session.status).toBe('ready');
    expect(session.token).toEqual({ epoch: 2, revision: 4 });
  });

  it('attaches one binding after connection and keeps the legacy alias idempotent', async () => {
    const { session } = makeHarness();
    const connecting = session.connect();
    await Promise.resolve();

    session.attachBinding();
    session.applyInitialState();
    await connecting;

    expect(session.status).toBe('ready');
    expect(session.doc.get('root', Y.XmlText).toString()).toBe('seed');
  });

  it('fails closed and notifies the provider when the editor binding fails', () => {
    const { session } = makeHarness();
    const syncListener = jest.fn();
    const states: Array<{ status: string; error: string | null }> = [];
    session.on('sync', syncListener);
    session.subscribe(({ status, error }) => states.push({ status, error }));

    session.reportBindingFailure(new Error('missing Lexical node'), 'yjs-to-lexical');

    expect(session.status).toBe('error');
    expect(syncListener).toHaveBeenCalledWith(false);
    expect(states.at(-1)).toEqual({
      status: 'error',
      error: 'Document binding failed (yjs-to-lexical): missing Lexical node',
    });
  });

  it('refreshes Realtime auth without recreating the channel or Y.Doc', async () => {
    const { session, setAuth, channelFactory } = makeHarness();
    await connectReady(session);
    const doc = session.doc;

    await session.updateAccessToken('refreshed-access-token');

    expect(setAuth).toHaveBeenLastCalledWith('refreshed-access-token');
    expect(channelFactory).toHaveBeenCalledTimes(1);
    expect(session.doc).toBe(doc);
  });

  it('initializes a legacy editor through the gateway but leaves a viewer in legacy-view', async () => {
    const legacy = { ...collaborativeState(), mode: 'legacy' as const, yjsStateBase64: null };
    const editorHarness = makeHarness({ state: legacy });
    await connectReady(editorHarness.session);
    expect(editorHarness.gateway.initialize).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_ID,
      '# Seed'
    );

    const viewerHarness = makeHarness({ state: legacy, role: 'viewer' });
    await viewerHarness.session.connect();
    expect(viewerHarness.session.status).toBe('legacy-view');
    expect(viewerHarness.gateway.initialize).not.toHaveBeenCalled();
  });

  it('persists a merged local update before broadcasting it', async () => {
    let resolveAppend!: (value: { acceptedIds: string[] }) => void;
    const appendPromise = new Promise<{ acceptedIds: string[] }>((resolve) => {
      resolveAppend = resolve;
    });
    const harness = makeHarness({ append: async () => appendPromise });
    await connectReady(harness.session);

    harness.session.doc.getMap('local').set('value', 1);
    await jest.advanceTimersByTimeAsync(75);
    expect(harness.gateway.appendUpdates).toHaveBeenCalledTimes(1);
    expect(harness.channel.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'yjs-update' })
    );

    const pending = harness.gateway.appendUpdates.mock.calls[0]![1];
    resolveAppend({ acceptedIds: pending.updates.map((update) => update.id) });
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'yjs-update',
        payload: expect.objectContaining({
          v: 1,
          documentId: DOCUMENT_ID,
          epoch: 2,
          updateId: pending.updates[0]!.id,
        }),
      })
    );
  });

  it('flushes pending durability before answering a sync request', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    harness.session.doc.getMap('local').set('value', 2);

    await harness.channel.emit('yjs-sync-request', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      requesterId: '44444444-4444-4444-8444-444444444444',
      stateVectorBase64: encodeBase64(Y.encodeStateVector(new Y.Doc())),
    });

    const appendOrder = harness.gateway.appendUpdates.mock.invocationCallOrder[0]!;
    const responseCall = harness.channel.send.mock.calls.find(
      ([message]) => message.event === 'yjs-sync-response'
    );
    expect(responseCall).toBeDefined();
    const responseOrder = harness.channel.send.mock.invocationCallOrder[
      harness.channel.send.mock.calls.indexOf(responseCall!)
    ]!;
    expect(appendOrder).toBeLessThan(responseOrder);
  });

  it('retains a failed append, freezes editing state, and retries the same update id', async () => {
    const append = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_client: SupabaseClient, input: { updates: DurableYjsUpdate[] }) => ({
        acceptedIds: input.updates.map((update) => update.id),
      }));
    const harness = makeHarness({ append });
    await connectReady(harness.session);
    harness.session.doc.getMap('local').set('value', 3);

    await jest.advanceTimersByTimeAsync(75);
    await Promise.resolve();
    expect(harness.session.status).toBe('degraded');
    const firstId = append.mock.calls[0]![1].updates[0].id;

    await harness.session.retry();
    expect(append.mock.calls[1]![1].updates[0].id).toBe(firstId);
    expect(harness.session.status).toBe('ready');
  });

  it('never persists or publishes awareness for a viewer', async () => {
    const harness = makeHarness({ role: 'viewer' });
    await connectReady(harness.session);
    harness.session.doc.getMap('viewer').set('bad', true);
    harness.session.awareness.setLocalState({ user: { id: USER_ID } });
    await jest.advanceTimersByTimeAsync(100);

    expect(harness.gateway.appendUpdates).not.toHaveBeenCalled();
    expect(
      harness.channel.send.mock.calls.some(([message]) => message.event === 'yjs-awareness')
    ).toBe(false);
  });

  it('applies valid durable peer updates and rejects wrong-scope payloads', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const peer = new Y.Doc();
    peer.getMap('peer').set('value', 'remote');
    const update = encodeBase64(Y.encodeStateAsUpdate(peer));

    await harness.channel.emit('yjs-update', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      updateId: '55555555-5555-4555-8555-555555555555',
      updateBase64: update,
    });
    expect(harness.session.doc.getMap('peer').get('value')).toBe('remote');

    await harness.channel.emit('yjs-update', {
      v: 1,
      documentId: '66666666-6666-4666-8666-666666666666',
      epoch: 2,
      updateId: '55555555-5555-4555-8555-555555555555',
      updateBase64: update,
    });
    expect(harness.session.status).toBe('ready');
    peer.destroy();
  });

  it('compacts immediately when hydration finds 100 durable tail rows', async () => {
    const state = collaborativeState();
    state.updateTail = Array.from({ length: 100 }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      updateBase64: mapUpdate(`key-${index}`, `value-${index}`),
    }));
    const harness = makeHarness({ state });

    await connectReady(harness.session);
    await Promise.resolve();

    expect(harness.gateway.compact).toHaveBeenCalledWith(expect.anything(), {
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
    });
    expect(harness.session.token).toEqual({ epoch: 2, revision: 5 });
    expect(harness.onCompacted).toHaveBeenCalledTimes(1);
  });

  it('reloads the winning token and retries a losing compactor with backoff', async () => {
    const state = collaborativeState();
    state.updateTail = Array.from({ length: 100 }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
      updateBase64: mapUpdate(`retry-${index}`, `value-${index}`),
    }));
    const winner = { ...state, token: { epoch: 2, revision: 5 } };
    const compact = jest
      .fn()
      .mockRejectedValueOnce(
        new DocumentStateConflictError('compactor lost', winner.token)
      )
      .mockResolvedValue({ ...collaborativeState(), token: { epoch: 2, revision: 6 } });
    const harness = makeHarness({ state, compact });
    harness.gateway.read.mockResolvedValueOnce(state).mockResolvedValue(winner);

    await connectReady(harness.session);
    await Promise.resolve();
    expect(compact).toHaveBeenCalledTimes(1);
    expect(harness.onCompacted).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(250);

    expect(compact).toHaveBeenCalledTimes(2);
    expect(compact.mock.calls[1]![1]).toEqual({
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 5 },
    });
    expect(harness.onCompacted).toHaveBeenCalledTimes(1);
    expect(harness.session.token).toEqual({ epoch: 2, revision: 6 });
  });

  it('catches up a missed durable update on the 15-second heartbeat', async () => {
    const harness = makeHarness();
    const caughtUp = collaborativeState();
    caughtUp.updateTail = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        updateBase64: mapUpdate('missed', 'durable'),
      },
    ];
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValue(caughtUp);
    await connectReady(harness.session);

    await jest.advanceTimersByTimeAsync(15_000);

    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    expect(harness.session.doc.getMap('peer').get('missed')).toBe('durable');
  });

  it('replaces the Y.Doc and rehydrates exactly once after a higher-epoch reset', async () => {
    const harness = makeHarness();
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'version'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValue(replacement);
    await connectReady(harness.session);
    const oldDoc = harness.session.doc;
    const reload = jest.fn();
    harness.session.on('reload', reload);

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    });

    expect(harness.session.status).toBe('syncing');
    expect(harness.session.doc).not.toBe(oldDoc);
    expect(reload).toHaveBeenCalledTimes(1);
    harness.session.attachBinding();
    harness.session.attachBinding();
    expect(harness.session.status).toBe('ready');
    expect(harness.session.token).toEqual({ epoch: 3, revision: 1 });
    expect(harness.session.doc.getMap('peer').get('restored')).toBe('version');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('flushes once and removes channel, awareness, timers, and listeners on destroy', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const awareness = harness.session.awareness as unknown as awarenessProtocol.Awareness;
    awareness.setLocalState({ user: { id: USER_ID } });

    await harness.session.destroy();
    await harness.session.destroy();

    expect(harness.removeChannel).toHaveBeenCalledTimes(1);
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(awareness.getLocalState()).toBeNull();
    expect(harness.session.status).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });
});
