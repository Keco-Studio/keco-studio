/** @jest-environment jsdom */

import { describe, expect, it, jest } from '@jest/globals';
import {
  extractClipboardImageFiles,
  extractClipboardRtfImageFiles,
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
  it('extracts PNG and JPEG files from WPS RTF pict groups in order', () => {
    const clipboard = {
      getData: (format: string) => format === 'text/rtf'
        ? String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}{\pict\jpegblip ffd8ffe000104a464946ffd9}}`
        : '',
    };

    const files = extractClipboardRtfImageFiles(clipboard);

    expect(files.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
      { name: 'clipboard-image-1.png', type: 'image/png', size: 8 },
      { name: 'clipboard-image-2.jpg', type: 'image/jpeg', size: 12 },
    ]);
  });

  it('deduplicates consecutive WPS compatibility pict copies', () => {
    const clipboard = {
      getData: (format: string) => format === 'text/rtf'
        ? String.raw`{\rtf1{\*\shppict{\pict\pngblip 89504e47}}{\nonshppict{\pict\pngblip 89504e47}}}`
        : '',
    };

    expect(extractClipboardRtfImageFiles(clipboard)).toHaveLength(1);
  });

  it.each([
    String.raw`{\rtf1{\pict\emfblip 0102}}`,
    String.raw`{\rtf1{\pict\pngblip 123}}`,
    String.raw`{\rtf1{\pict\jpegblip zz}}`,
    String.raw`{\rtf1{\pict\pngblip 89504e47`,
  ])('ignores unsupported or malformed RTF image data', (rtf) => {
    const clipboard = {
      getData: (format: string) => format === 'text/rtf' ? rtf : '',
    };

    expect(extractClipboardRtfImageFiles(clipboard)).toEqual([]);
  });

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

  it('maps RTF images to WPS HTML image positions in order', () => {
    const clipboard = {
      items: [
        item('string', 'text/html', null),
        item('string', 'text/rtf', null),
      ],
      getData: (format: string) => ({
        'text/html': '<p>Before</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-1.png"><p>Middle</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-2.jpg"><p>After</p>',
        'text/rtf': String.raw`{\rtf1{\pict\pngblip 89504e47}{\pict\jpegblip ffd8ffd9}}`,
        'text/plain': 'Before\nMiddle\nAfter',
      }[format] ?? ''),
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard)!;

    expect(prepared.images.map((image) => image.file.type)).toEqual([
      'image/png',
      'image/jpeg',
    ]);
    expect(prepared.wpsImageFallbackCount).toBe(0);
    expect(prepared.html).toMatch(
      /Before.*clipboard-image\.invalid.*Middle.*clipboard-image\.invalid.*After/,
    );
  });

  it('uses files before RTF and RTF before HTML data images', () => {
    const file = new File(['file'], 'from-file.png', { type: 'image/png' });
    const clipboard = {
      items: [item('file', 'image/png', file)],
      getData: (format: string) => ({
        'text/html': '<img src="data:image/gif;base64,R0lG"><img src="data:image/gif;base64,R0lG"><img src="data:image/gif;base64,R0lG">',
        'text/rtf': String.raw`{\rtf1{\pict\jpegblip ffd8ffd9}{\pict\pngblip 89504e47}}`,
        'text/plain': '',
      }[format] ?? ''),
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard)!;

    expect(prepared.images[0]?.file).toBe(file);
    expect(prepared.images[1]?.file.type).toBe('image/png');
    expect(prepared.images[2]?.file.type).toBe('image/gif');
  });

  it('replaces a missing WPS image in place and reports the fallback', () => {
    const clipboard = {
      items: [item('string', 'text/html', null)],
      getData: (format: string) => format === 'text/html'
        ? '<p>Before</p><img src="file:///C:/Users/Test/AppData/Local/Temp/ksohtml/wps_clip_image-1.png"><p>After</p>'
        : 'Before\nAfter',
    } as unknown as DataTransfer;

    const prepared = prepareClipboardRichImagePaste(clipboard)!;

    expect(prepared.images).toEqual([]);
    expect(prepared.wpsImageFallbackCount).toBe(1);
    expect(prepared.html).toBe(
      '<p>Before</p><p>[WPS image was not included in the clipboard. Paste this image separately.]</p><p>After</p>',
    );
    expect(() => validateSanctionedMdx(
      'Before\n\n[WPS image was not included in the clipboard. Paste this image separately.]\n\nAfter',
    )).not.toThrow();
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
