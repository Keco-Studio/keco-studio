/**
 * Edit Version Modal Component
 * 
 * Modal for editing version name
 * Format matches CreateVersionModal (centered, custom styled)
 */

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { editVersion } from '@/lib/services/versionService';
import { validateName } from '@/lib/utils/nameValidation';
import Image from 'next/image';
import closeIcon from '@/assets/images/closeIcon32.svg';
import styles from './EditVersionModal.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface EditVersionModalProps {
  open: boolean;
  version: LibraryVersion;
  libraryId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditVersionModal({
  open,
  version,
  libraryId,
  onClose,
  onSuccess,
}: EditVersionModalProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [versionName, setVersionName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open && version) {
      setVersionName(version.versionName);
      setError(null);
    }
  }, [open, version]);

  const editVersionMutation = useMutation({
    mutationFn: (name: string) => editVersion(supabase, { versionId: version.id, versionName: name }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      await queryClient.refetchQueries({ queryKey: ['versions', libraryId] });
      setVersionName('');
      setError(null);
      onSuccess();
      onClose();
    },
    onError: (error: any) => {
      setError(error?.message || 'Failed to update version name');
    },
  });

  const handleSave = () => {
    const trimmed = versionName.trim();
    if (!trimmed) {
      setError('Version name is required');
      return;
    }
    
    // Validate name for disallowed characters (emoji, HTML tags, special symbols, URLs)
    const validationError = validateName(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setError(null);
    editVersionMutation.mutate(trimmed);
  };

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Edit version</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={styles.nameContainer}>
          <div className={styles.nameInputContainer}>
            <label htmlFor="version-name" className={styles.nameLabel}>Version Name</label>
            <input
              id="version-name"
              className={styles.nameInput}
              value={versionName}
              onChange={(e) => {
                setVersionName(e.target.value);
                setError(null);
              }}
              placeholder="Enter version name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
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
            onClick={handleSave}
            disabled={editVersionMutation.isPending}
          >
            {editVersionMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

