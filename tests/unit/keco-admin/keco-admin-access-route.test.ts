import { NextRequest } from 'next/server';

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

import { GET } from '@/app/api/keco-admin/access/route';

const ADMIN_ID = 'aae0969f-0cb2-4632-8624-b9f40f2f4543';
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const originalAdminId = process.env.KECO_ADMIN_USER_ID;

function request() {
  return new NextRequest('https://keco.example/api/keco-admin/access');
}

describe('Keco Admin access API', () => {
  beforeEach(() => {
    authenticatedUserId = ADMIN_ID;
    process.env.KECO_ADMIN_USER_ID = ADMIN_ID;
  });

  afterAll(() => {
    if (originalAdminId === undefined) {
      delete process.env.KECO_ADMIN_USER_ID;
    } else {
      process.env.KECO_ADMIN_USER_ID = originalAdminId;
    }
  });

  it('requires an authenticated browser session', async () => {
    authenticatedUserId = null;

    const response = await GET(request(), undefined);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Please sign in to continue',
    });
  });

  it('reports access only for the exact configured user', async () => {
    const adminResponse = await GET(request(), undefined);
    authenticatedUserId = OTHER_ID;
    const otherResponse = await GET(request(), undefined);

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    await expect(adminResponse.json()).resolves.toEqual({ isAdmin: true });
    await expect(otherResponse.json()).resolves.toEqual({ isAdmin: false });
  });

  it('fails closed when administrator configuration is missing', async () => {
    delete process.env.KECO_ADMIN_USER_ID;

    const response = await GET(request(), undefined);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ isAdmin: false });
  });
});
