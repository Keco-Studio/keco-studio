jest.mock('server-only', () => ({}));

import { readKecoAdminCredits } from '@/lib/server/kecoAdminCredits';
import { readKecoAdminOverview } from '@/lib/server/kecoAdminOverview';

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BOB_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_UUID_OWNER_ID = '00000000-0000-0000-0000-000000000001';

const validCredits = {
  allocated: 100_000_000,
  used: 7,
  remaining: 99_999_993,
  overage: 0,
  deepseekTokens: 21,
  incompleteCount: 1,
  trackedFrom: '2026-09-15T00:00:00.000Z',
  users: {
    [ALICE_ID]: {
      allocated: 100_000_000,
      used: 7,
      remaining: 99_999_993,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 1,
    },
  },
};

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: ALICE_ID,
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
  creditData: unknown = validCredits,
) {
  const listUsers = jest.fn(async () => ({
    data: { users, aud: 'authenticated', total },
    error,
  }));
  const rpc = jest.fn(async () => ({ data: creditData, error: null }));
  const storageRows = [
    { owner_id: ALICE_ID, used_bytes: '348600000000', logical_used_bytes: '0' },
    { owner_id: BOB_ID, used_bytes: '201155813888', logical_used_bytes: '0' },
  ];
  const storageQuery = {
    select: jest.fn(() => ({ data: storageRows, error: null })),
  };

  return {
    client: { auth: { admin: { listUsers } }, rpc, from: jest.fn(() => storageQuery) } as never,
    listUsers,
    rpc,
    storageQuery,
  };
}

describe('Keco Admin Credit service', () => {
  it('returns an exact valid summary from the parameterless Admin RPC', async () => {
    const rpc = jest.fn(async () => ({ data: validCredits, error: null }));

    await expect(readKecoAdminCredits({ rpc } as never)).resolves.toEqual(validCredits);
    expect(rpc).toHaveBeenCalledWith('keco_admin_credit_summary');
  });

  it.each([
    ['negative root count', { ...validCredits, allocated: -1 }],
    ['fractional token count', { ...validCredits, deepseekTokens: 1.5 }],
    ['unsafe root count', { ...validCredits, remaining: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing root count', { ...validCredits, overage: undefined }],
    ['non-numeric token count', { ...validCredits, deepseekTokens: '21' }],
    ['negative incomplete count', { ...validCredits, incompleteCount: -1 }],
    ['invalid timestamp', { ...validCredits, trackedFrom: 'not-a-timestamp' }],
    ['unexpected root field', { ...validCredits, extra: true }],
    ['non-object root', []],
  ])('rejects %s', async (_label, data) => {
    const rpc = jest.fn(async () => ({ data, error: null }));

    await expect(readKecoAdminCredits({ rpc } as never)).rejects.toThrow(
      /Invalid Keco Admin Credit/,
    );
  });

  it.each([
    ['non-UUID key', { 'alice@example.com': validCredits.users[ALICE_ID] }],
    ['negative user count', {
      [ALICE_ID]: { ...validCredits.users[ALICE_ID], used: -1 },
    }],
    ['unexpected user field', {
      [ALICE_ID]: { ...validCredits.users[ALICE_ID], extra: true },
    }],
  ])('rejects a user map with a %s', async (_label, users) => {
    const rpc = jest.fn(async () => ({
      data: { ...validCredits, users },
      error: null,
    }));

    await expect(readKecoAdminCredits({ rpc } as never)).rejects.toThrow(
      /Invalid Keco Admin Credit/,
    );
  });

  it('rejects RPC failures without returning provider details', async () => {
    const rpc = jest.fn(async () => ({
      data: validCredits,
      error: { message: 'private database failure' },
    }));

    await expect(readKecoAdminCredits({ rpc } as never)).rejects.toThrow(
      'Unable to load Keco Admin Credits',
    );
  });
});

describe('Keco Admin overview service', () => {
  it('reads Auth and Credit concurrently, then joins Credit rows by user UUID', async () => {
    let resolveAuth!: (value: unknown) => void;
    let resolveCredits!: (value: unknown) => void;
    const listUsers = jest.fn(() => new Promise((resolve) => {
      resolveAuth = resolve;
    }));
    const rpc = jest.fn(() => new Promise((resolve) => {
      resolveCredits = resolve;
    }));
    const from = jest.fn(() => ({
      select: jest.fn(async () => ({
        data: [
          { owner_id: ALICE_ID, used_bytes: '348600000000', logical_used_bytes: '0' },
          { owner_id: BOB_ID, used_bytes: '201155813888', logical_used_bytes: '0' },
        ],
        error: null,
      })),
    }));
    const overviewPromise = readKecoAdminOverview(
      { auth: { admin: { listUsers } }, rpc, from } as never,
      () => new Date('2026-09-11T10:00:00.000Z'),
    );

    await Promise.resolve();
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 100 });
    expect(rpc).toHaveBeenCalledWith('keco_admin_credit_summary');
    expect(from).toHaveBeenCalledWith('account_storage_quotas');

    resolveAuth({
      data: {
        users: [
          authUser(),
          authUser({
            id: BOB_ID,
            email: 'bob@example.com',
            banned_until: '2099-01-01T00:00:00.000Z',
          }),
        ],
        aud: 'authenticated',
        total: 9,
      },
      error: null,
    });
    resolveCredits({ data: validCredits, error: null });

    await expect(overviewPromise).resolves.toEqual({
      totalUsers: 9,
      creditUsage: {
        allocated: 100_000_000,
        used: 7,
        remaining: 99_999_993,
        overage: 0,
        deepseekTokens: 21,
        incompleteCount: 1,
        trackedFrom: '2026-09-15T00:00:00.000Z',
      },
      storageUsage: { usedBytes: 549755813888 },
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [
        {
          id: ALICE_ID,
          email: 'alice@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: '2026-09-01T00:00:00.000Z',
          status: 'active',
          creditAllocated: 100_000_000,
          creditUsed: 7,
          creditRemaining: 99_999_993,
          creditOverage: 0,
          deepseekTokens: 21,
          creditUsageIncompleteCount: 1,
          storageUsedBytes: 348600000000,
        },
        {
          id: BOB_ID,
          email: 'bob@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: '2026-09-01T00:00:00.000Z',
          status: 'suspended',
          creditAllocated: 0,
          creditUsed: 0,
          creditRemaining: 0,
          creditOverage: 0,
          deepseekTokens: 0,
          creditUsageIncompleteCount: 0,
          storageUsedBytes: 201155813888,
        },
      ],
    });
  });

  it('does not join Credit data by mutable email identity', async () => {
    const creditsForDifferentUuid = {
      ...validCredits,
      users: {
        [BOB_ID]: validCredits.users[ALICE_ID],
      },
    };
    const { client } = clientReturning(1, [
      authUser(),
    ], null, creditsForDifferentUuid);

    await expect(
      readKecoAdminOverview(
        client,
        () => new Date('2026-09-11T10:00:00.000Z'),
      ),
    ).resolves.toEqual({
      totalUsers: 1,
      creditUsage: {
        allocated: 100_000_000,
        used: 7,
        remaining: 99_999_993,
        overage: 0,
        deepseekTokens: 21,
        incompleteCount: 1,
        trackedFrom: '2026-09-15T00:00:00.000Z',
      },
      storageUsage: { usedBytes: 549755813888 },
      refreshedAt: '2026-09-11T10:00:00.000Z',
      users: [
        {
          id: ALICE_ID,
          email: 'alice@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSignInAt: '2026-09-01T00:00:00.000Z',
          status: 'active',
          creditAllocated: 0,
          creditUsed: 0,
          creditRemaining: 0,
          creditOverage: 0,
          deepseekTokens: 0,
          creditUsageIncompleteCount: 0,
          storageUsedBytes: 348600000000,
        },
      ],
    });
  });

  it('accepts storage quota owners represented by valid database UUIDs outside RFC versions 1-5', async () => {
    const listUsers = jest.fn(async () => ({
      data: {
        users: [authUser({ id: LEGACY_UUID_OWNER_ID })],
        aud: 'authenticated',
        total: 1,
      },
      error: null,
    }));
    const rpc = jest.fn(async () => ({ data: validCredits, error: null }));
    const from = jest.fn(() => ({
      select: jest.fn(async () => ({
        data: [{ owner_id: LEGACY_UUID_OWNER_ID, used_bytes: '42', logical_used_bytes: '0' }],
        error: null,
      })),
    }));

    await expect(readKecoAdminOverview(
      { auth: { admin: { listUsers } }, rpc, from } as never,
      () => new Date('2026-09-24T00:00:00.000Z'),
    )).resolves.toMatchObject({
      storageUsage: { usedBytes: 42 },
      users: [{ id: LEGACY_UUID_OWNER_ID, storageUsedBytes: 42 }],
    });
  });

  it('combines each owner\'s physical files and logical content into Admin Storage used', async () => {
    const { client } = clientReturning(1, [authUser()]);
    const from = client.from as jest.Mock;
    from.mockReturnValue({
      select: jest.fn(async () => ({
        data: [{ owner_id: ALICE_ID, used_bytes: '2', logical_used_bytes: '40' }],
        error: null,
      })),
    });

    await expect(readKecoAdminOverview(
      client,
      () => new Date('2026-09-24T00:00:00.000Z'),
    )).resolves.toMatchObject({
      storageUsage: { usedBytes: 42 },
      users: [{ id: ALICE_ID, storageUsedBytes: 42 }],
    });
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
