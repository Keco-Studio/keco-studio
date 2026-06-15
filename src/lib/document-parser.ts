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
 * Parse a supported design document into plain text. Throws for unsupported or
 * legacy formats so the caller can show the error.
 */
export async function parseDocument(file: File): Promise<string> {
  const ext = getExtension(file.name);

  switch (ext) {
    case 'txt':
    case 'md':
      return await file.text();

    case 'docx': {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    }

    case 'doc':
      throw new Error('Legacy .doc is not supported. Please convert it to .docx or .txt.');

    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
