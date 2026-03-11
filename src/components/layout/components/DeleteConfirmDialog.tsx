'use client';

import { Modal } from 'antd';
import styles from '@/components/version-control/DeleteConfirmModal.module.css';

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  content: string;
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  content,
  confirmLoading = false,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <Modal
      title={title}
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
      zIndex={12000}
    >
      <p>{content}</p>
    </Modal>
  );
}

