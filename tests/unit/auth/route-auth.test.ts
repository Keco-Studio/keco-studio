import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { authenticate, withAuth } from '@/lib/auth/route-auth';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/createSupabaseServerClient', () => ({
  createSupabaseServerClient: jest.fn(),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: jest.fn(),
}));

const createClientMock = createClient as jest.MockedFunction<typeof createClient>;
const createServerClientMock = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>;
const getUserProjectRoleMock = getUserProjectRole as jest.MockedFunction<
  typeof getUserProjectRole
>;

function clientWithUser(user: { id: string } | null) {
  return {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user },
        error: user ? null : { message: 'invalid session' },
      })),
    },
  };
}

describe('route auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authenticates bearer requests with a request-scoped client', async () => {
    const client = clientWithUser({ id: 'user-1' });
    createClientMock.mockReturnValue(client as never);
    const request = new NextRequest('https://example.test/api/projects', {
      headers: { authorization: 'Bearer access-token' },
    });

    const result = await authenticate(request);

    expect(result).toMatchObject({ user: { id: 'user-1' }, supabase: client });
    expect(client.auth.getUser).toHaveBeenCalledWith('access-token');
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('authenticates cookie-session requests with the SSR client', async () => {
    const client = clientWithUser({ id: 'user-2' });
    createServerClientMock.mockReturnValue(client as never);
    const request = new NextRequest('https://example.test/api/projects');

    const result = await authenticate(request);

    expect(result).toMatchObject({ user: { id: 'user-2' }, supabase: client });
    expect(client.auth.getUser).toHaveBeenCalledWith();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('does not invoke a wrapped handler for an invalid session', async () => {
    createServerClientMock.mockReturnValue(clientWithUser(null) as never);
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const response = await wrapped(
      new NextRequest('https://example.test/api/projects'),
      undefined
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Please sign in to continue',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('enforces an optional project role before invoking a handler', async () => {
    const client = clientWithUser({ id: 'user-3' });
    createServerClientMock.mockReturnValue(client as never);
    getUserProjectRoleMock.mockResolvedValue({ role: 'viewer', isOwner: false });
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler, {
      requireProjectRole: {
        projectId: async (_request, context: { params: Promise<{ projectId: string }> }) =>
          (await context.params).projectId,
        allowedRoles: ['admin'],
      },
    });

    const response = await wrapped(
      new NextRequest('https://example.test/api/projects/project-1'),
      { params: Promise.resolve({ projectId: 'project-1' }) }
    );

    expect(response.status).toBe(403);
    expect(getUserProjectRoleMock).toHaveBeenCalledWith(client, 'project-1', 'user-3');
    expect(handler).not.toHaveBeenCalled();
  });
});
