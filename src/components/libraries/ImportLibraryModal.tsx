'use client';

import { useEffect, useState } from 'react';
import { DocumentDropZone } from '@/components/design-upload/DocumentDropZone';
import { ImportResourceModal } from '@/components/shared/ImportResourceModal';
import {
  nextImportName,
  normalizeImportNotes,
} from '@/components/shared/importResourceForm';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateName } from '@/lib/utils/nameValidation';
import { previewWorkbookFile } from '@/lib/utils/workbook';
import dialog from '@/components/shared/FormDialog.module.css';

type ImportLibraryModalProps = {
  open: boolean;
  projectId: string;
  folderId: string | null;
  onClose: () => void;
  onImported?: (libraryId: string) => void;
};

type FilePreview = {
  fileName: string;
  sheetCount: number;
  columnCount: number;
  rowCount: number;
};

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const TABLE_ACCEPT = '.csv,.xlsx,.xls';
const TABLE_FORMATS_HINT = 'Supported formats: .csv, .xlsx, .xls';

function previewImportFile(file: File): Promise<FilePreview> {
  return previewWorkbookFile(file).then(({ sheetCount, columnCount, rowCount }) => {
    return {
      fileName: file.name,
      sheetCount,
      columnCount,
      rowCount,
    };
  });
}

export function ImportLibraryModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
}: ImportLibraryModalProps) {
  const supabase = useSupabase();
  const [libraryName, setLibraryName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) {
      setLibraryName('');
      setNameEdited(false);
      setNotes('');
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
    setLibraryName((currentName) => nextImportName({
      currentName,
      fileName: file.name,
      kind: 'table',
      nameEdited,
    }));

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
      const description = normalizeImportNotes(notes);
      if (description) formData.append('description', description);
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

  return (
    <ImportResourceModal
      open={open}
      resourceLabel="Table"
      name={libraryName}
      notes={notes}
      submitting={importing}
      submitDisabled={!selectedFile || !libraryName.trim()}
      testId="import-library-modal"
      onNameChange={(nextName) => {
        setLibraryName(nextName);
        setNameEdited(true);
      }}
      onNotesChange={setNotes}
      onClose={onClose}
      onSubmit={() => void handleImport()}
      fileControl={(
        <>
          <DocumentDropZone
            selectedFile={selectedFile}
            compact
            disabled={importing}
            accept={TABLE_ACCEPT}
            formatsHint={TABLE_FORMATS_HINT}
            dropZoneTestId="import-library-drop-zone"
            fileInputTestId="import-library-file"
            selectedFileTestId="import-library-selected-file"
            clearButtonTestId="import-library-clear-file"
            onFileSelected={(file) => void handleFileChange(file)}
            onClear={() => {
              setSelectedFile(null);
              setPreview(null);
              if (!nameEdited) setLibraryName('');
            }}
          />
          {preview ? (
            <p
              className={dialog.filePreview}
              data-testid="import-library-preview"
            >
              {preview.fileName}: {preview.columnCount} columns, {preview.rowCount} rows
              {preview.sheetCount > 1 ? `, ${preview.sheetCount} sheets` : ''}
            </p>
          ) : null}
        </>
      )}
    />
  );
}
