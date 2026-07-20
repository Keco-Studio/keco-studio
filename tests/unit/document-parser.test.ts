import {
  convertDocumentHtmlToMarkdown,
  escapeLiteralMdxBraces,
  parseDocument,
  validateDesignFile,
  filterExtractedImages,
  MAX_DESIGN_FILE_SIZE,
  MIN_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_DOC_IMAGES,
  type ExtractedImage,
} from '../../src/lib/document-parser';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';

function makeFile(content: string, name: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

describe('validateDesignFile', () => {
  it('accepts a .txt file under the size limit', () => {
    expect(validateDesignFile(makeFile('hello', 'a.txt'))).toEqual({ ok: true });
  });

  it('accepts a .md file', () => {
    expect(validateDesignFile(makeFile('# title', 'a.md'))).toEqual({ ok: true });
  });

  it('accepts a .docx file', () => {
    expect(validateDesignFile(makeFile('x', 'a.docx'))).toEqual({ ok: true });
  });

  it('rejects an empty file', () => {
    const result = validateDesignFile(makeFile('', 'a.txt'));
    expect(result.ok).toBe(false);
  });

  it('rejects a legacy .doc file with a conversion hint', () => {
    const result = validateDesignFile(makeFile('x', 'a.doc'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/\.docx/);
  });

  it('rejects an unsupported extension', () => {
    const result = validateDesignFile(makeFile('x', 'a.pdf'));
    expect(result.ok).toBe(false);
  });

  it('rejects a file larger than the size limit', () => {
    const big = makeFile('x', 'a.txt');
    Object.defineProperty(big, 'size', { value: MAX_DESIGN_FILE_SIZE + 1 });
    const result = validateDesignFile(big);
    expect(result.ok).toBe(false);
  });
});

describe('parseDocument', () => {
  it('returns text and an empty image list for a .txt file', async () => {
    await expect(parseDocument(makeFile('plain content', 'a.txt'))).resolves.toEqual({
      text: 'plain content',
      images: [],
    });
  });

  it('returns text and an empty image list for a .md file', async () => {
    await expect(parseDocument(makeFile('# Heading', 'notes.md'))).resolves.toEqual({
      text: '# Heading',
      images: [],
    });
  });

  it('rejects a legacy .doc file', async () => {
    await expect(parseDocument(makeFile('x', 'old.doc'))).rejects.toThrow();
  });

  it('rejects an unsupported extension', async () => {
    await expect(parseDocument(makeFile('x', 'image.png'))).rejects.toThrow();
  });

  it('converts a real DOCX to structured Markdown with inline image placeholders', async () => {
    const png = Buffer.concat([
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
      Buffer.alloc(MIN_IMAGE_BYTES),
    ]);
    const document = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'World guide', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: 'First item', bullet: { level: 0 } }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Name')] }), new TableCell({ children: [new Paragraph('Role')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Ada')] }), new TableCell({ children: [new Paragraph('Guide')] })] }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('Read the '),
              new ExternalHyperlink({ link: 'https://example.com/rules', children: [new TextRun('rules')] }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('Before '),
              new ImageRun({ data: png, transformation: { width: 24, height: 24 }, type: 'png' }),
              new TextRun(' after'),
            ],
          }),
        ],
      }],
    });
    const bytes = await Packer.toBuffer(document);
    const file = new File([new Uint8Array(bytes)], 'world.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const parsed = await parseDocument(file);

    expect(parsed.text).toContain('# World guide');
    expect(parsed.text).toMatch(/[-*]\s+First item/);
    expect(parsed.text).toMatch(/\| Name\s+\| Role\s+\|/);
    expect(parsed.text).toContain('[rules](https://example.com/rules)');
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.placeholder).toMatch(
      /^https:\/\/document-import\.invalid\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(parsed.text).toContain(`Before ![Imported image 1](${parsed.images[0]?.placeholder}) after`);
  });
});

describe('convertDocumentHtmlToMarkdown', () => {
  it('preserves headings, lists, tables, links, and image positions', () => {
    const markdown = convertDocumentHtmlToMarkdown(`
      <h1>World guide</h1>
      <p>Read the <a href="https://example.com/rules">rules</a>.</p>
      <ul><li>First</li><li>Second</li></ul>
      <table>
        <thead><tr><th>Name</th><th>Role</th></tr></thead>
        <tbody><tr><td>Ada</td><td>Guide</td></tr></tbody>
      </table>
      <p>Before <img src="https://document-import.invalid/00000000-0000-4000-8000-000000000000" alt="Map" /> after.</p>
    `);

    expect(markdown).toContain('# World guide');
    expect(markdown).toContain('[rules](https://example.com/rules)');
    expect(markdown).toMatch(/[-*]\s+First/);
    expect(markdown).toMatch(/\| Name\s+\| Role\s+\|/);
    expect(markdown).toContain(
      'Before ![Map](https://document-import.invalid/00000000-0000-4000-8000-000000000000) after.'
    );
  });

  it('drops unsafe HTML and unsafe link or image destinations', () => {
    const markdown = convertDocumentHtmlToMarkdown(`
      <script>alert('no')</script>
      <p><a href="javascript:alert(1)">Bad link</a></p>
      <img src="data:text/html;base64,PHNjcmlwdD4=" alt="Bad image" />
    `);

    expect(markdown).not.toContain('alert');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).not.toContain('data:');
    expect(markdown).toContain('Bad link');
    expect(markdown).toContain('Bad image');
  });

  it('degrades destinations rejected by the sanctioned document schema', () => {
    const markdown = convertDocumentHtmlToMarkdown(`
      <p><a href="http://example.com">HTTP</a></p>
      <p><a href="mailto:test@example.com">Email</a></p>
      <p><a href="#section">Anchor</a></p>
      <p><a href="/projects/123">Project</a></p>
      <img src="/relative.png" alt="Relative image" />
    `);

    expect(markdown).toContain('HTTP');
    expect(markdown).toContain('Email');
    expect(markdown).toContain('Anchor');
    expect(markdown).not.toContain('http://');
    expect(markdown).not.toContain('mailto:');
    expect(markdown).not.toContain('](#section)');
    expect(markdown).toContain('[Project](/projects/123)');
    expect(markdown).toContain('Relative image');
    expect(markdown).not.toContain('](/relative.png)');
  });
});

describe('escapeLiteralMdxBraces', () => {
  it('escapes prose braces without changing code spans or fenced code', () => {
    const source = [
      'Payload: {"name":"Ada"}',
      '',
      'Inline `{HP}`.',
      '',
      '```json',
      '{"name":"Ada"}',
      '```',
    ].join('\n');

    expect(escapeLiteralMdxBraces(source)).toBe([
      'Payload: \\{"name":"Ada"\\}',
      '',
      'Inline `{HP}`.',
      '',
      '```json',
      '{"name":"Ada"}',
      '```',
    ].join('\n'));
  });

  it('does not double-escape already escaped braces', () => {
    expect(escapeLiteralMdxBraces('Already \\{safe\\}.')).toBe('Already \\{safe\\}.');
  });
});

describe('filterExtractedImages', () => {
  function img(contentType: string, byteLength: number): ExtractedImage {
    return { data: new ArrayBuffer(byteLength), contentType };
  }

  it('keeps supported images within the size bounds', () => {
    const input = [img('image/png', MIN_IMAGE_BYTES), img('image/jpeg', MIN_IMAGE_BYTES + 100)];
    expect(filterExtractedImages(input)).toEqual(input);
  });

  it('drops images smaller than the minimum (decorative icons)', () => {
    const input = [img('image/png', MIN_IMAGE_BYTES - 1)];
    expect(filterExtractedImages(input)).toEqual([]);
  });

  it('drops images larger than the maximum', () => {
    const input = [img('image/png', MAX_IMAGE_BYTES + 1)];
    expect(filterExtractedImages(input)).toEqual([]);
  });

  it('drops unsupported content types (emf/wmf/svg)', () => {
    const input = [
      img('image/x-emf', MIN_IMAGE_BYTES),
      img('image/x-wmf', MIN_IMAGE_BYTES),
      img('image/svg+xml', MIN_IMAGE_BYTES),
    ];
    expect(filterExtractedImages(input)).toEqual([]);
  });

  it('caps the number of images at MAX_DOC_IMAGES preserving order', () => {
    const input = Array.from({ length: MAX_DOC_IMAGES + 5 }, () =>
      img('image/png', MIN_IMAGE_BYTES)
    );
    const result = filterExtractedImages(input);
    expect(result).toHaveLength(MAX_DOC_IMAGES);
    expect(result).toEqual(input.slice(0, MAX_DOC_IMAGES));
  });
});
