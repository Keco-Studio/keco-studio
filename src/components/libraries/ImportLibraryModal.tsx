'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateName } from '@/lib/utils/nameValidation';
import { previewWorkbookFile } from '@/lib/utils/workbook';
import styles from './ExportLibraryModal.module.css';

type ImportLibraryModalProps = {
  open: boolean;
  projectId: string;
  folderId: string | null;
  onClose: () => void;
  onImported?: (libraryId: string) => void;
};

type FilePreview = {
  fileName: string;
  sectionCount: number;
  columnCount: number;
  rowCount: number;
};

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function previewImportFile(file: File): Promise<FilePreview> {
  return previewWorkbookFile(file).then(({ sheetCount, columnCount, rowCount }) => {
    return {
      fileName: file.name,
      sectionCount: sheetCount,
      columnCount,
      rowCount,
    };
  });
}

function defaultLibraryNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || 'Imported Library';
}

export function ImportLibraryModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
}: ImportLibraryModalProps) {
  const supabase = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [libraryName, setLibraryName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setLibraryName('');
      setSelectedFile(null);
      setPreview(null);
    }
  }, [open]);

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setPreview(null);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      showErrorToast('Please select a .csv or .xlsx file');
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      showErrorToast('File exceeds 10 MB limit');
      return;
    }

    setSelectedFile(file);
    if (!libraryName.trim()) {
      setLibraryName(defaultLibraryNameFromFile(file.name));
    }

    try {
      const nextPreview = await previewImportFile(file);
      setPreview(nextPreview);
    } catch {
      setPreview(null);
      showErrorToast('Failed to read file');
    }
  };

  const handleImport = async () => {
    const trimmedName = libraryName.trim();
    if (!trimmedName) {
      showErrorToast('Library name is required');
      return;
    }

    const nameError = validateName(trimmedName);
    if (nameError) {
      showErrorToast(nameError);
      return;
    }

    if (!selectedFile) {
      showErrorToast('Please select a file to import');
      return;
    }

    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in before importing');
      }

      const formData = new FormData();
      formData.append('projectId', projectId);
      if (folderId) formData.append('folderId', folderId);
      formData.append('libraryName', trimmedName);
      formData.append('file', selectedFile);

      const res = await fetch('/api/import', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const payload = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) {
        throw new Error(payload.error || 'Import failed');
      }

      showSuccessToast(`Import completed (${payload.rowCount ?? 0} rows)`);
      onImported?.(payload.libraryId);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      showErrorToast(message);
    } finally {
      setImporting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} data-testid="import-library-modal" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Import</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.divider} />
        <div className={styles.content}>
          <p className={styles.hint}>
            Import a spreadsheet to create a new library. The first row is used as column headers; all columns are created as string fields.
          </p>

          <div className={styles.nameContainer}>
            <label htmlFor="import-library-name" className={styles.nameLabel}>Library Name</label>
            <input
              id="import-library-name"
              data-testid="import-library-name"
              className={styles.nameInput}
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              placeholder="Enter library name"
              disabled={importing}
            />
          </div>

          <div className={styles.nameContainer}>
            <span className={styles.nameLabel}>File</span>
            <input
              ref={fileInputRef}
              type="file"
              data-testid="import-library-file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              disabled={importing}
            />
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {selectedFile ? 'Change file' : 'Choose file'}
            </button>
            {preview && (
              <p
                className={styles.hint}
                data-testid="import-library-preview"
                style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}
              >
                {preview.fileName}: {preview.columnCount} columns, {preview.rowCount} rows
                {preview.sectionCount > 1 ? `, ${preview.sectionCount} sheets` : ''}
              </p>
            )}
          </div>
        </div>
        <div className={styles.divider} />
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.primary}`}
            data-testid="import-library-submit"
            onClick={handleImport}
            disabled={importing || !selectedFile || !libraryName.trim()}
          >
            {importing ? (
              <>
                <span className={styles.spinner} aria-hidden />
                Importing...
              </>
            ) : (
              'Import'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
