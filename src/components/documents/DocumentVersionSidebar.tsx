'use client';

import { useEffect, useState } from 'react';
import { Button, Empty, Modal, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  deleteDocumentVersion,
  getDocumentVersionPreview,
  listDocumentVersions,
  type DocumentVersionPreview,
  type DocumentVersionSummary,
} from '@/lib/documents/documentVersionService';
import type { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import { queryKeys } from '@/lib/utils/queryKeys';
import { subscribeToProjectDocumentUpdates } from '@/lib/documents/projectDocumentChannel';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { CreateDocumentVersionModal } from './CreateDocumentVersionModal';
import { DocumentVersionPreviewModal } from './DocumentVersionPreviewModal';
import { RestoreDocumentVersionModal } from './RestoreDocumentVersionModal';
import styles from './DocumentVersionSidebar.module.css';

type DocumentVersionSidebarProps = {
  open: boolean;
  projectId: string;
  documentId: string;
  canMutate: boolean;
  session: DocumentCollaborationSession | null;
  onClose: () => void;
};

function versionTypeLabel(type: DocumentVersionSummary['type']): string {
  return type === 'manual'
    ? 'Manual'
    : type === 'automatic'
      ? 'Automatic'
      : type === 'pre_restore'
        ? 'Before restore'
        : type === 'restore'
          ? 'Restore'
          : type;
}

function canDeleteVersion(type: DocumentVersionSummary['type']): boolean {
  return type === 'manual' || type === 'automatic';
}

export function DocumentVersionSidebar({
  open,
  projectId,
  documentId,
  canMutate,
  session,
  onClose,
}: DocumentVersionSidebarProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<DocumentVersionSummary | null>(null);
  const versionsQuery = useQuery({
    queryKey: queryKeys.documentVersions(documentId),
    queryFn: () => listDocumentVersions(supabase, documentId),
    enabled: open,
    staleTime: 0,
  });
  const previewQuery = useQuery({
    queryKey: queryKeys.documentVersion(documentId, previewId ?? ''),
    queryFn: () => getDocumentVersionPreview(supabase, documentId, previewId!),
    enabled: open && Boolean(previewId),
  });
  const deleteMutation = useMutation({
    mutationFn: (versionId: string) =>
      deleteDocumentVersion(supabase, documentId, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documentVersions(documentId),
      });
      showSuccessToast('Version deleted');
    },
    onError: (error: Error) => {
      showErrorToast(error.message || 'Unable to delete version');
    },
  });

  const confirmDelete = (version: DocumentVersionSummary) => {
    Modal.confirm({
      title: 'Delete version',
      content: `Delete "${version.name}"? This action cannot be undone.`,
      okText: 'Delete',
      cancelText: 'Cancel',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutateAsync(version.id),
    });
  };

  useEffect(() => {
    return subscribeToProjectDocumentUpdates((payload) => {
      if (payload.projectId === projectId && payload.documentId === documentId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.documentVersions(documentId),
        });
      }
    });
  }, [documentId, projectId, queryClient]);

  if (!open) return null;
  return (
    <aside className={styles.sidebar} aria-label="Version history">
      <div className={styles.header}>
        <h2>Version history</h2>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close version history">
          ×
        </button>
      </div>
      {canMutate && (
          <Button type="primary" block onClick={() => setCreateOpen(true)} disabled={!session}>
            Create version
          </Button>
      )}
      {versionsQuery.isLoading && <Spin aria-label="Loading versions" />}
      {versionsQuery.error && <div role="alert">Unable to load version history.</div>}
      {!versionsQuery.isLoading && !versionsQuery.error && versionsQuery.data?.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved versions" />
      )}
      <div className={styles.list}>
        {versionsQuery.data?.map((version) => (
          <div className={styles.row} key={version.id} data-testid={`document-version-row-${version.id}`}>
            <div className={styles.rowDetails}>
              <strong>{version.name}</strong>
              <span>{versionTypeLabel(version.type)}</span>
              <span>{version.createdByName ?? 'Unknown collaborator'} · {new Date(version.createdAt).toLocaleString()}</span>
            </div>
            <div className={styles.actions}>
              <Button type="link" size="small" onClick={() => setPreviewId(version.id)}>
                Preview
              </Button>
              {canMutate && (
                <Button type="link" danger size="small" data-testid={`restore-version-${version.id}`} onClick={() => setRestoreVersion(version)}>
                  Restore
                </Button>
              )}
              {canMutate && canDeleteVersion(version.type) && (
                <Button
                  type="link"
                  danger
                  size="small"
                  loading={deleteMutation.isPending && deleteMutation.variables === version.id}
                  data-testid={`delete-version-${version.id}`}
                  onClick={() => confirmDelete(version)}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <CreateDocumentVersionModal
        open={createOpen}
        documentId={documentId}
        session={session}
        onClose={() => setCreateOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: queryKeys.documentVersions(documentId) })}
      />
      <DocumentVersionPreviewModal
        open={Boolean(previewId)}
        loading={previewQuery.isLoading}
        error={previewQuery.error instanceof Error ? previewQuery.error : null}
        version={(previewQuery.data as DocumentVersionPreview | undefined) ?? null}
        onClose={() => setPreviewId(null)}
      />
      <RestoreDocumentVersionModal
        open={Boolean(restoreVersion)}
        version={restoreVersion}
        session={session}
        onClose={() => setRestoreVersion(null)}
        onRestored={() => queryClient.invalidateQueries({ queryKey: queryKeys.documentVersions(documentId) })}
      />
    </aside>
  );
}
