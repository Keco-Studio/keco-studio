'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import assetFileIcon from '@/assets/images/assetFileIcon.svg';
import assetFileUploadIcon from '@/assets/images/assetFileUploadIcon.svg';
import styles from './DocumentDropZone.module.css';

type DocumentDropZoneProps = {
  selectedFile: File | null;
  disabled?: boolean;
  /** Match Create Document input height for import dialogs. */
  compact?: boolean;
  accept?: string;
  formatsHint?: string;
  dropZoneTestId?: string;
  fileInputTestId?: string;
  selectedFileTestId?: string;
  clearButtonTestId?: string;
  onFileSelected: (file: File) => void;
  onClear: () => void;
};

const DEFAULT_ACCEPT = '.txt,.md,.docx';
const DEFAULT_FORMATS_HINT = 'Supported formats: .txt, .md, .docx';

function DropPlusIcon() {
  return (
    <svg
      className={styles.dropPlusIcon}
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M14 6v16M6 14h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DocumentDropZone({
  selectedFile,
  disabled = false,
  compact = false,
  accept = DEFAULT_ACCEPT,
  formatsHint = DEFAULT_FORMATS_HINT,
  dropZoneTestId = 'design-upload-drop-zone',
  fileInputTestId = 'design-upload-file-input',
  selectedFileTestId = 'design-upload-selected-file',
  clearButtonTestId = 'design-upload-clear-file',
  onFileSelected,
  onClear,
}: DocumentDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const isEmpty = !selectedFile;
  const dragHint = `Drag a file here, or click to choose ${formatsHint}`;

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  const clearDragState = () => {
    dragDepthRef.current = 0;
    setDragOver(false);
  };

  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      clearDragState();
      if (!disabled) handleFiles(e.dataTransfer.files);
    },
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      data-testid={fileInputTestId}
      accept={accept}
      className={styles.input}
      disabled={disabled}
      onChange={(e) => {
        handleFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  if (compact) {
    return (
      <div className={styles.compactRoot}>
        <div
          className={[
            styles.zoneCompact,
            dragOver ? styles.dragOver : '',
            disabled ? styles.disabled : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid={dropZoneTestId}
          data-drag-over={dragOver ? 'true' : undefined}
          aria-label={isEmpty ? dragHint : undefined}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openPicker();
            }
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          {...dragHandlers}
        >
          {fileInput}
          {selectedFile ? (
            <div className={styles.selected} data-testid={selectedFileTestId}>
              <Image
                src={assetFileIcon}
                alt=""
                width={16}
                height={16}
                className={styles.fileTypeIcon}
              />
              <span className={styles.fileName}>{selectedFile.name}</span>
              <button
                type="button"
                className={styles.clearButton}
                data-testid={clearButtonTestId}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className={styles.compactEmptyRow}>
              <Image
                src={assetFileIcon}
                alt=""
                width={16}
                height={16}
                className={styles.fileTypeIcon}
              />
              <span className={styles.clickToUpload}>click to upload</span>
              <button
                type="button"
                className={styles.uploadButton}
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker();
                }}
                disabled={disabled}
              >
                <Image
                  src={assetFileUploadIcon}
                  alt=""
                  width={16}
                  height={16}
                  className={styles.uploadButtonIcon}
                />
                <span>Upload</span>
              </button>
            </div>
          )}
        </div>
        {isEmpty ? <p className={styles.formatsHintBelow}>{dragHint}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={[
        styles.zone,
        isEmpty ? styles.emptyDrop : '',
        dragOver ? styles.dragOver : '',
        disabled ? styles.disabled : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={dropZoneTestId}
      data-drag-over={dragOver ? 'true' : undefined}
      aria-label={isEmpty ? `Choose a file. ${formatsHint}` : undefined}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      {...dragHandlers}
    >
      {fileInput}

      {selectedFile ? (
        <div className={styles.selected} data-testid={selectedFileTestId}>
          <span className={styles.fileName}>{selectedFile.name}</span>
          <button
            type="button"
            className={styles.clearButton}
            data-testid={clearButtonTestId}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className={styles.emptyHint}>
          <DropPlusIcon />
          <div className={styles.secondaryText}>{formatsHint}</div>
        </div>
      )}
    </div>
  );
}

export default DocumentDropZone;
