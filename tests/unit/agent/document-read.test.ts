import { readDocumentSlice } from '@/lib/agent/document-read';

describe('readDocumentSlice', () => {
  it('returns the complete document by default', () => {
    expect(readDocumentSlice('# Title\nBody', {})).toEqual({
      mode: 'full',
      markdown: '# Title\nBody',
      startLine: 1,
      endLine: 2,
      totalLines: 2,
      complete: true,
    });
  });

  it('normalizes CRLF line endings in returned content and line indexing', () => {
    expect(readDocumentSlice('# Title\r\nBody\r\nEnd', { mode: 'lines', startLine: 2, endLine: 3 }))
      .toMatchObject({ markdown: 'Body\nEnd', startLine: 2, endLine: 3, totalLines: 3 });
  });

  it('returns ATX heading lines as an outline in document order', () => {
    expect(readDocumentSlice('intro\n# One\ntext\n### Three  \nnot # heading', { mode: 'outline' }))
      .toEqual({
        mode: 'outline',
        markdown: '# One\n### Three  ',
        startLine: 1,
        endLine: 5,
        totalLines: 5,
        complete: false,
      });
  });

  it('returns a uniquely named heading through the next equal-level heading', () => {
    expect(readDocumentSlice('# One\na\n## Child\nb\n# Two\nc', { mode: 'heading', heading: 'One' }))
      .toEqual({
        mode: 'heading',
        markdown: '# One\na\n## Child\nb',
        startLine: 1,
        endLine: 4,
        totalLines: 6,
        complete: false,
      });
  });

  it('stops a nested heading slice at the next heading of a higher level', () => {
    expect(readDocumentSlice('# One\n## Child\ntext\n### Grandchild\nmore\n# Two', {
      mode: 'heading',
      heading: 'Child',
    })).toMatchObject({ markdown: '## Child\ntext\n### Grandchild\nmore', startLine: 2, endLine: 5 });
  });

  it('rejects duplicate exact trimmed heading text', () => {
    expect(() => readDocumentSlice('# Same\nA\n## Same\nB', { mode: 'heading', heading: ' Same ' }))
      .toThrow('Heading "Same" is ambiguous: found 2 matching headings.');
  });

  it('rejects a missing heading', () => {
    expect(() => readDocumentSlice('# Present', { mode: 'heading', heading: 'Missing' }))
      .toThrow('Heading "Missing" was not found.');
  });

  it('returns an exact inclusive line range', () => {
    expect(readDocumentSlice('one\ntwo\nthree\nfour', { mode: 'lines', startLine: 2, endLine: 3 }))
      .toEqual({
        mode: 'lines',
        markdown: 'two\nthree',
        startLine: 2,
        endLine: 3,
        totalLines: 4,
        complete: false,
      });
  });

  it.each([
    [{ mode: 'lines', startLine: 1.5, endLine: 2 }, 'Line bounds must be integers.'],
    [{ mode: 'lines', startLine: 0, endLine: 1 }, 'startLine must be at least 1.'],
    [{ mode: 'lines', startLine: 3, endLine: 2 }, 'endLine must be greater than or equal to startLine.'],
    [{ mode: 'lines', startLine: 1, endLine: 4 }, 'endLine must not exceed totalLines (3).'],
  ] as const)('rejects invalid line ranges %#', (request, message) => {
    expect(() => readDocumentSlice('one\ntwo\nthree', request)).toThrow(message);
  });

  it('marks a whole-document line range complete', () => {
    expect(readDocumentSlice('one\ntwo', { mode: 'lines', startLine: 1, endLine: 2 }))
      .toMatchObject({ complete: true });
  });

  it('treats an empty document as one empty addressable line', () => {
    expect(readDocumentSlice('', {})).toEqual({
      mode: 'full',
      markdown: '',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      complete: true,
    });
    expect(readDocumentSlice('', { mode: 'lines', startLine: 1, endLine: 1 }))
      .toMatchObject({ markdown: '', complete: true });
  });
});
