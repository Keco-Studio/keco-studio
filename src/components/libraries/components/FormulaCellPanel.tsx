import React from 'react';
import { Input } from 'antd';
import { createPortal } from 'react-dom';
import styles from '../LibraryAssetsTable.module.css';

type FormulaCellPanelProps = {
  open: boolean;
  position: { top: number; left: number } | null;
  value: string;
  errorMessage?: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function FormulaCellPanel({
  open,
  position,
  value,
  errorMessage,
  onChange,
  onClose,
  onSave,
}: FormulaCellPanelProps) {
  if (!open || !position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.formulaPanel}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={styles.formulaPanelHeader}>
        <div className={styles.formulaPanelTitle}>CELL FORMULA</div>
        <button
          type="button"
          className={styles.formulaPanelClose}
          onClick={onClose}
          aria-label="Close formula panel"
        >
          ×
        </button>
      </div>
      <div className={styles.formulaPanelBody}>
        <div className={styles.formulaPanelLabel}>
          Input formula<span className={styles.formulaPanelRequired}>*</span>
        </div>
        <Input.TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. ID + ID2"
          autoSize={{ minRows: 5, maxRows: 5 }}
          className={styles.formulaPanelTextarea}
          status={errorMessage ? 'error' : ''}
        />
        {errorMessage ? (
          <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#ef4444' }}>{errorMessage}</div>
        ) : null}
      </div>
      <div className={styles.formulaPanelFooter}>
        <button type="button" className={styles.formulaPanelCancel} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.formulaPanelSave}
          onClick={onSave}
        >
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}

