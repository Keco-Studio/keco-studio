import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUserId } from './authorizationService';
import {
  finalizeProjectStorage,
  releaseProjectStorage,
  reserveProjectStorage,
} from '@/lib/storageQuota';
import type { StorageSourceKind } from '@/lib/types/accountStorage';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Video (for multimedia fields)
  'video/mp4',
  // Audio (for audio fields)
  'audio/mpeg', // .mp3
  'audio/mp4',  // .m4a (common MIME)
  'audio/x-m4a', // some browsers use this for .m4a
  'audio/wav',
  'audio/ogg',
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
  /** Present only while an upload reservation is being coordinated; never persist it. */
  reservationId?: string;
};

export type MediaFileUploadContext = {
  userId: string;
  projectId: string;
  sourceKind: Extract<StorageSourceKind, 'library_media' | 'document_image'>;
  sourceEntityId?: string | null;
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

export function isImageFile(fileType: string | undefined | null): boolean {
  if (!fileType) return false;
  return fileType.startsWith('image/');
}

export async function uploadMediaFile(
  supabase: SupabaseClient,
  file: File,
  context: MediaFileUploadContext | string
): Promise<MediaFileMetadata> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error('Storage bucket is not configured');
  }

  const legacyUserId = typeof context === 'string' ? context : null;
  const { userId, projectId, sourceKind, sourceEntityId = null } = typeof context === 'string'
    ? { userId: context, projectId: null, sourceKind: 'library_media' as const, sourceEntityId: null }
    : context;

  // Verify user is authenticated and matches the provided userId
  const currentUserId = await getCurrentUserId(supabase);
  if (currentUserId !== userId) {
    throw new Error('Unauthorized: You can only upload files to your own folder');
  }

  const validation = validateMediaFile(file);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid file');
  }

  // Keep the historical helper contract working for non-project callers while
  // all project-aware callers use the reservation path below.
  if (legacyUserId) {
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${legacyUserId}/${timestamp}-${sanitizedFileName}`;
    const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error || !data?.path) throw new Error(error?.message || 'Upload failed. Please try again.');
    const url = supabase.storage.from(bucket).getPublicUrl(data.path)?.data?.publicUrl;
    if (!url) throw new Error('Public URL not available. Check bucket permissions.');
    return { url, path: data.path, fileName: file.name, fileSize: file.size, fileType: file.type, uploadedAt: new Date().toISOString() };
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_') || 'file';
  const filePath = `${userId}/${projectId}/${globalThis.crypto.randomUUID()}-${sanitizedFileName}`;
  const storage = supabase.storage.from(bucket);
  let reservationId: string | null = null;
  let uploadedPath: string | null = null;

  try {
    const reservation = await reserveProjectStorage(supabase, {
      projectId,
      bucketId: bucket,
      objectPath: filePath,
      expectedBytes: file.size,
      displayName: file.name,
      mimeType: file.type,
      sourceKind,
      sourceEntityId,
    });
    reservationId = reservation.reservationId;

    const { data, error } = await storage.upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error || !data?.path) {
      throw new Error(error?.message || 'Upload failed. Please try again.');
    }
    uploadedPath = data.path;

    const { data: rawInfo, error: infoError } = await storage.info(data.path);
    if (infoError || !rawInfo) {
      throw new Error('Uploaded file could not be verified.');
    }
    const info = rawInfo as unknown as Record<string, unknown>;
    const metadata = info.metadata as Record<string, unknown> | undefined;
    const actualSize = Number(info.size ?? metadata?.size);
    if (!Number.isSafeInteger(actualSize) || actualSize < 1 || actualSize !== file.size) {
      throw new Error('Uploaded file size could not be verified.');
    }
    const objectCreatedAt = typeof info.created_at === 'string'
      ? info.created_at
      : typeof info.createdAt === 'string'
        ? info.createdAt
        : new Date().toISOString();
    const publicUrlResult = storage.getPublicUrl(data.path);
    const url = publicUrlResult?.data?.publicUrl;
    if (!url) {
      throw new Error('Public URL not available. Check bucket permissions.');
    }

    await finalizeProjectStorage(supabase, {
      reservationId,
      actualBytes: actualSize,
      sourceEntityId,
      objectCreatedAt,
    });
    reservationId = null;

    return {
      url,
      path: data.path,
      fileName: file.name,
      fileSize: actualSize,
      fileType: file.type,
      uploadedAt: objectCreatedAt,
    };
  } catch (error) {
    if (uploadedPath) {
      try {
        await storage.remove([uploadedPath]);
      } catch {
        // Reconciliation will repair the registry if object cleanup is unavailable.
      }
    }
    if (reservationId) {
      try {
        await releaseProjectStorage(supabase, reservationId);
      } catch {
        // Reservations expire and are reconciled if an explicit release fails.
      }
    }
    throw error;
  }
}

export async function deleteMediaFile(
  supabase: SupabaseClient,
  filePath: string
): Promise<void> {
  const bucket = getBucketName();
  
  // Verify user is authenticated
  const currentUserId = await getCurrentUserId(supabase);
  
  // New paths are {userId}/{projectId}/{filename}; keep legacy two-part paths deletable.
  const pathParts = filePath.split('/');
  if (pathParts.length < 2 || (pathParts.length < 3 && pathParts[0] !== currentUserId)) {
    throw new Error('Unauthorized: You can only delete your own files');
  }

  const storage = supabase.storage.from(bucket);
  const { error } = await storage.remove([filePath]);

  if (error) {
    throw new Error(error.message || 'Failed to delete file');
  }

  // Supabase Storage may report success when RLS caused DELETE to affect zero rows.
  const verification = await storage.info(filePath);
  if (!verification.error && verification.data) {
    throw new Error('Failed to delete file');
  }

  if (pathParts.length < 3) return;

  const { error: settlementError } = await supabase.rpc(
    'settle_project_storage_file_deletion',
    { p_bucket_id: bucket, p_object_path: filePath }
  );
  if (settlementError) {
    throw new Error(settlementError.message || 'File deleted, but storage usage could not be settled');
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

export function getFileIcon(fileType: string | undefined | null): string {
  if (!fileType) return '📎';
  
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
