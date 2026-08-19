-- Durable map-image child jobs generated from completed GDD Documents.

alter table public.gdd_generation_jobs
  drop constraint if exists gdd_generation_jobs_status_check,
  drop constraint if exists gdd_generation_jobs_phase_check;

alter table public.gdd_generation_jobs
  add constraint gdd_generation_jobs_status_check check (status in (
    'queued', 'running', 'waiting_for_maps', 'completed',
    'completed_with_map_failures', 'failed'
  )),
  add constraint gdd_generation_jobs_phase_check check (phase in (
    'collecting', 'planning', 'generating_core', 'generating_systems',
    'generating_content', 'reviewing', 'repairing', 'saving',
    'generating', 'validating', 'compiling_maps', 'generating_maps',
    'finalizing_maps', 'completed', 'failed'
  ));

create table public.gdd_map_artifacts (
  id uuid primary key,
  gdd_generation_job_id uuid not null references public.gdd_generation_jobs(id) on delete cascade,
  gdd_document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  version_id uuid not null references public.game_design_system_versions(id) on delete restrict,
  map_brief_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  map_brief jsonb not null check (
    jsonb_typeof(map_brief) = 'object'
    and pg_catalog.octet_length(map_brief::text) <= 32000
  ),
  style_contract jsonb check (
    style_contract is null
    or (jsonb_typeof(style_contract) = 'object' and pg_catalog.octet_length(style_contract::text) <= 16000)
  ),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'blocked')),
  phase text not null default 'planning' check (phase in (
    'planning', 'submitting', 'polling', 'validating', 'ready', 'failed', 'blocked'
  )),
  map_project_id uuid references public.map_projects(id) on delete set null,
  map_revision_id uuid references public.map_revisions(id) on delete set null,
  map_asset_id uuid references public.map_assets(id) on delete set null,
  generation_id uuid,
  plan_fingerprint text check (plan_fingerprint is null or plan_fingerprint ~ '^[a-f0-9]{64}$'),
  error text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gdd_generation_job_id, map_brief_id)
);

create index gdd_map_artifacts_claim_idx
  on public.gdd_map_artifacts(status, available_at, lease_expires_at, created_at);
create index gdd_map_artifacts_job_idx
  on public.gdd_map_artifacts(gdd_generation_job_id, created_at, id);
create index gdd_map_artifacts_project_idx
  on public.gdd_map_artifacts(project_id, created_at desc);
create unique index gdd_map_artifacts_asset_idx
  on public.gdd_map_artifacts(map_asset_id) where map_asset_id is not null;

create trigger gdd_map_artifacts_updated_at
  before update on public.gdd_map_artifacts
  for each row execute function public.update_updated_at_column();

alter table public.gdd_map_artifacts enable row level security;

create policy gdd_map_artifacts_select_policy on public.gdd_map_artifacts
  for select using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid()))
  );

revoke all on public.gdd_map_artifacts from public, anon, authenticated;
grant select (
  id,
  gdd_generation_job_id,
  gdd_document_id,
  project_id,
  map_brief_id,
  title,
  status,
  phase,
  map_project_id,
  map_revision_id,
  map_asset_id,
  error,
  completed_at,
  created_at,
  updated_at
) on public.gdd_map_artifacts to authenticated;
grant select, insert, update, delete on public.gdd_map_artifacts to service_role;

create function public.claim_gdd_map_artifact(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.gdd_map_artifacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact_id uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;

  select artifact.id into v_artifact_id
  from public.gdd_map_artifacts as artifact
  where artifact.attempt_count < artifact.max_attempts
    and (
      (artifact.status = 'queued' and artifact.available_at <= now())
      or (artifact.status = 'running' and artifact.lease_expires_at < now())
    )
    and (
      select count(*)
      from public.gdd_map_artifacts as sibling
      where sibling.gdd_generation_job_id = artifact.gdd_generation_job_id
        and sibling.status = 'running'
        and sibling.lease_expires_at >= now()
    ) < 2
  order by artifact.available_at, artifact.created_at, artifact.id
  for update skip locked
  limit 1;

  if v_artifact_id is null then return; end if;

  return query
  update public.gdd_map_artifacts as artifact
  set status = 'running',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      started_at = coalesce(artifact.started_at, now()),
      completed_at = null
  where artifact.id = v_artifact_id
  returning artifact.*;
end;
$$;

create function public.prepare_gdd_map_artifact(
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
    and document.gdd_generation_job_id = v_artifact.gdd_generation_job_id
  for share;
  if not found then
    raise exception 'GDD map source Document is no longer valid' using errcode = 'P0002';
  end if;

  insert into public.map_projects (id, project_id, name, created_by)
  values (v_map_id, v_artifact.project_id, btrim(p_plan ->> 'name'), v_artifact.owner_id);

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_generation_revision_id, v_map_id, 1, 0, null,
    v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    3, p_plan, p_scene, 'generating', v_artifact.owner_id
  );

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

create function public.reschedule_gdd_map_artifact(
  p_artifact_id uuid,
  p_worker_id text,
  p_phase text,
  p_delay_seconds integer,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_phase not in ('planning', 'submitting', 'polling', 'validating') then
    raise exception 'invalid GDD map phase' using errcode = '22023';
  end if;

  update public.gdd_map_artifacts as artifact
  set attempt_count = artifact.attempt_count + case when p_error is null then 0 else 1 end,
      status = case
        when p_error is not null and artifact.attempt_count + 1 >= artifact.max_attempts then 'failed'
        else 'queued'
      end,
      phase = case
        when p_error is not null and artifact.attempt_count + 1 >= artifact.max_attempts then 'failed'
        else p_phase
      end,
      available_at = now() + make_interval(secs => greatest(0, p_delay_seconds)),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      completed_at = case
        when p_error is not null and artifact.attempt_count + 1 >= artifact.max_attempts then now()
        else null
      end,
      error = case when p_error is null then null else left(p_error, 1000) end
  where artifact.id = p_artifact_id
    and artifact.status = 'running'
    and artifact.lease_owner = p_worker_id
    and artifact.lease_expires_at >= now()
  returning artifact.status into v_status;
  return v_status;
end;
$$;

create function public.finish_gdd_map_artifact(
  p_artifact_id uuid,
  p_worker_id text,
  p_status text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_parent_status text;
begin
  if p_status not in ('ready', 'failed', 'blocked') then
    raise exception 'invalid terminal GDD map status' using errcode = '22023';
  end if;

  update public.gdd_map_artifacts as artifact
  set status = p_status,
      phase = p_status,
      error = case when p_status = 'ready' then null else left(coalesce(p_error, 'Map generation failed'), 1000) end,
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null
  where artifact.id = p_artifact_id
    and artifact.status = 'running'
    and artifact.lease_owner = p_worker_id
    and artifact.lease_expires_at >= now()
  returning artifact.* into v_artifact;
  if not found then
    raise exception 'GDD map artifact lease was lost' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.gdd_map_artifacts as sibling
    where sibling.gdd_generation_job_id = v_artifact.gdd_generation_job_id
      and sibling.status in ('queued', 'running')
  ) then
    v_parent_status := case when exists (
      select 1 from public.gdd_map_artifacts as sibling
      where sibling.gdd_generation_job_id = v_artifact.gdd_generation_job_id
        and sibling.status in ('failed', 'blocked')
    ) then 'completed_with_map_failures' else 'completed' end;

    update public.gdd_generation_jobs
    set status = v_parent_status,
        phase = 'completed',
        completed_at = now(),
        error = null
    where id = v_artifact.gdd_generation_job_id
      and status = 'waiting_for_maps';
  end if;
  return v_parent_status;
end;
$$;

create function public.persist_gdd_generation_with_maps(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_map_artifacts jsonb,
  p_map_compilation_failed boolean default false
)
returns table(document_id uuid, document_name text, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document_id uuid;
  v_document_name text;
  v_project_name text;
  v_base_name text;
  v_suffix integer := 1;
  v_map_count integer;
  v_artifact jsonb;
  v_status text;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'GDD generation metadata must be an object' using errcode = '22023';
  end if;
  if p_map_artifacts is null or jsonb_typeof(p_map_artifacts) <> 'array' then
    raise exception 'GDD map artifacts must be an array' using errcode = '22023';
  end if;
  v_map_count := jsonb_array_length(p_map_artifacts);
  if v_map_count > 3 then
    raise exception 'A GDD may generate at most three maps' using errcode = '22023';
  end if;
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at >= now()
  for update;
  if not found then
    raise exception 'GDD generation job lease was lost' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_job.project_id::text, 0));

  perform 1 from public.projects as project
  where project.id = v_job.project_id and project.owner_id = v_job.owner_id
  for share;
  if not found then
    perform 1 from public.project_collaborators as collaborator
    where collaborator.project_id = v_job.project_id
      and collaborator.user_id = v_job.owner_id
      and collaborator.role in ('admin', 'editor')
      and collaborator.accepted_at is not null
    for share;
    if not found then
      raise exception 'GDD generation permission is no longer valid' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.project_game_design_systems as binding
  where binding.project_id = v_job.project_id
    and binding.design_system_id = v_job.design_system_id
    and binding.version_id = v_job.version_id
  for share;
  if not found then
    raise exception 'GDD generation binding is no longer valid' using errcode = 'P0002';
  end if;

  select btrim(project.name) into v_project_name
  from public.projects as project where project.id = v_job.project_id for share;
  if v_project_name is null or v_project_name = '' then
    raise exception 'GDD generation project was not found' using errcode = 'P0002';
  end if;
  v_base_name := v_project_name || ' gdd';

  select document.id, document.name into v_document_id, v_document_name
  from public.documents as document
  where document.gdd_generation_job_id = v_job.id
  for update;

  if v_document_id is null then
    v_document_name := v_base_name;
    while exists (
      select 1 from public.documents as document
      where document.project_id = v_job.project_id and document.name = v_document_name
    ) loop
      v_suffix := v_suffix + 1;
      v_document_name := v_base_name || ' (' || v_suffix::text || ')';
    end loop;

    insert into public.documents (
      project_id, folder_id, name, description, content, yjs_state, created_by,
      gdd_generation_job_id, gdd_generation_metadata
    ) values (
      v_job.project_id, null, v_document_name, left(coalesce(p_description, ''), 250),
      p_markdown, p_yjs_state, v_job.owner_id, v_job.id, p_metadata
    ) returning id into v_document_id;
  else
    update public.documents as document
    set content = p_markdown,
        yjs_state = p_yjs_state,
        description = left(coalesce(p_description, ''), 250),
        gdd_generation_metadata = p_metadata
    where document.id = v_document_id;
  end if;

  for v_artifact in select value from jsonb_array_elements(p_map_artifacts) loop
    if jsonb_typeof(v_artifact) <> 'object'
      or coalesce(v_artifact ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_artifact ->> 'mapBriefId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not (char_length(btrim(coalesce(v_artifact ->> 'title', ''))) between 1 and 160)
      or jsonb_typeof(v_artifact -> 'mapBrief') is distinct from 'object'
      or jsonb_typeof(v_artifact -> 'styleContract') not in ('null', 'object')
      or coalesce(v_artifact ->> 'inputHash', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid GDD map artifact payload' using errcode = '22023';
    end if;

    insert into public.gdd_map_artifacts (
      id, gdd_generation_job_id, gdd_document_id, project_id, owner_id,
      design_system_id, version_id, map_brief_id, title, map_brief,
      style_contract, input_hash
    ) values (
      (v_artifact ->> 'id')::uuid, v_job.id, v_document_id, v_job.project_id,
      v_job.owner_id, v_job.design_system_id, v_job.version_id,
      (v_artifact ->> 'mapBriefId')::uuid, btrim(v_artifact ->> 'title'),
      v_artifact -> 'mapBrief', v_artifact -> 'styleContract', v_artifact ->> 'inputHash'
    ) on conflict (gdd_generation_job_id, map_brief_id) do nothing;
  end loop;

  v_status := case
    when p_map_compilation_failed then 'completed_with_map_failures'
    when v_map_count = 0 then 'completed'
    else 'waiting_for_maps'
  end;

  update public.gdd_generation_jobs as job
  set status = v_status,
      phase = case when v_status = 'waiting_for_maps' then 'generating_maps' else 'completed' end,
      output_document_id = v_document_id,
      output_document_name = v_document_name,
      applied_rule_ids = coalesce(p_applied_rule_ids, '{}'::text[]),
      omitted_rule_ids = coalesce(p_omitted_rule_ids, '{}'::text[]),
      completed_at = case when v_status = 'waiting_for_maps' then null else now() end,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = null
  where job.id = v_job.id;

  return query select v_document_id, v_document_name, v_status;
end;
$$;

revoke all on function public.claim_gdd_map_artifact(text, integer) from public, anon, authenticated;
revoke all on function public.prepare_gdd_map_artifact(uuid, text, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.reschedule_gdd_map_artifact(uuid, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.finish_gdd_map_artifact(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.persist_gdd_generation_with_maps(uuid, text, text, text, text, jsonb, text[], text[], jsonb, boolean) from public, anon, authenticated;

grant execute on function public.claim_gdd_map_artifact(text, integer) to service_role;
grant execute on function public.prepare_gdd_map_artifact(uuid, text, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.reschedule_gdd_map_artifact(uuid, text, text, integer, text) to service_role;
grant execute on function public.finish_gdd_map_artifact(uuid, text, text, text) to service_role;
grant execute on function public.persist_gdd_generation_with_maps(uuid, text, text, text, text, jsonb, text[], text[], jsonb, boolean) to service_role;

notify pgrst, 'reload schema';
