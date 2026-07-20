'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateName } from '@/lib/utils/nameValidation';
import { parseDocument, validateDesignFile } from '@/lib/document-parser';
import { consumeImportStream } from '@/lib/import-script-stream';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import type { StoryPlanProgressEvent as ImportProgressEvent } from '@/lib/story-plan/conversion';
import styles from './ImportScriptModal.module.css';

type ImportScriptModalProps = {
  open: boolean;
  projectId: string;
  folderId: string | null;
  onClose: () => void;
  onImported?: (libraryId: string) => void;
  documentSource?: DocumentExportSource;
  /** Pre-fill the text input (used by the agent "Edit in Import Modal" handoff). */
  initialText?: string;
  initialLibraryName?: string;
};

type PreviewInfo = {
  lineCount: number;
  dialogueCount: number;
  optionCount: number;
};

type InputMode = 'file' | 'text';

function previewScript(text: string): PreviewInfo {
  const lines = text.split('\n').filter(l => l.trim());
  const dialogueCount = lines.filter(l => /[:：]/.test(l) && !l.trim().startsWith('【')).length;
  const optionCount = lines.filter(
    l => /^\s*-\s/.test(l) || /^O\d+[：:]/.test(l)
  ).length;
  return { lineCount: lines.length, dialogueCount, optionCount };
}

function defaultLibraryNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || 'Imported script';
}

function snapshotDocumentSource(source: DocumentExportSource): DocumentExportSource {
  return {
    ...source,
    token: { ...source.token },
  };
}

export function ImportScriptModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
  documentSource,
  initialText,
  initialLibraryName,
}: ImportScriptModalProps) {
  const supabase = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [libraryName, setLibraryName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFileText, setParsedFileText] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [documentSnapshot, setDocumentSnapshot] = useState<DocumentExportSource | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Pre-fill from the agent handoff when opened with initial content.
  useEffect(() => {
    if (!documentSource && open && typeof initialText === 'string' && initialText.length > 0) {
      setInputMode('text');
      setTextInput(initialText);
      if (initialLibraryName) setLibraryName(initialLibraryName);
    }
  }, [documentSource, open, initialText, initialLibraryName]);

  useEffect(() => {
    const opening = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (opening && documentSource) {
      const snapshot = snapshotDocumentSource(documentSource);
      setDocumentSnapshot(snapshot);
      setLibraryName(snapshot.documentName);
    }

    if (!open) {
      setDocumentSnapshot(null);
      setLibraryName('');
      setSelectedFile(null);
      setParsedFileText(null);
      setTextInput('');
      setPreview(null);
      setImportProgress(null);
      setInputMode('file');
    }
  }, [documentSource, open]);

  useEffect(() => {
    const source = documentSnapshot
      ? documentSnapshot.markdown
      : inputMode === 'text' ? textInput : parsedFileText;
    setPreview(source?.trim() ? previewScript(source) : null);
  }, [documentSnapshot, textInput, inputMode, parsedFileText]);

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setParsedFileText(null);
      setPreview(null);
      return;
    }

    const validation = validateDesignFile(file);
    if (!validation.ok) {
      showErrorToast(validation.error || 'Unsupported file');
      return;
    }

    setSelectedFile(file);
    if (!libraryName.trim()) {
      setLibraryName(defaultLibraryNameFromFile(file.name));
    }

    try {
      const doc = await parseDocument(file);
      if (!doc.text.trim()) {
        setParsedFileText(null);
        setPreview(null);
        showErrorToast('No text content found in file');
        return;
      }
      setParsedFileText(doc.text);
      setPreview(previewScript(doc.text));
    } catch (e) {
      setParsedFileText(null);
      setPreview(null);
      showErrorToast(e instanceof Error ? e.message : 'Failed to read file');
    }
  };

  const handleImport = async () => {
    const trimmedName = libraryName.trim();
    if (!trimmedName) {
      showErrorToast('Please enter a library name');
      return;
    }

    const nameError = validateName(trimmedName);
    if (nameError) {
      showErrorToast(nameError);
      return;
    }

    let fileContent = '';
    let fileName = 'input.txt';

    if (documentSnapshot) {
      if (!documentSnapshot.markdown.trim()) {
        showErrorToast('Document is empty');
        return;
      }
      fileContent = documentSnapshot.markdown;
      fileName = `${documentSnapshot.documentName}.txt`;
    } else if (inputMode === 'file') {
      if (!selectedFile || !parsedFileText?.trim()) {
        showErrorToast('Please select a file with text content');
        return;
      }
      fileContent = parsedFileText;
      fileName = `${trimmedName}.txt`;
    } else {
      if (!textInput.trim()) {
        showErrorToast('Please enter script text');
        return;
      }
      fileContent = textInput;
      fileName = `${trimmedName}.txt`;
    }

    setImporting(true);
    setImportProgress({ phase: 'source_segmentation', message: 'Segmenting exact story source' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in to continue');
      }

      const formData = new FormData();
      formData.append('projectId', documentSnapshot?.projectId ?? projectId);
      if (!documentSnapshot && folderId) formData.append('folderId', folderId);
      if (documentSnapshot) {
        formData.append('sourceDocumentId', documentSnapshot.documentId);
        formData.append('snapshotToken', documentSnapshot.snapshotToken ?? '');
      }
      formData.append('libraryName', trimmedName);
      formData.append('file', new File([fileContent], fileName, { type: 'text/plain' }));

      const res = await fetch('/api/import-script', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const payload = await consumeImportStream(res, setImportProgress);

      showSuccessToast(`Script imported (${payload.rowCount ?? 0} rows)`);
      onImported?.(payload.libraryId);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      showErrorToast(message);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!importing && e.target === e.currentTarget) onClose();
  };

  const canImport = documentSnapshot
    ? !!documentSnapshot.markdown.trim() && !!libraryName.trim()
    : inputMode === 'file'
      ? !!parsedFileText?.trim() && !!libraryName.trim()
      : !!textInput.trim() && !!libraryName.trim();

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} data-testid="import-script-modal" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Import script</div>
          <button className={styles.close} onClick={onClose} aria-label="Close" disabled={importing}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.divider} />
        <div className={styles.content}>
          <p className={styles.hint}>
            Parse script text into structured rows. Supports dialogue, options, stage directions, conditions, and more.
          </p>

          <div className={styles.nameContainer}>
            <label htmlFor="import-script-name" className={styles.nameLabel}>Library name</label>
            <input
              id="import-script-name"
              data-testid="import-script-name"
              className={styles.nameInput}
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              placeholder="Enter library name"
              disabled={importing}
            />
          </div>

          {documentSnapshot ? (
            <div className={styles.documentSource} data-testid="import-script-document-source">
              <span className={styles.documentSourceLabel}>Project document</span>
              <strong>{documentSnapshot.documentName}</strong>
            </div>
          ) : null}

          {!documentSnapshot && (
            <div className={styles.tabContainer}>
              <button
                className={`${styles.tab} ${inputMode === 'file' ? styles.tabActive : ''}`}
                data-testid="import-script-file-mode"
                onClick={() => setInputMode('file')}
                disabled={importing}
              >
                File upload
              </button>
              <button
                className={`${styles.tab} ${inputMode === 'text' ? styles.tabActive : ''}`}
                data-testid="import-script-text-mode"
                onClick={() => setInputMode('text')}
                disabled={importing}
              >
                Text input
              </button>
            </div>
          )}

          {!documentSnapshot && (
            inputMode === 'file' ? (
              <div className={styles.fileContainer}>
                <input
                  ref={fileInputRef}
                  type="file"
                  data-testid="import-script-file"
                  accept=".txt,.md,.docx"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  disabled={importing}
                />
                <button
                  type="button"
                  className={styles.fileButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {selectedFile ? 'Change file' : 'Select file'}
                </button>
                {selectedFile && (
                  <p className={styles.fileName}>{selectedFile.name}</p>
                )}
                <p className={styles.fileHint}>.txt, .md, and .docx supported</p>
              </div>
            ) : (
              <div className={styles.textContainer}>
                <textarea
                  className={styles.textarea}
                  data-testid="import-script-text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Enter story text..."
                  disabled={importing}
                  rows={10}
                />
              </div>
            )
          )}

          {preview && (
            <div className={styles.preview} data-testid="import-script-preview">
              <span className={styles.previewLabel}>Preview:</span>
              <span>{preview.lineCount} lines</span>
              <span className={styles.previewDot}>·</span>
              <span>{preview.dialogueCount} dialogues</span>
              {preview.optionCount > 0 && (
                <>
                  <span className={styles.previewDot}>·</span>
                  <span>{preview.optionCount} options</span>
                </>
              )}
            </div>
          )}
          <div
            className={`${styles.progressRow} ${importing ? styles.progressRowVisible : ''}`}
            role="status"
            aria-live="polite"
          >
            {importing && <span className={styles.progressSpinner} aria-hidden />}
            <span>{importProgress?.message ?? ''}</span>
          </div>
        </div>
        <div className={styles.divider} />
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            data-testid="import-script-submit"
            onClick={handleImport}
            disabled={importing || !canImport}
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
