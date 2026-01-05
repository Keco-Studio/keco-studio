import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUserId } from './authorizationService';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'tiptap-images';

export type ImageUploadResult = {
  url: string;
  path: string;
};

export type ImageValidationResult = {
  ok: boolean;
  error?: string;
};

export function validateImageFile(file: File | null): ImageValidationResult {
  if (!file) {
    return { ok: false, error: 'No file selected' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: 'Only JPEG, PNG, or WebP files are allowed.' };
  }

  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, error: 'File size must be 5MB or smaller.' };
  }

  return { ok: true };
}

export function getBucketName(): string {
  return DEFAULT_BUCKET;
}

export function buildMissingBucketMessage(bucket: string): string {
  return `Storage bucket "${bucket}" is not configured or accessible. Create it in Supabase or set NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET.`;
}

export async function uploadImageFile(
  supabase: SupabaseClient,
  file: File
): Promise<ImageUploadResult> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error(buildMissingBucketMessage('tiptap-images'));
  }

  // Verify user is authenticated
  const userId = await getCurrentUserId(supabase);

  const validation = validateImageFile(file);
  if (!validation.ok) {
    throw new Error(validation.error || 'Invalid file');
  }

  // Store files under user's folder: {userId}/{timestamp}-{filename}
  // This ensures users can only upload to their own folder
  const timestamp = Date.now();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uniqueKey = `${userId}/${timestamp}-${sanitizedFileName}`;

  const { data, error } = await supabase.storage.from(bucket).upload(uniqueKey, file, {
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

  return { url, path: data.path };
}

export function getAllowedTypes(): string[] {
  return ALLOWED_TYPES;
}

export function getMaxSizeBytes(): number {
  return MAX_SIZE_BYTES;
}

