import { createHash } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import {
  createGameDesignSystemVersion,
  createGameDesignSystemGenerationJob,
  IdempotencyConflictError,
  claimGameDesignSystemGenerationJob,
  getGameDesignSystemDetail,
  getProjectGameDesignSystem,
  listGameDesignSystems,
  type GameDesignSystemVersion,
} from './gameDesignSystemService';
import { parseGameDesignDocument, parseRuleSet } from '@/lib/game-design-system/ruleSchema';

const ruleSet = parseRuleSet({
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle',
    title: 'Readable state',
    statement: 'Expose decision inputs.',
    appliesWhen: 'Presenting choices.',
    severity: 'required',
  }],
  tableGuidance: [],
});

const document = parseGameDesignDocument({
  designIntent: 'Make every tactical choice legible before the player commits.',
  playerFantasy: 'Lead a compact squad through risky, recoverable decisions.',
  coreLoop: 'Scout, commit, resolve consequences, then adapt the squad plan.',
  decisionStructure: 'Players trade immediate safety for positional advantage.',
  systemBoundaries: 'Hidden information may create uncertainty but never hide costs.',
  progressionEconomy: 'New tools widen options without invalidating early equipment.',
  contentModel: 'Encounters combine objectives, terrain pressure, and enemy roles.',
  difficultyBalance: 'Difficulty increases through decision pressure rather than stat inflation.',
  experiencePresentation: 'Show intent, costs, and state changes at the point of action.',
});

describe('gameDesignSystemService version and job behavior', () => {
  it('creates an immutable version through the atomic RPC with a deterministic diff', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        id: 'version-4',
        version_number: 4,
        rendered_markdown: String(args.p_rendered_markdown).replace(
          /^> Version: __KECO_ATOMIC_VERSION_LINE__$/m,
          '> Version: 4',
        ),
      },
      error: null,
    }));
    const parent = { rules: ruleSet } as GameDesignSystemVersion;
    const supabase = { rpc } as never;

    const created = await createGameDesignSystemVersion(supabase, {
      systemId: 'system-1',
      title: 'Tactical Rules',
      createdBy: 'user-1',
      document,
      rules: { ...ruleSet, rules: [...ruleSet.rules, { ...ruleSet.rules[0], id: 'visible-costs' }] },
      parentVersion: { ...parent, id: 'version-1' },
      sourceSnapshots: [],
    });

    expect(created.id).toBe('version-4');
    expect(created.document).toEqual(document);
    expect(created.rendered_markdown).toContain('> Version: 4');
    expect(created.rendered_markdown).toContain('## Design Intent & Player Fantasy');
    expect(created.rendered_markdown).toContain(document.designIntent);
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_system_id: 'system-1',
      p_parent_version_id: 'version-1',
      p_diff: expect.objectContaining({ added: ['visible-costs'], conflicts: [] }),
      p_created_by: 'user-1',
      p_generation_job_id: null,
      p_document: document,
      p_content_hash: createHash('sha256')
        .update(JSON.stringify({ document, rules: { ...ruleSet, rules: [...ruleSet.rules, { ...ruleSet.rules[0], id: 'visible-costs' }] } }))
        .digest('hex'),
      p_rendered_markdown: expect.stringContaining('> Version: __KECO_ATOMIC_VERSION_LINE__'),
    }));
  });

  it('starts a copied system at version 1 while retaining its external parent', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        id: 'copy-version-1',
        version_number: 1,
        rendered_markdown: String(args.p_rendered_markdown).replace(
          /^> Version: __KECO_ATOMIC_VERSION_LINE__$/m,
          '> Version: 1',
        ),
      },
      error: null,
    }));
    const externalParent = {
      id: 'official-version-8',
      system_id: 'official-system',
      version_number: 8,
      rules: ruleSet,
    } as GameDesignSystemVersion;

    const created = await createGameDesignSystemVersion({ rpc } as never, {
      systemId: 'personal-copy',
      title: 'Copied Rules',
      createdBy: 'user-1',
      rules: ruleSet,
      parentVersion: externalParent,
      sourceSnapshots: [],
    });

    expect(created.rendered_markdown).toContain('> Version: 1');
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_system_id: 'personal-copy',
      p_parent_version_id: 'official-version-8',
    }));
  });

  it('passes generation identity into atomic version creation', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: { id: 'generated-version', version_number: 1, rendered_markdown: args.p_rendered_markdown },
      error: null,
    }));

    await createGameDesignSystemVersion({ rpc } as never, {
      systemId: 'generated-system',
      title: 'Generated Rules',
      createdBy: 'user-1',
      rules: ruleSet,
      generationJobId: 'job-1',
    });

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_generation_job_id: 'job-1',
    }));
  });

  it('returns an existing job for the same idempotency payload', async () => {
    const existing = { id: 'job-1', input_hash: 'hash-a', status: 'queued' };
    const maybeSingle = jest.fn(async () => ({ data: existing, error: null }));
    const eqKey = jest.fn(() => ({ maybeSingle }));
    const eqOwner = jest.fn(() => ({ eq: eqKey }));
    const select = jest.fn(() => ({ eq: eqOwner }));
    const from = jest.fn(() => ({ select }));

    const job = await createGameDesignSystemGenerationJob({ from } as never, 'user-1', { title: 'Rules' } as never, {
      idempotencyKey: 'request-1',
      inputHash: 'hash-a',
    });
    expect(job).toBe(existing);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-1', input_hash: 'hash-a' }, error: null }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }));

    await expect(createGameDesignSystemGenerationJob({ from } as never, 'user-1', { title: 'Other' } as never, {
      idempotencyKey: 'request-1',
      inputHash: 'hash-b',
    })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('claims jobs only through the lease RPC', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ id: 'job-1', lease_owner: 'worker-1' }], error: null }));
    const job = await claimGameDesignSystemGenerationJob({ rpc } as never, 'worker-1');
    expect(job?.id).toBe('job-1');
    expect(rpc).toHaveBeenCalledWith('claim_game_design_system_generation_job', {
      p_worker_id: 'worker-1',
      p_lease_seconds: 90,
    });
  });

  it('returns only the pinned version and hydrates snapshots only for RLS-authorized version IDs', async () => {
    const system = {
      id: 'system-1', owner_id: 'author-1', source: 'user', title: 'Private system',
      current_version_id: 'version-3', migration_status: 'ready', body: '# Secret version 3',
    };
    const versions = [
      { id: 'version-3', system_id: 'system-1', version_number: 3, rules: ruleSet, rendered_markdown: '# Secret version 3' },
      { id: 'version-2', system_id: 'system-1', version_number: 2, rules: ruleSet, rendered_markdown: '# Pinned version 2' },
    ];
    const projectClient = {
      from: jest.fn((table: string) => {
        if (table === 'project_game_design_systems') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { design_system_id: 'system-1', version_id: 'version-2' }, error: null }) }) }) };
        }
        if (table === 'game_design_systems') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: system, error: null }) }) }) };
        }
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [versions[1]], error: null }) }) }) };
      }),
    };
    const snapshotIn = jest.fn(async (_column: string, _ids: string[]) => ({
      data: [
        { id: 'version-3', source_snapshots: [{ label: 'secret-v3' }] },
        { id: 'version-2', source_snapshots: [{ label: 'pinned-v2' }] },
      ],
      error: null,
    }));
    const snapshotClient = {
      from: jest.fn(() => ({ select: () => ({ in: snapshotIn }) })),
    };

    const detail = await getProjectGameDesignSystem(projectClient as never, 'project-1', { snapshotClient: snapshotClient as never });

    expect(detail?.current_version?.id).toBe('version-2');
    expect(detail?.versions.map((version) => version.id)).toEqual(['version-2']);
    expect(detail?.current_version?.source_snapshots).toEqual([{ label: 'pinned-v2' }]);
    expect(snapshotIn).toHaveBeenCalledWith('id', ['version-2']);
    expect(detail?.body).toBe('# Pinned version 2');
    expect(detail?.body).not.toContain('Secret version 3');
  });

  it('uses the newest readable pinned version when the owner current version is not visible', async () => {
    const system = {
      id: 'system-1', owner_id: 'author-1', source: 'user', title: 'Private system',
      current_version_id: 'version-3', migration_status: 'ready', body: '# Secret version 3',
    };
    const readableVersions = [
      { id: 'version-2', system_id: 'system-1', version_number: 2, rules: ruleSet, rendered_markdown: '# Pinned version 2' },
    ];
    const supabase = {
      from: jest.fn((table: string) => table === 'game_design_systems'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: system, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: async () => ({ data: readableVersions, error: null }) }) }) }),
    };

    const detail = await getGameDesignSystemDetail(supabase as never, 'system-1');

    expect(detail?.current_version?.id).toBe('version-2');
    expect(detail?.body).toBe('# Pinned version 2');
  });

  it('hydrates a compatibility document for a legacy version without one', async () => {
    const system = {
      id: 'system-1', owner_id: 'author-1', source: 'user', title: 'Legacy tactics', summary: 'A readable tactics system.',
      current_version_id: 'version-1', body: '# Legacy version', genres: [], philosophies: [], suitable_for: null,
    };
    const legacyVersion = {
      id: 'version-1', system_id: 'system-1', version_number: 1, document: null,
      rules: ruleSet, rendered_markdown: '# Legacy version',
    };
    const supabase = {
      from: jest.fn((table: string) => table === 'game_design_systems'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: system, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: async () => ({ data: [legacyVersion], error: null }) }) }) }),
    };

    const detail = await getGameDesignSystemDetail(supabase as never, 'system-1');

    expect(detail?.current_version?.document.designIntent).toContain('A readable tactics system.');
    expect(detail?.current_version?.document.designIntent).toContain('compatibility summary');
    expect(detail?.current_version?.document.coreLoop).toContain('did not store');
  });

  it('projects list metadata from the newest RLS-readable version instead of the system cache', async () => {
    const system = {
      id: 'system-1', owner_id: 'author-1', source: 'user', title: 'Private system',
      current_version_id: 'version-3', body: '', genres: [], philosophies: [], suitable_for: null,
    };
    const visibleRules = {
      ...ruleSet,
      genres: ['Pinned Genre'],
      philosophies: ['Pinned Philosophy'],
      suitableFor: 'Pinned audience',
    };
    const systemsOrder2 = jest.fn(async () => ({ data: [system], error: null }));
    const systemsOrder1 = jest.fn(() => ({ order: systemsOrder2 }));
    const versionOrder = jest.fn(async () => ({
      data: [{
        id: 'version-2', system_id: 'system-1', version_number: 2,
        rules: visibleRules, rendered_markdown: '# Pinned version 2',
      }],
      error: null,
    }));
    const supabase = {
      from: jest.fn((table: string) => table === 'game_design_systems'
        ? { select: () => ({ order: systemsOrder1 }) }
        : { select: () => ({ in: () => ({ order: versionOrder }) }) }),
    };

    const listed = await listGameDesignSystems(supabase as never);

    expect(listed[0]).toMatchObject({
      current_version_id: 'version-2',
      body: '# Pinned version 2',
      genres: ['Pinned Genre'],
      philosophies: ['Pinned Philosophy'],
      suitable_for: 'Pinned audience',
    });
  });
});
