import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState: jest.fn(async () => 'encoded-yjs') },
}));
import {
  describeGddGenerationError,
  persistGeneratedGddDocument,
  persistGeneratedGddV2Document,
  processClaimedGddJob,
  revalidateGddJobContext,
  shouldWakeGddGenerationJob,
} from './worker';
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

const persistedGdd = (id: string, name: string) => ({
  id,
  name,
  generationRevision: null,
  resourceChangeSummary: null,
});

describe('GDD generation worker', () => {
  it('wakes available queued jobs and expired running leases only', () => {
    const now = Date.parse('2026-08-19T06:00:00.000Z');
    const base = {
      status: 'queued' as const,
      available_at: '2026-08-19T05:59:00.000Z',
      lease_expires_at: null,
    };
    expect(shouldWakeGddGenerationJob(base, now)).toBe(true);
    expect(shouldWakeGddGenerationJob({ ...base, available_at: '2026-08-19T06:01:00.000Z' }, now)).toBe(false);
    expect(shouldWakeGddGenerationJob({ ...base, status: 'running', lease_expires_at: '2026-08-19T05:59:00.000Z' }, now)).toBe(true);
    expect(shouldWakeGddGenerationJob({ ...base, status: 'running', lease_expires_at: '2026-08-19T06:01:00.000Z' }, now)).toBe(false);
    expect(shouldWakeGddGenerationJob({ ...base, status: 'completed' }, now)).toBe(false);
  });

  it('preserves useful details from structured generation errors', () => {
    expect(describeGddGenerationError({
      message: 'Generated table row is invalid',
      details: 'Field cost is missing',
      code: '22023',
    })).toBe('Generated table row is invalid: Field cost is missing [22023]');
  });

  it('persists an initialized Yjs snapshot and structured metadata without source excerpts', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({
      data: [{
        document_id: 'document-1', document_name: 'Harbor Tactics gdd', generation_revision: 3,
        resource_change_summary: { created: ['table:skills'], updated: [], reused: ['gdd_document:gdd'], preserved: [] },
      }],
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
      id: 'document-1', name: 'Harbor Tactics gdd', generationRevision: 3,
      resourceChangeSummary: { created: ['table:skills'], updated: [], reused: ['gdd_document:gdd'], preserved: [] },
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
    expect(rpcArgs.p_table_resources).toEqual([]);
  });

  it('rejects malformed persistence revision evidence at the worker boundary', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({
      data: [{
        document_id: 'document-1', document_name: 'Harbor Tactics gdd', generation_revision: 0,
        resource_change_summary: { created: [], updated: [], reused: [], preserved: [] },
      }],
      error: null,
    }));

    await expect(
      persistGeneratedGddDocument({ rpc } as never, job, 'worker-1', generated, '# GDD'),
    ).rejects.toThrow(/generation revision/i);
  });

  it('persists v2 table references as safe project-relative links', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ document_id: 'document-1', document_name: 'GDD' }], error: null }));
    await persistGeneratedGddV2Document(
      { rpc } as never,
      { ...job, input: { ...generationInput, contractVersion: 2, mode: 'quick', language: 'zh-CN' } } as GddGenerationJob,
      'worker-1',
      '# GDD\n\n## Core Loop\nBody.',
      { version: 2, summary: 'pass', status: 'pass', issues: [] },
      [{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }],
    );
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_markdown).toContain(`[Skills](/${generationInput.projectId}/`);
    expect(args.p_markdown).not.toContain('keco://');
    expect(args.p_metadata).toEqual(expect.objectContaining({
      tableResources: [expect.objectContaining({
        rows: [expect.objectContaining({ values: { name: 'Basic' } })],
      })],
    }));
  });

  it('rebuilds v1 Markdown with table references at the persistence boundary', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ document_id: 'document-1', document_name: 'GDD' }], error: null }));
    await persistGeneratedGddDocument(
      { rpc } as never,
      job,
      'worker-1',
      { ...generated, productionTables: [{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }] },
      '# Incomplete caller Markdown',
    );
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_markdown).toContain(`[Skills](/${generationInput.projectId}/`);
    expect(args.p_markdown).not.toContain('Incomplete caller Markdown');
  });

  it('generates and atomically persists a completed leased job with server evidence metadata', async () => {
    const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
    const persist = jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _gdd: unknown, _markdown: string) => persistedGdd('document-1', 'Harbor Tactics gdd'));
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat, revalidateContext: jest.fn(async () => undefined), generate: jest.fn(async () => generated), persist,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const),
      fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('completed');
    expect(heartbeat.mock.calls.map((call) => call[3])).toEqual(['generating', 'validating', 'saving']);
    expect(persist).toHaveBeenCalledWith(expect.anything(), job, 'worker-1', generated, expect.stringContaining('## Assumptions to Confirm'));
  });

  it('renews the lease while a structured v2 generation is still running', async () => {
    jest.useFakeTimers();
    let finishGeneration!: (value: { markdown: string; review: any }) => void;
    const generateV2 = jest.fn(() => new Promise<{ markdown: string; review: any }>((resolve) => { finishGeneration = resolve; }));
    const heartbeat = jest.fn(async () => undefined);
    const persistV2 = jest.fn(async (..._args: unknown[]) => persistedGdd('document-1', 'GDD'));
    const v2Job = {
      ...job,
      input: {
        contractVersion: 2, mode: 'quick', projectId: generationInput.projectId,
        versionId: generationInput.versionId,
      },
    } as GddGenerationJob;
    const resultPromise = processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job: v2Job }, {
      heartbeat,
      revalidateContext: jest.fn(async () => undefined),
      generate: jest.fn(async () => generated),
      generateV2: generateV2 as never,
      persist: jest.fn(async () => persistedGdd('unused', 'unused')),
      persistV2,
      retry: jest.fn(async () => 'queued' as const),
      fail: jest.fn(async () => undefined),
    });
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect((heartbeat.mock.calls as unknown[][]).filter((call) => call[3] === 'generating')).toHaveLength(2);

    finishGeneration({
      markdown: '# GDD\n\n## Core Loop\nBody text.',
      review: { version: 2, summary: 'pass', status: 'pass', issues: [] },
    });
    await expect(resultPromise).resolves.toBe('completed');
    expect(persistV2).toHaveBeenCalledWith(
      expect.anything(),
      v2Job,
      'worker-1',
      '# GDD\n\n## Core Loop\nBody text.',
      expect.objectContaining({ status: 'pass' }),
      undefined,
    );
    jest.useRealTimers();
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
    const persist = jest.fn(async () => persistedGdd('unused', 'unused'));
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
      persist: jest.fn(async () => persistedGdd('unused', 'unused')),
      retry, fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('queued');
    expect(retry).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'network', 5);
  });

  it('fails permanent schema errors without creating a Document', async () => {
    const fail = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined);
    const persist = jest.fn(async () => persistedGdd('unused', 'unused'));
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
