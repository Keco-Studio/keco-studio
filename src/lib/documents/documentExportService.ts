import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseValidatedSanctionedMdx } from './sanctionedMdx';
import type { SanctionedMdxAstNode } from './sanctionedMdxParser';
import { DocumentAccessError } from './documentStateTypes';

export type DocumentExportTextRun = {
  type: 'text';
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  code?: true;
  link?: string;
};

export type DocumentExportImage = {
  type: 'image';
  alt: string;
  url: string;
};

export type DocumentExportInline = DocumentExportTextRun | DocumentExportImage;

export type DocumentExportBlock =
  | { type: 'heading'; level: number; content: DocumentExportInline[] }
  | { type: 'paragraph'; content: DocumentExportInline[] }
  | { type: 'quote'; content: DocumentExportInline[] }
  | {
      type: 'list-item';
      children: DocumentExportBlock[];
      ordered: boolean;
      level: number;
      index: number;
    }
  | { type: 'table'; rows: DocumentExportInline[][][] }
  | { type: 'code'; language: string; text: string }
  | {
      type: 'callout';
      component: 'Callout' | 'Details';
      label: string;
      children: DocumentExportBlock[];
    };

export type DocumentExportModel = { blocks: DocumentExportBlock[] };
export type DocumentExportFormat = 'docx' | 'pdf';

type InlineStyle = Omit<DocumentExportTextRun, 'type' | 'text'>;
type ResolvedImage = {
  data: Buffer;
  type: 'jpg' | 'png';
  width: number;
  height: number;
};
type PdfUnicodeFont = {
  hasGlyphForCodePoint: (codePoint: number) => boolean;
};
type PdfUnicodeFonts = {
  regular: PdfUnicodeFont;
  bold: PdfUnicodeFont;
};

const MAX_REMOTE_IMAGES = 20;
const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 5_000;
const MAX_IMAGE_WIDTH = 480;
const MAX_IMAGE_HEIGHT = 360;
const MAX_SOURCE_IMAGE_DIMENSION = 10_000;
const MAX_SOURCE_IMAGE_PIXELS = 16_000_000;
const IMAGE_RESOLUTION_WORKERS = 2;
const PDF_UNICODE_REGULAR_FONT = path.join(
  process.cwd(),
  'src',
  'assets',
  'fonts',
  'NotoSansSC-Regular.otf'
);
const PDF_UNICODE_BOLD_FONT = path.join(
  process.cwd(),
  'src',
  'assets',
  'fonts',
  'NotoSansSC-Bold.otf'
);
const TRUSTED_STORAGE_PREFIX = [
  'storage',
  'v1',
  'object',
  'public',
  'library-media-files',
] as const;

type TrustedMediaConfiguration = {
  configuredValue: string;
  environment: string;
  origin: string;
  permitsHttp: boolean;
};

let trustedMediaConfiguration: TrustedMediaConfiguration | null | undefined;
let trustedMediaConfigurationKey: string | undefined;
let pdfUnicodeFontsPromise: Promise<PdfUnicodeFonts> | undefined;

export class DocumentExportConversionError extends Error {
  constructor(message = 'Document export conversion failed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentExportConversionError';
  }
}

function sameStyle(left: DocumentExportTextRun, right: DocumentExportTextRun): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.code === right.code &&
    left.link === right.link
  );
}

function appendText(
  output: DocumentExportInline[],
  text: string,
  style: InlineStyle
): void {
  if (!text) return;
  const run: DocumentExportTextRun = { type: 'text', text, ...style };
  const previous = output[output.length - 1];
  if (previous?.type === 'text' && sameStyle(previous, run)) {
    previous.text += text;
    return;
  }
  output.push(run);
}

function astChildren(node: SanctionedMdxAstNode): readonly SanctionedMdxAstNode[] {
  return node.children ?? [];
}

function collectAstDefinitions(root: SanctionedMdxAstNode): Map<string, string> {
  const definitions = new Map<string, string>();
  const visit = (node: SanctionedMdxAstNode) => {
    if (node.type === 'definition' && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
    for (const child of astChildren(node)) visit(child);
  };
  visit(root);
  return definitions;
}

function astInline(
  nodes: readonly SanctionedMdxAstNode[],
  definitions: ReadonlyMap<string, string>,
  inherited: InlineStyle = {}
): DocumentExportInline[] {
  const output: DocumentExportInline[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      appendText(output, node.value ?? '', inherited);
    } else if (node.type === 'emphasis') {
      output.push(...astInline(astChildren(node), definitions, { ...inherited, italic: true }));
    } else if (node.type === 'strong') {
      output.push(...astInline(astChildren(node), definitions, { ...inherited, bold: true }));
    } else if (node.type === 'inlineCode') {
      appendText(output, node.value ?? '', { ...inherited, code: true });
    } else if (node.type === 'break') {
      appendText(output, '\n', inherited);
    } else if (node.type === 'link' && node.url) {
      output.push(...astInline(astChildren(node), definitions, { ...inherited, link: node.url }));
    } else if (node.type === 'linkReference' && node.identifier) {
      const link = definitions.get(node.identifier.toLowerCase());
      output.push(...astInline(astChildren(node), definitions, link ? { ...inherited, link } : inherited));
    } else if (node.type === 'image' && node.url) {
      output.push({ type: 'image', alt: node.alt ?? '', url: node.url });
    } else if (node.type === 'imageReference' && node.identifier) {
      const url = definitions.get(node.identifier.toLowerCase());
      if (url) output.push({ type: 'image', alt: node.alt ?? '', url });
    } else if (node.type === 'mdxJsxTextElement' && node.name === 'u') {
      output.push(...astInline(astChildren(node), definitions, { ...inherited, underline: true }));
    } else if (node.children) {
      output.push(...astInline(astChildren(node), definitions, inherited));
    }
  }
  return output;
}

function componentLabel(node: SanctionedMdxAstNode): string {
  const attributes = new Map(
    (node.attributes ?? [])
      .filter((attribute) => typeof attribute.name === 'string' && typeof attribute.value === 'string')
      .map((attribute) => [attribute.name as string, attribute.value as string])
  );
  return node.name === 'Callout'
    ? attributes.get('title') ?? attributes.get('type') ?? 'Callout'
    : attributes.get('summary') ?? 'Details';
}

function astBlocks(
  nodes: readonly SanctionedMdxAstNode[],
  definitions: ReadonlyMap<string, string>,
  listLevel = 0
): DocumentExportBlock[] {
  const blocks: DocumentExportBlock[] = [];
  for (const node of nodes) {
    if (node.type === 'definition' || node.type === 'thematicBreak') continue;
    if (node.type === 'heading') {
      blocks.push({ type: 'heading', level: node.depth ?? 1, content: astInline(astChildren(node), definitions) });
    } else if (node.type === 'paragraph') {
      blocks.push({ type: 'paragraph', content: astInline(astChildren(node), definitions) });
    } else if (node.type === 'blockquote') {
      for (const child of astChildren(node)) {
        if (child.type === 'paragraph') {
          blocks.push({ type: 'quote', content: astInline(astChildren(child), definitions) });
        } else {
          blocks.push(...astBlocks([child], definitions, listLevel));
        }
      }
    } else if (node.type === 'list') {
      const ordered = Boolean(node.ordered);
      const start = node.start ?? 1;
      for (const [itemIndex, item] of astChildren(node).entries()) {
        const itemChildren: DocumentExportBlock[] = [];
        for (const child of astChildren(item)) {
          if (child.type === 'paragraph') {
            itemChildren.push({
              type: 'paragraph',
              content: astInline(astChildren(child), definitions),
            });
          } else if (child.type === 'list') {
            itemChildren.push(...astBlocks([child], definitions, listLevel + 1));
          } else {
            itemChildren.push(...astBlocks([child], definitions, listLevel));
          }
        }
        blocks.push({
          type: 'list-item',
          children: itemChildren,
          ordered,
          level: Math.min(8, listLevel),
          index: start + itemIndex,
        });
      }
    } else if (node.type === 'table') {
      blocks.push({
        type: 'table',
        rows: astChildren(node).map((row) =>
          astChildren(row).map((cell) => astInline(astChildren(cell), definitions))
        ),
      });
    } else if (node.type === 'code') {
      blocks.push({ type: 'code', language: node.lang ?? '', text: node.value ?? '' });
    } else if (node.type === 'mdxJsxFlowElement') {
      blocks.push({
        type: 'callout',
        component: node.name as 'Callout' | 'Details',
        label: componentLabel(node),
        children: astBlocks(astChildren(node), definitions, listLevel),
      });
    }
  }
  return blocks;
}

export function buildDocumentExportModel(markdown: string): DocumentExportModel {
  const root = parseValidatedSanctionedMdx(markdown);
  return { blocks: astBlocks(astChildren(root), collectAstDefinitions(root)) };
}

export function sanitizeExportFileName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[\\/]/g, ' - ')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return sanitized || 'document';
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '[::1]') return true;
  const octets = normalized.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => /^\d{1,3}$/.test(octet));
}

function configuredTrustedMedia(): TrustedMediaConfiguration | null {
  const configuredValue = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const environment = process.env.NODE_ENV ?? '';
  const cacheKey = `${environment}\u0000${configuredValue}`;
  if (
    trustedMediaConfigurationKey === cacheKey &&
    trustedMediaConfiguration !== undefined
  ) {
    return trustedMediaConfiguration;
  }
  trustedMediaConfigurationKey = cacheKey;
  if (!configuredValue) {
    trustedMediaConfiguration = null;
    return null;
  }
  try {
    const configured = new URL(configuredValue);
    const isLoopback = isLoopbackHostname(configured.hostname);
    const permitsHttp =
      environment !== 'production' &&
      configured.protocol === 'http:' &&
      isLoopback;
    if (
      configured.username ||
      configured.password ||
      configured.hash ||
      (environment === 'production' && isLoopback) ||
      (configured.protocol !== 'https:' && !permitsHttp)
    ) {
      trustedMediaConfiguration = null;
      return null;
    }
    trustedMediaConfiguration = {
      configuredValue,
      environment,
      origin: configured.origin,
      permitsHttp,
    };
    return trustedMediaConfiguration;
  } catch {
    trustedMediaConfiguration = null;
    return null;
  }
}

function rawPathSegments(value: string): string[] | null {
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(value);
  if (!match) return null;
  const pathname = match[1] ?? '/';
  try {
    return pathname.split('/').slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function trustedMediaUrl(value: string): boolean {
  const configured = configuredTrustedMedia();
  if (!configured || value !== value.trim() || value.includes('\\') || value.includes('#')) {
    return false;
  }
  try {
    const url = new URL(value);
    if (
      url.origin !== configured.origin ||
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' && !(configured.permitsHttp && url.protocol === 'http:'))
    ) {
      return false;
    }
    const segments = rawPathSegments(value);
    if (
      !segments ||
      segments.length <= TRUSTED_STORAGE_PREFIX.length ||
      segments.some((segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[\u0000-\u001f\u007f]/.test(segment) ||
        segment.includes('/') ||
        segment.includes('\\')
      )
    ) {
      return false;
    }
    return TRUSTED_STORAGE_PREFIX.every((segment, index) => segments[index] === segment);
  } catch {
    return false;
  }
}

function imageType(contentType: string, data: Buffer): ResolvedImage['type'] | null {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalized === 'image/png' && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (normalized === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) return 'jpg';
  return null;
}

function sourceImageDimensions(
  data: Buffer,
  type: ResolvedImage['type']
): { width: number; height: number } | null {
  if (
    type === 'png' &&
    data.length >= 24 &&
    data.readUInt32BE(8) === 13 &&
    data.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (type === 'jpg') {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1];
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = data.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > data.length) return null;
      if (
        ((marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)) &&
        length >= 7
      ) {
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  return null;
}

function safeSourceImageDimensions(
  dimensions: { width: number; height: number } | null
): dimensions is { width: number; height: number } {
  if (!dimensions) return false;
  const { width, height } = dimensions;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_SOURCE_IMAGE_DIMENSION &&
    height <= MAX_SOURCE_IMAGE_DIMENSION &&
    width * height <= MAX_SOURCE_IMAGE_PIXELS
  );
}

async function validateSourceImage(
  data: Buffer,
  type: ResolvedImage['type'],
  expected: { width: number; height: number }
): Promise<boolean> {
  try {
    const { default: sharp } = await import('sharp');
    const image = sharp(data, {
      failOn: 'warning',
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const expectedFormat = type === 'jpg' ? 'jpeg' : 'png';
    const matchesHeader = (
      metadata.format === expectedFormat &&
      metadata.width === expected.width &&
      metadata.height === expected.height
    );
    if (!matchesHeader) return false;
    await image.stats();
    return true;
  } catch {
    return false;
  }
}

function boundedImageDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : MAX_IMAGE_WIDTH;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 270;
  const scale = Math.min(1, MAX_IMAGE_WIDTH / safeWidth, MAX_IMAGE_HEIGHT / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

async function readBoundedResponse(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REMOTE_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REMOTE_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function fetchTrustedImage(url: string): Promise<ResolvedImage | null> {
  if (!trustedMediaUrl(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'image/png,image/jpeg' },
    });
    if (!response.ok) return null;
    const data = await readBoundedResponse(response);
    if (!data) return null;
    const type = imageType(response.headers.get('content-type') ?? '', data);
    if (!type) return null;
    const sourceDimensions = sourceImageDimensions(data, type);
    if (!safeSourceImageDimensions(sourceDimensions)) return null;
    if (!(await validateSourceImage(data, type, sourceDimensions))) return null;
    const dimensions = boundedImageDimensions(sourceDimensions.width, sourceDimensions.height);
    return { data, type, ...dimensions };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function modelImages(model: DocumentExportModel): DocumentExportImage[] {
  const images: DocumentExportImage[] = [];
  const collect = (content: readonly DocumentExportInline[]) => {
    for (const inline of content) if (inline.type === 'image') images.push(inline);
  };
  const visit = (blocks: readonly DocumentExportBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'code') continue;
      if (block.type === 'table') {
        for (const row of block.rows) for (const cell of row) collect(cell);
      } else if (block.type === 'callout') {
        visit(block.children);
      } else if (block.type === 'list-item') {
        visit(block.children);
      } else {
        collect(block.content);
      }
    }
  };
  visit(model.blocks);
  return images;
}

async function resolveModelImages(model: DocumentExportModel): Promise<Map<string, ResolvedImage | null>> {
  const urls = Array.from(new Set(modelImages(model).map((image) => image.url))).slice(0, MAX_REMOTE_IMAGES);
  const entries = new Array<readonly [string, ResolvedImage | null]>(urls.length);
  let nextIndex = 0;
  const workerCount = Math.min(IMAGE_RESOLUTION_WORKERS, urls.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      const url = urls[index]!;
      entries[index] = [url, await fetchTrustedImage(url)];
    }
  }));
  return new Map(entries);
}

function docxInlineChildren(
  docx: typeof import('docx'),
  content: readonly DocumentExportInline[],
  images: ReadonlyMap<string, ResolvedImage | null>,
  defaults: InlineStyle = {}
): import('docx').ParagraphChild[] {
  const children: import('docx').ParagraphChild[] = [];
  for (const inline of content) {
    if (inline.type === 'image') {
      const image = images.get(inline.url);
      if (image) {
        children.push(
          new docx.ImageRun({
            type: image.type,
            data: image.data,
            transformation: { width: image.width, height: image.height },
            altText: { name: inline.alt || 'Document image', description: inline.alt },
          })
        );
      } else {
        children.push(new docx.TextRun({ text: inline.alt || 'Image', italics: true }));
      }
      continue;
    }
    const style = { ...defaults, ...inline };
    const textRun = new docx.TextRun({
      text: inline.text,
      bold: style.bold,
      italics: style.italic,
      underline: style.underline ? { type: docx.UnderlineType.SINGLE } : undefined,
      font: style.code ? 'Courier New' : undefined,
    });
    children.push(
      inline.link ? new docx.ExternalHyperlink({ link: inline.link, children: [textRun] }) : textRun
    );
  }
  return children;
}

async function renderDocx(
  model: DocumentExportModel,
  images: ReadonlyMap<string, ResolvedImage | null>
): Promise<Buffer> {
  const docx = await import('docx');
  const headingLevels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ];
  const children: import('docx').FileChild[] = [];
  const appendBlocks = (blocks: readonly DocumentExportBlock[]) => {
   for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(
        new docx.Paragraph({
          children: docxInlineChildren(docx, block.content, images),
          heading: headingLevels[Math.min(block.level - 1, headingLevels.length - 1)],
        })
      );
    } else if (block.type === 'table') {
      children.push(
        new docx.Table({
          rows: block.rows.map(
            (row) =>
              new docx.TableRow({
                children: row.map(
                  (cell) =>
                    new docx.TableCell({
                      children: [new docx.Paragraph({ children: docxInlineChildren(docx, cell, images) })],
                    })
                ),
              })
          ),
        })
      );
    } else if (block.type === 'list-item') {
      const [first, ...rest] = block.children;
      if (first?.type === 'paragraph') {
        children.push(new docx.Paragraph({
          children: [
            ...(block.ordered
              ? [new docx.TextRun({ text: `${block.index}. ` })]
              : []),
            ...docxInlineChildren(docx, first.content, images),
          ],
          bullet: block.ordered ? undefined : { level: block.level },
          indent: block.ordered ? { left: 720 * (block.level + 1), hanging: 360 } : undefined,
        }));
      } else if (first) {
        appendBlocks([first]);
      }
      appendBlocks(rest);
    } else if (block.type === 'code') {
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: block.text, font: 'Courier New' })],
        })
      );
    } else if (block.type === 'callout') {
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: block.label, bold: true })],
          indent: { left: 360 },
          shading: { fill: 'F2F4F7', type: docx.ShadingType.CLEAR },
        })
      );
      appendBlocks(block.children);
    } else {
      children.push(
        new docx.Paragraph({
          children: docxInlineChildren(
            docx,
            block.content,
            images,
            block.type === 'quote' ? { italic: true } : {}
          ),
          indent: block.type === 'quote' ? { left: 360 } : undefined,
        })
      );
    }
   }
  };
  appendBlocks(model.blocks);
  const document = new docx.Document({
    numbering: {
      config: [
        {
          reference: 'document-numbering',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: docx.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: docx.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return docx.Packer.toBuffer(document);
}

function requiresUnicodePdfFont(text: string): boolean {
  return /[^\u0000-\u00ff]/.test(text);
}

function loadPdfUnicodeFonts(): Promise<PdfUnicodeFonts> {
  pdfUnicodeFontsPromise ??= import('fontkit').then((fontkit) => ({
    regular: fontkit.openSync(PDF_UNICODE_REGULAR_FONT) as PdfUnicodeFont,
    bold: fontkit.openSync(PDF_UNICODE_BOLD_FONT) as PdfUnicodeFont,
  }));
  return pdfUnicodeFontsPromise;
}

function assertPdfTextSupported(text: string, font: PdfUnicodeFont): void {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0xff || font.hasGlyphForCodePoint(codePoint)) continue;
    throw new DocumentExportConversionError(
      'PDF export does not support every character in this document. Export as DOCX to preserve the original text.'
    );
  }
}

async function assertPdfModelSupported(model: DocumentExportModel): Promise<void> {
  const fonts = await loadPdfUnicodeFonts();
  const visitInline = (
    content: readonly DocumentExportInline[],
    defaults: InlineStyle = {}
  ) => {
    for (const inline of content) {
      if (inline.type === 'image') {
        assertPdfTextSupported(inline.alt, fonts.regular);
        continue;
      }
      const font = inline.bold || defaults.bold ? fonts.bold : fonts.regular;
      assertPdfTextSupported(inline.text, font);
    }
  };
  const visitBlocks = (blocks: readonly DocumentExportBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'table') {
        for (const row of block.rows) for (const cell of row) visitInline(cell);
      } else if (block.type === 'code') {
        assertPdfTextSupported(block.text, fonts.regular);
      } else if (block.type === 'callout') {
        assertPdfTextSupported(block.label, fonts.bold);
        visitBlocks(block.children);
      } else if (block.type === 'list-item') {
        visitBlocks(block.children);
      } else {
        visitInline(
          block.content,
          block.type === 'heading' ? { bold: true } : {}
        );
      }
    }
  };
  visitBlocks(model.blocks);
}

function pdfFont(run: DocumentExportTextRun, defaults: InlineStyle): string {
  const bold = run.bold || defaults.bold;
  const italic = run.italic || defaults.italic;
  if (requiresUnicodePdfFont(run.text)) {
    return bold ? 'NotoSansSC-Bold' : 'NotoSansSC';
  }
  if (run.code || defaults.code) return 'Courier';
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function renderPdfInline(
  pdf: PDFKit.PDFDocument,
  content: readonly DocumentExportInline[],
  images: ReadonlyMap<string, ResolvedImage | null>,
  defaults: InlineStyle = {}
): void {
  const rendered = content.map((inline): DocumentExportInline => {
    if (inline.type === 'image' && !images.get(inline.url)) {
      return { type: 'text', text: inline.alt || 'Image', italic: true };
    }
    return inline;
  });
  for (let index = 0; index < rendered.length; index += 1) {
    const inline = rendered[index];
    if (inline.type === 'image') {
      const image = images.get(inline.url);
      if (image) pdf.image(image.data, { fit: [image.width, image.height] });
      continue;
    }
    const nextIsText = rendered[index + 1]?.type === 'text';
    pdf.font(pdfFont(inline, defaults)).text(inline.text, {
      continued: nextIsText,
      underline: Boolean(inline.underline || defaults.underline),
      link: inline.link,
    });
  }
}

async function renderPdf(
  model: DocumentExportModel,
  images: ReadonlyMap<string, ResolvedImage | null>
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 50, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    try {
      pdf.registerFont('NotoSansSC', PDF_UNICODE_REGULAR_FONT);
      pdf.registerFont('NotoSansSC-Bold', PDF_UNICODE_BOLD_FONT);
      const renderBlocks = (blocks: readonly DocumentExportBlock[]) => {
       for (const block of blocks) {
        if (block.type === 'table') {
          for (const row of block.rows) {
            const content = row.flatMap((cell, index) => [
              ...(index > 0 ? ([{ type: 'text', text: ' | ' }] as DocumentExportInline[]) : []),
              ...cell,
            ]);
            pdf.fontSize(10);
            renderPdfInline(pdf, content, images);
          }
          pdf.moveDown(0.5);
          continue;
        }
        if (block.type === 'code') {
          pdf
            .font(requiresUnicodePdfFont(block.text) ? 'NotoSansSC' : 'Courier')
            .fontSize(10)
            .text(block.text)
            .moveDown(0.35);
          continue;
        }
        const initialX = pdf.x;
        const indent = block.type === 'quote' || block.type === 'callout' ? 18 : 0;
        pdf.x = initialX + indent;
        if (block.type === 'list-item') {
          pdf.x = initialX + block.level * 18;
          const [first, ...rest] = block.children;
          if (first?.type === 'paragraph') {
            pdf.font('Helvetica').fontSize(11).text(block.ordered ? `${block.index}. ` : '- ', { continued: true });
            renderPdfInline(pdf, first.content, images);
          } else if (first) {
            renderBlocks([first]);
          }
          renderBlocks(rest);
        } else if (block.type === 'callout') {
          pdf
            .font(requiresUnicodePdfFont(block.label) ? 'NotoSansSC-Bold' : 'Helvetica-Bold')
            .fontSize(11)
            .text(block.label);
          renderBlocks(block.children);
        } else {
          pdf.fontSize(block.type === 'heading' ? Math.max(12, 24 - block.level * 2) : 11);
          renderPdfInline(
            pdf,
            block.content,
            images,
            block.type === 'heading' ? { bold: true } : block.type === 'quote' ? { italic: true } : {}
          );
        }
        pdf.x = initialX;
        pdf.moveDown(0.35);
       }
      };
      renderBlocks(model.blocks);
      pdf.end();
    } catch (error) {
      pdf.destroy();
      reject(error);
    }
  });
}

export async function renderDocumentExportModel(
  model: DocumentExportModel,
  format: DocumentExportFormat
): Promise<Buffer> {
  if (format === 'pdf') await assertPdfModelSupported(model);
  const images = await resolveModelImages(model);
  try {
    return format === 'docx' ? await renderDocx(model, images) : await renderPdf(model, images);
  } catch (error) {
    throw new DocumentExportConversionError(undefined, { cause: error });
  }
}

export async function exportDocument(
  client: SupabaseClient,
  documentId: string,
  format: DocumentExportFormat
): Promise<{ bytes: Buffer; mediaType: string; fileName: string }> {
  const metadata = await client.from('documents').select('name').eq('id', documentId).single();
  if (metadata.error || !metadata.data) {
    if (!metadata.error || metadata.error.code === 'PGRST116' || metadata.error.code === '42501') {
      throw new DocumentAccessError();
    }
    throw metadata.error;
  }
  const { documentStateGateway } = await import('./documentStateGateway');
  const state = await documentStateGateway.read(client, documentId);
  const model = buildDocumentExportModel(state.markdown);
  const bytes = await renderDocumentExportModel(model, format);
  return {
    bytes,
    mediaType:
      format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    fileName: `${sanitizeExportFileName((metadata.data as { name: string }).name)}.${format}`,
  };
}
