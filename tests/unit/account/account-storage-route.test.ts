import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let authenticated = true;
const supabase = { rpc: jest.fn() };
const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, undefined, {
      supabase,
      user: { id: '10000000-0000-4000-8000-000000000001' },
    });
  });
const readOwnAccountStorage = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/server/accountStorage', () => ({ readOwnAccountStorage }));

import { GET } from '@/app/api/account/storage/route';

const validSummary = {
  quotaBytes: 1_099_511_627_776,
  usedBytes: 100,
  physicalUsedBytes: 80,
  logicalUsedBytes: 20,
  reservedBytes: 20,
  remainingBytes: 1_099_511_627_656,
  overageBytes: 0,
  ownedProjects: [],
  sharedProjects: [],
  unassigned: null,
};

function get() {
  return GET(new NextRequest('https://example.test/api/account/storage'), undefined);
}

describe('GET /api/account/storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    readOwnAccountStorage.mockResolvedValue(validSummary);
  });

  it('returns the signed-in storage summary privately', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(validSummary);
    expect(readOwnAccountStorage).toHaveBeenCalledWith(supabase);
  });

  it('requires authentication with a private response', async () => {
    authenticated = false;

    const response = await get();

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('maps service failures to a generic private 503 response', async () => {
    readOwnAccountStorage.mockRejectedValue(new Error('database failure'));

    const response = await get();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Unable to load account storage' });
  });
});
