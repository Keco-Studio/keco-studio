import {
  getMessageText,
  mapMessageText,
  buildUserContent,
} from '../../../src/lib/agent/content-parts';
import type { ChatContentPart } from '../../../src/lib/agent/types';

describe('getMessageText', () => {
  it('returns a string content unchanged', () => {
    expect(getMessageText('hello')).toBe('hello');
  });

  it('returns empty string for null', () => {
    expect(getMessageText(null)).toBe('');
  });

  it('concatenates text parts and ignores image parts', () => {
    const content: ChatContentPart[] = [
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'https://x/img.png' } },
      { type: 'text', text: 'b' },
    ];
    expect(getMessageText(content)).toBe('ab');
  });
});

describe('mapMessageText', () => {
  it('maps a plain string content', () => {
    expect(mapMessageText('hi', (t) => `[ctx]\n${t}`)).toBe('[ctx]\nhi');
  });

  it('rewrites only the first text part and preserves image parts and order', () => {
    const content: ChatContentPart[] = [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'https://x/img.png' } },
    ];
    const result = mapMessageText(content, (t) => `[ctx]\n${t}`);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as ChatContentPart[];
    expect(parts[0]).toEqual({ type: 'text', text: '[ctx]\nhi' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'https://x/img.png' } });
  });

  it('returns null content unchanged', () => {
    expect(mapMessageText(null, (t) => t.toUpperCase())).toBeNull();
  });
});

describe('buildUserContent', () => {
  it('returns a plain string when there are no image urls', () => {
    expect(buildUserContent('just text', [])).toBe('just text');
    expect(buildUserContent('just text', undefined)).toBe('just text');
  });

  it('returns [text, ...image_url parts] when image urls are present', () => {
    const content = buildUserContent('look at these', [
      'https://x/a.png',
      'https://x/b.jpg',
    ]);
    expect(content).toEqual([
      { type: 'text', text: 'look at these' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' } },
      { type: 'image_url', image_url: { url: 'https://x/b.jpg' } },
    ]);
  });
});
