/**
 * Client-side design-document parsing.
 *
 * Documents are parsed in the browser (no upload to the server): plain text and
 * markdown are read directly, while `.docx` is converted via mammoth. Legacy
 * `.doc` is intentionally unsupported.
 */

export const MAX_DESIGN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Extensions accepted by the design-upload flow. */
export const SUPPORTED_DESIGN_EXTENSIONS = ['txt', 'md', 'docx'] as const;

/** Soft threshold above which the UI warns about slow agent processing. */
export const LARGE_DESIGN_TEXT_THRESHOLD = 100 * 1024; // 100KB

export interface DesignFileValidation {
  ok: boolean;
  error?: string;
}

/** An image extracted from a document, ready to be uploaded for the model. */
export interface ExtractedImage {
  data: ArrayBuffer;
  contentType: string; // e.g. 'image/png'
}

/** Result of parsing a design document: plain text plus any embedded images. */
export interface ParsedDocument {
  text: string;
  images: ExtractedImage[];
}

/** Content types the multimodal model accepts; everything else is dropped. */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** Skip tiny decorative images (icons, bullets, separators). */
export const MIN_IMAGE_BYTES = 5 * 1024;
/** Per-image upper bound (matches uploadMediaFile's 5MB limit). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Cap the number of images per document to bound token cost and request size. */
export const MAX_DOC_IMAGES = 20;

/**
 * Apply the supported-type / size / count rules to raw extracted images.
 * Order is preserved; the first `MAX_DOC_IMAGES` survivors are kept.
 */
export function filterExtractedImages(images: ExtractedImage[]): ExtractedImage[] {
  const kept: ExtractedImage[] = [];
  for (const image of images) {
    if (!SUPPORTED_IMAGE_TYPES.includes(image.contentType)) continue;
    const size = image.data.byteLength;
    if (size < MIN_IMAGE_BYTES || size > MAX_IMAGE_BYTES) continue;
    kept.push(image);
    if (kept.length >= MAX_DOC_IMAGES) break;
  }
  return kept;
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Validate a file before parsing: extension, size, and emptiness. Returns a
 * structured result so the caller can surface a precise message.
 */
export function validateDesignFile(file: File): DesignFileValidation {
  const ext = getExtension(file.name);

  if (ext === 'doc') {
    return { ok: false, error: 'Legacy .doc is not supported. Please convert it to .docx or .txt.' };
  }

  if (!SUPPORTED_DESIGN_EXTENSIONS.includes(ext as (typeof SUPPORTED_DESIGN_EXTENSIONS)[number])) {
    return { ok: false, error: 'Unsupported file type. Only .txt, .md, and .docx are allowed.' };
  }

  if (file.size === 0) {
    return { ok: false, error: 'The file is empty.' };
  }

  if (file.size > MAX_DESIGN_FILE_SIZE) {
    return { ok: false, error: 'The file is too large (limit is 10MB).' };
  }

  return { ok: true };
}

/**
 * Parse a supported design document into plain text plus any embedded images.
 * Throws for unsupported or legacy formats so the caller can show the error.
 *
 * For `.docx` the text is taken from mammoth's raw-text extractor (cleaner than
 * HTML), while images are collected in a separate `convertToHtml` pass whose
 * HTML output is discarded — we only use the `convertImage` side effect.
 */
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const ext = getExtension(file.name);

  switch (ext) {
    case 'txt':
    case 'md':
      return { text: await file.text(), images: [] };

    case 'docx': {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const images = await extractDocxImages(mammoth, arrayBuffer);
      return { text: result.value, images: filterExtractedImages(images) };
    }

    case 'doc':
      throw new Error('Legacy .doc is not supported. Please convert it to .docx or .txt.');

    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

/**
 * Collect embedded images from a .docx by abusing mammoth's `convertImage`
 * handler as a visitor. The returned HTML is ignored; we only keep the buffers
 * and content types pushed during conversion. Best-effort: a conversion failure
 * yields no images rather than blocking text parsing.
 */
async function extractDocxImages(
  mammoth: typeof import('mammoth'),
  arrayBuffer: ArrayBuffer
): Promise<ExtractedImage[]> {
  const collected: ExtractedImage[] = [];
  try {
    await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          try {
            const data = await image.readAsArrayBuffer();
            collected.push({ data, contentType: image.contentType });
          } catch {
            // best-effort: skip an image that cannot be read
          }
          // The HTML is discarded, so the returned src is irrelevant.
          return { src: '' };
        }),
      }
    );
  } catch {
    // best-effort: if HTML conversion fails entirely, return whatever we have
  }
  return collected;
}
