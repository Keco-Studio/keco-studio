'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';
import { validateName } from '@/lib/utils/nameValidation';
import Image from 'next/image';
import closeIcon from '@/assets/images/closeIcon32.svg';
import styles from './NewLibraryModal.module.css';

type EditLibraryModalProps = {
  open: boolean;
  libraryId: string;
  onClose: () => void;
  onUpdated?: () => void;
};

export function EditLibraryModal({ open, libraryId, onClose, onUpdated }: EditLibraryModalProps) {
  const supabase = useSupabase();
  const updateName = useUpdateEntityName();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Load library data when modal opens
  useEffect(() => {
    if (open && libraryId) {
      setLoading(true);
      setError(null);
      getLibrary(supabase, libraryId)
        .then((library: Library | null) => {
          if (library) {
            setName(library.name || '');
            setDescription(library.description || '');
          } else {
            setError('Library not found');
          }
        })
        .catch((e: any) => {
          console.error('Failed to load library:', e);
          setError(e?.message || 'Failed to load library');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, libraryId, supabase]);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Library name is required');
      return;
    }
    
    // Validate name for disallowed characters (emoji, HTML tags, special symbols)
    const validationError = validateName(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setError(null);
    
    try {
      // Use cache mutation hook for optimistic update
      await updateName.mutateAsync({
        id: libraryId,
        name: trimmed,
        description,
        entityType: 'library'
      });
      
      // Event is dispatched automatically by the hook
      if (onUpdated) {
        onUpdated();
      }
      onClose();
    } catch (e: any) {
      console.error('Library update error:', e);
      setError(e?.message || 'Failed to update library');
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Edit Library</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} />
          </button>
        </div>

        <div className={styles.divider}></div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            <div className={styles.nameContainer}>
              <div className={styles.nameInputContainer}>
                <label htmlFor="library-name" className={styles.nameLabel}>Library Name</label>
                <input
                  id="library-name"
                  className={styles.nameInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter library name"
                  disabled={updateName.isPending}
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
                  disabled={updateName.isPending}
                />
              </div>
            </div>

            <div className={styles.footer}>
              {error && <div className={styles.error}>{error}</div>}
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={handleSubmit}
                disabled={updateName.isPending || loading}
              >
                {updateName.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  , document.body);
}

