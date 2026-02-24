'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getCurrentUserId } from '@/lib/services/authorizationService';
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
import assetFileUploadIcon from '@/assets/images/assetFileUploadIcon.svg';
import assetFileIcon from '@/assets/images/assetFileIcon.svg';

interface MediaFileUploadProps {
  value?: MediaFileMetadata | null;
  onChange: (value: MediaFileMetadata | null) => void;
  disabled?: boolean;
  fieldType?: 'image' | 'file';
  onFocus?: () => void;
  onBlur?: () => void;
}

export function MediaFileUpload({ value, onChange, disabled, fieldType = 'image', onFocus, onBlur }: MediaFileUploadProps) {
  const supabase = useSupabase();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileNameRef = useRef<HTMLSpanElement>(null);
  const [isFileNameOverflowing, setIsFileNameOverflowing] = useState(false);

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

    // Check authentication status
    if (authLoading) {
      setError('Please wait while we verify your authentication...');
      return;
    }

    if (!isAuthenticated) {
      setError('Please sign in to upload files');
      return;
    }

    setUploading(true);
    setUploadProgress('Uploading file...');

    try {
      // Get user ID from auth, not from userProfile
      const userId = await getCurrentUserId(supabase);
      const metadata = await uploadMediaFile(supabase, file, userId);
      onChange(metadata);
      setUploadProgress('Upload complete!');
      setTimeout(() => {
        setUploadProgress('');
      }, 1000);
      // Delay blur to allow other users to see the change
      setTimeout(() => {
        onBlur?.();
      }, 2000);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
      setUploadProgress('');
      // Delay blur even on error to show the error state
      setTimeout(() => {
        onBlur?.();
      }, 1500);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleReplace = () => {
    // Trigger focus callback when clicking replace button
    onFocus?.();
    fileInputRef.current?.click();
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
    // Trigger focus callback when clicking upload button
    onFocus?.();
    fileInputRef.current?.click();
  };
  
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Handle file selection (blur will be called after upload completes)
    await handleFileSelect(event);
  };

  const uploadLabel = fieldType === 'image' ? 'upload image' : 'upload file';
  const acceptTypes = fieldType === 'image' 
    ? 'image/*' 
    : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';

  // Check if file name is overflowing
  useEffect(() => {
    const checkOverflow = () => {
      if (fileNameRef.current && value) {
        // Check if element has text-overflow: ellipsis applied
        const computedStyle = window.getComputedStyle(fileNameRef.current);
        const hasEllipsis = computedStyle.textOverflow === 'ellipsis';
        const hasOverflow = computedStyle.overflow === 'hidden' || computedStyle.overflowX === 'hidden';
        
        // Check if content is actually wider than container
        // Use Math.ceil to handle sub-pixel rendering issues
        const isContentOverflowing = Math.ceil(fileNameRef.current.scrollWidth) > Math.ceil(fileNameRef.current.clientWidth);
        
        // Show tooltip if element has ellipsis styling and content is overflowing
        const isOverflow = hasEllipsis && hasOverflow && isContentOverflowing;
        setIsFileNameOverflowing(isOverflow);
      } else {
        setIsFileNameOverflowing(false);
      }
    };

    // Check initially with a small delay to ensure styles are applied
    const timeoutId = setTimeout(checkOverflow, 0);

    // Use ResizeObserver to detect when container size changes
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });

    if (fileNameRef.current) {
      resizeObserver.observe(fileNameRef.current);
    }

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [value]);

  return (
    <div className={styles.container}>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileInputChange}
        disabled={disabled || uploading}
        className={styles.fileInput}
        accept={acceptTypes}
        onFocus={onFocus}
        onBlur={onBlur}
      />

      {!value && (
        <button
          type="button"
          onClick={handleChooseFile}
          disabled={disabled || uploading}
          className={styles.uploadButton}
        >
          <Image src={assetFileUploadIcon} alt="" width={24} height={24} className="icon-24" />
          {uploading ? uploadProgress : uploadLabel}
        </button>
      )}

      {value && (
        <div className={styles.uploadedFileContainer}>
          <div className={styles.fileInfoClickable} onClick={handleView} title="Click to view">
            {fieldType === 'image' && isImageFile(value.fileType) ? (
              <div className={styles.imageThumbnail}>
                <Image
                  src={value.url}
                  alt={value.fileName}
                  width={40}
                  height={40}
                  className={styles.thumbnailImage}
                  unoptimized
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className={styles.fileIconWrapper}>
                <Image src={assetFileIcon} alt="" width={24} height={24} className="icon-24" />
              </div>
            )}
            <Tooltip title={isFileNameOverflowing ? value.fileName : null} placement="topLeft" mouseEnterDelay={0.5}>
              <span ref={fileNameRef} className={styles.uploadedFileName}>{value.fileName}</span>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={handleReplace}
            disabled={disabled || uploading}
            className={styles.replaceButton}
          >
            replace
          </button>
        </div>
      )}

      {error && <div className={styles.errorMessage}>{error}</div>}

      {/* Image Preview Modal */}
      {showImagePreview && value && isImageFile(value.fileType) && (
        <div className={styles.modalOverlay} onClick={() => setShowImagePreview(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <Tooltip title={value.fileName} placement="topLeft" mouseEnterDelay={0.5}>
                <span className={styles.modalTitle}>{value.fileName}</span>
              </Tooltip>
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

