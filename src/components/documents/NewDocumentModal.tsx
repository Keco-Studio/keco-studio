'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import { createDocument } from '@/lib/services/documentService';
import { validateName } from '@/lib/utils/nameValidation';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';

type NewDocumentModalProps = {
  open: boolean;
  projectId: string;
  folderId?: string | null;
  onClose: () => void;
  onCreated: (documentId: string) => void | Promise<void>;
};

export function NewDocumentModal({ open, projectId, folderId, onClose, onCreated }: NewDocumentModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Document name is required');
      return;
    }

    const validationError = validateName(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const doc = await createDocument(supabase, {
        projectId,
        name: trimmed,
        folderId: folderId || null,
      });
      // Await so the caller can finish navigation/invalidation before we close.
      await onCreated(doc.id);
      setName('');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to create document');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={dialog.backdrop}>
      <div className={`${dialog.modal} ${dialog.modalCompact}`}>
        <div className={dialog.header}>
          <div className={dialog.title}>New Document</div>
          <button className={dialog.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider}></div>

        <div className={dialog.field}>
          <label className={dialog.nameLabel}>Document name *</label>
          <input
            className={dialog.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter document name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) {
                void handleSubmit();
              }
            }}
          />
        </div>

        {error && <div className={`${dialog.error} ${dialog.errorInline}`}>{error}</div>}

        <div className={dialog.footer}>
          <button className={`${dialog.button} ${dialog.buttonAuto} ${dialog.secondary}`} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.primary}`}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
