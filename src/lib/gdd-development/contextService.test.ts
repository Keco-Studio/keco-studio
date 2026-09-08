import type { SupabaseClient } from '@supabase/supabase-js';
import { jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({ readDocumentState: jest.fn() }));
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import { readGddDevelopmentContext } from './contextService';

const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  document: '22222222-2222-4222-8222-222222222222',
  job: '33333333-3333-4333-8333-333333333333',
  system: '44444444-4444-4444-8444-444444444444',
  version: '55555555-5555-4555-8555-555555555555',
  map: '99999999-9999-4999-8999-999999999999',
  artifact: '66666666-6666-4666-8666-666666666666',
  revision: '77777777-7777-4777-8777-777777777777',
  asset: '88888888-8888-4888-8888-888888888888',
};

function client(rows: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      from(table: string) {
        calls.push(table);
        const builder = {
          select() { return builder; }, eq() { return builder; },
          async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
        };
        return builder;
      },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.test/map.png' }, error: null }) }) },
    } as unknown as SupabaseClient,
  };
}

describe('GDD development context service', () => {
  it('resolves the exact historical version without reading the current binding', async () => {
    const artStyle = compileGameArtStyle({ presetId: 'pixel-art', presetVersion: 2, customization: { referenceGames: [] } });
    const fake = client({
      documents: { id: ids.document, project_id: ids.project, gdd_generation_job_id: ids.job },
      gdd_generation_jobs: { id: ids.job, project_id: ids.project, design_system_id: ids.system, version_id: ids.version },
      game_design_system_versions: { id: ids.version, system_id: ids.system, version_number: 3, content_hash: 'a'.repeat(64), art_style: artStyle },
    });
    const context = await readGddDevelopmentContext(fake.value, { projectId: ids.project, documentId: ids.document }, {
      now: () => 0,
      readState: async () => ({ documentId: ids.document, projectId: ids.project, mode: 'legacy', yjsStateBase64: null, updateTail: [], token: { epoch: 2, revision: 4 }, epochReason: 'initialize', updatedAt: '2026-09-08T00:00:00.000Z', markdown: `<GddMapReference artifactId="${ids.artifact}" display="full" fallbackTitle="Map" />` }),
      resolveMaps: async () => new Map([[ids.artifact, { artifactId: ids.artifact, title: 'Map', status: 'ready', mapProjectId: ids.map, mapRevisionId: ids.revision, mapAssetId: ids.asset, asset: { id: ids.asset, mapRevisionId: ids.revision, status: 'ready', storagePath: `${ids.project}/${ids.map}/${ids.revision}/map-image/${'b'.repeat(64)}.png`, sha256: 'b'.repeat(64), width: 512, height: 512, hasTransparency: false } }]]),
    });
    expect(context.origin).toMatchObject({ generationJobId: ids.job, versionId: ids.version, versionNumber: 3 });
    expect(context.artStyle?.snapshot.presetId).toBe('pixel-art');
    expect(context.assets[0]).toMatchObject({ intendedRole: 'runtime_candidate', assetId: ids.asset, revisionId: ids.revision });
    expect(fake.calls).not.toContain('project_game_design_systems');
  });

  it('does not sign a ready asset whose private path is outside its exact map identity', async () => {
    const fake = client({ documents: { id: ids.document, project_id: ids.project, gdd_generation_job_id: null } });
    const context = await readGddDevelopmentContext(fake.value, { projectId: ids.project, documentId: ids.document }, {
      readState: async () => ({ documentId: ids.document, projectId: ids.project, mode: 'legacy', yjsStateBase64: null, updateTail: [], token: { epoch: 0, revision: 0 }, epochReason: 'initialize', updatedAt: '2026-09-08T00:00:00.000Z', markdown: `<GddMapReference artifactId="${ids.artifact}" display="full" fallbackTitle="Map" />` }),
      resolveMaps: async () => new Map([[ids.artifact, { artifactId: ids.artifact, title: 'Map', status: 'ready', mapProjectId: ids.map, mapRevisionId: ids.revision, mapAssetId: ids.asset, asset: { id: ids.asset, mapRevisionId: ids.revision, status: 'ready', storagePath: `other-project/${ids.map}/${ids.revision}/map-image/${'b'.repeat(64)}.png`, sha256: 'b'.repeat(64), width: 512, height: 512, hasTransparency: false } }]]),
    });
    expect(context.assets[0]).toMatchObject({ assetId: null, delivery: null });
    expect(context.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ASSET_UNAVAILABLE' })]));
  });

  it('keeps legacy origins null and external images unclassified', async () => {
    const fake = client({ documents: { id: ids.document, project_id: ids.project, gdd_generation_job_id: null } });
    const context = await readGddDevelopmentContext(fake.value, { projectId: ids.project, documentId: ids.document }, {
      readState: async () => ({ documentId: ids.document, projectId: ids.project, mode: 'legacy', yjsStateBase64: null, updateTail: [], token: { epoch: 0, revision: 0 }, epochReason: 'initialize', updatedAt: '2026-09-08T00:00:00.000Z', markdown: '![Concept](https://example.test/concept.png)' }),
      resolveMaps: async () => new Map(),
    });
    expect(context.origin).toBeNull();
    expect(context.artStyle).toBeNull();
    expect(context.assets[0]).toMatchObject({ assetId: null, intendedRole: 'unclassified', delivery: null });
  });
});
