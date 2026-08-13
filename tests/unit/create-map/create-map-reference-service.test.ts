import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));
const getSupabaseServiceRoleClient = jest.fn();
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));

import {
  CreateMapReferenceError,
  listCreateMapReferences,
} from '@/lib/server/createMapReferenceService';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const REFERENCE_ID = '33333333-3333-4333-8333-333333333333';
const SHA256 = 'a'.repeat(64);

describe('createMapReferenceService', () => {
  it('rejects a malformed private path before attempting to sign any URL', async () => {
    const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'https://signed.example' }, error: null }));
    const limit = jest.fn(async () => ({
      data: [{
        id: REFERENCE_ID,
        project_id: PROJECT_ID,
        name: 'layout.png',
        storage_path: `references/${PROJECT_ID}/${REFERENCE_ID}/unexpected.png`,
        sha256: SHA256,
        width: 640,
        height: 480,
        content_type: 'image/png',
        byte_size: 1024,
      }],
      error: null,
    }));
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    const storageFrom = jest.fn(() => ({ createSignedUrl }));
    getSupabaseServiceRoleClient.mockReturnValue({ from, storage: { from: storageFrom } });

    await expect(listCreateMapReferences(PROJECT_ID)).rejects.toMatchObject(
      new CreateMapReferenceError('reference_preview_failed', 502)
    );
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
