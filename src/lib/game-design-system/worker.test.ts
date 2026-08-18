import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import { processClaimedGameDesignSystemJob } from './worker';
import { RuleSetGenerationValidationError } from '@/lib/gameDesignSystemGeneration';
import type { GameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{ id: 'readable-state', kind: 'principle' as const, title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' as const }],
  tableGuidance: [],
};

const document = {
  designIntent: 'Make tactical choices legible.',
  playerFantasy: 'Lead a squad through uncertain encounters.',
  coreLoop: 'Scout, commit, resolve, and adapt.',
  decisionStructure: 'Compare visible costs and risks.',
  systemBoundaries: 'Never conceal action costs.',
  progressionEconomy: 'Expand options without replacing judgment.',
  contentModel: 'Use reusable skills and encounters.',
  difficultyBalance: 'Increase situational complexity.',
  experiencePresentation: 'Preview and explain state changes.',
};

const generated = { document, rules };
const artStyle = compileGameArtStyle({
  presetId: 'pixel-art', presetVersion: 1,
  customization: { direction: 'Bright routes.', referenceGames: [], avoid: '' },
});

const job = {
  id: 'job-1', owner_id: 'user-1', status: 'running', phase: 'collecting', attempt_count: 1,
  input: { title: 'Rules', genres: [], philosophies: [], sourceSnapshots: [], referenceGames: [], artStyle },
} as unknown as GameDesignSystemGenerationJob;

describe('leased Game Design System worker', () => {
  it('heartbeats phases and completes only with the claimed lease', async () => {
    const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
    const findGenerationOutput = jest.fn(async () => null);
    const generate = jest.fn(async () => generated);
    const complete = jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _output: unknown) => undefined);
    const createSystem = jest.fn(async (_client: unknown, _ownerId: string, _input: unknown) => (
      { id: 'system-1', current_version_id: 'version-1' } as never
    ));
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      findGenerationOutput,
      heartbeat,
      generate,
      createSystem,
      complete,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const),
      fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    } as never);
    expect(result).toBe('completed');
    expect(findGenerationOutput.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]);
    expect(heartbeat.mock.calls.map((call) => call[3])).toEqual(['generating', 'validating', 'saving']);
    expect(createSystem).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({ document, rules, artStyle }));
    expect(complete).toHaveBeenCalledWith(expect.anything(), job, 'worker-1', { systemId: 'system-1', versionId: 'version-1' });
  });

  it('completes an existing generation output before any model or persistence call', async () => {
    const replayJob = { ...job, output_version_id: 'version-original' };
    const output = { systemId: 'system-original', versionId: 'version-original' };
    const findGenerationOutput = jest.fn(async (_client: unknown, _jobId: string) => output);
    const generate = jest.fn(async () => generated);
    const createSystem = jest.fn(async () => ({ id: 'system-new', current_version_id: 'version-new' } as never));
    const complete = jest.fn(async (
      _client: unknown,
      _job: unknown,
      _workerId: string,
      _output: { systemId: string; versionId: string },
    ) => undefined);
    const heartbeat = jest.fn(async () => undefined);

    const result = await processClaimedGameDesignSystemJob({
      serviceClient: {} as never,
      workerId: 'worker-1',
      job: replayJob,
    }, {
      findGenerationOutput,
      heartbeat,
      generate,
      createSystem,
      complete,
      retry: jest.fn(async () => 'queued' as const),
      fail: jest.fn(async () => undefined),
    } as never);

    expect(result).toBe('completed');
    expect(findGenerationOutput).toHaveBeenCalledWith(expect.anything(), 'job-1');
    expect(complete).toHaveBeenCalledWith(expect.anything(), replayJob, 'worker-1', output);
    expect(generate).not.toHaveBeenCalled();
    expect(createSystem).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(replayJob.output_version_id).toBe('version-original');
  });

  it('renews the generating lease while a long model call is in flight', async () => {
    jest.useFakeTimers();
    try {
      const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
      let resolveGeneration: ((value: typeof generated) => void) | undefined;
      const generate = jest.fn(() => new Promise<typeof generated>((resolve) => { resolveGeneration = resolve; }));
      const processing = processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
        findGenerationOutput: jest.fn(async () => null),
        heartbeat,
        generate,
        createSystem: jest.fn(async () => ({ id: 'system-1', current_version_id: 'version-1' } as never)),
        complete: jest.fn(async () => undefined),
        retry: jest.fn(async () => 'queued' as const),
        fail: jest.fn(async () => undefined),
      } as never);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(heartbeat.mock.calls.filter((call) => call[3] === 'generating')).toHaveLength(2);
      resolveGeneration?.(generated);
      await processing;
    } finally {
      jest.useRealTimers();
    }
  });

  it('requeues retryable failures with bounded backoff', async () => {
    const retry = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const);
    const result = await processClaimedGameDesignSystemJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      findGenerationOutput: jest.fn(async () => null),
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
      findGenerationOutput: jest.fn(async () => null),
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
      findGenerationOutput: jest.fn(async () => null),
      heartbeat: jest.fn(async () => undefined),
      generate: jest.fn(async () => generated),
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
