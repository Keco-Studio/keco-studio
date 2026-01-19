/**
 * Edit Version Modal Component
 * 
 * Modal for editing version name
 */

'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { editVersion } from '@/lib/services/versionService';
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

  useEffect(() => {
    if (open && version) {
      setVersionName(version.versionName);
    }
  }, [open, version]);

  const editVersionMutation = useMutation({
    mutationFn: (name: string) => editVersion(supabase, { versionId: version.id, versionName: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      message.success('Version name updated successfully');
      onSuccess();
    },
    onError: (error: any) => {
      message.error(error?.message || 'Failed to update version name');
    },
  });

  const handleSave = () => {
    if (!versionName.trim()) {
      message.error('Version name is required');
      return;
    }
    editVersionMutation.mutate(versionName.trim());
  };

  const handleCancel = () => {
    setVersionName(version?.versionName || '');
    onClose();
  };

  return (
    <Modal
      title="Edit version info"
      open={open}
      onOk={handleSave}
      onCancel={handleCancel}
      confirmLoading={editVersionMutation.isPending}
      okText="Save"
      cancelText="Cancel"
    >
      <div className={styles.form}>
        <label className={styles.label}>
          Version Name
          <Input
            value={versionName}
            onChange={(e) => setVersionName(e.target.value)}
            placeholder="Enter version name"
            onPressEnter={handleSave}
            autoFocus
          />
        </label>
      </div>
    </Modal>
  );
}

