import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Provider } from '@lexical/yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  decodeBase64,
  documentCollabTopic,
  encodeBase64,
  parseDocumentCollaborationEvent,
  type DocumentCollaborationEventName,
} from './documentCollaborationProtocol';
import type {
  AuthoritativeDocumentState,
  AuthoritativeDocumentTransportState,
  CollaborationStatus,
  DocumentStateToken,
  DurableYjsUpdate,
  ReplaceDocumentStateInput,
} from './documentStateTypes';
import {
  DocumentCollaborationUnavailableError,
  DocumentReadOnlyError,
  DocumentStateConflictError,
} from './documentStateTypes';
import {
  captureDocumentYjsBlockIds,
  restoreDocumentYjsBlockIds,
} from './documentYjsBlockIdentity';
import { validateSanctionedMdxAstNode } from './sanctionedMdx';

export type DocumentCollaborationRole = 'admin' | 'editor' | 'viewer';

export type DocumentCollaborationGateway = {
  read(client: SupabaseClient, documentId: string): Promise<AuthoritativeDocumentState>;
  readTransport(
    client: SupabaseClient,
    documentId: string
  ): Promise<AuthoritativeDocumentTransportState>;
  initialize(
    client: SupabaseClient,
    documentId: string,
    markdown: string
  ): Promise<AuthoritativeDocumentState>;
  appendUpdates(
    client: SupabaseClient,
    input: {
      documentId: string;
      epoch: number;
      updates: DurableYjsUpdate[];
    }
  ): Promise<{ acceptedIds: string[] }>;
  compact(
    client: SupabaseClient,
    input: { documentId: string; expected: DocumentStateToken }
  ): Promise<AuthoritativeDocumentState>;
  replace(
    client: SupabaseClient,
    input: ReplaceDocumentStateInput
  ): Promise<AuthoritativeDocumentState>;
};

export type CollaborationViewState = {
  status: CollaborationStatus;
  token: DocumentStateToken;
  error: string | null;
};

export type DocumentBindingFailureDirection =
  | 'lexical-to-yjs'
  | 'yjs-to-lexical'
  | 'composition'
  | 'presence'
  | 'undo-redo';

export type DocumentCollaborationSessionOptions = {
  supabase: SupabaseClient;
  gateway: DocumentCollaborationGateway;
  documentId: string;
  projectId: string;
  userId: string;
  accessToken: string;
  role: DocumentCollaborationRole;
  user: { name: string; color: string };
  batchWindowMs?: number;
  compactionBackoffMs?: number;
  compactionJitterRatio?: number;
  reconnectBackoffMs?: number;
  reconnectJitterRatio?: number;
  onCompacted?: (state: AuthoritativeDocumentState) => void | Promise<void>;
  onStateReplaced?: (state: AuthoritativeDocumentState) => void | Promise<void>;
};

type ProviderStatusPayload = { status: string };
type ProviderListenerMap = {
  sync: Set<(synced: boolean) => void>;
  status: Set<(payload: ProviderStatusPayload) => void>;
  update: Set<(update: unknown) => void>;
  reload: Set<(doc: Y.Doc) => void>;
};

type BufferedEvent = {
  event: DocumentCollaborationEventName;
  payload: unknown;
};

type DocumentStateResetEvent = {
  documentId: string;
  epoch: number;
  revision: number;
};

type PendingDurableUpdate = DurableYjsUpdate & {
  bytes: Uint8Array;
};

const SYNC_EVENTS: DocumentCollaborationEventName[] = [
  'yjs-update',
  'yjs-sync-request',
  'yjs-sync-response',
  'yjs-awareness',
  'document-state-reset',
];

class DocumentChannelTransportError extends Error {
  constructor(message: string, readonly handled = false) {
    super(message);
    this.name = 'DocumentChannelTransportError';
  }
}

class StaleDocumentChannelOperationError extends Error {}

function newUpdateId(): string {
  return globalThis.crypto.randomUUID();
}

function validateSerializedMdxNodes(value: unknown): void {
  if (value instanceof Y.XmlElement) {
    if (value.getAttribute('__type') === 'jsx') {
      validateSanctionedMdxAstNode(value.getAttribute('__mdastNode'));
    }
    for (const child of value.toArray()) validateSerializedMdxNodes(child);
    return;
  }
  if (value instanceof Y.XmlText) {
    for (const delta of value.toDelta()) {
      if (typeof delta.insert !== 'string') {
        validateSerializedMdxNodes(delta.insert);
      }
    }
  }
}

export class DocumentCollaborationSession implements Provider {
  readonly documentId: string;
  readonly projectId: string;
  readonly userId: string;

  private readonly supabase: SupabaseClient;
  private readonly gateway: DocumentCollaborationGateway;
  private accessToken: string;
  private readonly role: DocumentCollaborationRole;
  private readonly user: { name: string; color: string };
  private readonly batchWindowMs: number;
  private readonly compactionBackoffMs: number;
  private readonly compactionJitterRatio: number;
  private readonly reconnectBackoffMs: number;
  private readonly reconnectJitterRatio: number;
  private readonly onCompacted?: (
    state: AuthoritativeDocumentState
  ) => void | Promise<void>;
  private readonly onStateReplaced?: (
    state: AuthoritativeDocumentState
  ) => void | Promise<void>;
  private readonly viewListeners = new Set<(state: CollaborationViewState) => void>();
  private readonly providerListeners: ProviderListenerMap = {
    sync: new Set(),
    status: new Set(),
    update: new Set(),
    reload: new Set(),
  };

  private channel: RealtimeChannel | null = null;
  private pendingState: AuthoritativeDocumentTransportState | null = null;
  private bufferedEvents: BufferedEvent[] = [];
  private appliedUpdateIds = new Set<string>();
  private localUpdates: Uint8Array[] = [];
  private pendingDurable: PendingDurableUpdate | null = null;
  private pendingEpochRebase: Uint8Array | null = null;
  private persistPromise: Promise<void> | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  private compactInterval: ReturnType<typeof setInterval> | null = null;
  private compactRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private compactPromise: Promise<void> | null = null;
  private reloadPromise: Promise<void> | null = null;
  private reloadQueued = false;
  private reloadMinimumToken: DocumentStateToken | null = null;
  private compactAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectPromise: Promise<void> | null = null;
  private hydrationPromise: Promise<void> | null = null;
  private hydrationGeneration = 0;
  private reconnectAttempts = 0;
  private channelGeneration = 0;
  private channelHealthy = false;
  private cancelPendingSubscribe: ((error: Error) => void) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private bindingRequested = false;
  private hydrated = false;
  private destroyed = false;
  private closing = false;
  private destroyPromise: Promise<void> | null = null;
  private docListenerInstalled = false;
  private awarenessListenerInstalled = false;
  private departureInProgress = false;
  private durableTailCount = 0;
  private durableTailBytes = 0;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: unknown) => void) | null = null;
  private currentStatus: CollaborationStatus = 'idle';
  private currentToken: DocumentStateToken = { epoch: 0, revision: 0 };
  private currentError: string | null = null;
  private stateReplacementInProgress = false;
  private durableResetInProgress = false;
  private semanticStateValidator: (() => void) | null = null;
  private activeDoc: Y.Doc;
  private durableDoc: Y.Doc;
  private activeAwareness: Provider['awareness'];

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      origin === 'remote' ||
      origin === 'hydrate' ||
      this.role === 'viewer' ||
      this.departureInProgress ||
      this.stateReplacementInProgress ||
      this.durableResetInProgress ||
      this.closing ||
      this.destroyed
    ) {
      return;
    }
    this.queueLocalUpdate(update);
    for (const listener of this.providerListeners.update) listener(update);
  };

  private queueLocalUpdate(update: Uint8Array): void {
    this.localUpdates.push(update.slice());
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        void this.persistPendingUpdates().catch(() => undefined);
      }, this.batchWindowMs);
    }
  }

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (
      origin === 'remote' ||
      this.role === 'viewer' ||
      this.departureInProgress ||
      this.closing ||
      this.destroyed ||
      !this.channel
    ) {
      return;
    }
    const clientIds = [...changes.added, ...changes.updated, ...changes.removed];
    const update = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness as unknown as awarenessProtocol.Awareness,
      clientIds
    );
    void this.send('yjs-awareness', {
      v: 1,
      documentId: this.documentId,
      epoch: this.currentToken.epoch,
      updateBase64: encodeBase64(update),
    }).catch(() => undefined);
  };

  constructor(options: DocumentCollaborationSessionOptions) {
    this.supabase = options.supabase;
    this.gateway = options.gateway;
    this.documentId = options.documentId;
    this.projectId = options.projectId;
    this.userId = options.userId;
    this.accessToken = options.accessToken;
    this.role = options.role;
    this.user = options.user;
    this.batchWindowMs = options.batchWindowMs ?? 75;
    this.compactionBackoffMs = options.compactionBackoffMs ?? 250;
    this.compactionJitterRatio = options.compactionJitterRatio ?? 0.2;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? 500;
    this.reconnectJitterRatio = options.reconnectJitterRatio ?? 0.2;
    this.onCompacted = options.onCompacted;
    this.onStateReplaced = options.onStateReplaced;
    this.activeDoc = new Y.Doc();
    this.activeDoc.get('root', Y.XmlText);
    this.durableDoc = new Y.Doc();
    this.durableDoc.get('root', Y.XmlText);
    this.activeAwareness = new awarenessProtocol.Awareness(
      this.activeDoc
    ) as unknown as Provider['awareness'];
  }

  get doc(): Y.Doc {
    return this.activeDoc;
  }

  get awareness(): Provider['awareness'] {
    return this.activeAwareness;
  }

  get status(): CollaborationStatus {
    return this.currentStatus;
  }

  get token(): DocumentStateToken {
    return { ...this.currentToken };
  }

  get hasPendingChanges(): boolean {
    return (
      this.localUpdates.length > 0 ||
      this.pendingDurable !== null ||
      this.persistPromise !== null
    );
  }

  get canAttachBinding(): boolean {
    return this.hydrated || this.pendingState?.mode === 'collaborative';
  }

  subscribe(listener: (state: CollaborationViewState) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  private setStatus(status: CollaborationStatus, error: string | null = null): void {
    this.currentStatus = status;
    this.currentError = error;
    const state = { status, token: this.token, error };
    for (const listener of this.viewListeners) listener(state);
    for (const listener of this.providerListeners.status) {
      listener({ status: status === 'ready' ? 'connected' : status });
    }
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    void this.startConnection();
    return this.connectPromise;
  }

  async updateAccessToken(accessToken: string): Promise<void> {
    if (!accessToken || accessToken === this.accessToken) return;
    try {
      await this.supabase.realtime.setAuth(accessToken);
      this.accessToken = accessToken;
    } catch (error) {
      this.failClosed('Realtime authorization refresh failed');
      throw error;
    }
  }

  private async startConnection(): Promise<void> {
    try {
      this.setStatus('authorizing');
      await this.supabase.realtime.setAuth(this.accessToken);
      if (this.closing || this.destroyed) {
        throw new DocumentCollaborationUnavailableError('Document session is closed');
      }
      this.setStatus('connecting');
      this.channel = this.supabase.channel(documentCollabTopic(this.documentId), {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });
      const channelGeneration = ++this.channelGeneration;
      this.registerChannelHandlers(this.channel, channelGeneration);
      await this.subscribeChannel(this.channel, channelGeneration);
      if (this.closing || this.destroyed) {
        throw new DocumentCollaborationUnavailableError('Document session is closed');
      }
      await this.loadInitialDurableState();
    } catch (error) {
      if (error instanceof StaleDocumentChannelOperationError) return;
      if (
        error instanceof DocumentChannelTransportError &&
        !this.closing &&
        !this.destroyed
      ) {
        if (!error.handled) this.handleChannelFailure(error);
        return;
      }
      if (!this.closing && !this.destroyed) {
        this.failClosed(error instanceof Error ? error.message : 'Collaboration failed');
      }
      this.rejectConnect?.(error);
    }
  }

  private async loadInitialDurableState(): Promise<void> {
    this.setStatus('hydrating');
    let state = await this.gateway.read(this.supabase, this.documentId);
    if (this.closing || this.destroyed) {
      throw new DocumentCollaborationUnavailableError('Document session is closed');
    }
    if (state.projectId !== this.projectId) {
      throw new Error('Document project does not match the open project');
    }
    if (state.mode === 'legacy') {
      if (this.role === 'viewer') {
        this.pendingState = state;
        this.currentToken = state.token;
        this.setStatus('legacy-view');
        this.startHeartbeat();
        this.resolveConnect?.();
        return;
      }
      state = await this.gateway.initialize(
        this.supabase,
        this.documentId,
        state.markdown
      );
      if (this.closing || this.destroyed) {
        throw new DocumentCollaborationUnavailableError('Document session is closed');
      }
      await this.send('document-state-reset', {
        v: 1,
        documentId: this.documentId,
        epoch: state.token.epoch,
        revision: state.token.revision,
        reason: 'initialize',
        updatedAt: state.updatedAt,
      });
      if (this.closing || this.destroyed) {
        throw new DocumentCollaborationUnavailableError('Document session is closed');
      }
    }

    this.pendingState = state;
    this.currentToken = state.token;
    this.durableTailCount = state.updateTail.length;
    this.durableTailBytes = state.updateTail.reduce(
      (total, update) => total + decodeBase64(update.updateBase64).byteLength,
      0
    );
    this.setStatus('syncing');
    if (this.bindingRequested) await this.hydrateInitialState();
  }

  private subscribeChannel(
    channel: RealtimeChannel,
    channelGeneration: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let subscribed = false;
      let settled = false;
      const clearCancel = () => {
        if (this.cancelPendingSubscribe === cancel) {
          this.cancelPendingSubscribe = null;
        }
      };
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearCancel();
        resolve();
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearCancel();
        reject(error);
      };
      const cancel = (error: Error) => settleReject(error);
      this.cancelPendingSubscribe = cancel;
      try {
        channel.subscribe((status, error) => {
          if (
            this.closing ||
            this.destroyed ||
            this.channel !== channel ||
            this.channelGeneration !== channelGeneration
          ) {
            return;
          }
          if (status === 'SUBSCRIBED') {
            this.channelHealthy = true;
            this.reconnectAttempts = 0;
            subscribed = true;
            settleResolve();
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const failure = new DocumentChannelTransportError(
              error?.message ?? `Document channel ${status.toLowerCase()}`
            );
            this.channelHealthy = false;
            if (!subscribed) {
              settleReject(failure);
              return;
            }
            this.handleChannelFailure(failure);
          }
        });
      } catch (error) {
        settleReject(
          error instanceof Error
            ? error
            : new Error('Document channel subscription failed')
        );
      }
    });
  }

  private handleChannelFailure(error: Error): void {
    if (this.closing || this.destroyed) return;
    this.channelHealthy = false;
    this.failClosed(error.message, 'degraded');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing || this.destroyed) return;
    this.reconnectAttempts += 1;
    const baseDelay = Math.min(
      this.reconnectBackoffMs * 2 ** (this.reconnectAttempts - 1),
      30_000
    );
    const jitter =
      baseDelay * this.reconnectJitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectChannel().catch((error) => {
        if (this.closing || this.destroyed) return;
        if (
          error instanceof DocumentChannelTransportError &&
          error.handled
        ) {
          return;
        }
        this.failClosed(
          error instanceof Error ? error.message : 'Document reconnect failed',
          'degraded'
        );
        this.scheduleReconnect();
      });
    }, delay);
  }

  private reconnectChannel(): Promise<void> {
    if (this.reconnectPromise) return this.reconnectPromise;
    const reconnectPromise = this.runReconnectChannel();
    this.reconnectPromise = reconnectPromise;
    reconnectPromise.then(
      () => {
        if (this.reconnectPromise === reconnectPromise) this.reconnectPromise = null;
      },
      () => {
        if (this.reconnectPromise === reconnectPromise) this.reconnectPromise = null;
      }
    );
    return reconnectPromise;
  }

  private async runReconnectChannel(): Promise<void> {
    if (this.closing || this.destroyed) return;
    const failedChannel = this.channel;
    this.channel = null;
    this.channelHealthy = false;
    this.channelGeneration += 1;
    if (failedChannel) {
      await failedChannel.unsubscribe();
      await this.supabase.removeChannel(failedChannel);
    }
    if (this.closing || this.destroyed) return;

    this.setStatus('authorizing');
    await this.supabase.realtime.setAuth(this.accessToken);
    if (this.closing || this.destroyed) return;

    this.setStatus('connecting');
    const channel = this.supabase.channel(documentCollabTopic(this.documentId), {
      config: {
        private: true,
        broadcast: { self: false },
        presence: { key: this.userId },
      },
    });
    this.channel = channel;
    const channelGeneration = ++this.channelGeneration;
    this.registerChannelHandlers(channel, channelGeneration);
    await this.subscribeChannel(channel, channelGeneration);
    if (this.closing || this.destroyed) return;

    if (!this.hydrated && !this.pendingState) {
      try {
        await this.loadInitialDurableState();
      } catch (error) {
        if (
          error instanceof DocumentChannelTransportError &&
          !this.closing &&
          !this.destroyed
        ) {
          if (!error.handled) this.handleChannelFailure(error);
          return;
        }
        if (!this.closing && !this.destroyed) {
          this.failClosed(
            error instanceof Error ? error.message : 'Collaboration failed'
          );
        }
        this.rejectConnect?.(error);
      }
      return;
    }

    const docBeforeCatchUp = this.doc;
    this.setStatus('syncing');
    await this.reloadDurableState();
    if (
      this.closing ||
      this.destroyed ||
      !this.channelHealthy ||
      this.channel !== channel
    ) {
      return;
    }
    if (
      !this.hydrated &&
      this.currentStatus === 'legacy-view' &&
      this.doc === docBeforeCatchUp
    ) {
      this.reconnectAttempts = 0;
      return;
    }
    if (this.doc !== docBeforeCatchUp || !this.hydrated) return;
    await this.synchronizePeersAfterReconnect();
    if (!this.channelHealthy || this.channel !== channel) return;
    this.completeReadyState();
  }

  private async synchronizePeersAfterReconnect(): Promise<void> {
    if (this.role === 'viewer') return;
    await this.flushPendingDurability();
    await this.sendDifferentialSyncAndAwareness();
  }

  private async sendDifferentialSyncAndAwareness(
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    await this.send('yjs-sync-request', {
      v: 1,
      documentId: this.documentId,
      epoch: this.currentToken.epoch,
      requesterId: this.userId,
      stateVectorBase64: encodeBase64(Y.encodeStateVector(this.doc)),
    }, isCurrent);
    if (!isCurrent()) return;
    const awareness = this.awareness as unknown as awarenessProtocol.Awareness;
    if (awareness.getLocalState() === null) return;
    await this.send('yjs-awareness', {
      v: 1,
      documentId: this.documentId,
      epoch: this.currentToken.epoch,
      updateBase64: encodeBase64(
        awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
      ),
    }, isCurrent);
  }

  private registerChannelHandlers(
    channel: RealtimeChannel,
    channelGeneration: number
  ): void {
    for (const event of SYNC_EVENTS) {
      channel.on('broadcast', { event }, ({ payload }) => {
        if (
          this.closing ||
          this.destroyed ||
          this.channel !== channel ||
          this.channelGeneration !== channelGeneration
        ) {
          return;
        }
        return this.receive(event, payload);
      });
    }
  }

  private async receive(
    event: DocumentCollaborationEventName,
    payload: unknown
  ): Promise<void> {
    if (event === 'document-state-reset') {
      let reset: DocumentStateResetEvent;
      try {
        reset = parseDocumentCollaborationEvent(
          'document-state-reset',
          payload
        ) as DocumentStateResetEvent;
      } catch {
        // Invalid reset acceleration signals never change durable state.
        return;
      }
      if (
        reset.documentId !== this.documentId ||
        reset.epoch < this.currentToken.epoch ||
        (reset.epoch === this.currentToken.epoch &&
          reset.revision <= this.currentToken.revision)
      ) {
        return;
      }
      try {
        await this.reloadDurableState({
          epoch: reset.epoch,
          revision: reset.revision,
        });
      } catch (error) {
        this.failClosed(
          error instanceof Error ? error.message : 'Document reset catch-up failed',
          'degraded'
        );
      }
      return;
    }
    if (!this.hydrated) {
      this.bufferedEvents.push({ event, payload });
      return;
    }
    try {
      const parsed = parseDocumentCollaborationEvent(event, payload, {
        documentId: this.documentId,
        epoch: this.currentToken.epoch,
      });
      if (event === 'yjs-update' && 'updateId' in parsed) {
        if (this.appliedUpdateIds.has(parsed.updateId)) return;
        const update = decodeBase64(parsed.updateBase64);
        this.validatePeerCandidate(update);
        Y.applyUpdate(this.durableDoc, update, 'durable-remote');
        Y.applyUpdate(this.doc, update, 'remote');
        this.appliedUpdateIds.add(parsed.updateId);
        return;
      }
      if (event === 'yjs-sync-request' && 'stateVectorBase64' in parsed) {
        if (this.role === 'viewer') return;
        await this.flushPendingDurability();
        const update = Y.encodeStateAsUpdate(
          this.doc,
          decodeBase64(parsed.stateVectorBase64)
        );
        await this.send('yjs-sync-response', {
          v: 1,
          documentId: this.documentId,
          epoch: this.currentToken.epoch,
          requesterId: parsed.requesterId,
          updateBase64: encodeBase64(update),
        });
        return;
      }
      if (
        event === 'yjs-sync-response' &&
        'requesterId' in parsed &&
        'updateBase64' in parsed
      ) {
        if (parsed.requesterId !== this.userId) return;
        const update = decodeBase64(parsed.updateBase64);
        this.validatePeerCandidate(update);
        Y.applyUpdate(this.doc, update, 'remote');
        return;
      }
      if (event === 'yjs-awareness' && 'updateBase64' in parsed) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness as unknown as awarenessProtocol.Awareness,
          decodeBase64(parsed.updateBase64),
          'remote'
        );
        return;
      }
    } catch {
      // Malformed, oversized, and cross-scope peer payloads never change state.
    }
  }

  private validatePeerCandidate(update: Uint8Array): void {
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(candidate, update);
      validateSerializedMdxNodes(candidate.get('root', Y.XmlText));
    } finally {
      candidate.destroy();
    }
  }

  attachBinding(): void {
    this.bindingRequested = true;
    if (this.pendingState?.mode === 'collaborative') {
      void this.hydrateInitialState();
    }
  }

  setSemanticStateValidator(validator: () => void): void {
    this.semanticStateValidator = validator;
  }

  /** @deprecated Use attachBinding after the Lexical Yjs observer is installed. */
  applyInitialState(): void {
    this.attachBinding();
  }

  reportBindingFailure(
    error: unknown,
    direction: DocumentBindingFailureDirection
  ): void {
    const detail = error instanceof Error ? error.message : 'Unknown binding error';
    this.failClosed(`Document binding failed (${direction}): ${detail}`);
  }

  private hydrateInitialState(): Promise<void> {
    if (this.hydrationPromise) return this.hydrationPromise;
    if (this.hydrated || !this.pendingState?.yjsStateBase64) {
      return Promise.resolve();
    }
    const state = this.pendingState;
    const hydrationGeneration = this.hydrationGeneration;
    const hydrationPromise = this.runInitialHydration(
      state,
      hydrationGeneration
    );
    this.hydrationPromise = hydrationPromise;
    hydrationPromise.then(
      () => {
        if (this.hydrationGeneration !== hydrationGeneration) return;
        if (this.hydrationPromise === hydrationPromise) {
          this.hydrationPromise = null;
        }
      },
      (error: unknown) => {
        if (this.hydrationGeneration !== hydrationGeneration) return;
        if (this.hydrationPromise === hydrationPromise) {
          this.hydrationPromise = null;
        }
        if (this.closing || this.destroyed) return;
        if (error instanceof StaleDocumentChannelOperationError) return;
        if (error instanceof DocumentChannelTransportError) {
          if (!error.handled) this.handleChannelFailure(error);
          return;
        }
        this.failClosed(
          error instanceof Error ? error.message : 'Document hydration failed'
        );
        this.rejectConnect?.(error);
      }
    );
    return hydrationPromise;
  }

  private async runInitialHydration(
    state: AuthoritativeDocumentTransportState,
    hydrationGeneration: number
  ): Promise<void> {
    const hydrationDoc = this.doc;
    const hydrationChannel = this.channel;
    const hydrationChannelGeneration = this.channelGeneration;
    const snapshot = decodeBase64(state.yjsStateBase64);
    Y.applyUpdate(this.durableDoc, snapshot, 'durable-hydrate');
    Y.applyUpdate(this.doc, snapshot, 'hydrate');
    for (const update of state.updateTail) {
      this.appliedUpdateIds.add(update.id);
      const bytes = decodeBase64(update.updateBase64);
      Y.applyUpdate(this.durableDoc, bytes, 'durable-hydrate');
      Y.applyUpdate(this.doc, bytes, 'hydrate');
    }
    const epochRebase = this.pendingEpochRebase;
    this.pendingEpochRebase = null;
    let rebasedUpdate: Uint8Array | null = null;
    if (epochRebase) {
      const committedBlockIds = captureDocumentYjsBlockIds(this.doc);
      Y.applyUpdate(this.doc, epochRebase, 'epoch-rebase');
      this.doc.transact(() => {
        restoreDocumentYjsBlockIds(committedBlockIds);
      }, 'epoch-rebase');
      rebasedUpdate = Y.encodeStateAsUpdate(
        this.doc,
        Y.encodeStateVector(this.durableDoc)
      );
    }
    this.hydrated = true;
    this.installLocalListeners();
    if (rebasedUpdate) this.queueLocalUpdate(rebasedUpdate);
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const item of buffered) void this.receive(item.event, item.payload);
    if (this.role !== 'viewer') {
      await this.sendDifferentialSyncAndAwareness(
        () =>
          this.hydrationGeneration === hydrationGeneration &&
          this.doc === hydrationDoc &&
          this.channel === hydrationChannel &&
          this.channelGeneration === hydrationChannelGeneration
      );
    }
    if (
      this.closing ||
      this.destroyed ||
      !this.channelHealthy ||
      this.doc !== hydrationDoc ||
      this.hydrationGeneration !== hydrationGeneration ||
      this.channel !== hydrationChannel ||
      this.channelGeneration !== hydrationChannelGeneration
    ) {
      return;
    }
    this.completeReadyState();
  }

  private completeReadyState(): void {
    if (this.closing || this.destroyed) return;
    this.setStatus('ready');
    for (const listener of this.providerListeners.sync) listener(true);
    this.startHeartbeat();
    if (this.role !== 'viewer' && this.durableTailCount > 0) {
      this.scheduleCompaction();
    }
    this.resolveConnect?.();
    this.reconnectAttempts = 0;
  }

  private installLocalListeners(): void {
    if (this.role === 'viewer') return;
    if (!this.docListenerInstalled) {
      this.doc.on('update', this.onDocUpdate);
      this.docListenerInstalled = true;
    }
    if (!this.awarenessListenerInstalled) {
      (this.awareness as unknown as awarenessProtocol.Awareness).on(
        'update',
        this.onAwarenessUpdate
      );
      this.awarenessListenerInstalled = true;
      const awareness =
        this.awareness as unknown as awarenessProtocol.Awareness;
      if (awareness.getLocalState() === null) {
        awareness.setLocalState({
          name: this.user.name,
          color: this.user.color,
          focusing: false,
          anchorPos: null,
          focusPos: null,
          awarenessData: { userId: this.userId },
        });
      }
    }
  }

  private materializePendingUpdate(): void {
    if (this.pendingDurable || this.localUpdates.length === 0) return;
    const bytes = Y.encodeStateAsUpdate(
      this.doc,
      Y.encodeStateVector(this.durableDoc)
    );
    this.localUpdates = [];
    this.pendingDurable = {
      id: newUpdateId(),
      updateBase64: encodeBase64(bytes),
      bytes,
    };
  }

  private async persistPendingUpdates(): Promise<void> {
    if (this.persistPromise) return this.persistPromise;
    const persistPromise = (async () => {
      while (!this.destroyed) {
        this.materializePendingUpdate();
        if (!this.pendingDurable) return;
        const pending = this.pendingDurable;
        const pendingEpoch = this.currentToken.epoch;
        try {
          validateSerializedMdxNodes(this.doc.get('root', Y.XmlText));
          this.semanticStateValidator?.();
          await this.gateway.appendUpdates(this.supabase, {
            documentId: this.documentId,
            epoch: pendingEpoch,
            updates: [{ id: pending.id, updateBase64: pending.updateBase64 }],
          });
          if (this.currentToken.epoch !== pendingEpoch) {
            if (this.pendingDurable === pending) this.pendingDurable = null;
            return;
          }
          Y.applyUpdate(this.durableDoc, pending.bytes, 'durable-local');
          if (this.pendingDurable === pending) this.pendingDurable = null;
          this.durableTailCount += 1;
          this.durableTailBytes += pending.bytes.byteLength;
          this.scheduleCompaction();
          try {
            await this.send('yjs-update', {
              v: 1,
              documentId: this.documentId,
              epoch: pendingEpoch,
              updateId: pending.id,
              updateBase64: pending.updateBase64,
            });
          } catch {
            // Durable catch-up delivers an update when live broadcast is unavailable.
          }
        } catch (error) {
          if (error instanceof DocumentStateConflictError) {
            try {
              const winner = await this.gateway.readTransport(
                this.supabase,
                this.documentId
              );
              if (winner.token.epoch > pendingEpoch) {
                this.replaceActiveDocument(winner);
                return;
              }
            } catch (reloadError) {
              this.failClosed(
                reloadError instanceof Error
                  ? reloadError.message
                  : 'Document conflict reload failed',
                'degraded'
              );
              throw reloadError;
            }
          }
          this.failClosed(
            error instanceof Error ? error.message : 'Document update could not be saved',
            'degraded'
          );
          throw error;
        }
      }
    })();
    this.persistPromise = persistPromise;
    try {
      await persistPromise;
    } finally {
      if (this.persistPromise === persistPromise) this.persistPromise = null;
    }
  }

  private async flushPendingDurability(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.persistPendingUpdates();
    if (this.persistPromise) await this.persistPromise;
  }

  async flush(): Promise<void> {
    await this.flushPendingDurability();
    if (this.durableTailCount > 0 && this.currentStatus !== 'closed') {
      await this.compactNow();
    }
  }

  async restoreVersion(
    versionId: string
  ): Promise<AuthoritativeDocumentState> {
    if (this.role === 'viewer') throw new DocumentReadOnlyError();
    if (this.destroyed || this.currentStatus !== 'ready') {
      throw new DocumentCollaborationUnavailableError(
        'Document must be live before restoring a version'
      );
    }

    this.stateReplacementInProgress = true;
    this.setStatus('syncing');
    try {
      await this.flushPendingDurability();
      const state = await this.gateway.replace(this.supabase, {
        documentId: this.documentId,
        expected: this.currentToken,
        replacement: { kind: 'version', versionId },
        reason: 'restore',
      });
      this.replaceActiveDocument(state);
      try {
        await this.onStateReplaced?.(state);
      } catch {
        // Cache and sidebar refresh are best-effort after the durable commit.
      }
      try {
        await this.send('document-state-reset', {
          v: 1,
          documentId: this.documentId,
          epoch: state.token.epoch,
          revision: state.token.revision,
          reason: 'restore',
          updatedAt: state.updatedAt,
        });
      } catch {
        this.failClosed('Document restore committed but reset delivery failed', 'degraded');
      }
      return state;
    } catch (error) {
      if (error instanceof DocumentStateConflictError) {
        await this.reloadDurableState();
        if (this.hydrated) this.setStatus('ready');
      } else {
        this.failClosed(
          error instanceof Error ? error.message : 'Document restore failed',
          'degraded'
        );
      }
      throw error;
    } finally {
      this.stateReplacementInProgress = false;
    }
  }

  private scheduleCompaction(): void {
    if (this.role === 'viewer' || this.destroyed) return;
    if (
      this.durableTailCount >= 100 ||
      this.durableTailBytes >= 1024 * 1024
    ) {
      void this.compactNow().catch(() => undefined);
      return;
    }
    if (this.compactTimer) clearTimeout(this.compactTimer);
    this.compactTimer = setTimeout(() => {
      this.compactTimer = null;
      void this.compactNow().catch(() => undefined);
    }, 2_000);
    if (!this.compactInterval) {
      this.compactInterval = setInterval(() => {
        void this.compactNow().catch(() => undefined);
      }, 30_000);
    }
  }

  private async compactNow(): Promise<void> {
    if (this.durableTailCount === 0 || this.destroyed) return;
    if (this.compactPromise) return this.compactPromise;
    this.compactPromise = (async () => {
      try {
        const state = await this.gateway.compact(this.supabase, {
          documentId: this.documentId,
          expected: this.currentToken,
        });
        this.currentToken = state.token;
        this.durableTailCount = state.updateTail.length;
        this.durableTailBytes = state.updateTail.reduce(
          (total, update) => total + decodeBase64(update.updateBase64).byteLength,
          0
        );
        this.compactAttempts = 0;
        this.clearCompactionTimers();
        await this.onCompacted?.(state);
      } catch (error) {
        if (error instanceof DocumentStateConflictError) {
          const winner = await this.gateway.readTransport(
            this.supabase,
            this.documentId
          );
          if (winner.token.epoch > this.currentToken.epoch) {
            this.replaceActiveDocument(winner);
            return;
          }
          this.currentToken = winner.token;
          this.durableTailCount = winner.updateTail.length;
          this.durableTailBytes = winner.updateTail.reduce(
            (total, update) => total + decodeBase64(update.updateBase64).byteLength,
            0
          );
        }
        this.scheduleCompactionRetry();
        throw error;
      } finally {
        this.compactPromise = null;
      }
    })();
    return this.compactPromise;
  }

  private scheduleCompactionRetry(): void {
    this.compactAttempts += 1;
    if (this.compactAttempts > 5 || this.destroyed) {
      this.failClosed('Document snapshot compaction is delayed', 'degraded');
      return;
    }
    if (this.compactRetryTimer) clearTimeout(this.compactRetryTimer);
    const baseDelay = Math.min(
      this.compactionBackoffMs * 2 ** (this.compactAttempts - 1),
      30_000
    );
    const jitter =
      baseDelay * this.compactionJitterRatio * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    this.compactRetryTimer = setTimeout(() => {
      this.compactRetryTimer = null;
      void this.compactNow().catch(() => undefined);
    }, delay);
  }

  async retry(): Promise<void> {
    if (this.destroyed) return;
    if (!this.channelHealthy) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
      try {
        await this.reconnectChannel();
      } catch (error) {
        if (!(error instanceof DocumentChannelTransportError && error.handled)) {
          this.failClosed(
            error instanceof Error ? error.message : 'Document reconnect failed',
            'degraded'
          );
        }
        this.scheduleReconnect();
        throw error;
      }
      return;
    }
    this.setStatus('syncing');
    await this.flushPendingDurability();
    this.setStatus('ready');
  }

  async refresh(): Promise<void> {
    if (
      this.destroyed ||
      (this.currentStatus !== 'ready' &&
        this.currentStatus !== 'legacy-view' &&
        this.currentStatus !== 'degraded')
    ) {
      return;
    }
    try {
      await this.reloadDurableState();
    } catch (error) {
      this.failClosed(
        error instanceof Error ? error.message : 'Document catch-up failed',
        'degraded'
      );
      throw error;
    }
  }

  async recoverNow(): Promise<void> {
    if (this.destroyed || this.closing) return;
    if (
      this.currentStatus === 'idle' ||
      this.currentStatus === 'authorizing' ||
      this.currentStatus === 'connecting' ||
      this.currentStatus === 'hydrating' ||
      this.currentStatus === 'syncing'
    ) {
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      await this.reconnectChannel();
    } catch (error) {
      if (!(error instanceof DocumentChannelTransportError && error.handled)) {
        this.failClosed(
          error instanceof Error ? error.message : 'Document reconnect failed',
          'degraded'
        );
      }
      this.scheduleReconnect();
      throw error;
    }
  }

  private reloadDurableState(minimumToken?: DocumentStateToken): Promise<void> {
    if (minimumToken) {
      if (minimumToken.epoch > this.currentToken.epoch) {
        this.durableResetInProgress = true;
        this.setStatus('hydrating');
      }
      if (
        !this.reloadMinimumToken ||
        minimumToken.epoch > this.reloadMinimumToken.epoch ||
        (minimumToken.epoch === this.reloadMinimumToken.epoch &&
          minimumToken.revision > this.reloadMinimumToken.revision)
      ) {
        this.reloadMinimumToken = minimumToken;
      }
    }
    if (this.reloadPromise) {
      if (!minimumToken) this.reloadQueued = true;
      return this.reloadPromise;
    }
    this.reloadPromise = this.runDurableReload();
    return this.reloadPromise;
  }

  private async runDurableReload(): Promise<void> {
    try {
      do {
        this.reloadQueued = false;
        const minimumToken = this.reloadMinimumToken;
        this.reloadMinimumToken = null;
        await this.readAndApplyDurableState(minimumToken);
        if (
          this.reloadMinimumToken &&
          (this.reloadMinimumToken.epoch < this.currentToken.epoch ||
            (this.reloadMinimumToken.epoch === this.currentToken.epoch &&
              this.reloadMinimumToken.revision <= this.currentToken.revision))
        ) {
          this.reloadMinimumToken = null;
        }
      } while (this.reloadQueued || this.reloadMinimumToken);
    } finally {
      this.reloadPromise = null;
      this.durableResetInProgress = false;
    }
  }

  private async readAndApplyDurableState(
    minimumToken: DocumentStateToken | null
  ): Promise<void> {
    const state = await this.gateway.readTransport(this.supabase, this.documentId);
    if (
      minimumToken &&
      (state.token.epoch < minimumToken.epoch ||
        (state.token.epoch === minimumToken.epoch &&
          state.token.revision < minimumToken.revision))
    ) {
      throw new Error('Document reset state is behind the minimum token');
    }
    if (state.token.epoch < this.currentToken.epoch) return;
    if (
      state.token.epoch === this.currentToken.epoch &&
      state.token.revision < this.currentToken.revision
    ) {
      return;
    }
    if (state.token.epoch > this.currentToken.epoch) {
      this.replaceActiveDocument(state);
      return;
    }
    if (!this.hydrated && state.mode === 'legacy') {
      this.pendingState = state;
      this.currentToken = state.token;
      this.durableTailCount = state.updateTail.length;
      this.durableTailBytes = state.updateTail.reduce(
        (total, update) => total + decodeBase64(update.updateBase64).byteLength,
        0
      );
      this.setStatus('legacy-view');
      return;
    }
    if (!this.hydrated && state.mode === 'collaborative') {
      this.pendingState = state;
      this.currentToken = state.token;
      this.bindingRequested = false;
      this.setStatus('syncing');
      for (const listener of this.providerListeners.reload) listener(this.doc);
      return;
    }
    if (
      state.token.revision > this.currentToken.revision &&
      state.yjsStateBase64
    ) {
      const snapshot = decodeBase64(state.yjsStateBase64);
      Y.applyUpdate(this.durableDoc, snapshot, 'durable-reload');
      Y.applyUpdate(this.doc, snapshot, 'remote');
    }
    for (const update of state.updateTail) {
      const bytes = decodeBase64(update.updateBase64);
      Y.applyUpdate(this.durableDoc, bytes, 'durable-reload');
      if (!this.appliedUpdateIds.has(update.id)) {
        this.appliedUpdateIds.add(update.id);
        Y.applyUpdate(this.doc, bytes, 'remote');
      }
    }
    this.currentToken = state.token;
    this.durableTailCount = state.updateTail.length;
    this.durableTailBytes = state.updateTail.reduce(
      (total, update) => total + decodeBase64(update.updateBase64).byteLength,
      0
    );
    if (this.role !== 'viewer' && this.durableTailCount > 0) {
      this.scheduleCompaction();
    }
  }

  private capturePendingEpochRebase(): Uint8Array | null {
    if (this.pendingEpochRebase) return this.pendingEpochRebase.slice();
    if (this.localUpdates.length === 0 && !this.pendingDurable) return null;
    return Y.encodeStateAsUpdate(
      this.doc,
      Y.encodeStateVector(this.durableDoc)
    );
  }

  private replaceActiveDocument(state: AuthoritativeDocumentTransportState): void {
    const epochRebase = this.capturePendingEpochRebase();
    this.setStatus('hydrating');
    this.clearPendingWork();
    this.pendingEpochRebase = epochRebase?.slice() ?? null;
    this.hydrationGeneration += 1;
    this.hydrationPromise = null;
    const previousDoc = this.activeDoc;
    const previousAwareness =
      this.activeAwareness as unknown as awarenessProtocol.Awareness;
    if (this.docListenerInstalled) previousDoc.off('update', this.onDocUpdate);
    if (this.awarenessListenerInstalled) {
      previousAwareness.off('update', this.onAwarenessUpdate);
    }
    previousAwareness.setLocalState(null);
    previousAwareness.destroy();

    this.activeDoc = new Y.Doc();
    this.activeDoc.get('root', Y.XmlText);
    this.durableDoc.destroy();
    this.durableDoc = new Y.Doc();
    this.durableDoc.get('root', Y.XmlText);
    this.activeAwareness = new awarenessProtocol.Awareness(
      this.activeDoc
    ) as unknown as Provider['awareness'];
    this.docListenerInstalled = false;
    this.awarenessListenerInstalled = false;
    this.pendingState = state;
    this.currentToken = state.token;
    this.durableTailCount = state.updateTail.length;
    this.durableTailBytes = state.updateTail.reduce(
      (total, update) => total + decodeBase64(update.updateBase64).byteLength,
      0
    );
    this.appliedUpdateIds = new Set();
    this.hydrated = false;
    this.bindingRequested = false;
    previousDoc.destroy();
    for (const listener of this.providerListeners.reload) listener(this.activeDoc);
    this.setStatus('syncing');
  }

  private clearPendingWork(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.clearCompactionTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.localUpdates = [];
    this.pendingDurable = null;
    this.pendingEpochRebase = null;
    this.persistPromise = null;
    this.bufferedEvents = [];
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval || this.destroyed) return;
    this.heartbeatInterval = setInterval(() => {
      void this.reloadDurableState().catch((error) =>
        this.failClosed(
          error instanceof Error ? error.message : 'Document catch-up failed',
          'degraded'
        )
      );
    }, 15_000);
  }

  private async send(
    event: DocumentCollaborationEventName,
    payload: Record<string, unknown>,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    const invocationChannel = this.channel;
    const invocationChannelGeneration = this.channelGeneration;
    try {
      if (!invocationChannel) {
        throw new Error('Document collaboration channel is unavailable');
      }
      const result = await invocationChannel.send({
        type: 'broadcast',
        event,
        payload,
      });
      if (result !== 'ok' && (result as { status?: string })?.status !== 'ok') {
        throw new Error(`Document collaboration send failed: ${String(result)}`);
      }
    } catch (error) {
      if (this.closing || this.destroyed) throw error;
      if (
        !isCurrent() ||
        this.channel !== invocationChannel ||
        this.channelGeneration !== invocationChannelGeneration
      ) {
        throw new StaleDocumentChannelOperationError(
          'Document channel operation is stale'
        );
      }
      const failure = new DocumentChannelTransportError(
        error instanceof Error ? error.message : 'Document collaboration send failed',
        true
      );
      this.handleChannelFailure(failure);
      throw failure;
    }
  }

  private failClosed(
    message: string,
    status: 'degraded' | 'error' = 'error'
  ): void {
    this.setStatus(status, message);
    for (const listener of this.providerListeners.sync) listener(false);
  }

  private clearCompactionTimers(): void {
    if (this.compactTimer) clearTimeout(this.compactTimer);
    if (this.compactInterval) clearInterval(this.compactInterval);
    if (this.compactRetryTimer) clearTimeout(this.compactRetryTimer);
    this.compactTimer = null;
    this.compactInterval = null;
    this.compactRetryTimer = null;
  }

  destroy(): Promise<void> {
    if (!this.destroyPromise) this.destroyPromise = this.destroyInternal();
    return this.destroyPromise;
  }

  private async destroyInternal(): Promise<void> {
    if (this.destroyed) return;
    const awareness = this.awareness as unknown as awarenessProtocol.Awareness;
    this.departureInProgress = true;
    const hadLocalAwareness = awareness.getLocalState() !== null;
    awareness.setLocalState(null);
    if (hadLocalAwareness && this.role !== 'viewer') {
      await this.sendAwarenessRemoval(awareness);
    }
    this.closing = true;
    const closedError = new DocumentCollaborationUnavailableError(
      'Document session is closed'
    );
    this.hydrationGeneration += 1;
    this.hydrationPromise = null;
    this.rejectConnect?.(closedError);
    this.cancelPendingSubscribe?.(closedError);
    this.cancelPendingSubscribe = null;
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.clearCompactionTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
    if (this.docListenerInstalled) {
      this.doc.off('update', this.onDocUpdate);
      this.docListenerInstalled = false;
    }
    if (this.awarenessListenerInstalled) {
      awareness.off('update', this.onAwarenessUpdate);
      this.awarenessListenerInstalled = false;
    }
    try {
      await this.flushPendingDurability();
    } catch {
      // The caller's navigation boundary observes flush failures before destroy.
    }
    this.destroyed = true;
    awareness.destroy();
    if (this.channel) {
      await this.channel.unsubscribe();
      await this.supabase.removeChannel(this.channel);
    }
    this.channel = null;
    this.doc.destroy();
    this.durableDoc.destroy();
    this.setStatus('closed');
  }

  private async sendAwarenessRemoval(
    awareness: awarenessProtocol.Awareness
  ): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [
        awareness.clientID,
      ]);
      await Promise.race([
        Promise.resolve(
          channel.send({
            type: 'broadcast',
            event: 'yjs-awareness',
            payload: {
              v: 1,
              documentId: this.documentId,
              epoch: this.currentToken.epoch,
              updateBase64: encodeBase64(update),
            },
          })
        ),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 250);
        }),
      ]);
    } catch {
      // Departure is best-effort; server awareness expiry remains the fallback.
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  disconnect(): void {
    void this.destroy();
  }

  on(type: 'sync', callback: (isSynced: boolean) => void): void;
  on(type: 'status', callback: (payload: ProviderStatusPayload) => void): void;
  on(type: 'update', callback: (update: unknown) => void): void;
  on(type: 'reload', callback: (doc: Y.Doc) => void): void;
  on(type: keyof ProviderListenerMap, callback: (...args: never[]) => void): void {
    this.providerListeners[type].add(callback as never);
  }

  off(type: 'sync', callback: (isSynced: boolean) => void): void;
  off(type: 'status', callback: (payload: ProviderStatusPayload) => void): void;
  off(type: 'update', callback: (update: unknown) => void): void;
  off(type: 'reload', callback: (doc: Y.Doc) => void): void;
  off(type: keyof ProviderListenerMap, callback: (...args: never[]) => void): void {
    this.providerListeners[type].delete(callback as never);
  }
}
