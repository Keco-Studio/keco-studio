'use client';

/**
 * Document editor shell: MDXEditor + debounced Markdown autosave.
 *
 * Saves must complete BEFORE sidebar navigation: soft routing unmounts this
 * tree and a pending debounce is lost. We register a flush handler the sidebar
 * awaits, always snapshot live markdown, and write through to the React Query
 * cache so returning to the doc does not flash stale empty content.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument, updateDocumentContent } from '@/lib/services/documentService';
import {
  getUserProjectRole,
  getCurrentUserId,
  AuthorizationError,
} from '@/lib/services/authorizationService';
import { uploadImageFiles } from '@/lib/services/documentImageUpload';
import { broadcastDocumentUpdated } from '@/lib/documents/documentBroadcast';
import { registerDocumentFlushHandler } from '@/lib/documents/documentFlushRegistry';
import { queryKeys } from '@/lib/utils/queryKeys';
import type {
  MdxDocumentEditorProps,
  MDXEditorMethods,
} from './MdxDocumentEditor';
import type { DocumentRecord } from '@/lib/services/documentService';
import styles from './DocumentEditor.module.css';

const MdxDocumentEditor = dynamic<MdxDocumentEditorProps>(
  () => import('./MdxDocumentEditor'),
  {
    ssr: false,
    loading: () => <div className={styles.loading}>Loading editor…</div>,
  }
);

const PERSIST_DELAY_MS = 500;

type PersistState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type DocumentEditorProps = {
  projectId: string;
  documentId: string;
};

export function DocumentEditor({ projectId, documentId }: DocumentEditorProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const [role, setRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [persistState, setPersistState] = useState<PersistState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  const markdownRef = useRef<string>('');
  const lastSavedMarkdownRef = useRef<string>('');
  const dirtyRef = useRef(false);
  // Set when an edit arrives while a save is in flight, so the save loop makes
  // another pass instead of dropping the newer content (coalescing).
  const pendingRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const savingRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const readOnlyRef = useRef(true);
  const documentIdRef = useRef(documentId);
  const projectIdRef = useRef(projectId);

  documentIdRef.current = documentId;
  projectIdRef.current = projectId;

  const {
    data: document,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => getDocument(supabase, documentId),
    enabled: !!documentId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    Promise.all([
      getUserProjectRole(supabase, projectId),
      getCurrentUserId(supabase),
      supabase.auth.getSession(),
    ])
      .then(([r, id, session]) => {
        if (!active) return;
        setRole(r);
        setUserId(id);
        userIdRef.current = id;
        // Cached for the beforeunload keepalive beacon (cannot await there).
        accessTokenRef.current = session.data.session?.access_token ?? null;
      })
      .catch(() => {
        if (active) {
          setRole(null);
          setUserId(null);
          userIdRef.current = null;
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, supabase]);

  const isViewer = role === 'viewer';
  const readOnly = isViewer || role === null;
  readOnlyRef.current = readOnly;

  const snapshotMarkdown = useCallback((): string => {
    // Prefer the last onChange value; getMarkdown() can return "" while the
    // Lexical tree still shows text (export glitches). Only trust getMarkdown
    // when it is non-empty or when we have nothing in the ref yet.
    let fromEditor = '';
    try {
      fromEditor = editorRef.current?.getMarkdown?.() ?? '';
    } catch {
      fromEditor = '';
    }
    if (fromEditor.length > 0) return fromEditor;
    return markdownRef.current;
  }, []);

  const writeCache = useCallback(
    (targetDocumentId: string, content: string, updatedAt: string) => {
      queryClient.setQueryData<DocumentRecord>(
        queryKeys.document(targetDocumentId),
        (prev) =>
          prev
            ? { ...prev, content, updated_at: updatedAt }
            : prev
      );
    },
    [queryClient]
  );

  /**
   * Decide what to write for a given reason. An empty snapshot produced by an
   * editor that is being torn down (navigate/unmount/visibility) must NOT clobber
   * a previously saved non-empty body. An explicit clear during 'debounce' IS
   * saved, because the user really did empty the document.
   */
  const resolveToSave = useCallback(
    (content: string, reason: 'debounce' | 'navigate' | 'unmount' | 'visibility'): string => {
      if (
        content === '' &&
        lastSavedMarkdownRef.current.length > 0 &&
        reason !== 'debounce'
      ) {
        return lastSavedMarkdownRef.current;
      }
      return content;
    },
    []
  );

  /**
   * Serialized, coalescing save. A single in-flight save is allowed; edits that
   * arrive during it set pendingRef so the loop makes another pass. Rejections
   * propagate so navigation can decide whether to block.
   */
  const persistNow = useCallback(
    async (reason: 'debounce' | 'navigate' | 'unmount' | 'visibility'): Promise<void> => {
      if (readOnlyRef.current) return;
      const uid = userIdRef.current;
      const targetId = documentIdRef.current;
      if (!uid || !targetId) return;

      // Coalesce: if a save is already running, record that more work is pending
      // and let the running loop pick it up.
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }

      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      savingRef.current = true;
      try {
        do {
          pendingRef.current = false;
          const content = snapshotMarkdown();
          markdownRef.current = content;
          const toSave = resolveToSave(content, reason);

          if (toSave === lastSavedMarkdownRef.current) {
            dirtyRef.current = false;
            break;
          }

          if (targetId === documentIdRef.current) {
            setPersistState('saving');
            setPersistError(null);
          }

          const { updatedAt } = await updateDocumentContent(
            supabase,
            targetId,
            toSave,
            uid
          );
          lastSavedMarkdownRef.current = toSave;
          writeCache(targetId, toSave, updatedAt);
          void broadcastDocumentUpdated(supabase, {
            documentId: targetId,
            projectId: projectIdRef.current,
            updatedAt,
            action: 'save',
          });
          if (targetId === documentIdRef.current) {
            setLastSavedAt(updatedAt);
          }
          // Loop again only if edits arrived during the await (pendingRef).
        } while (pendingRef.current);

        dirtyRef.current = pendingRef.current;
        if (targetId === documentIdRef.current) {
          setPersistState(dirtyRef.current ? 'dirty' : 'saved');
        }
      } catch (err) {
        console.error(`[DocumentEditor] persist failed (${reason})`, err);
        dirtyRef.current = true;
        if (targetId === documentIdRef.current) {
          setPersistState('error');
          setPersistError(
            err instanceof AuthorizationError
              ? 'Auth hiccup — keep typing; will retry'
              : err instanceof Error
                ? err.message
                : 'Save failed'
          );
        }
        throw err;
      } finally {
        savingRef.current = false;
      }
    },
    [snapshotMarkdown, resolveToSave, supabase, writeCache]
  );

  const persistNowRef = useRef(persistNow);
  persistNowRef.current = persistNow;

  /** Await any in-flight save, then flush remaining edits. Rethrows on failure. */
  const flushForNavigation = useCallback(async (): Promise<void> => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const started = Date.now();
    while (savingRef.current && Date.now() - started < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await persistNowRef.current('navigate');
  }, []);

  const flushForNavigationRef = useRef(flushForNavigation);
  flushForNavigationRef.current = flushForNavigation;

  const schedulePersist = useCallback(() => {
    if (readOnlyRef.current) return;
    dirtyRef.current = true;
    if (savingRef.current) pendingRef.current = true;
    setPersistState((prev) => (prev === 'saving' ? prev : 'dirty'));
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void persistNowRef.current('debounce').catch(() => undefined);
    }, PERSIST_DELAY_MS);
  }, []);

  const handleChange = useCallback(
    (markdown: string) => {
      markdownRef.current = markdown;
      dirtyRef.current = true;
      if (savingRef.current) pendingRef.current = true;
      schedulePersist();
    },
    [schedulePersist]
  );

  // Hydrate from server when this document loads (do not clobber local edits).
  useEffect(() => {
    if (!document || document.id !== documentId) return;
    if (dirtyRef.current || savingRef.current) return;
    const serverContent = document.content ?? '';
    markdownRef.current = serverContent;
    lastSavedMarkdownRef.current = serverContent;
    setLastSavedAt(document.updated_at);
    setPersistState('saved');
    setPersistError(null);
  }, [document, documentId]);

  /**
   * Synchronous keepalive flush for tab close. An async save started in
   * `beforeunload` cannot block unload, so we PATCH the row via a keepalive
   * fetch that the browser is allowed to finish after the page is gone.
   */
  const beaconFlush = useCallback(() => {
    if (readOnlyRef.current || !dirtyRef.current) return;
    const targetId = documentIdRef.current;
    const token = accessTokenRef.current;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!targetId || !token || !url || !anon) return;
    const content = snapshotMarkdown();
    const toSave = resolveToSave(content, 'visibility');
    if (toSave === lastSavedMarkdownRef.current) return;
    try {
      void fetch(`${url}/rest/v1/documents?id=eq.${targetId}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          apikey: anon,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ content: toSave }),
      });
      lastSavedMarkdownRef.current = toSave;
    } catch {
      // Best-effort only.
    }
  }, [snapshotMarkdown, resolveToSave]);

  const beaconFlushRef = useRef(beaconFlush);
  beaconFlushRef.current = beaconFlush;

  // Sidebar awaits this before router.push to another doc/library/folder.
  // Errors propagate so the navigator can keep the user on the page.
  useEffect(() => {
    return registerDocumentFlushHandler(() => flushForNavigationRef.current());
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') {
        // Try a normal async save first (usually completes on tab switch);
        // the beacon is the fallback if the page is actually being unloaded.
        void persistNowRef.current('visibility').catch(() => undefined);
      }
    };
    const onBeforeUnload = () => {
      beaconFlushRef.current();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      // Best-effort; navigation path should have awaited already.
      void persistNowRef.current('unmount').catch(() => undefined);
    };
  }, []);

  const imageUploadHandler = useCallback(
    async (image: File): Promise<string> => {
      const uid = userIdRef.current ?? (await getCurrentUserId(supabase));
      const urls = await uploadImageFiles(supabase, [image], uid);
      if (urls.length === 0) {
        throw new Error('Image upload failed');
      }
      return urls[0];
    },
    [supabase]
  );

  if (isLoading || !document || role === null || !userId) {
    if (error) {
      return (
        <div className={styles.error}>This document could not be loaded.</div>
      );
    }
    return <div className={styles.loading}>Loading document…</div>;
  }

  // The document is loaded by ID but the role/permissions were resolved from the
  // project in the URL. Reject a document that belongs to a different project.
  if (document.project_id !== projectId) {
    return (
      <div className={styles.error}>
        This document does not belong to this project.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{document.name}</h1>
        <div className={styles.status} aria-live="polite">
          {isViewer && <span className={styles.viewerTag}>View only</span>}
          {!isViewer && (
            <PersistIndicator
              state={persistState}
              lastSavedAt={lastSavedAt}
              errorDetail={persistError}
            />
          )}
        </div>
      </div>

      <MdxDocumentEditor
        key={documentId}
        editorRef={editorRef}
        markdown={document.content ?? ''}
        readOnly={readOnly}
        onChange={handleChange}
        imageUploadHandler={imageUploadHandler}
      />
    </div>
  );
}

function PersistIndicator({
  state,
  lastSavedAt,
  errorDetail,
}: {
  state: PersistState;
  lastSavedAt: string | null;
  errorDetail: string | null;
}) {
  if (state === 'dirty') {
    return <span className={styles.savingTag}>Unsaved changes…</span>;
  }
  if (state === 'saving') {
    return <span className={styles.savingTag}>Saving…</span>;
  }
  if (state === 'error') {
    return (
      <span className={styles.errorTag} title={errorDetail ?? undefined}>
        {errorDetail ?? 'Save failed — retrying on next edit'}
      </span>
    );
  }
  if (state === 'saved' || lastSavedAt) {
    const time = lastSavedAt
      ? new Date(lastSavedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    return (
      <span className={styles.savedTag}>
        {time ? `Saved ${time}` : 'Saved'}
      </span>
    );
  }
  return null;
}
