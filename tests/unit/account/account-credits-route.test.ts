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

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));

import { GET } from '@/app/api/account/credits/route';

const validSummary = {
  allocated: 100,
  used: 40,
  remaining: 60,
  overage: 0,
  deepseekTokens: 120,
  incompleteCount: 2,
  trackedFrom: '2026-09-17T00:00:00.000Z',
};

function get() {
  return GET(new NextRequest('https://example.test/api/account/credits'), undefined);
}

describe('GET /api/account/credits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    supabase.rpc.mockResolvedValue({ data: validSummary, error: null });
  });

  it('returns the signed-in account credit summary with a private no-store response', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(validSummary);
    expect(supabase.rpc).toHaveBeenCalledWith('account_credit_summary');
  });

  it('requires authentication and keeps the unauthorized response private', async () => {
    authenticated = false;

    const response = await get();

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('maps RPC failures to a generic private 503 response', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'database failure' } });

    const response = await get();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Unable to load account Credits' });
  });
});
