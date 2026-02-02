/**
 * Restore Confirm Modal Component
 * 
 * Modal for confirming version restore with backup option
 * Based on Figma design with toggle for "backup the current version"
 * Format matches CreateVersionModal (centered, custom styled)
 */

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Switch } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { restoreVersion, checkVersionNameExists } from '@/lib/services/versionService';
import Image from 'next/image';
import closeIcon from '@/assets/images/closeIcon32.svg';
import styles from './RestoreConfirmModal.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface RestoreConfirmModalProps {
  open: boolean;
  version: LibraryVersion;
  libraryId: string;
  onClose: () => void;
  onSuccess: (restoredVersionId: string) => void;
}

export function RestoreConfirmModal({
  open,
  version,
  libraryId,
  onClose,
  onSuccess,
}: RestoreConfirmModalProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupVersionName, setBackupVersionName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const restoreMutation = useMutation({
    mutationFn: (data: { backupCurrent: boolean; backupVersionName?: string }) =>
      restoreVersion(supabase, {
        versionId: version.id,
        backupCurrent: data.backupCurrent,
        backupVersionName: data.backupVersionName,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      queryClient.invalidateQueries({ queryKey: ['library', libraryId] });
      setBackupEnabled(false);
      setBackupVersionName('');
      setError(null);
      // Pass the restored version ID to onSuccess callback
      onSuccess(data.restoredVersion.id);
    },
    onError: (error: any) => {
      // If error is "Name exists", show it directly
      if (error?.message === 'Name exists') {
        setError('Name exists');
      } else {
        setError(error?.message || 'Failed to restore version');
      }
    },
  });

  const handleRestore = async () => {
    if (backupEnabled && !backupVersionName.trim()) {
      setError('Version name is required when backup is enabled');
      return;
    }

    // Check if backup version name already exists
    if (backupEnabled) {
      try {
        const nameExists = await checkVersionNameExists(supabase, libraryId, backupVersionName.trim());
        if (nameExists) {
          setError('Name exists');
          return;
        }
      } catch (e: any) {
        console.error('Failed to check version name:', e);
        setError(e?.message || 'Failed to check version name');
        return;
      }
    }

    setError(null);
    restoreMutation.mutate({
      backupCurrent: backupEnabled,
      backupVersionName: backupEnabled ? backupVersionName.trim() : undefined,
    });
  };

  const handleCancel = () => {
    setBackupEnabled(false);
    setBackupVersionName('');
    setError(null);
    onClose();
  };

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Alert</div>
          <button className={styles.close} onClick={handleCancel} aria-label="Close">
            <Image src={closeIcon} alt="Close" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.message}>
            Are you sure you want to restore this version? The current version will be overridden.
          </p>
          
          <div className={styles.switchContainer}>
            <Switch
              checked={backupEnabled}
              onChange={(checked) => {
                setBackupEnabled(checked);
                setError(null);
              }}
              className={styles.switch}
              style={{
                backgroundColor: backupEnabled ? 'rgba(135, 38, 238, 1)' : undefined,
              }}
            />
            <label className={styles.switchLabel} onClick={() => {
              setBackupEnabled(!backupEnabled);
              setError(null);
            }}>
              backup the current version
            </label>
          </div>

          {backupEnabled && (
            <div className={styles.inputContainer}>
              <label htmlFor="backup-version-name" className={styles.label}>
                Version Name
              </label>
              <input
                id="backup-version-name"
                className={styles.nameInput}
                value={backupVersionName}
                onChange={(e) => {
                  setBackupVersionName(e.target.value);
                  setError(null);
                }}
                placeholder="Enter version name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRestore();
                  }
                }}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {error && <div className={styles.error}>{error}</div>}
          <button
            className={`${styles.button} ${styles.cancel}`}
            onClick={handleCancel}
            disabled={restoreMutation.isPending}
          >
            Cancel
          </button>
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={handleRestore}
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending ? 'Restoring...' : 'Restore'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

