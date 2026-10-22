-- GDD map generation predates immutable V3 Plan snapshots. Create and save
-- Plan V1 before promoting the initial revision to generating.

create or replace function public.prepare_gdd_map_artifact(
  p_artifact_id uuid,
  p_worker_id text,
  p_plan jsonb,
  p_scene jsonb,
  p_generation_id uuid,
  p_plan_fingerprint text
)
returns table(map_id uuid, generation_revision_id uuid, draft_revision_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_document public.documents%rowtype;
  v_map_id uuid := gen_random_uuid();
  v_generation_revision_id uuid := gen_random_uuid();
  v_draft_revision_id uuid := gen_random_uuid();
  v_plan_version_id uuid := gen_random_uuid();
  v_asset_id uuid := gen_random_uuid();
  v_generation_params jsonb;
begin
  select artifact.* into v_artifact
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id
    and artifact.status = 'running'
    and artifact.phase = 'planning'
    and artifact.lease_owner = p_worker_id
    and artifact.lease_expires_at >= now()
  for update;
  if not found then
    raise exception 'GDD map artifact lease was lost' using errcode = 'P0002';
  end if;

  if p_generation_id is null or p_plan_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid GDD map generation identity' using errcode = '22023';
  end if;
  perform public.map_validate_v3_payload(p_plan, p_scene);

  perform 1 from public.projects as project
  where project.id = v_artifact.project_id and project.owner_id = v_artifact.owner_id
  for share;
  if not found then
    perform 1 from public.project_collaborators as collaborator
    where collaborator.project_id = v_artifact.project_id
      and collaborator.user_id = v_artifact.owner_id
      and collaborator.role in ('admin', 'editor')
      and collaborator.accepted_at is not null
    for share;
    if not found then
      raise exception 'GDD map generation permission is no longer valid' using errcode = '42501';
    end if;
  end if;

  select document.* into v_document
  from public.documents as document
  where document.id = v_artifact.gdd_document_id
    and document.project_id = v_artifact.project_id
    and (
      document.gdd_generation_job_id = v_artifact.gdd_generation_job_id
      or document.gdd_generation_job_id is null
      or exists (
        select 1 from public.gdd_generation_jobs as job
        where job.id = v_artifact.gdd_generation_job_id
          and job.output_document_id = document.id
      )
    )
  for share;
  if not found then
    raise exception 'GDD map source Document is no longer valid' using errcode = 'P0002';
  end if;

  insert into public.map_projects (id, project_id, name, created_by)
  values (v_map_id, v_artifact.project_id, btrim(p_plan ->> 'name'), v_artifact.owner_id);

  -- An immutable Plan must point at a draft save. This initial draft becomes
  -- the generating revision once Plan V1 has been captured.
  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_generation_revision_id, v_map_id, 1, 0, null,
    v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    3, p_plan, p_scene, 'draft', v_artifact.owner_id
  );

  update public.map_projects
  set current_revision_id = v_generation_revision_id, updated_at = now()
  where id = v_map_id;

  insert into public.map_plan_versions (
    id, map_project_id, plan_version_number, draft_revision_id, draft_save_version,
    plan, source_document_id, source_document_updated_at, source_epoch, source_revision,
    created_by
  ) values (
    v_plan_version_id, v_map_id, 1, v_generation_revision_id, 0,
    p_plan, v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    v_artifact.owner_id
  );

  update public.map_revisions
  set status = 'generating', plan_version_id = v_plan_version_id
  where id = v_generation_revision_id;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_draft_revision_id, v_map_id, 2, 0, v_generation_revision_id,
    v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    3, p_plan, p_scene, 'draft', v_artifact.owner_id
  );

  update public.map_projects
  set current_revision_id = v_draft_revision_id, updated_at = now()
  where id = v_map_id;

  v_generation_params := jsonb_build_object(
    'width', (p_plan #>> '{map,width}')::integer,
    'height', (p_plan #>> '{map,height}')::integer,
    'noBackground', false,
    'seed', p_plan #> '{generation,seed}',
    'references', p_plan -> 'references',
    'styleReference', p_plan -> 'styleReference'
  );

  insert into public.map_assets (
    id, map_revision_id, generation_id, asset_key, kind, status,
    requested_capability, prompt, generation_params, reference_asset_ids,
    reference_hashes, plan_fingerprint, metadata
  ) values (
    v_asset_id, v_generation_revision_id, p_generation_id, 'map-image', 'map_image', 'planned',
    'direct_map_image', p_plan ->> 'description', v_generation_params, '{}'::uuid[],
    '{}'::text[], p_plan_fingerprint, jsonb_build_object(
      'source', 'gdd-generation',
      'gddMapArtifactId', v_artifact.id,
      'gddGenerationJobId', v_artifact.gdd_generation_job_id
    )
  );

  update public.gdd_map_artifacts as artifact
  set status = 'queued',
      phase = 'submitting',
      map_project_id = v_map_id,
      map_revision_id = v_generation_revision_id,
      map_asset_id = v_asset_id,
      generation_id = p_generation_id,
      plan_fingerprint = p_plan_fingerprint,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = null
  where artifact.id = v_artifact.id;

  return query select v_map_id, v_generation_revision_id, v_draft_revision_id, v_asset_id;
end;
$$;

notify pgrst, 'reload schema';
