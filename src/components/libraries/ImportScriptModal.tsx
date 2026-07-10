'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import { useSupabase } from '@/lib/SupabaseContext';
import { validateName } from '@/lib/utils/nameValidation';
import { parseDocument, validateDesignFile } from '@/lib/document-parser';
import { consumeImportStream } from '@/lib/import-script-stream';
import type { ImportProgressEvent } from '@/lib/story-ir/schema';
import styles from './ImportScriptModal.module.css';

type ImportScriptModalProps = {
  open: boolean;
  projectId: string;
  folderId: string;
  onClose: () => void;
  onImported?: (libraryId: string) => void;
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

const STANDARD_FORMAT_EXAMPLE = `【Start｜Afternoon, small apartment, sunlight through the curtains】
（Type3・Narrator）At three in the afternoon, Atana dozes beside the keyboard.
（Type2・AI）You have not eaten properly for 22 hours. Heart rate is low.
（Type1・Atana）Ugh... stop nagging. One more code block.
（Type3・Narrator）Three choices appear on screen.
O1：Go out for food（$trust+=2，jump O1 branch）
O2：Negotiate, write for 30 more minutes（$pally+=1，jump O2 branch）
O3：Ignore the reminder（$rely-=1，jump O3 branch）
O1 branch【O1｜Atana stretches and stands up】
（Type1・Atana）Fine, I'll listen for once and take a walk.
（Type2・AI）I found a light-meal shop nearby.
（Jump Oend）
O2 branch【O2｜Atana's fingers return to the keyboard】
（Type1・Atana）Thirty minutes. Set a timer.
（Type2・AI）Timer set. Meal pre-ordered remotely.
（Jump Oend）
O3 branch【O3｜Atana types quickly】
（Type1・Atana）Turn off the alerts. I'll handle meals myself.
（Type2・AI）Alerts blocked temporarily. Health data still synced.
（Jump Oend）
Oend merge【Oend｜Evening, dining table】
（Type2・AI）Regular meals improved your efficiency by 11%.
（Type1・Atana）The data is hard to argue with. We'll compromise.
（Type3・Narrator）Sunset paints the buildings red as work continues.`;

const FORMAT_GUIDE = {
  title: 'Standard input format',
  sections: [
    {
      title: '1. Scene label',
      format: '【Label｜Scene description】',
      example: '【Start｜Afternoon, small apartment】',
      note: 'Label can be Start, O1, O2, Oend, etc.',
    },
    {
      title: '2. Dialogue',
      format: '（TypeX・Speaker）Dialogue text',
      example: '（Type1・Atana）Hello world',
      note: 'Type 1=blue, 2=pink, 3=gray narrator, 4=no box, 5=fullscreen',
    },
    {
      title: '3. Options',
      format: 'O#：Option text（$var+=value，jump branch）',
      example: 'O1：Choose A（$trust+=2，jump O1 branch）',
      note: 'Place options immediately after the dialogue that precedes the choice',
    },
    {
      title: '4. Branch declaration',
      format: 'O# branch【O#｜Scene description】',
      example: 'O1 branch【O1｜Atana stands up】',
      note: 'Each option maps to one branch',
    },
    {
      title: '5. Jump command',
      format: '（Jump target）',
      example: '（Jump Oend）',
      note: 'Use at the end of a branch to merge paths',
    },
    {
      title: '6. Merge ending',
      format: 'Oend merge【Oend｜Scene description】',
      example: 'Oend merge【Oend｜Evening, dining table】',
      note: 'Where all branches converge',
    },
  ],
  tips: [
    'One instruction per line; avoid multiple commands on the same line',
    'Variables: $name+=value or $name-=value',
    'Jump targets must match branch labels',
    'Type 3 is narrator; speaker name can be empty',
    'Natural formats also work: Speaker: text, - option, [Label: Start]',
  ],
};

function previewScript(text: string): PreviewInfo {
  const lines = text.split('\n').filter(l => l.trim());
  const dialogueCount = lines.filter(l => /[:：]/.test(l) && !l.trim().startsWith('【')).length;
  const optionCount = lines.filter(
    l => /^\s*-\s/.test(l) || /^【选项/.test(l) || /^O\d+[：:]/.test(l)
  ).length;
  return { lineCount: lines.length, dialogueCount, optionCount };
}

function defaultLibraryNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || 'Imported script';
}

export function ImportScriptModal({
  open,
  projectId,
  folderId,
  onClose,
  onImported,
  initialText,
  initialLibraryName,
}: ImportScriptModalProps) {
  const supabase = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [libraryName, setLibraryName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedFileText, setParsedFileText] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  useEffect(() => setMounted(true), []);

  // Pre-fill from the agent handoff when opened with initial content.
  useEffect(() => {
    if (open && typeof initialText === 'string' && initialText.length > 0) {
      setInputMode('text');
      setTextInput(initialText);
      if (initialLibraryName) setLibraryName(initialLibraryName);
    }
  }, [open, initialText, initialLibraryName]);

  useEffect(() => {
    if (!open) {
      setLibraryName('');
      setSelectedFile(null);
      setParsedFileText(null);
      setTextInput('');
      setPreview(null);
      setImportProgress(null);
      setInputMode('file');
    }
  }, [open]);

  useEffect(() => {
    if (inputMode === 'text' && textInput.trim()) {
      setPreview(previewScript(textInput));
    } else if (inputMode === 'file' && !selectedFile) {
      setPreview(null);
    }
  }, [textInput, inputMode, selectedFile]);

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

    if (inputMode === 'file') {
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
    setImportProgress({ phase: 'source_read', message: 'Reading script source' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in to continue');
      }

      const formData = new FormData();
      formData.append('projectId', projectId);
      formData.append('folderId', folderId);
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

  const handleLoadStandardExample = () => {
    setTextInput(STANDARD_FORMAT_EXAMPLE);
    if (!libraryName.trim()) {
      setLibraryName('Standard format example');
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!importing && e.target === e.currentTarget) onClose();
  };

  const canImport = inputMode === 'file'
    ? !!parsedFileText?.trim() && !!libraryName.trim()
    : !!textInput.trim() && !!libraryName.trim();

  if (!open) return null;
  if (!mounted) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
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
              className={styles.nameInput}
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              placeholder="Enter library name"
              disabled={importing}
            />
          </div>

          <div className={styles.tabContainer}>
            <button
              className={`${styles.tab} ${inputMode === 'file' ? styles.tabActive : ''}`}
              onClick={() => setInputMode('file')}
              disabled={importing}
            >
              File upload
            </button>
            <button
              className={`${styles.tab} ${inputMode === 'text' ? styles.tabActive : ''}`}
              onClick={() => setInputMode('text')}
              disabled={importing}
            >
              Text input
            </button>
          </div>

          {inputMode === 'file' ? (
            <div className={styles.fileContainer}>
              <input
                ref={fileInputRef}
                type="file"
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
              <div className={styles.textActions}>
                <button
                  type="button"
                  className={styles.exampleButton}
                  onClick={handleLoadStandardExample}
                  disabled={importing}
                >
                  Load standard example
                </button>
              </div>
              <textarea
                className={styles.textarea}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Enter script in standard format...\n\nUse "Load standard example" for a full sample\nor open "Format guide" below for rules`}
                disabled={importing}
                rows={10}
              />
            </div>
          )}

          <div className={styles.formatGuide}>
            <button
              type="button"
              className={styles.formatGuideToggle}
              onClick={() => setShowFormatGuide(!showFormatGuide)}
            >
              <span>{showFormatGuide ? '▼' : '▶'} Format guide</span>
              <span className={styles.formatGuideHint}>
                {showFormatGuide ? 'Collapse' : 'View standard format'}
              </span>
            </button>
            {showFormatGuide && (
              <div className={styles.formatGuideContent}>
                <p className={styles.formatGuideTitle}>{FORMAT_GUIDE.title}</p>
                {FORMAT_GUIDE.sections.map((section, idx) => (
                  <div key={idx} className={styles.formatSection}>
                    <p className={styles.formatSectionTitle}>{section.title}</p>
                    <code className={styles.formatCode}>{section.format}</code>
                    <p className={styles.formatExample}>Example: {section.example}</p>
                    <p className={styles.formatNote}>{section.note}</p>
                  </div>
                ))}
                <div className={styles.formatTips}>
                  <p className={styles.formatTipsTitle}>Tips</p>
                  <ul className={styles.formatTipsList}>
                    {FORMAT_GUIDE.tips.map((tip, idx) => (
                      <li key={idx}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {preview && (
            <div className={styles.preview}>
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
