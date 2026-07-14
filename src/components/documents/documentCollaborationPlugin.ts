import {
  createRootEditorSubscription$,
  realmPlugin,
} from '@mdxeditor/editor';
import {
  createBinding,
  createUndoManager,
  initLocalState,
  setLocalStateFocus,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type Provider,
} from '@lexical/yjs';
import {
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  REDO_COMMAND,
  SKIP_COLLAB_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { UndoManager, type Doc } from 'yjs';
import type {
  DocumentBindingFailureDirection,
  DocumentCollaborationSession,
} from '@/lib/documents/documentCollaborationSession';

export type DocumentCollaborationParams = {
  session: DocumentCollaborationSession;
  username: string;
  cursorColor: string;
};

function ensureCursorsContainer(
  binding: Binding,
  editor: LexicalEditor
): HTMLElement {
  if (binding.cursorsContainer?.isConnected) {
    return binding.cursorsContainer;
  }

  const rootElement = editor.getRootElement();
  const parent = rootElement?.parentElement ?? document.body;
  const container = document.createElement('div');
  container.className = 'document-collab-cursors';
  container.setAttribute('aria-hidden', 'true');
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

export const documentCollaborationPlugin =
  realmPlugin<DocumentCollaborationParams>({
    init(realm, params) {
      if (!params) return;

      const { session, username, cursorColor } = params;
      realm.pub(createRootEditorSubscription$, (editor: LexicalEditor) => {
        const provider: Provider = session;
        const doc: Doc = session.doc;
        const id = session.documentId;
        const docMap = new Map<string, Doc>([[id, doc]]);
        const binding = createBinding(editor, provider, id, doc, docMap);
        const sharedRoot = binding.root.getSharedType();
        const undoManager = createUndoManager(binding, sharedRoot);
        const awareness = provider.awareness;
        const queuedRemote: Array<{
          events: Array<{ delta: unknown }>;
          isFromUndoManager: boolean;
        }> = [];
        let disposed = false;

        const failBinding = (
          error: unknown,
          direction: DocumentBindingFailureDirection
        ): never => {
          cleanupBinding();
          session.reportBindingFailure(error, direction);
          throw error;
        };

        const syncRemoteChanges = (
          events: Array<{ delta: unknown }>,
          isFromUndoManager: boolean
        ) => {
          try {
            events.forEach((event) => {
              void event.delta;
            });
            syncYjsChangesToLexical(
              binding,
              provider,
              events as never,
              isFromUndoManager
            );
          } catch (error) {
            cleanupBinding();
            session.reportBindingFailure(error, 'yjs-to-lexical');
            throw error;
          }
        };

        const onYjsTreeChanges = (
          events: Array<{ delta: unknown }>,
          transaction: { origin: unknown }
        ) => {
          if (transaction.origin === binding || disposed) return;
          const isFromUndoManager = transaction.origin instanceof UndoManager;
          events.forEach((event) => {
            void event.delta;
          });
          if (editor.isComposing()) {
            queuedRemote.push({ events, isFromUndoManager });
            return;
          }
          syncRemoteChanges(events, isFromUndoManager);
        };

        const flushAfterComposition = () => {
          if (disposed || editor.isComposing()) return;
          try {
            forceLexicalToYjs(binding, provider);
          } catch (error) {
            failBinding(error, 'composition');
          }
          while (queuedRemote.length > 0) {
            const item = queuedRemote.shift()!;
            syncRemoteChanges(item.events, item.isFromUndoManager);
          }
        };

        const onCompositionEnd = () => {
          queueMicrotask(flushAfterComposition);
        };

        const onAwarenessUpdate = () => {
          if (disposed) return;
          try {
            ensureCursorsContainer(binding, editor);
            syncCursorPositions(binding, provider);
          } catch (error) {
            failBinding(error, 'presence');
          }
        };

        const updateUndoRedoState = () => {
          editor.dispatchCommand(
            CAN_UNDO_COMMAND,
            undoManager.undoStack.length > 0
          );
          editor.dispatchCommand(
            CAN_REDO_COMMAND,
            undoManager.redoStack.length > 0
          );
        };

        const rootElement = editor.getRootElement();
        ensureCursorsContainer(binding, editor);
        rootElement?.addEventListener('compositionend', onCompositionEnd);
        initLocalState(
          provider,
          username,
          cursorColor,
          document.activeElement === rootElement,
          { userId: session.userId }
        );

        sharedRoot.observeDeep(onYjsTreeChanges);
        awareness.on('update', onAwarenessUpdate);
        undoManager.on('stack-item-added', updateUndoRedoState);
        undoManager.on('stack-item-popped', updateUndoRedoState);
        undoManager.on('stack-cleared', updateUndoRedoState);

        const removeUpdateListener = editor.registerUpdateListener(
          ({
            prevEditorState,
            editorState,
            dirtyLeaves,
            dirtyElements,
            normalizedNodes,
            tags,
          }) => {
            if (tags.has(SKIP_COLLAB_TAG) || editor.isComposing() || disposed) {
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
            } catch (error) {
              failBinding(error, 'lexical-to-yjs');
            }
          }
        );

        const removeFocus = editor.registerCommand(
          FOCUS_COMMAND,
          () => {
            setLocalStateFocus(
              provider,
              username,
              cursorColor,
              true,
              { userId: session.userId }
            );
            return false;
          },
          COMMAND_PRIORITY_EDITOR
        );
        const removeBlur = editor.registerCommand(
          BLUR_COMMAND,
          () => {
            setLocalStateFocus(
              provider,
              username,
              cursorColor,
              false,
              { userId: session.userId }
            );
            return false;
          },
          COMMAND_PRIORITY_EDITOR
        );
        const removeUndo = editor.registerCommand(
          UNDO_COMMAND,
          () => {
            try {
              undoManager.undo();
              return true;
            } catch (error) {
              return failBinding(error, 'undo-redo');
            }
          },
          COMMAND_PRIORITY_EDITOR
        );
        const removeRedo = editor.registerCommand(
          REDO_COMMAND,
          () => {
            try {
              undoManager.redo();
              return true;
            } catch (error) {
              return failBinding(error, 'undo-redo');
            }
          },
          COMMAND_PRIORITY_EDITOR
        );

        function cleanupBinding() {
          if (disposed) return;
          disposed = true;
          queuedRemote.length = 0;
          rootElement?.removeEventListener('compositionend', onCompositionEnd);
          removeUpdateListener();
          removeFocus();
          removeBlur();
          removeUndo();
          removeRedo();
          awareness.off('update', onAwarenessUpdate);
          sharedRoot.unobserveDeep(onYjsTreeChanges);
          undoManager.off('stack-item-added', updateUndoRedoState);
          undoManager.off('stack-item-popped', updateUndoRedoState);
          undoManager.off('stack-cleared', updateUndoRedoState);
          undoManager.destroy();
          binding.cursorsContainer?.remove();
          binding.cursorsContainer = null;
          binding.root.destroy(binding);
        }

        updateUndoRedoState();
        session.attachBinding();

        return cleanupBinding;
      });
    },
  });

export { colorForUserId } from '@/lib/documents/cursorColor';
