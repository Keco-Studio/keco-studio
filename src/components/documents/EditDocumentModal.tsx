'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  getDocument,
  updateDocumentMetadata,
} from '@/lib/services/documentService';
import { validateName } from '@/lib/utils/nameValidation';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';

type EditDocumentModalProps = {
  open: boolean;
  documentId: string;
  onClose: () => void;
  onUpdated?: () => void;
};

export function EditDocumentModal({
  open,
  documentId,
  onClose,
  onUpdated,
}: EditDocumentModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !documentId) return;
    setLoading(true);
    setError(null);
    getDocument(supabase, documentId)
      .then((doc) => {
        setName(doc.name || '');
        setDescription(doc.description || '');
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Failed to load document';
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, documentId, supabase]);

  if (!open || !mounted) return null;

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
      await updateDocumentMetadata(supabase, documentId, {
        name: trimmed,
        description,
      });
      onUpdated?.();
      onClose();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to update document';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={dialog.backdrop} data-testid="edit-document-modal">
      <div className={`${dialog.modal} ${dialog.modalTall}`}>
        <div className={dialog.header}>
          <div className={dialog.title}>Library info</div>
          <button className={dialog.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider}></div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            <div className={dialog.field}>
              <label htmlFor="document-edit-name" className={dialog.nameLabel}>
                Document Name
              </label>
              <input
                id="document-edit-name"
                className={dialog.nameInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter document name"
                disabled={submitting}
              />
            </div>

            <div className={dialog.notesContainer}>
              <label htmlFor="document-edit-description" className={dialog.notesLabel}>
                <span className={dialog.notesLabelText}>Add notes for this Document</span>
                <span className={dialog.notesLabelLimit}> (250 characters limit)</span>
              </label>
              <div className={dialog.textareaWrapper}>
                <textarea
                  id="document-edit-description"
                  name="document-edit-description"
                  className={dialog.textarea}
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= 250) {
                      setDescription(e.target.value);
                    }
                  }}
                  maxLength={250}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className={dialog.footer}>
              {error && <div className={dialog.error}>{error}</div>}
              <button
                className={`${dialog.button} ${dialog.buttonFixed} ${dialog.primary}`}
                onClick={() => void handleSubmit()}
                disabled={submitting || loading}
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
