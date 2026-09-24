import {
  backfillAccountStorage,
  parseBackfillArguments,
  type StorageAttribution,
  type StorageObject,
} from '../../../scripts/backfill-account-storage';

const objects: StorageObject[] = [
  { bucketId: 'project-assets', objectPath: 'uploader-a/project-a/path.png', sizeBytes: 1024, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'legacy/unique.png', sizeBytes: 512, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'legacy/same-owner.png', sizeBytes: 512, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'uploader-a/project-a/second.png', sizeBytes: 512, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'legacy/another-ref.png', sizeBytes: 512, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'legacy/unassigned.png', sizeBytes: 1024, uploaderId: 'uploader-a' },
  { bucketId: 'project-assets', objectPath: 'legacy/ambiguous.png', sizeBytes: 512, uploaderId: 'uploader-a' },
];

function attribution(projectId: string, ownerId = 'owner-a'): StorageAttribution {
  return { projectId, ownerId, sourceKind: 'project_asset', sourceEntityId: null, displayName: 'source.png', mimeType: 'image/png' };
}

function clientFixture() {
  const imported = new Set<string>();
  let rebuilds = 0;
  const inserts: Array<{ objectPath: string; projectId: string | null; ownerId: string }> = [];
  const candidates = new Map<string, StorageAttribution[]>([
    ['legacy/unique.png', [attribution('project-b')]],
    ['legacy/same-owner.png', [attribution('project-c'), attribution('project-b')]],
    ['legacy/another-ref.png', [attribution('project-b')]],
    ['legacy/ambiguous.png', [attribution('project-b', 'owner-a'), attribution('project-d', 'owner-d')]],
  ]);
  const client = {
    inserts,
    async listAccountedStorageObjects(bucketId: string) {
      return bucketId === 'project-assets' ? objects : [];
    },
    async findStorageAttributions(object: StorageObject) {
      return candidates.get(object.objectPath) ?? [];
    },
    async importStorageFile(input: StorageObject & StorageAttribution) {
      const importKey = `${input.bucketId}/${input.objectPath}`;
      if (imported.has(importKey)) return { inserted: false };
      imported.add(importKey);
      inserts.push({ objectPath: input.objectPath, projectId: input.projectId, ownerId: input.ownerId });
      return { inserted: true };
    },
    async rebuildAccountStorageTotals() {
      rebuilds += 1;
    },
    from(table: string) {
      if (table !== 'projects') throw new Error(`Unexpected table ${table}`);
      return {
        async select() {
          return { data: [
            { id: 'project-a', owner_id: 'owner-a' },
            { id: 'project-b', owner_id: 'owner-a' },
            { id: 'project-c', owner_id: 'owner-a' },
            { id: 'project-d', owner_id: 'owner-d' },
          ], error: null };
        },
      };
    },
  };
  return { client, inserts, rebuilds: () => rebuilds };
}

describe('account storage backfill', () => {
  it('uses path, references, a deterministic same-owner project, then uploader fallback without guessing conflicts', async () => {
    const { client, inserts, rebuilds } = clientFixture();

    await expect(backfillAccountStorage(client, { apply: false })).resolves.toEqual({
      scannedObjects: 7,
      attributableObjects: 5,
      unassignedObjects: 1,
      conflicts: 1,
      insertedFiles: 0,
      physicalBytes: 4096,
    });
    expect(inserts).toHaveLength(0);

    await expect(backfillAccountStorage(client, { apply: true }))
      .rejects.toThrow('Storage backfill aborted: 1 ambiguous object(s) require attribution');
    expect(inserts).toHaveLength(0);
    expect(rebuilds()).toBe(0);
  });

  it('imports only after a full conflict-free scan and is idempotent', async () => {
    const { client, inserts } = clientFixture();
    client.listAccountedStorageObjects = async (bucketId: string) => bucketId === 'project-assets'
      ? objects.filter(object => object.objectPath !== 'legacy/ambiguous.png') : [];
    await expect(backfillAccountStorage(client, { apply: true })).resolves.toMatchObject({ insertedFiles: 6 });
    await expect(backfillAccountStorage(client, { apply: true })).resolves.toMatchObject({ insertedFiles: 0 });
    expect(inserts).toHaveLength(6);
  });

  it('uses the service rebuild RPC and accepts its JSON result', async () => {
    const { client } = clientFixture();
    client.listAccountedStorageObjects = async (bucketId: string) => bucketId === 'project-assets'
      ? objects.filter(object => object.objectPath !== 'legacy/ambiguous.png') : [];
    delete (client as { rebuildAccountStorageTotals?: () => Promise<void> }).rebuildAccountStorageTotals;
    const rpc = jest.fn().mockResolvedValue({ data: { rebuiltAccounts: 2 }, error: null });

    await expect(backfillAccountStorage({ ...client, rpc }, { apply: true }))
      .resolves.toMatchObject({ insertedFiles: 6 });
    expect(rpc).toHaveBeenCalledWith('service_rebuild_account_storage_quota_totals');
  });

  it('reads uploader ownership from the service inventory RPC', async () => {
    const rpc = jest.fn(async (name: string, parameters?: Record<string, unknown>) => {
      if (name !== 'service_account_storage_inventory') {
        throw new Error(`Unexpected RPC ${name}`);
      }
      return {
        data: parameters?.p_bucket_id === 'project-assets'
          ? [{
            bucket_id: 'project-assets',
            object_path: 'legacy/unassigned.png',
            size_bytes: 1024,
            object_created_at: '2026-09-01T00:00:00Z',
            mime_type: 'image/png',
            uploader_id: 'uploader-a',
          }]
          : [],
        error: null,
      };
    });
    const from = (table: string) => ({
      async select() {
        return {
          data: table === 'projects' ? [{ id: 'project-a', owner_id: 'owner-a' }] : [],
          error: null,
        };
      },
    });

    await expect(backfillAccountStorage({ from, rpc }, { apply: false })).resolves.toEqual({
      scannedObjects: 1,
      attributableObjects: 0,
      unassignedObjects: 1,
      conflicts: 0,
      insertedFiles: 0,
      physicalBytes: 1024,
    });
    expect(rpc).toHaveBeenCalledWith('service_account_storage_inventory', {
      p_bucket_id: 'project-assets',
      p_offset: 0,
      p_limit: 100,
    });
  });

  it('does not replay already registered objects during a resumed apply', async () => {
    const inventory = [
      { bucket_id: 'project-assets', object_path: 'legacy/already.png', size_bytes: 64, uploader_id: 'owner-a' },
      { bucket_id: 'project-assets', object_path: 'legacy/missing.png', size_bytes: 128, uploader_id: 'owner-a' },
    ];
    const importedPaths: string[] = [];
    const rpc = jest.fn(async (name: string, parameters?: Record<string, unknown>) => {
      if (name === 'service_account_storage_inventory') {
        return { data: parameters?.p_bucket_id === 'project-assets' ? inventory : [], error: null };
      }
      if (name === 'service_import_project_storage_file') {
        importedPaths.push(String(parameters?.p_object_path));
        return { data: { inserted: true }, error: null };
      }
      if (name === 'service_rebuild_account_storage_quota_totals') {
        return { data: { rebuiltAccounts: 1 }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const from = (table: string) => ({
      async select() {
        if (table === 'projects') return { data: [], error: null };
        if (table === 'project_storage_files') {
          return {
            data: [{
              bucket_id: 'project-assets', object_path: 'legacy/already.png', project_id: null,
              owner_id: 'owner-a', source_kind: 'legacy_unassigned', source_entity_id: null,
              display_name: 'already.png', mime_type: 'image/png',
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    await expect(backfillAccountStorage({ from, rpc }, { apply: true })).resolves.toMatchObject({
      scannedObjects: 2,
      unassignedObjects: 2,
      insertedFiles: 1,
    });
    expect(importedPaths).toEqual(['legacy/missing.png']);
  });

  it('includes TipTap images as document-image files in an otherwise safe apply plan', async () => {
    const { client } = clientFixture();
    const importStorageFile = jest.fn().mockResolvedValue({ inserted: true });
    client.listAccountedStorageObjects = async (bucketId: string) => bucketId === 'tiptap-images'
      ? [{ bucketId: 'tiptap-images', objectPath: 'uploader-a/project-a/image.png', sizeBytes: 64, uploaderId: 'uploader-a' }]
      : [];
    await expect(backfillAccountStorage({ ...client, importStorageFile }, { apply: true }))
      .resolves.toMatchObject({ scannedObjects: 1, attributableObjects: 1, insertedFiles: 1 });
    expect(importStorageFile).toHaveBeenCalledWith(expect.objectContaining({
      bucketId: 'tiptap-images', sourceKind: 'document_image', projectId: 'project-a', ownerId: 'owner-a',
    }));
  });

  it('does not mutate when inventory contains an object that cannot be attributed safely', async () => {
    const { client, inserts, rebuilds } = clientFixture();
    client.listAccountedStorageObjects = async (bucketId: string) => bucketId === 'project-assets'
      ? [{ bucketId: 'project-assets', objectPath: '', sizeBytes: 64, uploaderId: 'uploader-a' }] : [];
    await expect(backfillAccountStorage(client, { apply: true }))
      .rejects.toThrow('Storage backfill aborted: 1 ambiguous object(s) require attribution');
    expect(inserts).toHaveLength(0);
    expect(rebuilds()).toBe(0);
  });

  it('fails closed when project attribution cannot be queried', async () => {
    const client = {
      async listAccountedStorageObjects() { return []; },
      from() {
        return { async select() { return { data: null, error: { message: 'offline' } }; } };
      },
    };

    await expect(backfillAccountStorage(client, { apply: true }))
      .rejects.toThrow('Storage attribution query failed for projects');
  });

  it('accepts only the report default or explicit apply flag', () => {
    expect(parseBackfillArguments([])).toEqual({ help: false, apply: false });
    expect(parseBackfillArguments(['--apply'])).toEqual({ help: false, apply: true });
    expect(parseBackfillArguments(['--help'])).toEqual({ help: true, apply: false });
    expect(() => parseBackfillArguments(['--unexpected'])).toThrow('Usage:');
  });
});
