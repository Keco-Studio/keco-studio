import { describe, expect, it, jest } from '@jest/globals';
import {
  clipboardImagesToMarkdown,
  extractClipboardImageFiles,
  uploadClipboardImages,
} from '@/components/documents/documentClipboardImages';

function item(
  kind: DataTransferItem['kind'],
  type: string,
  file: File | null,
): DataTransferItem {
  return { kind, type, getAsFile: () => file } as DataTransferItem;
}

describe('document clipboard images', () => {
  it('extracts image files from a mixed clipboard payload', () => {
    const image = new File(['png'], 'pasted.png', { type: 'image/png' });
    const clipboard = {
      items: [
        item('file', 'image/png', image),
        item('string', 'text/html', null),
        item('string', 'text/plain', null),
      ],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboard)).toEqual([image]);
  });

  it('does not intercept a clipboard payload without image files', () => {
    const clipboard = {
      items: [
        item('string', 'text/html', null),
        item('string', 'text/plain', null),
      ],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboard)).toEqual([]);
  });

  it('preserves successful upload order and isolates individual failures', async () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const failed = new File(['failed'], 'failed.png', { type: 'image/png' });
    const third = new File(['third'], 'third.png', { type: 'image/png' });
    const uploadError = new Error('upload denied');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const results = await uploadClipboardImages(
        [first, failed, third],
        async (file) => {
          if (file === failed) throw uploadError;
          return `https://storage.test/${file.name}`;
        },
      );

      expect(results).toEqual([
        { file: first, url: 'https://storage.test/first.png' },
        { file: third, url: 'https://storage.test/third.png' },
      ]);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to upload pasted image: failed.png',
        uploadError,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('serializes uploaded images as markdown with escaped alt text', () => {
    const first = new File(['first'], 'screen [1].png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    expect(clipboardImagesToMarkdown([
      { file: first, url: 'https://storage.test/first.png' },
      { file: second, url: 'https://storage.test/second.png' },
    ])).toBe(
      '![screen \\[1\\].png](https://storage.test/first.png)\n\n' +
      '![second.png](https://storage.test/second.png)',
    );
  });
});
