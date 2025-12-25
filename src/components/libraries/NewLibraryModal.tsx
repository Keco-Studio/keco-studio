'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { createLibrary, checkLibraryNameExists } from '@/lib/services/libraryService';
import Image from 'next/image';
import closeIcon from '@/app/assets/images/closeIcon32.svg';
import styles from './NewLibraryModal.module.css';

type NewLibraryModalProps = {
  open: boolean;
  projectId: string;
  folderId?: string | null;
  onClose: () => void;
  onCreated: (libraryId: string) => void;
};

export function NewLibraryModal({ open, projectId, folderId, onClose, onCreated }: NewLibraryModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Library name is required');
      return;
    }
    
    setSubmitting(true);
    setError(null);
    
    try {
      // Check if library name already exists before attempting to create
      const exists = await checkLibraryNameExists(supabase, projectId, trimmed, folderId || null);
      if (exists) {
        setError(`Library name ${trimmed} already exists`);
        setSubmitting(false);
        return;
      }

      // If name doesn't exist, proceed with creation
      const libraryId = await createLibrary(supabase, {
        projectId,
        name: trimmed,
        description,
        folderId: folderId || undefined,
      });
      onCreated(libraryId);
      setName('');
      setDescription('');
      onClose();
    } catch (e: any) {
      console.error('Library creation error:', e);
      setError(e?.message || 'Failed to create library');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Create Library</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} />
          </button>
        </div>

        <div className={styles.divider}></div>

        <div className={styles.nameContainer}>
          <div className={styles.nameInputContainer}>
            <label htmlFor="library-name" className={styles.nameLabel}>Library Name</label>
            <input
              id="library-name"
              className={styles.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter library name"
            />
          </div>
        </div>

        <div className={styles.notesContainer}>
          <label htmlFor="library-description" className={styles.notesLabel}>
            <span className={styles.notesLabelText}>Add notes for this Library</span>
            <span className={styles.notesLabelLimit}> (250 characters limit)</span>
          </label>
          <div className={styles.textareaWrapper}>
            <textarea
              id="library-description"
              name="library-description"
              className={styles.textarea}
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= 250) {
                  setDescription(e.target.value);
                }
              }}
              maxLength={250}
            />
          </div>
        </div>

        <div className={styles.footer}>
          {error && <div className={styles.error}>{error}</div>}
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

