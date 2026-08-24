import {
  isTabularClipboardPayload,
  isTabularClipboardText,
  parseTsvMatrix,
  trimTableMatrix,
} from '@/lib/documents/documentTableClipboard';

describe('document table clipboard helpers', () => {
  it('trims trailing empty rows and columns', () => {
    expect(
      trimTableMatrix([
        ['Name', 'Score', ''],
        ['Alice', '10', ''],
        ['', '', ''],
      ]),
    ).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
  });

  it('parses TSV clipboard text into a matrix', () => {
    expect(parseTsvMatrix('Name\tScore\nAlice\t10')).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
    ]);
  });

  it('detects tabular clipboard payloads', () => {
    expect(isTabularClipboardText('Alice\t10')).toBe(true);
    expect(isTabularClipboardText('Alice\nBob')).toBe(true);
    expect(isTabularClipboardText('Alice')).toBe(false);
    expect(
      isTabularClipboardPayload({
        getData: (type: string) =>
          type === 'text/html' ? '<table><tbody><tr><td>A</td></tr></tbody></table>' : '',
      } as DataTransfer),
    ).toBe(true);
  });
});
