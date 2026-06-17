import type { SupabaseClient } from '@supabase/supabase-js';
import {
  uploadDocumentImages,
  uploadImageFiles,
} from '../../../src/lib/services/documentImageUpload';
import type { ExtractedImage } from '../../../src/lib/document-parser';

const USER_ID = 'user-123';

function image(contentType = 'image/png', byteLength = 1024): ExtractedImage {
  return { data: new ArrayBuffer(byteLength), contentType };
}

/**
 * Minimal fake Supabase client covering the surface uploadMediaFile uses:
 * auth.getUser and storage.from(bucket).upload/getPublicUrl. `failOnIndex`
 * makes a specific upload (by call order) fail to exercise the skip path.
 */
function makeSupabase(opts: { failOnIndex?: number } = {}): SupabaseClient {
  let uploadCall = 0;
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          const current = uploadCall++;
          if (opts.failOnIndex === current) {
            return { data: null, error: { message: 'boom' } };
          }
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://supa.example/storage/${path}` },
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

describe('uploadDocumentImages', () => {
  it('uploads every image and returns its public URL', async () => {
    const urls = await uploadDocumentImages(makeSupabase(), [image('image/png'), image('image/jpeg')], USER_ID);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('https://supa.example/storage/');
  });

  it('uses an extension derived from the content type', async () => {
    const urls = await uploadDocumentImages(makeSupabase(), [image('image/jpeg')], USER_ID);
    expect(urls[0]).toMatch(/\.jpg$/);
  });

  it('skips an image whose upload fails and keeps the rest', async () => {
    const urls = await uploadDocumentImages(
      makeSupabase({ failOnIndex: 0 }),
      [image('image/png'), image('image/png')],
      USER_ID
    );
    expect(urls).toHaveLength(1);
  });

  it('returns an empty array for no images', async () => {
    const urls = await uploadDocumentImages(makeSupabase(), [], USER_ID);
    expect(urls).toEqual([]);
  });
});

function imageFile(name = 'a.png', type = 'image/png', byteLength = 1024): File {
  return new File([new ArrayBuffer(byteLength)], name, { type });
}

describe('uploadImageFiles', () => {
  it('uploads each image file and returns its public URL', async () => {
    const urls = await uploadImageFiles(
      makeSupabase(),
      [imageFile('a.png'), imageFile('b.jpg', 'image/jpeg')],
      USER_ID
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('https://supa.example/storage/');
  });

  it('skips non-image files', async () => {
    const urls = await uploadImageFiles(
      makeSupabase(),
      [imageFile('a.png'), new File(['x'], 'note.txt', { type: 'text/plain' })],
      USER_ID
    );
    expect(urls).toHaveLength(1);
  });

  it('skips a file whose upload fails and keeps the rest', async () => {
    const urls = await uploadImageFiles(
      makeSupabase({ failOnIndex: 0 }),
      [imageFile('a.png'), imageFile('b.png')],
      USER_ID
    );
    expect(urls).toHaveLength(1);
  });
});
