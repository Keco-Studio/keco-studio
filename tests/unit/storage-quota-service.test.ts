import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import {
  finalizeProjectStorage,
  releaseProjectStorage,
  reserveProjectStorage,
  StorageQuotaError,
} from '@/lib/server/storageQuota';

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const reserveInput = {
  projectId: UUID,
  bucketId: 'project-assets',
  objectPath: `${UUID}/${OTHER_UUID}/asset.png`,
  expectedBytes: 16,
  displayName: 'asset.png',
  mimeType: 'image/png',
  sourceKind: 'project_asset' as const,
  sourceEntityId: null,
};

function rpcClient(error: unknown = null, data: unknown = null) {
  return { rpc: jest.fn().mockResolvedValue({ data, error }) };
}

describe('storage quota RPC wrappers', () => {
  it('maps quota RPC details to a stable domain error', async () => {
    const client = rpcClient({ code: 'P0001', details: 'STORAGE_QUOTA_EXCEEDED' });
    await expect(reserveProjectStorage(client as never, reserveInput))
      .rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
  });

  it('maps recognized RPC message codes and hides unknown database failures', async () => {
    await expect(finalizeProjectStorage(rpcClient({ message: 'STORAGE_RESERVATION_EXPIRED' }) as never, {
      reservationId: UUID,
      actualBytes: 16,
      sourceEntityId: null,
      objectCreatedAt: null,
    })).rejects.toMatchObject({ code: 'STORAGE_RESERVATION_EXPIRED' });

    await expect(releaseProjectStorage(rpcClient({ message: 'raw database failure' }) as never, UUID))
      .rejects.toEqual(new StorageQuotaError('STORAGE_TEMPORARILY_UNAVAILABLE'));
  });

  it('passes named RPC parameters and returns strict reservation responses', async () => {
    const reserved = {
      reservationId: UUID,
      ownerId: OTHER_UUID,
      projectId: UUID,
      expectedBytes: 16,
      reused: false,
    };
    const client = rpcClient(null, reserved);

    await expect(reserveProjectStorage(client as never, reserveInput)).resolves.toEqual(reserved);
    expect(client.rpc).toHaveBeenCalledWith('reserve_project_storage_upload', {
      p_project_id: UUID,
      p_bucket_id: 'project-assets',
      p_object_path: `${UUID}/${OTHER_UUID}/asset.png`,
      p_expected_bytes: 16,
      p_display_name: 'asset.png',
      p_mime_type: 'image/png',
      p_source_kind: 'project_asset',
      p_source_entity_id: null,
    });

    await expect(reserveProjectStorage(rpcClient(null, { ...reserved, extra: true }) as never, reserveInput))
      .rejects.toThrow('Invalid storage quota reservation');
  });

  it('parses finalized and released responses strictly', async () => {
    const finalized = {
      fileId: UUID,
      ownerId: OTHER_UUID,
      projectId: UUID,
      sizeBytes: 16,
      reservationId: OTHER_UUID,
      reused: false,
    };
    const finalClient = rpcClient(null, finalized);
    await expect(finalizeProjectStorage(finalClient as never, {
      reservationId: OTHER_UUID,
      actualBytes: 16,
      sourceEntityId: UUID,
      objectCreatedAt: '2026-09-17T00:00:00.000Z',
    })).resolves.toEqual(finalized);
    expect(finalClient.rpc).toHaveBeenCalledWith('finalize_project_storage_upload', {
      p_reservation_id: OTHER_UUID,
      p_actual_bytes: 16,
      p_source_entity_id: UUID,
      p_object_created_at: '2026-09-17T00:00:00.000Z',
    });

    const releaseClient = rpcClient(null, { reservationId: UUID, reused: true });
    await expect(releaseProjectStorage(releaseClient as never, UUID))
      .resolves.toEqual({ reservationId: UUID, reused: true });
    expect(releaseClient.rpc).toHaveBeenCalledWith('release_project_storage_upload', {
      p_reservation_id: UUID,
    });
  });
});
