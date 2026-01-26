'use client';

import { createPortal } from 'react-dom';
import styles from '../LibraryAssetsTable.module.css';

type TableToastProps = {
  message: string | null;
};

/**
 * Fixed toast at bottom-center, used for Copy/Paste etc. feedback.
 * Renders via portal when message is non-null.
 */
export function TableToast({ message }: TableToastProps) {
  if (!message || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.toastMessage}
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        backgroundColor: '#111827',
        color: '#ffffff',
        padding: '12px 24px',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        fontSize: '14px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>,
    document.body
  );
}
