'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import { createFolder } from '@/lib/services/folderService';
import { validateName } from '@/lib/utils/nameValidation';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';

type NewFolderModalProps = {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (folderId: string) => void;
};

export function NewFolderModal({ open, projectId, onClose, onCreated }: NewFolderModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Folder name is required');
      return;
    }
    
    // Validate name for disallowed characters (emoji, HTML tags, special symbols)
    const validationError = validateName(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setSubmitting(true);
    setError(null);
    try {
      const folderId = await createFolder(supabase, {
        projectId,
        name: trimmed,
      });
      onCreated(folderId);
      setName('');
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to create folder');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={dialog.backdrop}>
      <div className={`${dialog.modal} ${dialog.modalCompact}`}>
        <div className={dialog.header}>
          <div className={dialog.title}>New Folder</div>
          <button className={dialog.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.divider}></div>

        <div className={dialog.field}>
          <label className={dialog.nameLabel}>Folder name *</label>
          <input
            className={dialog.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter folder name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit();
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
