/**
 * Delete Confirm Modal Component
 * 
 * Modal for confirming version deletion
 */

'use client';

import { Modal } from 'antd';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { deleteVersion } from '@/lib/services/versionService';
import styles from './DeleteConfirmModal.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface DeleteConfirmModalProps {
  open: boolean;
  version: LibraryVersion;
  libraryId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function DeleteConfirmModalContent({
  open,
  version,
  libraryId,
  onClose,
  onSuccess,
}: DeleteConfirmModalProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const deleteVersionMutation = useMutation({
    mutationFn: () => deleteVersion(supabase, version.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
      showSuccessToast('Version deleted successfully');
      onSuccess();
    },
    onError: (error: any) => {
      showErrorToast(error?.message || 'Failed to delete version');
    },
  });

  const handleDelete = () => {
    deleteVersionMutation.mutate();
  };

  return (
    <Modal
      title="Delete version"
      open={open}
      onOk={handleDelete}
      onCancel={onClose}
      confirmLoading={deleteVersionMutation.isPending}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
    >
      <p>Are you sure you want to delete this version?</p>
    </Modal>
  );
}

export function DeleteConfirmModal(props: DeleteConfirmModalProps) {
  return <DeleteConfirmModalContent {...props} />;
}

