import {
  applyDocumentEditOperation,
  summarizeDocumentEditOperation,
} from '@/lib/agent/document-edit-operations';

describe('document edit operations', () => {
  it('replaces the entire document and normalizes CRLF without trimming', () => {
    expect(
      applyDocumentEditOperation('ignored\r\nbody', {
        type: 'replace_all',
        markdown: '  # Replacement\r\n\r\nBody  ',
      })
    ).toBe('  # Replacement\n\nBody  ');
  });

  it('replaces one exact text occurrence against the normalized document', () => {
    expect(
      applyDocumentEditOperation('Before\r\nOld value\r\nAfter', {
        type: 'replace_text',
        target: 'Old value\r\nAfter',
        replacement: 'New value\r\nAfter',
      })
    ).toBe('Before\nNew value\nAfter');
  });

  it('deletes one exact text occurrence', () => {
    expect(
      applyDocumentEditOperation('Keep this -- remove this -- and this', {
        type: 'delete_text',
        target: 'remove this -- ',
      })
    ).toBe('Keep this -- and this');
  });

  it.each([
    ['replace_text', { type: 'replace_text', target: '', replacement: 'x' }],
    ['delete_text', { type: 'delete_text', target: '' }],
    ['insert_before', { type: 'insert_before', anchor: '', content: 'x' }],
    ['insert_after', { type: 'insert_after', anchor: '', content: 'x' }],
  ] as const)('rejects an empty exact target for %s', (_name, operation) => {
    expect(() => applyDocumentEditOperation('body', operation)).toThrow(
      'Edit target must be non-empty.'
    );
  });

  it.each([
    [{ type: 'replace_text', target: 'missing', replacement: 'x' } as const, 0],
    [{ type: 'delete_text', target: 'same' } as const, 2],
    [{ type: 'insert_before', anchor: 'same', content: 'x' } as const, 2],
    [{ type: 'insert_after', anchor: 'missing', content: 'x' } as const, 0],
  ])('rejects zero or multiple exact matches', (operation, count) => {
    expect(() => applyDocumentEditOperation('same and same', operation)).toThrow(
      `Edit target must occur exactly once; found ${count} matches.`
    );
  });

  it('rejects overlapping exact matches as ambiguous', () => {
    expect(() =>
      applyDocumentEditOperation('aaa', {
        type: 'replace_text',
        target: 'aa',
        replacement: 'X',
      })
    ).toThrow('Edit target must occur exactly once; found 2 matches.');
  });

  it.each([
    ['insert_before', 'Alpha\nBeta', { type: 'insert_before', anchor: 'Beta', content: 'Middle' }, 'Alpha\nMiddle\nBeta'],
    ['insert_before inline', 'AlphaBeta', { type: 'insert_before', anchor: 'Beta', content: 'Middle' }, 'Alpha\nMiddle\nBeta'],
    ['insert_after', 'Alpha\nBeta', { type: 'insert_after', anchor: 'Alpha', content: 'Middle' }, 'Alpha\nMiddle\nBeta'],
    ['insert_after inline', 'AlphaBeta', { type: 'insert_after', anchor: 'Alpha', content: 'Middle' }, 'Alpha\nMiddle\nBeta'],
  ] as const)('adds line-friendly boundaries for %s', (_name, current, operation, expected) => {
    expect(applyDocumentEditOperation(current, operation)).toBe(expected);
  });

  it('does not add insertion newlines where the supplied content already provides them', () => {
    expect(
      applyDocumentEditOperation('Alpha\nBeta', {
        type: 'insert_before',
        anchor: 'Beta',
        content: '\nMiddle\n',
      })
    ).toBe('Alpha\n\nMiddle\nBeta');
    expect(
      applyDocumentEditOperation('Alpha\nBeta', {
        type: 'insert_after',
        anchor: 'Alpha',
        content: '\nMiddle\n',
      })
    ).toBe('Alpha\nMiddle\n\nBeta');
  });

  it.each([
    ['Body', 'Appendix', 'Body\n\nAppendix'],
    ['Body\n', 'Appendix', 'Body\n\nAppendix'],
    ['Body', '\nAppendix', 'Body\n\nAppendix'],
    ['Body\n', '\nAppendix', 'Body\n\nAppendix'],
    ['Body\n\n', 'Appendix', 'Body\n\nAppendix'],
    ['Body', '\n\nAppendix', 'Body\n\nAppendix'],
    ['Body\n\n\n', '\nAppendix', 'Body\n\n\n\nAppendix'],
  ])('appends with an existing or added blank-line boundary', (current, content, expected) => {
    expect(applyDocumentEditOperation(current, { type: 'append', content })).toBe(expected);
  });

  it('returns append content unchanged for an empty document except for CRLF normalization', () => {
    expect(
      applyDocumentEditOperation('', { type: 'append', content: '  Added\r\n  ' })
    ).toBe('  Added\n  ');
  });

  it('treats an empty append as a no-op', () => {
    expect(applyDocumentEditOperation('Body', { type: 'append', content: '' })).toBe('Body');
  });

  it('normalizes existing CRLF while preserving unrelated whitespace', () => {
    expect(
      applyDocumentEditOperation('  Before\r\nTarget\r\nAfter  ', {
        type: 'replace_text',
        target: 'Target',
        replacement: 'Replacement',
      })
    ).toBe('  Before\nReplacement\nAfter  ');
  });

  it('normalizes lone carriage returns as line endings', () => {
    expect(
      applyDocumentEditOperation('Before\rTarget\rAfter', {
        type: 'replace_text',
        target: 'Target',
        replacement: 'Replacement',
      })
    ).toBe('Before\nReplacement\nAfter');
  });

  it.each([
    [{ type: 'replace_all', markdown: 'abc' } as const, 'Replace entire document (3 characters).'],
    [{ type: 'replace_text', target: 'old', replacement: 'newer' } as const, 'Replace one exact text occurrence (3 characters) with 5 characters.'],
    [{ type: 'insert_before', anchor: 'point', content: 'abc' } as const, 'Insert 3 characters before one exact anchor (5 characters).'],
    [{ type: 'insert_after', anchor: 'point', content: 'abc' } as const, 'Insert 3 characters after one exact anchor (5 characters).'],
    [{ type: 'append', content: 'abc' } as const, 'Append 3 characters.'],
    [{ type: 'delete_text', target: 'abc' } as const, 'Delete one exact text occurrence (3 characters).'],
  ])('summarizes %s without exposing content', (operation, expected) => {
    expect(summarizeDocumentEditOperation(operation)).toBe(expected);
  });
});
