import {
  sanitizeImageUrls,
  MAX_IMAGE_URLS,
} from '../../../src/lib/agent/image-url-validation';

const STORAGE = 'https://proj.supabase.co';

describe('sanitizeImageUrls', () => {
  it('returns an empty array when input is not an array', () => {
    expect(sanitizeImageUrls(undefined, STORAGE)).toEqual([]);
    expect(sanitizeImageUrls('https://proj.supabase.co/x.png', STORAGE)).toEqual([]);
    expect(sanitizeImageUrls(null, STORAGE)).toEqual([]);
  });

  it('keeps URLs that come from the configured storage origin', () => {
    const input = [
      'https://proj.supabase.co/storage/v1/object/public/library-media-files/u/a.png',
      'https://proj.supabase.co/storage/v1/object/public/library-media-files/u/b.jpg',
    ];
    expect(sanitizeImageUrls(input, STORAGE)).toEqual(input);
  });

  it('drops URLs from other origins (anti-SSRF)', () => {
    const input = [
      'https://proj.supabase.co/storage/ok.png',
      'https://evil.example/payload.png',
      'http://proj.supabase.co/insecure.png',
    ];
    expect(sanitizeImageUrls(input, STORAGE)).toEqual([
      'https://proj.supabase.co/storage/ok.png',
    ]);
  });

  it('drops non-string entries', () => {
    const input = ['https://proj.supabase.co/a.png', 123, null, { url: 'x' }];
    expect(sanitizeImageUrls(input, STORAGE)).toEqual(['https://proj.supabase.co/a.png']);
  });

  it('caps the result at MAX_IMAGE_URLS', () => {
    const input = Array.from(
      { length: MAX_IMAGE_URLS + 5 },
      (_, i) => `https://proj.supabase.co/a${i}.png`
    );
    expect(sanitizeImageUrls(input, STORAGE)).toHaveLength(MAX_IMAGE_URLS);
  });

  it('returns an empty array when no storage origin is configured', () => {
    expect(sanitizeImageUrls(['https://proj.supabase.co/a.png'], '')).toEqual([]);
  });
});
