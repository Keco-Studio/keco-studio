import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import sharp from 'sharp';

jest.mock('server-only', () => ({}));

const getUserProjectRole = jest.fn();
const getSupabaseServiceRoleClient = jest.fn();
const analyzeCreateMapCollisionGrid = jest.fn();
let authenticated = true;

class MockAuthorizationError extends Error {}
class MockAnalyzerError extends Error {
  constructor(readonly code: string) { super(code); }
}

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const MAP_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_REVISION_ID = '55555555-5555-4555-8555-555555555555';
let pngBytes: Uint8Array;
let sha256: string;

const plan = {
  schemaVersion: 3,
  name: 'Map',
  summary: 'Ready map',
  map: { width: 512, height: 512 },
  description: 'An opaque top-down pixel art map with clear roads and buildings.',
  references: [],
  styleReference: null,
  generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
};
const scene = {
  schemaVersion: 3,
  size: { width: 512, height: 512 },
  mapImage: { assetKey: 'map-image', sourceRevisionId: SOURCE_REVISION_ID, width: 512, height: 512, locked: true },
  collisionGrid: null,
  canvas: { zoom: 1, panX: 24, panY: 24 },
};

let mapRow: Record<string, unknown> | null;
let revisionRow: Record<string, unknown> | null;
let assetRows: Array<Record<string, unknown>>;

function query(result: () => unknown) {
  const builder: Record<string, jest.Mock> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.limit = jest.fn(async () => result());
  builder.single = jest.fn(async () => result());
  return builder;
}

const supabase = {
  from: jest.fn((table: string) => query(() => table === 'map_projects'
    ? { data: mapRow, error: mapRow ? null : { code: 'not_found' } }
    : { data: revisionRow, error: revisionRow ? null : { code: 'not_found' } })),
};

const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, undefined, { supabase, user: { id: 'user-1' } });
  });

jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: MockAuthorizationError,
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));
jest.mock('@/lib/server/createMapCollisionAnalyzer', () => ({
  CreateMapCollisionAnalyzerError: MockAnalyzerError,
  analyzeCreateMapCollisionGrid: (...args: unknown[]) => analyzeCreateMapCollisionGrid(...args),
}));

import { POST } from '@/app/api/create-map/collision-grid/route';

function post(overrides: Record<string, unknown> = {}) {
  return POST(new NextRequest('https://example.test/api/create-map/collision-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT_ID, mapId: MAP_ID, revisionId: REVISION_ID, ...overrides }),
  }), undefined);
}

describe('POST /api/create-map/collision-grid', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    authenticated = true;
    mapRow = { id: MAP_ID, project_id: PROJECT_ID, current_revision_id: REVISION_ID };
    revisionRow = { id: REVISION_ID, map_project_id: MAP_ID, schema_version: 3, status: 'draft', plan, scene };
    pngBytes = new Uint8Array(await sharp({
      create: { width: 512, height: 512, channels: 3, background: '#3f7650' },
    }).png().toBuffer());
    sha256 = createHash('sha256').update(pngBytes).digest('hex');
    assetRows = [{
      id: '66666666-6666-4666-8666-666666666666',
      map_revision_id: SOURCE_REVISION_ID,
      asset_key: 'map-image',
      kind: 'map_image',
      status: 'ready',
      requested_capability: 'direct_map_image',
      provider_operation: 'create_image_pro',
      provider_job_id: 'job-1',
      storage_path: `${PROJECT_ID}/${MAP_ID}/${SOURCE_REVISION_ID}/map-image/${sha256}.png`,
      sha256,
      width: 512,
      height: 512,
      has_transparency: false,
    }];
    getUserProjectRole.mockResolvedValue({ role: 'editor' });
    const assetQuery = query(() => ({ data: assetRows, error: null }));
    const download = jest.fn(async () => ({
      data: new Blob([pngBytes], { type: 'image/png' }),
      error: null,
    }));
    getSupabaseServiceRoleClient.mockReturnValue({
      from: jest.fn(() => assetQuery),
      storage: { from: jest.fn(() => ({ download })) },
    });
    analyzeCreateMapCollisionGrid.mockResolvedValue({
      version: 1,
      cellSize: 8,
      columns: 64,
      rows: 64,
      cells: Array.from({ length: 4096 }, () => 0),
      imageSha256: sha256,
    });
  });

  it('requires authentication and editor access', async () => {
    authenticated = false;
    expect((await post()).status).toBe(401);
    authenticated = true;
    getUserProjectRole.mockResolvedValue({ role: 'viewer' });
    expect((await post()).status).toBe(403);
    expect(analyzeCreateMapCollisionGrid).not.toHaveBeenCalled();
  });

  it('rejects a stale current revision before loading image bytes', async () => {
    mapRow = { ...mapRow, current_revision_id: SOURCE_REVISION_ID };
    const response = await post();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'stale_revision' });
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('verifies private PNG bytes and returns a no-store collision grid', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      collisionGrid: { cellSize: 8, columns: 64, rows: 64, imageSha256: sha256 },
    });
    expect(analyzeCreateMapCollisionGrid).toHaveBeenCalledWith(expect.objectContaining({
      imageSha256: sha256,
      width: 512,
      height: 512,
      pngBytes: expect.any(Uint8Array),
    }));
  });

  it('rejects a stored hash mismatch without calling vision', async () => {
    assetRows[0] = {
      ...assetRows[0],
      sha256: 'a'.repeat(64),
      storage_path: `${PROJECT_ID}/${MAP_ID}/${SOURCE_REVISION_ID}/map-image/${'a'.repeat(64)}.png`,
    };
    const response = await post();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'image_hash_mismatch' });
    expect(analyzeCreateMapCollisionGrid).not.toHaveBeenCalled();
  });
});
