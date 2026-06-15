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
});
