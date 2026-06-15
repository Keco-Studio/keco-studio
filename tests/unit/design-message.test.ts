import { buildDesignMessage, parseDesignMessage } from '../../src/lib/design-message';

describe('buildDesignMessage', () => {
  it('includes the file name in the system instruction', () => {
    const msg = buildDesignMessage({
      fileName: 'worldview.md',
      documentText: 'A fantasy continent with three factions.',
    });
    expect(msg).toContain('worldview.md');
  });

  it('includes the full document text', () => {
    const documentText = 'A fantasy continent with three factions.';
    const msg = buildDesignMessage({ fileName: 'a.txt', documentText });
    expect(msg).toContain(documentText);
  });

  it('includes additional instructions when provided', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc',
      additionalInstructions: 'Only create a characters table.',
    });
    expect(msg).toContain('Only create a characters table.');
  });

  it('omits the additional-instructions section when blank', () => {
    const withBlank = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc',
      additionalInstructions: '   ',
    });
    const without = buildDesignMessage({ fileName: 'a.txt', documentText: 'doc' });
    expect(withBlank).toBe(without);
  });
});

describe('parseDesignMessage', () => {
  it('returns null for a plain (non-design) message', () => {
    expect(parseDesignMessage('Hello, can you help me?')).toBeNull();
  });

  it('extracts the file name and instructions from a built design message', () => {
    const msg = buildDesignMessage({
      fileName: 'worldview.docx',
      documentText: 'A fantasy continent with three factions.',
      additionalInstructions: 'Only create a characters table.',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.fileName).toBe('worldview.docx');
    expect(parsed?.instructions).toBe('Only create a characters table.');
  });

  it('leaves instructions undefined when none were provided', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc body',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.fileName).toBe('a.txt');
    expect(parsed?.instructions).toBeUndefined();
  });

  it('does not leak the document content into instructions', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'SECRET-DOC-BODY',
      additionalInstructions: 'do a thing',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.instructions).not.toContain('SECRET-DOC-BODY');
  });

  it('preserves multi-line instructions', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'body',
      additionalInstructions: 'line one\nline two',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.instructions).toBe('line one\nline two');
  });
});
