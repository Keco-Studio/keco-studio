import { NextRequest } from 'next/server';

const mockUser = { id: 'user-1' };
const mockSupabase = {
  from: jest.fn(),
  rpc: jest.fn(),
};
const mockGetServiceRoleClient = jest.fn(() => mockSupabase);
const mockResolveGameDesignSourceSnapshots = jest.fn();

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: (...args: any[]) => Promise<Response>) =>
    (request: NextRequest, context: unknown) => handler(request, context, { supabase: mockSupabase, user: mockUser }),
}));

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: mockGetServiceRoleClient }));
jest.mock('@/lib/game-design-system/worker', () => ({ processNextGameDesignSystemJob: jest.fn() }));
jest.mock('@/lib/game-design-system/sourceSnapshots', () => ({
  ...jest.requireActual('@/lib/game-design-system/sourceSnapshots'),
  resolveGameDesignSourceSnapshots: (...args: unknown[]) => mockResolveGameDesignSourceSnapshots(...args),
}));

import { PATCH as updateMetadata } from '@/app/api/game-design-systems/[id]/route';
import { POST as copySystem } from '@/app/api/game-design-systems/[id]/copy/route';
import { POST as createVersion } from '@/app/api/game-design-systems/[id]/versions/route';
import { POST as startGeneration } from '@/app/api/game-design-systems/generation-jobs/route';
import { PUT as applyProject } from '@/app/api/projects/[projectId]/game-design-system/route';
import { SourceSnapshotInputError } from '@/lib/game-design-system/sourceSnapshots';

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle' as const,
    title: 'Readable state',
    statement: 'Show all decision inputs.',
    appliesWhen: 'Presenting a choice.',
    severity: 'required' as const,
  }],
  tableGuidance: [],
};

const system = {
  id: '11111111-1111-4111-8111-111111111111',
  owner_id: 'user-1',
  source: 'user',
  title: 'Tactical Rules',
  summary: 'Summary',
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitable_for: 'Tactical games',
  body: '# Tactical Rules',
  provenance: {},
  status: 'draft',
  current_version_id: '22222222-2222-4222-8222-222222222222',
  migration_status: 'ready',
  generation_job_id: null,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
};

function query(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'in', 'update', 'insert', 'delete']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(async () => result);
  builder.maybeSingle = jest.fn(async () => result);
  builder.then = jest.fn((resolve, reject) => Promise.resolve(result).then(resolve, reject));
  return builder;
}

function request(url: string, init?: RequestInit) {
  return new NextRequest(`https://keco.test${url}`, init);
}

describe('Game Design System route contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockResolveGameDesignSourceSnapshots.mockResolvedValue([]);
  });

  it('requires an idempotency key and reports payload conflicts', async () => {
    const missing = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Rules', genres: ['RPG'], references: [], referenceGames: [] }),
    }), {});
    expect(missing.status).toBe(400);

    const jobs = query({ data: { id: 'job-1', input_hash: 'different-payload' }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_system_generation_jobs') return jobs;
      throw new Error(`Unexpected table ${table}`);
    });
    const conflict = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'stable-key-123' },
      body: JSON.stringify({ title: 'Rules', genres: ['RPG'], references: [], referenceGames: [] }),
    }), {});
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: 'Idempotency key was already used with a different payload.',
    });
    expect(mockGetServiceRoleClient).toHaveBeenCalled();
  });

  it('rejects multiline titles before generation or metadata mutation', async () => {
    const injectedTitle = 'Safe\n> Version: __KECO_ATOMIC_VERSION_LINE__';
    const generation = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'multiline-title-123' },
      body: JSON.stringify({ title: injectedTitle, genres: ['RPG'], references: [], referenceGames: [] }),
    }), {});
    const metadata = await updateMetadata(request(`/api/game-design-systems/${system.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: injectedTitle }),
    }), { params: Promise.resolve({ id: system.id }) });

    expect(generation.status).toBe(400);
    expect(metadata.status).toBe(400);
    await expect(generation.json()).resolves.toEqual(expect.objectContaining({ issues: expect.any(Object) }));
    await expect(metadata.json()).resolves.toEqual(expect.objectContaining({ issues: expect.any(Object) }));
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockGetServiceRoleClient).not.toHaveBeenCalled();
  });

  it('accepts a reference-game-only generation request', async () => {
    const jobs = query({ data: null, error: null });
    jobs.single.mockResolvedValue({
      data: {
        id: 'job-1',
        owner_id: mockUser.id,
        status: 'completed',
        phase: 'completed',
        input_hash: 'hash',
      },
      error: null,
    });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_system_generation_jobs') return jobs;
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reference-game-only' },
      body: JSON.stringify({
        title: 'Rules',
        genres: [],
        philosophies: [],
        references: [],
        referenceGames: [{ name: 'Into the Breach', reference: 'Readable intent', avoid: 'Direct copying' }],
      }),
    }), {});

    expect(response.status).toBe(202);
    expect(jobs.insert).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        referenceGames: [{ name: 'Into the Breach', reference: 'Readable intent', avoid: 'Direct copying' }],
      }),
    }));
  });

  it('reports aggregate source overflow against the references field', async () => {
    mockResolveGameDesignSourceSnapshots.mockRejectedValue(new SourceSnapshotInputError(
      'references',
      'Selected source excerpts exceed the 60,000 character limit.',
    ));

    const response = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'overflow-source-key' },
      body: JSON.stringify({
        title: 'Rules',
        genres: [],
        philosophies: [],
        references: [{
          kind: 'document',
          projectId: '11111111-1111-4111-8111-111111111111',
          resourceId: '22222222-2222-4222-8222-222222222222',
        }],
        referenceGames: [],
      }),
    }), {});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid generation request.',
      issues: {
        formErrors: [],
        fieldErrors: {
          references: ['Selected source excerpts exceed the 60,000 character limit.'],
        },
      },
    });
  });

  it('rejects a foreign private base system before enqueuing work', async () => {
    const privateBase = {
      ...system,
      id: '55555555-5555-4555-8555-555555555555',
      owner_id: 'user-2',
      current_version_id: '66666666-6666-4666-8666-666666666666',
    };
    const baseVersion = {
      id: privateBase.current_version_id,
      system_id: privateBase.id,
      version_number: 1,
      parent_version_id: null,
      rules,
      rendered_markdown: '# Private base',
      source_snapshots: [],
      diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: 'a'.repeat(64),
      created_by: 'user-2',
      created_at: '2026-08-14T00:00:00.000Z',
    };
    const systems = query({ data: privateBase, error: null });
    const versions = query({ data: [baseVersion], error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_systems') return systems;
      if (table === 'game_design_system_versions') return versions;
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await startGeneration(request('/api/game-design-systems/generation-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'foreign-private-base' },
      body: JSON.stringify({
        title: 'Derived rules',
        genres: [],
        philosophies: [],
        baseSystemId: privateBase.id,
        references: [],
        referenceGames: [],
      }),
    }), {});

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only official or owned Game Design Systems can be used as a base.',
    });
    expect(systems.insert).not.toHaveBeenCalled();
  });

  it('rejects body edits and permits metadata-only PATCH', async () => {
    const systems = query({ data: { ...system, summary: 'Updated summary' }, error: null });
    mockSupabase.from.mockReturnValue(systems);
    const params = { params: Promise.resolve({ id: system.id }) };

    const bodyEdit = await updateMetadata(request(`/api/game-design-systems/${system.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '# edited' }),
    }), params);
    expect(bodyEdit.status).toBe(400);
    expect(systems.update).not.toHaveBeenCalled();

    const metadataEdit = await updateMetadata(request(`/api/game-design-systems/${system.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: 'Updated summary' }),
    }), params);
    expect(metadataEdit.status).toBe(200);
    expect(systems.update).toHaveBeenCalledWith({ summary: 'Updated summary' });
  });

  it('does not copy a readable personal system owned by another user', async () => {
    const systems = query({ data: { ...system, owner_id: 'user-2' }, error: null });
    mockSupabase.from.mockReturnValue(systems);

    const response = await copySystem(request(`/api/game-design-systems/${system.id}/copy`, {
      method: 'POST',
    }), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only the owner can copy this Game Design System.',
    });
    expect(systems.insert).not.toHaveBeenCalled();
  });

  it('creates an immutable structured version for the owning user', async () => {
    const systems = query({ data: system, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_systems') return systems;
      throw new Error(`Unexpected table ${table}`);
    });
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        id: '33333333-3333-4333-8333-333333333333', system_id: system.id, version_number: 2,
        parent_version_id: null, rules, rendered_markdown: '# Tactical Rules', source_snapshots: [],
        diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] }, conflicts: [],
        content_hash: 'a'.repeat(64), created_by: 'user-1', created_at: '2026-08-14T00:00:00.000Z',
      }],
      error: null,
    });
    const response = await createVersion(request(`/api/game-design-systems/${system.id}/versions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules }),
    }), { params: Promise.resolve({ id: system.id }) });
    expect(response.status).toBe(201);
    expect(mockGetServiceRoleClient).toHaveBeenCalled();
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_system_id: system.id,
      p_parent_version_id: null,
      p_rules: rules,
    }));
  });

  it('rejects a rule ID reintroduced after deletion in the selected parent lineage', async () => {
    const retainedRule = {
      ...rules.rules[0],
      id: 'retained-rule',
      title: 'Retained rule',
    };
    const deletedRule = {
      ...rules.rules[0],
      id: 'deleted-rule',
      title: 'Deleted rule',
    };
    const versionOne = {
      id: '33333333-3333-4333-8333-333333333333',
      system_id: system.id,
      version_number: 1,
      parent_version_id: null,
      rules: { ...rules, rules: [retainedRule, deletedRule] },
      rendered_markdown: '# Version 1',
      source_snapshots: [],
      diff: { added: ['deleted-rule', 'retained-rule'], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: 'a'.repeat(64),
      created_by: mockUser.id,
      created_at: '2026-08-14T00:00:00.000Z',
    };
    const versionTwo = {
      ...versionOne,
      id: '44444444-4444-4444-8444-444444444444',
      version_number: 2,
      parent_version_id: versionOne.id,
      rules: { ...rules, rules: [retainedRule] },
      rendered_markdown: '# Version 2',
      diff: { added: [], removed: ['deleted-rule'], changed: [], conflicts: [] },
    };
    const systems = query({ data: system, error: null });
    const parent = query({ data: versionTwo, error: null });
    const ancestor = query({ data: versionOne, error: null });
    let versionQueryCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_systems') return systems;
      if (table === 'game_design_system_versions') {
        versionQueryCount += 1;
        return versionQueryCount === 1 ? parent : ancestor;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await createVersion(request(`/api/game-design-systems/${system.id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentVersionId: versionTwo.id,
        rules: { ...rules, rules: [retainedRule, deletedRule] },
      }),
    }), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Rule IDs cannot be reintroduced after deletion.',
      ruleIds: ['deleted-rule'],
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('checks delete-then-readd ambiguity across an external parent lineage', async () => {
    const retainedRule = { ...rules.rules[0], id: 'retained-rule', title: 'Retained rule' };
    const deletedRule = { ...rules.rules[0], id: 'external-deleted-rule', title: 'External deleted rule' };
    const externalVersion = {
      id: '77777777-7777-4777-8777-777777777777',
      system_id: '88888888-8888-4888-8888-888888888888',
      version_number: 7,
      parent_version_id: null,
      rules: { ...rules, rules: [retainedRule, deletedRule] },
      rendered_markdown: '# External version',
      source_snapshots: [],
      diff: { added: ['external-deleted-rule', 'retained-rule'], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: 'b'.repeat(64),
      created_by: null,
      created_at: '2026-08-14T00:00:00.000Z',
    };
    const childParent = {
      ...externalVersion,
      id: '99999999-9999-4999-8999-999999999999',
      system_id: system.id,
      version_number: 1,
      parent_version_id: externalVersion.id,
      rules: { ...rules, rules: [retainedRule] },
      rendered_markdown: '# Child version',
      diff: { added: [], removed: ['external-deleted-rule'], changed: [], conflicts: [] },
      created_by: mockUser.id,
    };
    const systems = query({ data: system, error: null });
    const parent = query({ data: childParent, error: null });
    const externalOrChildList = query({ data: externalVersion, error: null });
    externalOrChildList.then.mockImplementation((resolve, reject) =>
      Promise.resolve({ data: [childParent], error: null }).then(resolve, reject));
    let versionQueryCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'game_design_systems') return systems;
      if (table === 'game_design_system_versions') {
        versionQueryCount += 1;
        return versionQueryCount === 1 ? parent : externalOrChildList;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await createVersion(request(`/api/game-design-systems/${system.id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentVersionId: childParent.id,
        rules: { ...rules, rules: [retainedRule, deletedRule] },
      }),
    }), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Rule IDs cannot be reintroduced after deletion.',
      ruleIds: ['external-deleted-rule'],
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 for editor binding attempts', async () => {
    const projects = query({ data: { owner_id: 'owner-2' }, error: null });
    const collaborators = query({ data: { role: 'editor', accepted_at: '2026-08-14T00:00:00.000Z' }, error: null });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projects;
      if (table === 'project_collaborators') return collaborators;
      throw new Error(`Unexpected table ${table}`);
    });
    const response = await applyProject(request('/api/projects/project-1/game-design-system', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: system.id, versionId: system.current_version_id }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only project owners and admins can change the Game Design System.',
    });
  });

  it('binds an owner project to the explicit conflict-free version', async () => {
    const projects = query({ data: { owner_id: 'user-1' }, error: null });
    const collaborators = query({ data: null, error: null });
    const versions = query({ data: { id: system.current_version_id, system_id: system.id, conflicts: [] }, error: null });
    const bindings = query({ data: null, error: null });
    bindings.upsert = jest.fn(async () => ({ data: null, error: null }));
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projects;
      if (table === 'project_collaborators') return collaborators;
      if (table === 'game_design_system_versions') return versions;
      if (table === 'project_game_design_systems') return bindings;
      throw new Error(`Unexpected table ${table}`);
    });
    const response = await applyProject(request('/api/projects/project-1/game-design-system', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: system.id, versionId: system.current_version_id }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) });
    expect(response.status).toBe(200);
    expect(bindings.upsert).toHaveBeenCalledWith({
      project_id: 'project-1', design_system_id: system.id, version_id: system.current_version_id, applied_by: 'user-1',
    }, { onConflict: 'project_id' });
  });
});
