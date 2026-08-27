import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const service = {
  listAssets: jest.fn(), readAsset: jest.fn(), createDraft: jest.fn(), updateDraft: jest.fn(),
  prepareGeneration: jest.fn(), startGeneration: jest.fn(), getGeneration: jest.fn(), advanceGeneration: jest.fn(),
};
let authenticated = true;

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function, options: { unauthorizedResponse: () => Response }) =>
    (request: NextRequest) => authenticated
      ? handler(request, {}, { supabase: {}, user: { id: '10000000-0000-4000-8000-000000000001' } })
      : options.unauthorizedResponse(),
}));
jest.mock('@/lib/server/characterAssetMcpService', () => {
  class CharacterAssetMcpError extends Error {
    constructor(readonly code: string) { super('safe public error'); }
  }
  return { CharacterAssetMcpError, createCharacterAssetMcpService: () => service };
});

import { POST } from '@/app/api/mcp/character-assets/route';
import { CharacterAssetMcpError } from '@/lib/server/characterAssetMcpService';

const ids = {
  projectId: '10000000-0000-4000-8000-000000000002',
  assetId: '10000000-0000-4000-8000-000000000003',
  attemptId: '10000000-0000-4000-8000-000000000004',
  generationId: '10000000-0000-4000-8000-000000000005',
  key: '10000000-0000-4000-8000-000000000006',
};
const fingerprint = 'a'.repeat(64);
const plan = {
  schemaVersion: 1, kind: 'character', name: 'Cartographer',
  description: 'Adult field cartographer with a blue coat.', perspective: 'topdown',
  facing: 'front', width: 96, height: 96, transparent: true,
};

async function post(body: unknown) {
  return POST(new NextRequest('https://example.test/api/mcp/character-assets', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('POST /api/mcp/character-assets', () => {
  beforeEach(() => {
    authenticated = true;
    Object.values(service).forEach((mock) => mock.mockReset().mockResolvedValue({ ok: true }));
  });

  it('requires authentication', async () => {
    authenticated = false;
    const response = await post({ action: 'list_character_assets', projectId: ids.projectId });
    expect(response.status).toBe(401);
  });

  it.each([
    ['list_character_assets', { projectId: ids.projectId }, 'listAssets'],
    ['read_character_asset', { projectId: ids.projectId, assetId: ids.assetId }, 'readAsset'],
    ['create_character_asset_draft', { projectId: ids.projectId, plan, idempotencyKey: ids.key }, 'createDraft'],
    ['update_character_asset_draft', { projectId: ids.projectId, assetId: ids.assetId, saveVersion: 0, plan }, 'updateDraft'],
    ['prepare_character_asset_generation', { projectId: ids.projectId, assetId: ids.assetId, saveVersion: 0 }, 'prepareGeneration'],
    ['start_character_asset_generation', {
      projectId: ids.projectId, assetId: ids.assetId, attemptId: ids.attemptId,
      generationId: ids.generationId, planFingerprint: fingerprint, attemptCount: 0,
      confirmationToken: 'confirmation', confirmPaidGeneration: true,
    }, 'startGeneration'],
    ['get_character_asset_generation', {
      projectId: ids.projectId, assetId: ids.assetId, attemptId: ids.attemptId,
      generationId: ids.generationId, planFingerprint: fingerprint,
    }, 'getGeneration'],
    ['advance_character_asset_generation', {
      projectId: ids.projectId, assetId: ids.assetId, attemptId: ids.attemptId,
      generationId: ids.generationId, planFingerprint: fingerprint,
    }, 'advanceGeneration'],
  ])('dispatches %s', async (action, input, method) => {
    const response = await post({ action, ...input });
    expect(response.status).toBe(200);
    expect(service[method as keyof typeof service]).toHaveBeenCalledWith(input);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects omitted paid confirmation and unknown fields', async () => {
    const identity = {
      action: 'start_character_asset_generation', projectId: ids.projectId,
      assetId: ids.assetId, attemptId: ids.attemptId, generationId: ids.generationId,
      planFingerprint: fingerprint, attemptCount: 0, confirmationToken: 'confirmation',
    };
    expect((await post(identity)).status).toBe(400);
    expect((await post({ action: 'list_character_assets', projectId: ids.projectId, secret: 'x' })).status).toBe(400);
    expect(service.startGeneration).not.toHaveBeenCalled();
  });

  it('maps stable service errors without exposing arbitrary messages', async () => {
    service.prepareGeneration.mockRejectedValueOnce(new CharacterAssetMcpError('PROVIDER_RATE_LIMITED'));
    const response = await post({
      action: 'prepare_character_asset_generation', projectId: ids.projectId,
      assetId: ids.assetId, saveVersion: 0,
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'PROVIDER_RATE_LIMITED', error: 'safe public error' });
  });
});
