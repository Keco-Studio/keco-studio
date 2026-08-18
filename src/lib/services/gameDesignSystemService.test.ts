import { createHash } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import {
  createGameDesignSystemVersion,
  createGameDesignSystem,
  createGameDesignSystemGenerationJob,
  copyGameDesignSystem,
  completeGameDesignSystemGenerationJob,
  IdempotencyConflictError,
  claimGameDesignSystemGenerationJob,
  getGameDesignSystemDetail,
  getGameDesignSystemVersionByGenerationJobId,
  getProjectGameDesignSystem,
  listGameDesignSystems,
  type GameDesignSystemVersion,
} from './gameDesignSystemService';
import { parseGameDesignDocument, parseRuleSet } from '@/lib/game-design-system/ruleSchema';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';

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

const artStyle = compileGameArtStyle({
  presetId: 'pixel-art',
  presetVersion: 2,
  customization: {
    direction: 'Bright readable routes.',
    referenceGames: [{ name: 'Eastward', borrow: 'Material clusters' }],
    avoid: 'No horror.',
  },
});

describe('gameDesignSystemService version and job behavior', () => {
  it('creates an immutable version through the atomic RPC with a deterministic diff', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        id: 'version-4',
        version_number: 4,
        document: args.p_document,
        rules: args.p_rules,
        art_style: args.p_art_style,
        rendered_markdown: String(args.p_rendered_markdown).replace(
          /^> Version: __KECO_ATOMIC_VERSION_LINE__$/m,
          '> Version: 4',
        ),
      },
      error: null,
    }));
    const parent = { rules: ruleSet, artStyle } as GameDesignSystemVersion;
    const supabase = { rpc } as never;

    const created = await createGameDesignSystemVersion(supabase, {
      systemId: 'system-1',
      title: 'Tactical Rules',
      createdBy: 'user-1',
      document,
      rules: { ...ruleSet, rules: [...ruleSet.rules, { ...ruleSet.rules[0], id: 'visible-costs' }] },
      parentVersion: { ...parent, id: 'version-1' },
      sourceSnapshots: [],
      expectedCurrentVersionId: 'version-1',
      idempotencyKey: 'a8b68831-7587-42a4-b7bf-d46f0ab9787b',
    });

    expect(created.id).toBe('version-4');
    expect(created.document).toEqual(document);
    expect(created.rendered_markdown).toContain('> Version: 4');
    expect(created.rendered_markdown).toContain('## Design Intent & Player Fantasy');
    expect(created.rendered_markdown).toContain(document.designIntent);
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_system_id: 'system-1',
      p_parent_version_id: 'version-1',
      p_diff: expect.objectContaining({
        schemaVersion: 2,
        added: ['visible-costs'],
        conflicts: [],
        artStyle: { change: 'unchanged' },
        ruleSetSettingsChanged: false,
        tableGuidanceChanged: false,
      }),
      p_created_by: 'user-1',
      p_generation_job_id: null,
      p_expected_current_version_id: 'version-1',
      p_idempotency_key: 'a8b68831-7587-42a4-b7bf-d46f0ab9787b',
      p_document: document,
      p_art_style: artStyle,
      p_inherit_art_style: false,
      p_content_hash: createHash('sha256')
        .update(JSON.stringify({ document, rules: { ...ruleSet, rules: [...ruleSet.rules, { ...ruleSet.rules[0], id: 'visible-costs' }] }, artStyle }))
        .digest('hex'),
      p_rendered_markdown: expect.stringContaining('> Version: __KECO_ATOMIC_VERSION_LINE__'),
    }));
  });

  it('starts a copied system at version 1 while retaining its external parent', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        id: 'copy-version-1',
        version_number: 1,
        document: args.p_document,
        rules: args.p_rules,
        art_style: args.p_art_style,
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
      artStyle,
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
      p_art_style: artStyle,
    }));
  });

  it('passes generation identity into atomic version creation', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: { id: 'generated-version', version_number: 1, document: args.p_document, rules: args.p_rules, art_style: args.p_art_style, rendered_markdown: args.p_rendered_markdown },
      error: null,
    }));

    await createGameDesignSystemVersion({ rpc } as never, {
      systemId: 'generated-system',
      title: 'Generated Rules',
      createdBy: 'user-1',
      rules: ruleSet,
      generationJobId: 'job-1',
      artStyle,
    });

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_generation_job_id: 'job-1',
      p_art_style: artStyle,
      p_expected_current_version_id: null,
      p_idempotency_key: null,
    }));
  });

  it('stores null for direct legacy creation without a parent style', async () => {
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: { id: 'legacy-version', version_number: 1, document: args.p_document, rules: args.p_rules, art_style: args.p_art_style, rendered_markdown: args.p_rendered_markdown },
      error: null,
    }));

    const created = await createGameDesignSystemVersion({ rpc } as never, {
      systemId: 'legacy-system',
      title: 'Legacy Rules',
      createdBy: 'user-1',
      rules: ruleSet,
    });

    expect(created.artStyle).toBeNull();
    expect(created.artStyleReadError).toBeNull();
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_art_style: null,
      p_content_hash: createHash('sha256').update(JSON.stringify({ document: created.document, rules: ruleSet, artStyle: null })).digest('hex'),
    }));
  });

  it('returns the persisted RPC art style without leaking the database column name', async () => {
    const persistedArtStyle = compileGameArtStyle({
      presetId: 'pixel-art',
      presetVersion: 2,
      customization: { direction: 'Persisted value.', referenceGames: [] },
    });
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        id: 'deduplicated-version',
        version_number: 1,
        document: args.p_document,
        rules: args.p_rules,
        art_style: persistedArtStyle,
        rendered_markdown: args.p_rendered_markdown,
      },
      error: null,
    }));

    const created = await createGameDesignSystemVersion({ rpc } as never, {
      systemId: 'generated-system',
      title: 'Generated Rules',
      createdBy: 'user-1',
      rules: ruleSet,
      artStyle,
      generationJobId: 'job-1',
    });

    expect(created.artStyle).toEqual(persistedArtStyle);
    expect(created.artStyleReadError).toBeNull();
    expect(created).not.toHaveProperty('art_style');
  });

  it('forwards art style while repairing an idempotent system without its version', async () => {
    const existingSystem = {
      id: 'generated-system', owner_id: 'user-1', source: 'user', title: 'Generated Rules',
      current_version_id: null,
    };
    const maybeSingle = jest.fn(async () => ({ data: existingSystem, error: null }));
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: { id: 'repaired-version', version_number: 1, document: args.p_document, rules: args.p_rules, art_style: args.p_art_style, rendered_markdown: args.p_rendered_markdown },
      error: null,
    }));
    const supabase = {
      from: jest.fn((table: string) => table === 'game_design_system_versions'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle }) }) }),
      rpc,
    };

    await createGameDesignSystem(supabase as never, 'user-1', {
      title: 'Generated Rules', genres: [], philosophies: [], rules: ruleSet,
      artStyle, generationJobId: 'job-1',
    });

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_art_style: artStyle,
      p_generation_job_id: 'job-1',
      p_expected_current_version_id: null,
      p_idempotency_key: null,
    }));
  });

  it('returns a sanitized generation replay handle', async () => {
    const maybeSingle = jest.fn(async () => ({
      data: { system_id: 'generated-system', id: 'generated-version', rules: { mustNotLeak: true } },
      error: null,
    }));
    const select = jest.fn((_columns: string) => ({ eq: () => ({ maybeSingle }) }));
    const from = jest.fn(() => ({ select }));

    const output = await getGameDesignSystemVersionByGenerationJobId({ from } as never, 'job-1');

    expect(select).toHaveBeenCalledWith('system_id,id');
    expect(output).toEqual({ systemId: 'generated-system', versionId: 'generated-version' });
    expect(output).not.toHaveProperty('rules');
  });

  it('projects generation replay from its original output instead of the current version', async () => {
    const generationJob = { output_version_id: 'version-original' };
    const system = {
      id: 'generated-system', owner_id: 'user-1', source: 'user', title: 'Generated Rules',
      summary: null, body: '# Current', genres: ['Current'], philosophies: ['Current'],
      suitable_for: 'Current', provenance: {}, status: 'draft', current_version_id: 'version-current',
      migration_status: 'ready', generation_job_id: 'job-1', created_at: '', updated_at: '',
    };
    const originalRules = {
      ...ruleSet,
      genres: ['Original'],
      philosophies: ['Original philosophy'],
      suitableFor: 'Original audience',
    };
    const originalVersion = {
      id: 'version-original', system_id: system.id, version_number: 1, parent_version_id: null,
      document, rules: originalRules, art_style: artStyle, rendered_markdown: '# Original output',
      source_snapshots: [], diff: { added: [], removed: [], changed: [], conflicts: [] },
      conflicts: [], content_hash: 'a'.repeat(64), created_by: 'user-1', created_at: '',
    };
    const from = jest.fn((table: string) => ({
      select: (columns: string) => ({
        eq: (column: string) => ({
          maybeSingle: async () => {
            if (table === 'game_design_systems') return { data: system, error: null };
            if (columns === 'system_id,id' && column === 'generation_job_id') {
              return { data: { system_id: system.id, id: originalVersion.id }, error: null };
            }
            return { data: originalVersion, error: null };
          },
        }),
      }),
    }));

    const replayed = await createGameDesignSystem({ from } as never, 'user-1', {
      title: 'Generated Rules', genres: [], philosophies: [], rules: ruleSet, generationJobId: 'job-1',
    });

    expect(replayed).toMatchObject({
      current_version_id: 'version-original',
      body: '# Original output',
      genres: ['Original'],
      philosophies: ['Original philosophy'],
      suitable_for: 'Original audience',
    });
    expect(generationJob.output_version_id).toBe('version-original');
    expect(from).not.toHaveBeenCalledWith('game_design_system_generation_jobs');
  });

  it('completes generation replay with the original output version', async () => {
    const job = { id: 'job-1', output_version_id: 'version-original' };
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-1' }, error: null }));
    const select = jest.fn(() => ({ maybeSingle }));
    const eqLease = jest.fn(() => ({ select }));
    const eqStatus = jest.fn(() => ({ eq: eqLease }));
    const eqId = jest.fn(() => ({ eq: eqStatus }));
    const update = jest.fn((_patch: Record<string, unknown>) => ({ eq: eqId }));
    const from = jest.fn(() => ({ update }));

    await completeGameDesignSystemGenerationJob({ from } as never, job as never, 'worker-1', {
      systemId: 'generated-system',
      versionId: 'version-original',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      design_system_id: 'generated-system',
      output_version_id: 'version-original',
    }));
    expect(job.output_version_id).toBe('version-original');
  });

  it('copies the current source version art style rather than historical style', async () => {
    const source = {
      id: 'source-system', owner_id: 'user-1', source: 'user', title: 'Source', summary: null,
      provenance: {}, current_version_id: 'version-2', migration_status: 'ready',
    } as never;
    const versions = [
      { id: 'version-2', system_id: 'source-system', version_number: 2, document, rules: ruleSet, art_style: artStyle, rendered_markdown: '# Current', source_snapshots: [], diff: { added: [], removed: [], changed: [], conflicts: [] }, conflicts: [] },
      { id: 'version-1', system_id: 'source-system', version_number: 1, document, rules: ruleSet, art_style: null, rendered_markdown: '# Historical', source_snapshots: [], diff: { added: [], removed: [], changed: [], conflicts: [] }, conflicts: [] },
    ];
    const copiedSystem = { id: 'copied-system', owner_id: 'user-1', source: 'user', title: 'Source (Copy)', current_version_id: null };
    const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: { id: 'copy-version', version_number: 1, document: args.p_document, rules: args.p_rules, art_style: args.p_art_style, rendered_markdown: args.p_rendered_markdown },
      error: null,
    }));
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'game_design_systems') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: source, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: copiedSystem, error: null }) }) }),
        };
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: versions, error: null }) }),
            in: async () => ({ data: versions.map((version) => ({ id: version.id, source_snapshots: [] })), error: null }),
          }),
        };
      }),
      rpc,
    };

    await copyGameDesignSystem(supabase as never, source, 'user-1');

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_parent_version_id: 'version-2',
      p_art_style: artStyle,
      p_expected_current_version_id: null,
      p_idempotency_key: null,
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
      rules: ruleSet, art_style: { schemaVersion: 999 }, rendered_markdown: '# Legacy version',
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
    expect(detail?.current_version?.artStyle).toBeNull();
    expect(detail?.current_version?.artStyleReadError).toEqual({ code: 'UNSUPPORTED_SNAPSHOT' });
    expect(detail?.current_version).not.toHaveProperty('art_style');
  });

  it('derives cross-domain changes for legacy diffs when their parent is readable', async () => {
    const system = {
      id: 'system-1', owner_id: 'author-1', source: 'user', title: 'Legacy tactics', summary: null,
      current_version_id: 'version-2', body: '# Version 2', genres: [], philosophies: [], suitable_for: null,
    };
    const parentDocument = { ...document, gameBackground: 'A quiet river settlement.' };
    const currentDocument = { ...document, gameBackground: 'A flooded river settlement.' };
    const legacyRuleDiff = {
      schemaVersion: 2,
      added: ['stored-addition'],
      unexpected: 'must not cross the read boundary',
    };
    const versions = [
      {
        id: 'version-2', system_id: 'system-1', version_number: 2, parent_version_id: 'version-1',
        document: currentDocument, rules: ruleSet, art_style: artStyle, rendered_markdown: '# Version 2', diff: legacyRuleDiff,
      },
      {
        id: 'version-1', system_id: 'system-1', version_number: 1, parent_version_id: null,
        document: parentDocument, rules: ruleSet, art_style: null, rendered_markdown: '# Version 1',
        diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] },
      },
    ];
    const supabase = {
      from: jest.fn((table: string) => table === 'game_design_systems'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: system, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: async () => ({ data: versions, error: null }) }) }) }),
    };

    const detail = await getGameDesignSystemDetail(supabase as never, 'system-1');

    expect(detail?.current_version?.diff).toMatchObject({
      schemaVersion: 2,
      added: ['stored-addition'],
      document: { changedSections: ['gameBackground'] },
      artStyle: { change: 'added' },
      ruleSetSettingsChanged: false,
      tableGuidanceChanged: false,
    });
    expect(detail?.current_version?.diff).not.toHaveProperty('unexpected');
    expect(detail?.versions[1].diff.document).toBe('not_recorded');
    expect(detail?.versions[1].diff.artStyle).toBe('not_recorded');
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
