import mammoth from 'mammoth';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDocumentExportModel,
  exportDocument,
  renderDocumentExportModel,
  sanitizeExportFileName,
} from '../../../src/lib/documents/documentExportService';
import { resolveReferencesForPlainMarkdown } from '../../../src/lib/documents/resourceReferenceMarkdown';

const readDocumentState = jest.fn();
const resolveResourceReferences = jest.fn();

jest.mock('../../../src/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read: (...args: unknown[]) => readDocumentState(...args) },
}));
jest.mock('../../../src/lib/documents/resourceReferenceService', () => ({
  resolveResourceReferences: (...args: unknown[]) => resolveResourceReferences(...args),
}));

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIBRARY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FIELD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BLOCK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REFERENCE = `<ResourceReference kind="table-row" libraryId="${LIBRARY_ID}" assetId="${ASSET_ID}" displayFieldId="${FIELD_ID}" fallbackLabel="Old label" />`;
const ANCHOR = `<BlockAnchor id="${BLOCK_ID}" />`;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const BMP_1X1 = Buffer.from(
  'Qk1GAAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  'base64'
);
const WEBP_1X1 = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
  'base64'
);
const JPEG_1X1 = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAB//Z',
  'base64'
);

function pngWithDimensions(width: number, height: number): Buffer {
  const data = Buffer.from(PNG_1X1);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function jpegWithDimensions(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function truncatedPngWithDimensions(width: number, height: number): Buffer {
  const data = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function metadataClient(name = 'Export test'): SupabaseClient {
  const result = Promise.resolve({ data: { name }, error: null });
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => result),
  };
  return { from: jest.fn(() => query) } as unknown as SupabaseClient;
}

function extractUncompressedPdfText(bytes: Buffer): string {
  const pdf = bytes.toString('latin1');
  return Array.from(pdf.matchAll(/\[([^\]]*)\]\s*TJ|\(([^)]*)\)\s*Tj/g))
    .map((operator) => {
      if (operator[2] !== undefined) return operator[2].replace(/\\([()\\])/g, '$1');
      return Array.from(operator[1].matchAll(/<([0-9a-f]+)>|\(([^)]*)\)/gi))
        .map((token) =>
          token[1]
            ? Buffer.from(token[1], 'hex').toString('latin1')
            : token[2].replace(/\\([()\\])/g, '$1')
        )
        .join('');
    })
    .join(' ');
}

describe('document export service', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NODE_ENV = 'test';
    readDocumentState.mockReset();
    resolveResourceReferences.mockReset().mockResolvedValue(new Map());
    jest.restoreAllMocks();
  });

  it('resolves references once into readable links and removes block anchors', async () => {
    resolveResourceReferences.mockResolvedValue(new Map([
      [
        `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
        {
          key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
          status: 'available',
          label: 'Current value',
          contextLabel: 'Characters / Ada / Status',
          href: `/${PROJECT_ID}/${LIBRARY_ID}?asset=${ASSET_ID}`,
        },
      ],
    ]));

    const markdown = await resolveReferencesForPlainMarkdown(
      {} as SupabaseClient,
      PROJECT_ID,
      `# ${ANCHOR}Heading\n\nBefore ${REFERENCE} after.`
    );

    expect(resolveResourceReferences).toHaveBeenCalledTimes(1);
    expect(markdown).toContain('# Heading');
    expect(markdown).toContain(
      `[Current value](/${PROJECT_ID}/${LIBRARY_ID}?asset=${ASSET_ID} "Characters / Ada / Status")`
    );
    expect(markdown).toContain('Before ');
    expect(markdown).toContain(' after.');
    expect(markdown).not.toContain('BlockAnchor');
    expect(markdown).not.toContain('ResourceReference');
  });

  it('renders unavailable references as exact readable fallback text', async () => {
    resolveResourceReferences.mockResolvedValue(new Map([
      [
        `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
        {
          key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
          status: 'unavailable',
          label: 'Reference unavailable',
        },
      ],
    ]));

    const markdown = await resolveReferencesForPlainMarkdown(
      {} as SupabaseClient,
      PROJECT_ID,
      `See ${REFERENCE}.`
    );

    expect(markdown.trim()).toBe('See [Reference unavailable].');
  });

  it('keeps an outer Markdown link valid when its label contains a reference', async () => {
    resolveResourceReferences.mockResolvedValue(new Map([
      [
        `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
        {
          key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
          status: 'available',
          label: 'Current value',
          contextLabel: 'Characters / Ada / Status',
          href: `/${PROJECT_ID}/${LIBRARY_ID}?asset=${ASSET_ID}`,
        },
      ],
    ]));

    const markdown = await resolveReferencesForPlainMarkdown(
      {} as SupabaseClient,
      PROJECT_ID,
      `[before ${REFERENCE} after](https://example.com "Outer title")`
    );

    expect(markdown.trim()).toBe(
      '[before Current value after](https://example.com "Outer title")'
    );
    expect(markdown).not.toContain(`/${PROJECT_ID}/${LIBRARY_ID}/${ASSET_ID}`);
    expect(markdown).not.toContain('ResourceReference');
  });

  it('escapes unavailable fallback syntax inside an outer Markdown link label', async () => {
    resolveResourceReferences.mockResolvedValue(new Map([
      [
        `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
        {
          key: `table-row:${LIBRARY_ID}:${ASSET_ID}:${FIELD_ID}`,
          status: 'unavailable',
          label: 'Reference unavailable',
        },
      ],
    ]));

    const markdown = await resolveReferencesForPlainMarkdown(
      {} as SupabaseClient,
      PROJECT_ID,
      `[before ${REFERENCE} after](https://example.com "Outer title")`
    );

    expect(markdown.trim()).toBe(
      '[before \\[Reference unavailable\\] after](https://example.com "Outer title")'
    );
    expect(markdown).not.toContain('ResourceReference');
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('builds format-neutral inline runs without flattening formatting or links', () => {
    const model = buildDocumentExportModel(`# **Guide**

Plain **bold** and *italic*, <u>underlined</u>, [linked](https://example.com), and \`code\`.

> **Quoted** text

1. linked [item](https://example.com/item)

| Name | Value |
| --- | ---: |
| **One** | [1](https://example.com/one) |

\`\`\`ts
const value = 1
\`\`\`

<Callout type="warning" title="Careful">
Read **this**.
</Callout>

<Details summary="More">
Open *this*.
</Details>`);

    expect(model.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'quote',
      'list-item',
      'table',
      'code',
      'callout',
      'callout',
    ]);
    expect(model.blocks[0]).toMatchObject({
      type: 'heading',
      level: 1,
      content: [{ type: 'text', text: 'Guide', bold: true }],
    });
    expect(model.blocks[1]).toMatchObject({
      type: 'paragraph',
      content: expect.arrayContaining([
        { type: 'text', text: 'bold', bold: true },
        { type: 'text', text: 'italic', italic: true },
        { type: 'text', text: 'underlined', underline: true },
        { type: 'text', text: 'linked', link: 'https://example.com' },
        { type: 'text', text: 'code', code: true },
      ]),
    });
    expect(model.blocks[4]).toMatchObject({
      type: 'table',
      rows: [
        [[{ type: 'text', text: 'Name' }], [{ type: 'text', text: 'Value' }]],
        [
          [{ type: 'text', text: 'One', bold: true }],
          [{ type: 'text', text: '1', link: 'https://example.com/one' }],
        ],
      ],
    });
    expect(model.blocks[6]).toMatchObject({
      type: 'callout',
      component: 'Callout',
      label: 'Careful',
      children: [expect.objectContaining({
        type: 'paragraph',
        content: expect.arrayContaining([{ type: 'text', text: 'this', bold: true }]),
      })],
    });
    expect(model.blocks[7]).toMatchObject({
      type: 'callout',
      component: 'Details',
      label: 'More',
      children: [expect.objectContaining({
        type: 'paragraph',
        content: expect.arrayContaining([{ type: 'text', text: 'this', italic: true }]),
      })],
    });
  });

  it('preserves combined emphasis from the validated AST', () => {
    const model = buildDocumentExportModel('Both ***bold and italic***.');

    expect(model.blocks).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Both ' },
          { type: 'text', text: 'bold and italic', bold: true, italic: true },
          { type: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('keeps list continuation text and nested list depth', () => {
    const model = buildDocumentExportModel(`- first line
  continued line
  - nested item`);

    expect(model.blocks).toEqual([
      {
        type: 'list-item',
        ordered: false,
        level: 0,
        index: 1,
        children: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first line\ncontinued line' }] },
          {
            type: 'list-item',
            ordered: false,
            level: 1,
            index: 1,
            children: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested item' }] }],
          },
        ],
      },
    ]);
  });

  it('preserves block children inside sanctioned components', () => {
    const model = buildDocumentExportModel(`<Callout type="note" title="Steps">
- first
- second with ***care***
</Callout>`);

    expect(model.blocks).toEqual([
      {
        type: 'callout',
        component: 'Callout',
        label: 'Steps',
        children: [
          {
            type: 'list-item',
            ordered: false,
            level: 0,
            index: 1,
            children: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
          },
          {
            type: 'list-item',
            ordered: false,
            level: 0,
            index: 2,
            children: [{ type: 'paragraph', content: [{ type: 'text', text: 'second with ' }, { type: 'text', text: 'care', bold: true, italic: true }] }],
          },
        ],
      },
    ]);
  });

  it('preserves ordered starts and multiple paragraphs inside one list item', () => {
    const model = buildDocumentExportModel(`3. first paragraph

   second paragraph
4. next item`);

    expect(model.blocks).toEqual([
      {
        type: 'list-item',
        ordered: true,
        level: 0,
        index: 3,
        children: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first paragraph' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second paragraph' }] },
        ],
      },
      {
        type: 'list-item',
        ordered: true,
        level: 0,
        index: 4,
        children: [{ type: 'paragraph', content: [{ type: 'text', text: 'next item' }] }],
      },
    ]);
  });

  it('parses generated DOCX bytes and preserves semantic formatting and links', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) },
      })
    );
    const model = buildDocumentExportModel(`# Heading

Plain **bold** *italic* <u>under</u> [linked](https://example.com).

![Logo](https://project.supabase.co/storage/v1/object/public/library-media-files/user/logo.png)

- first

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`ts
const n = 1
\`\`\``);

    const bytes = await renderDocumentExportModel(model, 'docx');
    const parsed = await mammoth.convertToHtml({ buffer: bytes });
    const archive = await JSZip.loadAsync(bytes);
    const documentXml = await archive.file('word/document.xml')!.async('string');

    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(parsed.value).toContain('<h1>Heading</h1>');
    expect(parsed.value).toContain('<strong>bold</strong>');
    expect(parsed.value).toContain('<em>italic</em>');
    expect(documentXml).toMatch(/<w:u w:val="single"\/>/);
    expect(parsed.value).toContain('<a href="https://example.com">linked</a>');
    expect(parsed.value).toContain('<ul>');
    expect(parsed.value).toContain('<table>');
    expect(parsed.value).toContain('<img');
    expect(parsed.value).toContain('const n = 1');
  });

  it('parses generated PDF bytes and preserves text semantics and an embedded trusted image', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) },
      })
    );
    const model = buildDocumentExportModel(
      'PDF **bold** and [linked](https://example.com).\n\n![Logo](https://project.supabase.co/storage/v1/object/public/library-media-files/user/logo.png)'
    );

    const bytes = await renderDocumentExportModel(model, 'pdf');
    const pdf = bytes.toString('latin1');

    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(extractUncompressedPdfText(bytes)).toContain('PDF');
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/URI (https://example.com)');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('renders English text into a valid PDF with built-in fonts', async () => {
    const bytes = await renderDocumentExportModel(
      buildDocumentExportModel('# Export title\n\nBody with **bold content**.'),
      'pdf'
    );
    const pdf = bytes.toString('latin1');

    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(extractUncompressedPdfText(bytes)).toContain('Export title');
    expect(pdf).not.toMatch(/\/FontFile[23]?\b/);
  });

  it('renders Chinese text with an embedded Unicode font', async () => {
    const bytes = await renderDocumentExportModel(
      buildDocumentExportModel('# \u4f60\u597d\u4e16\u754c\n\nPDF \u5bfc\u51fa\u5185\u5bb9'),
      'pdf'
    );
    const pdf = bytes.toString('latin1');

    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(bytes.length).toBeLessThan(1_000_000);
    expect(pdf).toMatch(/\/FontFile[23]?\b/);
    expect(pdf).toContain('/Subtype /Type0');
    expect(pdf).toContain('/ToUnicode');
  });

  it('rejects characters missing from the embedded PDF fonts', async () => {
    const model = buildDocumentExportModel('# Unsupported \u{1f600} character');

    await expect(renderDocumentExportModel(model, 'pdf')).rejects.toThrow(
      /export as DOCX to preserve the original text/i
    );
    await expect(renderDocumentExportModel(model, 'docx')).resolves.toEqual(
      expect.any(Buffer)
    );
  });

  it('uses two native OpenType font assets that Turbopack does not rewrite as module IDs', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/lib/documents/documentExportService.ts'),
      'utf8'
    );

    expect(source).not.toContain('require.resolve(');
    expect(source).not.toMatch(/\.woff2?['"]/);
    expect(source).toMatch(
      /path\.join\(\s*process\.cwd\(\),\s*'src',\s*'assets',\s*'fonts',\s*'NotoSansSC-Regular\.otf'\s*\)/
    );
    expect(source).toMatch(
      /path\.join\(\s*process\.cwd\(\),\s*'src',\s*'assets',\s*'fonts',\s*'NotoSansSC-Bold\.otf'\s*\)/
    );
  });

  it('does not fetch untrusted images and degrades them to alt text in both formats', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const model = buildDocumentExportModel('![Private diagram](https://untrusted.example/admin.png)');

    const docxBytes = await renderDocumentExportModel(model, 'docx');
    const docxHtml = (await mammoth.convertToHtml({ buffer: docxBytes })).value;
    const pdfBytes = await renderDocumentExportModel(model, 'pdf');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(docxHtml).toContain('Private diagram');
    expect(extractUncompressedPdfText(pdfBytes)).toContain('Private diagram');
  });

  it('uses at most two workers while resolving distinct trusted images', async () => {
    let active = 0;
    let maximumActive = 0;
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) },
      });
    });
    const markdown = Array.from({ length: 6 }, (_, index) =>
      `![Image ${index}](https://project.supabase.co/storage/v1/object/public/library-media-files/user/image-${index}.png)`
    ).join('\n\n');

    await renderDocumentExportModel(buildDocumentExportModel(markdown), 'docx');

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(maximumActive).toBe(2);
  });

  it('denies loopback HTTP storage in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    const fetchSpy = jest.spyOn(global, 'fetch');
    const model = buildDocumentExportModel(
      '![Local](http://localhost:54321/storage/v1/object/public/library-media-files/user/local.png)'
    );

    await renderDocumentExportModel(model, 'docx');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['localhost', 'https://localhost:54321'],
    ['IPv4 loopback', 'https://127.0.0.1:54321'],
    ['IPv6 loopback', 'https://[::1]:54321'],
  ])('denies configured production HTTPS storage on %s', async (_case, origin) => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const model = buildDocumentExportModel(
      `![Local](${origin}/storage/v1/object/public/library-media-files/user/local.png)`
    );

    await renderDocumentExportModel(model, 'docx');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows configured loopback HTTP storage outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) },
      })
    );
    const model = buildDocumentExportModel(
      '![Local](http://127.0.0.1:54321/storage/v1/object/public/library-media-files/user/local.png)'
    );

    await renderDocumentExportModel(model, 'docx');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['encoded traversal', 'https://project.supabase.co/storage/v1/object/public/library-media-files/%2e%2e/private.png'],
    ['encoded slash', 'https://project.supabase.co/storage/v1/object/public/library-media-files/user%2Fprivate.png'],
    ['encoded backslash', 'https://project.supabase.co/storage/v1/object/public/library-media-files/user%5Cprivate.png'],
    ['malformed encoding', 'https://project.supabase.co/storage/v1/object/public/library-media-files/user/%ZZ.png'],
  ])('rejects trusted-origin URLs with %s', async (_case, url) => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await renderDocumentExportModel(buildDocumentExportModel(`![Unsafe](${url})`), 'docx');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['GIF', 'image/gif', GIF_1X1],
    ['BMP', 'image/bmp', BMP_1X1],
    ['WebP', 'image/webp', WEBP_1X1],
  ])('degrades trusted unsupported %s images to alt text in both formats', async (label, contentType, data) => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(data, {
      headers: { 'content-type': contentType, 'content-length': String(data.length) },
    }));
    const model = buildDocumentExportModel(
      `![${label} fallback](https://project.supabase.co/storage/v1/object/public/library-media-files/user/image)`
    );

    const docxBytes = await renderDocumentExportModel(model, 'docx');
    const docxHtml = (await mammoth.convertToHtml({ buffer: docxBytes })).value;
    const pdfBytes = await renderDocumentExportModel(model, 'pdf');

    expect(docxHtml).toContain(`${label} fallback`);
    expect(docxHtml).not.toContain('<img');
    expect(extractUncompressedPdfText(pdfBytes)).toContain(`${label} fallback`);
  });

  it.each([
    ['malformed PNG', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['truncated safe-dimension PNG', 'image/png', truncatedPngWithDimensions(1, 1)],
    ['corrupt pixel-stream PNG', 'image/png', PNG_1X1.subarray(0, 45)],
    ['unsafe-dimension PNG', 'image/png', pngWithDimensions(50_000, 50_000)],
    ['malformed JPEG', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['truncated safe-dimension JPEG', 'image/jpeg', jpegWithDimensions(1, 1)],
    ['corrupt pixel-stream JPEG', 'image/jpeg', JPEG_1X1.subarray(0, 262)],
    ['unsafe-dimension JPEG', 'image/jpeg', jpegWithDimensions(50_000, 50_000)],
  ])('degrades trusted %s images before either renderer decodes them', async (label, contentType, data) => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(data, {
      headers: { 'content-type': contentType, 'content-length': String(data.length) },
    }));
    const model = buildDocumentExportModel(
      `![${label} fallback](https://project.supabase.co/storage/v1/object/public/library-media-files/user/image)`
    );

    const docxBytes = await renderDocumentExportModel(model, 'docx');
    const docxHtml = (await mammoth.convertToHtml({ buffer: docxBytes })).value;
    const pdfBytes = await renderDocumentExportModel(model, 'pdf');

    expect(docxHtml).toContain(`${label} fallback`);
    expect(docxHtml).not.toContain('<img');
    expect(extractUncompressedPdfText(pdfBytes)).toContain(`${label} fallback`);
  });

  it('bounds trusted image downloads by declared and streamed byte size', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(5 * 1024 * 1024 + 1),
      }),
      body: { cancel },
    } as unknown as Response);
    const model = buildDocumentExportModel(
      '![Large](https://project.supabase.co/storage/v1/object/public/library-media-files/user/large.png)'
    );

    const bytes = await renderDocumentExportModel(model, 'docx');
    const html = (await mammoth.convertToHtml({ buffer: bytes })).value;

    expect(html).toContain('Large');
    expect(html).not.toContain('<img');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stops reading a trusted image when the streamed body crosses the byte limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
        controller.close();
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(body, { headers: { 'content-type': 'image/png' } })
    );
    const model = buildDocumentExportModel(
      '![Streamed large](https://project.supabase.co/storage/v1/object/public/library-media-files/user/stream.png)'
    );

    const bytes = await renderDocumentExportModel(model, 'docx');
    const html = (await mammoth.convertToHtml({ buffer: bytes })).value;

    expect(html).toContain('Streamed large');
    expect(html).not.toContain('<img');
  });

  it('aborts a trusted image request after the fixed timeout and degrades to alt text', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(global, 'fetch').mockImplementation((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
      );
      const model = buildDocumentExportModel(
        '![Slow](https://project.supabase.co/storage/v1/object/public/library-media-files/user/slow.png)'
      );

      const rendering = renderDocumentExportModel(model, 'docx');
      await jest.advanceTimersByTimeAsync(5_000);
      await jest.runAllTimersAsync();
      const bytes = await rendering;
      jest.useRealTimers();
      const html = (await mammoth.convertToHtml({ buffer: bytes })).value;

      expect(html).toContain('Slow');
      expect(html).not.toContain('<img');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads the latest logical state before rendering an export', async () => {
    readDocumentState.mockResolvedValue({ markdown: '# Latest tail content', projectId: PROJECT_ID });

    const exported = await exportDocument(metadataClient('Tail / notes'), 'document-id', 'docx');
    const html = (await mammoth.convertToHtml({ buffer: exported.bytes })).value;

    expect(readDocumentState).toHaveBeenCalledWith(expect.anything(), 'document-id');
    expect(html).toContain('Latest tail content');
    expect(exported.fileName).toBe('Tail - notes.docx');
  });

  it('returns validated authoritative MDX unchanged without resolving references', async () => {
    const markdown = `# ${ANCHOR}Heading\n\nSee ${REFERENCE}.`;
    readDocumentState.mockResolvedValue({ markdown, projectId: PROJECT_ID });

    const exported = await exportDocument(metadataClient('Semantic notes'), 'document-id', 'mdx');

    expect(exported.bytes.toString('utf8')).toBe(markdown);
    expect(exported.mediaType).toBe('text/markdown; charset=utf-8');
    expect(exported.fileName).toBe('Semantic notes.mdx');
    expect(resolveResourceReferences).not.toHaveBeenCalled();
  });

  it('rejects unsafe MDX before building an export model', () => {
    expect(() => buildDocumentExportModel('<Unknown />')).toThrow();
  });

  it('sanitizes response filenames without losing readable text', () => {
    expect(sanitizeExportFileName(' Project / notes?.md ')).toBe('Project - notes-.md');
    expect(sanitizeExportFileName('...')).toBe('document');
  });
});
