'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSupabase } from '@/lib/SupabaseContext';
import { getDocument } from '@/lib/services/documentService';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';
import { writeScriptProjectPreference } from '@/lib/script-system/projectPreference';
import { showErrorToast } from '@/lib/utils/toast';
import { SelectDocumentModal } from './SelectDocumentModal';
import styles from './ImportDocumentationView.module.css';

const HELPER_COPY =
  'Choose a Studio document to add to Keco Script. After import you can edit it, then use Generate conversation to create a dialogue script and flow chart.';

export type ImportDocumentationViewProps = {
  projectId: string;
  projectName?: string;
};

type SelectedDocument = {
  id: string;
  name: string;
};

export function ImportDocumentationView({
  projectId,
  projectName = 'Project',
}: ImportDocumentationViewProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedDocument | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ['script-import-preview', selected?.id],
    queryFn: () => getDocument(supabase, selected!.id),
    enabled: Boolean(selected?.id),
    staleTime: 30_000,
  });

  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [projectId]);

  const handleImport = async () => {
    if (!selected || importing) return;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/script-workspace/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: selected.id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Failed to import documentation');
      }
      const membershipKey = ['script-workspace', projectId] as const;
      await queryClient.invalidateQueries({ queryKey: membershipKey });
      await queryClient.refetchQueries({ queryKey: membershipKey });
      writeScriptProjectPreference({ projectId, projectName });
      router.push(`/script-system/${projectId}/doc/${selected.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to import documentation';
      setError(message);
      showErrorToast(message);
    } finally {
      setImporting(false);
    }
  };

  const previewMarkdown = useMemo(() => {
    const raw = previewQuery.data?.content?.trim() ?? '';
    return raw ? toScriptImportPlainText(raw) : '';
  }, [previewQuery.data?.content]);
  const previewTitle = selected?.name ?? previewQuery.data?.name;

  return (
    <div className={styles.root}>
      <header className={styles.heading}>
        <h1>Import Documentation</h1>
        <p>{HELPER_COPY}</p>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-label="Select form">
          <span className={styles.cardLabel}>Select form</span>
          <button
            type="button"
            className={styles.selectTrigger}
            onClick={() => setModalOpen(true)}
          >
            <span
              className={selected ? undefined : styles.selectPlaceholder}
            >
              {selected?.name ?? 'Choose a Studio document'}
            </span>
            <span aria-hidden>▾</span>
          </button>
          <button
            type="button"
            className={styles.importButton}
            disabled={!selected || importing}
            onClick={() => void handleImport()}
          >
            {importing ? 'Importing…' : 'Import documentation'}
          </button>
          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        <section
          className={`${styles.card} ${styles.preview}`}
          aria-label="Studio source documentation preview"
        >
          <span className={styles.cardLabel}>STUDIO SOURCE DOCUMENTATION</span>
          {selected ? (
            <>
              <h2 className={styles.previewTitle}>{previewTitle}</h2>
              <div className={styles.previewBody}>
                {previewQuery.isLoading ? (
                  'Loading preview…'
                ) : previewQuery.isError ? (
                  'Preview unavailable'
                ) : previewMarkdown ? (
                  <div className={styles.previewMarkdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {previewMarkdown}
                    </ReactMarkdown>
                  </div>
                ) : (
                  'This document has no content yet.'
                )}
              </div>
            </>
          ) : (
            <div className={`${styles.previewBody} ${styles.previewEmpty}`}>
              Select a Studio document to preview its content here.
            </div>
          )}
        </section>
      </div>

      <SelectDocumentModal
        open={modalOpen}
        projectId={projectId}
        selectedDocumentId={selected?.id ?? null}
        onClose={() => setModalOpen(false)}
        onSelect={(document) => setSelected(document)}
      />
    </div>
  );
}
