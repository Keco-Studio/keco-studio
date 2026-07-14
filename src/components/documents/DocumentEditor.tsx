'use client';

import { useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument, updateDocumentContent } from '@/lib/services/documentService';
import { uploadImageFiles } from '@/lib/services/documentImageUpload';
import {
  broadcastProjectDocumentUpdate,
  subscribeToProjectDocumentUpdates,
} from '@/lib/documents/projectDocumentChannel';
import { registerDocumentFlushHandler } from '@/lib/documents/documentFlushRegistry';
import { queryKeys } from '@/lib/utils/queryKeys';
import { useDocumentAutosave, type PersistState } from './useDocumentAutosave';
import { useDocumentStaleCopy } from './useDocumentStaleCopy';
import {
  useDocumentPermissions,
  type DocumentPermissionState,
} from './useDocumentPermissions';
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
    loading: () => <div className={styles.loading}>Loading editor...</div>,
  }
);

export type DocumentEditorProps = {
  projectId: string;
  documentId: string;
};

export function DocumentEditor({ projectId, documentId }: DocumentEditorProps) {
  const supabase = useSupabase();
  const { data: document, isLoading, error } = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => getDocument(supabase, documentId),
    enabled: Boolean(documentId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const permissions = useDocumentPermissions({
    projectId,
    documentProjectId: document?.project_id ?? null,
    supabase,
  });

  if (error) {
    return <div className={styles.error}>This document could not be loaded.</div>;
  }
  if (isLoading || !document || permissions.isLoading) {
    return <div className={styles.loading}>Loading document...</div>;
  }
  if (permissions.error || !permissions.userId || !permissions.accessToken) {
    return (
      <div className={styles.error}>
        {permissions.error ?? 'This document could not be opened.'}
      </div>
    );
  }

  return (
    <DocumentEditorSession
      document={document}
      projectId={projectId}
      permissions={permissions}
    />
  );
}

function DocumentEditorSession({
  document,
  projectId,
  permissions,
}: {
  document: DocumentRecord;
  projectId: string;
  permissions: DocumentPermissionState & {
    userId: string;
    accessToken: string;
  };
}) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const markdownRef = useRef(document.content ?? '');

  const getSnapshot = useCallback((): string => {
    try {
      const editorMarkdown = editorRef.current?.getMarkdown?.() ?? '';
      if (editorMarkdown.length > 0) return editorMarkdown;
    } catch {
      // The last onChange value remains authoritative during editor teardown.
    }
    return markdownRef.current;
  }, []);

  const save = useCallback(
    (content: string) =>
      updateDocumentContent(supabase, document.id, content, permissions.userId),
    [document.id, permissions.userId, supabase]
  );

  const onSaved = useCallback(
    (content: string, updatedAt: string) => {
      queryClient.setQueryData<DocumentRecord>(
        queryKeys.document(document.id),
        (previous) =>
          previous
            ? { ...previous, content, updated_at: updatedAt }
            : previous
      );
      void broadcastProjectDocumentUpdate({
        documentId: document.id,
        projectId,
        updatedAt,
        action: 'save',
      });
    },
    [document.id, projectId, queryClient]
  );

  const autosave = useDocumentAutosave({
    initialContent: document.content ?? '',
    initialUpdatedAt: document.updated_at,
    readOnly: permissions.readOnly,
    getSnapshot,
    save,
    onSaved,
  });
  const {
    acceptRemote,
    flush,
    handleChange: markChanged,
    isDirty,
    keepLocalAfterRemote,
    lastSavedAt,
    lastSavedContent,
    state: persistState,
    error: persistError,
  } = autosave;

  const loadRemote = useCallback(async () => {
    const remote = await getDocument(supabase, document.id);
    queryClient.setQueryData(queryKeys.document(document.id), remote);
    markdownRef.current = remote.content ?? '';
    editorRef.current?.setMarkdown(remote.content ?? '');
    acceptRemote(remote.content ?? '', remote.updated_at);
  }, [acceptRemote, document.id, queryClient, supabase]);

  const stale = useDocumentStaleCopy({
    documentId: document.id,
    localUpdatedAt: lastSavedAt,
    isDirty,
    onCleanRemoteSave: loadRemote,
  });
  const {
    isStale,
    keepLocal: dismissStale,
    receive: receiveRemoteUpdate,
    reloadRemote,
  } = stale;

  useEffect(
    () => subscribeToProjectDocumentUpdates(receiveRemoteUpdate),
    [receiveRemoteUpdate]
  );

  useEffect(
    () => registerDocumentFlushHandler(() => flush('navigate')),
    [flush]
  );

  const beaconFlush = useCallback(() => {
    if (permissions.readOnly || !isDirty) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;
    const content = getSnapshot();
    if (content === lastSavedContent) return;
    try {
      void fetch(`${url}/rest/v1/documents?id=eq.${document.id}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${permissions.accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ content }),
      });
    } catch {
      // Unload persistence is best-effort; normal autosave remains authoritative.
    }
  }, [
    document.id,
    getSnapshot,
    isDirty,
    lastSavedContent,
    permissions.accessToken,
    permissions.readOnly,
  ]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (window.document.visibilityState === 'hidden') {
        void flush('visibility').catch(() => undefined);
      }
    };
    const onBeforeUnload = () => beaconFlush();
    window.document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [beaconFlush, flush]);

  useEffect(
    () => () => {
      void flush('unmount').catch(() => undefined);
    },
    [flush]
  );

  const handleChange = useCallback(
    (markdown: string) => {
      markdownRef.current = markdown;
      markChanged(markdown);
    },
    [markChanged]
  );

  const imageUploadHandler = useCallback(
    async (image: File): Promise<string> => {
      const urls = await uploadImageFiles(supabase, [image], permissions.userId);
      if (urls.length === 0) throw new Error('Image upload failed');
      return urls[0];
    },
    [permissions.userId, supabase]
  );

  const keepLocal = useCallback(() => {
    const remoteUpdatedAt = dismissStale();
    if (remoteUpdatedAt) keepLocalAfterRemote(remoteUpdatedAt);
  }, [dismissStale, keepLocalAfterRemote]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{document.name}</h1>
        <div className={styles.status} aria-live="polite">
          {permissions.readOnly ? (
            <span className={styles.viewerTag}>View only</span>
          ) : (
            <PersistIndicator
              state={persistState}
              lastSavedAt={lastSavedAt}
              errorDetail={persistError}
            />
          )}
        </div>
      </div>

      {isStale && (
        <div className={styles.staleBanner} role="alert">
          <span>This document was updated elsewhere.</span>
          <div className={styles.staleActions}>
            <button
              type="button"
              className={styles.reloadButton}
              onClick={() => void reloadRemote()}
            >
              Reload remote
            </button>
            <button
              type="button"
              className={styles.keepLocalButton}
              onClick={keepLocal}
            >
              Keep mine
            </button>
          </div>
        </div>
      )}

      <MdxDocumentEditor
        editorRef={editorRef}
        markdown={document.content ?? ''}
        readOnly={permissions.readOnly}
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
  lastSavedAt: string;
  errorDetail: string | null;
}) {
  if (state === 'dirty') {
    return <span className={styles.savingTag}>Unsaved changes...</span>;
  }
  if (state === 'saving') {
    return <span className={styles.savingTag}>Saving...</span>;
  }
  if (state === 'error') {
    return (
      <span className={styles.errorTag} title={errorDetail ?? undefined}>
        {errorDetail ?? 'Save failed - retrying on next edit'}
      </span>
    );
  }
  if (state === 'saved' || lastSavedAt) {
    const time = new Date(lastSavedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return <span className={styles.savedTag}>Saved {time}</span>;
  }
  return null;
}
