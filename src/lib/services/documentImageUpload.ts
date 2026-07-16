/**
 * Upload images extracted from a design document to the shared media bucket so a
 * multimodal model can read them by public URL. Reuses `uploadMediaFile`
 * (bucket `library-media-files`, permanent public URLs) — the same path used by
 * MediaCell — and is best-effort: a single failed upload is skipped so the rest
 * of the document can still be processed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteMediaFile,
  uploadMediaFile,
} from './mediaFileUploadService';
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

export type UploadedDocumentImage = {
  placeholder: string;
  url: string;
  storagePath: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cleanupUploadedDocumentImages(
  supabase: SupabaseClient,
  images: readonly UploadedDocumentImage[]
): Promise<void> {
  const failures: string[] = [];
  for (const image of images) {
    try {
      await deleteMediaFile(supabase, image.storagePath);
    } catch (error) {
      failures.push(`${image.storagePath}: ${errorMessage(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Image cleanup failed (${failures.join('; ')})`);
  }
}

/**
 * Upload an import's embedded images as one logical operation. Unlike the
 * legacy best-effort helper below, any failure rolls back objects uploaded by
 * this call and preserves the exact DOCX placeholder mapping.
 */
export async function uploadDocumentImagesAtomically(
  supabase: SupabaseClient,
  images: readonly ExtractedImage[],
  userId: string
): Promise<UploadedDocumentImage[]> {
  const placeholders = images.map((image) => image.placeholder?.trim() ?? '');
  if (placeholders.some((placeholder) => !placeholder)) {
    throw new Error('Imported document image is missing its position marker');
  }
  if (new Set(placeholders).size !== placeholders.length) {
    throw new Error('Imported document image position markers must be unique');
  }

  const uploaded: UploadedDocumentImage[] = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]!;
      const ext = extFromContentType(image.contentType);
      const file = new File(
        [image.data],
        `document-import-${Date.now()}-${index}.${ext}`,
        { type: image.contentType }
      );
      const metadata = await uploadMediaFile(supabase, file, userId);
      uploaded.push({
        placeholder: placeholders[index]!,
        url: metadata.url,
        storagePath: metadata.path,
      });
    }
    return uploaded;
  } catch (uploadError) {
    try {
      await cleanupUploadedDocumentImages(supabase, uploaded);
    } catch (cleanupError) {
      throw new Error(
        `Image upload failed: ${errorMessage(uploadError)}; ${errorMessage(cleanupError)}`,
        { cause: uploadError }
      );
    }
    throw uploadError;
  }
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
