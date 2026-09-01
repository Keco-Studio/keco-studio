'use client';

import { createPortal } from 'react-dom';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type BatchEditMenuProps = {
  visible: boolean;
  position: { x: number; y: number };
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onClearContents: () => void;
  onDeleteRow: () => void;
};

const hoverBg = (el: HTMLElement, bg: string) => {
  el.style.backgroundColor = bg;
};
const hoverReset = (el: HTMLElement) => {
  el.style.backgroundColor = 'transparent';
};

export function BatchEditMenu({
  visible,
  position,
  userRole,
  onCut,
  onCopy,
  onPaste,
  onInsertRowAbove,
  onInsertRowBelow,
  onClearContents,
  onDeleteRow,
}: BatchEditMenuProps) {
  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="batchEditMenu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
        backgroundColor: '#ffffff',
        border: 'none',
        borderRadius: '0.5rem',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        padding: '0.25rem 0',
        minWidth: '180px',
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.batchEditMenuTitle}>actions</div>

      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          try { onCut(); } catch (err) { console.error('Error in handleCut:', err); }
        }}
      >
        <span className={styles.batchEditMenuText}>Cut</span>
      </div>
      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={onCopy}
      >
        <span className={styles.batchEditMenuText}>Copy</span>
      </div>
      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={onPaste}
      >
        <span className={styles.batchEditMenuText}>Paste</span>
      </div>

      <div className={styles.batchEditMenuDivider} />

      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={onInsertRowAbove}
      >
        <span className={styles.batchEditMenuText}>Insert row above</span>
      </div>
      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={onInsertRowBelow}
      >
        <span className={styles.batchEditMenuText}>Insert row below</span>
      </div>
      <div
        className={styles.batchEditMenuItem}
        onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
        onMouseLeave={(e) => hoverReset(e.currentTarget)}
        onClick={onClearContents}
      >
        <span className={styles.batchEditMenuText}>Clear contents</span>
      </div>

      <div className={styles.batchEditMenuDivider} />

      {userRole !== 'viewer' && (
        <div
          className={styles.batchEditMenuItem}
          style={{ color: '#AA052C' }}
          onMouseEnter={(e) => hoverBg(e.currentTarget, 'var(--keco-blue-tint-soft)')}
          onMouseLeave={(e) => hoverReset(e.currentTarget)}
          onClick={onDeleteRow}
        >
          <span className={styles.batchEditMenuText} style={{ color: '#AA052C' }}>Delete row</span>
        </div>
      )}
    </div>,
    document.body
  );
}
