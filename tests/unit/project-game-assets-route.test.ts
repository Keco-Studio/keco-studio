import { NextRequest } from 'next/server';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const getUserProjectRole = jest.fn();
const reserveProjectStorage = jest.fn();
const releaseProjectStorage = jest.fn();
class mockStorageQuotaError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
let supabase: Record<string, unknown>;

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => (request: NextRequest, context: unknown) => (
    handler as (
      request: NextRequest,
      context: unknown,
      auth: { supabase: Record<string, unknown>; user: { id: string } },
    ) => Promise<Response>
  )(request, context, { supabase, user: { id: USER_ID } }),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));
jest.mock('@/lib/server/storageQuota', () => ({
  StorageQuotaError: mockStorageQuotaError,
  reserveProjectStorage: (...args: unknown[]) => reserveProjectStorage(...args),
  releaseProjectStorage: (...args: unknown[]) => releaseProjectStorage(...args),
}));

import { POST } from '@/app/api/projects/[projectId]/game-assets/route';

function request(body: unknown): NextRequest {
  return new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/game-assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(body: unknown) {
  return POST(request(body), { params: Promise.resolve({ projectId: PROJECT_ID }) });
}

describe('project game asset upload route', () => {
  beforeEach(() => {
    getUserProjectRole.mockReset().mockResolvedValue({ role: 'editor' });
    reserveProjectStorage.mockReset().mockResolvedValue({
      reservationId: RESERVATION_ID,
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      expectedBytes: 8,
      reused: false,
    });
    releaseProjectStorage.mockReset().mockResolvedValue({ reservationId: RESERVATION_ID, reused: false });
    supabase = {};
  });

  it('prepares direct PUTs only in the private project Assets bucket', async () => {
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example/upload?token=signed' },
      error: null,
    });
    const from = jest.fn(() => ({ createSignedUploadUrl }));
    supabase = { storage: { from } };

    const response = await post({
      action: 'prepare',
      files: [{ fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 }],
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result).toMatchObject({ preparedCount: 1, failedCount: 0 });
    expect(from).toHaveBeenCalledWith('project-assets');
    expect(reserveProjectStorage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: PROJECT_ID,
      bucketId: 'project-assets',
      expectedBytes: 8,
      sourceKind: 'project_asset',
    }));
    expect(result.items[0]).toMatchObject({ ok: true, reservationId: RESERVATION_ID });
    expect(result.items[0].upload).toEqual({
      url: 'https://storage.example/upload?token=signed',
      method: 'PUT',
      headers: {
        'cache-control': 'max-age=3600',
        'content-type': 'application/pdf',
        'x-upsert': 'false',
      },
    });
    expect(JSON.stringify(result)).not.toContain('/object/public/');
  });

  it('verifies and registers one private non-image asset without multipart input', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({
        data: { size: bytes.byteLength, contentType: 'application/pdf' },
        error: null,
      }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn(),
    };
    const from = jest.fn(() => bucket);
    const rpc = jest.fn().mockResolvedValue({ data: [{ id: ASSET_ID, reused: false }], error: null });
    supabase = { storage: { from }, rpc };

    const response = await post({
      action: 'complete',
      items: [{
        path,
        reservationId: RESERVATION_ID,
        fileName: 'guide.pdf',
        fileType: 'application/pdf',
        fileSize: bytes.byteLength,
      }],
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result).toMatchObject({ completedCount: 1, failedCount: 0 });
    expect(from).toHaveBeenCalledWith('project-assets');
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('complete_project_game_asset_storage_upload', expect.objectContaining({
      p_reservation_id: RESERVATION_ID,
      p_project_id: PROJECT_ID,
      p_name: 'guide.pdf',
      p_mime_type: 'application/pdf',
      p_storage_path: path,
      p_file_size: bytes.byteLength,
    }));
  });

  it('rejects viewers before preparing or completing storage work', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'viewer' });
    const response = await post({ action: 'prepare', files: [] });

    expect(response.status).toBe(403);
    expect(reserveProjectStorage).not.toHaveBeenCalled();
  });

  it.each(['editor', 'admin'] as const)('activates the Assets workspace idempotently for a %s', async (role) => {
    getUserProjectRole.mockResolvedValue({ role });
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ update }));
    supabase = { from };

    const first = await post({ action: 'activate-workspace' });
    const second = await post({ action: 'activate-workspace' });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ assetsWorkspaceEnabled: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ assetsWorkspaceEnabled: true });
    expect(from).toHaveBeenCalledWith('projects');
    expect(update).toHaveBeenCalledWith({ assets_workspace_enabled: true });
    expect(eq).toHaveBeenCalledWith('id', PROJECT_ID);
  });

  it('removes content-invalid objects before registration', async () => {
    const bytes = new TextEncoder().encode('not a pdf');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({
        data: { size: bytes.byteLength, contentType: 'application/pdf' },
        error: null,
      }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const rpc = jest.fn().mockResolvedValue({ data: RESERVATION_ID, error: null });
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });
    const result = await response.json();

    expect(result).toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
    expect(rpc).toHaveBeenCalledWith('resolve_project_storage_upload_reservation', expect.anything());
    expect(releaseProjectStorage).toHaveBeenCalledWith(expect.anything(), RESERVATION_ID);
  });

  it('does not create a ready result when registration fails', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({
        data: { size: bytes.byteLength, contentType: 'application/pdf' },
        error: null,
      }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn(),
    };
    supabase = {
      storage: { from: jest.fn(() => bucket) },
      rpc: jest.fn((name: string) => Promise.resolve(name === 'resolve_project_storage_upload_reservation'
        ? { data: RESERVATION_ID, error: null }
        : { data: null, error: { message: 'database unavailable' } })),
    };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });
    const result = await response.json();

    expect(result).toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
    expect(releaseProjectStorage).toHaveBeenCalledWith(expect.anything(), RESERVATION_ID);
  });

  it('releases a prepared reservation when a failed browser PUT reaches completion without an object', async () => {
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc: jest.fn().mockResolvedValue({ data: RESERVATION_ID, error: null }) };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 }],
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
    expect(releaseProjectStorage).toHaveBeenCalledWith(expect.anything(), RESERVATION_ID);
  });

  it('removes the physical object when atomic completion rejects the reservation', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({ data: { size: bytes.byteLength, contentType: 'application/pdf' }, error: null }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    supabase = {
      storage: { from: jest.fn(() => bucket) },
      rpc: jest.fn((name: string) => Promise.resolve(name === 'resolve_project_storage_upload_reservation'
        ? { data: RESERVATION_ID, error: null }
        : { data: null, error: { details: 'STORAGE_RESERVATION_EXPIRED' } })),
    };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Storage is temporarily unavailable',
    });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
    expect(releaseProjectStorage).toHaveBeenCalledWith(expect.anything(), RESERVATION_ID);
  });

  it('returns a safe quota conflict before creating signed upload targets', async () => {
    reserveProjectStorage.mockRejectedValue(new mockStorageQuotaError('STORAGE_QUOTA_EXCEEDED'));
    const createSignedUploadUrl = jest.fn();
    supabase = { storage: { from: jest.fn(() => ({ createSignedUploadUrl })) } };

    const response = await post({
      action: 'prepare',
      files: [{ fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 }],
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Storage quota exceeded',
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('assigns an independent reservation to every prepared batch item', async () => {
    reserveProjectStorage
      .mockResolvedValueOnce({ reservationId: RESERVATION_ID, ownerId: USER_ID, projectId: PROJECT_ID, expectedBytes: 8, reused: false })
      .mockResolvedValueOnce({ reservationId: SECOND_RESERVATION_ID, ownerId: USER_ID, projectId: PROJECT_ID, expectedBytes: 8, reused: false });
    const createSignedUploadUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example/upload' }, error: null });
    supabase = { storage: { from: jest.fn(() => ({ createSignedUploadUrl })) } };

    const response = await post({
      action: 'prepare',
      files: [
        { fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 },
        { fileName: 'guide-2.pdf', fileType: 'application/pdf', fileSize: 8 },
      ],
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(reserveProjectStorage).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, ok: true, reservationId: RESERVATION_ID }),
      expect.objectContaining({ index: 1, ok: true, reservationId: SECOND_RESERVATION_ID }),
    ]));
  });

  it('accepts an exact completion replay without removing the finalized object', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({ data: { size: bytes.byteLength, contentType: 'application/pdf' }, error: null }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn(),
    };
    const rpc = jest.fn((name: string) => Promise.resolve(name === 'resolve_project_storage_upload_reservation'
      ? { data: RESERVATION_ID, error: null }
      : { data: [{ id: ASSET_ID, reused: true }], error: null }));
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc };
    const body = { action: 'complete', items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }] };

    const first = await post(body);
    const replay = await post(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ completedCount: 1, failedCount: 0 });
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(releaseProjectStorage).not.toHaveBeenCalled();
  });

  it('does not register an asset when atomic completion rejects a mismatched reservation binding', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7');
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = {
      info: jest.fn().mockResolvedValue({ data: { size: bytes.byteLength, contentType: 'application/pdf' }, error: null }),
      download: jest.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const rpc = jest.fn((name: string) => Promise.resolve(name === 'resolve_project_storage_upload_reservation'
      ? { data: RESERVATION_ID, error: null }
      : { data: null, error: { details: 'STORAGE_OBJECT_MISMATCH' } }));
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });

    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledWith('complete_project_game_asset_storage_upload', expect.objectContaining({
      p_reservation_id: RESERVATION_ID,
      p_project_id: PROJECT_ID,
      p_storage_path: path,
      p_storage_bucket: 'project-assets',
    }));
    expect(rpc).not.toHaveBeenCalledWith('mcp_register_project_game_asset', expect.anything());
    expect(bucket.remove).toHaveBeenCalledWith([path]);
  });

  it('preserves objects and reservations when the path does not bind to the submitted reservation', async () => {
    const path = `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-guide.pdf`;
    const bucket = { info: jest.fn(), download: jest.fn(), remove: jest.fn() };
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { details: 'STORAGE_OBJECT_MISMATCH' } });
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc };

    const response = await post({
      action: 'complete',
      items: [{ path, reservationId: RESERVATION_ID, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 }],
    });

    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledWith('resolve_project_storage_upload_reservation', expect.objectContaining({
      p_project_id: PROJECT_ID, p_object_path: path, p_reservation_id: RESERVATION_ID,
    }));
    expect(bucket.info).not.toHaveBeenCalled();
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(releaseProjectStorage).not.toHaveBeenCalled();
  });
});
