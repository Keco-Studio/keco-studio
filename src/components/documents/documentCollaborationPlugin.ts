import { useEffect } from 'react';
import { addComposerChild$, markdown$, realmPlugin } from '@mdxeditor/editor';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
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
  type UpdateListenerPayload,
} from 'lexical';
import { UndoManager, type Doc } from 'yjs';
import type {
  DocumentBindingFailureDirection,
  DocumentCollaborationSession,
} from '@/lib/documents/documentCollaborationSession';
import { createDocumentLexicalYjsBinding } from '@/lib/documents/documentLexicalYjsBinding';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';

export type DocumentCollaborationParams = {
  session: DocumentCollaborationSession;
  username: string;
  cursorColor: string;
};

type ActiveEditorBinding = {
  session: DocumentCollaborationSession;
  refs: number;
  releasePending: boolean;
  dispose: () => void;
};

type CompositionState = Pick<
  UpdateListenerPayload,
  | 'prevEditorState'
  | 'dirtyElements'
  | 'dirtyLeaves'
  | 'normalizedNodes'
  | 'tags'
>;

const activeEditorBindings = new WeakMap<LexicalEditor, ActiveEditorBinding>();

function isDetachedNodeError(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotFoundError';
}

function releaseEditorBinding(
  editor: LexicalEditor,
  entry: ActiveEditorBinding
): void {
  if (activeEditorBindings.get(editor) !== entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.releasePending = true;
  queueMicrotask(() => {
    if (
      !entry.releasePending ||
      entry.refs > 0 ||
      activeEditorBindings.get(editor) !== entry
    ) {
      return;
    }
    activeEditorBindings.delete(editor);
    entry.dispose();
  });
}

function ensureCursorsContainer(
  binding: Binding,
  rootElement: HTMLElement | null
): HTMLElement | null {
  const parent = rootElement?.parentElement;
  // Lexical can hand us a root that is not in the document yet (or already
  // leaving it). Throwing here runs during React's commit/ref phase and can
  // surface as a NotFoundError removeChild crash for the whole app shell.
  if (!parent) return null;

  const container = binding.cursorsContainer ?? document.createElement('div');
  if (!binding.cursorsContainer) {
    container.className = 'document-collab-cursors';
    container.setAttribute('aria-hidden', 'true');
    binding.cursorsContainer = container;
  }
  if (binding.cursorsContainer?.parentElement !== parent) {
    parent.appendChild(container);
  }
  return container;
}

function mergeCompositionChanges(
  compositionState: CompositionState | null,
  changes: CompositionState
): CompositionState {
  const merged = compositionState ?? {
    prevEditorState: changes.prevEditorState,
    dirtyElements: new Map(),
    dirtyLeaves: new Set(),
    normalizedNodes: new Set(),
    tags: new Set(),
  };
  for (const [key, intentionallyDirty] of changes.dirtyElements) {
    merged.dirtyElements.set(key, intentionallyDirty);
  }
  for (const key of changes.dirtyLeaves) merged.dirtyLeaves.add(key);
  for (const key of changes.normalizedNodes) merged.normalizedNodes.add(key);
  for (const tag of changes.tags) merged.tags.add(tag);
  return merged;
}

function flushCompositionToYjs(
  binding: Binding,
  provider: Provider,
  compositionState: CompositionState
): void {
  syncLexicalUpdateToYjs(
    binding,
    provider,
    compositionState.prevEditorState,
    binding.editor.getEditorState(),
    compositionState.dirtyElements,
    compositionState.dirtyLeaves,
    compositionState.normalizedNodes,
    compositionState.tags
  );
}

function attachEditorBinding(
  editor: LexicalEditor,
  params: DocumentCollaborationParams
): () => void {
  const { session, username, cursorColor } = params;
  const existing = activeEditorBindings.get(editor);
  if (existing?.session === session) {
    existing.releasePending = false;
    existing.refs += 1;
    return () => releaseEditorBinding(editor, existing);
  }
  if (existing) {
    activeEditorBindings.delete(editor);
    existing.dispose();
  }

  const provider: Provider = session;
  const doc: Doc = session.doc;
  const id = session.documentId;
  const docMap = new Map<string, Doc>([[id, doc]]);
  const binding = createDocumentLexicalYjsBinding(
    editor,
    provider,
    id,
    doc,
    docMap
  );
  const sharedRoot = binding.root.getSharedType();
  const undoManager = createUndoManager(binding, sharedRoot);
  const awareness = provider.awareness;
  const queuedRemote: Array<{
    events: Array<{ delta: unknown }>;
    isFromUndoManager: boolean;
  }> = [];
  let disposed = false;
  let activeEntry: ActiveEditorBinding | null = null;
  let compositionState: CompositionState | null = null;
  let cursorRefreshFrame: number | null = null;
  let activeRoot: HTMLElement | null = null;
  let removeRootListener = () => undefined;

  const refreshCursorPositions = () => {
    if (disposed || !activeRoot) return;
    try {
      if (!ensureCursorsContainer(binding, activeRoot)) return;
      syncCursorPositions(binding, provider);
    } catch (error) {
      // Cursor overlay nodes are siblings of Lexical's contenteditable. React 19
      // can delete them during the same commit that clears the editor root;
      // treat that race as presence-only noise, not a binding failure.
      if (isDetachedNodeError(error)) return;
      failBinding(error, 'presence');
    }
  };

  const scheduleCursorRefresh = () => {
    if (cursorRefreshFrame !== null) {
      cancelAnimationFrame(cursorRefreshFrame);
      cursorRefreshFrame = null;
    }
    if (disposed || !activeRoot) return;
    cursorRefreshFrame = requestAnimationFrame(() => {
      cursorRefreshFrame = null;
      refreshCursorPositions();
    });
  };

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
        isFromUndoManager,
        () => scheduleCursorRefresh()
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
    if (compositionState) {
      try {
        flushCompositionToYjs(binding, provider, compositionState);
        compositionState = null;
      } catch (error) {
        failBinding(error, 'composition');
      }
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
    refreshCursorPositions();
  };

  const updateUndoRedoState = () => {
    editor.dispatchCommand(CAN_UNDO_COMMAND, undoManager.undoStack.length > 0);
    editor.dispatchCommand(CAN_REDO_COMMAND, undoManager.redoStack.length > 0);
  };

  const cursorMutationObserver = new MutationObserver(scheduleCursorRefresh);
  removeRootListener = editor.registerRootListener((nextRoot, previousRoot) => {
    cursorMutationObserver.disconnect();
    if (cursorRefreshFrame !== null) {
      cancelAnimationFrame(cursorRefreshFrame);
      cursorRefreshFrame = null;
    }
    previousRoot?.removeEventListener('compositionend', onCompositionEnd);
    activeRoot = nextRoot;
    // Keep the overlay attached across temporary null roots. Detaching it here
    // races React's commitDeletionEffectsOnFiber removeChild and throws
    // NotFoundError while the document editor is remounting.
    if (!nextRoot) return;
    try {
      if (!ensureCursorsContainer(binding, nextRoot)) return;
      cursorMutationObserver.observe(nextRoot, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      nextRoot.addEventListener('compositionend', onCompositionEnd);
      scheduleCursorRefresh();
    } catch (error) {
      if (isDetachedNodeError(error)) return;
      failBinding(error, 'presence');
    }
  });
  initLocalState(
    provider,
    username,
    cursorColor,
    document.activeElement === activeRoot,
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
      if (tags.has(SKIP_COLLAB_TAG) || disposed) {
        return;
      }
      if (editor.isComposing()) {
        compositionState = mergeCompositionChanges(compositionState, {
          prevEditorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        });
        return;
      }
      try {
        if (compositionState) {
          compositionState = mergeCompositionChanges(compositionState, {
            prevEditorState,
            dirtyElements,
            dirtyLeaves,
            normalizedNodes,
            tags,
          });
          flushCompositionToYjs(binding, provider, compositionState);
          compositionState = null;
        } else {
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
        }
      } catch (error) {
        failBinding(error, 'lexical-to-yjs');
      }
    }
  );

  const removeFocus = editor.registerCommand(
    FOCUS_COMMAND,
    () => {
      setLocalStateFocus(provider, username, cursorColor, true, {
        userId: session.userId,
      });
      return false;
    },
    COMMAND_PRIORITY_EDITOR
  );
  const removeBlur = editor.registerCommand(
    BLUR_COMMAND,
    () => {
      setLocalStateFocus(provider, username, cursorColor, false, {
        userId: session.userId,
      });
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
    if (activeEntry && activeEditorBindings.get(editor) === activeEntry) {
      activeEditorBindings.delete(editor);
    }
    queuedRemote.length = 0;
    compositionState = null;
    cursorMutationObserver.disconnect();
    if (cursorRefreshFrame !== null) {
      cancelAnimationFrame(cursorRefreshFrame);
      cursorRefreshFrame = null;
    }
    activeRoot?.removeEventListener('compositionend', onCompositionEnd);
    activeRoot = null;
    removeRootListener();
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

  activeEntry = {
    session,
    refs: 1,
    releasePending: false,
    dispose: cleanupBinding,
  };
  activeEditorBindings.set(editor, activeEntry);
  updateUndoRedoState();
  session.attachBinding();

  return () => {
    if (activeEntry) releaseEditorBinding(editor, activeEntry);
  };
}

export const documentCollaborationPlugin =
  realmPlugin<DocumentCollaborationParams>({
    init(realm, params) {
      if (!params) return;

      params.session.setSemanticStateValidator(() => {
        validateSanctionedMdx(realm.getValue(markdown$));
      });

      function DocumentCollaborationLifecycle() {
        const [editor] = useLexicalComposerContext();
        useEffect(() => attachEditorBinding(editor, params), [editor]);
        return null;
      }

      realm.pub(addComposerChild$, DocumentCollaborationLifecycle);
    },
  });

export { colorForUserId } from '@/lib/documents/cursorColor';
