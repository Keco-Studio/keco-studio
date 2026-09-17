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
  return { client, inserts };
}

describe('account storage backfill', () => {
  it('uses path, references, a deterministic same-owner project, then uploader fallback without guessing conflicts', async () => {
    const { client, inserts } = clientFixture();

    await expect(backfillAccountStorage(client, { apply: false })).resolves.toEqual({
      scannedObjects: 7,
      attributableObjects: 5,
      unassignedObjects: 1,
      conflicts: 1,
      insertedFiles: 0,
      totalBytes: 4096,
    });
    expect(inserts).toHaveLength(0);

    await backfillAccountStorage(client, { apply: true });
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectPath: 'uploader-a/project-a/path.png', projectId: 'project-a', ownerId: 'owner-a' }),
      expect.objectContaining({ objectPath: 'legacy/same-owner.png', projectId: 'project-b', ownerId: 'owner-a' }),
      expect.objectContaining({ objectPath: 'legacy/unassigned.png', projectId: null, ownerId: 'uploader-a' }),
    ]));
    expect(inserts).toHaveLength(6);
    expect(inserts.some(input => input.objectPath === 'legacy/ambiguous.png')).toBe(false);
  });

  it('is idempotent when the service import RPC reports existing bucket/path records', async () => {
    const { client, inserts } = clientFixture();
    await expect(backfillAccountStorage(client, { apply: true })).resolves.toMatchObject({ insertedFiles: 6 });
    await expect(backfillAccountStorage(client, { apply: true })).resolves.toMatchObject({ insertedFiles: 0 });
    expect(inserts).toHaveLength(6);
  });

  it('accepts only the report default or explicit apply flag', () => {
    expect(parseBackfillArguments([])).toEqual({ help: false, apply: false });
    expect(parseBackfillArguments(['--apply'])).toEqual({ help: false, apply: true });
    expect(parseBackfillArguments(['--help'])).toEqual({ help: true, apply: false });
    expect(() => parseBackfillArguments(['--unexpected'])).toThrow('Usage:');
  });
});
