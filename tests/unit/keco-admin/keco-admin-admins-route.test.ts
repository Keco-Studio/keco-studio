import { NextRequest } from 'next/server';

const getSupabaseServiceRoleClient = jest.fn();
const hasKecoAdminAccess = jest.fn();
let authenticatedUserId: string | null = null;

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth:
    (handler: (...args: any[]) => Promise<Response>, options: any) =>
    (request: NextRequest, context: unknown) =>
      authenticatedUserId
        ? handler(request, context, { supabase: {}, user: { id: authenticatedUserId } })
        : options.unauthorizedResponse(),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: (...args: unknown[]) =>
    getSupabaseServiceRoleClient(...args),
}));
jest.mock('@/lib/server/kecoAdminAuthorization', () => ({
  hasKecoAdminAccess: (...args: unknown[]) => hasKecoAdminAccess(...args),
}));

import { POST } from '@/app/api/keco-admin/admins/route';

const ADMIN_ID = 'aae0969f-0cb2-4632-8624-b9f40f2f4543';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

function request(email = 'target@example.com') {
  return new NextRequest('https://keco.example/api/keco-admin/admins', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceClient(status: 'granted' | 'already_admin' = 'granted') {
  const rpc = jest.fn(async () => ({
    data: [{ status, user_id: TARGET_ID }],
    error: null,
  }));
  return {
    client: { rpc },
    rpc,
  };
}

describe('Keco Admin administrator grants API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUserId = ADMIN_ID;
    hasKecoAdminAccess.mockResolvedValue(true);
  });

  it('requires authentication before reading service-role data', async () => {
    authenticatedUserId = null;

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('denies non-administrators before constructing the service client', async () => {
    hasKecoAdminAccess.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('grants Keco Admin access to a registered email address', async () => {
    const { client, rpc } = serviceClient();
    getSupabaseServiceRoleClient.mockReturnValue(client);

    const response = await POST(request(' TARGET@example.com '));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      status: 'granted',
      email: 'target@example.com',
    });
    expect(rpc).toHaveBeenCalledWith('grant_keco_admin_by_email', {
      target_email: 'target@example.com',
    });
  });

  it('does not create a duplicate grant for an existing administrator', async () => {
    const { client, rpc } = serviceClient('already_admin');
    getSupabaseServiceRoleClient.mockReturnValue(client);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'already_admin',
      email: 'target@example.com',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
