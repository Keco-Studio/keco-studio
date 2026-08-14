import { describe, expect, it, jest } from '@jest/globals';
import {
  createGameDesignSystemVersion,
  createGameDesignSystemGenerationJob,
  IdempotencyConflictError,
  claimGameDesignSystemGenerationJob,
  type GameDesignSystemVersion,
} from './gameDesignSystemService';
import { parseRuleSet } from '@/lib/game-design-system/ruleSchema';

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
      rules: { ...ruleSet, rules: [...ruleSet.rules, { ...ruleSet.rules[0], id: 'visible-costs' }] },
      parentVersion: { ...parent, id: 'version-1' },
      sourceSnapshots: [],
    });

    expect(created.id).toBe('version-4');
    expect(created.rendered_markdown).toContain('> Version: 4');
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_system_id: 'system-1',
      p_parent_version_id: 'version-1',
      p_diff: expect.objectContaining({ added: ['visible-costs'], conflicts: [] }),
      p_created_by: 'user-1',
      p_generation_job_id: null,
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
});
