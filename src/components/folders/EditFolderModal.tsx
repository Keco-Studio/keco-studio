'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupabase } from '@/lib/SupabaseContext';
import { getFolder, Folder } from '@/lib/services/folderService';
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';
import { validateName } from '@/lib/utils/nameValidation';
import styles from './NewFolderModal.module.css';

type EditFolderModalProps = {
  open: boolean;
  folderId: string;
  onClose: () => void;
  onUpdated?: () => void;
};

export function EditFolderModal({ open, folderId, onClose, onUpdated }: EditFolderModalProps) {
  const supabase = useSupabase();
  const updateName = useUpdateEntityName();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Load folder data when modal opens
  useEffect(() => {
    if (open && folderId) {
      setLoading(true);
      setError(null);
      getFolder(supabase, folderId)
        .then((folder: Folder | null) => {
          if (folder) {
            setName(folder.name || '');
          } else {
            setError('Folder not found');
          }
        })
        .catch((e: any) => {
          console.error('Failed to load folder:', e);
          setError(e?.message || 'Failed to load folder');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, folderId, supabase]);

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
    
    setError(null);
    
    try {
      // Use cache mutation hook for optimistic update
      await updateName.mutateAsync({
        id: folderId,
        name: trimmed,
        entityType: 'folder'
      });
      
      // Event is dispatched automatically by the hook
      if (onUpdated) {
        onUpdated();
      }
      onClose();
    } catch (e: any) {
      console.error('Folder update error:', e);
      setError(e?.message || 'Failed to update folder');
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Edit Folder</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Folder Name</label>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter folder name"
                disabled={updateName.isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmit();
                  }
                }}
              />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.footer}>
              <button 
                className={`${styles.button} ${styles.secondary}`} 
                onClick={onClose}
                disabled={updateName.isPending}
              >
                Cancel
              </button>
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
    </div>,
    document.body
  );
}

