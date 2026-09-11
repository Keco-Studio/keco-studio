import { NextRequest } from 'next/server';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const getUserProjectRole = jest.fn();
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
    expect(rpc).toHaveBeenCalledWith('mcp_register_project_game_asset', expect.objectContaining({
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
    const rpc = jest.fn();
    supabase = { storage: { from: jest.fn(() => bucket) }, rpc };

    const response = await post({
      action: 'complete',
      items: [{ path, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });
    const result = await response.json();

    expect(result).toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
    expect(rpc).not.toHaveBeenCalled();
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
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
    };

    const response = await post({
      action: 'complete',
      items: [{ path, fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: bytes.byteLength }],
    });
    const result = await response.json();

    expect(result).toMatchObject({ completedCount: 0, failedCount: 1 });
    expect(bucket.remove).toHaveBeenCalledWith([path]);
  });
});
