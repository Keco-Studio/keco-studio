'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { DocumentDropZone } from '@/components/design-upload/DocumentDropZone';
import { useSupabase } from '@/lib/SupabaseContext';
import { createImportedDocument } from '@/lib/documents/documentImportService';
import { validateDesignFile } from '@/lib/document-parser';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';

type ImportDocumentModalProps = {
  open: boolean;
  projectId: string;
  folderId?: string | null;
  onClose: () => void;
  onImported: (documentId: string) => void | Promise<void>;
};

export function ImportDocumentModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
}: ImportDocumentModalProps) {
  const supabase = useSupabase();
  const [mounted, setMounted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  const handleFileSelected = (selected: File) => {
    const validation = validateDesignFile(selected);
    if (!validation.ok) {
      setFile(null);
      setError(validation.error ?? 'Invalid file');
      return;
    }
    setFile(selected);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file || submitting) return;
    const validation = validateDesignFile(file);
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid file');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const imported = await createImportedDocument(supabase, {
        projectId,
        folderId: folderId ?? null,
        file,
      });
      await onImported(imported.document.id);
      setFile(null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to import document');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={dialog.backdrop}>
      <div className={`${dialog.modal} ${dialog.modalCompact}`} role="dialog" aria-modal="true">
        <div className={dialog.header}>
          <div className={dialog.title}>Import Document</div>
          <button className={dialog.close} onClick={onClose} aria-label="Close" disabled={submitting}>
            <Image src={closeIcon} alt="" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider} />

        <DocumentDropZone
          selectedFile={file}
          disabled={submitting}
          onFileSelected={handleFileSelected}
          onClear={() => {
            setFile(null);
            setError(null);
          }}
        />

        {error && <div className={`${dialog.error} ${dialog.errorInline}`} role="alert">{error}</div>}

        <div className={dialog.footer}>
          <button
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.secondary}`}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.primary}`}
            onClick={() => void handleSubmit()}
            disabled={!file || submitting}
          >
            {submitting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
