'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  uploadMediaFile,
  deleteMediaFile,
  validateMediaFile,
  formatFileSize,
  getFileIcon,
  isImageFile,
  type MediaFileMetadata,
} from '@/lib/services/mediaFileUploadService';
import styles from './MediaFileUpload.module.css';

interface MediaFileUploadProps {
  value?: MediaFileMetadata | null;
  onChange: (value: MediaFileMetadata | null) => void;
  disabled?: boolean;
}

export function MediaFileUpload({ value, onChange, disabled }: MediaFileUploadProps) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file
    const validation = validateMediaFile(file);
    if (!validation.ok) {
      setError(validation.error || 'Invalid file');
      return;
    }

    if (!userProfile?.id) {
      setError('Please sign in to upload files');
      return;
    }

    setUploading(true);
    setUploadProgress('Uploading file...');

    try {
      const metadata = await uploadMediaFile(supabase, file, userProfile.id);
      onChange(metadata);
      setUploadProgress('Upload complete!');
      setTimeout(() => {
        setUploadProgress('');
      }, 2000);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
      setUploadProgress('');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async () => {
    if (!value?.path) return;

    if (!confirm('Are you sure you want to delete this file?')) {
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress('Deleting file...');

    try {
      await deleteMediaFile(supabase, value.path);
      onChange(null);
      setUploadProgress('');
    } catch (e: any) {
      setError(e?.message || 'Failed to delete file');
      setUploadProgress('');
    } finally {
      setUploading(false);
    }
  };

  const handleView = () => {
    if (!value?.url) return;

    if (isImageFile(value.fileType)) {
      setShowImagePreview(true);
    } else {
      window.open(value.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={styles.container}>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        disabled={disabled || uploading}
        className={styles.fileInput}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
      />

      {!value && (
        <button
          type="button"
          onClick={handleChooseFile}
          disabled={disabled || uploading}
          className={styles.uploadButton}
        >
          {uploading ? uploadProgress : 'Choose file to upload'}
        </button>
      )}

      {value && (
        <div className={styles.fileInfo}>
          <div className={styles.fileDetails}>
            {isImageFile(value.fileType) ? (
              <div className={styles.imageThumbnail}>
                <Image
                  src={value.url}
                  alt={value.fileName}
                  width={48}
                  height={48}
                  className={styles.thumbnailImage}
                  unoptimized
                  onError={(e) => {
                    // Fallback to icon if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      const icon = document.createElement('span');
                      icon.className = styles.fileIcon;
                      icon.textContent = getFileIcon(value.fileType);
                      parent.appendChild(icon);
                    }
                  }}
                />
              </div>
            ) : (
              <span className={styles.fileIcon}>{getFileIcon(value.fileType)}</span>
            )}
            <div className={styles.fileMetadata}>
              <div className={styles.fileName}>{value.fileName}</div>
              <div className={styles.fileSize}>{formatFileSize(value.fileSize)}</div>
            </div>
          </div>
          <div className={styles.fileActions}>
            <button
              type="button"
              onClick={handleView}
              className={styles.actionButton}
              disabled={disabled}
              title="View file"
            >
              👁️ View
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className={styles.deleteButton}
              disabled={disabled || uploading}
              title="Delete file"
            >
              🗑️ Delete
            </button>
          </div>
        </div>
      )}

      {uploadProgress && (
        <div className={styles.progressMessage}>{uploadProgress}</div>
      )}

      {error && <div className={styles.errorMessage}>{error}</div>}

      {/* Image Preview Modal */}
      {showImagePreview && value && isImageFile(value.fileType) && (
        <div className={styles.modalOverlay} onClick={() => setShowImagePreview(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>{value.fileName}</span>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setShowImagePreview(false)}
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <Image
                src={value.url}
                alt={value.fileName}
                width={800}
                height={600}
                className={styles.previewImage}
                unoptimized
                style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: 'calc(90vh - 160px)' }}
              />
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.modalButton}
                onClick={() => window.open(value.url, '_blank', 'noopener,noreferrer')}
              >
                Open in new tab
              </button>
              <button
                type="button"
                className={styles.modalButton}
                onClick={() => setShowImagePreview(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

