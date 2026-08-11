'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  CloseOutlined,
  LoadingOutlined,
  PlusOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons';
import addIcon from '@/assets/images/add.svg';
import pluginIcon from '@/assets/images/plugin.svg';
import { clearDraft, getDraft, setDraft } from './agentChatStorage';
import { parseDocument, validateDesignFile, SUPPORTED_DESIGN_EXTENSIONS } from '@/lib/document-parser';
import { buildDesignMessage } from '@/lib/design-message';
import { uploadDocumentImages, uploadImageFiles } from '@/lib/services/documentImageUpload';
import { getCurrentUserId } from '@/lib/services/authorizationService';
import { validateMediaFile } from '@/lib/services/mediaFileUploadService';
import { useSupabase } from '@/lib/SupabaseContext';
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import type { SendOptions } from './types';
import { focusChatInputWithRetry } from './chatInputFocus';
import styles from './ChatPanel.module.css';

interface Props {
  userId?: string;
  isStreaming: boolean;
  autoExecute: boolean;
  focusRequest?: number;
  selectionContext?: AgentSelectionContext;
  onClearSelectionContext?: () => void;
  onToggleMode: () => void;
  onSend: (message: string, opts?: SendOptions) => void;
  onStop: () => string | null;
}

const DEBOUNCE_MS = 300;
/** Max images attachable to a single chat message (design decision). */
const MAX_CHAT_IMAGES = 6;
/** Default prompt used when the user sends images without typing any text. */
const DEFAULT_IMAGE_PROMPT = 'Please analyze the attached image(s).';
const DOC_ACCEPT = SUPPORTED_DESIGN_EXTENSIONS.map((ext) => `.${ext}`).join(',');
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const ACCEPT = `${DOC_ACCEPT},${IMAGE_ACCEPT}`;

export function ChatInput({
  userId,
  isStreaming,
  autoExecute,
  focusRequest = 0,
  selectionContext,
  onClearSelectionContext,
  onToggleMode,
  onSend,
  onStop,
}: Props) {
  const supabase = useSupabase();
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Maintain object-URL previews for the currently attached images.
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f));
    setImagePreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [images]);

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

  useEffect(() => {
    if (!focusRequest) return;
    return focusChatInputWithRetry(() => textareaRef.current);
  }, [focusRequest]);

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

  const acceptImages = useCallback((incoming: File[]) => {
    const valid: File[] = [];
    let lastError: string | null = null;
    for (const f of incoming) {
      const validation = validateMediaFile(f);
      if (validation.ok) valid.push(f);
      else lastError = validation.error ?? 'Unsupported image.';
    }
    if (valid.length === 0) {
      if (lastError) setFileError(lastError);
      return;
    }
    // Images and a design document are mutually exclusive per message.
    setFile(null);
    setImages((prev) => {
      const merged = [...prev, ...valid];
      if (merged.length > MAX_CHAT_IMAGES) {
        setFileError(`You can attach up to ${MAX_CHAT_IMAGES} images.`);
        return merged.slice(0, MAX_CHAT_IMAGES);
      }
      setFileError(lastError);
      return merged;
    });
  }, []);

  /** Route dropped/selected files: images go to the image list, else a doc. */
  const acceptFiles = useCallback(
    (list: FileList | File[] | null) => {
      const arr = Array.from(list ?? []);
      if (arr.length === 0) return;
      const imgs = arr.filter((f) => f.type.startsWith('image/'));
      if (imgs.length > 0) {
        acceptImages(imgs);
        return;
      }
      const doc = arr[0];
      const validation = validateDesignFile(doc);
      if (!validation.ok) {
        setFileError(validation.error ?? 'Unsupported file.');
        return;
      }
      setImages([]);
      setFile(doc);
      setFileError(null);
    },
    [acceptImages]
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const submit = useCallback(async () => {
    if (isStreaming || parsing) return;
    const trimmed = value.trim();
    if (!trimmed && !file && images.length === 0) return;

    if (images.length > 0) {
      setParsing(true);
      try {
        const uploaderId = await getCurrentUserId(supabase);
        const imageUrls = await uploadImageFiles(supabase, images, uploaderId);
        if (imageUrls.length === 0) {
          setFileError('The image(s) could not be uploaded. Please try again.');
          return;
        }
        onSend(trimmed || DEFAULT_IMAGE_PROMPT, {
          imageUrls,
          selectionContext,
          composerDraft: trimmed,
        });
        setValue('');
        clearImages();
        onClearSelectionContext?.();
        if (userId) clearDraft(userId);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } catch {
        setFileError('You must be signed in to attach images.');
      } finally {
        setParsing(false);
      }
      return;
    }

    if (file) {
      setParsing(true);
      try {
        const { text, images } = await parseDocument(file);
        if (!text.trim()) {
          setFileError('No text could be extracted from this file.');
          return;
        }
        let imageUrls: string[] = [];
        if (images.length > 0) {
          try {
            const uploaderId = await getCurrentUserId(supabase);
            imageUrls = await uploadDocumentImages(supabase, images, uploaderId);
          } catch {
            // best-effort: fall back to a text-only design message
          }
        }
        const message = buildDesignMessage({
          fileName: file.name,
          documentText: text,
          intent: 'analyze',
          additionalInstructions: trimmed || undefined,
        });
        onSend(message, {
          imageUrls,
          selectionContext,
          composerDraft: trimmed,
        });
        setValue('');
        clearFile();
        onClearSelectionContext?.();
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

    onSend(trimmed, {
      ...(selectionContext ? { selectionContext } : {}),
      composerDraft: trimmed,
    });
    setValue('');
    onClearSelectionContext?.();
    if (userId) clearDraft(userId);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [
    isStreaming,
    parsing,
    value,
    file,
    images,
    onSend,
    userId,
    clearFile,
    clearImages,
    supabase,
    selectionContext,
    onClearSelectionContext,
  ]);

  const handleStop = useCallback(() => {
    if (!isStreaming) return;
    const draft = onStop();
    if (typeof draft === 'string') {
      updateValue(draft);
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
      }
      focusChatInputWithRetry(() => textareaRef.current);
    }
  }, [isStreaming, onStop, updateValue]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (isStreaming || parsing) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        acceptImages(imageFiles);
      }
    },
    [isStreaming, parsing, acceptImages]
  );

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
    acceptFiles(e.dataTransfer.files);
  };

  const sendDisabled =
    parsing || (!isStreaming && !value.trim() && !file && images.length === 0);

  return (
    <div
      className={`${styles.composer} ${dragActive ? styles.composerDragActive : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.composerTopRow}>
        <button
          type="button"
          className={styles.autoToggle}
          data-testid="agent-mode-toggle"
          disabled={isStreaming || parsing}
          aria-label={`Execution mode: ${autoExecute ? 'Auto' : 'Confirm'}`}
          aria-pressed={autoExecute}
          title={autoExecute ? 'Write tools run immediately' : 'Write operations require confirmation'}
          onClick={onToggleMode}
        >
          <span className={styles.autoToggleLabel}>Auto</span>
          <span className={`${styles.autoToggleTrack} ${autoExecute ? styles.autoToggleTrackOn : ''}`}>
            <span className={styles.autoToggleThumb} />
          </span>
        </button>
      </div>

      {selectionContext && (
        <div className={styles.attachmentRow}>
          <span className={styles.selectionAttachment} title={selectionContext.selectionLabel}>
            <span className={styles.selectionAttachmentText}>{selectionContext.selectionLabel}</span>
            <button
              type="button"
              className={styles.selectionAttachmentRemove}
              onClick={onClearSelectionContext}
              aria-label="Remove selected table data"
              disabled={isStreaming || parsing}
            >
              <CloseOutlined />
            </button>
          </span>
        </div>
      )}

      {images.length > 0 && (
        <div className={styles.attachmentRow}>
          {imagePreviews.map((url, idx) => (
            <span key={url} className={styles.imageChip}>
              <Image
                src={url}
                alt={images[idx]?.name ?? 'image'}
                width={48}
                height={48}
                className={styles.imageChipThumb}
                unoptimized
              />
              <button
                type="button"
                className={styles.imageChipRemove}
                onClick={() => removeImage(idx)}
                aria-label="Remove image"
                disabled={parsing}
              >
                <CloseOutlined />
              </button>
            </span>
          ))}
        </div>
      )}

      {(file || fileError) && (
        <div className={styles.attachmentRow}>
          <span className={`${styles.fileChip} ${fileError ? styles.fileChipError : ''}`}>
            <PlusOutlined className={styles.fileChipIcon} />
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
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className={styles.fileInputHidden}
          onChange={(e) => {
            acceptFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          data-testid="agent-input"
          className={styles.textarea}
          rows={1}
          disabled={isStreaming}
          placeholder={
            isStreaming
              ? 'Keco Assistant is working…'
              : file
                ? 'Add a prompt for this document (optional)…'
                : images.length > 0
                  ? 'Add a prompt for these images (optional)…'
                  : 'Ask AI to help...'
          }
          value={value}
          onChange={(e) => {
            updateValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className={styles.inputActionRow}>
          <div className={styles.inputTools}>
            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || parsing}
              aria-label="Attach a document or images"
              title="Attach a .txt/.md/.docx document or images"
            >
              <Image src={addIcon} alt="" width={22} height={22} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.attachBtn}
              disabled
              aria-label="Agent tools"
              title="Agent tools"
            >
              <Image src={pluginIcon} alt="" width={15} height={15} aria-hidden="true" />
            </button>
          </div>
          <button
            className={`${styles.sendBtn} ${isStreaming || parsing ? styles.sendBtnWorking : ''}`}
            data-testid="agent-send"
            disabled={sendDisabled}
            onClick={() => {
              if (isStreaming) {
                handleStop();
                return;
              }
              void submit();
            }}
            aria-busy={parsing}
            aria-label={isStreaming ? 'Stop generating' : 'Send message'}
            title={isStreaming ? 'Stop generating' : 'Send message'}
          >
            {isStreaming ? (
              <span className={styles.sendStopIcon} aria-hidden="true" />
            ) : parsing ? (
              <LoadingOutlined spin />
            ) : (
              <ArrowUpOutlined />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatInput;
