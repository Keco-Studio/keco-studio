import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import { processClaimedGameDesignSystemJob } from './worker';
import { RuleSetGenerationValidationError } from '@/lib/gameDesignSystemGeneration';
import type { GameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{ id: 'readable-state', kind: 'principle' as const, title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' as const }],
  tableGuidance: [],
};

const job = {
  id: 'job-1', owner_id: 'user-1', status: 'running', phase: 'collecting', attempt_count: 1,
  input: { title: 'Rules', genres: [], philosophies: [], sourceSnapshots: [], referenceGames: [] },
} as unknown as GameDesignSystemGenerationJob;

describe('leased Game Design System worker', () => {
  it('heartbeats phases and completes only with the claimed lease', async () => {
    const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
    const complete = jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _output: unknown) => undefined);
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat,
      generate: jest.fn(async () => rules),
      createSystem: jest.fn(async () => ({ id: 'system-1', current_version_id: 'version-1' } as never)),
      complete,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const),
      fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    } as never);
    expect(result).toBe('completed');
    expect(heartbeat.mock.calls.map((call) => call[3])).toEqual(['generating', 'validating', 'saving']);
    expect(complete).toHaveBeenCalledWith(expect.anything(), job, 'worker-1', { systemId: 'system-1', versionId: 'version-1' });
  });

  it('renews the generating lease while a long model call is in flight', async () => {
    jest.useFakeTimers();
    try {
      const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
      let resolveGeneration: ((value: typeof rules) => void) | undefined;
      const generate = jest.fn(() => new Promise<typeof rules>((resolve) => { resolveGeneration = resolve; }));
      const processing = processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
        heartbeat,
        generate,
        createSystem: jest.fn(async () => ({ id: 'system-1', current_version_id: 'version-1' } as never)),
        complete: jest.fn(async () => undefined),
        retry: jest.fn(async () => 'queued' as const),
        fail: jest.fn(async () => undefined),
      } as never);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(heartbeat.mock.calls.filter((call) => call[3] === 'generating')).toHaveLength(2);
      resolveGeneration?.(rules);
      await processing;
    } finally {
      jest.useRealTimers();
    }
  });

  it('requeues retryable failures with bounded backoff', async () => {
    const retry = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const);
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined),
      generate: jest.fn(async () => { throw new Error('network unavailable'); }),
      createSystem: jest.fn(async () => ({}) as never),
      complete: jest.fn(async () => undefined),
      retry,
      fail: jest.fn(async () => undefined),
    } as never);
    expect(result).toBe('queued');
    expect(retry).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'network unavailable', 5);
  });

  it('fails strict validation errors without retrying', async () => {
    const fail = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined);
    const retry = jest.fn(async () => 'queued' as const);
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined),
      generate: jest.fn(async () => { throw new RuleSetGenerationValidationError('bad schema'); }),
      createSystem: jest.fn(async () => ({}) as never),
      complete: jest.fn(async () => undefined),
      retry,
      fail,
    } as never);
    expect(result).toBe('failed');
    expect(fail).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'bad schema');
    expect(retry).not.toHaveBeenCalled();
  });

  it('fails authorization errors without consuming retry attempts', async () => {
    const authorizationError = Object.assign(new Error('External parent is not allowed.'), { code: '42501' });
    const fail = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined);
    const retry = jest.fn(async () => 'queued' as const);
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined),
      generate: jest.fn(async () => rules),
      createSystem: jest.fn(async () => { throw authorizationError; }),
      complete: jest.fn(async () => undefined),
      retry,
      fail,
    } as never);

    expect(result).toBe('failed');
    expect(fail).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'External parent is not allowed.');
    expect(retry).not.toHaveBeenCalled();
  });
});
