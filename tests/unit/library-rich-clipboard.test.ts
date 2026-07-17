import { describe, expect, it, jest } from '@jest/globals';
import {
  serializeLibraryClipboardMatrix,
  writeLibraryClipboard,
  type ClipboardItemConstructor,
} from '@/components/libraries/hooks/libraryRichClipboard';

describe('library rich clipboard', () => {
  it('serializes only selected rows without inventing column names', () => {
    expect(
      serializeLibraryClipboardMatrix([
        ['Alice', 10],
        ['Bob', null],
      ]),
    ).toEqual({
      plainText: 'Alice\t10\nBob\t',
      html: '<table><tbody><tr><td>Alice</td><td>10</td></tr><tr><td>Bob</td><td></td></tr></tbody></table>',
    });
  });

  it('preserves an existing column-name row as ordinary table content', () => {
    const result = serializeLibraryClipboardMatrix([
      ['Name', 'Score'],
      ['Alice', 10],
    ]);

    expect(result.html).toBe(
      '<table><tbody><tr><td>Name</td><td>Score</td></tr><tr><td>Alice</td><td>10</td></tr></tbody></table>',
    );
    expect(result.html).not.toContain('<th>');
  });

  it('escapes HTML-sensitive content without changing TSV text', () => {
    const value = `<script title="quoted">& 'text'</script>`;
    const result = serializeLibraryClipboardMatrix([[value]]);

    expect(result.plainText).toBe(value);
    expect(result.html).toBe(
      '<table><tbody><tr><td>&lt;script title=&quot;quoted&quot;&gt;&amp; &#39;text&#39;&lt;/script&gt;</td></tr></tbody></table>',
    );
  });

  it('writes plain text and HTML in one ClipboardItem', async () => {
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    }
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      {
        clipboard: { write, writeText },
        ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
      },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(await item.data['text/plain'].text()).toBe('Alice\t10');
    expect(await item.data['text/html'].text()).toBe('<table></table>');
  });

  it('falls back to writeText when the rich write rejects', async () => {
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    }
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockRejectedValue(new Error('denied'));
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      {
        clipboard: { write, writeText },
        ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
      },
    );

    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });

  it('uses writeText when ClipboardItem is unavailable', async () => {
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>().mockResolvedValue(undefined);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      { clipboard: { write, writeText }, ClipboardItem: undefined },
    );

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });

  it('uses writeText when the clipboard has no rich write method', async () => {
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

    await writeLibraryClipboard(
      { plainText: 'Alice\t10', html: '<table></table>' },
      { clipboard: { writeText } },
    );

    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });

  it('rejects only after both rich and plain-text writes fail', async () => {
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    }
    const write = jest.fn<(items: ClipboardItem[]) => Promise<void>>()
      .mockRejectedValue(new Error('rich denied'));
    const writeText = jest.fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error('plain denied'));

    await expect(
      writeLibraryClipboard(
        { plainText: 'Alice\t10', html: '<table></table>' },
        {
          clipboard: { write, writeText },
          ClipboardItem: FakeClipboardItem as unknown as ClipboardItemConstructor,
        },
      ),
    ).rejects.toThrow('plain denied');
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('Alice\t10');
  });

  it('resolves when no clipboard write API is available', async () => {
    await expect(
      writeLibraryClipboard(
        { plainText: 'Alice\t10', html: '<table></table>' },
        { clipboard: {}, ClipboardItem: undefined },
      ),
    ).resolves.toBeUndefined();
  });
});
