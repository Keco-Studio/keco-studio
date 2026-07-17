import type { SupabaseClient } from '@supabase/supabase-js';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  decodeBase64,
  encodeBase64,
} from '@/lib/documents/documentCollaborationProtocol';
import { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import { validateSanctionedMdxAstNode } from '@/lib/documents/sanctionedMdx';
import type {
  AuthoritativeDocumentState,
  DurableYjsUpdate,
} from '@/lib/documents/documentStateTypes';
import {
  DocumentReadOnlyError,
  DocumentStateConflictError,
} from '@/lib/documents/documentStateTypes';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '88888888-8888-4888-8888-888888888888';

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
    epochReason: 'initialize',
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

function sharedBlockState(): {
  initial: AuthoritativeDocumentState;
  winner: AuthoritativeDocumentState;
} {
  const base = new Y.Doc();
  const block = new Y.XmlText();
  block.setAttribute('__type', 'paragraph');
  block.setAttribute('__state', new Y.Map());
  block.insert(0, 'Seed');
  base.get('root', Y.XmlText).insertEmbed(0, block);
  const baseUpdate = Y.encodeStateAsUpdate(base);

  const winner = new Y.Doc();
  Y.applyUpdate(winner, baseUpdate);
  const winnerBlock = documentBlock(winner);
  const winnerNodeState = winnerBlock.getAttribute('__state');
  if (!(winnerNodeState instanceof Y.Map)) {
    throw new Error('Expected shared block node state');
  }
  winnerNodeState.set('kecoBlockId', 'winner-a');

  const initial = {
    ...collaborativeState(),
    yjsStateBase64: encodeBase64(baseUpdate),
  };
  const normalized = {
    ...initial,
    yjsStateBase64: encodeBase64(Y.encodeStateAsUpdate(winner)),
    token: { epoch: 3, revision: 5 },
    epochReason: 'normalization' as const,
    updatedAt: '2026-07-17T01:00:00.000Z',
  };
  base.destroy();
  winner.destroy();
  return { initial, winner: normalized };
}

function documentBlock(doc: Y.Doc): Y.XmlText {
  const embedded = doc.get('root', Y.XmlText).toDelta()[0]?.insert;
  if (!(embedded instanceof Y.XmlText)) {
    throw new Error('Expected shared document block');
  }
  return embedded;
}

function replacementBlockState(
  initial: AuthoritativeDocumentState,
  text: string,
  epochReason: 'restore' | 'agent'
): AuthoritativeDocumentState & { epochReason: 'restore' | 'agent' } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeBase64(initial.yjsStateBase64!));
  const block = documentBlock(doc);
  const nodeState = block.getAttribute('__state');
  if (!(nodeState instanceof Y.Map)) {
    throw new Error('Expected replacement block node state');
  }
  nodeState.set('kecoBlockId', `${epochReason}-winner`);
  block.delete(0, block.length);
  block.insert(0, text);
  const state = {
    ...initial,
    yjsStateBase64: encodeBase64(Y.encodeStateAsUpdate(doc)),
    token: { epoch: 3, revision: 5 },
    updatedAt: '2026-07-17T02:00:00.000Z',
    epochReason,
  };
  doc.destroy();
  return state;
}

function documentBlockTexts(doc: Y.Doc): string[] {
  return doc
    .get('root', Y.XmlText)
    .toDelta()
    .flatMap(({ insert }) =>
      insert instanceof Y.XmlText ? [insert.toString()] : []
    );
}

function invalidCalloutState(): string {
  const doc = new Y.Doc();
  const jsx = new Y.XmlElement();
  jsx.setAttribute('__type', 'jsx');
  jsx.setAttribute('__mdastNode', {
    type: 'mdxJsxFlowElement',
    name: 'Callout',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'type', value: 'danger' },
    ],
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Body.' }] },
    ],
  });
  doc.get('root', Y.XmlText).insertEmbed(0, jsx);
  const encoded = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

function calloutState(type: string): string {
  const doc = new Y.Doc();
  const jsx = new Y.XmlElement();
  jsx.setAttribute('__type', 'jsx');
  jsx.setAttribute('__mdastNode', {
    type: 'mdxJsxFlowElement',
    name: 'Callout',
    attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: type }],
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Body.' }] },
    ],
  });
  doc.get('root', Y.XmlText).insertEmbed(0, jsx);
  const encoded = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

function calloutElement(doc: Y.Doc): Y.XmlElement {
  const embedded = doc.get('root', Y.XmlText).toDelta()[0]?.insert;
  if (!(embedded instanceof Y.XmlElement)) {
    throw new Error('Expected a Callout Yjs element');
  }
  return embedded;
}

function setCalloutType(doc: Y.Doc, type: string): void {
  const element = calloutElement(doc);
  const node = element.getAttribute('__mdastNode') as {
    attributes: Array<Record<string, unknown>>;
  };
  element.setAttribute('__mdastNode', {
    ...node,
    attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: type }],
  });
}

type Handler = (message: { payload: unknown }) => void | Promise<void>;

class FakeChannel {
  readonly handlers = new Map<string, Handler>();
  readonly send = jest.fn(async () => ({ status: 'ok' }));
  readonly unsubscribe = jest.fn(async () => 'ok');
  subscribeCallback: ((status: string, error?: Error) => void) | null = null;

  constructor(private readonly initialStatus: string | null = 'SUBSCRIBED') {}

  on(_type: string, filter: { event: string }, handler: Handler) {
    this.handlers.set(filter.event, handler);
    return this;
  }

  subscribe(callback: (status: string, error?: Error) => void) {
    this.subscribeCallback = callback;
    if (this.initialStatus !== null) callback(this.initialStatus);
    return this;
  }

  emitStatus(status: string, error?: Error) {
    this.subscribeCallback?.(status, error);
  }

  async emit(event: string, payload: unknown) {
    await this.handlers.get(event)?.({ payload });
  }
}

function makeHarness(overrides: {
  state?: AuthoritativeDocumentState;
  role?: 'admin' | 'editor' | 'viewer';
  channelStatuses?: Array<string | null>;
  batchWindowMs?: number;
  reconnectBackoffMs?: number;
  configureChannel?: (channel: FakeChannel, index: number) => void;
  append?: (
    client: SupabaseClient,
    input: { updates: DurableYjsUpdate[] }
  ) => Promise<{ acceptedIds: string[] }>;
  compact?: () => Promise<AuthoritativeDocumentState>;
  replace?: () => Promise<AuthoritativeDocumentState>;
} = {}) {
  const channels: FakeChannel[] = [];
  const channelStatusAt = (index: number) =>
    overrides.channelStatuses?.[index] === undefined
      ? 'SUBSCRIBED'
      : overrides.channelStatuses[index]!;
  const channelFactory = jest.fn(() => {
    const channelIndex = channels.length;
    const channel = new FakeChannel(channelStatusAt(channelIndex));
    overrides.configureChannel?.(channel, channelIndex);
    channels.push(channel);
    return channel;
  });
  const setAuth = jest.fn(async () => undefined);
  const removeChannel = jest.fn(async () => 'ok');
  const supabase = {
    realtime: { setAuth },
    channel: channelFactory,
    removeChannel,
  } as unknown as SupabaseClient;
  const state = overrides.state ?? collaborativeState();
  const read = jest.fn(async () => state);
  const gateway = {
    read,
    readTransport: jest.fn(
      (client: SupabaseClient, documentId: string) => read(client, documentId)
    ),
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
    replace: jest.fn(
      overrides.replace ??
        (async () => ({
          ...collaborativeState(),
          yjsStateBase64: mapUpdate('restored', 'version'),
          token: { epoch: 3, revision: 5 },
          updatedAt: '2026-07-14T12:10:00.000Z',
        }))
    ),
  };
  const onCompacted = jest.fn(async () => undefined);
  const onStateReplaced = jest.fn(async () => undefined);
  const session = new DocumentCollaborationSession({
    supabase,
    gateway,
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    accessToken: 'local-access-token',
    role: overrides.role ?? 'editor',
    user: { name: 'Editor', color: '#1677ff' },
    batchWindowMs: overrides.batchWindowMs ?? 75,
    compactionBackoffMs: 250,
    compactionJitterRatio: 0,
    reconnectBackoffMs: overrides.reconnectBackoffMs ?? 100,
    reconnectJitterRatio: 0,
    onCompacted,
    onStateReplaced,
  });
  const channel = channelFactory();
  channelFactory.mockClear();
  channels.length = 0;
  channelFactory.mockImplementation(() => {
    const channelIndex = channels.length;
    const nextChannel = channelIndex === 0
      ? channel
      : new FakeChannel(channelStatusAt(channelIndex));
    if (channelIndex > 0) {
      overrides.configureChannel?.(nextChannel, channelIndex);
    }
    channels.push(nextChannel);
    return nextChannel;
  });
  return {
    channel,
    channels,
    channelFactory,
    gateway,
    removeChannel,
    onCompacted,
    onStateReplaced,
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

  it('freezes immediately and schedules reconnect after a post-ready channel failure', async () => {
    const harness = makeHarness();
    const syncListener = jest.fn();
    harness.session.on('sync', syncListener);
    await connectReady(harness.session);
    const timerCountBeforeFailure = jest.getTimerCount();

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));

    expect(harness.session.status).toBe('degraded');
    expect(syncListener).toHaveBeenLastCalledWith(false);
    expect(jest.getTimerCount()).toBe(timerCountBeforeFailure + 1);
    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
  });

  it('replaces only the failed channel, catches up durably, and returns to ready', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const doc = harness.session.doc;
    const awareness = harness.session.awareness;

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);

    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channel);
    expect(harness.setAuth).toHaveBeenCalledTimes(2);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.channels[1]).toBeDefined();
    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    expect(harness.session.doc).toBe(doc);
    expect(harness.session.awareness).toBe(awareness);
    expect(harness.session.status).toBe('ready');
  });

  it('flushes and replays editor sync and awareness before reconnect becomes ready', async () => {
    const harness = makeHarness({ batchWindowMs: 1_000 });
    const reconnectedReady = jest.fn();
    harness.session.subscribe(({ status }) => {
      if (status === 'ready') reconnectedReady();
    });
    await connectReady(harness.session);
    reconnectedReady.mockClear();
    harness.session.doc.getMap('local').set('pending-reconnect', true);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);

    const replacement = harness.channels[1]!;
    const sentEvents = replacement.send.mock.calls.map(([message]) => message.event);
    expect(harness.gateway.appendUpdates).toHaveBeenCalledTimes(1);
    expect(sentEvents).toEqual([
      'yjs-update',
      'yjs-sync-request',
      'yjs-awareness',
    ]);
    expect(replacement.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'yjs-sync-request',
        payload: expect.objectContaining({
          requesterId: USER_ID,
          stateVectorBase64: expect.any(String),
        }),
      })
    );
    expect(replacement.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'yjs-awareness',
        payload: expect.objectContaining({ updateBase64: expect.any(String) }),
      })
    );
    expect(replacement.send.mock.invocationCallOrder.at(-1)).toBeLessThan(
      reconnectedReady.mock.invocationCallOrder[0]!
    );
    expect(harness.session.status).toBe('ready');
  });

  it('does not send peer sync or awareness when a viewer reconnects', async () => {
    const harness = makeHarness({ role: 'viewer' });
    await connectReady(harness.session);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);

    const replacement = harness.channels[1]!;
    expect(
      replacement.send.mock.calls.some(
        ([message]) =>
          message.event === 'yjs-sync-request' || message.event === 'yjs-awareness'
      )
    ).toBe(false);
    expect(harness.session.status).toBe('ready');
  });

  it('returns a legacy viewer to legacy-view and resets reconnect backoff', async () => {
    const legacy = {
      ...collaborativeState(),
      mode: 'legacy' as const,
      yjsStateBase64: null,
      token: { epoch: 0, revision: 0 },
    };
    const harness = makeHarness({ state: legacy, role: 'viewer' });
    await harness.session.connect();
    const doc = harness.session.doc;
    const awareness = harness.session.awareness;

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);

    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channel);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    expect(harness.session.status).toBe('legacy-view');
    expect(harness.session.doc).toBe(doc);
    expect(harness.session.awareness).toBe(awareness);
    expect(harness.channels[1]!.send).not.toHaveBeenCalled();

    harness.channels[1]!.emitStatus('CHANNEL_ERROR', new Error('socket closed again'));
    await jest.advanceTimersByTimeAsync(99);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);

    expect(harness.channelFactory).toHaveBeenCalledTimes(3);
    expect(harness.session.status).toBe('legacy-view');
    expect(harness.channels[2]!.send).not.toHaveBeenCalled();
  });

  it('keeps a higher-epoch reconnect catch-up syncing until the new binding attaches', async () => {
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'during-reconnect'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    const harness = makeHarness();
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValueOnce(replacement);
    const reload = jest.fn();
    harness.session.on('reload', reload);
    await connectReady(harness.session);
    const previousDoc = harness.session.doc;
    const previousAwareness = harness.session.awareness;

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);

    expect(harness.session.doc).not.toBe(previousDoc);
    expect(harness.session.awareness).not.toBe(previousAwareness);
    expect(reload).toHaveBeenCalledWith(harness.session.doc);
    expect(harness.session.status).toBe('syncing');
  });

  it.each(['yjs-awareness', 'yjs-sync-request'])(
    'routes a higher-epoch binding %s send failure back through reconnect',
    async (failedEvent) => {
      const replacement = {
        ...collaborativeState(),
        yjsStateBase64: mapUpdate('restored', 'before-binding-send-failure'),
        token: { epoch: 3, revision: 1 },
        updatedAt: '2026-07-14T12:10:00.000Z',
      };
      const harness = makeHarness({
        configureChannel: (channel, index) => {
          if (index !== 1) return;
          channel.send.mockImplementation(async (message) => {
            if (message.event === failedEvent) throw new Error(`${failedEvent} offline`);
            return { status: 'ok' };
          });
        },
      });
      harness.gateway.read
        .mockResolvedValueOnce(collaborativeState())
        .mockResolvedValueOnce(replacement);
      await connectReady(harness.session);
      harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
      await jest.advanceTimersByTimeAsync(100);
      expect(harness.session.status).toBe('syncing');
      const timerCountBeforeBinding = jest.getTimerCount();

      harness.session.attachBinding();
      await jest.advanceTimersByTimeAsync(0);

      expect(harness.channels[1]!.send).toHaveBeenCalledWith(
        expect.objectContaining({ event: failedEvent })
      );
      expect(harness.session.status).toBe('degraded');
      expect(jest.getTimerCount()).toBe(timerCountBeforeBinding + 1);
    }
  );

  it('starts a new hydration when a higher epoch replaces a doc with sync pending', async () => {
    let resolveOldSync!: (value: { status: string }) => void;
    let syncRequests = 0;
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'new-hydration-generation'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    const harness = makeHarness({
      configureChannel: (channel, index) => {
        if (index !== 0) return;
        channel.send.mockImplementation((message) => {
          if (message.event === 'yjs-sync-request') {
            syncRequests += 1;
            if (syncRequests === 1) {
              return new Promise((resolve) => { resolveOldSync = resolve; });
            }
          }
          return Promise.resolve({ status: 'ok' });
        });
      },
    });
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValueOnce(replacement);
    const syncListener = jest.fn();
    harness.session.on('sync', syncListener);
    const connecting = harness.session.connect();
    harness.session.attachBinding();
    for (let attempt = 0; attempt < 10 && syncRequests === 0; attempt += 1) {
      await Promise.resolve();
    }
    const oldDoc = harness.session.doc;

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    });
    expect(harness.session.doc).not.toBe(oldDoc);
    harness.session.attachBinding();
    harness.session.attachBinding();
    await jest.advanceTimersByTimeAsync(0);

    expect(syncRequests).toBe(2);
    expect(harness.session.status).toBe('ready');
    await expect(connecting).resolves.toBeUndefined();
    const awarenessCallsAfterNewHydration = harness.channel.send.mock.calls.filter(
      ([message]) => message.event === 'yjs-awareness'
    ).length;

    resolveOldSync({ status: 'ok' });
    await jest.advanceTimersByTimeAsync(0);

    expect(harness.session.status).toBe('ready');
    expect(syncRequests).toBe(2);
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-awareness'
      )
    ).toHaveLength(awarenessCallsAfterNewHydration);
    expect(syncListener.mock.calls.filter(([synced]) => synced)).toHaveLength(1);
  });

  it('continues automatic reconnect beyond five attempts until it recovers', async () => {
    const harness = makeHarness({
      channelStatuses: [
        'SUBSCRIBED',
        'CHANNEL_ERROR',
        'CHANNEL_ERROR',
        'CHANNEL_ERROR',
        'CHANNEL_ERROR',
        'CHANNEL_ERROR',
        'SUBSCRIBED',
      ],
      reconnectBackoffMs: 5_000,
    });
    await connectReady(harness.session);
    const timerCountBeforeFailure = jest.getTimerCount();

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    const delays = [5_000, 10_000, 20_000, 30_000, 30_000, 30_000];
    for (const [attempt, delay] of delays.entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(harness.channelFactory).toHaveBeenCalledTimes(attempt + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(harness.channelFactory).toHaveBeenCalledTimes(attempt + 2);
    }

    expect(harness.session.status).toBe('ready');
    expect(harness.channelFactory).toHaveBeenCalledTimes(7);
    expect(jest.getTimerCount()).toBe(timerCountBeforeFailure);
  });

  it('continues reconnecting after more than five replacement send failures', async () => {
    const harness = makeHarness({
      configureChannel: (channel, index) => {
        if (index === 0) return;
        channel.send.mockImplementation(async (message) => {
          if (index <= 6 && message.event === 'yjs-sync-request') {
            throw new Error('replacement sync offline');
          }
          return { status: 'ok' };
        });
      },
    });
    await connectReady(harness.session);
    const timerCountBeforeFailure = jest.getTimerCount();

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    const delays = [100, 100, 100, 100, 100, 100, 100];
    for (const [attempt, delay] of delays.entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(harness.channelFactory).toHaveBeenCalledTimes(attempt + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(harness.channelFactory).toHaveBeenCalledTimes(attempt + 2);
    }

    expect(harness.session.status).toBe('ready');
    expect(harness.channelFactory).toHaveBeenCalledTimes(8);
    expect(jest.getTimerCount()).toBe(timerCountBeforeFailure);
  });

  it('cancels reconnect backoff and recovers immediately on a lifecycle signal', async () => {
    const harness = makeHarness({ reconnectBackoffMs: 5_000 });
    await connectReady(harness.session);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await harness.session.recoverNow();

    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.gateway.readTransport).toHaveBeenCalledTimes(1);
    expect(harness.session.status).toBe('ready');
  });

  it('does not race lifecycle recovery against an initial pending subscription', async () => {
    const harness = makeHarness({ channelStatuses: [null] });
    const connecting = harness.session.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.session.status).toBe('connecting');
    expect(harness.channel.subscribeCallback).not.toBeNull();

    await harness.session.recoverNow();

    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
    expect(harness.channel.unsubscribe).not.toHaveBeenCalled();
    expect(harness.removeChannel).not.toHaveBeenCalled();
    harness.channel.emitStatus('SUBSCRIBED');
    harness.session.attachBinding();
    await connecting;
    expect(harness.session.status).toBe('ready');
  });

  it('replaces a stale healthy channel and single-flights lifecycle recovery', async () => {
    let finishUnsubscribe!: () => void;
    const harness = makeHarness();
    await connectReady(harness.session);
    harness.channel.unsubscribe.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        finishUnsubscribe = () => resolve('ok');
      })
    );

    const firstRecovery = harness.session.recoverNow();
    const secondRecovery = harness.session.recoverNow();
    await Promise.resolve();

    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
    finishUnsubscribe();
    await Promise.all([firstRecovery, secondRecovery]);

    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channel);
    expect(harness.setAuth).toHaveBeenCalledTimes(2);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.gateway.readTransport).toHaveBeenCalledTimes(1);
    expect(harness.session.status).toBe('ready');
  });

  it('single-flights concurrent lifecycle recovery', async () => {
    let finishUnsubscribe!: () => void;
    const harness = makeHarness({ reconnectBackoffMs: 5_000 });
    harness.channel.unsubscribe.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        finishUnsubscribe = () => resolve('ok');
      })
    );
    await connectReady(harness.session);
    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));

    const firstRecovery = harness.session.recoverNow();
    const secondRecovery = harness.session.recoverNow();
    await Promise.resolve();

    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
    finishUnsubscribe();
    await Promise.all([firstRecovery, secondRecovery]);

    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('single-flights manual retry with an automatic reconnect already in progress', async () => {
    let finishUnsubscribe!: () => void;
    const harness = makeHarness();
    harness.channel.unsubscribe.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        finishUnsubscribe = () => resolve('ok');
      })
    );
    await connectReady(harness.session);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);

    const firstRetry = harness.session.retry();
    const secondRetry = harness.session.retry();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
    finishUnsubscribe();
    await Promise.all([firstRetry, secondRetry]);

    expect(harness.removeChannel).toHaveBeenCalledTimes(1);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.session.status).toBe('ready');
  });

  it('clears a pending reconnect timer when the session is destroyed', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    expect(harness.session.status).toBe('degraded');

    await harness.session.destroy();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(100);
    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending initial subscribe when the session is destroyed', async () => {
    const harness = makeHarness({ channelStatuses: [null] });
    let connectOutcome = 'pending';
    void harness.session.connect().then(
      () => { connectOutcome = 'resolved'; },
      () => { connectOutcome = 'rejected'; }
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.channel.subscribeCallback).not.toBeNull();

    await harness.session.destroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(connectOutcome).toBe('rejected');
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channel);
    expect(harness.session.status).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects an in-flight replacement subscribe when destroyed', async () => {
    const harness = makeHarness({ channelStatuses: ['SUBSCRIBED', null] });
    await connectReady(harness.session);
    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);
    expect(harness.channels[1]!.subscribeCallback).not.toBeNull();
    let reconnectOutcome = 'pending';
    void harness.session.retry().then(
      () => { reconnectOutcome = 'resolved'; },
      () => { reconnectOutcome = 'rejected'; }
    );

    await harness.session.destroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(reconnectOutcome).toBe('rejected');
    expect(harness.channels[1]!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.removeChannel).toHaveBeenCalledWith(harness.channels[1]);
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(harness.session.status).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ignores a stale channel failure after its replacement is ready', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);

    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);
    expect(harness.session.status).toBe('ready');
    const timerCountAfterReconnect = jest.getTimerCount();

    harness.channel.emitStatus('TIMED_OUT', new Error('late old-channel timeout'));

    expect(harness.session.status).toBe('ready');
    expect(harness.channelFactory).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(timerCountAfterReconnect);
  });

  it('ignores stale update, awareness, and reset broadcasts after reconnect', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(100);
    expect(harness.session.status).toBe('ready');
    const readsAfterReconnect = harness.gateway.read.mock.calls.length;

    const peerDoc = new Y.Doc();
    peerDoc.getMap('peer').set('stale-channel', true);
    const peerAwareness = new awarenessProtocol.Awareness(peerDoc);
    peerAwareness.setLocalState({ user: { id: 'stale-peer' } });
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      peerAwareness,
      [peerAwareness.clientID]
    );

    await harness.channel.emit('yjs-update', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      updateId: '99999999-9999-4999-8999-999999999999',
      updateBase64: encodeBase64(Y.encodeStateAsUpdate(peerDoc)),
    });
    await harness.channel.emit('yjs-awareness', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      updateBase64: encodeBase64(awarenessUpdate),
    });
    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: '2026-07-14T12:10:00.000Z',
    });

    expect(harness.session.doc.getMap('peer').get('stale-channel')).toBeUndefined();
    expect(
      (harness.session.awareness as unknown as awarenessProtocol.Awareness)
        .getStates()
        .has(peerAwareness.clientID)
    ).toBe(false);
    expect(harness.gateway.read).toHaveBeenCalledTimes(readsAfterReconnect);
    expect(harness.session.status).toBe('ready');
    peerAwareness.destroy();
    peerDoc.destroy();
  });

  it.each(['CHANNEL_ERROR', 'TIMED_OUT'])(
    'keeps connect pending and automatically recovers an initial %s',
    async (initialStatus) => {
      const harness = makeHarness({
        channelStatuses: [initialStatus, 'SUBSCRIBED'],
      });
      const timerCountBeforeConnect = jest.getTimerCount();
      let settled = false;
      const outcome = harness.session.connect().then(
        () => {
          settled = true;
          return 'resolved';
        },
        () => {
          settled = true;
          return 'rejected';
        }
      );
      harness.session.attachBinding();
      await Promise.resolve();
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(harness.session.status).toBe('degraded');
      expect(jest.getTimerCount()).toBe(timerCountBeforeConnect + 1);

      await jest.advanceTimersByTimeAsync(100);

      await expect(outcome).resolves.toBe('resolved');
      expect(harness.channelFactory).toHaveBeenCalledTimes(2);
      expect(harness.gateway.read).toHaveBeenCalledTimes(1);
      expect(harness.session.status).toBe('ready');
    }
  );

  it('rejects an initial authorization error without entering transport retry', async () => {
    const harness = makeHarness();
    harness.setAuth.mockRejectedValueOnce(new Error('authorization rejected'));

    await expect(harness.session.connect()).rejects.toThrow('authorization rejected');

    expect(harness.session.status).toBe('error');
    expect(harness.channelFactory).not.toHaveBeenCalled();
  });

  it('rejects a post-subscribe durable hydration error without transport retry', async () => {
    const harness = makeHarness();
    harness.gateway.read.mockRejectedValueOnce(new Error('durable read rejected'));

    await expect(harness.session.connect()).rejects.toThrow('durable read rejected');

    expect(harness.session.status).toBe('error');
    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
  });

  it('does not create or revive a channel when destroyed during authorization', async () => {
    let finishAuthorization!: () => void;
    const harness = makeHarness();
    harness.setAuth.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishAuthorization = resolve; })
    );

    const connecting = harness.session.connect();
    await Promise.resolve();
    await harness.session.destroy();
    finishAuthorization();

    await expect(connecting).rejects.toThrow(/closed|destroyed/i);
    expect(harness.channelFactory).not.toHaveBeenCalled();
    expect(harness.session.status).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not revive a legacy session destroyed while the reset send is pending', async () => {
    let finishSend!: () => void;
    const legacy = { ...collaborativeState(), mode: 'legacy' as const, yjsStateBase64: null };
    const harness = makeHarness({ state: legacy });
    harness.channel.send.mockImplementationOnce(
      () => new Promise<{ status: string }>((resolve) => {
        finishSend = () => resolve({ status: 'ok' });
      })
    );

    const connecting = harness.session.connect();
    const connectionResult = connecting.catch((error: unknown) => error);
    for (let attempt = 0; attempt < 10 && harness.channel.send.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(harness.gateway.initialize).toHaveBeenCalled();
    expect(harness.channel.send).toHaveBeenCalled();
    await harness.session.destroy();
    finishSend();

    await expect(connectionResult).resolves.toMatchObject({
      message: expect.stringMatching(/closed|destroyed/i),
    });
    expect(harness.session.status).toBe('closed');
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

  it('waits for one initial sync and awareness flight before becoming ready', async () => {
    let resolveSync!: (value: { status: string }) => void;
    let resolveAwareness!: (value: { status: string }) => void;
    const harness = makeHarness({
      configureChannel: (channel, index) => {
        if (index !== 0) return;
        channel.send.mockImplementation((message) => {
          if (message.event === 'yjs-sync-request') {
            return new Promise((resolve) => { resolveSync = resolve; });
          }
          if (message.event === 'yjs-awareness') {
            return new Promise((resolve) => { resolveAwareness = resolve; });
          }
          return Promise.resolve({ status: 'ok' });
        });
      },
    });
    const statuses: string[] = [];
    const syncListener = jest.fn();
    harness.session.subscribe(({ status }) => statuses.push(status));
    harness.session.on('sync', syncListener);
    let connectOutcome = 'pending';
    void harness.session.connect().then(
      () => { connectOutcome = 'resolved'; },
      () => { connectOutcome = 'rejected'; }
    );
    harness.session.attachBinding();
    harness.session.attachBinding();
    for (
      let attempt = 0;
      attempt < 10 &&
        !harness.channel.send.mock.calls.some(([message]) =>
          message.event === 'yjs-sync-request'
        );
      attempt += 1
    ) {
      await Promise.resolve();
    }

    expect(harness.session.status).toBe('syncing');
    expect(connectOutcome).toBe('pending');
    expect(statuses).not.toContain('ready');
    expect(syncListener).not.toHaveBeenCalledWith(true);
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-sync-request'
      )
    ).toHaveLength(1);

    resolveSync({ status: 'ok' });
    for (
      let attempt = 0;
      attempt < 10 &&
        !harness.channel.send.mock.calls.some(([message]) =>
          message.event === 'yjs-awareness'
        );
      attempt += 1
    ) {
      await Promise.resolve();
    }

    expect(harness.session.status).toBe('syncing');
    expect(connectOutcome).toBe('pending');
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-awareness'
      )
    ).toHaveLength(1);

    resolveAwareness({ status: 'ok' });
    await jest.advanceTimersByTimeAsync(0);

    expect(harness.session.status).toBe('ready');
    expect(connectOutcome).toBe('resolved');
    expect(syncListener.mock.calls.filter(([synced]) => synced)).toHaveLength(1);
  });

  it('degrades without ever becoming ready when initial peer sync rejects', async () => {
    let rejectSync!: (error: Error) => void;
    const harness = makeHarness({
      configureChannel: (channel, index) => {
        if (index !== 0) return;
        channel.send.mockImplementation((message) => {
          if (message.event === 'yjs-sync-request') {
            return new Promise((_resolve, reject) => { rejectSync = reject; });
          }
          return Promise.resolve({ status: 'ok' });
        });
      },
    });
    const statuses: string[] = [];
    const syncListener = jest.fn();
    harness.session.subscribe(({ status }) => statuses.push(status));
    harness.session.on('sync', syncListener);
    let connectOutcome = 'pending';
    void harness.session.connect().then(
      () => { connectOutcome = 'resolved'; },
      () => { connectOutcome = 'rejected'; }
    );
    harness.session.attachBinding();
    harness.session.attachBinding();
    for (
      let attempt = 0;
      attempt < 10 &&
        !harness.channel.send.mock.calls.some(([message]) =>
          message.event === 'yjs-sync-request'
        );
      attempt += 1
    ) {
      await Promise.resolve();
    }
    const timerCountBeforeFailure = jest.getTimerCount();

    expect(harness.session.status).toBe('syncing');
    rejectSync(new Error('initial sync offline'));
    await jest.advanceTimersByTimeAsync(0);

    expect(harness.session.status).toBe('degraded');
    expect(statuses).not.toContain('ready');
    expect(syncListener).not.toHaveBeenCalledWith(true);
    expect(connectOutcome).toBe('pending');
    expect(jest.getTimerCount()).toBe(timerCountBeforeFailure + 1);
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-sync-request'
      )
    ).toHaveLength(1);
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-awareness'
      )
    ).toHaveLength(0);

    await harness.session.destroy();
  });

  it.each(['resolve', 'reject'])(
    'ignores a stale hydration send that %s after the channel reconnects',
    async (settlement) => {
      let resolveOldSync!: (value: { status: string }) => void;
      let rejectOldSync!: (error: Error) => void;
      const harness = makeHarness({
        configureChannel: (channel, index) => {
          if (index !== 0) return;
          channel.send.mockImplementation((message) => {
            if (message.event === 'yjs-sync-request') {
              return new Promise((resolve, reject) => {
                resolveOldSync = resolve;
                rejectOldSync = reject;
              });
            }
            return Promise.resolve({ status: 'ok' });
          });
        },
      });
      const statuses: string[] = [];
      const syncListener = jest.fn();
      harness.session.subscribe(({ status }) => statuses.push(status));
      harness.session.on('sync', syncListener);
      const connecting = harness.session.connect();
      harness.session.attachBinding();
      for (
        let attempt = 0;
        attempt < 10 &&
          !harness.channel.send.mock.calls.some(([message]) =>
            message.event === 'yjs-sync-request'
          );
        attempt += 1
      ) {
        await Promise.resolve();
      }

      harness.channel.emitStatus('CHANNEL_ERROR', new Error('socket closed'));
      await jest.advanceTimersByTimeAsync(100);
      await expect(connecting).resolves.toBeUndefined();
      expect(harness.session.status).toBe('ready');
      const readyCount = statuses.filter((status) => status === 'ready').length;
      const trueSyncCount = syncListener.mock.calls.filter(([synced]) => synced).length;
      const replacementAwarenessCalls = harness.channels[1]!.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-awareness'
      ).length;
      const timerCountAfterReconnect = jest.getTimerCount();

      if (settlement === 'resolve') {
        resolveOldSync({ status: 'ok' });
      } else {
        rejectOldSync(new Error('stale sync failed'));
      }
      await jest.advanceTimersByTimeAsync(0);

      expect(harness.session.status).toBe('ready');
      expect(harness.channelFactory).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(timerCountAfterReconnect);
      expect(statuses.filter((status) => status === 'ready')).toHaveLength(readyCount);
      expect(syncListener.mock.calls.filter(([synced]) => synced)).toHaveLength(
        trueSyncCount
      );
      expect(
        harness.channels[1]!.send.mock.calls.filter(
          ([message]) => message.event === 'yjs-awareness'
        )
      ).toHaveLength(replacementAwarenessCalls);
    }
  );

  it.each(['resolve', 'reject'])(
    'rejects connect immediately when destroyed with hydration send pending, then ignores %s',
    async (settlement) => {
      let resolveSync!: (value: { status: string }) => void;
      let rejectSync!: (error: Error) => void;
      const harness = makeHarness({
        configureChannel: (channel, index) => {
          if (index !== 0) return;
          channel.send.mockImplementation((message) => {
            if (message.event === 'yjs-sync-request') {
              return new Promise((resolve, reject) => {
                resolveSync = resolve;
                rejectSync = reject;
              });
            }
            return Promise.resolve({ status: 'ok' });
          });
        },
      });
      const statuses: string[] = [];
      harness.session.subscribe(({ status }) => statuses.push(status));
      let connectOutcome = 'pending';
      void harness.session.connect().then(
        () => { connectOutcome = 'resolved'; },
        () => { connectOutcome = 'rejected'; }
      );
      harness.session.attachBinding();
      for (
        let attempt = 0;
        attempt < 10 &&
          !harness.channel.send.mock.calls.some(([message]) =>
            message.event === 'yjs-sync-request'
          );
        attempt += 1
      ) {
        await Promise.resolve();
      }

      await harness.session.destroy();
      await Promise.resolve();
      const outcomeImmediatelyAfterDestroy = connectOutcome;

      if (settlement === 'resolve') {
        resolveSync({ status: 'ok' });
      } else {
        rejectSync(new Error('late hydration failure'));
      }
      await jest.advanceTimersByTimeAsync(0);

      expect(outcomeImmediatelyAfterDestroy).toBe('rejected');
      expect(connectOutcome).toBe('rejected');
      expect(harness.session.status).toBe('closed');
      expect(statuses).not.toContain('ready');
      expect(harness.channelFactory).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

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

  it('fails closed when a refreshed Realtime token cannot be installed', async () => {
    const { session, setAuth } = makeHarness();
    await connectReady(session);
    setAuth.mockRejectedValueOnce(new Error('token rejected'));

    await expect(session.updateAccessToken('rejected-token')).rejects.toThrow(
      'token rejected'
    );

    expect(session.status).toBe('error');
  });

  it('ignores focus catch-up until the initial collaboration connection is ready', async () => {
    const { session, gateway } = makeHarness();

    await session.refresh();

    expect(gateway.read).not.toHaveBeenCalled();
    expect(session.status).toBe('idle');
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

  it('rebases user edits without a losing block ID when an old-epoch append conflicts', async () => {
    const { initial, winner } = sharedBlockState();
    let appendAttempt = 0;
    const harness = makeHarness({
      state: initial,
      append: async (_client, input) => {
        appendAttempt += 1;
        if (appendAttempt === 1) {
          throw new DocumentStateConflictError('epoch changed', winner.token);
        }
        return { acceptedIds: input.updates.map((update) => update.id) };
      },
    });
    await connectReady(harness.session);
    harness.gateway.readTransport.mockResolvedValue(winner);

    const localBlock = documentBlock(harness.session.doc);
    const localNodeState = localBlock.getAttribute('__state');
    if (!(localNodeState instanceof Y.Map)) {
      throw new Error('Expected local block node state');
    }
    localNodeState.set('kecoBlockId', 'loser-b');
    localBlock.insert(localBlock.length, ' local user edit');
    await jest.advanceTimersByTimeAsync(75);
    await Promise.resolve();

    expect(harness.gateway.readTransport).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_ID
    );
    expect(harness.session.token).toEqual({ epoch: 3, revision: 5 });
    harness.session.attachBinding();
    await jest.advanceTimersByTimeAsync(0);
    const rebasedBlock = documentBlock(harness.session.doc);
    const rebasedNodeState = rebasedBlock.getAttribute('__state');
    expect(rebasedNodeState).toBeInstanceOf(Y.Map);
    expect((rebasedNodeState as Y.Map<unknown>).get('kecoBlockId')).toBe(
      'winner-a'
    );
    expect(rebasedBlock.toString()).toBe('Seed local user edit');

    await jest.advanceTimersByTimeAsync(75);
    const rebasedAppend = harness.gateway.appendUpdates.mock.calls[1]?.[1];
    expect(rebasedAppend).toMatchObject({ epoch: 3 });
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, decodeBase64(winner.yjsStateBase64!));
    Y.applyUpdate(
      persisted,
      decodeBase64(rebasedAppend?.updates[0]?.updateBase64 ?? '')
    );
    const persistedBlock = documentBlock(persisted);
    const persistedNodeState = persistedBlock.getAttribute('__state');
    expect((persistedNodeState as Y.Map<unknown>).get('kecoBlockId')).toBe(
      'winner-a'
    );
    expect(persistedBlock.toString()).toBe('Seed local user edit');
    persisted.destroy();
  });

  it('fails closed without appending when the current semantic state is invalid', async () => {
    const state = {
      ...collaborativeState(),
      yjsStateBase64: invalidCalloutState(),
    };
    const harness = makeHarness({ state });
    await connectReady(harness.session);

    harness.session.doc.getMap('local').set('trigger', true);
    await jest.advanceTimersByTimeAsync(75);
    await Promise.resolve();

    expect(harness.gateway.appendUpdates).not.toHaveBeenCalled();
    expect(harness.session.status).toBe('degraded');
  });

  it('persists the validated active state when an undurable sync response repairs a local edit', async () => {
    const durableSnapshot = calloutState('note');
    const state = {
      ...collaborativeState(),
      yjsStateBase64: durableSnapshot,
    };
    const harness = makeHarness({ state });
    await connectReady(harness.session);

    setCalloutType(harness.session.doc, 'danger');
    const invalidStateVector = Y.encodeStateVector(harness.session.doc);
    const repairingPeer = new Y.Doc();
    Y.applyUpdate(
      repairingPeer,
      Y.encodeStateAsUpdate(harness.session.doc)
    );
    setCalloutType(repairingPeer, 'success');
    const repair = Y.encodeStateAsUpdate(repairingPeer, invalidStateVector);

    await harness.channel.emit('yjs-sync-response', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      requesterId: USER_ID,
      updateBase64: encodeBase64(repair),
    });
    expect(
      (calloutElement(harness.session.doc).getAttribute('__mdastNode') as {
        attributes: Array<{ value: string }>;
      }).attributes[0]?.value
    ).toBe('success');

    await jest.advanceTimersByTimeAsync(75);

    const appended = harness.gateway.appendUpdates.mock.calls[0]![1].updates[0]!;
    const reconstructed = new Y.Doc();
    Y.applyUpdate(reconstructed, decodeBase64(durableSnapshot));
    Y.applyUpdate(reconstructed, decodeBase64(appended.updateBase64));
    const persistedNode = calloutElement(reconstructed).getAttribute('__mdastNode');
    expect(() => validateSanctionedMdxAstNode(persistedNode)).not.toThrow();
    expect(
      (persistedNode as { attributes: Array<{ value: string }> }).attributes[0]
        ?.value
    ).toBe('success');

    reconstructed.destroy();
    repairingPeer.destroy();
  });

  it('drains edits queued while an append is still in flight', async () => {
    let resolveFirstAppend!: (value: { acceptedIds: string[] }) => void;
    const firstAppend = new Promise<{ acceptedIds: string[] }>((resolve) => {
      resolveFirstAppend = resolve;
    });
    const append = jest
      .fn()
      .mockImplementationOnce(async () => firstAppend)
      .mockResolvedValue({ acceptedIds: [] });
    const harness = makeHarness({ append });
    await connectReady(harness.session);

    harness.session.doc.getMap('local').set('first', 1);
    await jest.advanceTimersByTimeAsync(75);
    expect(append).toHaveBeenCalledTimes(1);

    harness.session.doc.getMap('local').set('second', 2);
    await jest.advanceTimersByTimeAsync(75);
    expect(append).toHaveBeenCalledTimes(1);

    const firstIds = append.mock.calls[0]![1].updates.map(
      (update: { id: string }) => update.id
    );
    resolveFirstAppend({ acceptedIds: firstIds });
    await harness.session.flush();

    expect(append).toHaveBeenCalledTimes(2);
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-update'
      )
    ).toHaveLength(2);
  });

  it('does not publish or count an old-epoch append after a reset replaces the document', async () => {
    let resolveAppend!: (value: { acceptedIds: string[] }) => void;
    const pendingAppend = new Promise<{ acceptedIds: string[] }>((resolve) => {
      resolveAppend = resolve;
    });
    const harness = makeHarness({ append: async () => pendingAppend });
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'while-append-pending'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValue(replacement);
    await connectReady(harness.session);
    harness.session.doc.getMap('local').set('old-epoch-pending', true);
    await jest.advanceTimersByTimeAsync(75);
    const pending = harness.gateway.appendUpdates.mock.calls[0]![1];

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    });
    resolveAppend({ acceptedIds: pending.updates.map((update) => update.id) });
    await jest.advanceTimersByTimeAsync(0);

    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-update'
      )
    ).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(harness.gateway.compact).not.toHaveBeenCalled();
  });

  it('keeps the Lexical awareness shape required for relative cursors', async () => {
    const harness = makeHarness();
    const awareness =
      harness.session.awareness as unknown as awarenessProtocol.Awareness;
    awareness.setLocalState({
      name: 'Editor',
      color: '#1677ff',
      focusing: false,
      anchorPos: null,
      focusPos: null,
      awarenessData: { userId: USER_ID },
    });

    await connectReady(harness.session);

    expect(awareness.getLocalState()).toMatchObject({
      name: 'Editor',
      color: '#1677ff',
      focusing: false,
      anchorPos: null,
      focusPos: null,
      awarenessData: { userId: USER_ID },
    });
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
    expect(harness.session.hasPendingChanges).toBe(true);
    const firstId = append.mock.calls[0]![1].updates[0].id;

    await harness.session.retry();
    expect(append.mock.calls[1]![1].updates[0].id).toBe(firstId);
    expect(harness.channel.unsubscribe).not.toHaveBeenCalled();
    expect(harness.removeChannel).not.toHaveBeenCalled();
    expect(harness.setAuth).toHaveBeenCalledTimes(1);
    expect(harness.channelFactory).toHaveBeenCalledTimes(1);
    expect(harness.session.status).toBe('ready');
  });

  it.each(['throw', 'error-result'])(
    'keeps durable success clean after a channel send %s and reconnects',
    async (failureMode) => {
      const harness = makeHarness();
      await connectReady(harness.session);
      const timerCountBeforeFailure = jest.getTimerCount();
      if (failureMode === 'throw') {
        harness.channel.send.mockRejectedValueOnce(new Error('send offline'));
      } else {
        harness.channel.send.mockResolvedValueOnce({ status: 'error' });
      }
      harness.session.doc.getMap('local').set('send-failure', failureMode);

      await jest.advanceTimersByTimeAsync(75);

      const firstId = harness.gateway.appendUpdates.mock.calls[0]![1].updates[0].id;
      expect(harness.session.status).toBe('degraded');
      expect(harness.session.hasPendingChanges).toBe(false);
      expect(jest.getTimerCount()).toBeGreaterThan(timerCountBeforeFailure);

      await jest.advanceTimersByTimeAsync(100);

      expect(harness.gateway.appendUpdates).toHaveBeenCalledTimes(1);
      expect(harness.channelFactory).toHaveBeenCalledTimes(2);
      expect(firstId).toEqual(expect.any(String));
      expect(harness.session.status).toBe('ready');
    }
  );

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
    expect(harness.channel.send).not.toHaveBeenCalled();
  });

  it('exposes pending local durability for the browser unload guard', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);

    expect(harness.session.hasPendingChanges).toBe(false);
    harness.session.doc.getMap('local').set('pending', true);
    expect(harness.session.hasPendingChanges).toBe(true);

    await jest.advanceTimersByTimeAsync(75);
    expect(harness.session.hasPendingChanges).toBe(false);
  });

  it('moves a legacy viewer to syncing when durable collaboration appears', async () => {
    const legacy = {
      ...collaborativeState(),
      mode: 'legacy' as const,
      yjsStateBase64: null,
      token: { epoch: 0, revision: 0 },
    };
    const collaborative = {
      ...collaborativeState(),
      token: { epoch: 0, revision: 1 },
    };
    const harness = makeHarness({ state: legacy, role: 'viewer' });
    harness.gateway.read.mockResolvedValueOnce(legacy).mockResolvedValue(collaborative);

    await harness.session.connect();
    expect(harness.session.status).toBe('legacy-view');
    await jest.advanceTimersByTimeAsync(15_000);

    expect(harness.session.status).toBe('syncing');
    harness.session.attachBinding();
    expect(harness.session.status).toBe('ready');
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

  it('isolates invalid peer candidates without consuming their update id', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const updateId = '55555555-5555-4555-8555-555555555555';

    await harness.channel.emit('yjs-update', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      updateId,
      updateBase64: invalidCalloutState(),
    });

    expect(harness.session.doc.get('root', Y.XmlText).toString()).toBe('seed');
    const validUpdate = mapUpdate('accepted-after-invalid', 'remote');
    await harness.channel.emit('yjs-update', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      updateId,
      updateBase64: validUpdate,
    });

    expect(harness.session.doc.getMap('peer').get('accepted-after-invalid')).toBe(
      'remote'
    );
  });

  it('validates sync response candidates before applying them', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);

    await harness.channel.emit('yjs-sync-response', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 2,
      requesterId: USER_ID,
      updateBase64: invalidCalloutState(),
    });

    expect(harness.session.doc.get('root', Y.XmlText).toString()).toBe('seed');
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
    expect(harness.gateway.readTransport).toHaveBeenCalledTimes(1);
    expect(harness.session.doc.getMap('peer').get('missed')).toBe('durable');
  });

  it('applies a same-epoch compacted snapshot before advancing the token', async () => {
    const initial = collaborativeState();
    const caughtUp = {
      ...initial,
      yjsStateBase64: mapUpdate('compacted', 'durable'),
      updateTail: [],
      token: { epoch: 2, revision: 5 },
    };
    const harness = makeHarness();
    harness.gateway.read.mockResolvedValueOnce(initial).mockResolvedValue(caughtUp);
    await connectReady(harness.session);
    const applied: Array<{ origin: unknown; token: { epoch: number; revision: number } }> = [];
    harness.session.doc.on('update', (_update, origin) => {
      if (harness.session.doc.getMap('peer').get('compacted') === 'durable') {
        applied.push({ origin, token: harness.session.token });
      }
    });

    await jest.advanceTimersByTimeAsync(15_000);

    expect(harness.session.doc.getMap('peer').get('compacted')).toBe('durable');
    expect(applied).toEqual([
      { origin: 'remote', token: { epoch: 2, revision: 4 } },
    ]);
    expect(harness.session.token).toEqual({ epoch: 2, revision: 5 });
  });

  it('does not regress the token when a same-epoch durable read has a lower revision', async () => {
    const stale = {
      ...collaborativeState(),
      token: { epoch: 2, revision: 3 },
    };
    const harness = makeHarness();
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValueOnce(stale);
    await connectReady(harness.session);

    await harness.session.refresh();

    expect(harness.session.token).toEqual({ epoch: 2, revision: 4 });
  });

  it('synchronizes reloaded tail counters and schedules writer compaction', async () => {
    const caughtUp = {
      ...collaborativeState(),
      token: { epoch: 2, revision: 5 },
      updateTail: Array.from({ length: 100 }, (_, index) => ({
        id: `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`,
        updateBase64: mapUpdate(`reloaded-${index}`, `value-${index}`),
      })),
    };
    const harness = makeHarness();
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValueOnce(caughtUp);
    await connectReady(harness.session);

    await harness.session.refresh();
    await Promise.resolve();

    expect(harness.gateway.compact).toHaveBeenCalledWith(expect.anything(), {
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 5 },
    });
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
    const syncCallsBeforeBinding = harness.channel.send.mock.calls.filter(
      ([message]) => message.event === 'yjs-sync-request'
    ).length;
    harness.session.attachBinding();
    harness.session.attachBinding();
    await jest.advanceTimersByTimeAsync(0);
    expect(harness.session.status).toBe('ready');
    expect(
      harness.channel.send.mock.calls.filter(
        ([message]) => message.event === 'yjs-sync-request'
      )
    ).toHaveLength(syncCallsBeforeBinding + 1);
    expect(harness.session.token).toEqual({ epoch: 3, revision: 1 });
    expect(harness.session.doc.getMap('peer').get('restored')).toBe('version');
    expect(reload).toHaveBeenCalledTimes(1);

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    });
    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rebases pending user edits after a normalization reset', async () => {
    const { initial, winner } = sharedBlockState();
    const harness = makeHarness({ state: initial });
    harness.gateway.read
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(winner);
    await connectReady(harness.session);

    const localBlock = documentBlock(harness.session.doc);
    const localNodeState = localBlock.getAttribute('__state');
    if (!(localNodeState instanceof Y.Map)) {
      throw new Error('Expected local block node state');
    }
    localNodeState.set('kecoBlockId', 'loser-b');
    localBlock.insert(localBlock.length, ' local reset edit');

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 5,
      reason: 'normalization',
      updatedAt: winner.updatedAt,
    });

    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    harness.session.attachBinding();
    await jest.advanceTimersByTimeAsync(0);
    expect(harness.session.token).toEqual({ epoch: 3, revision: 5 });
    const rebasedBlock = documentBlock(harness.session.doc);
    const rebasedNodeState = rebasedBlock.getAttribute('__state');
    expect((rebasedNodeState as Y.Map<unknown>).get('kecoBlockId')).toBe(
      'winner-a'
    );
    expect(rebasedBlock.toString()).toBe('Seed local reset edit');
  });

  it.each(['restore', 'agent'] as const)(
    'discards pending old-epoch edits after a durable %s replacement',
    async (reason) => {
      const { initial } = sharedBlockState();
      const replacement = replacementBlockState(
        initial,
        `${reason} replacement`,
        reason
      );
      const harness = makeHarness({ state: initial });
      harness.gateway.read
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(replacement);
      await connectReady(harness.session);

      const localBlock = documentBlock(harness.session.doc);
      localBlock.insert(localBlock.length, ' stale local edit');

      if (reason === 'restore') {
        await harness.session.refresh();
      } else {
        await harness.channel.emit('document-state-reset', {
          v: 1,
          documentId: DOCUMENT_ID,
          epoch: 3,
          revision: 5,
          reason,
          updatedAt: replacement.updatedAt,
        });
      }
      harness.session.attachBinding();
      await jest.advanceTimersByTimeAsync(0);

      expect(documentBlockTexts(harness.session.doc)).toEqual([
        `${reason} replacement`,
      ]);
    }
  );

  it('single-flights concurrent higher-epoch resets and freezes immediately', async () => {
    let resolveRead!: (state: AuthoritativeDocumentState) => void;
    const pendingRead = new Promise<AuthoritativeDocumentState>((resolve) => {
      resolveRead = resolve;
    });
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'concurrent-reset'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    const harness = makeHarness();
    await connectReady(harness.session);
    harness.gateway.read.mockImplementation(() => pendingRead);
    const oldDoc = harness.session.doc;
    const reload = jest.fn();
    harness.session.on('reload', reload);
    const reset = {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    };

    const firstReset = harness.channel.emit('document-state-reset', reset);
    const secondReset = harness.channel.emit('document-state-reset', reset);

    expect(harness.session.status).toBe('hydrating');
    expect(harness.session.doc).toBe(oldDoc);
    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    resolveRead(replacement);
    await Promise.all([firstReset, secondReset]);

    expect(harness.session.status).toBe('syncing');
    expect(harness.session.doc).not.toBe(oldDoc);
    expect(harness.gateway.read).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('enters observable degraded state when a valid reset durable read fails', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const states: Array<{ status: string; error: string | null }> = [];
    harness.session.subscribe(({ status, error }) => states.push({ status, error }));
    harness.gateway.read.mockRejectedValueOnce(new Error('durable reset read failed'));

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: '2026-07-14T12:10:00.000Z',
    });

    expect(harness.session.status).toBe('degraded');
    expect(states.at(-1)).toEqual({
      status: 'degraded',
      error: 'durable reset read failed',
    });
  });

  it('degrades when reset catch-up reads below its minimum token and allows refresh retry', async () => {
    const stale = collaborativeState();
    const replacement = {
      ...collaborativeState(),
      yjsStateBase64: mapUpdate('restored', 'after-stale-read'),
      token: { epoch: 3, revision: 1 },
      updatedAt: '2026-07-14T12:10:00.000Z',
    };
    const harness = makeHarness();
    harness.gateway.read
      .mockResolvedValueOnce(collaborativeState())
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(replacement);
    const states: Array<{ status: string; error: string | null }> = [];
    harness.session.subscribe(({ status, error }) => states.push({ status, error }));
    await connectReady(harness.session);

    await harness.channel.emit('document-state-reset', {
      v: 1,
      documentId: DOCUMENT_ID,
      epoch: 3,
      revision: 1,
      reason: 'restore',
      updatedAt: replacement.updatedAt,
    });

    expect(harness.session.status).toBe('degraded');
    expect(states.at(-1)?.error).toMatch(/behind.*minimum token/i);
    await harness.session.refresh();
    expect(harness.session.token).toEqual({ epoch: 3, revision: 1 });
    expect(harness.session.status).toBe('syncing');
  });

  it('flushes, commits, reloads, and only then broadcasts a version restore', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const reload = jest.fn();
    harness.session.on('reload', reload);
    harness.session.doc.getMap('local').set('pending-before-restore', true);

    const state = await harness.session.restoreVersion(VERSION_ID);

    expect(harness.gateway.appendUpdates).toHaveBeenCalledTimes(1);
    expect(harness.gateway.replace).toHaveBeenCalledWith(expect.anything(), {
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      replacement: { kind: 'version', versionId: VERSION_ID },
      reason: 'restore',
    });
    expect(
      harness.gateway.appendUpdates.mock.invocationCallOrder[0]
    ).toBeLessThan(harness.gateway.replace.mock.invocationCallOrder[0]!);
    const resetCall = harness.channel.send.mock.calls.find(
      ([message]) => message.event === 'document-state-reset'
    );
    expect(resetCall).toEqual([
      expect.objectContaining({
        type: 'broadcast',
        event: 'document-state-reset',
        payload: expect.objectContaining({
          documentId: DOCUMENT_ID,
          epoch: 3,
          revision: 5,
          reason: 'restore',
        }),
      }),
    ]);
    expect(harness.gateway.replace.mock.invocationCallOrder[0]).toBeLessThan(
      harness.channel.send.mock.invocationCallOrder[
        harness.channel.send.mock.calls.indexOf(resetCall!)
      ]!
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(harness.onStateReplaced).toHaveBeenCalledWith(state);
    expect(state.token).toEqual({ epoch: 3, revision: 5 });
  });

  it('rejects viewer restore before flushing or calling the gateway', async () => {
    const harness = makeHarness({ role: 'viewer' });
    await connectReady(harness.session);

    await expect(harness.session.restoreVersion(VERSION_ID)).rejects.toBeInstanceOf(
      DocumentReadOnlyError
    );
    expect(harness.gateway.appendUpdates).not.toHaveBeenCalled();
    expect(harness.gateway.replace).not.toHaveBeenCalled();
  });

  it('persists and broadcasts an edit when destroyed before the batch timer fires', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);

    harness.session.doc.getMap('local').set('last-second-edit', true);
    await harness.session.destroy();

    expect(harness.gateway.appendUpdates).toHaveBeenCalledTimes(1);
    expect(harness.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'yjs-update',
        payload: expect.objectContaining({ documentId: DOCUMENT_ID, epoch: 2 }),
      })
    );
  });

  it('flushes once and removes channel, awareness, timers, and listeners on destroy', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    const awareness = harness.session.awareness as unknown as awarenessProtocol.Awareness;
    awareness.setLocalState({ user: { id: USER_ID } });
    harness.channel.send.mockClear();

    await harness.session.destroy();
    await harness.session.destroy();

    expect(harness.removeChannel).toHaveBeenCalledTimes(1);
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.channel.send).toHaveBeenCalledTimes(1);
    expect(harness.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'yjs-awareness' })
    );
    expect(harness.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      harness.channel.unsubscribe.mock.invocationCallOrder[0]!
    );
    expect(awareness.getLocalState()).toBeNull();
    expect(harness.session.status).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds awareness departure and never fails destroy when its send stalls', async () => {
    const harness = makeHarness();
    await connectReady(harness.session);
    harness.channel.send.mockClear();
    harness.channel.send.mockImplementationOnce(() => new Promise(() => undefined));

    const destroying = harness.session.destroy();
    await jest.advanceTimersByTimeAsync(250);

    await expect(destroying).resolves.toBeUndefined();
    expect(harness.channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.session.status).toBe('closed');
  });
});
