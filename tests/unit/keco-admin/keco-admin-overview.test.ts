jest.mock('server-only', () => ({}));

import { readKecoAdminOverview } from '@/lib/server/kecoAdminOverview';

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-09-01T00:00:00.000Z',
    banned_until: undefined,
    ...overrides,
  };
}

function clientReturning(
  total: unknown,
  users: unknown[] = [],
  error: unknown = null,
) {
  const listUsers = jest.fn(async () => ({
    data: { users, aud: 'authenticated', total },
    error,
  }));

  return {
    client: { auth: { admin: { listUsers } } } as never,
    listUsers,
  };
}

describe('Keco Admin overview service', () => {
  it('reads the Auth total and mapped user rows', async () => {
    const { client, listUsers } = clientReturning(9, [
      authUser(),
      authUser({
        id: '22222222-2222-4222-8222-222222222222',
        email: 'bob@example.com',
        banned_until: '2099-01-01T00:00:00.000Z',
      }),
    ]);

    await expect(
      readKecoAdminOverview(
        client,
        () => new Date('2026-09-11T10:00:00.000Z'),
      ),
    ).resolves.toEqual({
      totalUsers: 9,
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'alice@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: '2026-09-01T00:00:00.000Z',
          status: 'active',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'bob@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: '2026-09-01T00:00:00.000Z',
          status: 'suspended',
        },
      ],
    });
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 100 });
  });

  it('rejects an Auth Admin failure without returning provider data', async () => {
    const { client } = clientReturning(9, [], {
      message: 'private provider failure',
    });

    await expect(readKecoAdminOverview(client)).rejects.toThrow(
      'Unable to read the account total',
    );
  });

  it.each([undefined, null, -1, 1.5, Number.NaN])(
    'rejects invalid total %p',
    async (total) => {
      const { client } = clientReturning(total);

      await expect(readKecoAdminOverview(client)).rejects.toThrow(
        'Supabase returned an invalid account total',
      );
    },
  );
});
