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
    const msg = buildDesignMessage({ fileName: 'world.docx', documentText: 'body' });
    const display = deriveUserDisplay(msg, ['https://x/a.png']);
    expect(display.attachments).toEqual([{ fileName: 'world.docx' }]);
  });

  it('returns no attachments for a plain message without images', () => {
    const display = deriveUserDisplay('hi', []);
    expect(display.attachments).toBeUndefined();
  });

  it('shows selected table context as a compact attachment', () => {
    const display = deriveUserDisplay('请分析', undefined, {
      source: 'library_table',
      libraryId: 'lib-1',
      libraryName: '角色表',
      selectionLabel: '角色表 · 第 2-3 行 · 2 列',
      mode: 'cells',
      selectedCellCount: 4,
      selectedRowCount: 2,
      rows: [],
    });

    expect(display).toEqual({
      text: '请分析',
      attachments: [
        {
          kind: 'selection',
          fileName: '角色表 · 第 2-3 行 · 2 列',
        },
      ],
    });
  });
});
