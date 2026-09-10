/** @jest-environment jsdom */

import { describe, expect, it, jest } from '@jest/globals';
import {
  extractClipboardImageFiles,
  hasClipboardImagePayload,
  prepareClipboardRichImagePaste,
  uploadPreparedClipboardImages,
  uploadClipboardImages,
} from '@/components/documents/documentClipboardImages';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';

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

  it('detects an HTML-only image in a mixed browser clipboard payload', () => {
    const clipboard = {
      items: [
        item('string', 'text/html', null),
        item('string', 'text/plain', null),
      ],
      getData: (format: string) =>
        format === 'text/html'
          ? '<p>Before</p><img src="data:image/png;base64,cG5n"><p>After</p>'
          : 'Before\nimage\nAfter',
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboard)).toEqual([]);
    expect(hasClipboardImagePayload(clipboard)).toBe(true);
  });

  it('prepares an HTML data image synchronously and preserves its position', async () => {
    const clipboard = {
      items: [
        item('string', 'text/html', null),
        item('string', 'text/plain', null),
      ],
      getData: (format: string) =>
        format === 'text/html'
          ? '<p>Before</p><img src="data:image/png;base64,cG5n" alt="diagram"><p>After</p>'
          : 'Before\ndiagram\nAfter',
    } as unknown as DataTransfer;
    const prepared = prepareClipboardRichImagePaste(clipboard);

    expect(prepared).not.toBeNull();
    expect(prepared?.html).toMatch(
      /^<p>Before<\/p><img src="https:\/\/clipboard-image\.invalid\/keco-clipboard-[^"]+" alt="diagram"><p>After<\/p>$/,
    );
    expect(prepared?.plainText).toBe('Before\ndiagram\nAfter');
    expect(prepared?.images).toHaveLength(1);
    expect(prepared?.images[0]?.file.type).toBe('image/png');
    expect(prepared?.images[0]?.file.size).toBe(3);

    const upload = jest.fn(async () => 'https://storage.test/uploaded.png');
    const resolved = await uploadPreparedClipboardImages(prepared!.images, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(resolved[0]?.url).toBe('https://storage.test/uploaded.png');
  });

  it('uses a placeholder accepted by sanctioned document validation', () => {
    const clipboard = {
      items: [item('string', 'text/html', null)],
      getData: (format: string) =>
        format === 'text/html'
          ? '<img src="data:image/png;base64,cG5n" alt="diagram">'
          : 'diagram',
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard);
    const source = new DOMParser()
      .parseFromString(prepared!.html, 'text/html')
      .querySelector('img')!
      .getAttribute('src');

    expect(() => validateSanctionedMdx(`![diagram](${source})`)).not.toThrow();
  });

  it('prepares a parameterized embedded image data URL for upload', () => {
    const clipboard = {
      items: [item('string', 'text/html', null)],
      getData: (format: string) =>
        format === 'text/html'
          ? '<img src="data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E" alt="diagram">'
          : 'diagram',
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard);

    expect(prepared?.images).toHaveLength(1);
    expect(prepared?.images[0]?.file.type).toBe('image/svg+xml');
    expect(prepared?.images[0]?.file.name).toBe('clipboard-image-1.svg');
  });

  it('uses matching clipboard files instead of temporary HTML image URLs', () => {
    const image = new File(['clipboard png'], 'pasted.png', { type: 'image/png' });
    const clipboard = {
      items: [
        item('file', 'image/png', image),
        item('string', 'text/html', null),
        item('string', 'text/plain', null),
      ],
      getData: (format: string) =>
        format === 'text/html'
          ? '<p>Before</p><img src="blob:temporary"><p>After</p>'
          : 'Before\nAfter',
    } as unknown as DataTransfer;
    const prepared = prepareClipboardRichImagePaste(clipboard);

    expect(prepared?.images[0]?.file).toBe(image);
    expect(prepared?.html).toContain('alt="pasted.png"');
    expect(prepared?.html).not.toContain('blob:temporary');
  });

  it('never fetches an arbitrary image URL from pasted HTML', () => {
    const clipboard = {
      items: [item('string', 'text/html', null)],
      getData: (format: string) =>
        format === 'text/html'
          ? '<p>Before</p><img src="/api/private-image"><p>After</p>'
          : 'Before\nAfter',
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard);

    expect(prepared?.images).toEqual([]);
    expect(prepared?.html).not.toContain('<img');
  });

  it('drops an invalid embedded image without failing the text paste', () => {
    const clipboard = {
      items: [item('string', 'text/html', null)],
      getData: (format: string) =>
        format === 'text/html'
          ? '<p>Before</p><img src="data:image/png;base64,%%%"><p>After</p>'
          : 'Before\nAfter',
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard);

    expect(prepared?.images).toEqual([]);
    expect(prepared?.html).toBe('<p>Before</p><p>After</p>');
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
});
