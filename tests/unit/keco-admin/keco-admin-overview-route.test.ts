import { NextRequest } from 'next/server';

const getSupabaseServiceRoleClient = jest.fn();
const readKecoAdminOverview = jest.fn();
let authenticatedUserId: string | null = null;

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth:
    (handler: (...args: any[]) => Promise<Response>, options: any) =>
    (request: NextRequest, context: unknown) =>
      authenticatedUserId
        ? handler(request, context, {
            supabase: {},
            user: { id: authenticatedUserId },
          })
        : options.unauthorizedResponse(),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: (...args: unknown[]) =>
    getSupabaseServiceRoleClient(...args),
}));
jest.mock('@/lib/server/kecoAdminOverview', () => ({
  readKecoAdminOverview: (...args: unknown[]) => readKecoAdminOverview(...args),
}));

import { GET } from '@/app/api/keco-admin/overview/route';

const ADMIN_ID = 'aae0969f-0cb2-4632-8624-b9f40f2f4543';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const originalAdminId = process.env.KECO_ADMIN_USER_ID;
const creditUsage = {
  allocated: 100_000_000,
  used: 7,
  remaining: 99_999_993,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 1,
  trackedFrom: '2026-09-15T00:00:00.000Z',
};

function request() {
  return new NextRequest('https://keco.example/api/keco-admin/overview');
}

describe('Keco Admin overview API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUserId = ADMIN_ID;
    process.env.KECO_ADMIN_USER_ID = ADMIN_ID;
    getSupabaseServiceRoleClient.mockReturnValue({ service: true });
    readKecoAdminOverview.mockResolvedValue({
      totalUsers: 9,
      creditUsage,
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [],
    });
  });

  afterAll(() => {
    if (originalAdminId === undefined) {
      delete process.env.KECO_ADMIN_USER_ID;
    } else {
      process.env.KECO_ADMIN_USER_ID = originalAdminId;
    }
  });

  it('requires authentication before any privileged service access', async () => {
    authenticatedUserId = null;

    const response = await GET(request(), undefined);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(readKecoAdminOverview).not.toHaveBeenCalled();
  });

  it('denies other users before constructing the service-role client', async () => {
    authenticatedUserId = OTHER_ID;

    const response = await GET(request(), undefined);

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(readKecoAdminOverview).not.toHaveBeenCalled();
  });

  it('returns the administrator overview contract with users', async () => {
    readKecoAdminOverview.mockResolvedValue({
      totalUsers: 9,
      creditUsage,
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: null,
          status: 'active',
          creditAllocated: 100_000_000,
          creditUsed: 7,
          creditRemaining: 99_999_993,
          creditOverage: 0,
          deepseekTokens: 21,
          creditUsageIncompleteCount: 1,
        },
      ],
    });

    const response = await GET(request(), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      totalUsers: 9,
      creditUsage,
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: null,
          status: 'active',
          creditAllocated: 100_000_000,
          creditUsed: 7,
          creditRemaining: 99_999_993,
          creditOverage: 0,
          deepseekTokens: 21,
          creditUsageIncompleteCount: 1,
        },
      ],
    });
    expect(readKecoAdminOverview).toHaveBeenCalledWith({ service: true });
  });

  it('returns a generic service failure without logging private details', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    readKecoAdminOverview.mockRejectedValue(
      new Error('private authorization metadata'),
    );

    const response = await GET(request(), undefined);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to load Keco Admin data',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      'private authorization metadata',
    );
    errorSpy.mockRestore();
  });
});
