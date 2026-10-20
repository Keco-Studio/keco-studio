jest.mock('server-only', () => ({}));
jest.mock('next/server', () => ({ after: jest.fn() }));
jest.mock('@/lib/game-design-system/worker', () => ({ processNextGameDesignSystemJob: jest.fn() }));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: jest.fn() }));

import { after } from 'next/server';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { wakeQueuedGameDesignSystemJob } from '@/lib/agent/gds-job-wake';

beforeEach(() => jest.clearAllMocks());

it('registers queued GDS work after the response, using a service client', async () => {
  const service = { from: jest.fn() };
  jest.mocked(getSupabaseServiceRoleClient).mockReturnValue(service as never);
  wakeQueuedGameDesignSystemJob('queued');
  expect(after).toHaveBeenCalledTimes(1);
  expect(processNextGameDesignSystemJob).not.toHaveBeenCalled();
  const callback = jest.mocked(after).mock.calls[0][0] as () => Promise<void>;
  await callback();
  expect(processNextGameDesignSystemJob).toHaveBeenCalledWith({
    serviceClient: service, workerId: expect.stringMatching(/^assistant-/),
  });
});

it('does not schedule completed or running jobs again', () => {
  wakeQueuedGameDesignSystemJob('completed');
  wakeQueuedGameDesignSystemJob('running');
  expect(after).not.toHaveBeenCalled();
});
