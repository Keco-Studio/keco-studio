import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type RlsUser,
  type ProjectFixture,
} from './helpers/rlsTestClient';
import { getGameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';
import { randomUUID } from 'node:crypto';

if (process.env.REQUIRE_RLS_DB_TESTS === '1' && !RLS_DB_TESTS_ENABLED) {
  throw new Error('REQUIRE_RLS_DB_TESTS=1 requires the local RLS database suite to be enabled.');
}

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

const rules = {
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
};

function versionRpcArgs(input: {
  systemId: string;
  ownerId: string;
  label: string;
  hashCharacter: string;
  parentVersionId?: string | null;
  expectedCurrentVersionId?: string | null;
  idempotencyKey?: string | null;
  generationJobId?: string | null;
  versionRules?: typeof rules;
}) {
  return {
    p_system_id: input.systemId,
    p_parent_version_id: input.parentVersionId ?? null,
    p_document: null,
    p_art_style: null,
    p_rules: input.versionRules ?? rules,
    p_rendered_markdown: `# ${input.label}\n\n> Version: __KECO_ATOMIC_VERSION_LINE__`,
    p_source_snapshots: [],
    p_diff: { added: [], removed: [], changed: [], conflicts: [] },
    p_conflicts: [],
    p_content_hash: input.hashCharacter.repeat(64),
    p_created_by: input.ownerId,
    p_generation_job_id: input.generationJobId ?? null,
    p_expected_current_version_id: input.expectedCurrentVersionId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  };
}

function versionIdFromRpc(data: unknown): string {
  const row = Array.isArray(data) ? data[0] : data;
  return String((row as { id?: unknown } | null)?.id ?? '');
}

describeDb('Game Design System pinned version visibility (live database)', () => {
  let fixture: ProjectFixture;
  let systemId = '';
  let pinnedVersionId = '';
  let latestVersionId = '';
  let officialSystemId = '';
  let officialVersionId = '';
  let pendingInvitee: RlsUser;
  const casSystemIds: string[] = [];
  const generationJobIds: string[] = [];

  async function createCasSystem(generationJobId?: string): Promise<string> {
    const created = await fixture.svc.from('game_design_systems').insert({
      owner_id: fixture.outsider.id,
      source: 'user',
      title: `cas-system-${randomUUID()}`,
      summary: null,
      genres: [],
      philosophies: [],
      suitable_for: null,
      body: '',
      status: 'draft',
      generation_job_id: generationJobId ?? null,
    }).select('id').single();
    if (created.error || !created.data) throw new Error(`create CAS system failed: ${created.error?.message}`);
    const id = String(created.data.id);
    casSystemIds.push(id);
    return id;
  }

  beforeAll(async () => {
    fixture = await buildProjectFixture();
    pendingInvitee = await createConfirmedOutsider(fixture, 'pending-version-reader');
    const pendingInvite = await fixture.svc.from('project_collaborators').insert({
      project_id: fixture.projectId,
      user_id: pendingInvitee.id,
      role: 'viewer',
      invited_by: fixture.owner.id,
      accepted_at: null,
    });
    if (pendingInvite.error) throw new Error(`create pending invite failed: ${pendingInvite.error.message}`);
    const system = await fixture.svc.from('game_design_systems').insert({
      owner_id: fixture.outsider.id,
      source: 'user',
      title: `private-system-${fixture.suffix}`,
      summary: 'Private evolving rules',
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitable_for: 'Tactical games',
      body: '# Private system',
      status: 'draft',
    }).select('id').single();
    if (system.error || !system.data) throw new Error(`create system failed: ${system.error?.message}`);
    systemId = system.data.id as string;

    const versions = await fixture.svc.from('game_design_system_versions').insert([1, 2, 3].map((versionNumber) => ({
      system_id: systemId,
      version_number: versionNumber,
      rules,
      rendered_markdown: `# Version ${versionNumber}`,
      source_snapshots: [],
      diff: { added: [], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: String(versionNumber).repeat(64),
      created_by: fixture.outsider.id,
    }))).select('id,version_number');
    if (versions.error || !versions.data) throw new Error(`create versions failed: ${versions.error?.message}`);
    pinnedVersionId = String(versions.data.find((version) => version.version_number === 2)?.id ?? '');
    latestVersionId = String(versions.data.find((version) => version.version_number === 3)?.id ?? '');
    if (!pinnedVersionId || !latestVersionId) throw new Error('version fixture IDs missing');

    const current = await fixture.svc.from('game_design_systems').update({ current_version_id: latestVersionId }).eq('id', systemId);
    if (current.error) throw new Error(`set current version failed: ${current.error.message}`);
    const binding = await fixture.svc.from('project_game_design_systems').insert({
      project_id: fixture.projectId,
      design_system_id: systemId,
      version_id: pinnedVersionId,
      applied_by: fixture.owner.id,
    });
    if (binding.error) throw new Error(`create binding failed: ${binding.error.message}`);

    const officialSystem = await fixture.svc.from('game_design_systems').insert({
      source: 'official',
      title: `official-system-${fixture.suffix}`,
      summary: 'Ephemeral official visibility fixture',
      body: '# Official system',
      status: 'published',
    }).select('id').single();
    if (officialSystem.error || !officialSystem.data) {
      throw new Error(`create official system failed: ${officialSystem.error?.message}`);
    }
    officialSystemId = officialSystem.data.id as string;
    const officialVersion = await fixture.svc.from('game_design_system_versions').insert({
      system_id: officialSystemId,
      version_number: 1,
      rules,
      rendered_markdown: '# Official version 1',
      source_snapshots: [],
      diff: { added: [], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: 'f'.repeat(64),
    }).select('id').single();
    if (officialVersion.error || !officialVersion.data) {
      throw new Error(`create official version failed: ${officialVersion.error?.message}`);
    }
    officialVersionId = officialVersion.data.id as string;
    const officialCurrent = await fixture.svc.from('game_design_systems')
      .update({ current_version_id: officialVersionId })
      .eq('id', officialSystemId);
    if (officialCurrent.error) throw new Error(`set official version failed: ${officialCurrent.error.message}`);
  }, 120_000);

  afterAll(async () => {
    if (fixture && systemId) {
      await fixture.svc.from('project_game_design_systems').delete().eq('project_id', fixture.projectId);
      await fixture.svc.from('game_design_systems').delete().eq('id', systemId);
    }
    if (fixture && officialSystemId) {
      await fixture.svc.from('game_design_systems').delete().eq('id', officialSystemId);
    }
    if (fixture && casSystemIds.length > 0) {
      await fixture.svc.from('game_design_systems').delete().in('id', casSystemIds);
    }
    if (fixture && generationJobIds.length > 0) {
      await fixture.svc.from('game_design_system_generation_jobs').delete().in('id', generationJobIds);
    }
    if (fixture) await teardownProjectFixture(fixture);
  }, 60_000);

  it('lets project members read only the pinned version while the system owner can read every version', async () => {
    const memberRead = await fixture.viewer.client.from('game_design_system_versions')
      .select('id,version_number').eq('system_id', systemId).order('version_number');
    expect(memberRead.error).toBeNull();
    expect(memberRead.data).toEqual([{ id: pinnedVersionId, version_number: 2 }]);

    const systemRead = await fixture.viewer.client.from('game_design_systems')
      .select('body,genres,philosophies,suitable_for').eq('id', systemId).single();
    expect(systemRead.error).toBeNull();
    expect(systemRead.data).toMatchObject({
      body: '',
      genres: [],
      philosophies: [],
      suitable_for: null,
    });

    const ownerRead = await fixture.outsider.client.from('game_design_system_versions')
      .select('id,version_number').eq('system_id', systemId).order('version_number');
    expect(ownerRead.error).toBeNull();
    expect(ownerRead.data?.map((version) => version.version_number)).toEqual([1, 2, 3]);
  });

  it('does not grant pinned-version visibility to an unaccepted invitee', async () => {
    const read = await pendingInvitee.client.from('game_design_system_versions')
      .select('id').eq('system_id', systemId);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
  });

  it('lets an unrelated authenticated user read every version of an official system', async () => {
    const expected = await fixture.svc.from('game_design_system_versions')
      .select('id,version_number')
      .eq('system_id', officialSystemId)
      .order('version_number');
    expect(expected.error).toBeNull();
    expect(expected.data).toEqual([{ id: officialVersionId, version_number: 1 }]);

    const unrelatedRead = await fixture.outsider.client.from('game_design_system_versions')
      .select('id,version_number')
      .eq('system_id', officialSystemId)
      .order('version_number');
    expect(unrelatedRead.error).toBeNull();
    expect(unrelatedRead.data).toEqual(expected.data);
  });

  it('enforces owner/admin binding authorization and keeps generation jobs service-owned', async () => {
    const editorUpdate = await fixture.editor.client
      .from('project_game_design_systems')
      .update({ applied_by: fixture.editor.id })
      .eq('project_id', fixture.projectId)
      .select('project_id');
    expect(editorUpdate.error).toBeNull();
    expect(editorUpdate.data).toEqual([]);

    const adminUpdate = await fixture.admin.client
      .from('project_game_design_systems')
      .update({ applied_by: fixture.admin.id })
      .eq('project_id', fixture.projectId)
      .select('project_id');
    expect(adminUpdate.error).toBeNull();
    expect(adminUpdate.data).toEqual([{ project_id: fixture.projectId }]);

    const ownerUpdate = await fixture.owner.client
      .from('project_game_design_systems')
      .update({ applied_by: fixture.owner.id })
      .eq('project_id', fixture.projectId)
      .select('project_id');
    expect(ownerUpdate.error).toBeNull();
    expect(ownerUpdate.data).toEqual([{ project_id: fixture.projectId }]);

    const unauthorizedClaim = await fixture.owner.client.rpc(
      'claim_game_design_system_generation_job',
      { p_worker_id: 'authenticated-client', p_lease_seconds: 90 },
    );
    expect(unauthorizedClaim.data).toBeNull();
    expect(unauthorizedClaim.error).not.toBeNull();
  });

  it('allows only one concurrent write for distinct keys with the same expected current version', async () => {
    const casSystemId = await createCasSystem();
    const initial = await fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
      systemId: casSystemId,
      ownerId: fixture.outsider.id,
      label: 'CAS initial',
      hashCharacter: '1',
    }));
    expect(initial.error).toBeNull();
    const initialVersionId = versionIdFromRpc(initial.data);
    expect(initialVersionId).not.toBe('');

    const shared = {
      systemId: casSystemId,
      ownerId: fixture.outsider.id,
      parentVersionId: initialVersionId,
      expectedCurrentVersionId: initialVersionId,
    };
    const results = await Promise.all([
      fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
        ...shared,
        label: 'CAS first contender',
        hashCharacter: '2',
        idempotencyKey: randomUUID(),
      })),
      fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
        ...shared,
        label: 'CAS second contender',
        hashCharacter: '3',
        idempotencyKey: randomUUID(),
      })),
    ]);

    const successes = results.filter((result) => result.error === null);
    const failures = results.filter((result) => result.error !== null);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error?.message).toContain('VERSION_STALE');
    const versions = await fixture.svc.from('game_design_system_versions')
      .select('id').eq('system_id', casSystemId);
    expect(versions.error).toBeNull();
    expect(versions.data).toHaveLength(2);
  });

  it('returns the same version for concurrent replay of one idempotency key', async () => {
    const casSystemId = await createCasSystem();
    const idempotencyKey = randomUUID();
    const args = versionRpcArgs({
      systemId: casSystemId,
      ownerId: fixture.outsider.id,
      label: 'Idempotent concurrent output',
      hashCharacter: '4',
      idempotencyKey,
    });

    const results = await Promise.all([
      fixture.svc.rpc('create_game_design_system_version', args),
      fixture.svc.rpc('create_game_design_system_version', args),
    ]);

    expect(results.map((result) => result.error)).toEqual([null, null]);
    const versionIds = results.map((result) => versionIdFromRpc(result.data));
    expect(versionIds[0]).not.toBe('');
    expect(versionIds[1]).toBe(versionIds[0]);
    const versions = await fixture.svc.from('game_design_system_versions')
      .select('id,idempotency_key').eq('system_id', casSystemId);
    expect(versions.error).toBeNull();
    expect(versions.data).toEqual([{ id: versionIds[0], idempotency_key: idempotencyKey }]);
  });

  it('returns the original generation output after current advances without persistence side effects', async () => {
    const job = await fixture.svc.from('game_design_system_generation_jobs').insert({
      owner_id: fixture.outsider.id,
      input: { title: 'Generation replay fixture' },
      status: 'running',
      phase: 'saving',
      lease_owner: 'live-test-worker',
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single();
    if (job.error || !job.data) throw new Error(`create generation job failed: ${job.error?.message}`);
    const generationJobId = String(job.data.id);
    generationJobIds.push(generationJobId);
    const generatedSystemId = await createCasSystem(generationJobId);

    const original = await fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
      systemId: generatedSystemId,
      ownerId: fixture.outsider.id,
      label: 'Original generation output',
      hashCharacter: '5',
      generationJobId,
    }));
    expect(original.error).toBeNull();
    const originalVersionId = versionIdFromRpc(original.data);
    const completed = await fixture.svc.from('game_design_system_generation_jobs').update({
      status: 'completed',
      phase: 'completed',
      design_system_id: generatedSystemId,
      output_version_id: originalVersionId,
      lease_owner: null,
      lease_expires_at: null,
    }).eq('id', generationJobId);
    expect(completed.error).toBeNull();

    const advancedRules = {
      ...rules,
      genres: ['Advanced genre'],
      philosophies: ['Advanced philosophy'],
      suitableFor: 'Advanced audience',
    };
    const advanced = await fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
      systemId: generatedSystemId,
      ownerId: fixture.outsider.id,
      label: 'Advanced current output',
      hashCharacter: '6',
      parentVersionId: originalVersionId,
      expectedCurrentVersionId: originalVersionId,
      idempotencyKey: randomUUID(),
      versionRules: advancedRules,
    }));
    expect(advanced.error).toBeNull();
    const advancedVersionId = versionIdFromRpc(advanced.data);

    const beforeSystem = await fixture.svc.from('game_design_systems')
      .select('current_version_id,body,genres,philosophies,suitable_for')
      .eq('id', generatedSystemId).single();
    const beforeVersions = await fixture.svc.from('game_design_system_versions')
      .select('id', { count: 'exact' }).eq('system_id', generatedSystemId);
    const beforeJob = await fixture.svc.from('game_design_system_generation_jobs')
      .select('output_version_id').eq('id', generationJobId).single();
    expect(beforeSystem.error).toBeNull();
    expect(beforeSystem.data).toMatchObject({
      current_version_id: advancedVersionId,
      body: '',
      genres: [],
      philosophies: [],
      suitable_for: null,
    });
    expect(beforeVersions.count).toBe(2);
    expect(beforeJob.data?.output_version_id).toBe(originalVersionId);

    const replay = await fixture.svc.rpc('create_game_design_system_version', versionRpcArgs({
      systemId: generatedSystemId,
      ownerId: fixture.outsider.id,
      label: 'Must not be persisted',
      hashCharacter: '7',
      generationJobId,
      expectedCurrentVersionId: null,
    }));
    expect(replay.error).toBeNull();
    expect(versionIdFromRpc(replay.data)).toBe(originalVersionId);

    const afterSystem = await fixture.svc.from('game_design_systems')
      .select('current_version_id,body,genres,philosophies,suitable_for')
      .eq('id', generatedSystemId).single();
    const afterVersions = await fixture.svc.from('game_design_system_versions')
      .select('id', { count: 'exact' }).eq('system_id', generatedSystemId);
    const afterJob = await fixture.svc.from('game_design_system_generation_jobs')
      .select('output_version_id').eq('id', generationJobId).single();
    expect(afterSystem.data).toEqual(beforeSystem.data);
    expect(afterVersions.count).toBe(beforeVersions.count);
    expect(afterVersions.data).toEqual(beforeVersions.data);
    expect(afterJob.data).toEqual(beforeJob.data);
  });

  it('does not expose the obsolete no-CAS RPC signature after schema refresh', async () => {
    const casSystemId = await createCasSystem();
    const oldArgs = versionRpcArgs({
      systemId: casSystemId,
      ownerId: fixture.outsider.id,
      label: 'Obsolete signature',
      hashCharacter: '8',
    }) as Record<string, unknown>;
    delete oldArgs.p_expected_current_version_id;
    delete oldArgs.p_idempotency_key;

    const obsolete = await fixture.svc.rpc('create_game_design_system_version', oldArgs);

    expect(obsolete.data).toBeNull();
    expect(obsolete.error?.code).toBe('PGRST202');
  });

  it('builds a non-owner API detail from the pinned version without widening through snapshot hydration', async () => {
    const detail = await getGameDesignSystemDetail(fixture.viewer.client, systemId, {
      snapshotClient: fixture.svc,
    });

    expect(detail?.versions.map((version) => version.id)).toEqual([pinnedVersionId]);
    expect(detail?.current_version?.id).toBe(pinnedVersionId);
    expect(detail?.body).toBe('# Version 2');
    expect(detail?.body).not.toContain('Version 3');
  });
});
