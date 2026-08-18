import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState: jest.fn(async () => 'encoded-yjs') },
}));
import { persistGeneratedGddDocument, processClaimedGddJob, revalidateGddJobContext } from './worker';
import { GddGenerationValidationError, type GddGenerationInput, type GeneratedGdd } from '@/lib/gddGeneration';
import type { GddGenerationJob } from '@/lib/services/gddGenerationService';

const generationInput: GddGenerationInput = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Harbor Tactics',
  designSystemId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  systemTitle: 'Tactical Systems',
  designDocument: {
    designIntent: 'Readable choices.', playerFantasy: 'Lead a squad.', coreLoop: 'Scout and act.',
    decisionStructure: 'Compare costs.', systemBoundaries: 'Show costs.', progressionEconomy: 'Expand choices.',
    contentModel: 'Reusable entities.', difficultyBalance: 'Add pressure.', experiencePresentation: 'Explain changes.',
  },
  rules: {
    schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable Systems'], suitableFor: 'Tactical games',
    rules: [{ id: 'readable-state', kind: 'principle', title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' }],
    tableGuidance: [],
  },
  projectSources: [],
};

const generated: GeneratedGdd = {
  title: 'Harbor Tactics GDD', overview: 'Overview.', designIntent: 'Intent.', playerFantasy: 'Fantasy.',
  coreLoop: 'Loop.', decisionStructure: 'Decisions.', gameplaySystems: 'Systems.', contentModel: 'Content.',
  progressionEconomy: 'Progression.', difficultyBalance: 'Difficulty.', narrativeWorld: 'World.',
  experiencePresentation: 'Presentation.', productionTables: [], assumptions: ['Single-player.'],
  appliedRuleIds: ['readable-state'], omittedRuleIds: [],
};

const job = {
  id: 'job-1', owner_id: 'user-1', project_id: generationInput.projectId,
  design_system_id: generationInput.designSystemId, version_id: generationInput.versionId,
  status: 'running', phase: 'collecting', attempt_count: 1, input: generationInput,
} as unknown as GddGenerationJob;

describe('GDD generation worker', () => {
  it('persists an initialized Yjs snapshot and structured metadata without source excerpts', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({
      data: [{ document_id: 'document-1', document_name: 'Game Design Document - Draft' }],
      error: null,
    }));
    const sourceJob = {
      ...job,
      input: {
        ...generationInput,
        projectSources: [{
          kind: 'document' as const,
          projectId: generationInput.projectId,
          resourceId: 'source-1',
          label: 'Project brief',
          contentHash: 'a'.repeat(64),
          excerpt: 'private source content',
          byteCount: 22,
          truncated: false,
        }],
      },
    } as GddGenerationJob;

    await expect(persistGeneratedGddDocument({ rpc } as never, sourceJob, 'worker-1', generated, '# GDD')).resolves.toEqual({
      id: 'document-1', name: 'Game Design Document - Draft',
    });
    const rpcArgs = rpc.mock.calls[0][1] as Record<string, unknown>;
    const metadata = rpcArgs.p_metadata as Record<string, unknown>;
    const sourceSnapshots = metadata.sourceSnapshots as Array<Record<string, unknown>>;
    expect(rpcArgs.p_yjs_state).toBe('encoded-yjs');
    expect(metadata).toEqual(expect.objectContaining({
      source: 'game_design_system_generation',
      designSystemId: generationInput.designSystemId,
      versionId: generationInput.versionId,
      jobId: 'job-1',
      appliedRuleIds: ['readable-state'],
      omittedRuleIds: [],
      createdBy: 'user-1',
      createdAt: expect.any(String),
    }));
    expect(sourceSnapshots).toEqual([
      expect.objectContaining({ label: 'Project brief', contentHash: 'a'.repeat(64) }),
    ]);
    expect(sourceSnapshots[0]).not.toHaveProperty('excerpt');
  });

  it('generates and atomically persists a completed leased job with server evidence metadata', async () => {
    const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
    const persist = jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _gdd: unknown, _markdown: string) => ({ id: 'document-1', name: 'Game Design Document - Draft' }));
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat, revalidateContext: jest.fn(async () => undefined), generate: jest.fn(async () => generated), persist,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const),
      fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('completed');
    expect(heartbeat.mock.calls.map((call) => call[3])).toEqual(['generating', 'validating', 'saving']);
    expect(persist).toHaveBeenCalledWith(expect.anything(), job, 'worker-1', generated, expect.stringContaining('## Assumptions to Confirm'));
  });

  it('directly revalidates owner write access and the exact pinned binding', async () => {
    const calls: string[] = [];
    const serviceClient = {
      from: (table: string) => {
        calls.push(table);
        if (table === 'projects') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: 'user-1' }, error: null }) }) }) };
        if (table === 'project_collaborators') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
        if (table === 'project_game_design_systems') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { design_system_id: generationInput.designSystemId, version_id: generationInput.versionId }, error: null }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };

    await expect(revalidateGddJobContext(serviceClient as never, job)).resolves.toBeUndefined();
    expect(calls).toEqual(['projects', 'project_collaborators', 'project_game_design_systems']);
  });

  it.each([
    ['revoked editor permission', { owner_id: 'other' }, { role: 'editor', accepted_at: null }, { design_system_id: generationInput.designSystemId, version_id: generationInput.versionId }],
    ['viewer permission', { owner_id: 'other' }, { role: 'viewer', accepted_at: '2026-08-17' }, { design_system_id: generationInput.designSystemId, version_id: generationInput.versionId }],
    ['changed binding', { owner_id: 'user-1' }, null, { design_system_id: 'different', version_id: generationInput.versionId }],
  ])('permanently fails before model or document work for %s', async (_label, project, collaborator, binding) => {
    const serviceClient = {
      from: (table: string) => {
        if (table === 'projects') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: project, error: null }) }) }) };
        if (table === 'project_collaborators') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: collaborator, error: null }) }) }) }) };
        if (table === 'project_game_design_systems') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: binding, error: null }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    const generate = jest.fn(async () => generated);
    const persist = jest.fn(async () => ({ id: 'unused', name: 'unused' }));
    const fail = jest.fn(async () => undefined);
    const result = await processClaimedGddJob({ serviceClient: serviceClient as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined), revalidateContext: revalidateGddJobContext,
      generate, persist, retry: jest.fn(async () => 'queued' as const), fail,
    });

    expect(result).toBe('failed');
    expect(generate).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
  });

  it('requeues retryable model failures', async () => {
    const retry = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const);
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined), revalidateContext: jest.fn(async () => undefined), generate: jest.fn(async () => { throw new Error('network'); }),
      persist: jest.fn(async () => ({ id: 'unused', name: 'unused' })),
      retry, fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('queued');
    expect(retry).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'network', 5);
  });

  it('fails permanent schema errors without creating a Document', async () => {
    const fail = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined);
    const persist = jest.fn(async () => ({ id: 'unused', name: 'unused' }));
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined),
      revalidateContext: jest.fn(async () => undefined),
      generate: jest.fn(async () => { throw new GddGenerationValidationError('bad GDD'); }),
      persist,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const), fail,
    });
    expect(result).toBe('failed');
    expect(persist).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'bad GDD');
  });
});
