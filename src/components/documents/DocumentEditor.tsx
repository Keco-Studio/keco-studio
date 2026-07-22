'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { DownloadOutlined, HistoryOutlined, LoadingOutlined } from '@ant-design/icons';
import { Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument, type DocumentRecord } from '@/lib/services/documentService';
import { uploadImageFiles } from '@/lib/services/documentImageUpload';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast } from '@/lib/utils/toast';
import { buildDesignMessage } from '@/lib/design-message';
import {
  DESIGN_UPLOAD_EVENT,
  saveDesignHandoff,
} from '@/lib/design-upload-handoff';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import { notifyDocumentDerivedLibraryCreated } from '@/lib/documents/documentDerivedLibraryEvents';
import {
  DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT,
  clearDocumentDerivedImportProgress,
  getDocumentDerivedImportProgress,
  type DocumentDerivedImportProgress,
} from '@/lib/documents/documentDerivedImportProgress';
import { ImportScriptModal } from '@/components/libraries/ImportScriptModal';
import {
  useDocumentPermissions,
  type DocumentPermissionState,
} from './useDocumentPermissions';
import { useDocumentCollaboration } from './useDocumentCollaboration';
import { DocumentVersionSidebar } from './DocumentVersionSidebar';
import type {
  MDXEditorMethods,
  MdxDocumentEditorProps,
} from './MdxDocumentEditor';
import styles from './DocumentEditor.module.css';

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
    />
  );
}

type ReadyDocumentPermissions = DocumentPermissionState & {
  role: 'admin' | 'editor' | 'viewer';
  userId: string;
  accessToken: string;
  userName: string;
};

function isDocumentExportSource(value: unknown): value is DocumentExportSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<DocumentExportSource>;
  return (
    typeof source.documentId === 'string' &&
    typeof source.documentName === 'string' &&
    typeof source.projectId === 'string' &&
    (source.folderId === null || typeof source.folderId === 'string') &&
    typeof source.markdown === 'string' &&
    typeof source.snapshotToken === 'string' &&
    typeof source.token?.epoch === 'number' &&
    typeof source.token?.revision === 'number'
  );
}

function DocumentEditorSession({
  document,
  projectId,
  permissions,
}: {
  document: DocumentRecord;
  projectId: string;
  permissions: ReadyDocumentPermissions;
}) {
  const supabase = useSupabase();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [referenceNavigationReady, setReferenceNavigationReady] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [scriptSource, setScriptSource] = useState<DocumentExportSource | null>(null);
  const [derivedImportProgress, setDerivedImportProgress] =
    useState<DocumentDerivedImportProgress | null>(() =>
      getDocumentDerivedImportProgress(projectId, document.id)
    );
  const collaboration = useDocumentCollaboration({
    supabase,
    documentId: document.id,
    projectId,
    userId: permissions.userId,
    accessToken: permissions.accessToken,
    role: permissions.role,
    userName: permissions.userName,
  });

  useEffect(() => {
    setDerivedImportProgress(getDocumentDerivedImportProgress(projectId, document.id));
  }, [document.id, projectId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DocumentDerivedImportProgress>).detail;
      if (!detail || detail.projectId !== projectId || detail.documentId !== document.id) {
        return;
      }
      setDerivedImportProgress(detail);
    };
    window.addEventListener(DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT, handler);
    return () => window.removeEventListener(DOCUMENT_DERIVED_IMPORT_PROGRESS_EVENT, handler);
  }, [document.id, projectId]);

  useEffect(() => {
    if (
      !derivedImportProgress ||
      (derivedImportProgress.phase !== 'success' && derivedImportProgress.phase !== 'error')
    ) {
      return;
    }
    const ms = derivedImportProgress.phase === 'success' ? 3500 : 8000;
    const timeout = window.setTimeout(() => {
      clearDocumentDerivedImportProgress(projectId, document.id);
      setDerivedImportProgress(null);
    }, ms);
    return () => window.clearTimeout(timeout);
  }, [derivedImportProgress, projectId, document.id]);

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
  const loadExportSource = useCallback(async (): Promise<DocumentExportSource> => {
    // Best-effort: derived exports read durable server state. A local Yjs flush
    // failure or stall must not block opening the script/table export flow.
    if (permissions.role !== 'viewer' && collaboration.session) {
      const session = collaboration.session;
      await new Promise<void>((resolve) => {
        const timeoutId = globalThis.setTimeout(resolve, 5_000);
        void Promise.resolve(session.flush()).then(
          () => {
            globalThis.clearTimeout(timeoutId);
            resolve();
          },
          () => {
            globalThis.clearTimeout(timeoutId);
            resolve();
          }
        );
      });
    }
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      throw new Error('Please sign in before exporting');
    }
    const response = await fetch(
      `/api/documents/${document.id}/export-source`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    );
    if (!response.ok) throw new Error('Document export source failed');
    const payload = await response.json() as { source?: unknown };
    if (
      !isDocumentExportSource(payload.source) ||
      payload.source.documentId !== document.id ||
      payload.source.projectId !== projectId
    ) {
      throw new Error('Document export source failed');
    }
    return payload.source;
  }, [collaboration.session, document.id, permissions.role, projectId, supabase]);
  const exportItems = [
    { key: 'docx', label: 'Download DOCX' },
    { key: 'pdf', label: 'Download PDF' },
    { key: 'mdx', label: 'Download MDX' },
    ...(permissions.role === 'admin'
      ? [
          { key: 'tables', label: 'Export as tables' },
          { key: 'script', label: 'Export as script' },
        ]
      : []),
  ];
  const handleExport = useCallback(
    async ({ key }: { key: string }) => {
      if (exportingFormat) return;
      setExportingFormat(key);
      try {
        if (key === 'tables' || key === 'script') {
          if (permissions.role !== 'admin') return;
          const source = await loadExportSource();
          if (key === 'tables') {
            const message = buildDesignMessage({
              fileName: source.documentName,
              documentText: source.markdown,
              intent: 'tables',
              documentId: source.documentId,
              sourceKind: 'project-document',
            });
            saveDesignHandoff(projectId, {
              message,
              fileName: source.documentName,
              documentId: source.documentId,
              documentExport: {
                sourceDocumentId: source.documentId,
                exportType: 'table',
                snapshotToken: source.snapshotToken,
              },
            });
            window.dispatchEvent(
              new CustomEvent(DESIGN_UPLOAD_EVENT, { detail: { projectId } })
            );
          } else {
            setScriptSource(source);
          }
          return;
        }
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
      loadExportSource,
      projectId,
      permissions.role,
      supabase,
    ]
  );
  const editorKey = `${document.id}:${collaboration.token.epoch}:${
    collaboration.isLegacyView ? 'legacy' : 'collaborative'
  }`;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{document.name}</h1>
        <div className={styles.headerActions}>
          <Dropdown
            menu={{ items: exportItems, onClick: handleExport }}
            placement="bottomRight"
            trigger={['click']}
          >
            <button
              type="button"
              className={styles.historyButton}
              aria-label={exportingFormat ? `Exporting ${exportingFormat.toUpperCase()}` : 'Export document'}
              data-testid="document-export"
              title={exportingFormat ? `Exporting ${exportingFormat.toUpperCase()}...` : 'Export document'}
              disabled={Boolean(exportingFormat)}
            >
              <DownloadOutlined aria-hidden="true" />
            </button>
          </Dropdown>
          <button
            type="button"
            className={styles.historyButton}
            aria-label="Version history"
            data-testid="version-history-toggle"
            title="Version history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <HistoryOutlined aria-hidden="true" />
          </button>
          <div className={styles.status} aria-live="polite">
            {collaboration.collaborators.length > 0 && (
              <div className={styles.collaborators} aria-label="Collaborators currently editing">
                {collaboration.collaborators.slice(0, 5).map((user) => (
                  <span
                    key={user.id}
                    className={styles.collaboratorAvatar}
                    style={{ backgroundColor: user.color }}
                    title={`${user.name} is editing`}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                ))}
                {collaboration.collaborators.length > 5 && (
                  <span className={styles.collaboratorMore}>
                    +{collaboration.collaborators.length - 5}
                  </span>
                )}
              </div>
            )}
            <span className={styles[`${collaboration.tone}Tag`]}>
              {collaboration.label}
            </span>
          </div>
        </div>
      </div>

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

      {derivedImportProgress && (
        <div
          className={
            derivedImportProgress.phase === 'error'
              ? styles.derivedImportBannerError
              : derivedImportProgress.phase === 'success'
                ? styles.derivedImportBannerSuccess
                : styles.derivedImportBanner
          }
          role="status"
          aria-live="polite"
          data-testid="document-derived-import-progress"
        >
          <span className={styles.derivedImportLabel}>{derivedImportProgress.label}</span>
          {(derivedImportProgress.phase === 'preparing' ||
            derivedImportProgress.phase === 'running') && (
            <LoadingOutlined className={styles.derivedImportSpinner} spin />
          )}
        </div>
      )}

      <div className={`${styles.workspace} ${historyOpen ? styles.workspaceWithHistory : ''}`}>
        <div className={styles.editorPane}>
          {collaboration.isLegacyView ? (
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
          ) : (
            <div className={styles.editorPlaceholder}>{collaboration.label}</div>
          )}
        </div>
        <DocumentVersionSidebar
          open={historyOpen}
          projectId={projectId}
          documentId={document.id}
          canMutate={permissions.role !== 'viewer'}
          session={collaboration.session}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
      <ImportScriptModal
        open={Boolean(scriptSource)}
        projectId={projectId}
        folderId={scriptSource?.folderId ?? null}
        documentSource={scriptSource ?? undefined}
        onClose={() => setScriptSource(null)}
        onImported={(libraryId) => {
          if (scriptSource) {
            notifyDocumentDerivedLibraryCreated({
              projectId,
              documentId: scriptSource.documentId,
              libraryId,
            });
          }
          setScriptSource(null);
        }}
      />
    </div>
  );
}
