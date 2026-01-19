'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { createVersion } from '@/lib/services/versionService';
import Image from 'next/image';
import closeIcon from '@/app/assets/images/closeIcon32.svg';
import styles from './CreateVersionModal.module.css';

interface CreateVersionModalProps {
  open: boolean;
  libraryId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateVersionModal({
  open,
  libraryId,
  onClose,
  onSuccess,
}: CreateVersionModalProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [versionName, setVersionName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open) return null;
  if (!mounted) return null;

  const handleSubmit = async () => {
    const trimmed = versionName.trim();
    if (!trimmed) {
      setError('Version name is required');
      return;
    }
    
    setSubmitting(true);
    setError(null);
    
    try {
      await createVersion(supabase, { libraryId, versionName: trimmed });
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      setVersionName('');
      onSuccess();
      onClose();
    } catch (e: any) {
      console.error('Version creation error:', e);
      setError(e?.message || 'Failed to create version');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Create new version</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} />
          </button>
        </div>

        <div className={styles.divider}></div>

        <div className={styles.nameContainer}>
          <div className={styles.nameInputContainer}>
            <label htmlFor="version-name" className={styles.nameLabel}>Version Name</label>
            <input
              id="version-name"
              className={styles.nameInput}
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="Enter version name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit();
                }
              }}
              autoFocus
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
    </div>,
    document.body
  );
}

