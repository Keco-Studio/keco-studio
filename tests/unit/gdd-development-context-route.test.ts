import { NextRequest } from 'next/server';
import { beforeEach, jest } from '@jest/globals';

const readContext = jest.fn();
const getRole = jest.fn(async () => ({ role: 'viewer' }));
const MockAuthorizationError = class AuthorizationError extends Error {};
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => (request: NextRequest, context: unknown) => handler(request, context, { supabase: {}, user: { id: 'user-1' } }),
}));
jest.mock('@/lib/gdd-development/contextService', () => ({
  GddDevelopmentContextNotFoundError: class GddDevelopmentContextNotFoundError extends Error {},
  readGddDevelopmentContext: (...args: unknown[]) => readContext(...args),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: MockAuthorizationError,
  getUserProjectRole: (...args: unknown[]) => getRole(...args),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: () => ({ service: true }) }));

import { GET } from '@/app/api/projects/[projectId]/gdd-development-context/[documentId]/route';

const projectId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

describe('GDD development context route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('authorizes before resolving and accepts strict target profiles', async () => {
    readContext.mockResolvedValue({ document: { id: documentId }, origin: null, artStyle: null, assets: [], warnings: [] });
    const profile = encodeURIComponent(JSON.stringify({ engine: 'godot-4', assetKind: 'map_image', width: 512 }));
    const response = await GET(new NextRequest(`https://keco.test/api?targetProfile=${profile}`), { params: Promise.resolve({ projectId, documentId }) });
    expect(response.status).toBe(200);
    expect(getRole).toHaveBeenCalled();
    expect(readContext).toHaveBeenCalledWith(expect.anything(), { projectId, documentId, targetProfile: { engine: 'godot-4', assetKind: 'map_image', width: 512 } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects unknown target profile fields before service reads', async () => {
    const profile = encodeURIComponent(JSON.stringify({ engine: 'godot-4', assetKind: 'map_image', secret: true }));
    const response = await GET(new NextRequest(`https://keco.test/api?targetProfile=${profile}`), { params: Promise.resolve({ projectId, documentId }) });
    expect(response.status).toBe(400);
    expect(readContext).not.toHaveBeenCalled();
  });

  it('hides inaccessible projects without invoking the privileged resolver', async () => {
    getRole.mockRejectedValueOnce(new MockAuthorizationError('Project not found'));
    const response = await GET(new NextRequest('https://keco.test/api'), { params: Promise.resolve({ projectId, documentId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROJECT_NOT_ACCESSIBLE' });
    expect(readContext).not.toHaveBeenCalled();
  });
});
