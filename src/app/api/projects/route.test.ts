import { NextRequest } from 'next/server';

const rpc = jest.fn();
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => (
  (handler as Function)(request, undefined, {
    supabase: { rpc },
    user: { id: '11111111-1111-4111-8111-111111111111' },
  })
));

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown, _options: unknown) => withAuth(handler),
}));

import { POST } from './route';

const project = {
  id: '22222222-2222-4222-8222-222222222222',
  owner_id: '11111111-1111-4111-8111-111111111111',
  name: 'Tactics',
  description: 'A tactical game',
  genres: ['Strategy'],
  design_philosophies: ['Player Agency'],
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-10-30T00:00:00.000Z',
};

function request(body: unknown): NextRequest {
  return new NextRequest('https://example.test/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: { project, folder_id: '33333333-3333-4333-8333-333333333333' }, error: null });
  });

  it('uses empty Foundation arrays for legacy requests', async () => {
    const response = await POST(request({ name: ' Tactics ', description: 'A tactical game' }) as never, undefined as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ...project,
      default_folder_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(rpc).toHaveBeenCalledWith('create_project_with_foundation', {
      p_name: 'Tactics',
      p_description: 'A tactical game',
      p_genres: [],
      p_design_philosophies: [],
    });
  });

  it('normalizes Foundation arrays before creating the project', async () => {
    const response = await POST(request({
      name: 'Tactics',
      genres: [' strategy ', 'Strategy', 'Custom   Genre'],
      designPhilosophies: [' player agency ', 'PLAYER AGENCY', 'Readable   Systems'],
    }) as never, undefined as never);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('create_project_with_foundation', {
      p_name: 'Tactics',
      p_description: null,
      p_genres: ['Strategy', 'Custom Genre'],
      p_design_philosophies: ['Player Agency', 'Readable Systems'],
    });
  });
});
