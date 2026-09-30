import { after, NextRequest } from 'next/server';

const processSystem = jest.fn();
const processGdd = jest.fn();
const processDialogue = jest.fn();
const processResource = jest.fn();
const processMap = jest.fn();
const availableAt = jest.fn();
const query = {
  select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
  maybeSingle: availableAt,
};
const serviceClient = { service: true, from: jest.fn(() => query) };

jest.mock('server-only', () => ({}));
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }));
jest.mock('@/lib/gdd-generation/worker-dispatch', () => ({ dispatchGddWorker: jest.fn(), MAX_GDD_WORKER_DELAY_MS: 35_000 }));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: () => serviceClient }));
jest.mock('@/lib/game-design-system/worker', () => ({ processNextGameDesignSystemJob: (...args: unknown[]) => processSystem(...args) }));
jest.mock('@/lib/gdd-generation/worker', () => ({ processNextGddJob: (...args: unknown[]) => processGdd(...args) }));
jest.mock('@/lib/gdd-generation/dialogueWorker', () => ({ processNextDialogueJob: (...args: unknown[]) => processDialogue(...args) }));
jest.mock('@/lib/gdd-generation/resources/worker', () => ({ processNextGddResourceJob: (...args: unknown[]) => processResource(...args) }));
jest.mock('@/lib/gdd-generation/maps/worker', () => ({ processNextGddMapArtifact: (...args: unknown[]) => processMap(...args) }));

import { dispatchGddWorker } from '@/lib/gdd-generation/worker-dispatch';
import { GET, POST, maxDuration } from '@/app/api/internal/game-design-system-worker/route';

describe('internal Game Design System worker route dispatch', () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    processSystem.mockReset();
    processGdd.mockReset();
    processDialogue.mockReset();
    processResource.mockReset();
    processMap.mockReset();
    availableAt.mockReset();
    availableAt.mockResolvedValue({ data: { available_at: new Date(Date.now() - 1000).toISOString() }, error: null });
    jest.mocked(dispatchGddWorker).mockReset();
    process.env.CRON_SECRET = 'worker-secret';
  });

  afterAll(() => {
    process.env.CRON_SECRET = previousSecret;
  });

  it('keeps cron workers within the Vercel hobby maxDuration ceiling', () => {
    expect(maxDuration).toBe(300);
  });

  it('dispatches both GDS and GDD jobs during one authorized invocation', async () => {
    processSystem
      .mockResolvedValueOnce({ claimed: true, jobId: 'system-job', status: 'completed' })
      .mockResolvedValueOnce({ claimed: false });
    processGdd
      .mockResolvedValueOnce({ claimed: true, jobId: 'gdd-job', status: 'completed' })
      .mockResolvedValueOnce({ claimed: false });
    processDialogue
      .mockResolvedValueOnce({ claimed: true, jobId: 'dialogue-job', status: 'completed' })
      .mockResolvedValue({ claimed: false });
    processResource
      .mockResolvedValueOnce({ claimed: true, jobId: 'resource-job', status: 'completed' })
      .mockResolvedValue({ claimed: false });

    const response = await GET(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      headers: { authorization: 'Bearer worker-secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'system', jobId: 'system-job' }),
      expect.objectContaining({ type: 'gdd', jobId: 'gdd-job' }),
      expect.objectContaining({ type: 'dialogue', jobId: 'dialogue-job' }),
      expect.objectContaining({ type: 'gdd-resource', jobId: 'resource-job' }),
    ]));
    expect(processSystem).toHaveBeenCalled();
    expect(processGdd).toHaveBeenCalled();
    expect(processDialogue).toHaveBeenCalled();
    expect(processResource).toHaveBeenCalled();
  });

  it('does not dispatch either worker for an unauthorized invocation', async () => {
    const response = await GET(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      headers: { authorization: 'Bearer wrong-secret' },
    }));

    expect(response.status).toBe(401);
    expect(processSystem).not.toHaveBeenCalled();
    expect(processGdd).not.toHaveBeenCalled();
    expect(processDialogue).not.toHaveBeenCalled();
    expect(processResource).not.toHaveBeenCalled();
  });

  it('accepts a short authenticated wake and continues a checkpointed GDD in a new invocation', async () => {
    processGdd.mockResolvedValueOnce({ claimed: true, jobId: 'gdd-job', status: 'queued' });
    jest.mocked(dispatchGddWorker).mockResolvedValueOnce(undefined);
    const response = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-secret' },
    }));
    expect(response.status).toBe(202);
    expect(processGdd).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(processGdd).toHaveBeenCalledTimes(1);
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'gdd', delayMs: 0 });
  });

  it('rejects missing worker auth and hands completed GDD resource work to a separate invocation', async () => {
    const unauthorized = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer wrong-secret' },
    }));
    expect(unauthorized.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
    processGdd.mockResolvedValueOnce({ claimed: true, jobId: 'gdd-job', status: 'completed' });
    const authorized = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-secret' },
    }));
    expect(authorized.status).toBe(202);
    await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'resource', delayMs: 0 });
    expect(processResource).not.toHaveBeenCalled();
  });

  it('waits for a queued retry to become due before dispatching the next stage', async () => {
    availableAt.mockResolvedValueOnce({ data: { available_at: new Date(Date.now() + 5_000).toISOString() }, error: null });
    processGdd.mockResolvedValueOnce({ claimed: true, jobId: 'gdd-job', status: 'queued' });
    const response = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-secret' },
    }));
    expect(response.status).toBe(202);
    await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(serviceClient.from).toHaveBeenCalledWith('gdd_generation_jobs');
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'gdd', delayMs: expect.any(Number) });
    const delay = jest.mocked(dispatchGddWorker).mock.calls[0][0].delayMs;
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(6_000);
  });

  it('continues async resources and starts map artifacts after materialization', async () => {
    processResource.mockResolvedValueOnce({ claimed: true, jobId: 'resource-job', status: 'completed' });
    const response = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'resource' }),
    }));
    expect(response.status).toBe(202);
    await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(processResource).toHaveBeenCalledTimes(1);
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'resource', delayMs: 0 });
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'map', delayMs: 0 });
    expect(processMap).not.toHaveBeenCalled();
  });

  it('schedules an async resource retry at its database availability time', async () => {
    availableAt.mockResolvedValueOnce({ data: { available_at: new Date(Date.now() + 20_000).toISOString() }, error: null });
    processResource.mockResolvedValueOnce({ claimed: true, jobId: 'resource-job', status: 'queued' });
    await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
      method: 'POST', headers: { authorization: 'Bearer worker-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'resource' }),
    }));
    await (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(serviceClient.from).toHaveBeenCalledWith('gdd_resource_jobs');
    expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'resource', delayMs: expect.any(Number) });
    expect(jest.mocked(dispatchGddWorker).mock.calls[0][0].delayMs).toBeGreaterThan(0);
    expect(processMap).not.toHaveBeenCalled();
  });

  it('uses a delay-only invocation before the long-running worker invocation', async () => {
    jest.useFakeTimers();
    try {
      processMap.mockResolvedValueOnce({ claimed: false });
      const response = await POST(new NextRequest('https://example.test/api/internal/game-design-system-worker', {
        method: 'POST', headers: { authorization: 'Bearer worker-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'map', delayMs: 50 }),
      }));
      expect(response.status).toBe(202);
      const work = (jest.mocked(after).mock.calls[0][0] as () => Promise<void>)();
      expect(processMap).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(50);
      await work;
      expect(processMap).not.toHaveBeenCalled();
      expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'map', delayMs: 0 });
    } finally {
      jest.useRealTimers();
    }
  });
});
