import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

const createGameDesignSystemGenerationJob = jest.fn();
const createPublicGameDesignSystemVersion = jest.fn();
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
  getGameDesignSystem: jest.fn(async () => ({
    id: 'system-1',
    owner_id: 'route-test-user',
    source: 'user',
    title: 'Tactical rules',
    current_version_id: '16662223-2c61-4af8-8a81-ea9f3da97d93',
  })),
  getGameDesignSystemDetail: jest.fn(),
}));
jest.mock('@/lib/services/gameDesignSystemWriteService.server', () => {
  class PublicGameDesignSystemVersionError extends Error {
    code: string;
    ruleIds?: string[];

    constructor(code: string, options?: { ruleIds?: string[] }) {
      super(code);
      this.code = code;
      this.ruleIds = options?.ruleIds;
    }
  }
  return {
    PublicGameDesignSystemVersionError,
    createPublicGameDesignSystemVersion: (...args: unknown[]) => createPublicGameDesignSystemVersion(...args),
  };
});
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

  it('keeps the raw write service and storage fields out of client-reachable modules', () => {
    const clientSource = readFileSync(join(
      process.cwd(),
      'src/lib/services/gameDesignSystemClient.ts',
    ), 'utf8');
    const requestSource = readFileSync(join(
      process.cwd(),
      'src/lib/game-design-system/versionRequest.ts',
    ), 'utf8');

    expect(clientSource).not.toContain('gameDesignSystemWriteService.server');
    expect(clientSource).not.toContain('art_style');
    expect(requestSource).not.toContain('GameArtStyleSnapshot');
    expect(requestSource).not.toContain('art_style');
  });
});

import { POST as startGeneration } from '@/app/api/game-design-systems/generation-jobs/route';
import { POST as createVersion } from '@/app/api/game-design-systems/[id]/versions/route';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import { PublicGameDesignSystemVersionError } from '@/lib/services/gameDesignSystemWriteService.server';
import { createGameDesignSystemVersion as createVersionClient } from '@/lib/services/gameDesignSystemClient';

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

const VERSION_PARENT_ID = '78200594-64e5-4e7e-a79a-409ebc741061';
const VERSION_CURRENT_ID = '16662223-2c61-4af8-8a81-ea9f3da97d93';
const VERSION_KEY = 'de18138d-5a6c-4bd8-b399-46ab3da19911';
const VERSION_RULES = {
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle',
    title: 'Readable state',
    statement: 'Expose decision inputs.',
    appliesWhen: 'Presenting choices.',
    severity: 'required',
  }],
  tableGuidance: [],
};

function postVersion(
  body: Record<string, unknown>,
  idempotencyKey: string | null = VERSION_KEY,
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (idempotencyKey !== null) headers.set('idempotency-key', idempotencyKey);
  return createVersion(new NextRequest('https://keco.test/api/game-design-systems/system-1/versions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'system-1' }) });
}

describe('POST /api/game-design-systems/:id/versions strict boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSupabaseServiceRoleClient.mockReturnValue({ role: 'service' });
    createPublicGameDesignSystemVersion.mockResolvedValue({
      id: 'version-2',
      system_id: 'system-1',
      source_snapshots: [],
      artStyle: null,
      artStyleReadError: null,
    });
  });

  it.each([
    ['missing key', null],
    ['non-UUID key', 'not-a-uuid'],
  ])('requires a UUID Idempotency-Key for %s', async (_label, key) => {
    const response = await postVersion({
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    }, key);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'A UUID Idempotency-Key header is required.',
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
    expect(createPublicGameDesignSystemVersion).not.toHaveBeenCalled();
  });

  it('rejects unknown request keys before invoking the write service', async () => {
    const response = await postVersion({
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
      forgedSnapshot: { specification: 'client controlled' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid version request.',
      code: 'VERSION_REQUEST_INVALID',
      issues: { fieldErrors: { forgedSnapshot: expect.any(Array) } },
    });
    expect(createPublicGameDesignSystemVersion).not.toHaveBeenCalled();
  });

  it('delegates one parsed partial replacement with authenticated actor and service role', async () => {
    const request = {
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
      artStyle: VALID_ART_STYLE,
    };

    const response = await postVersion(request);

    expect(response.status).toBe(201);
    expect(createPublicGameDesignSystemVersion).toHaveBeenCalledWith(
      { role: 'service' },
      {
        systemId: 'system-1',
        actorId: 'route-test-user',
        idempotencyKey: VERSION_KEY,
        request: expect.objectContaining({
          ...request,
          artStyle: expect.objectContaining({
            customization: { direction: '', referenceGames: [], avoid: '' },
          }),
        }),
      },
    );
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain('art_style');
  });

  it.each([
    ['VERSION_STALE', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['VERSION_NO_CHANGES', 409],
    ['VERSION_PARENT_INVALID', 400],
    ['VERSION_FORBIDDEN', 403],
    ['VERSION_SYSTEM_NOT_FOUND', 404],
  ])('maps %s to a stable public response', async (code, status) => {
    createPublicGameDesignSystemVersion.mockRejectedValue(
      new PublicGameDesignSystemVersionError(code as never),
    );

    const response = await postVersion({
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it('returns reintroduced rule IDs without logging an error object', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    createPublicGameDesignSystemVersion.mockRejectedValue(
      new PublicGameDesignSystemVersionError('VERSION_RULE_REINTRODUCED', {
        ruleIds: ['deleted-rule'],
      }),
    );

    const response = await postVersion({
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VERSION_RULE_REINTRODUCED',
      ruleIds: ['deleted-rule'],
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('logs only a sanitized code and name for an unexpected failure', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    createPublicGameDesignSystemVersion.mockRejectedValue({
      name: 'PostgrestError',
      message: 'raw-unsupported-sentinel',
      details: { art_style: 'raw-unsupported-sentinel' },
    });

    const response = await postVersion({
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    });

    expect(response.status).toBe(500);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('raw-unsupported-sentinel');
    expect(JSON.stringify(await response.json())).not.toContain('raw-unsupported-sentinel');
    consoleError.mockRestore();
  });
});

describe('gameDesignSystemClient version object API', () => {
  it('sends the partial-replacement object with the caller idempotency key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      version: { id: 'version-2' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const input = {
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    };

    await createVersionClient('system/with spaces', input as never, VERSION_KEY);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/game-design-systems/system%2Fwith%20spaces/versions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': VERSION_KEY,
        },
        body: JSON.stringify(input),
      }),
    );
    fetchMock.mockRestore();
  });

  it('preserves the server error code on the thrown client error', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'The Game Design System changed after this draft was opened.',
      code: 'VERSION_STALE',
    }), { status: 409, headers: { 'content-type': 'application/json' } }));

    const caught = await createVersionClient('system-1', {
      parentVersionId: VERSION_PARENT_ID,
      expectedCurrentVersionId: VERSION_CURRENT_ID,
      rules: VERSION_RULES,
    } as never, VERSION_KEY).catch((error) => error);

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ code: 'VERSION_STALE' });
    fetchMock.mockRestore();
  });
});
