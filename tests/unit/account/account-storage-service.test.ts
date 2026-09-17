import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import {
  readOwnAccountStorage,
  readProjectStorageFiles,
} from '@/lib/server/accountStorage';

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

const validProject = {
  id: UUID,
  name: 'Owned project',
  ownerName: 'Owner',
  fileCount: 2,
  usedBytes: 20,
  ownedByCurrentUser: true,
};

const validSummary = {
  quotaBytes: 1_099_511_627_776,
  usedBytes: 100,
  reservedBytes: 20,
  remainingBytes: 1_099_511_627_656,
  ownedProjects: [validProject],
  sharedProjects: [{ ...validProject, id: OTHER_UUID, ownedByCurrentUser: false }],
  unassigned: { fileCount: 1, usedBytes: 5 },
};

const validPage = {
  items: [{
    id: UUID,
    name: 'asset.png',
    mimeType: 'image/png',
    sizeBytes: 20,
    sourceKind: 'project_asset',
    sourceEntityId: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    sourceAvailable: true,
  }],
  total: 1,
  limit: 50,
  offset: 0,
};

function clientFor(data: unknown, error: unknown = null) {
  return { rpc: jest.fn().mockResolvedValue({ data, error }) };
}

describe('readOwnAccountStorage', () => {
  it('returns an exact valid account storage summary from the parameterless RPC', async () => {
    const client = clientFor(validSummary);

    await expect(readOwnAccountStorage(client as never)).resolves.toEqual(validSummary);
    expect(client.rpc).toHaveBeenCalledWith('account_storage_summary');
  });

  it('rejects fractional, negative, unsafe, missing, and extra summary fields', async () => {
    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      await expect(readOwnAccountStorage(clientFor({ ...validSummary, usedBytes: invalid }) as never))
        .rejects.toThrow('Invalid account storage field: usedBytes');
    }
    await expect(readOwnAccountStorage(clientFor({ ...validSummary, quotaBytes: undefined }) as never))
      .rejects.toThrow('Invalid account storage field: quotaBytes');
    await expect(readOwnAccountStorage(clientFor({ ...validSummary, extra: true }) as never))
      .rejects.toThrow('Invalid account storage summary');
  });

  it('rejects non-exact project and unassigned rows', async () => {
    await expect(readOwnAccountStorage(clientFor({
      ...validSummary,
      ownedProjects: [{ ...validProject, id: 'not-a-uuid' }],
    }) as never)).rejects.toThrow('Invalid account storage field: id');

    await expect(readOwnAccountStorage(clientFor({
      ...validSummary,
      sharedProjects: [{ ...validSummary.sharedProjects[0], ownedByCurrentUser: true }],
    }) as never)).rejects.toThrow('Invalid account storage field: ownedByCurrentUser');

    await expect(readOwnAccountStorage(clientFor({
      ...validSummary,
      unassigned: { fileCount: 1, usedBytes: 5, extra: true },
    }) as never)).rejects.toThrow('Invalid account storage unassigned');
  });

  it('rejects RPC errors and null response data', async () => {
    await expect(readOwnAccountStorage(clientFor(validSummary, { message: 'RPC failed' }) as never))
      .rejects.toThrow('Unable to load account storage');
    await expect(readOwnAccountStorage(clientFor(null) as never))
      .rejects.toThrow('Invalid account storage summary');
  });
});

describe('readProjectStorageFiles', () => {
  it('normalizes request pagination and query while passing named RPC parameters', async () => {
    const client = clientFor(validPage);

    await expect(readProjectStorageFiles(client as never, {
      projectId: UUID,
      query: ` ${'x'.repeat(250)} `,
      sort: 'created_desc',
      limit: 500,
      offset: 3,
    })).resolves.toEqual({ ...validPage, limit: 50, offset: 0 });

    expect(client.rpc).toHaveBeenCalledWith('account_storage_project_files', {
      p_project_id: UUID,
      p_query: 'x'.repeat(200),
      p_sort: 'created_desc',
      p_limit: 100,
      p_offset: 3,
    });
  });

  it('clamps the minimum limit and rejects negative offsets and unknown sorts', async () => {
    const client = clientFor({ ...validPage, limit: 1 });
    await expect(readProjectStorageFiles(client as never, { projectId: UUID, limit: -5 }))
      .resolves.toEqual({ ...validPage, limit: 1 });
    expect(client.rpc).toHaveBeenCalledWith('account_storage_project_files', expect.objectContaining({
      p_limit: 1,
      p_offset: 0,
    }));

    await expect(readProjectStorageFiles(clientFor(validPage) as never, {
      projectId: UUID,
      offset: -1,
    })).rejects.toThrow('Invalid account storage offset');
    await expect(readProjectStorageFiles(clientFor(validPage) as never, {
      projectId: UUID,
      sort: 'newest' as never,
    })).rejects.toThrow('Invalid account storage sort');
  });

  it('rejects malformed file rows and pages', async () => {
    await expect(readProjectStorageFiles(clientFor({
      ...validPage,
      items: [{ ...validPage.items[0], sourceKind: 'unknown' }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: sourceKind');

    await expect(readProjectStorageFiles(clientFor({
      ...validPage,
      items: [{ ...validPage.items[0], createdAt: 'not-a-timestamp' }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: createdAt');

    await expect(readProjectStorageFiles(clientFor({ ...validPage, extra: true }) as never, {
      projectId: UUID,
    })).rejects.toThrow('Invalid account storage file page');
  });
});
