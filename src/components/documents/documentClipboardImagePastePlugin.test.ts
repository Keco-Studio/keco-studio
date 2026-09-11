import { hasClipboardTextPayload } from './documentClipboardImages';

function clipboard(values: { plain?: string; html?: string }) {
  return {
    getData: (format: string) =>
      format === 'text/plain' ? values.plain ?? '' : values.html ?? '',
  } as Pick<DataTransfer, 'getData'>;
}

describe('hasClipboardTextPayload', () => {
  it('does not treat image-only HTML as text', () => {
    expect(
      hasClipboardTextPayload(
        clipboard({
          html: '<img src="blob:clipboard">',
          plain: 'Image alt text',
        }),
      ),
    ).toBe(false);
  });

  it('recognizes plain text alongside clipboard image files', () => {
    expect(hasClipboardTextPayload(clipboard({ plain: 'Heading\nBody' }))).toBe(true);
  });

  it('recognizes text surrounding an image in rich HTML', () => {
    expect(
      hasClipboardTextPayload(
        clipboard({ html: '<p>Before</p><img src="https://example.test/a.png"><p>After</p>' }),
      ),
    ).toBe(true);
  });
});
