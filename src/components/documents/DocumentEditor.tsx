'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { DownloadOutlined, HistoryOutlined } from '@ant-design/icons';
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
  const collaboration = useDocumentCollaboration({
    supabase,
    documentId: document.id,
    projectId,
    userId: permissions.userId,
    accessToken: permissions.accessToken,
    role: permissions.role,
    userName: permissions.userName,
  });

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
  const exportItems = [
    { key: 'docx', label: 'Download DOCX' },
    { key: 'pdf', label: 'Download PDF' },
  ];
  const handleExport = useCallback(
    async ({ key }: { key: string }) => {
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
        URL.revokeObjectURL(url);
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : 'Document export failed');
      }
    },
    [
      collaboration.session,
      document.id,
      document.name,
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
              aria-label="Export document"
              data-testid="document-export"
              title="Export document"
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
    </div>
  );
}
