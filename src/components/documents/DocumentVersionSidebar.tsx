'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Spin } from 'antd';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  deleteDocumentVersion,
  listDocumentVersions,
  type DocumentVersionSummary,
} from '@/lib/documents/documentVersionService';
import type { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import { queryKeys } from '@/lib/utils/queryKeys';
import { subscribeToProjectDocumentUpdates } from '@/lib/documents/projectDocumentChannel';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { CreateDocumentVersionModal } from './CreateDocumentVersionModal';
import { RestoreDocumentVersionModal } from './RestoreDocumentVersionModal';
import {
  DocumentVersionItem,
  type DocumentVersionListEntry,
} from './DocumentVersionItem';
import libraryAssetTableAddIcon from '@/assets/images/LibraryAssetTableAddIcon.svg';
import closeIcon from '@/assets/images/VersionBoardClose.svg';
import styles from './DocumentVersionSidebar.module.css';

type DocumentVersionSidebarProps = {
  open: boolean;
  projectId: string;
  documentId: string;
  canMutate: boolean;
  session: DocumentCollaborationSession | null;
  selectedVersionId: string | null;
  onVersionSelect: (versionId: string | null) => void;
  onClose: () => void;
};

function canDeleteVersion(type: DocumentVersionSummary['type']): boolean {
  return type === 'manual' || type === 'automatic';
}

export function DocumentVersionSidebar({
  open,
  projectId,
  documentId,
  canMutate,
  session,
  selectedVersionId,
  onVersionSelect,
  onClose,
}: DocumentVersionSidebarProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState<DocumentVersionSummary | null>(
    null
  );
  const versionsQuery = useQuery({
    queryKey: queryKeys.documentVersions(documentId),
    queryFn: () => listDocumentVersions(supabase, documentId),
    enabled: open,
    staleTime: 0,
  });
  const deleteMutation = useMutation({
    mutationFn: (versionId: string) =>
      deleteDocumentVersion(supabase, documentId, versionId),
    onSuccess: (_data, versionId) => {
      if (selectedVersionId === versionId) onVersionSelect(null);
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

  const entries = useMemo((): DocumentVersionListEntry[] => {
    const history = [...(versionsQuery.data ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return [{ kind: 'current' }, ...history.map((version) => ({ kind: 'history' as const, version }))];
  }, [versionsQuery.data]);

  if (!open) return null;

  return (
    <aside className={styles.sidebar} aria-label="Version history">
      <div className={styles.header}>
        <h2 className={styles.title}>Version History</h2>
        <div className={styles.headerActions}>
          {canMutate && (
            <button
              type="button"
              className={styles.addButton}
              aria-label="Create version"
              title="Create version"
              disabled={!session}
              onClick={() => setCreateOpen(true)}
            >
              <Image
                src={libraryAssetTableAddIcon}
                alt=""
                width={24}
                height={24}
                className="icon-24"
              />
            </button>
          )}
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close version history"
            title="Close"
          >
            <Image src={closeIcon} alt="" width={24} height={24} className="icon-24" />
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {versionsQuery.isLoading && (
          <div className={styles.loading}>
            <Spin aria-label="Loading versions" />
          </div>
        )}
        {versionsQuery.error && (
          <div className={styles.error} role="alert">
            Unable to load version history.
          </div>
        )}
        {!versionsQuery.isLoading && !versionsQuery.error && (
          <div className={styles.versionList}>
            {entries.map((entry, index) => {
              const isCurrent = entry.kind === 'current';
              const versionId = isCurrent ? null : entry.version.id;
              const isSelected = isCurrent
                ? selectedVersionId === null
                : selectedVersionId === versionId;
              return (
                <DocumentVersionItem
                  key={isCurrent ? '__current__' : entry.version.id}
                  entry={entry}
                  isFirst={index === 0}
                  isLast={index === entries.length - 1}
                  isSelected={isSelected}
                  canMutate={canMutate}
                  canDelete={
                    entry.kind === 'history' &&
                    canDeleteVersion(entry.version.type)
                  }
                  onSelect={onVersionSelect}
                  onRestore={setRestoreVersion}
                  onDelete={confirmDelete}
                />
              );
            })}
          </div>
        )}
      </div>

      <CreateDocumentVersionModal
        open={createOpen}
        documentId={documentId}
        session={session}
        onClose={() => setCreateOpen(false)}
        onCreated={() =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.documentVersions(documentId),
          })
        }
      />
      <RestoreDocumentVersionModal
        open={Boolean(restoreVersion)}
        version={restoreVersion}
        session={session}
        onClose={() => setRestoreVersion(null)}
        onRestored={() => {
          onVersionSelect(null);
          void queryClient.invalidateQueries({
            queryKey: queryKeys.documentVersions(documentId),
          });
        }}
      />
    </aside>
  );
}
