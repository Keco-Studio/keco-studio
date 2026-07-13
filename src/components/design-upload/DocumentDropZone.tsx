'use client';

import { useRef, useState } from 'react';
import styles from './DocumentDropZone.module.css';

type DocumentDropZoneProps = {
  selectedFile: File | null;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
  onClear: () => void;
};

const ACCEPT = '.txt,.md,.docx';

export function DocumentDropZone({
  selectedFile,
  disabled = false,
  onFileSelected,
  onClear,
}: DocumentDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      className={`${styles.zone} ${dragOver ? styles.dragOver : ''} ${disabled ? styles.disabled : ''}`}
      data-testid="design-upload-drop-zone"
      onClick={openPicker}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        data-testid="design-upload-file-input"
        accept={ACCEPT}
        className={styles.input}
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {selectedFile ? (
        <div className={styles.selected} data-testid="design-upload-selected-file">
          <span className={styles.fileName}>{selectedFile.name}</span>
          <button
            type="button"
            className={styles.clearButton}
            data-testid="design-upload-clear-file"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className={styles.placeholder}>
          <div className={styles.primaryText}>Drag a file here, or click to choose</div>
          <div className={styles.secondaryText}>Supported formats: .txt, .md, .docx</div>
        </div>
      )}
    </div>
  );
}

export default DocumentDropZone;
