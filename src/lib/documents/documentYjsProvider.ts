/**
 * DocumentYjsProvider — Yjs Provider backed by Supabase Realtime broadcast.
 *
 * Implements the @lexical/yjs Provider surface so Lexical collaboration bindings
 * and awareness cursors work without a dedicated y-websocket server. Each
 * document uses channel `doc-collab:{documentId}` (separate from the sidebar
 * folders topic — Yjs update traffic must not ride GitHub #216's shared channel).
 */

import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Provider } from '@lexical/yjs';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

export const DOC_COLLAB_TOPIC_PREFIX = 'doc-collab:';

export function documentCollabTopic(documentId: string): string {
  return `${DOC_COLLAB_TOPIC_PREFIX}${documentId}`;
}

type StatusPayload = { status: string };
type ListenerMap = {
  sync: Set<(isSynced: boolean) => void>;
  status: Set<(payload: StatusPayload) => void>;
  update: Set<(update: unknown) => void>;
  reload: Set<(doc: Y.Doc) => void>;
};

const YJS_UPDATE_EVENT = 'yjs-update';
const YJS_AWARENESS_EVENT = 'yjs-awareness';
const YJS_SYNC_REQUEST_EVENT = 'yjs-sync-request';

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Apply a remote Yjs update, tagging the transaction origin so local echo
 * handlers can skip re-broadcasting.
 */
export function applyRemoteYjsUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, 'remote');
}

export type DocumentYjsProviderOptions = {
  supabase: SupabaseClient;
  documentId: string;
  doc?: Y.Doc;
  /** Optional initial state from Postgres (base64). Applied before connect. */
  initialStateBase64?: string | null;
};

export class DocumentYjsProvider {
  readonly doc: Y.Doc;
  /** Lexical expects ProviderAwareness; y-protocols Awareness is structurally compatible at runtime. */
  readonly awareness: Provider['awareness'];
  readonly documentId: string;

  private readonly supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private connected = false;
  private synced = false;
  /** Base64 snapshot from Postgres — applied only after Lexical observeDeep is attached. */
  private pendingInitialStateBase64: string | null;
  private initialStateApplied = false;
  private readonly listeners: ListenerMap = {
    sync: new Set(),
    status: new Set(),
    update: new Set(),
    reload: new Set(),
  };
  private readonly onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly onAwarenessUpdate: (
    changes: {
      added: number[];
      updated: number[];
      removed: number[];
    },
    origin: unknown
  ) => void;

  constructor(options: DocumentYjsProviderOptions) {
    this.supabase = options.supabase;
    this.documentId = options.documentId;
    this.doc = options.doc ?? new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(
      this.doc
    ) as unknown as Provider['awareness'];
    this.pendingInitialStateBase64 = options.initialStateBase64 ?? null;

    this.onDocUpdate = (update, origin) => {
      if (origin === 'remote' || !this.connected || !this.channel) return;
      void this.channel.send({
        type: 'broadcast',
        event: YJS_UPDATE_EVENT,
        payload: { update: uint8ToBase64(update) },
      });
      for (const cb of this.listeners.update) cb(update);
    };

    this.onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === 'remote' || !this.connected || !this.channel) return;
      const changedClients = added.concat(updated, removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(
        this.awareness as unknown as awarenessProtocol.Awareness,
        changedClients
      );
      void this.channel.send({
        type: 'broadcast',
        event: YJS_AWARENESS_EVENT,
        payload: { update: uint8ToBase64(update) },
      });
    };

    this.doc.on('update', this.onDocUpdate);
    (this.awareness as unknown as awarenessProtocol.Awareness).on(
      'update',
      this.onAwarenessUpdate
    );
  }

  encodeStateAsBase64(): string {
    return uint8ToBase64(Y.encodeStateAsUpdate(this.doc));
  }

  /**
   * Apply the Postgres `yjs_state` snapshot after Lexical's observeDeep is
   * registered so the initial load flows through syncYjsChangesToLexical once.
   * Applying in the constructor (before observers) forced a manual hydrate that
   * could double-apply content when sync ran again or after local typing.
   */
  applyInitialState(): void {
    if (this.initialStateApplied || !this.pendingInitialStateBase64) {
      this.initialStateApplied = true;
      return;
    }
    this.initialStateApplied = true;
    try {
      applyRemoteYjsUpdate(
        this.doc,
        base64ToUint8(this.pendingInitialStateBase64)
      );
    } catch {
      // Ignore malformed stored snapshots; editor can bootstrap from markdown.
    }
    this.pendingInitialStateBase64 = null;
  }

  on(type: 'sync', cb: (isSynced: boolean) => void): void;
  on(type: 'status', cb: (payload: StatusPayload) => void): void;
  on(type: 'update', cb: (update: unknown) => void): void;
  on(type: 'reload', cb: (doc: Y.Doc) => void): void;
  on(type: keyof ListenerMap, cb: (...args: never[]) => void): void {
    this.listeners[type].add(cb as never);
  }

  off(type: 'sync', cb: (isSynced: boolean) => void): void;
  off(type: 'status', cb: (payload: StatusPayload) => void): void;
  off(type: 'update', cb: (update: unknown) => void): void;
  off(type: 'reload', cb: (doc: Y.Doc) => void): void;
  off(type: keyof ListenerMap, cb: (...args: never[]) => void): void {
    this.listeners[type].delete(cb as never);
  }

  private emitStatus(status: string) {
    for (const cb of this.listeners.status) cb({ status });
  }

  private emitSync(isSynced: boolean) {
    this.synced = isSynced;
    for (const cb of this.listeners.sync) cb(isSynced);
  }

  async connect(): Promise<void> {
    if (this.channel) return;

    this.emitStatus('connecting');

    const channel = this.supabase.channel(documentCollabTopic(this.documentId), {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: YJS_UPDATE_EVENT }, ({ payload }) => {
      const encoded = (payload as { update?: string } | null)?.update;
      if (!encoded) return;
      try {
        applyRemoteYjsUpdate(this.doc, base64ToUint8(encoded));
      } catch {
        // Ignore malformed peer payloads.
      }
    });

    channel.on('broadcast', { event: YJS_AWARENESS_EVENT }, ({ payload }) => {
      const encoded = (payload as { update?: string } | null)?.update;
      if (!encoded) return;
      try {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness as unknown as awarenessProtocol.Awareness,
          base64ToUint8(encoded),
          'remote'
        );
      } catch {
        // Ignore malformed peer payloads.
      }
    });

    channel.on('broadcast', { event: YJS_SYNC_REQUEST_EVENT }, () => {
      if (!this.connected) return;
      void channel.send({
        type: 'broadcast',
        event: YJS_UPDATE_EVENT,
        payload: { update: this.encodeStateAsBase64() },
      });
    });

    this.channel = channel;

    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          this.emitStatus('connected');
          // Ask peers for their state, and share ours (covers empty local + peer has edits).
          void channel.send({
            type: 'broadcast',
            event: YJS_SYNC_REQUEST_EVENT,
            payload: {},
          });
          void channel.send({
            type: 'broadcast',
            event: YJS_UPDATE_EVENT,
            payload: { update: this.encodeStateAsBase64() },
          });
          this.emitSync(true);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.connected = false;
          this.emitStatus('disconnected');
          resolve();
        }
      });
    });
  }

  disconnect(): void {
    awarenessProtocol.removeAwarenessStates(
      this.awareness as unknown as awarenessProtocol.Awareness,
      [this.doc.clientID],
      'local'
    );
    if (this.channel) {
      void this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.connected = false;
    this.synced = false;
    this.emitStatus('disconnected');
  }

  /** Full teardown on editor unmount (not used for transient reconnect). */
  destroy(): void {
    this.disconnect();
    this.doc.off('update', this.onDocUpdate);
    (this.awareness as unknown as awarenessProtocol.Awareness).off(
      'update',
      this.onAwarenessUpdate
    );
    (this.awareness as unknown as awarenessProtocol.Awareness).destroy();
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
