import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { initialize: jest.fn(async () => undefined) },
}));
import { processClaimedGddJob } from './worker';
import { GddGenerationValidationError, type GddGenerationInput, type GeneratedGdd } from '@/lib/gddGeneration';
import type { GddGenerationJob } from '@/lib/services/gddGenerationService';

const generationInput: GddGenerationInput = {
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Harbor Tactics',
  designSystemId: '22222222-2222-4222-8222-222222222222',
  versionId: '33333333-3333-4333-8333-333333333333',
  versionNumber: 1,
  systemTitle: 'Tactical Systems',
  designDocument: {
    designIntent: 'Readable choices.', playerFantasy: 'Lead a squad.', coreLoop: 'Scout and act.',
    decisionStructure: 'Compare costs.', systemBoundaries: 'Show costs.', progressionEconomy: 'Expand choices.',
    contentModel: 'Reusable entities.', difficultyBalance: 'Add pressure.', experiencePresentation: 'Explain changes.',
  },
  rules: {
    schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable Systems'], suitableFor: 'Tactical games',
    rules: [{ id: 'readable-state', kind: 'principle', title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' }],
    tableGuidance: [],
  },
  projectSources: [],
};

const generated: GeneratedGdd = {
  title: 'Harbor Tactics GDD', overview: 'Overview.', designIntent: 'Intent.', playerFantasy: 'Fantasy.',
  coreLoop: 'Loop.', decisionStructure: 'Decisions.', gameplaySystems: 'Systems.', contentModel: 'Content.',
  progressionEconomy: 'Progression.', difficultyBalance: 'Difficulty.', narrativeWorld: 'World.',
  experiencePresentation: 'Presentation.', productionTables: [], assumptions: ['Single-player.'],
  appliedRuleIds: ['readable-state'], omittedRuleIds: [],
};

const job = {
  id: 'job-1', owner_id: 'user-1', project_id: generationInput.projectId,
  design_system_id: generationInput.designSystemId, version_id: generationInput.versionId,
  status: 'running', phase: 'collecting', attempt_count: 1, input: generationInput,
} as unknown as GddGenerationJob;

describe('GDD generation worker', () => {
  it('generates, saves a new Document, and completes the leased job', async () => {
    const heartbeat = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined);
    const complete = jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _output: unknown) => undefined);
    const createDocument = jest.fn(async (_client: unknown, _job: unknown, _gdd: unknown, _markdown: string) => ({ id: 'document-1', name: 'Game Design Document - Draft' }));
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat, generate: jest.fn(async () => generated), createDocument, complete,
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const),
      fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('completed');
    expect(heartbeat.mock.calls.map((call) => call[3])).toEqual(['generating', 'validating', 'saving']);
    expect(createDocument).toHaveBeenCalledWith(expect.anything(), job, generated, expect.stringContaining('## Assumptions to Confirm'));
    expect(complete).toHaveBeenCalledWith(expect.anything(), job, 'worker-1', {
      documentId: 'document-1', documentName: 'Game Design Document - Draft',
      appliedRuleIds: ['readable-state'], omittedRuleIds: [],
    });
  });

  it('requeues retryable model failures', async () => {
    const retry = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const);
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined), generate: jest.fn(async () => { throw new Error('network'); }),
      createDocument: jest.fn(async (_client: unknown, _job: unknown, _gdd: unknown, _markdown: string) => ({ id: 'unused', name: 'unused' })),
      complete: jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _output: unknown) => undefined),
      retry, fail: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined),
    });
    expect(result).toBe('queued');
    expect(retry).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'network', 5);
  });

  it('fails permanent schema errors without creating a Document', async () => {
    const fail = jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string) => undefined);
    const createDocument = jest.fn(async (_client: unknown, _job: unknown, _gdd: unknown, _markdown: string) => ({ id: 'unused', name: 'unused' }));
    const result = await processClaimedGddJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _phase: string) => undefined),
      generate: jest.fn(async () => { throw new GddGenerationValidationError('bad GDD'); }),
      createDocument,
      complete: jest.fn(async (_client: unknown, _job: unknown, _workerId: string, _output: unknown) => undefined),
      retry: jest.fn(async (_client: unknown, _jobId: string, _workerId: string, _error: string, _delay: number) => 'queued' as const), fail,
    });
    expect(result).toBe('failed');
    expect(createDocument).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'bad GDD');
  });
});
