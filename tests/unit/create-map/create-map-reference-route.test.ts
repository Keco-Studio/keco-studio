import { NextRequest } from 'next/server';

const getUserProjectRole = jest.fn();
const normalizeReferenceImage = jest.fn();
const uploadCreateMapReference = jest.fn();
const listCreateMapReferences = jest.fn();
let authenticated = true;
const supabase = {};

const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, undefined, { supabase, user: { id: 'user-1' } });
  });

class MockAuthorizationError extends Error {}
class MockCreateMapReferenceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: MockAuthorizationError,
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));
jest.mock('@/lib/server/createMapReferenceService', () => ({
  CreateMapReferenceError: MockCreateMapReferenceError,
  normalizeReferenceImage: (...args: unknown[]) => normalizeReferenceImage(...args),
  uploadCreateMapReference: (...args: unknown[]) => uploadCreateMapReference(...args),
  listCreateMapReferences: (...args: unknown[]) => listCreateMapReferences(...args),
}));

import { GET, POST } from '@/app/api/create-map/references/route';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const REFERENCE_ID = '33333333-3333-4333-8333-333333333333';
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
const validFile = new File([PNG_BYTES], 'layout.png', { type: 'image/png' });

const reference = {
  id: REFERENCE_ID,
  projectId: PROJECT_ID,
  name: 'layout.png',
  storagePath: `references/${PROJECT_ID}/${REFERENCE_ID}/${'a'.repeat(64)}.png`,
  sha256: 'a'.repeat(64),
  width: 640,
  height: 480,
  contentType: 'image/png' as const,
  byteSize: PNG_BYTES.byteLength,
  previewUrl: null,
};

function multipartRequest(input: { projectId: string; file: File }) {
  const body = new FormData();
  body.set('projectId', input.projectId);
  body.set('file', input.file);
  return new NextRequest('https://example.test/api/create-map/references', { method: 'POST', body });
}

describe('Create Map references route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    getUserProjectRole.mockResolvedValue({ role: 'editor', isOwner: false });
    normalizeReferenceImage.mockResolvedValue({
      bytes: Buffer.from(PNG_BYTES), width: 640, height: 480, sha256: 'a'.repeat(64),
    });
    uploadCreateMapReference.mockResolvedValue(reference);
    listCreateMapReferences.mockResolvedValue([{ ...reference, previewUrl: 'https://storage.example.test/signed' }]);
  });

  it('normalizes one authorized reference to PNG and returns no durable URL', async () => {
    const response = await POST(multipartRequest({ projectId: PROJECT_ID, file: validFile }), {} as never);
    const responseForLeakCheck = response.clone();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ reference: expect.objectContaining({
      projectId: PROJECT_ID, name: 'layout.png', sha256: 'a'.repeat(64), width: 640, height: 480,
    }) });
    expect(JSON.stringify(await responseForLeakCheck.json())).not.toContain('signedUrl');
    expect(normalizeReferenceImage).toHaveBeenCalledWith(expect.any(File));
    expect(uploadCreateMapReference).toHaveBeenCalledWith(PROJECT_ID, expect.any(File), 'user-1', expect.objectContaining({
      width: 640, height: 480, sha256: 'a'.repeat(64),
    }));
  });

  it('rejects viewers, non-images, oversized files, and images above 2048px', async () => {
    getUserProjectRole.mockResolvedValueOnce({ role: 'viewer', isOwner: false });
    expect((await POST(multipartRequest({ projectId: PROJECT_ID, file: validFile }), {} as never)).status).toBe(403);

    getUserProjectRole.mockResolvedValue({ role: 'editor', isOwner: false });
    expect((await POST(multipartRequest({
      projectId: PROJECT_ID, file: new File(['text'], 'layout.txt', { type: 'text/plain' }),
    }), {} as never)).status).toBe(400);

    normalizeReferenceImage.mockRejectedValueOnce(new MockCreateMapReferenceError('invalid_reference_file', 400));
    expect((await POST(multipartRequest({
      projectId: PROJECT_ID, file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    }), {} as never)).status).toBe(400);

    normalizeReferenceImage.mockRejectedValueOnce(new MockCreateMapReferenceError('invalid_reference_dimensions', 400));
    expect((await POST(multipartRequest({ projectId: PROJECT_ID, file: validFile }), {} as never)).status).toBe(400);
  });

  it('requires project membership for listing and returns transient previews only from GET', async () => {
    const response = await GET(new NextRequest(
      `https://example.test/api/create-map/references?projectId=${PROJECT_ID}`
    ), {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ references: [{ ...reference, previewUrl: 'https://storage.example.test/signed' }] });
    expect(getUserProjectRole).toHaveBeenCalledWith(supabase, PROJECT_ID, 'user-1');
    expect(listCreateMapReferences).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('rejects unauthenticated and invalid project requests', async () => {
    authenticated = false;
    expect((await GET(new NextRequest(`https://example.test/api/create-map/references?projectId=${PROJECT_ID}`), {} as never)).status).toBe(401);
    authenticated = true;
    expect((await GET(new NextRequest('https://example.test/api/create-map/references?projectId=nope'), {} as never)).status).toBe(400);
  });
});
