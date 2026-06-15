'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadingOutlined, PaperClipOutlined, CloseOutlined } from '@ant-design/icons';
import { clearDraft, getDraft, setDraft } from './agentChatStorage';
import { parseDocument, validateDesignFile, SUPPORTED_DESIGN_EXTENSIONS } from '@/lib/document-parser';
import { buildDesignMessage } from '@/lib/design-message';
import styles from './ChatPanel.module.css';

interface Props {
  userId?: string;
  isStreaming: boolean;
  onSend: (message: string) => void;
}

const DEBOUNCE_MS = 300;
const ACCEPT = SUPPORTED_DESIGN_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export function ChatInput({ userId, isStreaming, onSend }: Props) {
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) {
      setValue('');
      return;
    }
    const saved = getDraft(userId);
    setValue(saved);
    const el = textareaRef.current;
    if (el && saved) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }
  }, [userId]);

  const updateValue = useCallback(
    (next: string) => {
      setValue(next);
      if (!userId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (next.trim()) {
          setDraft(userId, next);
        } else {
          clearDraft(userId);
        }
      }, DEBOUNCE_MS);
    },
    [userId]
  );

  const acceptFile = useCallback((next: File | null) => {
    if (!next) return;
    const validation = validateDesignFile(next);
    if (!validation.ok) {
      setFile(null);
      setFileError(validation.error ?? 'Unsupported file.');
      return;
    }
    setFile(next);
    setFileError(null);
  }, []);

  const clearFile = useCallback(() => {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const submit = useCallback(async () => {
    if (isStreaming || parsing) return;
    const trimmed = value.trim();
    if (!trimmed && !file) return;

    if (file) {
      setParsing(true);
      try {
        const documentText = await parseDocument(file);
        if (!documentText.trim()) {
          setFileError('No text could be extracted from this file.');
          return;
        }
        const message = buildDesignMessage({
          fileName: file.name,
          documentText,
          additionalInstructions: trimmed || undefined,
        });
        onSend(message);
        setValue('');
        clearFile();
        if (userId) clearDraft(userId);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } catch (e) {
        setFileError((e as Error).message || 'Failed to parse the file.');
      } finally {
        setParsing(false);
      }
      return;
    }

    onSend(trimmed);
    setValue('');
    if (userId) clearDraft(userId);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [isStreaming, parsing, value, file, onSend, userId, clearFile]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (isStreaming) return;
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isStreaming) return;
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (isStreaming) return;
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  const sendDisabled = isStreaming || parsing || (!value.trim() && !file);

  return (
    <div
      className={`${styles.composer} ${dragActive ? styles.composerDragActive : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {(file || fileError) && (
        <div className={styles.attachmentRow}>
          <span className={`${styles.fileChip} ${fileError ? styles.fileChipError : ''}`}>
            <PaperClipOutlined className={styles.fileChipIcon} />
            <span className={styles.fileChipName}>{file ? file.name : fileError}</span>
            {file && (
              <button
                type="button"
                className={styles.fileChipRemove}
                onClick={clearFile}
                aria-label="Remove file"
                disabled={parsing}
              >
                <CloseOutlined />
              </button>
            )}
            {fileError && !file && (
              <button
                type="button"
                className={styles.fileChipRemove}
                onClick={() => setFileError(null)}
                aria-label="Dismiss"
              >
                <CloseOutlined />
              </button>
            )}
          </span>
        </div>
      )}

      <div className={styles.inputBar}>
        <button
          type="button"
          className={styles.attachBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || parsing}
          aria-label="Attach a document"
          title="Attach a .txt, .md, or .docx document"
        >
          <PaperClipOutlined />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className={styles.fileInputHidden}
          onChange={(e) => {
            acceptFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          disabled={isStreaming}
          placeholder={
            isStreaming
              ? 'Keco Assistant is working…'
              : file
                ? 'Add a prompt for this document (optional)…'
                : 'Ask Keco Assistant…  (Enter to send, Shift+Enter for newline)'
          }
          value={value}
          onChange={(e) => {
            updateValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className={`${styles.sendBtn} ${isStreaming || parsing ? styles.sendBtnWorking : ''}`}
          disabled={sendDisabled}
          onClick={() => void submit()}
          aria-busy={isStreaming || parsing}
        >
          {isStreaming || parsing ? <LoadingOutlined spin /> : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default ChatInput;
