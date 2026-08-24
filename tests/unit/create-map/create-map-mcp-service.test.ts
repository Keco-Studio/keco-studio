import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/createMapDocumentSource', () => ({
  readCreateMapDocumentSource: jest.fn(),
}));
jest.mock('@/lib/server/createMapPlanner', () => ({
  createMapPlanV3: jest.fn(),
}));
jest.mock('@/features/create-map/services/createMapService', () => ({
  createMapService: jest.fn(),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: jest.fn(),
}));

import {
  CREATE_MAP_MCP_UNSAFE_DESCRIPTION_MESSAGE,
  CreateMapMcpError,
  createMapMcpPublicMessage,
  createMapMcpService,
  type CreateMapMcpBackend,
} from '@/lib/server/createMapMcpService';

const IDS = {
  userId: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  mapId: '10000000-0000-4000-8000-000000000003',
  revisionId: '10000000-0000-4000-8000-000000000004',
  nextRevisionId: '10000000-0000-4000-8000-000000000005',
  assetId: '10000000-0000-4000-8000-000000000006',
  generationId: '10000000-0000-4000-8000-000000000007',
  requestId: '10000000-0000-4000-8000-000000000008',
};
const fingerprint = 'a'.repeat(64);
const plan = makeValidMapPlanV3();
const scene = makeEmptyMapSceneV3();

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.assetId,
    status: 'planned' as const,
    generationId: IDS.generationId,
    planFingerprint: fingerprint,
    attemptCount: 0,
    lastErrorCode: null,
    providerJobId: null,
    storagePath: null,
    sha256: null,
    width: null,
    height: null,
    hasTransparency: null,
    imageUrl: null,
    ...overrides,
  };
}

function generation(overrides: Record<string, unknown> = {}) {
  return {
    projectId: IDS.projectId,
    mapId: IDS.mapId,
    revisionId: IDS.revisionId,
    saveVersion: 0,
    plan,
    asset: asset(),
    ...overrides,
  };
}

function backend(): jest.Mocked<CreateMapMcpBackend> {
  return {
    getProjectRole: jest.fn(async () => 'editor'),
    listMaps: jest.fn(async () => []),
    readMap: jest.fn(async () => ({
      projectId: IDS.projectId,
      identity: {
        mapId: IDS.mapId,
        revisionId: IDS.revisionId,
        revisionNumber: 1,
        saveVersion: 0,
      },
      plan,
      scene,
      sourceDocumentId: null,
      generation: null,
    })),
    claimDraft: jest.fn(async () => ({
      status: 'claimed' as const,
      claimToken: IDS.requestId,
      source: undefined,
      sourceToken: null,
      references: { references: [], styleReference: null },
    })),
    createDraft: jest.fn(async (_input, _claim) => ({
      projectId: IDS.projectId,
      identity: {
        mapId: IDS.mapId,
        revisionId: IDS.revisionId,
        revisionNumber: 1,
        saveVersion: 0,
      },
      plan,
      scene,
      sourceDocumentId: null,
      generation: null,
    })),
    releaseDraft: jest.fn(async () => undefined),
    updateDraft: jest.fn(async () => 1),
    readRevision: jest.fn(async () => ({ saveVersion: 0, plan })),
    prepareAssetPlan: jest.fn(async () => ({
      publishedRevisionId: IDS.revisionId,
      nextDraftRevisionId: IDS.nextRevisionId,
      assetId: IDS.assetId,
      status: 'planned',
    })),
    findGeneration: jest.fn(async () => null),
    readGeneration: jest.fn(async () => generation()),
    invokeProvider: jest.fn(async () => ({ assetId: IDS.assetId, status: 'generating' })),
  };
}

describe('Create Map MCP service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an idempotent V3 draft through the backend', async () => {
    const domain = backend();
    const order: string[] = [];
    const claimDraft = jest.fn(async () => {
      order.push('claim');
      return { status: 'claimed' as const, claimToken: IDS.requestId };
    });
    (domain as unknown as { claimDraft: typeof claimDraft }).claimDraft = claimDraft;
    domain.createDraft.mockImplementationOnce(async () => {
      order.push('plan');
      return backend().createDraft({} as never, {} as never);
    });
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      randomUUID: () => IDS.generationId,
    });

    await expect(service.createDraft({
      projectId: IDS.projectId,
      description: 'A compact mountain village',
      documentId: null,
      referenceIds: [],
      styleReferenceId: null,
      referenceRoles: {},
      referenceUsage: {},
      styleCopy: [],
      idempotencyKey: IDS.requestId,
    })).resolves.toMatchObject({ mapId: IDS.mapId, schemaVersion: 3 });
    expect(domain.getProjectRole).toHaveBeenCalledWith(IDS.projectId, IDS.userId);
    expect(domain.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      projectId: IDS.projectId,
      idempotencyKey: IDS.requestId,
      description: 'A compact mountain village',
    }), expect.objectContaining({ status: 'claimed' }));
    expect(order).toEqual(['claim', 'plan']);
  });

  it('returns actionable validation guidance and releases an unsafe draft claim', async () => {
    const domain = backend();
    domain.createDraft.mockRejectedValueOnce({ code: 'map_description_unsafe' });
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
    });

    await expect(service.createDraft({
      projectId: IDS.projectId,
      description: 'Unsupported map instructions',
      documentId: null,
      referenceIds: [],
      styleReferenceId: null,
      referenceRoles: {},
      referenceUsage: {},
      styleCopy: [],
      idempotencyKey: IDS.requestId,
    })).rejects.toMatchObject({
      code: 'FIELD_VALIDATION_FAILED',
      message: CREATE_MAP_MCP_UNSAFE_DESCRIPTION_MESSAGE,
    });
    expect(domain.releaseDraft).toHaveBeenCalledWith({
      idempotencyKey: IDS.requestId,
      claimToken: IDS.requestId,
    });
    expect(domain.invokeProvider).not.toHaveBeenCalled();
  });

  it('only exposes the approved unsafe-description validation message', () => {
    expect(createMapMcpPublicMessage(
      'FIELD_VALIDATION_FAILED',
      CREATE_MAP_MCP_UNSAFE_DESCRIPTION_MESSAGE,
    )).toBe(CREATE_MAP_MCP_UNSAFE_DESCRIPTION_MESSAGE);
    expect(createMapMcpPublicMessage(
      'FIELD_VALIDATION_FAILED',
      'Description matched secret-value-123',
    )).toBe('The Create Map request is invalid.');
  });

  it('replays a completed draft claim without calling the planner backend', async () => {
    const domain = backend();
    const completed = await domain.createDraft({} as never, {} as never);
    domain.createDraft.mockClear();
    const claimDraft = jest.fn(async () => ({
      status: 'completed' as const,
      workspace: completed,
    }));
    (domain as unknown as { claimDraft: typeof claimDraft }).claimDraft = claimDraft;
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
    });

    await expect(service.createDraft({
      projectId: IDS.projectId,
      description: 'A compact mountain village',
      documentId: null,
      referenceIds: [],
      styleReferenceId: null,
      referenceRoles: {},
      referenceUsage: {},
      styleCopy: [],
      idempotencyKey: IDS.requestId,
    })).resolves.toMatchObject({ mapId: IDS.mapId });
    expect(claimDraft).toHaveBeenCalledTimes(1);
    expect(domain.createDraft).not.toHaveBeenCalled();
  });

  it('prepares a frozen revision and returns a fee notice without provider contact', async () => {
    const domain = backend();
    const prepareAssetPlan = jest.fn(async () => ({
      publishedRevisionId: IDS.revisionId,
      nextDraftRevisionId: IDS.nextRevisionId,
      assetId: IDS.assetId,
      status: 'planned' as const,
    }));
    (domain as unknown as { prepareAssetPlan: typeof prepareAssetPlan }).prepareAssetPlan = prepareAssetPlan;
    const sign = jest.fn(() => 'signed-confirmation');
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      randomUUID: () => IDS.generationId,
      signConfirmation: sign,
      now: () => 1_787_260_000_000,
    });

    await expect(service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    })).resolves.toMatchObject({
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: 'signed-confirmation',
      feeNotice: expect.stringMatching(/paid|credits/i),
      confirmationExpiresAt: new Date(1_787_260_600_000).toISOString(),
    });
    expect(prepareAssetPlan).toHaveBeenCalledWith(expect.objectContaining({
      revisionId: IDS.revisionId,
      saveVersion: 0,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    }));
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'submit',
      userId: IDS.userId,
      assetId: IDS.assetId,
      attemptCount: 0,
    }));
    expect(domain.invokeProvider).not.toHaveBeenCalled();
  });

  it('replays an asset created by a concurrent atomic prepare', async () => {
    const domain = backend();
    const existing = generation();
    domain.findGeneration
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    domain.prepareAssetPlan.mockRejectedValueOnce({ code: 'KM413' });
    const sign = jest.fn(() => 'concurrent-confirmation');
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      randomUUID: () => '20000000-0000-4000-8000-000000000001',
      signConfirmation: sign,
    });

    await expect(service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    })).resolves.toMatchObject({
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      confirmationToken: 'concurrent-confirmation',
    });
    expect(domain.readGeneration).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      generationId: IDS.generationId,
    }));
  });

  it('maps an unreplayable generation identity conflict to a stale revision', async () => {
    const domain = backend();
    domain.findGeneration.mockResolvedValue(null);
    domain.prepareAssetPlan.mockRejectedValueOnce({ code: 'KM413' });
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      randomUUID: () => IDS.generationId,
    });

    await expect(service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    })).rejects.toMatchObject({ code: 'MAP_REVISION_STALE' });
  });

  it('submits once only after confirmation and returns replayed provider state', async () => {
    const domain = backend();
    const verify = jest.fn();
    domain.readGeneration
      .mockResolvedValueOnce(generation())
      .mockResolvedValueOnce(generation({ asset: asset({ status: 'generating', providerJobId: 'job-1' }) }))
      .mockResolvedValueOnce(generation({ asset: asset({ status: 'generating', providerJobId: 'job-1' }) }));
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      verifyConfirmation: verify,
    });
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: 'signed-confirmation',
      confirmPaidGeneration: true as const,
    };

    await expect(service.startGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    await expect(service.startGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    expect(verify).toHaveBeenCalledWith('signed-confirmation', expect.objectContaining({
      purpose: 'submit',
      assetId: IDS.assetId,
    }));
    expect(domain.invokeProvider).toHaveBeenCalledTimes(1);
    expect(domain.invokeProvider).toHaveBeenCalledWith('submit', expect.objectContaining({
      assetId: IDS.assetId,
    }));
  });

  it('rejects changed generation identity and downgraded roles before provider contact', async () => {
    const domain = backend();
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      verifyConfirmation: jest.fn(),
    });
    const base = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: 'signed-confirmation',
      confirmPaidGeneration: true as const,
    };

    domain.readGeneration.mockResolvedValueOnce(generation({
      asset: asset({ planFingerprint: 'b'.repeat(64) }),
    }));
    await expect(service.startGeneration(base)).rejects.toMatchObject({
      code: 'MAP_CONFIRMATION_MISMATCH',
    });
    domain.getProjectRole.mockResolvedValueOnce('viewer');
    await expect(service.startGeneration(base)).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FORBIDDEN',
    });
    expect(domain.invokeProvider).not.toHaveBeenCalled();
  });

  it('requires a fresh retry confirmation before resubmitting a safely rejected request', async () => {
    const domain = backend();
    const blockedState = generation({
      asset: asset({ status: 'blocked', lastErrorCode: 'pixellab_rate_limited' }),
    });
    domain.findGeneration.mockResolvedValue(blockedState);
    domain.readGeneration
      .mockResolvedValueOnce(blockedState)
      .mockResolvedValueOnce(generation({
        asset: asset({ status: 'generating', providerJobId: 'retry-job' }),
      }));
    const sign = jest.fn(() => 'retry-confirmation');
    const verify = jest.fn();
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      signConfirmation: sign,
      verifyConfirmation: verify,
    });

    const prepared = await service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    });
    expect(prepared).toMatchObject({
      confirmationPurpose: 'retry',
      confirmationToken: 'retry-confirmation',
      feeNotice: expect.stringMatching(/paid|credits/i),
    });
    expect(domain.invokeProvider).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'retry' }));

    await expect(service.startGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: 'retry-confirmation',
      confirmPaidGeneration: true,
    })).resolves.toMatchObject({ status: 'generating' });
    expect(verify).toHaveBeenCalledWith('retry-confirmation', expect.objectContaining({
      purpose: 'retry',
    }));
    expect(domain.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({
      assetId: IDS.assetId,
      expectedAttemptCount: 0,
    }));
    expect(service).not.toHaveProperty('retryGeneration');
  });

  it('rejects a retry confirmation after its provider submission advances the attempt', async () => {
    const domain = backend();
    let current = generation({
      asset: asset({
        status: 'failed',
        providerJobId: 'retry-job',
        attemptCount: 4,
      }),
    });
    domain.findGeneration.mockImplementation(async () => current);
    domain.readGeneration.mockImplementation(async () => current);
    domain.invokeProvider.mockImplementation(async () => {
      current = generation({
        asset: asset({
          status: 'failed',
          providerJobId: 'retry-job',
          attemptCount: 5,
        }),
      });
      return { status: 'failed' };
    });
    const sign = jest.fn((binding: { attemptCount: number }) => `retry-${binding.attemptCount}`);
    const verify = jest.fn((token: string, binding: { attemptCount: number }) => {
      if (token !== `retry-${binding.attemptCount}`) {
        throw { code: 'MAP_CONFIRMATION_MISMATCH' };
      }
    });
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      signConfirmation: sign,
      verifyConfirmation: verify,
    });

    const prepared = await service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    });
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: prepared.confirmationToken,
      confirmPaidGeneration: true as const,
    };

    await expect(service.startGeneration(input)).resolves.toMatchObject({
      status: 'failed',
      attemptCount: 5,
    });
    await expect(service.startGeneration(input)).rejects.toMatchObject({
      code: 'MAP_CONFIRMATION_MISMATCH',
    });
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'retry',
      attemptCount: 4,
    }));
    expect(verify).toHaveBeenNthCalledWith(1, 'retry-4', expect.objectContaining({ attemptCount: 4 }));
    expect(verify).toHaveBeenNthCalledWith(2, 'retry-4', expect.objectContaining({ attemptCount: 5 }));
    expect(domain.invokeProvider).toHaveBeenCalledTimes(1);
    expect(domain.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({
      expectedAttemptCount: 4,
    }));
  });

  it.each(['queued', 'generating', 'ready'] as const)(
    'replays %s state without validating a confirmation token',
    async (status) => {
      const domain = backend();
      domain.readGeneration.mockResolvedValue(generation({ asset: asset({ status, attemptCount: 1 }) }));
      const verify = jest.fn();
      const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
        backend: domain,
        fingerprintPlan: () => fingerprint,
        verifyConfirmation: verify,
      });

      await expect(service.startGeneration({
        projectId: IDS.projectId,
        mapId: IDS.mapId,
        revisionId: IDS.revisionId,
        assetId: IDS.assetId,
        generationId: IDS.generationId,
        planFingerprint: fingerprint,
        confirmationToken: 'stale-confirmation',
        confirmPaidGeneration: true,
      })).resolves.toMatchObject({ status });
      expect(verify).not.toHaveBeenCalled();
      expect(domain.invokeProvider).not.toHaveBeenCalled();
    },
  );

  it('keeps generation reads provider-free and advances existing jobs only for writers', async () => {
    const domain = backend();
    const generating = generation({
      asset: asset({ status: 'generating', providerJobId: 'job-1' }),
    });
    domain.readGeneration.mockResolvedValue(generating);
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
    });
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    };

    await expect(service.getGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    expect(domain.invokeProvider).not.toHaveBeenCalled();

    domain.invokeProvider.mockResolvedValueOnce({ status: 'completed' });
    await expect((service as unknown as {
      advanceGeneration(value: typeof input): Promise<unknown>;
    }).advanceGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    expect(domain.getProjectRole).toHaveBeenCalledWith(IDS.projectId, IDS.userId);
    expect(domain.invokeProvider).toHaveBeenNthCalledWith(1, 'poll', expect.objectContaining({
      assetId: IDS.assetId,
    }));
    expect(domain.invokeProvider).toHaveBeenNthCalledWith(2, 'validate', expect.objectContaining({
      assetId: IDS.assetId,
    }));
  });

  it('resolves an old queued submission to an unknown outcome without resubmitting it', async () => {
    const domain = backend();
    const queued = generation({ asset: asset({ status: 'queued' }) });
    const blocked = generation({
      asset: asset({
        status: 'blocked',
        lastErrorCode: 'pixellab_submit_outcome_unknown',
      }),
    });
    domain.readGeneration
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(blocked);
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
    });
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    };

    await expect(service.advanceGeneration(input)).resolves.toMatchObject({
      status: 'blocked',
      lastErrorCode: 'pixellab_submit_outcome_unknown',
    });
    expect(domain.invokeProvider).toHaveBeenCalledTimes(1);
    expect(domain.invokeProvider).toHaveBeenCalledWith('resolve_unknown', {
      ...input,
      acknowledgeDuplicateBilling: true,
    });
  });

  it('reports an unsafe queued resolution as a stable blocked state', async () => {
    const domain = backend();
    domain.readGeneration.mockResolvedValue(generation({
      asset: asset({ status: 'queued' }),
    }));
    domain.invokeProvider.mockRejectedValue({ code: 'pixellab_invalid_response' });
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
    });

    await expect(service.advanceGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    })).rejects.toMatchObject({ code: 'MAP_GENERATION_BLOCKED' });
  });

  it('allows viewer generation reads but rejects viewer advancement before provider contact', async () => {
    const domain = backend();
    domain.getProjectRole.mockResolvedValue('viewer');
    domain.readGeneration.mockResolvedValue(generation({
      asset: asset({ status: 'generating', providerJobId: 'job-1' }),
    }));
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
    });
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    };

    await expect(service.getGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    await expect(service.advanceGeneration(input)).rejects.toMatchObject({
      code: 'PROJECT_WRITE_FORBIDDEN',
    });
    expect(domain.invokeProvider).not.toHaveBeenCalled();
  });

  it('requires a fresh replace-unknown confirmation before another paid submission', async () => {
    const domain = backend();
    const unknownState = generation({
      asset: asset({
        status: 'blocked',
        lastErrorCode: 'pixellab_submit_outcome_unknown',
      }),
    });
    domain.findGeneration.mockResolvedValue(unknownState);
    domain.readGeneration
      .mockResolvedValueOnce(unknownState)
      .mockResolvedValueOnce(generation({
        asset: asset({ status: 'generating', providerJobId: 'replacement-job' }),
      }));
    const sign = jest.fn(() => 'replace-confirmation');
    const verify = jest.fn();
    const service = createMapMcpService({ userId: IDS.userId, supabase: {} as never }, {
      backend: domain,
      fingerprintPlan: () => fingerprint,
      signConfirmation: sign,
      verifyConfirmation: verify,
      now: () => 1_787_260_000_000,
    });

    const prepared = await service.prepareGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      saveVersion: 0,
    });

    expect(prepared).toMatchObject({
      status: 'blocked',
      confirmationToken: 'replace-confirmation',
      confirmationPurpose: 'replace-unknown',
      feeNotice: expect.stringMatching(/paid|credits/i),
    });
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'replace-unknown',
      assetId: IDS.assetId,
    }));
    expect(domain.invokeProvider).not.toHaveBeenCalled();

    await expect(service.startGeneration({
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      confirmationToken: 'replace-confirmation',
      confirmPaidGeneration: true,
    })).resolves.toMatchObject({ status: 'generating' });
    expect(verify).toHaveBeenCalledWith('replace-confirmation', expect.objectContaining({
      purpose: 'replace-unknown',
    }));
    expect(domain.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({
      assetId: IDS.assetId,
      acknowledgeDuplicateBilling: true,
    }));
  });
});
