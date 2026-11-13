import { createHash } from 'node:crypto';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.mock('server-only', () => ({}));

const reserveProjectStorage = jest.fn();
const releaseProjectStorage = jest.fn();
jest.mock('@/lib/server/storageQuota', () => ({
  reserveProjectStorage: (...args: unknown[]) => reserveProjectStorage(...args),
  releaseProjectStorage: (...args: unknown[]) => releaseProjectStorage(...args),
}));

import { registerProjectGameAssetBuffer } from '@/lib/server/projectGameAssetUpload';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function mockClient(input: { uploadError?: unknown; completionError?: unknown; completionData?: unknown } = {}) {
  const upload = jest.fn(async () => ({ data: input.uploadError ? null : { path: 'stored' }, error: input.uploadError ?? null }));
  const remove = jest.fn(async () => ({ data: [], error: null }));
  const from = jest.fn(() => ({ upload, remove }));
  const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: input.completionError ? null : (input.completionData ?? [{
      id: ASSET_ID,
      project_id: PROJECT_ID,
      category: args.p_category,
      storage_path: args.p_storage_path,
      sha256: args.p_sha256,
      width: 1,
      height: 1,
    }]),
    error: input.completionError ?? null,
  }));
  return { client: { storage: { from }, rpc } as never, upload, remove, from, rpc };
}

describe('registerProjectGameAssetBuffer', () => {
  beforeEach(() => {
    reserveProjectStorage.mockReset().mockResolvedValue({
      reservationId: RESERVATION_ID,
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      expectedBytes: PNG_BYTES.byteLength,
      reused: false,
    });
    releaseProjectStorage.mockReset().mockResolvedValue({ reservationId: RESERVATION_ID, reused: false });
  });

  it('registers a verified PNG with quota, hash, and image metadata', async () => {
    const { client, upload, rpc } = mockClient();

    const result = await registerProjectGameAssetBuffer({
      client,
      userId: USER_ID,
      projectId: PROJECT_ID,
      category: 'character',
      fileName: 'hero-cinder-warden.png',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    });

    expect(result).toMatchObject({
      assetId: ASSET_ID,
      category: 'character',
      sha256: createHash('sha256').update(PNG_BYTES).digest('hex'),
      width: 1,
      height: 1,
    });
    expect(result.storagePath).toMatch(new RegExp(`^${USER_ID}/${PROJECT_ID}/[0-9a-f-]+-hero-cinder-warden\\.png$`, 'i'));
    expect(reserveProjectStorage).toHaveBeenCalledWith(client, expect.objectContaining({
      projectId: PROJECT_ID,
      bucketId: 'project-assets',
      expectedBytes: PNG_BYTES.byteLength,
      displayName: 'hero-cinder-warden.png',
      mimeType: 'image/png',
      sourceKind: 'project_asset',
    }));
    expect(upload).toHaveBeenCalledWith(result.storagePath, PNG_BYTES, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith('complete_project_game_asset_storage_upload_v2', expect.objectContaining({
      p_project_id: PROJECT_ID,
      p_category: 'character',
      p_sha256: result.sha256,
      p_width: 1,
      p_height: 1,
      p_file_size: PNG_BYTES.byteLength,
    }));
    expect(releaseProjectStorage).not.toHaveBeenCalled();
  });

  it('rejects unsafe names and invalid content before reserving storage', async () => {
    const { client } = mockClient();

    await expect(registerProjectGameAssetBuffer({
      client,
      userId: USER_ID,
      projectId: PROJECT_ID,
      category: 'character',
      fileName: '../hero.png',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    })).rejects.toThrow('Invalid project game asset');
    await expect(registerProjectGameAssetBuffer({
      client,
      userId: USER_ID,
      projectId: PROJECT_ID,
      category: 'character',
      fileName: 'hero.png',
      mimeType: 'image/png',
      bytes: Buffer.from('not png'),
    })).rejects.toThrow('Invalid project game asset');
    expect(reserveProjectStorage).not.toHaveBeenCalled();
  });

  it('does not write storage when quota reservation fails', async () => {
    reserveProjectStorage.mockRejectedValueOnce(new Error('quota'));
    const { client, upload } = mockClient();

    await expect(registerProjectGameAssetBuffer({
      client, userId: USER_ID, projectId: PROJECT_ID, category: 'media',
      fileName: 'key-art.png', mimeType: 'image/png', bytes: PNG_BYTES,
    })).rejects.toThrow('quota');
    expect(upload).not.toHaveBeenCalled();
    expect(releaseProjectStorage).not.toHaveBeenCalled();
  });

  it('releases the reservation after a storage upload failure', async () => {
    const { client, remove } = mockClient({ uploadError: { message: 'storage down' } });

    await expect(registerProjectGameAssetBuffer({
      client, userId: USER_ID, projectId: PROJECT_ID, category: 'media',
      fileName: 'key-art.png', mimeType: 'image/png', bytes: PNG_BYTES,
    })).rejects.toThrow('Project game asset upload failed');
    expect(remove).not.toHaveBeenCalled();
    expect(releaseProjectStorage).toHaveBeenCalledWith(client, RESERVATION_ID);
  });

  it('removes the object and releases quota when completion fails', async () => {
    const { client, remove } = mockClient({ completionError: { message: 'database down' } });

    await expect(registerProjectGameAssetBuffer({
      client, userId: USER_ID, projectId: PROJECT_ID, category: 'media',
      fileName: 'key-art.png', mimeType: 'image/png', bytes: PNG_BYTES,
    })).rejects.toThrow('Project game asset registration failed');
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/key-art\.png$/)]);
    expect(releaseProjectStorage).toHaveBeenCalledWith(client, RESERVATION_ID);
  });

  it('rejects malformed completion data and compensates the upload', async () => {
    const { client, remove } = mockClient({ completionData: [{ id: 'not-a-uuid' }] });

    await expect(registerProjectGameAssetBuffer({
      client, userId: USER_ID, projectId: PROJECT_ID, category: 'media',
      fileName: 'key-art.png', mimeType: 'image/png', bytes: PNG_BYTES,
    })).rejects.toThrow('Invalid project game asset registration response');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(releaseProjectStorage).toHaveBeenCalledTimes(1);
  });
});
