import { NextRequest } from 'next/server';

const processSystem = jest.fn();
const processGdd = jest.fn();
const serviceClient = { service: true };

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: () => serviceClient }));
jest.mock('@/lib/game-design-system/worker', () => ({ processNextGameDesignSystemJob: (...args: unknown[]) => processSystem(...args) }));
jest.mock('@/lib/gdd-generation/worker', () => ({ processNextGddJob: (...args: unknown[]) => processGdd(...args) }));

import { GET } from '@/app/api/internal/game-design-system-worker/route';

describe('internal Game Design System worker route dispatch', () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'worker-secret';
  });

  afterAll(() => {
    process.env.CRON_SECRET = previousSecret;
  });

  it('dispatches both GDS and GDD jobs during one authorized invocation', async () => {
    processSystem
      .mockResolvedValueOnce({ claimed: true, jobId: 'system-job', status: 'completed' })
      .mockResolvedValueOnce({ claimed: false });
    processGdd
      .mockResolvedValueOnce({ claimed: true, jobId: 'gdd-job', status: 'completed' })
      .mockResolvedValueOnce({ claimed: false });

    const response = await GET(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      headers: { authorization: 'Bearer worker-secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'system', jobId: 'system-job' }),
      expect.objectContaining({ type: 'gdd', jobId: 'gdd-job' }),
    ]));
    expect(processSystem).toHaveBeenCalled();
    expect(processGdd).toHaveBeenCalled();
  });

  it('does not dispatch either worker for an unauthorized invocation', async () => {
    const response = await GET(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      headers: { authorization: 'Bearer wrong-secret' },
    }));

    expect(response.status).toBe(401);
    expect(processSystem).not.toHaveBeenCalled();
    expect(processGdd).not.toHaveBeenCalled();
  });
});
