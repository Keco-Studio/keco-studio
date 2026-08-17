import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

const createGameDesignSystemGenerationJob = jest.fn();
const getSupabaseServiceRoleClient = jest.fn();
const resolveGameDesignSourceSnapshots = jest.fn();
const withAuth = jest.fn((handler: unknown) =>
  async (request: NextRequest, context?: unknown) => (
    handler as (
      request: NextRequest,
      context: unknown,
      auth: { supabase: object; user: { id: string } },
    ) => Promise<Response>
  )(request, context, { supabase: {}, user: { id: 'route-test-user' } })
);

jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/game-design-system/sourceSnapshots', () => ({
  SourceSnapshotInputError: class SourceSnapshotInputError extends Error {},
  resolveGameDesignSourceSnapshots: (...args: unknown[]) => resolveGameDesignSourceSnapshots(...args),
}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  IdempotencyConflictError: class IdempotencyConflictError extends Error {},
  createGameDesignSystemGenerationJob: (...args: unknown[]) => createGameDesignSystemGenerationJob(...args),
  getGameDesignSystemDetail: jest.fn(),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));

const routeSuites = readdirSync(join(process.cwd(), 'tests/unit'))
  .filter((name) => /^game-design-system.*route.*\.test\.ts$/.test(name))
  .filter((name) => name !== 'game-design-system-route-test-boundaries.test.ts')
  .map((name) => `tests/unit/${name}`);

describe('Game Design System route test boundaries', () => {
  it.each(routeSuites)('%s does not replace authentication or Supabase state', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

    expect(source).not.toContain("jest.mock('@/lib/auth/route-auth'");
    expect(source).not.toMatch(/const\s+(mockSupabase|authSupabase|serviceSupabase)\s*=/);
  });
});

import { POST as startGeneration } from '@/app/api/game-design-systems/generation-jobs/route';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';

const VALID_ART_STYLE = {
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: { referenceGames: [] },
};

const STORAGE_BOUNDARY_ART_STYLE = {
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: {
    direction: '\u0001'.repeat(2_000),
    avoid: '\u0001'.repeat(1_000),
    referenceGames: ['aa', 'bb', 'cc', 'dd'].map((name, index) => ({
      name,
      borrow: index < 3 ? '\u0001'.repeat(500) : `${'\u0001'.repeat(434)}x`,
    })),
  },
};

function postGeneration(body: Record<string, unknown>) {
  return startGeneration(new NextRequest('https://keco.test/api/game-design-systems/generation-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'route-test-key' },
    body: JSON.stringify({ title: 'Tactical rules', genres: ['Strategy'], artStyle: VALID_ART_STYLE, ...body }),
  }), undefined);
}

describe('POST /api/game-design-systems/generation-jobs Art Style boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSupabaseServiceRoleClient.mockReturnValue({ role: 'service' });
    resolveGameDesignSourceSnapshots.mockResolvedValue([]);
    createGameDesignSystemGenerationJob.mockResolvedValue({ id: 'job-1', status: 'completed' });
  });

  it.each([
    ['unknown request key', { unknownRequestKey: true }, 'unknownRequestKey'],
    ['forged specification', { artStyle: { ...VALID_ART_STYLE, specification: {} } }, 'artStyle'],
    ['unknown preset', { artStyle: { ...VALID_ART_STYLE, presetId: 'painted' } }, 'artStyle'],
    ['unknown preset version', { artStyle: { ...VALID_ART_STYLE, presetVersion: 2 } }, 'artStyle'],
    ['over-limit direction', {
      artStyle: { ...VALID_ART_STYLE, customization: { direction: 'x'.repeat(2_001), referenceGames: [] } },
    }, 'artStyle'],
    ['over-limit avoid guidance', {
      artStyle: { ...VALID_ART_STYLE, customization: { avoid: 'x'.repeat(1_001), referenceGames: [] } },
    }, 'artStyle'],
  ])('returns a field-addressable 400 for %s before creating a job', async (_label, payload, field) => {
    const response = await postGeneration(payload);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid generation request.',
      issues: { fieldErrors: { [field]: expect.any(Array) } },
    });
    expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();
  });

  it('rejects PostgreSQL-over-limit Art Style storage before creating a job', async () => {
    const response = await postGeneration({ artStyle: STORAGE_BOUNDARY_ART_STYLE });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid generation request.',
      issues: {
        formErrors: [],
        fieldErrors: {
          artStyle: ['Game Art Style snapshot exceeds the 32 KiB limit (32859 bytes).'],
        },
      },
    });
    expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();
  });

  it('compiles a valid explicit Pixel Art selection and normalizes duplicate visual references before insertion', async () => {
    const artStyle = {
      ...VALID_ART_STYLE,
      customization: {
        direction: '  Bright skies  \r\nReadable paths\t ',
        referenceGames: [
          { name: ' Hyper Light Drifter ', borrow: ' Readable silhouettes ' },
          { name: 'hyper light drifter', borrow: 'Ignored duplicate' },
          { name: 'Eastward', borrow: ' Material clusters ' },
        ],
        avoid: '  No horror  ',
      },
    };
    const response = await postGeneration({ artStyle });

    expect(response.status).toBe(202);
    expect(createGameDesignSystemGenerationJob).toHaveBeenCalledWith(
      { role: 'service' },
      'route-test-user',
      expect.objectContaining({ artStyle: compileGameArtStyle(artStyle) }),
      expect.objectContaining({ idempotencyKey: 'route-test-key' }),
    );
  });
});
