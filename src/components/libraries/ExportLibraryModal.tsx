'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import styles from './ExportLibraryModal.module.css';

export type ExportFormat = 'xlsx' | 'json';

type ExportLibraryModalProps = {
  open: boolean;
  libraryId: string;
  libraryName?: string;
  onClose: () => void;
  onExported?: () => void;
};

export function ExportLibraryModal({
  open,
  libraryId,
  libraryName,
  onClose,
  onExported,
}: ExportLibraryModalProps) {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [exporting, setExporting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = `/api/export?libraryId=${encodeURIComponent(libraryId)}&format=${format}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      const match = disposition?.match(/filename="?([^";]+)"?/);
      const fileName = match ? match[1].trim() : `export_${format === 'xlsx' ? 'table' : 'data'}.${format}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showSuccessToast('Export completed');
      onExported?.();
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Export failed';
      showErrorToast(message);
    } finally {
      setExporting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Export</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.divider} />
        <div className={styles.content}>
          <p className={styles.hint}>Please select a file type to export</p>
          <div className={styles.radioGroup}>
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="exportFormat"
                value="xlsx"
                checked={format === 'xlsx'}
                onChange={() => setFormat('xlsx')}
                disabled={exporting}
              />
              <span className={styles.radioLabel}>Export as .xlsx</span>
            </label>
            <label className={styles.radioOption}>
              <input
                type="radio"
                name="exportFormat"
                value="json"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
                disabled={exporting}
              />
              <span className={styles.radioLabel}>Export as .json</span>
            </label>
          </div>
        </div>
        <div className={styles.divider} />
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <>
                <span className={styles.spinner} aria-hidden />
                Exporting...
              </>
            ) : (
              'Export'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
