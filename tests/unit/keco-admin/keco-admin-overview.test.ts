jest.mock('server-only', () => ({}));

import { readKecoAdminOverview } from '@/lib/server/kecoAdminOverview';

function clientReturning(total: unknown, error: unknown = null) {
  const listUsers = jest.fn(async () => ({
    data: { users: [], aud: 'authenticated', total },
    error,
  }));

  return {
    client: { auth: { admin: { listUsers } } } as never,
    listUsers,
  };
}

describe('Keco Admin overview service', () => {
  it('reads only the authoritative Auth total', async () => {
    const { client, listUsers } = clientReturning(9);

    await expect(
      readKecoAdminOverview(
        client,
        () => new Date('2026-09-11T10:00:00.000Z'),
      ),
    ).resolves.toEqual({
      totalUsers: 9,
      refreshedAt: '2026-09-11T10:00:00.000Z',
    });
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1 });
  });

  it('rejects an Auth Admin failure without returning provider data', async () => {
    const { client } = clientReturning(9, {
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
