import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type RlsUser,
  type ProjectFixture,
} from './helpers/rlsTestClient';
import { getGameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';

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

describeDb('Game Design System pinned version visibility (live database)', () => {
  let fixture: ProjectFixture;
  let systemId = '';
  let pinnedVersionId = '';
  let latestVersionId = '';
  let officialSystemId = '';
  let officialVersionId = '';
  let pendingInvitee: RlsUser;

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
