'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument, type DocumentRecord } from '@/lib/services/documentService';
import { uploadImageFiles } from '@/lib/services/documentImageUpload';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast } from '@/lib/utils/toast';
import {
  useDocumentPermissions,
  type DocumentPermissionState,
} from './useDocumentPermissions';
import { useDocumentCollaboration } from './useDocumentCollaboration';
import { getDocumentVersionPreview } from '@/lib/documents/documentVersionService';
import { DocumentVersionSidebar } from './DocumentVersionSidebar';
import {
  dispatchDocumentPresenceUpdate,
  toDocumentPresenceUser,
} from './documentPresenceEvents';
import type {
  MDXEditorMethods,
  MdxDocumentEditorProps,
} from './MdxDocumentEditor';
import styles from './DocumentEditor.module.css';

const rejectHistoricalImageUpload = async () => {
  throw new Error('Images cannot be uploaded while viewing a historical version');
};

const MdxDocumentEditor = dynamic<MdxDocumentEditorProps>(
  () => import('./MdxDocumentEditor'),
  {
    ssr: false,
    loading: () => <div className={styles.editorPlaceholder}>Loading editor...</div>,
  }
);

export type DocumentEditorProps = {
  projectId: string;
  documentId: string;
  /** Script workspace: no side padding so the editor sits flush to the shell sidebar. */
  flushLayout?: boolean;
  /** Keeps document data loading parallel to the Script membership guard. */
  scriptWorkspaceMembershipReady?: boolean;
};

export function DocumentEditor({
  projectId,
  documentId,
  flushLayout = false,
  scriptWorkspaceMembershipReady = true,
}: DocumentEditorProps) {
  const supabase = useSupabase();
  const { data: document, isLoading, error } = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => getDocument(supabase, documentId),
    enabled: Boolean(documentId),
    staleTime: 0,
    refetchOnMount: true,
  });
  const permissions = useDocumentPermissions({
    projectId,
    documentProjectId: document?.project_id ?? null,
    supabase,
  });

  if (error) {
    return <div className={styles.error}>This document could not be loaded.</div>;
  }
  if (
    isLoading ||
    !document ||
    permissions.isLoading ||
    !scriptWorkspaceMembershipReady
  ) {
    return <div className={styles.loading}>Loading document...</div>;
  }
  if (
    permissions.error ||
    !permissions.role ||
    !permissions.userId ||
    !permissions.accessToken ||
    !permissions.userName
  ) {
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
      permissions={permissions as ReadyDocumentPermissions}
      flushLayout={flushLayout}
    />
  );
}

type ReadyDocumentPermissions = DocumentPermissionState & {
  role: 'admin' | 'editor' | 'viewer';
  userId: string;
  accessToken: string;
  userName: string;
};


function DocumentEditorSession({
  document,
  projectId,
  permissions,
  flushLayout = false,
}: {
  document: DocumentRecord;
  projectId: string;
  permissions: ReadyDocumentPermissions;
  flushLayout?: boolean;
}) {
  const supabase = useSupabase();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [referenceNavigationReady, setReferenceNavigationReady] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const collaboration = useDocumentCollaboration({
    supabase,
    documentId: document.id,
    projectId,
    userId: permissions.userId,
    accessToken: permissions.accessToken,
    role: permissions.role,
    userName: permissions.userName,
  });
  const historicalPreviewQuery = useQuery({
    queryKey: queryKeys.documentVersion(document.id, selectedVersionId ?? ''),
    queryFn: () => getDocumentVersionPreview(supabase, document.id, selectedVersionId!),
    enabled: Boolean(selectedVersionId),
  });
  const [boundCollaborationDocumentId, setBoundCollaborationDocumentId] =
    useState<string | null>(null);
  const hasBoundCollaboration = boundCollaborationDocumentId === document.id;
  const viewingHistoricalVersion = Boolean(selectedVersionId);
  const historicalMarkdown = historicalPreviewQuery.data?.markdown ?? '';
  const historicalVersionName = historicalPreviewQuery.data?.name ?? 'selected version';

  useEffect(() => {
    if (collaboration.canBind && collaboration.session) {
      setBoundCollaborationDocumentId(document.id);
    }
  }, [collaboration.canBind, collaboration.session, document.id]);

  const imageUploadHandler = useCallback(
    async (image: File): Promise<string> => {
      const urls = await uploadImageFiles(supabase, [image], permissions.userId);
      if (urls.length === 0) throw new Error('Image upload failed');
      return urls[0];
    },
    [permissions.userId, supabase]
  );
  const ignoreMarkdownChange = useCallback(() => undefined, []);
  const handleEditorRef = useCallback((methods: MDXEditorMethods | null) => {
    const ready = methods !== null;
    setReferenceNavigationReady((current) => current === ready ? current : ready);
  }, []);
  const handleExport = useCallback(
    async ({ key }: { key: string }) => {
      if (exportingFormat) return;
      setExportingFormat(key);
      try {
        if (permissions.role !== 'viewer') {
          await collaboration.session?.flush();
        }
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error('Please sign in before exporting');
        }
        const response = await fetch(
          `/api/documents/${document.id}/export?format=${key}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (!response.ok) throw new Error('Document export failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = `${document.name}.${key}`;
        anchor.click();
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : 'Document export failed');
      } finally {
        setExportingFormat(null);
      }
    },
    [
      collaboration.session,
      document.id,
      document.name,
      exportingFormat,
      permissions.role,
      supabase,
    ]
  );
  const exportItems = [
    { key: 'docx', label: 'Download DOCX' },
    { key: 'pdf', label: 'Download PDF' },
    { key: 'mdx', label: 'Download Markdown' },
  ];
  const editorKey = `${document.id}:${collaboration.token.epoch}:${
    collaboration.isLegacyView ? 'legacy' : 'collaborative'
  }`;

  useEffect(() => {
    const presenceUsers = collaboration.collaborators.map(toDocumentPresenceUser);
    dispatchDocumentPresenceUpdate({
      projectId,
      documentId: document.id,
      presenceUsers,
    });
    return () => {
      dispatchDocumentPresenceUpdate({
        projectId,
        documentId: document.id,
        presenceUsers: [],
      });
    };
  }, [collaboration.collaborators, document.id, projectId]);

  useEffect(() => {
    const handleTopbarExport = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      void handleExport({ key: detail?.key ?? 'mdx' });
    };
    const handleTopbarHistoryToggle = () => {
      setHistoryOpen((open) => {
        if (open) setSelectedVersionId(null);
        return !open;
      });
    };
    window.addEventListener('document-export-trigger', handleTopbarExport);
    window.addEventListener('document-history-toggle', handleTopbarHistoryToggle);
    return () => {
      window.removeEventListener('document-export-trigger', handleTopbarExport);
      window.removeEventListener('document-history-toggle', handleTopbarHistoryToggle);
    };
  }, [handleExport]);

  // Open history when navigated here from sidebar "Version history".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const pendingDocumentId = window.sessionStorage.getItem('keco-open-document-history');
      if (!pendingDocumentId || pendingDocumentId !== document.id) return;
      window.sessionStorage.removeItem('keco-open-document-history');
      setHistoryOpen(true);
    } catch {
      window.sessionStorage.removeItem('keco-open-document-history');
    }
  }, [document.id]);

  return (
    <div className={styles.container}>
      <section
        className={[
          styles.documentSection,
          flushLayout ? styles.documentSectionFlush : '',
          historyOpen ? styles.documentSectionWithHistory : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.documentMain}>
          <span
            data-testid="document-collaboration-status"
            data-label={collaboration.label}
            hidden
          />
          <header className={styles.stickyChrome}>
            <div className={styles.header}>
              <div className={styles.topbarExportBridge} aria-hidden="true">
                <Dropdown
                  menu={{ items: exportItems, onClick: handleExport }}
                  placement="bottomRight"
                  trigger={['click']}
                >
                  <button type="button" data-testid="document-export-bridge">
                    Export bridge
                  </button>
                </Dropdown>
              </div>
            </div>
          </header>

          {collaboration.canRetry && (
            <div className={styles.connectionBanner} role="alert">
              <span title={collaboration.error ?? undefined}>
                {collaboration.label}
              </span>
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => void collaboration.retry()}
              >
                Retry
              </button>
            </div>
          )}

          {viewingHistoricalVersion && (
            <div className={styles.versionPreviewBanner} role="status" aria-live="polite">
              <span>
                Viewing version: <strong>{historicalVersionName}</strong>
              </span>
              <button
                type="button"
                className={styles.versionPreviewExit}
                onClick={() => setSelectedVersionId(null)}
              >
                Back to current
              </button>
            </div>
          )}

          <div className={styles.workspace}>
            <div className={styles.editorPane}>
              {viewingHistoricalVersion ? (
                historicalPreviewQuery.isLoading ? (
                  <div className={styles.editorPlaceholder}>Loading version…</div>
                ) : historicalPreviewQuery.error ? (
                  <div className={styles.error} role="alert">
                    {historicalPreviewQuery.error instanceof Error
                      ? historicalPreviewQuery.error.message
                      : 'Unable to load version preview.'}
                  </div>
                ) : (
                  <MdxDocumentEditor
                    key={`${document.id}:version:${selectedVersionId}`}
                    projectId={projectId}
                    documentId={document.id}
                    markdown={historicalMarkdown}
                    readOnly
                    showToolbar={false}
                    onChange={ignoreMarkdownChange}
                    imageUploadHandler={rejectHistoricalImageUpload}
                    editorRef={handleEditorRef}
                    referenceNavigationReady={referenceNavigationReady}
                  />
                )
              ) : collaboration.isLegacyView ? (
                <MdxDocumentEditor
                  key={editorKey}
                  projectId={projectId}
                  documentId={document.id}
                  markdown={document.content ?? ''}
                  readOnly
                  showToolbar={false}
                  onChange={ignoreMarkdownChange}
                  imageUploadHandler={imageUploadHandler}
                  editorRef={handleEditorRef}
                  referenceNavigationReady={referenceNavigationReady}
                />
              ) : collaboration.canBind && collaboration.session ? (
                <MdxDocumentEditor
                  key={`${document.id}:${collaboration.token.epoch}:collaborative`}
                  projectId={projectId}
                  documentId={document.id}
                  markdown=""
                  readOnly={collaboration.readOnly}
                  showToolbar={permissions.role !== 'viewer'}
                  onChange={ignoreMarkdownChange}
                  imageUploadHandler={imageUploadHandler}
                  editorRef={handleEditorRef}
                  referenceNavigationReady={referenceNavigationReady}
                  collaboration={{
                    session: collaboration.session,
                    username: permissions.userName,
                    cursorColor: collaboration.cursorColor,
                  }}
                />
              ) : hasBoundCollaboration ? (
                // Rebinding after an epoch change must not mount a second editor:
                // that remount discards the live view and restarts hydration.
                <div className={styles.editorPlaceholder}>{collaboration.label}</div>
              ) : (
                <MdxDocumentEditor
                  key={`${document.id}:pending`}
                  projectId={projectId}
                  documentId={document.id}
                  markdown={document.content ?? ''}
                  readOnly
                  showToolbar={false}
                  onChange={ignoreMarkdownChange}
                  imageUploadHandler={imageUploadHandler}
                  editorRef={handleEditorRef}
                  referenceNavigationReady={referenceNavigationReady}
                />
              )}
            </div>
          </div>
        </div>
        <DocumentVersionSidebar
          open={historyOpen}
          projectId={projectId}
          documentId={document.id}
          canMutate={permissions.role !== 'viewer'}
          session={collaboration.session}
          selectedVersionId={selectedVersionId}
          onVersionSelect={setSelectedVersionId}
          onClose={() => {
            setSelectedVersionId(null);
            setHistoryOpen(false);
          }}
        />
      </section>
    </div>
  );
}
