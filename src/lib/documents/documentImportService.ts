import type { SupabaseClient } from '@supabase/supabase-js';
import {
  escapeLiteralMdxBraces,
  parseDocument,
  validateDesignFile,
} from '@/lib/document-parser';
import { getCurrentUserId } from '@/lib/services/authorizationService';
import {
  cleanupUploadedDocumentImages,
  uploadDocumentImagesAtomically,
  type UploadedDocumentImage,
} from '@/lib/services/documentImageUpload';
import type { DocumentRecord } from '@/lib/services/documentService';
import { validateSanctionedMdx } from './sanctionedMdx';
import {
  isDocumentImportDefinitelyUnpublished,
  publishImportedDocument,
} from './documentImportPublisher';

export type ImportedDocument = {
  document: DocumentRecord;
  markdown: string;
  sourceText: string;
  imageUrls: string[];
  skippedImageCount: number;
};

function extension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function documentNameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').trim();
  return name || 'Imported document';
}

export function buildImportedDocumentMarkdown(input: {
  fileName: string;
  text: string;
  imageUrls: readonly string[];
}): string {
  const sourceText = input.text.trim();
  if (!sourceText) throw new Error('Could not extract any text from this file.');

  const importedText = escapeLiteralMdxBraces(sourceText);

  const textParagraphs = importedText
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n');
  const body =
    extension(input.fileName) === 'txt'
      ? [`# ${documentNameFromFile(input.fileName)}`, '', textParagraphs].join('\n')
      : importedText;
  const images = input.imageUrls.map(
    (url, index) => `![Imported image ${index + 1}](${url})`
  );
  const markdown = [body, ...images].join('\n\n');
  validateSanctionedMdx(markdown);
  return markdown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertImagePositions(
  markdown: string,
  images: readonly { placeholder?: string }[]
): void {
  const positions = images.map((image) => image.placeholder?.trim() ?? '');
  if (
    positions.some((position) => !position) ||
    new Set(positions).size !== positions.length ||
    positions.some((position) => markdown.split(position).length !== 2)
  ) {
    throw new Error('Imported document image positions are invalid');
  }
}

function assertUploadedImagePositions(
  parsedImages: readonly { placeholder?: string }[],
  uploadedImages: readonly UploadedDocumentImage[]
): void {
  const expected = parsedImages.map((image) => image.placeholder?.trim() ?? '');
  const actual = uploadedImages.map((image) => image.placeholder.trim());
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.some((position, index) => position !== expected[index])
  ) {
    throw new Error('Uploaded document image positions are invalid');
  }
}

function replaceImagePositions(
  markdown: string,
  images: readonly UploadedDocumentImage[]
): string {
  return images.reduce(
    (current, image) => current.split(image.placeholder).join(image.url),
    markdown
  );
}

export async function createImportedDocument(
  client: SupabaseClient,
  input: {
    projectId: string;
    file: File;
    folderId?: string | null;
  }
): Promise<ImportedDocument> {
  const validation = validateDesignFile(input.file);
  if (!validation.ok) {
    throw new Error(validation.error ?? 'Invalid document file');
  }
  const parsed = await parseDocument(input.file);
  const provisionalMarkdown = buildImportedDocumentMarkdown({
    fileName: input.file.name,
    text: parsed.text,
    imageUrls: [],
  });
  assertImagePositions(provisionalMarkdown, parsed.images);

  let uploadedImages: UploadedDocumentImage[] = [];
  let publicationAttempted = false;
  const documentId = globalThis.crypto.randomUUID();
  const versionId = globalThis.crypto.randomUUID();

  try {
    if (parsed.images.length > 0) {
      const userId = await getCurrentUserId(client);
      uploadedImages = await uploadDocumentImagesAtomically(
        client,
        parsed.images,
        userId
      );
      assertUploadedImagePositions(parsed.images, uploadedImages);
    }
    const markdown = replaceImagePositions(provisionalMarkdown, uploadedImages);
    validateSanctionedMdx(markdown);
    publicationAttempted = true;
    const document = await publishImportedDocument(client, {
      documentId,
      versionId,
      projectId: input.projectId,
      folderId: input.folderId ?? null,
      name: documentNameFromFile(input.file.name),
      markdown,
    });

    return {
      document,
      markdown,
      sourceText: parsed.text.trim(),
      imageUrls: uploadedImages.map((image) => image.url),
      skippedImageCount: 0,
    };
  } catch (error) {
    const cleanupFailures: string[] = [];
    const canCleanupImages =
      !publicationAttempted || isDocumentImportDefinitelyUnpublished(error);
    if (uploadedImages.length > 0 && canCleanupImages) {
      try {
        await cleanupUploadedDocumentImages(client, uploadedImages);
      } catch (cleanupError) {
        cleanupFailures.push(errorMessage(cleanupError));
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        `${errorMessage(error)}; ${cleanupFailures.join('; ')}`,
        { cause: error }
      );
    }
    throw error;
  }
}
