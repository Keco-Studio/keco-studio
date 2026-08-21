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
  CreateMapMcpError,
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
    createDraft: jest.fn(async () => ({
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
    updateDraft: jest.fn(async () => 1),
    freezeDraft: jest.fn(async () => ({
      publishedRevisionId: IDS.revisionId,
      nextDraftRevisionId: IDS.nextRevisionId,
    })),
    createAssetPlan: jest.fn(async () => ({ assetId: IDS.assetId, status: 'planned' })),
    findGeneration: jest.fn(async () => null),
    readGeneration: jest.fn(async () => generation()),
    invokeProvider: jest.fn(async () => ({ assetId: IDS.assetId, status: 'generating' })),
  };
}

describe('Create Map MCP service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an idempotent V3 draft through the backend', async () => {
    const domain = backend();
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
    }));
  });

  it('prepares a frozen revision and returns a fee notice without provider contact', async () => {
    const domain = backend();
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
    expect(domain.freezeDraft).toHaveBeenCalledWith(expect.objectContaining({
      revisionId: IDS.revisionId,
      saveVersion: 0,
    }));
    expect(domain.createAssetPlan).toHaveBeenCalledWith({
      revisionId: IDS.revisionId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    });
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'submit',
      userId: IDS.userId,
      assetId: IDS.assetId,
    }));
    expect(domain.invokeProvider).not.toHaveBeenCalled();
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

  it('retries only safe provider rejection states and blocks unknown outcomes', async () => {
    const domain = backend();
    domain.readGeneration.mockResolvedValue(generation({
      asset: asset({ status: 'blocked', lastErrorCode: 'pixellab_rate_limited' }),
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

    await expect(service.retryGeneration(input)).resolves.toMatchObject({ assetId: IDS.assetId });
    expect(domain.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({
      assetId: IDS.assetId,
    }));

    domain.readGeneration.mockResolvedValueOnce(generation({
      asset: asset({
        status: 'blocked',
        lastErrorCode: 'pixellab_submit_outcome_unknown',
      }),
    }));
    await expect(service.retryGeneration(input)).rejects.toEqual(
      new CreateMapMcpError('MAP_GENERATION_BLOCKED'),
    );
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
    expect(domain.freezeDraft).not.toHaveBeenCalled();
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
