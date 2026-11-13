import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  TEST_PASSWORD,
  serviceClient,
  uniqueSuffix,
} from './helpers/rlsTestClient';

if (process.env.REQUIRE_RLS_DB_TESTS === '1' && !RLS_DB_TESTS_ENABLED) {
  throw new Error('REQUIRE_RLS_DB_TESTS=1 requires the local RLS database suite to be enabled.');
}

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('project template instantiation state (live database)', () => {
  let svc: SupabaseClient;
  const suffix = uniqueSuffix();
  let ownerId = '';
  const cleanupJobIds: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    const created = await svc.auth.admin.createUser({
      email: `template-instantiation-${suffix}@mailinator.com`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? 'owner creation failed');
    ownerId = created.data.user.id;
  }, 60_000);

  afterAll(async () => {
    if (!ownerId) return;
    const states = await svc.from('project_template_instantiations')
      .select('project_id,design_system_id').eq('owner_id', ownerId);
    for (const state of states.data ?? []) {
      if (state.project_id) await svc.from('projects').delete().eq('id', state.project_id);
      if (state.design_system_id) await svc.from('game_design_systems').delete().eq('id', state.design_system_id);
    }
    await svc.from('project_template_instantiations').delete().eq('owner_id', ownerId);
    if (cleanupJobIds.length > 0) {
      await svc.from('project_storage_cleanup_jobs').delete().in('id', cleanupJobIds);
    }
    await svc.from('project_storage_files').delete().eq('owner_id', ownerId);
    await svc.auth.admin.deleteUser(ownerId);
  }, 60_000);

  async function claim(requestId: string) {
    return svc.rpc('claim_project_template_instantiation', {
      p_owner_id: ownerId,
      p_request_id: requestId,
      p_template_key: 'tactical-deckbuilder',
      p_template_version: 1,
    });
  }

  async function createResources(label: string) {
    const project = await svc.from('projects').insert({
      owner_id: ownerId,
      name: `${label}-${suffix}-${randomUUID().slice(0, 6)}`,
      description: 'template state fixture',
    }).select('id').single();
    if (project.error || !project.data) throw new Error(project.error?.message ?? 'project creation failed');
    const folder = await svc.from('folders').insert({
      project_id: project.data.id,
      name: 'Project Files',
    }).select('id').single();
    if (folder.error || !folder.data) throw new Error(folder.error?.message ?? 'folder creation failed');
    const designSystem = await svc.from('game_design_systems').insert({
      owner_id: ownerId,
      source: 'user',
      title: `${label} GDS`,
      body: '# Fixture',
      status: 'draft',
    }).select('id').single();
    if (designSystem.error || !designSystem.data) throw new Error(designSystem.error?.message ?? 'GDS creation failed');
    return {
      projectId: String(project.data.id),
      folderId: String(folder.data.id),
      designSystemId: String(designSystem.data.id),
    };
  }

  it('lets the first claim win and replays completed resource IDs', async () => {
    const requestId = randomUUID();
    const first = await claim(requestId);
    expect(first.error).toBeNull();
    expect(first.data?.[0]).toMatchObject({ claimed: true, status: 'running' });

    const second = await claim(requestId);
    expect(second.error).toBeNull();
    expect(second.data?.[0]).toMatchObject({ claimed: false, status: 'running' });

    const resources = await createResources('completed-template');
    const instantiationId = String(first.data?.[0]?.id);
    const checkpoint = await svc.rpc('checkpoint_project_template_instantiation', {
      p_instantiation_id: instantiationId,
      p_owner_id: ownerId,
      p_project_id: resources.projectId,
      p_default_folder_id: resources.folderId,
      p_design_system_id: resources.designSystemId,
    });
    expect(checkpoint.error).toBeNull();
    const completed = await svc.rpc('complete_project_template_instantiation', {
      p_instantiation_id: instantiationId,
      p_owner_id: ownerId,
      p_project_id: resources.projectId,
      p_default_folder_id: resources.folderId,
      p_design_system_id: resources.designSystemId,
    });
    expect(completed.error).toBeNull();

    const replay = await claim(requestId);
    expect(replay.error).toBeNull();
    expect(replay.data?.[0]).toMatchObject({
      claimed: false,
      status: 'completed',
      project_id: resources.projectId,
      default_folder_id: resources.folderId,
      design_system_id: resources.designSystemId,
    });
  });

  it('reclaims a failed request only after it owns no resources', async () => {
    const requestId = randomUUID();
    const first = await claim(requestId);
    const failed = await svc.rpc('fail_project_template_instantiation', {
      p_instantiation_id: first.data?.[0]?.id,
      p_owner_id: ownerId,
      p_error_code: 'BASE_PROJECT_FAILED',
    });
    expect(failed.error).toBeNull();

    const reclaimed = await claim(requestId);
    expect(reclaimed.error).toBeNull();
    expect(reclaimed.data?.[0]).toMatchObject({ claimed: true, status: 'running' });
  });

  it('removes partial project and GDS state while preserving storage cleanup jobs', async () => {
    const requestId = randomUUID();
    const claimed = await claim(requestId);
    const resources = await createResources('cleanup-template');
    const checkpoint = await svc.rpc('checkpoint_project_template_instantiation', {
      p_instantiation_id: claimed.data?.[0]?.id,
      p_owner_id: ownerId,
      p_project_id: resources.projectId,
      p_default_folder_id: resources.folderId,
      p_design_system_id: resources.designSystemId,
    });
    expect(checkpoint.error).toBeNull();

    const objectPath = `${ownerId}/${resources.projectId}/template-fixture.png`;
    const file = await svc.from('project_storage_files').insert({
      project_id: resources.projectId,
      owner_id: ownerId,
      bucket_id: 'project-assets',
      object_path: objectPath,
      display_name: 'template-fixture.png',
      mime_type: 'image/png',
      size_bytes: 8,
      source_kind: 'project_asset',
      created_by: ownerId,
    });
    expect(file.error).toBeNull();

    const cleanup = await svc.rpc('cleanup_project_template_instantiation', {
      p_instantiation_id: claimed.data?.[0]?.id,
      p_owner_id: ownerId,
      p_error_code: 'ASSET_UPLOAD_FAILED',
    });
    expect(cleanup.error).toBeNull();
    expect(cleanup.data).toHaveLength(1);
    expect(cleanup.data?.[0]?.cleanup_job_id).toEqual(expect.any(String));
    cleanupJobIds.push(String(cleanup.data?.[0]?.cleanup_job_id));

    expect((await svc.from('projects').select('id').eq('id', resources.projectId)).data).toHaveLength(0);
    expect((await svc.from('game_design_systems').select('id').eq('id', resources.designSystemId)).data).toHaveLength(0);
    const job = await svc.from('project_storage_cleanup_jobs')
      .select('id,status').eq('id', cleanup.data?.[0]?.cleanup_job_id).single();
    expect(job.error).toBeNull();
    expect(job.data?.status).toBe('pending');
  });
});
