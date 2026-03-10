'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { getLibrary, Library, duplicateLibrary } from '@/lib/services/libraryService';
import { validateName } from '@/lib/utils/nameValidation';
import { Switch } from 'antd';
import styles from './DuplicateLibraryModal.module.css';

type DuplicateLibraryModalProps = {
  open: boolean;
  libraryId: string;
  onClose: () => void;
  onDuplicated?: (newLibraryId: string) => void;
};

export function DuplicateLibraryModal({ open, libraryId, onClose, onDuplicated }: DuplicateLibraryModalProps) {
  const supabase = useSupabase();
  const [originalName, setOriginalName] = useState('');
  const [name, setName] = useState('');
  const [copyHeaderOnly, setCopyHeaderOnly] = useState(true);
  const [hasUserEditedName, setHasUserEditedName] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Load original library data when modal opens
  useEffect(() => {
    if (open && libraryId) {
      setCopyHeaderOnly(true);
      setHasUserEditedName(false);
      setLoading(true);
      setError(null);
      getLibrary(supabase, libraryId)
        .then((library: Library | null) => {
          if (library) {
            setOriginalName(library.name || '');
            setName(`${library.name || ''} (Copy headers)`);
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

  useEffect(() => {
    if (originalName) {
      if (!hasUserEditedName) {
        if (copyHeaderOnly) {
          setName(`${originalName} (Copy headers)`);
        } else {
          setName(`${originalName} (Copy)`);
        }
      }
    }
  }, [copyHeaderOnly, originalName, hasUserEditedName]);

  // Clear error when user interacts with inputs
  useEffect(() => {
    if (error) setError(null);
  }, [name, copyHeaderOnly]);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Library name is required');
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
      const newLibraryId = await duplicateLibrary(supabase, libraryId, trimmed, copyHeaderOnly);
      if (onDuplicated) {
        onDuplicated(newLibraryId);
      }
      onClose();
    } catch (e: any) {
      console.error('Library duplication error:', e);
      setError(e?.message || 'Failed to duplicate library');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Duplicate Library</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            <div className={styles.content}>
              <div className={styles.confirmationText}>
                Are you sure you want to duplicate this library?
              </div>

              <div className={styles.switchRow}>
                <Switch 
                  checked={copyHeaderOnly} 
                  onChange={setCopyHeaderOnly} 
                  disabled={submitting} 
                />
                <span>Copy headers only.</span>
              </div>

              <div className={styles.nameContainer}>
                <label htmlFor="duplicate-library-name" className={styles.nameLabel}>New library name</label>
                <input
                  id="duplicate-library-name"
                  className={styles.nameInput}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setHasUserEditedName(true);
                  }}
                  placeholder="Enter new library name"
                  disabled={submitting}
                />
              </div>
            </div>

            <div className={styles.divider}></div>

            <div className={styles.footer}>
              {error && <div className={styles.error}>{error}</div>}
              <button
                className={styles.cancelButton}
                onClick={onClose}
                disabled={submitting || loading}
              >
                Cancel
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={handleSubmit}
                disabled={submitting || loading}
              >
                {submitting ? 'Duplicating...' : 'Duplicate'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  , document.body);
}
