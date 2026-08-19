import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentContentCodec', () => ({ documentContentCodec: {} }));

import { GddMapProviderError, processClaimedGddMapArtifactWithDependencies } from './worker';
import type { GddMapArtifact } from '@/lib/services/gddGenerationService';

const brief = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Harbor', mapType: 'region', sourceHeading: 'Map',
  purpose: 'Connect districts.', spatialLayout: 'A connected layout.', regions: ['North'], routes: ['Road'], landmarks: ['Gate'],
  gameplayRequirements: ['Readable traversal'], visualDescription: 'Pixel map.', outputSize: '512x512', priority: 0,
  createMapDescription: 'Top-down pixel-art map with terrain, roads, and landmarks.', styleContract: null,
};

function artifact(phase: GddMapArtifact['phase'], overrides: Partial<GddMapArtifact> = {}): GddMapArtifact {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gdd_generation_job_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    gdd_document_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', project_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    map_brief_id: brief.id, title: 'Harbor', status: 'running', phase,
    map_project_id: phase === 'planning' ? null : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    map_revision_id: phase === 'planning' ? null : 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    map_asset_id: phase === 'planning' ? null : '99999999-9999-4999-8999-999999999999',
    error: null, completed_at: null, created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
    owner_id: '12121212-1212-4121-8121-121212121212', map_brief: brief,
    generation_id: phase === 'planning' ? null : '13131313-1313-4131-8131-131313131313',
    ...overrides,
  };
}

describe('GDD map child worker', () => {
  it('prepares a deterministic V3 plan without collision work', async () => {
    const prepare = jest.fn(async () => ({ mapId: 'm', generationRevisionId: 'r', draftRevisionId: 'd', assetId: 'a' }));
    const finish = jest.fn();
    const result = await processClaimedGddMapArtifactWithDependencies({ serviceClient: {} as never, workerId: 'worker', artifact: artifact('planning') }, {
      claim: jest.fn(), prepare, reschedule: jest.fn(), finish,
      invoke: jest.fn(async () => ({ status: 'ready' })),
    } as never);
    expect(result).toBe('queued');
    expect(prepare).toHaveBeenCalled();
    expect((prepare.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({ plan: expect.objectContaining({ schemaVersion: 3, generation: expect.objectContaining({ operation: 'create_image_pro' }) }), scene: expect.objectContaining({ collisionGrid: null }) }));
    expect(finish).not.toHaveBeenCalled();
  });

  it('advances submission to polling and completed polling to validation', async () => {
    const reschedule = jest.fn(async () => 'queued' as const);
    const invoke = jest.fn(async () => ({ status: 'generating' }));
    expect(await processClaimedGddMapArtifactWithDependencies({ serviceClient: {} as never, workerId: 'worker', artifact: artifact('submitting') }, {
      claim: jest.fn(), prepare: jest.fn(), reschedule, finish: jest.fn(), invoke,
    } as never)).toBe('queued');
    expect((reschedule.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({ phase: 'polling' }));

    invoke.mockResolvedValueOnce({ status: 'completed' });
    expect(await processClaimedGddMapArtifactWithDependencies({ serviceClient: {} as never, workerId: 'worker', artifact: artifact('polling') }, {
      claim: jest.fn(), prepare: jest.fn(), reschedule, finish: jest.fn(), invoke,
    } as never)).toBe('queued');
    expect((reschedule.mock.calls as unknown[][]).at(-1)?.[1]).toEqual(expect.objectContaining({ phase: 'validating' }));
  });

  it('finishes ready validation and blocks unknown paid outcomes', async () => {
    const finish = jest.fn(async () => 'completed' as const);
    const invoke = jest.fn(async () => ({ status: 'ready' }));
    expect(await processClaimedGddMapArtifactWithDependencies({ serviceClient: {} as never, workerId: 'worker', artifact: artifact('validating') }, {
      claim: jest.fn(), prepare: jest.fn(), reschedule: jest.fn(), finish, invoke,
    } as never)).toBe('ready');
    expect((finish.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({ status: 'ready' }));

    invoke.mockRejectedValueOnce(Object.assign(new Error('ambiguous'), { code: 'pixellab_submit_outcome_unknown' }));
    const blockedFinish = jest.fn(async () => 'completed_with_map_failures' as const);
    expect(await processClaimedGddMapArtifactWithDependencies({ serviceClient: {} as never, workerId: 'worker', artifact: artifact('submitting') }, {
      claim: jest.fn(), prepare: jest.fn(), reschedule: jest.fn(), finish: blockedFinish, invoke,
    } as never)).toBe('blocked');
    expect((blockedFinish.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({ status: 'blocked' }));
  });

  it('retries transient submission failures and fails cleanly after the final attempt', async () => {
    const invoke = jest.fn(async () => {
      throw new GddMapProviderError('pixellab_upstream', 'PixelLab map request failed (503).', 503);
    });
    const reschedule = jest.fn(async () => 'queued' as const);
    const finish = jest.fn(async () => 'completed_with_map_failures' as const);
    const dependencies = { claim: jest.fn(), prepare: jest.fn(), reschedule, finish, invoke } as never;

    expect(await processClaimedGddMapArtifactWithDependencies({
      serviceClient: {} as never,
      workerId: 'worker',
      artifact: artifact('submitting', { attempt_count: 0, max_attempts: 3 }),
    }, dependencies)).toBe('queued');
    expect((reschedule.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({
      phase: 'submitting', delaySeconds: 30, error: 'PixelLab map request failed (503).',
    }));
    expect(finish).not.toHaveBeenCalled();

    expect(await processClaimedGddMapArtifactWithDependencies({
      serviceClient: {} as never,
      workerId: 'worker',
      artifact: artifact('submitting', { attempt_count: 2, max_attempts: 3 }),
    }, dependencies)).toBe('failed');
    expect((finish.mock.calls as unknown[][])[0][1]).toEqual(expect.objectContaining({
      status: 'failed', error: 'PixelLab map request failed (503).',
    }));
  });
});
