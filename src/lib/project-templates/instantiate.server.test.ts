import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import {
  instantiateProjectTemplate,
  ProjectTemplateInProgressError,
  type ProjectTemplateInstantiationDependencies,
} from './instantiate.server';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ROOT_FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const INSTANTIATION_ID = '33333333-3333-4333-8333-333333333333';
const GDS_ID = '44444444-4444-4444-8444-444444444444';
const GDS_VERSION_ID = '55555555-5555-4555-8555-555555555555';

const project = {
  id: PROJECT_ID,
  owner_id: USER_ID,
  name: 'Harbor Signal',
  description: 'A tactical deckbuilder.',
  genres: [],
  design_philosophies: [],
  created_at: '2026-11-13T00:00:00.000Z',
  updated_at: '2026-11-13T00:00:00.000Z',
};

function dependencies(input: {
  claim?: Record<string, unknown>;
  failAt?: string;
} = {}) {
  const events: string[] = [];
  const rowUpdates = new Map<string, Record<string, unknown>>();
  const verificationInputs: Array<Record<string, unknown>> = [];
  const cleanup = jest.fn(async (_input: Record<string, unknown>) => ({ cleanupJobIds: ['cleanup-job'] }));
  const processCleanupJob = jest.fn(async (_cleanupJobId: string) => undefined);
  const dependency: ProjectTemplateInstantiationDependencies = {
    claim: async ({ templateKey, templateVersion }) => {
      events.push(`claim:${templateKey}@${templateVersion}`);
      return {
        id: INSTANTIATION_ID,
        claimed: true,
        status: 'running',
        projectId: null,
        defaultFolderId: null,
        designSystemId: null,
        ...input.claim,
      } as never;
    },
    createBlankProject: async () => {
      events.push('project:create');
      if (input.failAt === 'project') throw new Error('project failed');
      return { project, defaultFolderId: ROOT_FOLDER_ID };
    },
    checkpoint: async (state) => {
      events.push(`checkpoint:${state.designSystemId ? 'gds' : 'project'}`);
    },
    createFolder: async ({ key }) => {
      events.push(`folder:create:${key}`);
      return `db-folder-${key}`;
    },
    createTable: async ({ key }) => {
      events.push(`table:create:${key}`);
      if (input.failAt === `table:${key}`) throw new Error('table failed');
      return `db-table-${key}`;
    },
    createField: async ({ tableKey, field }) => {
      events.push(`field:create:${tableKey}.${field.key}`);
      return `db-field-${tableKey}-${field.key}`;
    },
    createRow: async ({ tableKey, row, values }) => {
      events.push(`row:create:${tableKey}.${row.key}`);
      rowUpdates.set(row.key, values);
      return `db-row-${row.key.replace(/^\w+\./, '')}`;
    },
    updateRow: async ({ row, values }) => {
      events.push(`row:update:${row.key}`);
      rowUpdates.set(row.key, values);
    },
    createGdd: async () => {
      events.push('gdd:create');
      return 'db-gdd';
    },
    createGds: async () => {
      events.push('gds:create');
      if (input.failAt === 'gds') throw new Error('gds failed');
      return { id: GDS_ID, currentVersionId: GDS_VERSION_ID };
    },
    bindGds: async () => { events.push('gds:bind'); },
    activateAssetsWorkspace: async () => { events.push('assets:activate'); },
    readAssetBytes: async ({ fileName }) => {
      events.push(`asset:read:${fileName}`);
      return Buffer.from(fileName);
    },
    uploadAsset: async ({ descriptor }) => {
      events.push(`asset:upload:${descriptor.key}`);
      if (input.failAt === `asset:${descriptor.key}`) throw new Error('asset failed');
      return `db-${descriptor.key}`;
    },
    verify: async (verifyInput) => {
      verificationInputs.push(verifyInput);
      events.push('verify');
    },
    complete: async () => { events.push('complete'); },
    fetchCompletedProject: async () => ({ project, defaultFolderId: ROOT_FOLDER_ID }),
    cleanup,
    processCleanupJob,
  };
  return { dependency, events, rowUpdates, verificationInputs, cleanup, processCleanupJob };
}

function instantiate(dependency: ProjectTemplateInstantiationDependencies) {
  return instantiateProjectTemplate({
    authClient: {} as never,
    serviceClient: {} as never,
    userId: USER_ID,
    requestId: REQUEST_ID,
    templateKey: 'tactical-deckbuilder',
    name: project.name,
    description: project.description,
  }, dependency);
}

describe('instantiateProjectTemplate', () => {
  it('creates all linked starter resources in deterministic phases', async () => {
    const { dependency, events, rowUpdates, verificationInputs } = dependencies();

    await expect(instantiate(dependency)).resolves.toEqual({ project, defaultFolderId: ROOT_FOLDER_ID });

    expect(events.slice(0, 6)).toEqual([
      'claim:tactical-deckbuilder@1',
      'project:create',
      'checkpoint:project',
      'folder:create:game-design',
      'folder:create:cards-combat',
      'folder:create:content',
    ]);
    expect(events.filter((event) => event.startsWith('table:create:'))).toHaveLength(6);
    expect(events.filter((event) => event.startsWith('row:create:'))).toHaveLength(30);
    expect(events).not.toContain('assets:activate');
    expect(events.some((event) => event.startsWith('asset:read:'))).toBe(false);
    expect(events.some((event) => event.startsWith('asset:upload:'))).toBe(false);
    expect(events.indexOf('gdd:create')).toBeGreaterThan(events.lastIndexOf('row:update:reward.elite-bounty'));
    expect(events.indexOf('gds:create')).toBeGreaterThan(events.indexOf('gdd:create'));
    expect(events.slice(-2)).toEqual(['verify', 'complete']);
    expect(verificationInputs).toEqual([expect.objectContaining({
      expectedAssetCount: 0,
      expectAssetsWorkspaceEnabled: false,
    })]);

    expect(rowUpdates.get('hero.cinder-warden')).toMatchObject({
      'db-field-heroes-startingDeck': [
        'db-row-ember-lance',
        'db-row-ash-guard',
        'db-row-kindle',
      ],
    });
  });

  it('returns the recorded project for a completed replay', async () => {
    const { dependency, events } = dependencies({ claim: {
      claimed: false,
      status: 'completed',
      projectId: PROJECT_ID,
      defaultFolderId: ROOT_FOLDER_ID,
      designSystemId: GDS_ID,
    } });

    await expect(instantiate(dependency)).resolves.toEqual({ project, defaultFolderId: ROOT_FOLDER_ID });
    expect(events).toEqual(['claim:tactical-deckbuilder@1']);
  });

  it('rejects a duplicate request that is still running', async () => {
    const { dependency } = dependencies({ claim: { claimed: false, status: 'running' } });

    await expect(instantiate(dependency)).rejects.toBeInstanceOf(ProjectTemplateInProgressError);
  });

  it.each([
    ['table:cards'],
    ['gds'],
  ])('compensates a partial project when %s fails', async (failAt) => {
    const { dependency, cleanup, processCleanupJob } = dependencies({ failAt });

    await expect(instantiate(dependency)).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({
      instantiationId: INSTANTIATION_ID,
      ownerId: USER_ID,
    }));
    expect(processCleanupJob).toHaveBeenCalledWith('cleanup-job');
  });
});
