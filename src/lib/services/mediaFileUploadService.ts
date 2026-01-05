import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUserId } from './authorizationService';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
  'text/csv',
];

const DEFAULT_BUCKET = 'library-media-files';

export type MediaFileMetadata = {
  url: string;
  path: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
};

export type MediaFileValidationResult = {
  ok: boolean;
  error?: string;
};

export function validateMediaFile(file: File | null): MediaFileValidationResult {
  if (!file) {
    return { ok: false, error: 'No file selected' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: 'File type not supported. Allowed types: PDF, Word, Excel, PowerPoint, images, text files.',
    };
  }

  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, error: 'File size must be 5MB or smaller.' };
  }

  return { ok: true };
}

export function getBucketName(): string {
  return DEFAULT_BUCKET;
}

export function isImageFile(fileType: string): boolean {
  return fileType.startsWith('image/');
}

export async function uploadMediaFile(
  supabase: SupabaseClient,
  file: File,
  userId: string
): Promise<MediaFileMetadata> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error('Storage bucket is not configured');
  }

  // Verify user is authenticated and matches the provided userId
  const currentUserId = await getCurrentUserId(supabase);
  if (currentUserId !== userId) {
    throw new Error('Unauthorized: You can only upload files to your own folder');
  }

  const validation = validateMediaFile(file);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid file');
  }

  // Store files under user's folder: {userId}/{timestamp}-{filename}
  const timestamp = Date.now();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filePath = `${userId}/${timestamp}-${sanitizedFileName}`;

  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error || !data?.path) {
    const message = error?.message || 'Upload failed. Please try again.';
    throw new Error(message);
  }

  const publicUrlResult = supabase.storage.from(bucket).getPublicUrl(data.path);
  const url = publicUrlResult?.data?.publicUrl;

  if (!url) {
    throw new Error('Public URL not available. Check bucket permissions.');
  }

  return {
    url,
    path: data.path,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    uploadedAt: new Date().toISOString(),
  };
}

export async function deleteMediaFile(
  supabase: SupabaseClient,
  filePath: string
): Promise<void> {
  const bucket = getBucketName();
  
  // Verify user is authenticated
  const currentUserId = await getCurrentUserId(supabase);
  
  // Extract userId from file path (format: {userId}/{filename})
  const pathParts = filePath.split('/');
  if (pathParts.length < 2 || pathParts[0] !== currentUserId) {
    throw new Error('Unauthorized: You can only delete your own files');
  }

  const { error } = await supabase.storage.from(bucket).remove([filePath]);

  if (error) {
    throw new Error(error.message || 'Failed to delete file');
  }
}

export function getAllowedTypes(): string[] {
  return ALLOWED_TYPES;
}

export function getMaxSizeBytes(): number {
  return MAX_SIZE_BYTES;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getFileIcon(fileType: string): string {
  if (isImageFile(fileType)) {
    return '🖼️';
  }

  if (fileType.includes('pdf')) {
    return '📄';
  }

  if (fileType.includes('word') || fileType.includes('document')) {
    return '📝';
  }

  if (fileType.includes('excel') || fileType.includes('spreadsheet')) {
    return '📊';
  }

  if (fileType.includes('powerpoint') || fileType.includes('presentation')) {
    return '📽️';
  }

  if (fileType.includes('text') || fileType.includes('csv')) {
    return '📋';
  }

  return '📎';
}

