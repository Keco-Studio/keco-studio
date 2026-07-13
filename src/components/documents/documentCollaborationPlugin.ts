/**
 * MDXEditor realm plugin that wires @lexical/yjs collaboration onto the
 * editor's root Lexical instance (MDXEditor does not use Lexical's
 * CollaborationPlugin React tree).
 *
 * Connect order (matches Lexical CollaborationPlugin):
 * 1. createBinding + observeDeep
 * 2. (deferred) apply Postgres yjs_state so observeDeep → Lexical once
 * 3. provider.connect() for Realtime peers
 * 4. bootstrap from editor markdown only if Yjs root is still empty
 *
 * IME: never Lexical→Yjs while editor.isComposing() — Chinese pinyin
 * intermediates (e.g. h'b'v') must not be committed into the CRDT.
 */

import {
  realmPlugin,
  createRootEditorSubscription$,
} from '@mdxeditor/editor';
import {
  createBinding,
  initLocalState,
  setLocalStateFocus,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Provider,
  type Binding,
} from '@lexical/yjs';
import type { LexicalEditor } from 'lexical';
import {
  BLUR_COMMAND,
  FOCUS_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  SKIP_COLLAB_TAG,
  $getRoot,
} from 'lexical';
import type { Doc } from 'yjs';
import { UndoManager } from 'yjs';
import type { DocumentYjsProvider } from '@/lib/documents/documentYjsProvider';

export type DocumentCollaborationParams = {
  id: string;
  provider: Provider;
  doc: Doc;
  username: string;
  cursorColor: string;
  /** When true and Yjs root is empty after sync, push MDXEditor markdown into Yjs. */
  shouldBootstrapFromEditor: boolean;
};

function ensureCursorsContainer(binding: Binding, editor: LexicalEditor): HTMLElement {
  if (binding.cursorsContainer && binding.cursorsContainer.isConnected) {
    return binding.cursorsContainer;
  }
  const rootElement = editor.getRootElement();
  const parent = rootElement?.parentElement ?? document.body;
  const container = document.createElement('div');
  container.className = 'document-collab-cursors';
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '5';
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(container);
  binding.cursorsContainer = container;
  return container;
}

function forceLexicalToYjs(binding: Binding, provider: Provider): void {
  const editorState = binding.editor.getEditorState();
  syncLexicalUpdateToYjs(
    binding,
    provider,
    editorState,
    editorState,
    new Map([['root', true]]),
    new Set(),
    new Set(),
    new Set()
  );
}

function asDocumentProvider(
  provider: Provider
): DocumentYjsProvider | null {
  if (
    provider &&
    typeof (provider as DocumentYjsProvider).applyInitialState === 'function'
  ) {
    return provider as DocumentYjsProvider;
  }
  return null;
}

function safeSyncYjsToLexical(
  binding: Binding,
  provider: Provider,
  events: Array<{ delta: unknown }>,
  isFromUndoManager: boolean
): void {
  try {
    // Deltas must be read during the Yjs event turn (or immediately after
    // we captured them while composing).
    events.forEach((event) => {
      void event.delta;
    });
    syncYjsChangesToLexical(
      binding,
      provider,
      events as never,
      isFromUndoManager
    );
  } catch (err) {
    // Dev builds of @lexical/yjs throw (e.g. syncChildrenFromYjs / missing
    // DOM node) when MDXEditor replaces nodes underfoot. Swallow so the
    // editor stays usable; next local edit re-syncs from Lexical.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[doc-collab] Yjs→Lexical sync skipped:', err);
    }
  }
}

export const documentCollaborationPlugin = realmPlugin<DocumentCollaborationParams>({
  init(realm, params) {
    if (!params) return;

    const { id, provider, doc, username, cursorColor, shouldBootstrapFromEditor } =
      params;

    realm.pub(createRootEditorSubscription$, (editor: LexicalEditor) => {
      const docMap = new Map<string, Doc>([[id, doc]]);
      const binding = createBinding(editor, provider, id, doc, docMap);
      ensureCursorsContainer(binding, editor);

      const awareness = provider.awareness;
      let didBootstrap = false;
      let disposed = false;

      /** Remote Yjs events deferred while the local IME is composing. */
      const queuedRemote: Array<{
        events: Array<{ delta: unknown }>;
        isFromUndoManager: boolean;
      }> = [];

      const onYjsTreeChanges = (
        events: Array<{ delta: unknown }>,
        transaction: { origin: unknown }
      ) => {
        // Skip local Lexical→Yjs writes (origin === binding).
        if (transaction.origin === binding) return;
        const isFromUndoManager = transaction.origin instanceof UndoManager;

        // Capture deltas now — Yjs invalidates them after the observer returns.
        events.forEach((event) => {
          void event.delta;
        });

        if (editor.isComposing()) {
          queuedRemote.push({ events, isFromUndoManager });
          return;
        }

        safeSyncYjsToLexical(binding, provider, events, isFromUndoManager);
      };

      initLocalState(
        provider,
        username,
        cursorColor,
        document.activeElement === editor.getRootElement(),
        {}
      );

      binding.root.getSharedType().observeDeep(onYjsTreeChanges);

      const flushAfterComposition = () => {
        if (disposed || editor.isComposing()) return;
        try {
          forceLexicalToYjs(binding, provider);
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[doc-collab] compositionend Lexical→Yjs skipped:', err);
          }
        }
        while (queuedRemote.length > 0) {
          const item = queuedRemote.shift()!;
          safeSyncYjsToLexical(
            binding,
            provider,
            item.events,
            item.isFromUndoManager
          );
        }
      };

      const onCompositionEnd = () => {
        // IME commits asynchronously relative to Lexical state; wait a tick.
        queueMicrotask(flushAfterComposition);
      };

      const rootEl = editor.getRootElement();
      rootEl?.addEventListener('compositionend', onCompositionEnd);

      const onSync = (isSynced: boolean) => {
        if (!isSynced || didBootstrap || disposed) return;
        const yRoot = binding.root.getSharedType();
        if (yRoot.length > 0) {
          didBootstrap = true;
          return;
        }
        if (!shouldBootstrapFromEditor) {
          didBootstrap = true;
          return;
        }
        didBootstrap = true;
        queueMicrotask(() => {
          if (disposed) return;
          binding.editor.update(() => {
            $getRoot().markDirty();
          });
          forceLexicalToYjs(binding, provider);
        });
      };

      const onAwarenessUpdate = () => {
        if (disposed) return;
        try {
          ensureCursorsContainer(binding, editor);
          syncCursorPositions(binding, provider);
        } catch {
          // Cursor overlay is best-effort.
        }
      };

      provider.on('sync', onSync);
      awareness.on('update', onAwarenessUpdate);

      const removeUpdateListener = editor.registerUpdateListener(
        ({
          prevEditorState,
          editorState,
          dirtyLeaves,
          dirtyElements,
          normalizedNodes,
          tags,
        }) => {
          if (tags.has(SKIP_COLLAB_TAG)) {
            return;
          }
          // Do not push IME intermediates (pinyin / h'b'v'…) into Yjs.
          if (editor.isComposing()) {
            return;
          }
          try {
            syncLexicalUpdateToYjs(
              binding,
              provider,
              prevEditorState,
              editorState,
              dirtyElements,
              dirtyLeaves,
              normalizedNodes,
              tags
            );
          } catch (err) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[doc-collab] Lexical→Yjs sync skipped:', err);
            }
          }
        }
      );

      const removeFocus = editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setLocalStateFocus(provider, username, cursorColor, true, {});
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      );

      const removeBlur = editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setLocalStateFocus(provider, username, cursorColor, false, {});
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      );

      // Defer past MDXEditor's nested editor.update(import markdown) so we
      // never call syncYjsChangesToLexical inside another update closure
      // (causes "node does not exist in active editor state").
      const startTimer = window.setTimeout(() => {
        if (disposed) return;
        asDocumentProvider(provider)?.applyInitialState();
        void Promise.resolve(provider.connect?.()).then(() => {
          if (disposed) return;
          const providerWithSync = provider as Provider & { isSynced?: boolean };
          if (providerWithSync.isSynced) {
            onSync(true);
          }
        });
      }, 0);

      return () => {
        disposed = true;
        window.clearTimeout(startTimer);
        queuedRemote.length = 0;
        rootEl?.removeEventListener('compositionend', onCompositionEnd);
        removeUpdateListener();
        removeFocus();
        removeBlur();
        provider.off('sync', onSync);
        awareness.off('update', onAwarenessUpdate);
        binding.root.getSharedType().unobserveDeep(onYjsTreeChanges);
        try {
          provider.disconnect?.();
        } catch {
          // Provider may already be destroyed by DocumentEditor unmount.
        }
        if (binding.cursorsContainer?.parentElement) {
          binding.cursorsContainer.parentElement.removeChild(
            binding.cursorsContainer
          );
        }
        binding.cursorsContainer = null;
      };
    });
  },
});

export { colorForUserId } from '@/lib/documents/cursorColor';
