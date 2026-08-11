/**
 * Client-side design-document parsing.
 *
 * Documents are parsed in the browser (no upload to the server): plain text and
 * markdown are read directly, while `.docx` is converted via mammoth. Legacy
 * `.doc` is intentionally unsupported.
 */

import TurndownService from 'turndown';
import {
  highlightedCodeBlock,
  strikethrough,
  tables,
  taskListItems,
} from '@joplin/turndown-plugin-gfm';

function applyJoplinGfm(service: TurndownService): void {
  const plugins = [highlightedCodeBlock, strikethrough, tables, taskListItems].filter(
    (plugin): plugin is (turndown: TurndownService) => void => typeof plugin === 'function'
  );
  if (plugins.length > 0) {
    service.use(plugins);
  }
}

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
  /** Stable URL-shaped sentinel retained in DOCX Markdown until upload succeeds. */
  placeholder?: string;
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

function safeImportedUrl(value: string, kind: 'link' | 'image'): boolean {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized !== value ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.includes('\\')
  ) {
    return false;
  }
  if (kind === 'link' && /^\/(?!\/)/.test(normalized)) return true;
  try {
    return new URL(normalized).protocol === 'https:';
  } catch {
    return false;
  }
}

function markdownDestination(value: string): string {
  return value.replace(/([()])/g, '\\$1');
}

/**
 * Treat braces in plain imported documents as literal text instead of MDX
 * expressions. Code blocks and inline code are left byte-for-byte unchanged.
 */
export function escapeLiteralMdxBraces(markdown: string): string {
  let fenceCharacter: '`' | '~' | null = null;
  let fenceLength = 0;

  return markdown
    .split('\n')
    .map((line) => {
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/);
      if (fenceCharacter) {
        if (
          fence &&
          fence[1][0] === fenceCharacter &&
          fence[1].length >= fenceLength
        ) {
          fenceCharacter = null;
          fenceLength = 0;
        }
        return line;
      }

      if (fence) {
        fenceCharacter = fence[1][0] as '`' | '~';
        fenceLength = fence[1].length;
        return line;
      }

      let inlineCodeLength = 0;
      let escaped = '';
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '`') {
          let runLength = 1;
          while (line[index + runLength] === '`') runLength += 1;
          escaped += line.slice(index, index + runLength);
          if (inlineCodeLength === 0) {
            inlineCodeLength = runLength;
          } else if (runLength === inlineCodeLength) {
            inlineCodeLength = 0;
          }
          index += runLength - 1;
          continue;
        }

        if (
          character === '\\' &&
          (line[index + 1] === '{' || line[index + 1] === '}')
        ) {
          escaped += character + line[index + 1];
          index += 1;
          continue;
        }

        if (inlineCodeLength === 0 && (character === '{' || character === '}')) {
          escaped += `\\${character}`;
        } else {
          escaped += character;
        }
      }
      return escaped;
    })
    .join('\n');
}

/** Convert Mammoth's semantic HTML through a DOM parser-backed Markdown codec. */
export function convertDocumentHtmlToMarkdown(html: string): string {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  applyJoplinGfm(service);
  service.remove(['script', 'style', 'iframe', 'object', 'embed', 'form']);
  service.addRule('safeImportedLink', {
    filter: 'a',
    replacement(content, node) {
      const href = (node as HTMLElement).getAttribute('href') ?? '';
      if (!safeImportedUrl(href, 'link')) return content;
      const title = (node as HTMLElement).getAttribute('title');
      return `[${content}](${markdownDestination(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
  });
  service.addRule('safeImportedImage', {
    filter: 'img',
    replacement(_content, node) {
      const element = node as HTMLElement;
      const src = element.getAttribute('src') ?? '';
      const alt = (element.getAttribute('alt') ?? 'Imported image').replace(/[\[\]]/g, '');
      if (!safeImportedUrl(src, 'image')) return alt;
      return `![${alt}](${markdownDestination(src)})`;
    },
  });
  return service.turndown(html).trim();
}

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
 * DOCX files use Mammoth's semantic HTML conversion so block and inline
 * structure, including image positions, survives the import.
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
      return parseDocxHtml(mammoth, arrayBuffer);
    }

    case 'doc':
      throw new Error('Legacy .doc is not supported. Please convert it to .docx or .txt.');

    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

/**
 * Convert DOCX to semantic HTML once while collecting eligible embedded images.
 * URL-shaped sentinels are safe to validate as Markdown and can later be
 * replaced exactly with uploaded public URLs without moving the images.
 */
async function parseDocxHtml(
  mammoth: typeof import('mammoth'),
  arrayBuffer: ArrayBuffer
): Promise<ParsedDocument> {
  const collected: ExtractedImage[] = [];
  const nodeBuffer = typeof window === 'undefined'
    ? (
        globalThis as typeof globalThis & {
          Buffer?: { from(value: ArrayBuffer): unknown };
        }
      ).Buffer
    : undefined;
  const input = nodeBuffer
    ? { buffer: nodeBuffer.from(arrayBuffer) }
    : { arrayBuffer };
  const result = await mammoth.convertToHtml(
    input as Parameters<typeof mammoth.convertToHtml>[0],
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const data = await image.readAsArrayBuffer();
          const candidate = { data, contentType: image.contentType };
          if (filterExtractedImages([candidate]).length === 0 || collected.length >= MAX_DOC_IMAGES) {
            return { src: '' };
          }
          const placeholder = `https://document-import.invalid/${globalThis.crypto.randomUUID()}`;
          collected.push({ ...candidate, placeholder });
          return { src: placeholder, alt: `Imported image ${collected.length}` } as { src: string };
        } catch {
          return { src: '' };
        }
      }),
    }
  );
  const text = convertDocumentHtmlToMarkdown(result.value);
  return {
    text,
    images: collected,
  };
}
