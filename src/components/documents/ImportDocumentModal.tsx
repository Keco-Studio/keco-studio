'use client';

import { useEffect, useState } from 'react';
import { DocumentDropZone } from '@/components/design-upload/DocumentDropZone';
import { ImportResourceModal } from '@/components/shared/ImportResourceModal';
import {
  nextImportName,
  normalizeImportNotes,
} from '@/components/shared/importResourceForm';
import { useSupabase } from '@/lib/SupabaseContext';
import { createImportedDocument } from '@/lib/documents/documentImportService';
import { validateDesignFile } from '@/lib/document-parser';
import { validateName } from '@/lib/utils/nameValidation';

type ImportDocumentModalProps = {
  open: boolean;
  projectId: string;
  folderId?: string | null;
  onClose: () => void;
  onImported: (documentId: string) => void | Promise<void>;
};

export function ImportDocumentModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
}: ImportDocumentModalProps) {
  const supabase = useSupabase();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setName('');
      setNameEdited(false);
      setNotes('');
      setError(null);
    }
  }, [open]);

  const handleFileSelected = (selected: File) => {
    const validation = validateDesignFile(selected);
    if (!validation.ok) {
      setFile(null);
      setError(validation.error ?? 'Invalid file');
      return;
    }
    setFile(selected);
    setName((currentName) => nextImportName({
      currentName,
      fileName: selected.name,
      kind: 'document',
      nameEdited,
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file || submitting) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Document name is required');
      return;
    }
    const nameError = validateName(trimmedName);
    if (nameError) {
      setError(nameError);
      return;
    }
    const validation = validateDesignFile(file);
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid file');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const imported = await createImportedDocument(supabase, {
        projectId,
        folderId: folderId ?? null,
        file,
        name: trimmedName,
        description: normalizeImportNotes(notes),
      });
      await onImported(imported.document.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to import document');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ImportResourceModal
      open={open}
      resourceLabel="Document"
      name={name}
      notes={notes}
      submitting={submitting}
      submitDisabled={!file || !name.trim()}
      error={error}
      onNameChange={(nextName) => {
        setName(nextName);
        setNameEdited(true);
        setError(null);
      }}
      onNotesChange={setNotes}
      onClose={onClose}
      onSubmit={() => void handleSubmit()}
      fileControl={(
        <DocumentDropZone
          selectedFile={file}
          compact
          disabled={submitting}
          onFileSelected={handleFileSelected}
          onClear={() => {
            setFile(null);
            if (!nameEdited) setName('');
            setError(null);
          }}
        />
      )}
    />
  );
}
