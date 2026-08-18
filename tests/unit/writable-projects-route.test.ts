import { NextRequest } from 'next/server';

let userId: string | null = 'user-1';
let supabase: any;

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function, options: any = {}) => async (request: NextRequest, context: unknown) => {
    if (!userId) return options.unauthorizedResponse?.() ?? Response.json({ error: 'Please sign in' }, { status: 401 });
    return handler(request, context, { supabase, user: { id: userId } });
  },
}));

import { GET } from '@/app/api/projects/writable/route';

describe('writable projects route', () => {
  it('lists owned projects and accepted admin/editor collaborations only', async () => {
    supabase = {
      from: (table: string) => {
        if (table === 'projects') return {
          select: () => ({ order: async () => ({ data: [
            { id: 'owned', name: 'Owned', owner_id: 'user-1' },
            { id: 'edited', name: 'Edited', owner_id: 'other' },
            { id: 'viewed', name: 'Viewed', owner_id: 'other' },
          ], error: null }) }),
        };
        if (table === 'project_collaborators') return {
          select: () => ({ eq: () => ({ not: () => ({ in: async () => ({ data: [
            { project_id: 'edited', role: 'editor', accepted_at: '2026-08-17' },
          ], error: null }) }) }) }),
        };
        throw new Error(`unexpected table ${table}`);
      },
    };

    const response = await GET(new NextRequest('https://example.test/api/projects/writable'), undefined);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: 'owned', name: 'Owned' },
      { id: 'edited', name: 'Edited' },
    ]);
  });
});
