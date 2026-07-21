import { deriveUserDisplay } from '../../../src/components/agent/userMessageDisplay';
import { buildDesignMessage } from '../../../src/lib/design-message';

describe('deriveUserDisplay', () => {
  it('returns the message verbatim with no attachments for a plain message', () => {
    const display = deriveUserDisplay('What tables exist?');
    expect(display.text).toBe('What tables exist?');
    expect(display.attachments).toBeUndefined();
  });

  it('shows a file attachment and the instructions for a design message', () => {
    const msg = buildDesignMessage({
      fileName: 'worldview.docx',
      documentText: 'long document body that must stay hidden',
      additionalInstructions: 'Build a characters table.',
      intent: 'analyze',
    });
    const display = deriveUserDisplay(msg);
    expect(display.attachments).toEqual([{ fileName: 'worldview.docx' }]);
    expect(display.text).toBe('Build a characters table.');
    expect(display.text).not.toContain('long document body that must stay hidden');
  });

  it('shows only the file attachment when no instructions were given', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'body',
      intent: 'analyze',
    });
    const display = deriveUserDisplay(msg);
    expect(display.attachments).toEqual([{ fileName: 'a.txt' }]);
    expect(display.text).toBe('');
  });

  it('renders image thumbnails for a plain message with attached images', () => {
    const display = deriveUserDisplay('look at these', [
      'https://x/a.png',
      'https://x/b.jpg',
    ]);
    expect(display.text).toBe('look at these');
    expect(display.attachments).toEqual([
      { fileName: 'a.png', imageUrl: 'https://x/a.png' },
      { fileName: 'b.jpg', imageUrl: 'https://x/b.jpg' },
    ]);
  });

  it('keeps the design-document chip and ignores image thumbnails for design messages', () => {
    const msg = buildDesignMessage({ fileName: 'world.docx', documentText: 'body', intent: 'analyze' });
    const display = deriveUserDisplay(msg, ['https://x/a.png']);
    expect(display.attachments).toEqual([{ fileName: 'world.docx' }]);
  });

  it('returns no attachments for a plain message without images', () => {
    const display = deriveUserDisplay('hi', []);
    expect(display.attachments).toBeUndefined();
  });

  it('renders a legacy envelope as a file chip without document content', () => {
    const display = deriveUserDisplay(
      '[Design document]\nThe user uploaded a design document "legacy.docx".\n\n' +
      '[User instructions]\nSummarize it\n\n[Document content]\nSECRET BODY',
    );
    expect(display.attachments).toEqual([{ fileName: 'legacy.docx' }]);
    expect(display.text).toBe('Summarize it');
    expect(display.text).not.toContain('SECRET BODY');
  });

  it('shows selected table context as a compact attachment', () => {
    const display = deriveUserDisplay('Please analyze this', undefined, {
      source: 'library_table',
      libraryId: 'lib-1',
      libraryName: 'Characters',
      selectionLabel: 'Characters · Rows 2-3 · 2 columns',
      mode: 'cells',
      selectedCellCount: 4,
      selectedRowCount: 2,
      rows: [],
    });

    expect(display).toEqual({
      text: 'Please analyze this',
      attachments: [
        {
          kind: 'selection',
          fileName: 'Characters · Rows 2-3 · 2 columns',
        },
      ],
    });
  });
});
