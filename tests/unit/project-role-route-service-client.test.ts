import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const getUserProjectRole = jest.fn();
const getSupabaseServiceRoleClient = jest.fn();
const requestSupabase = { source: 'request' };
const serviceSupabase = { source: 'service' };

class MockAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => (request: NextRequest, context: unknown) =>
    handler(request, context, { supabase: requestSupabase, user: { id: 'user-1' } }),
}));

jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: MockAuthorizationError,
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));

jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => getSupabaseServiceRoleClient(),
}));

import { GET } from '@/app/api/projects/[projectId]/role/route';

const params = { params: Promise.resolve({ projectId: 'project-1' }) };

describe('project role route', () => {
  beforeEach(() => {
    getUserProjectRole.mockReset();
    getSupabaseServiceRoleClient.mockReset();
    getSupabaseServiceRoleClient.mockReturnValue(serviceSupabase);
  });

  it('uses the authenticated request client when it can resolve the role', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'admin', isOwner: true });

    const response = await GET(new NextRequest('https://example.test/api/projects/project-1/role'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: 'admin', isOwner: true });
    expect(getUserProjectRole).toHaveBeenCalledWith(requestSupabase, 'project-1', 'user-1');
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('falls back to the service client only when RLS hides an existing project', async () => {
    getUserProjectRole
      .mockRejectedValueOnce(new MockAuthorizationError('Project not found'))
      .mockResolvedValueOnce({ role: 'editor', isOwner: false });

    const response = await GET(new NextRequest('https://example.test/api/projects/project-1/role'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: 'editor', isOwner: false });
    expect(getUserProjectRole).toHaveBeenNthCalledWith(1, requestSupabase, 'project-1', 'user-1');
    expect(getUserProjectRole).toHaveBeenNthCalledWith(2, serviceSupabase, 'project-1', 'user-1');
  });
});
