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
  CollaborationStatus,
  DocumentStateToken,
  DurableYjsUpdate,
} from './documentStateTypes';
import { DocumentStateConflictError } from './documentStateTypes';

export type DocumentCollaborationRole = 'admin' | 'editor' | 'viewer';

export type DocumentCollaborationGateway = {
  read(client: SupabaseClient, documentId: string): Promise<AuthoritativeDocumentState>;
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
  onCompacted?: (state: AuthoritativeDocumentState) => void | Promise<void>;
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

function newUpdateId(): string {
  return globalThis.crypto.randomUUID();
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
  private readonly onCompacted?: (
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
  private pendingState: AuthoritativeDocumentState | null = null;
  private bufferedEvents: BufferedEvent[] = [];
  private appliedUpdateIds = new Set<string>();
  private localUpdates: Uint8Array[] = [];
  private pendingDurable: PendingDurableUpdate | null = null;
  private persistPromise: Promise<void> | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  private compactInterval: ReturnType<typeof setInterval> | null = null;
  private compactRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private compactPromise: Promise<void> | null = null;
  private compactAttempts = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private bindingRequested = false;
  private hydrated = false;
  private destroyed = false;
  private docListenerInstalled = false;
  private awarenessListenerInstalled = false;
  private durableTailCount = 0;
  private durableTailBytes = 0;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: unknown) => void) | null = null;
  private currentStatus: CollaborationStatus = 'idle';
  private currentToken: DocumentStateToken = { epoch: 0, revision: 0 };
  private currentError: string | null = null;
  private activeDoc: Y.Doc;
  private activeAwareness: Provider['awareness'];

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      origin === 'remote' ||
      origin === 'hydrate' ||
      this.role === 'viewer' ||
      this.destroyed
    ) {
      return;
    }
    this.localUpdates.push(update.slice());
    for (const listener of this.providerListeners.update) listener(update);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        void this.persistPendingUpdates().catch(() => undefined);
      }, this.batchWindowMs);
    }
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (
      origin === 'remote' ||
      this.role === 'viewer' ||
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
    }).catch(() => this.failClosed('Awareness transport failed'));
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
    this.onCompacted = options.onCompacted;
    this.activeDoc = new Y.Doc();
    this.activeDoc.get('root', Y.XmlText);
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
      this.setStatus('connecting');
      this.channel = this.supabase.channel(documentCollabTopic(this.documentId), {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });
      this.registerChannelHandlers(this.channel);
      await this.subscribeChannel(this.channel);

      this.setStatus('hydrating');
      let state = await this.gateway.read(this.supabase, this.documentId);
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
        await this.send('document-state-reset', {
          v: 1,
          documentId: this.documentId,
          epoch: state.token.epoch,
          revision: state.token.revision,
          reason: 'initialize',
          updatedAt: state.updatedAt,
        });
      }

      this.pendingState = state;
      this.currentToken = state.token;
      this.durableTailCount = state.updateTail.length;
      this.durableTailBytes = state.updateTail.reduce(
        (total, update) => total + decodeBase64(update.updateBase64).byteLength,
        0
      );
      this.setStatus('syncing');
      if (this.bindingRequested) this.hydrateInitialState();
    } catch (error) {
      this.failClosed(error instanceof Error ? error.message : 'Collaboration failed');
      this.rejectConnect?.(error);
    }
  }

  private subscribeChannel(channel: RealtimeChannel): Promise<void> {
    return new Promise((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(error ?? new Error(`Document channel ${status.toLowerCase()}`));
        }
      });
    });
  }

  private registerChannelHandlers(channel: RealtimeChannel): void {
    for (const event of SYNC_EVENTS) {
      channel.on('broadcast', { event }, ({ payload }) =>
        this.receive(event, payload)
      );
    }
  }

  private async receive(
    event: DocumentCollaborationEventName,
    payload: unknown
  ): Promise<void> {
    if (event === 'document-state-reset') {
      try {
        const reset = parseDocumentCollaborationEvent(event, payload);
        if (
          reset.documentId !== this.documentId ||
          reset.epoch < this.currentToken.epoch
        ) {
          return;
        }
        await this.reloadDurableState();
      } catch {
        // Invalid reset acceleration signals never change durable state.
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
        this.appliedUpdateIds.add(parsed.updateId);
        Y.applyUpdate(this.doc, decodeBase64(parsed.updateBase64), 'remote');
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
        Y.applyUpdate(this.doc, decodeBase64(parsed.updateBase64), 'remote');
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

  attachBinding(): void {
    this.bindingRequested = true;
    if (this.pendingState?.mode === 'collaborative') this.hydrateInitialState();
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

  private hydrateInitialState(): void {
    if (this.hydrated || !this.pendingState?.yjsStateBase64) return;
    const state = this.pendingState;
    Y.applyUpdate(this.doc, decodeBase64(state.yjsStateBase64), 'hydrate');
    for (const update of state.updateTail) {
      this.appliedUpdateIds.add(update.id);
      Y.applyUpdate(this.doc, decodeBase64(update.updateBase64), 'hydrate');
    }
    this.hydrated = true;
    this.installLocalListeners();
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const item of buffered) void this.receive(item.event, item.payload);
    if (this.role !== 'viewer') {
      void this.send('yjs-sync-request', {
        v: 1,
        documentId: this.documentId,
        epoch: this.currentToken.epoch,
        requesterId: this.userId,
        stateVectorBase64: encodeBase64(Y.encodeStateVector(this.doc)),
      });
    }
    this.setStatus('ready');
    for (const listener of this.providerListeners.sync) listener(true);
    this.startHeartbeat();
    if (this.role !== 'viewer' && this.durableTailCount > 0) {
      this.scheduleCompaction();
    }
    this.resolveConnect?.();
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
      (this.awareness as unknown as awarenessProtocol.Awareness).setLocalState({
        user: { id: this.userId, name: this.user.name, color: this.user.color },
        focus: false,
        anchor: null,
        focusPosition: null,
      });
    }
  }

  private materializePendingUpdate(): void {
    if (this.pendingDurable || this.localUpdates.length === 0) return;
    const bytes = Y.mergeUpdates(this.localUpdates);
    this.localUpdates = [];
    this.pendingDurable = {
      id: newUpdateId(),
      updateBase64: encodeBase64(bytes),
      bytes,
    };
  }

  private async persistPendingUpdates(): Promise<void> {
    this.materializePendingUpdate();
    if (!this.pendingDurable) return;
    if (this.persistPromise) return this.persistPromise;
    const pending = this.pendingDurable;
    this.persistPromise = (async () => {
      try {
        await this.gateway.appendUpdates(this.supabase, {
          documentId: this.documentId,
          epoch: this.currentToken.epoch,
          updates: [{ id: pending.id, updateBase64: pending.updateBase64 }],
        });
        await this.send('yjs-update', {
          v: 1,
          documentId: this.documentId,
          epoch: this.currentToken.epoch,
          updateId: pending.id,
          updateBase64: pending.updateBase64,
        });
        this.pendingDurable = null;
        this.durableTailCount += 1;
        this.durableTailBytes += pending.bytes.byteLength;
        this.scheduleCompaction();
      } catch (error) {
        this.failClosed(
          error instanceof Error ? error.message : 'Document update could not be saved',
          'degraded'
        );
        throw error;
      } finally {
        this.persistPromise = null;
      }
    })();
    return this.persistPromise;
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
          const winner = await this.gateway.read(this.supabase, this.documentId);
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

  private async reloadDurableState(): Promise<void> {
    const state = await this.gateway.read(this.supabase, this.documentId);
    if (state.token.epoch < this.currentToken.epoch) return;
    if (state.token.epoch > this.currentToken.epoch) {
      this.replaceActiveDocument(state);
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
    for (const update of state.updateTail) {
      if (this.appliedUpdateIds.has(update.id)) continue;
      this.appliedUpdateIds.add(update.id);
      Y.applyUpdate(this.doc, decodeBase64(update.updateBase64), 'remote');
    }
    this.currentToken = state.token;
  }

  private replaceActiveDocument(state: AuthoritativeDocumentState): void {
    this.setStatus('hydrating');
    this.clearPendingWork();
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
    this.localUpdates = [];
    this.pendingDurable = null;
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
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.channel) throw new Error('Document collaboration channel is unavailable');
    const result = await this.channel.send({ type: 'broadcast', event, payload });
    if (result !== 'ok' && (result as { status?: string })?.status !== 'ok') {
      throw new Error(`Document collaboration send failed: ${String(result)}`);
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

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.clearCompactionTimers();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
    try {
      await this.flushPendingDurability();
    } catch {
      // The caller's navigation boundary observes flush failures before destroy.
    }
    if (this.docListenerInstalled) this.doc.off('update', this.onDocUpdate);
    const awareness = this.awareness as unknown as awarenessProtocol.Awareness;
    if (this.awarenessListenerInstalled) {
      awareness.off('update', this.onAwarenessUpdate);
    }
    awareness.setLocalState(null);
    awareness.destroy();
    if (this.channel) {
      await this.channel.unsubscribe();
      await this.supabase.removeChannel(this.channel);
    }
    this.channel = null;
    this.doc.destroy();
    this.setStatus('closed');
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
