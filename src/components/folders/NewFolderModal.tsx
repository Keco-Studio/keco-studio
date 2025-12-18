'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { createFolder } from '@/lib/services/folderService';
import styles from './NewFolderModal.module.css';

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
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>New Folder</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Folder name *</label>
          <input
            className={styles.input}
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

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <button className={`${styles.button} ${styles.secondary}`} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`${styles.button} ${styles.primary}`}
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

