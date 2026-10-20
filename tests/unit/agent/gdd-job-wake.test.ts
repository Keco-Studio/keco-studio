jest.mock('server-only', () => ({}));
jest.mock('@/lib/gdd-generation/worker-dispatch', () => ({ dispatchGddWorker: jest.fn(), MAX_GDD_WORKER_DELAY_MS: 35_000 }));

import { dispatchGddWorker } from '@/lib/gdd-generation/worker-dispatch';
import { wakeQueuedGddJob } from '@/lib/agent/gdd-job-wake';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchGddWorker).mockResolvedValue(undefined);
});

it('dispatches a due queued GDD job to the long-running worker route', async () => {
  expect(await wakeQueuedGddJob({ status: 'queued' })).toBe('scheduled');
  expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'gdd', delayMs: 0 });
});

it('dispatches an eligible child worker through the same short request', async () => {
  expect(await wakeQueuedGddJob({ status: 'queued' }, 'resource')).toBe('scheduled');
  expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'resource', delayMs: 0 });
});

it('schedules a short retry wait and skips terminal jobs', async () => {
  expect(await wakeQueuedGddJob({ status: 'queued', availableAt: new Date(Date.now() + 5_000).toISOString() })).toBe('scheduled');
  expect(await wakeQueuedGddJob({ status: 'completed' })).toBe('not_needed');
  expect(dispatchGddWorker).toHaveBeenCalledWith({ kind: 'gdd', delayMs: expect.any(Number) });
});

it('reports a dispatch failure so the assistant does not claim the job was started', async () => {
  jest.mocked(dispatchGddWorker).mockRejectedValueOnce(new Error('connection failed'));
  expect(await wakeQueuedGddJob({ status: 'queued' })).toBe('failed');
});
