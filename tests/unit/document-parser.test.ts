import {
  parseDocument,
  validateDesignFile,
  MAX_DESIGN_FILE_SIZE,
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
  it('returns the raw text for a .txt file', async () => {
    await expect(parseDocument(makeFile('plain content', 'a.txt'))).resolves.toBe(
      'plain content'
    );
  });

  it('returns the raw text for a .md file', async () => {
    await expect(parseDocument(makeFile('# Heading', 'notes.md'))).resolves.toBe(
      '# Heading'
    );
  });

  it('rejects a legacy .doc file', async () => {
    await expect(parseDocument(makeFile('x', 'old.doc'))).rejects.toThrow();
  });

  it('rejects an unsupported extension', async () => {
    await expect(parseDocument(makeFile('x', 'image.png'))).rejects.toThrow();
  });
});
