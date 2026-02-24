'use client';

import { createPortal } from 'react-dom';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

/** Design spec: success / error / default */
const TOAST_STYLES = {
  success: { bg: '#F0FAF3', color: '#228B22' },
  error: { bg: '#FFF0F0', color: '#FF0000' },
  default: { bg: '#F0F8FF', color: '#000000' },
} as const;

export type TableToastType = 'success' | 'error' | 'default';

type TableToastProps = {
  message: string | null;
  type?: TableToastType;
};

/**
 * Fixed toast at bottom-center, used for Copy/Paste etc. feedback.
 * Unified design: success / error / default.
 */
export function TableToast({ message, type = 'default' }: TableToastProps) {
  if (!message || typeof document === 'undefined') return null;

  const style = TOAST_STYLES[type];

  return createPortal(
    <div
      className={styles.toastMessage}
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        backgroundColor: style.bg,
        color: style.color,
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
