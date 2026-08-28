import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CharacterAssetPlanV1 } from '@/features/character-assets/model/characterAssetSchema';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));

import {
  CharacterAssetMcpError,
  createCharacterAssetMcpService,
  type CharacterAssetMcpBackend,
  type CharacterAssetWorkspace,
  type CharacterGenerationState,
} from '@/lib/server/characterAssetMcpService';
import {
  CharacterAssetGenerationConfirmationError,
  signCharacterAssetGenerationConfirmation,
  verifyCharacterAssetGenerationConfirmation,
} from '@/lib/server/characterAssetGenerationConfirmation';

const IDS = {
  userId: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  assetId: '10000000-0000-4000-8000-000000000003',
  attemptId: '10000000-0000-4000-8000-000000000004',
  generationId: '10000000-0000-4000-8000-000000000005',
  idempotencyKey: '10000000-0000-4000-8000-000000000006',
};

const characterPlan: CharacterAssetPlanV1 = {
  schemaVersion: 1,
  kind: 'character',
  name: 'Field Cartographer',
  description: 'Adult field cartographer with a blue coat and compact satchel.',
  perspective: 'topdown',
  facing: 'front',
  width: 96,
  height: 96,
  transparent: true,
};

const animationPlan: CharacterAssetPlanV1 = {
  schemaVersion: 1,
  kind: 'animation',
  name: 'walk_down',
  sourceCharacterAssetId: IDS.assetId,
  sourceCharacterSha256: 'b'.repeat(64),
  motionDescription: 'Walk forward with a steady relaxed stride.',
  frameWidth: 96,
  frameHeight: 96,
  frameCount: 6,
  fps: 10,
  loop: true,
};

const fingerprint = 'a'.repeat(64);

function workspace(plan: CharacterAssetPlanV1 = characterPlan): CharacterAssetWorkspace {
  return {
    projectId: IDS.projectId,
    assetId: IDS.assetId,
    saveVersion: 0,
    status: 'draft',
    plan,
    generation: null,
  };
}

function generation(
  status: CharacterGenerationState['generation']['status'] = 'planned',
  plan: CharacterAssetPlanV1 = characterPlan,
): CharacterGenerationState {
  return {
    ...workspace(plan),
    status: status === 'ready' ? 'ready' : 'generating',
    generation: {
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      attemptCount: status === 'planned' ? 0 : 1,
      status,
      lastErrorCode: null,
      providerJobId: status === 'planned' ? null : 'provider-job',
      storagePath: status === 'ready' ? `${IDS.projectId}/${IDS.assetId}/${IDS.generationId}/${'b'.repeat(64)}.png` : null,
      sha256: status === 'ready' ? 'b'.repeat(64) : null,
      width: status === 'ready' ? 96 : null,
      height: status === 'ready' ? 96 : null,
      hasTransparency: status === 'ready' ? true : null,
      metadata: {},
      imageUrl: status === 'ready' ? 'https://storage.example.test/signed-preview' : null,
    },
  };
}

function backend(): jest.Mocked<CharacterAssetMcpBackend> {
  return {
    getProjectRole: jest.fn(async () => 'editor'),
    listAssets: jest.fn(async () => []),
    readAsset: jest.fn(async () => workspace()),
    createDraft: jest.fn(async (input) => workspace(input.plan)),
    updateDraft: jest.fn(async (input) => ({ ...workspace(input.plan), saveVersion: input.saveVersion + 1 })),
    preflightProvider: jest.fn(async () => undefined),
    prepareGeneration: jest.fn(async () => generation()),
    readGeneration: jest.fn(async () => generation()),
    invokeProvider: jest.fn(async () => ({ status: 'generating' })),
  };
}

describe('character asset MCP service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires editor or admin access before creating a draft', async () => {
    const domain = backend();
    domain.getProjectRole.mockResolvedValueOnce('viewer');
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain },
    );

    await expect(service.createDraft({
      projectId: IDS.projectId,
      plan: characterPlan,
      idempotencyKey: IDS.idempotencyKey,
    })).rejects.toMatchObject({ code: 'PROJECT_WRITE_FORBIDDEN' });
    expect(domain.createDraft).not.toHaveBeenCalled();
  });

  it('creates an idempotent draft with canonical hashes', async () => {
    const domain = backend();
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain },
    );

    await expect(service.createDraft({
      projectId: IDS.projectId,
      plan: characterPlan,
      idempotencyKey: IDS.idempotencyKey,
    })).resolves.toMatchObject({ assetId: IDS.assetId, schemaVersion: 1 });
    const input = domain.createDraft.mock.calls[0][0];
    expect(input.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('maps a stale compare-and-swap update to a stable public error', async () => {
    const domain = backend();
    domain.updateDraft.mockRejectedValueOnce({ code: 'KM412' });
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain },
    );

    await expect(service.updateDraft({
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      saveVersion: 0,
      plan: characterPlan,
    })).rejects.toMatchObject({ code: 'CHARACTER_ASSET_REVISION_STALE' });
  });

  it('preflights capability and prepares confirmation without paid submission', async () => {
    const domain = backend();
    const sign = jest.fn(() => 'signed-confirmation');
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      {
        backend: domain,
        fingerprintPlan: () => fingerprint,
        randomUUID: () => IDS.generationId,
        signConfirmation: sign,
        now: () => Date.parse('2026-08-27T00:00:00.000Z'),
      },
    );

    const result = await service.prepareGeneration({
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      saveVersion: 0,
    });

    expect(result).toMatchObject({
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      feeNotice: expect.stringMatching(/paid operation.*provider credits/i),
      confirmationToken: 'signed-confirmation',
      confirmationPurpose: 'character-submit',
    });
    expect(domain.preflightProvider).toHaveBeenCalledWith(IDS.projectId, 'character');
    expect(domain.invokeProvider).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'character-submit',
      attemptCount: 0,
    }));
  });

  it('uses an animation-specific confirmation purpose', async () => {
    const domain = backend();
    domain.readAsset.mockResolvedValueOnce(workspace(animationPlan));
    domain.prepareGeneration.mockResolvedValueOnce(generation('planned', animationPlan));
    const sign = jest.fn(() => 'signed-confirmation');
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain, fingerprintPlan: () => fingerprint, signConfirmation: sign },
    );

    await service.prepareGeneration({ projectId: IDS.projectId, assetId: IDS.assetId, saveVersion: 0 });

    expect(domain.preflightProvider).toHaveBeenCalledWith(IDS.projectId, 'animation');
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'animation-submit' }));
  });

  it('verifies the exact binding before starting and safely replays active generation', async () => {
    const domain = backend();
    domain.readGeneration
      .mockResolvedValueOnce(generation())
      .mockResolvedValueOnce(generation('generating'));
    const verify = jest.fn();
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain, fingerprintPlan: () => fingerprint, verifyConfirmation: verify },
    );
    const input = {
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      attemptCount: 0,
      confirmationToken: 'signed-confirmation',
      confirmPaidGeneration: true as const,
    };

    await expect(service.startGeneration(input)).resolves.toMatchObject({ status: 'generating' });
    expect(verify).toHaveBeenCalledWith('signed-confirmation', expect.objectContaining({
      purpose: 'character-submit',
      attemptCount: 0,
    }));
    expect(domain.invokeProvider).toHaveBeenCalledTimes(1);
    expect(domain.invokeProvider).toHaveBeenCalledWith('submit', expect.objectContaining({
      expectedAttemptCount: 0,
    }));

    domain.readGeneration.mockResolvedValueOnce(generation('generating'));
    await service.startGeneration(input);
    expect(domain.invokeProvider).toHaveBeenCalledTimes(1);
  });

  it('reads persisted state without contacting the provider', async () => {
    const domain = backend();
    domain.readGeneration.mockResolvedValueOnce(generation('ready'));
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain, fingerprintPlan: () => fingerprint },
    );

    await expect(service.getGeneration({
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    })).resolves.toMatchObject({ status: 'ready', imageUrl: expect.stringContaining('https://') });
    expect(domain.invokeProvider).not.toHaveBeenCalled();
  });

  it('advances a generating job through poll and validation without submitting', async () => {
    const domain = backend();
    domain.readGeneration
      .mockResolvedValueOnce(generation('generating'))
      .mockResolvedValueOnce(generation('ready'));
    domain.invokeProvider.mockResolvedValueOnce({ status: 'completed' }).mockResolvedValueOnce({ status: 'ready' });
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain, fingerprintPlan: () => fingerprint },
    );

    await expect(service.advanceGeneration({
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    })).resolves.toMatchObject({ status: 'ready' });
    expect(domain.invokeProvider.mock.calls.map(([operation]) => operation)).toEqual(['poll', 'validate']);
  });

  it('revalidates a failed attempt with an existing provider job without retrying paid submission', async () => {
    const domain = backend();
    const failed = generation('failed');
    failed.generation.lastErrorCode = 'validation_failed';
    domain.readGeneration
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(generation('ready'));
    domain.invokeProvider.mockResolvedValueOnce({ status: 'ready' });
    const service = createCharacterAssetMcpService(
      { userId: IDS.userId, supabase: {} as never },
      { backend: domain, fingerprintPlan: () => fingerprint },
    );

    await expect(service.advanceGeneration({
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
    })).resolves.toMatchObject({ status: 'ready' });
    expect(domain.invokeProvider.mock.calls.map(([operation]) => operation)).toEqual(['validate']);
  });

  it('does not expose arbitrary internal error messages', () => {
    expect(new CharacterAssetMcpError('UPSTREAM_UNAVAILABLE', 'Bearer secret-value').message)
      .toBe('The character asset service is temporarily unavailable.');
  });

  it('binds confirmation tokens to purpose, attempt, and expiry', () => {
    const binding = {
      purpose: 'character-submit' as const,
      userId: IDS.userId,
      projectId: IDS.projectId,
      assetId: IDS.assetId,
      attemptId: IDS.attemptId,
      generationId: IDS.generationId,
      planFingerprint: fingerprint,
      attemptCount: 0,
    };
    const secret = 'character-test-signing-secret-with-32-bytes';
    const token = signCharacterAssetGenerationConfirmation(binding, { secret, now: () => 1_000 });

    expect(verifyCharacterAssetGenerationConfirmation(token, binding, { secret, now: () => 2_000 }))
      .toMatchObject(binding);
    expect(() => verifyCharacterAssetGenerationConfirmation(token, { ...binding, attemptCount: 1 }, { secret, now: () => 2_000 }))
      .toThrow(CharacterAssetGenerationConfirmationError);
    expect(() => verifyCharacterAssetGenerationConfirmation(token, binding, { secret, now: () => 601_000 }))
      .toThrow('expired');
  });
});
