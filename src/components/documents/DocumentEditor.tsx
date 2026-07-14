'use client';

import { useCallback } from 'react';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { HistoryOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument, type DocumentRecord } from '@/lib/services/documentService';
import { uploadImageFiles } from '@/lib/services/documentImageUpload';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  useDocumentPermissions,
  type DocumentPermissionState,
} from './useDocumentPermissions';
import { useDocumentCollaboration } from './useDocumentCollaboration';
import { DocumentVersionSidebar } from './DocumentVersionSidebar';
import type { MdxDocumentEditorProps } from './MdxDocumentEditor';
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
  const editorKey = `${document.id}:${collaboration.token.epoch}:${
    collaboration.isLegacyView ? 'legacy' : 'collaborative'
  }`;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{document.name}</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.historyButton}
            aria-label="Version history"
            title="Version history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <HistoryOutlined aria-hidden="true" />
          </button>
          <div className={styles.status} aria-live="polite">
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
              markdown={document.content ?? ''}
              readOnly
              showToolbar={false}
              onChange={ignoreMarkdownChange}
              imageUploadHandler={imageUploadHandler}
            />
          ) : collaboration.canBind && collaboration.session ? (
            <MdxDocumentEditor
              key={`${document.id}:${collaboration.token.epoch}:collaborative`}
              markdown=""
              readOnly={collaboration.readOnly}
              showToolbar={permissions.role !== 'viewer'}
              onChange={ignoreMarkdownChange}
              imageUploadHandler={imageUploadHandler}
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
