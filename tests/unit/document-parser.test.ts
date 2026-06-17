import {
  parseDocument,
  validateDesignFile,
  filterExtractedImages,
  MAX_DESIGN_FILE_SIZE,
  MIN_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_DOC_IMAGES,
  type ExtractedImage,
} from '../../src/lib/document-parser';

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
