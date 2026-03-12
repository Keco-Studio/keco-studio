'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Tooltip, App } from 'antd';
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
  fieldType?: 'image' | 'file' | 'multimedia' | 'audio';
  onFocus?: () => void;
  onBlur?: () => void;
  // 可选：由父级控制的统一 toast（例如 LibraryAssetsTable 的 TableToast）
  onShowToast?: (message: string, type?: 'success' | 'error' | 'default') => void;
}

export function MediaFileUpload({
  value,
  onChange,
  disabled,
  fieldType = 'image',
  onFocus,
  onBlur,
  onShowToast,
}: MediaFileUploadProps) {
  const supabase = useSupabase();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileNameRef = useRef<HTMLSpanElement>(null);
  const [isFileNameOverflowing, setIsFileNameOverflowing] = useState(false);

  const getTooltipPopupContainer = (triggerNode: HTMLElement) => {
    // If inside asset detail drawer, mount tooltip to the drawer element
    const drawerElement = triggerNode.closest('[class*="detailDrawer"]');
    if (drawerElement instanceof HTMLElement) {
      return drawerElement;
    }
    // Fallback to body so tooltips inside table are not clipped by cell overflow
    return document.body;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file (size、基础类型等)
    const validation = validateMediaFile(file);
    if (!validation.ok) {
      const msg = validation.error || 'Invalid file';
      setError(msg);
      if (onShowToast) {
        onShowToast(msg, 'error');
      } else {
        message.error(msg);
      }
      return;
    }

    // 根据当前字段类型进行更细粒度的类型校验
    const fileType = file.type;
    const fileName = file.name.toLowerCase();
    let typeError: string | null = null;

    if (fieldType === 'image') {
      if (!fileType.startsWith('image/')) {
        typeError = 'Please upload an image file';
      }
    } else if (fieldType === 'multimedia') {
      // 目前 accept 只允许 mp4
      if (fileType !== 'video/mp4') {
        typeError = 'Please upload an MP4 video file';
      }
    } else if (fieldType === 'audio') {
      const isAudioMime = fileType.startsWith('audio/');
      const audioExts = ['.mp3', '.m4a', '.wav', '.ogg'];
      const hasAllowedExt = audioExts.some((ext) => fileName.endsWith(ext));
      if (!isAudioMime && !hasAllowedExt) {
        typeError = 'Please upload an audio file';
      }
    } else if (fieldType === 'file') {
      const allowedExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
      const hasAllowedExt = allowedExts.some((ext) => fileName.endsWith(ext));
      if (!hasAllowedExt) {
        typeError = 'Please upload a supported document file';
      }
    }

    if (typeError) {
      setError(typeError);
      if (onShowToast) {
        onShowToast(typeError, 'error');
      } else {
        message.error(typeError);
      }
      // 重置 input，避免选择同一个错误文件时 onChange 不触发
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Check authentication status
    if (authLoading) {
      const msg = 'Please wait while we verify your authentication...';
      setError(msg);
      if (onShowToast) {
        onShowToast(msg, 'error');
      } else {
        message.error(msg);
      }
      return;
    }

    if (!isAuthenticated) {
      const msg = 'Please sign in to upload files';
      setError(msg);
      if (onShowToast) {
        onShowToast(msg, 'error');
      } else {
        message.error(msg);
      }
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
      const msg = e?.message || 'Upload failed';
      setError(msg);
      if (onShowToast) {
        onShowToast(msg, 'error');
      } else {
        message.error(msg);
      }
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
      const msg = e?.message || 'Failed to delete file';
      setError(msg);
      if (onShowToast) {
        onShowToast(msg, 'error');
      } else {
        message.error(msg);
      }
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

  const uploadLabel =
    fieldType === 'image'
      ? 'upload image'
      : fieldType === 'multimedia'
      ? 'upload video'
      : fieldType === 'audio'
      ? 'upload audio'
      : 'upload file';

  const acceptTypes =
    fieldType === 'image'
      ? 'image/*'
      : fieldType === 'multimedia'
      ? 'video/mp4'
      : fieldType === 'audio'
      ? '.mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg'
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
          <Image src={assetFileUploadIcon} alt="" width={16} height={16} className="icon-16" />
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
                  width={20}
                  height={20}
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
                <Image src={assetFileIcon} alt="" width={16} height={16} className="icon-16" />
              </div>
            )}
            <Tooltip
              title={value.fileName}
              placement="topLeft"
              mouseEnterDelay={0.5}
              getPopupContainer={getTooltipPopupContainer}
            >
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

      {/* 使用全局 toast 提示错误，这里不再单独渲染错误文本 */}

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

