import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import {
  AccountStorageError,
  readOwnAccountStorage,
  readProjectStorageEntities,
  readProjectStorageEntityDetail,
  readProjectStorageFiles,
} from '@/lib/server/accountStorage';
import { StorageQuotaError } from '@/lib/server/storageQuota';

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
  physicalUsedBytes: 80,
  logicalUsedBytes: 20,
  reservedBytes: 20,
  remainingBytes: 1_099_511_627_656,
  overageBytes: 0,
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

const validEntityPage = {
  items: [{
    id: UUID,
    kind: 'table',
    name: 'Characters',
    mimeType: 'application/x-keco-table',
    logicalBytes: 20,
    physicalBytes: 80,
    sizeBytes: 100,
    parentFolderId: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    sourceAvailable: true,
  }],
  total: 1,
  limit: 50,
  offset: 0,
  breadcrumb: [],
};

const validEntityDetail = {
  id: UUID,
  kind: 'table',
  name: 'Characters',
  logicalBytes: 20,
  physicalBytes: 80,
  sizeBytes: 100,
  sourceAvailable: true,
  items: [{
    id: OTHER_UUID,
    name: 'Table data',
    mimeType: 'application/x-keco-library+json',
    sizeBytes: 20,
    itemKind: 'logical',
    groupId: null,
    groupName: null,
    createdAt: '2026-09-17T00:00:00.000Z',
  }, {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'alice.png',
    mimeType: 'image/png',
    sizeBytes: 80,
    itemKind: 'media',
    groupId: '44444444-4444-4444-8444-444444444444',
    groupName: 'Alice',
    createdAt: '2026-09-17T00:00:00.000Z',
  }],
};

function clientFor(data: unknown, error: unknown = null) {
  return { rpc: jest.fn().mockResolvedValue({ data, error }) };
}

describe('readOwnAccountStorage', () => {
  it('returns an exact valid account storage summary from the parameterless RPC', async () => {
    const client = clientFor(validSummary);

    await expect(readOwnAccountStorage(client as never)).resolves.toEqual(validSummary);
    expect(client.rpc).toHaveBeenCalledWith('account_storage_summary_v2');
  });

  it('accepts an over-quota summary with zero remaining bytes', async () => {
    const overQuota = {
      ...validSummary,
      quotaBytes: 100,
      usedBytes: 130,
      physicalUsedBytes: 90,
      logicalUsedBytes: 40,
      reservedBytes: 10,
      remainingBytes: 0,
      overageBytes: 40,
    };

    await expect(readOwnAccountStorage(clientFor(overQuota) as never)).resolves.toEqual(overQuota);
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

  it('accepts library tables as logical project files', async () => {
    const tablePage = {
      ...validPage,
      items: [{
        ...validPage.items[0],
        sourceKind: 'library_table',
        sourceEntityId: OTHER_UUID,
        mimeType: 'application/x-keco-library+json',
      }],
    };

    await expect(readProjectStorageFiles(clientFor(tablePage) as never, { projectId: UUID }))
      .resolves.toEqual(tablePage);
  });

  it.each([
    { details: 'STORAGE_PROJECT_FORBIDDEN' },
    { message: 'STORAGE_PROJECT_FORBIDDEN' },
  ])('preserves the project-forbidden code from an RPC error', async (error) => {
    await expect(readProjectStorageFiles(clientFor(validPage, error) as never, { projectId: UUID }))
      .rejects.toEqual(new StorageQuotaError('STORAGE_PROJECT_FORBIDDEN'));
  });

  it('keeps unknown project-files RPC errors generic without raw database text', async () => {
    await expect(readProjectStorageFiles(clientFor(validPage, {
      details: 'unexpected private database detail',
    }) as never, { projectId: UUID }))
      .rejects.toEqual(new Error('Unable to load project storage files'));
  });
});

describe('aggregate project storage entities', () => {
  it('loads one-level entities with normalized paging and exact byte arithmetic', async () => {
    const client = clientFor(validEntityPage);
    await expect(readProjectStorageEntities(client as never, {
      projectId: UUID,
      query: ' Characters ',
      sort: 'name_asc',
      limit: 500,
      offset: 2,
    })).resolves.toEqual(validEntityPage);
    expect(client.rpc).toHaveBeenCalledWith('account_storage_project_entities_v2', {
      p_project_id: UUID,
      p_query: 'Characters',
      p_sort: 'name_asc',
      p_limit: 100,
      p_offset: 2,
      p_parent_folder_id: null,
    });
  });

  it('loads Folder rows, validates breadcrumbs, and forwards the current directory', async () => {
    const folderPage = {
      ...validEntityPage,
      items: [{
        ...validEntityPage.items[0],
        id: OTHER_UUID,
        kind: 'folder',
        name: 'Characters',
        mimeType: 'application/x-keco-folder',
        parentFolderId: UUID,
      }],
      breadcrumb: [{ id: UUID, name: 'Game data' }],
    };
    const client = clientFor(folderPage);

    await expect(readProjectStorageEntities(client as never, {
      projectId: UUID,
      parentFolderId: UUID,
    })).resolves.toEqual(folderPage);
    expect(client.rpc).toHaveBeenCalledWith('account_storage_project_entities_v2', expect.objectContaining({
      p_parent_folder_id: UUID,
    }));
  });

  it('rejects unknown kinds, invalid folders, and inconsistent aggregate totals', async () => {
    await expect(readProjectStorageEntities(clientFor({
      ...validEntityPage,
      items: [{ ...validEntityPage.items[0], kind: 'media' }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: kind');
    await expect(readProjectStorageEntities(clientFor({
      ...validEntityPage,
      items: [{ ...validEntityPage.items[0], parentFolderId: 'not-a-uuid' }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: parentFolderId');
    await expect(readProjectStorageEntities(clientFor({
      ...validEntityPage,
      items: [{ ...validEntityPage.items[0], sizeBytes: 99 }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: sizeBytes');
    await expect(readProjectStorageEntities(clientFor({
      ...validEntityPage,
      breadcrumb: [{ id: 'not-a-uuid', name: 'Broken' }],
    }) as never, { projectId: UUID })).rejects.toThrow('Invalid account storage field: breadcrumb.id');
    await expect(readProjectStorageEntities(clientFor(validEntityPage) as never, {
      projectId: UUID,
      parentFolderId: 'not-a-uuid',
    })).rejects.toThrow('Invalid account storage field: parentFolderId');
  });

  it('loads details only when their items reconcile to the entity subtotal', async () => {
    const client = clientFor(validEntityDetail);
    await expect(readProjectStorageEntityDetail(client as never, {
      projectId: UUID,
      kind: 'table',
      entityId: UUID,
    })).resolves.toEqual(validEntityDetail);
    expect(client.rpc).toHaveBeenCalledWith('account_storage_entity_details', {
      p_project_id: UUID,
      p_entity_kind: 'table',
      p_entity_id: UUID,
    });

    await expect(readProjectStorageEntityDetail(clientFor({
      ...validEntityDetail,
      items: validEntityDetail.items.slice(0, 1),
    }) as never, { projectId: UUID, kind: 'table', entityId: UUID }))
      .rejects.toThrow('Invalid account storage field: sizeBytes');
  });

  it('preserves forbidden and entity-not-found codes without exposing database errors', async () => {
    await expect(readProjectStorageEntities(clientFor(validEntityPage, {
      details: 'STORAGE_PROJECT_FORBIDDEN',
    }) as never, { projectId: UUID }))
      .rejects.toEqual(new StorageQuotaError('STORAGE_PROJECT_FORBIDDEN'));
    await expect(readProjectStorageEntityDetail(clientFor(validEntityDetail, {
      details: 'STORAGE_ENTITY_NOT_FOUND',
    }) as never, { projectId: UUID, kind: 'assets', entityId: UUID }))
      .rejects.toEqual(new AccountStorageError('STORAGE_ENTITY_NOT_FOUND'));
    await expect(readProjectStorageEntities(clientFor(validEntityPage, {
      details: 'STORAGE_FOLDER_NOT_FOUND',
    }) as never, { projectId: UUID, parentFolderId: OTHER_UUID }))
      .rejects.toEqual(new AccountStorageError('STORAGE_FOLDER_NOT_FOUND'));
    await expect(readProjectStorageEntities(clientFor(validEntityPage, {
      details: 'private database detail',
    }) as never, { projectId: UUID }))
      .rejects.toEqual(new Error('Unable to load project storage entities'));
  });
});
