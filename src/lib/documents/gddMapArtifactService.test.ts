import { describe, expect, it, jest } from '@jest/globals';
import { resolveGddMapArtifact } from './gddMapArtifactService';

const artifact = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Harbor', status: 'ready', phase: 'ready',
  map_project_id: '22222222-2222-4222-8222-222222222222',
  map_revision_id: '33333333-3333-4333-8333-333333333333',
  map_asset_id: '44444444-4444-4444-8444-444444444444', error: null,
};

function queryResult(data: unknown) {
  const maybeSingle = jest.fn(async () => ({ data, error: null }));
  const secondEq = jest.fn(() => ({ maybeSingle }));
  const firstEq = jest.fn(() => ({ eq: secondEq, maybeSingle }));
  return { select: jest.fn(() => ({ eq: firstEq })), maybeSingle, firstEq, secondEq };
}

describe('GDD map artifact resolver', () => {
  it('resolves a ready private asset with a five-minute signed URL', async () => {
    const artifactQuery = queryResult(artifact);
    const assetQuery = queryResult({
      id: artifact.map_asset_id, map_revision_id: artifact.map_revision_id, status: 'ready',
      storage_path: 'projects/p/maps/r/map-image.png', width: 688, height: 384,
    });
    const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'https://signed.test/map.png' }, error: null }));
    const client = {
      from: (table: string) => table === 'gdd_map_artifacts' ? artifactQuery : assetQuery,
      storage: { from: jest.fn(() => ({ createSignedUrl })) },
    };
    const result = await resolveGddMapArtifact(client as never, 'project-1', artifact.id);
    expect(result).toEqual(expect.objectContaining({ imageUrl: 'https://signed.test/map.png', width: 688, height: 384 }));
    expect(((client.storage.from as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ?? [])[0]).toBe('map-assets');
    expect((createSignedUrl.mock.calls as unknown[][])[0]).toEqual(['projects/p/maps/r/map-image.png', 300]);
    expect(((artifactQuery.secondEq.mock.calls as unknown[][])[0] ?? [])).toEqual(['project_id', 'project-1']);
    expect(((assetQuery.secondEq.mock.calls as unknown[][])[0] ?? [])).toEqual(['map_revision_id', artifact.map_revision_id]);
  });

  it('does not inspect or sign an asset while the child is pending', async () => {
    const artifactQuery = queryResult({ ...artifact, status: 'running', phase: 'polling' });
    const from = jest.fn((table: string) => {
      if (table !== 'gdd_map_artifacts') throw new Error('map asset must not be queried');
      return artifactQuery;
    });
    const storageFrom = jest.fn();
    const result = await resolveGddMapArtifact({ from, storage: { from: storageFrom } } as never, 'project-1', artifact.id);
    expect(result).toEqual(expect.objectContaining({ status: 'running', imageUrl: null }));
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('returns null for a missing or RLS-hidden artifact', async () => {
    const artifactQuery = queryResult(null);
    await expect(resolveGddMapArtifact({ from: () => artifactQuery } as never, 'project-1', artifact.id)).resolves.toBeNull();
  });
});
