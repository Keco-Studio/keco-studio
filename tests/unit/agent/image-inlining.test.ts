import {
  isLocalOrPrivateUrl,
  inlineLocalImages,
  clearInlineCache,
  type ImageFetcher,
} from '../../../src/lib/agent/image-inlining';
import type { ChatMessage } from '../../../src/lib/agent/types';

describe('isLocalOrPrivateUrl', () => {
  it('flags localhost and loopback', () => {
    expect(isLocalOrPrivateUrl('http://localhost:54321/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://127.0.0.1:54321/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://[::1]:54321/x.png')).toBe(true);
  });

  it('flags private network ranges', () => {
    expect(isLocalOrPrivateUrl('http://192.168.1.10/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://10.0.0.5/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://172.16.0.1/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://172.31.255.255/x.png')).toBe(true);
    expect(isLocalOrPrivateUrl('http://169.254.1.1/x.png')).toBe(true);
  });

  it('does not flag public hosts', () => {
    expect(isLocalOrPrivateUrl('https://proj.supabase.co/storage/x.png')).toBe(false);
    expect(isLocalOrPrivateUrl('http://8.8.8.8/x.png')).toBe(false);
    expect(isLocalOrPrivateUrl('http://172.15.0.1/x.png')).toBe(false);
    expect(isLocalOrPrivateUrl('http://172.32.0.1/x.png')).toBe(false);
  });

  it('returns false for malformed urls', () => {
    expect(isLocalOrPrivateUrl('not a url')).toBe(false);
  });
});

const LOCAL = 'http://127.0.0.1:54321/storage/a.png';
const PUBLIC = 'https://proj.supabase.co/storage/b.png';

function userWithImages(...urls: string[]): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'hi' },
      ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  };
}

function fakeFetcher(calls: string[] = []): ImageFetcher {
  return async (url) => {
    calls.push(url);
    return { contentType: 'image/png', data: new Uint8Array([1, 2, 3]).buffer };
  };
}

describe('inlineLocalImages', () => {
  beforeEach(() => clearInlineCache());

  it('replaces a local image url with a base64 data url', async () => {
    const out = await inlineLocalImages([userWithImages(LOCAL)], fakeFetcher());
    const parts = out[0].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[1].image_url!.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('leaves public image urls untouched', async () => {
    const out = await inlineLocalImages([userWithImages(PUBLIC)], fakeFetcher());
    const parts = out[0].content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[1].image_url!.url).toBe(PUBLIC);
  });

  it('leaves string content messages untouched', async () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'plain' }];
    const out = await inlineLocalImages(messages, fakeFetcher());
    expect(out[0].content).toBe('plain');
  });

  it('drops a local image when it cannot be fetched', async () => {
    const failing: ImageFetcher = async () => null;
    const out = await inlineLocalImages([userWithImages(LOCAL)], failing);
    const parts = out[0].content as Array<{ type: string }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
  });

  it('caches fetched images so the same url is fetched once', async () => {
    const calls: string[] = [];
    const fetcher = fakeFetcher(calls);
    await inlineLocalImages([userWithImages(LOCAL)], fetcher);
    await inlineLocalImages([userWithImages(LOCAL)], fetcher);
    expect(calls).toEqual([LOCAL]);
  });

  it('returns the same array reference when there is nothing local to inline', async () => {
    const messages = [userWithImages(PUBLIC)];
    const out = await inlineLocalImages(messages, fakeFetcher());
    expect(out).toBe(messages);
  });
});
