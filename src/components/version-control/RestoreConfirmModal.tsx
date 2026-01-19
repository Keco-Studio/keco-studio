/**
 * Restore Confirm Modal Component
 * 
 * Modal for confirming version restore with backup option
 * Based on Figma design with toggle for "backup the current version"
 */

'use client';

import { useState } from 'react';
import { Modal, Input, Switch, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { restoreVersion } from '@/lib/services/versionService';
import styles from './RestoreConfirmModal.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface RestoreConfirmModalProps {
  open: boolean;
  version: LibraryVersion;
  libraryId: string;
  onClose: () => void;
  onSuccess: () => void;
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

  const restoreMutation = useMutation({
    mutationFn: (data: { backupCurrent: boolean; backupVersionName?: string }) =>
      restoreVersion(supabase, {
        versionId: version.id,
        backupCurrent: data.backupCurrent,
        backupVersionName: data.backupVersionName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      queryClient.invalidateQueries({ queryKey: ['library', libraryId] });
      message.success('Library restored');
      setBackupEnabled(false);
      setBackupVersionName('');
      onSuccess();
    },
    onError: (error: any) => {
      message.error(error?.message || 'Failed to restore version');
    },
  });

  const handleRestore = () => {
    if (backupEnabled && !backupVersionName.trim()) {
      message.error('Version name is required when backup is enabled');
      return;
    }
    restoreMutation.mutate({
      backupCurrent: backupEnabled,
      backupVersionName: backupEnabled ? backupVersionName.trim() : undefined,
    });
  };

  const handleCancel = () => {
    setBackupEnabled(false);
    setBackupVersionName('');
    onClose();
  };

  return (
    <Modal
      title="Alert"
      open={open}
      onOk={handleRestore}
      onCancel={handleCancel}
      confirmLoading={restoreMutation.isPending}
      okText="Restore"
      cancelText="Cancel"
      okButtonProps={{ style: { backgroundColor: '#FF6CAA', borderColor: '#FF6CAA' } }}
    >
      <div className={styles.content}>
        <p className={styles.message}>
          Are you sure you want to restore this version? the current version will be override.
        </p>
        
        <div className={styles.switchContainer}>
          <Switch
            checked={backupEnabled}
            onChange={setBackupEnabled}
            className={styles.switch}
          />
          <label className={styles.switchLabel}>backup the current version</label>
        </div>

        {backupEnabled && (
          <div className={styles.inputContainer}>
            <label className={styles.label}>
              Version Name
              <Input
                value={backupVersionName}
                onChange={(e) => setBackupVersionName(e.target.value)}
                placeholder="Enter version name"
                onPressEnter={handleRestore}
                autoFocus
              />
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

