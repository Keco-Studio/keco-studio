/**
 * Upload images extracted from a design document to the shared media bucket so a
 * multimodal model can read them by public URL. Reuses `uploadMediaFile`
 * (bucket `library-media-files`, permanent public URLs) — the same path used by
 * MediaCell — and is best-effort: a single failed upload is skipped so the rest
 * of the document can still be processed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadMediaFile } from './mediaFileUploadService';
import type { ExtractedImage } from '@/lib/document-parser';

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function extFromContentType(contentType: string): string {
  return EXT_BY_CONTENT_TYPE[contentType] ?? 'bin';
}

/**
 * Upload each extracted document image and return the resulting public URLs in
 * order. Images that fail to upload are skipped, so the returned array may be
 * shorter than the input.
 */
export async function uploadDocumentImages(
  supabase: SupabaseClient,
  images: ExtractedImage[],
  userId: string
): Promise<string[]> {
  const files = images.map((img, i) => {
    const ext = extFromContentType(img.contentType);
    return new File([img.data], `design-${Date.now()}-${i}.${ext}`, {
      type: img.contentType,
    });
  });
  return uploadImageFiles(supabase, files, userId);
}

/**
 * Upload image File objects (e.g. pasted/selected directly in the chat) and
 * return their public URLs in order. Non-image files are skipped, and a single
 * failed upload is skipped so the rest still go through.
 */
export async function uploadImageFiles(
  supabase: SupabaseClient,
  files: File[],
  userId: string
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const meta = await uploadMediaFile(supabase, file, userId);
      urls.push(meta.url);
    } catch {
      // best-effort: skip this image, keep the rest
    }
  }
  return urls;
}
