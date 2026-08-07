import { markdownHasImages } from '@/lib/documents/markdownHasImages';

describe('markdownHasImages', () => {
  it('detects markdown images', () => {
    expect(markdownHasImages('Hello\n\n![alt](https://example.com/a.png)\n')).toBe(true);
  });

  it('detects titled markdown images', () => {
    expect(markdownHasImages('![alt](https://example.com/a.png "title")')).toBe(true);
  });

  it('detects residual HTML img tags', () => {
    expect(
      markdownHasImages('<img src="https://example.com/a.png" alt="resized" width="240" />')
    ).toBe(true);
  });

  it('ignores text-only markdown', () => {
    expect(markdownHasImages('# Title\n\nJust a [link](https://example.com).\n')).toBe(false);
  });

  it('ignores exclamation marks that are not images', () => {
    expect(markdownHasImages('Wow! [not an image](https://example.com)')).toBe(false);
  });
});
