'use client';

import { createPortal } from 'react-dom';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

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
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.confirmOverlay}>
      <div
        className={styles.confirmDialog}
        style={{ height: '15.5rem' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-description"
      >
        <div className={styles.confirmHeader}>
          <h3 id="delete-confirm-title" className={styles.confirmTitle}>
            {title || 'Alert'}
          </h3>
          <button
            type="button"
            className={styles.confirmCloseBtn}
            aria-label="Close"
            onClick={onCancel}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div id="delete-confirm-description" className={styles.confirmBody}>
          {content}
        </div>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.confirmCancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmDiscardBtn}
            onClick={onConfirm}
            disabled={confirmLoading}
          >
            {confirmLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

