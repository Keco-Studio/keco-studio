-- Durable chapter-level dialogue derivation jobs for generated GDD Documents.

create table public.dialogue_generation_jobs (
  id uuid primary key,
  gdd_generation_job_id uuid not null references public.gdd_generation_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_key text not null,
  title text not null,
  source_content text not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  script_library_id uuid references public.libraries(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gdd_generation_job_id, chapter_key)
);

create index if not exists dialogue_generation_jobs_claim_idx
  on public.dialogue_generation_jobs(status, available_at, lease_expires_at, created_at);
create index if not exists dialogue_generation_jobs_project_idx
  on public.dialogue_generation_jobs(project_id, created_at desc);

alter table public.libraries
  add column if not exists dialogue_generation_job_id uuid
    references public.dialogue_generation_jobs(id) on delete set null;
alter table public.libraries
  add column if not exists dialogue_generation_ready boolean not null default false;
alter table public.libraries
  add column if not exists dialogue_generation_source_epoch bigint;
alter table public.libraries
  add column if not exists dialogue_generation_source_revision bigint;
alter table public.libraries
  add column if not exists dialogue_generation_source_update_ids uuid[];
alter table public.libraries
  add constraint libraries_dialogue_generation_ready_check
    check (not dialogue_generation_ready or dialogue_generation_job_id is not null);
create unique index if not exists libraries_dialogue_generation_job_idx
  on public.libraries(dialogue_generation_job_id)
  where dialogue_generation_job_id is not null;

alter table public.dialogue_generation_jobs enable row level security;
drop policy if exists dialogue_generation_jobs_select_policy on public.dialogue_generation_jobs;
revoke all on public.dialogue_generation_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.dialogue_generation_jobs to service_role;

drop policy if exists libraries_dialogue_ready_select_policy on public.libraries;
create policy libraries_dialogue_ready_select_policy on public.libraries
  as restrictive
  for select to authenticated
  using (dialogue_generation_job_id is null or dialogue_generation_ready = true);

create or replace function public.guard_dialogue_library_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' and (
      new.dialogue_generation_job_id is not null
      or new.dialogue_generation_ready
      or new.dialogue_generation_source_epoch is not null
      or new.dialogue_generation_source_revision is not null
      or new.dialogue_generation_source_update_ids is not null
    ) then
      raise exception 'Dialogue library provenance is service-owned' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.dialogue_generation_job_id is distinct from old.dialogue_generation_job_id
      or new.dialogue_generation_ready is distinct from old.dialogue_generation_ready
      or new.dialogue_generation_source_epoch is distinct from old.dialogue_generation_source_epoch
      or new.dialogue_generation_source_revision is distinct from old.dialogue_generation_source_revision
      or new.dialogue_generation_source_update_ids is distinct from old.dialogue_generation_source_update_ids
    ) then
      raise exception 'Dialogue library provenance is service-owned' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_dialogue_library_provenance on public.libraries;
create trigger protect_dialogue_library_provenance
  before insert or update on public.libraries
  for each row execute function public.guard_dialogue_library_provenance();

-- New completion overload. The existing nine-argument function remains callable
-- by old workers; this overload adds chapter Documents/jobs after GDD persistence.
create or replace function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb,
  p_dialogue_resources jsonb
)
returns table(document_id uuid, document_name text, folder_id uuid, table_ids uuid[], table_names text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_job public.gdd_generation_jobs%rowtype;
  v_resource jsonb;
  v_dialogue_job_id uuid;
  v_document_id uuid;
  v_key text;
  v_title text;
  v_content text;
  v_existing_project_id uuid;
begin
  select * into v_job from public.gdd_generation_jobs where id = p_job_id for update;
  if not found then raise exception 'GDD generation job not found' using errcode = 'P0002'; end if;

  select * into v_result
  from public.persist_completed_gdd_generation_job(
    p_job_id, p_worker_id, p_markdown, p_yjs_state, p_description,
    p_metadata, p_applied_rule_ids, p_omitted_rule_ids, p_table_resources
  );

  if p_dialogue_resources is null or jsonb_typeof(p_dialogue_resources) <> 'array' then
    raise exception 'GDD dialogue resources must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_dialogue_resources) > 50 then
    raise exception 'GDD dialogue resources must contain at most 50 entries' using errcode = '22023';
  end if;

  for v_resource in select value from jsonb_array_elements(p_dialogue_resources) loop
    if jsonb_typeof(v_resource) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_resource) as resource_key(name)
        where resource_key.name <> all(array['dialogueJobId', 'documentId', 'chapterKey', 'title', 'content', 'hasChoices', 'branchSummary'])
      ) then
      raise exception 'Invalid generated dialogue resource' using errcode = '22023';
    end if;
    begin
      v_dialogue_job_id := (v_resource ->> 'dialogueJobId')::uuid;
      v_document_id := (v_resource ->> 'documentId')::uuid;
    exception when others then
      raise exception 'Invalid generated dialogue resource ID' using errcode = '22023';
    end;
    v_key := btrim(v_resource ->> 'chapterKey');
    v_title := btrim(v_resource ->> 'title');
    v_content := v_resource ->> 'content';
    if v_key is null or length(v_key) not between 1 and 120
      or v_title is null or length(v_title) not between 1 and 160
      or length(v_content) not between 1 and 120000
      or jsonb_typeof(v_resource -> 'hasChoices') <> 'boolean'
      or jsonb_typeof(v_resource -> 'branchSummary') <> 'array'
      or jsonb_array_length(v_resource -> 'branchSummary') > 50
      or exists (
        select 1 from jsonb_array_elements(v_resource -> 'branchSummary') as branch(value)
        where jsonb_typeof(branch.value) <> 'string' or length(branch.value #>> '{}') > 300
      ) then
      raise exception 'Invalid generated dialogue resource' using errcode = '22023';
    end if;

    select document.project_id
    into v_existing_project_id
    from public.documents as document
    where document.id = v_document_id
    for update;
    if v_existing_project_id is null then
      insert into public.documents(id, project_id, folder_id, name, description, content, created_by)
      values (
        v_document_id,
        v_job.project_id,
        (v_result).folder_id,
        v_title || ' dialogue',
        'Generated dialogue chapter.',
        v_content,
        v_job.owner_id
      );
    elsif v_existing_project_id <> v_job.project_id then
      raise exception 'Dialogue source Document belongs to another project' using errcode = '42501';
    end if;

    insert into public.dialogue_generation_jobs(
      id, gdd_generation_job_id, project_id, chapter_key, title, source_content, document_id
    ) values (
      v_dialogue_job_id, v_job.id, v_job.project_id, v_key, v_title, v_content, v_document_id
    )
    on conflict (gdd_generation_job_id, chapter_key) do update set
      title = excluded.title,
      document_id = excluded.document_id,
      updated_at = now();
  end loop;

  return query select (v_result).document_id, (v_result).document_name,
    (v_result).folder_id, (v_result).table_ids, (v_result).table_names;
end;
$$;

revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) to service_role;

create or replace function public.claim_dialogue_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.dialogue_generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;

  update public.dialogue_generation_jobs as job
  set status = 'failed', completed_at = now(), last_error = coalesce(job.last_error, 'Dialogue generation retry budget exhausted.'),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where job.status = 'running' and job.lease_expires_at < now()
    and job.attempt_count >= job.max_attempts;

  select job.id into v_job_id
  from public.dialogue_generation_jobs as job
  where job.attempt_count < job.max_attempts
    and (
      (job.status = 'queued' and job.available_at <= now())
      or (job.status = 'running' and job.lease_expires_at < now())
    )
  order by job.available_at, job.created_at, job.id
  for update skip locked limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.dialogue_generation_jobs as job
  set status = 'running', lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = job.attempt_count + 1, completed_at = null, updated_at = now()
  where job.id = v_job_id
  returning job.*;
end;
$$;

create or replace function public.heartbeat_dialogue_generation_job(
  p_job_id uuid, p_worker_id text, p_lease_seconds integer default 90
) returns boolean language sql security definer set search_path = '' as $$
  update public.dialogue_generation_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = p_job_id and status = 'running' and lease_owner = p_worker_id
    and lease_expires_at >= now()
  returning true;
$$;

create or replace function public.complete_dialogue_generation_job(
  p_job_id uuid, p_worker_id text, p_script_library_id uuid
) returns boolean language sql security definer set search_path = '' as $$
  update public.dialogue_generation_jobs as job
  set status = 'completed', script_library_id = p_script_library_id,
      completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
  where job.id = p_job_id and job.status = 'running' and job.lease_owner = p_worker_id
    and job.lease_expires_at >= now()
    and exists (
      select 1 from public.libraries as library
      where library.id = p_script_library_id
        and library.project_id = job.project_id
        and library.dialogue_generation_job_id = job.id
        and library.dialogue_generation_ready = true
        and library.source_document_id = job.document_id
        and library.document_export_type = 'script'
        and exists (
          select 1 from public.documents as source_document
          where source_document.id = job.document_id
            and source_document.project_id = job.project_id
            and source_document.collab_epoch = library.dialogue_generation_source_epoch
            and source_document.collab_revision = library.dialogue_generation_source_revision
            and array(
              select update_row.id
              from public.document_yjs_updates as update_row
              where update_row.document_id = source_document.id
                and update_row.epoch = source_document.collab_epoch
              order by update_row.id
            ) = coalesce(library.dialogue_generation_source_update_ids, '{}'::uuid[])
        )
    )
  returning true;
$$;

create or replace function public.finalize_dialogue_script_import(
  p_job_id uuid,
  p_worker_id text,
  p_script_library_id uuid,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_source_update_ids uuid[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.dialogue_generation_jobs%rowtype;
  v_library public.libraries%rowtype;
  v_document public.documents%rowtype;
  v_actual_update_ids uuid[];
  v_expected_update_ids uuid[];
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  select * into v_job from public.dialogue_generation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at < now() then
    raise exception 'Dialogue generation job lease was lost.' using errcode = 'PT409';
  end if;
  select * into v_library from public.libraries where id = p_script_library_id for update;
  if not found or v_library.project_id <> v_job.project_id
    or v_library.dialogue_generation_job_id <> v_job.id
    or v_library.dialogue_generation_ready
    or v_library.source_document_id <> v_job.document_id
    or v_library.document_export_type <> 'script'
    or v_library.dialogue_generation_source_epoch <> p_source_epoch
    or v_library.dialogue_generation_source_revision <> p_source_revision then
    raise exception 'Dialogue Script provenance is invalid.' using errcode = '42501';
  end if;
  select * into v_document from public.documents where id = v_job.document_id for update;
  if not found or v_document.project_id <> v_job.project_id
    or v_document.collab_epoch <> p_source_epoch
    or v_document.collab_revision <> p_source_revision then
    raise exception 'Dialogue source Document changed.' using errcode = 'PT409';
  end if;
  select coalesce(array_agg(update_row.id order by update_row.id), '{}'::uuid[])
    into v_actual_update_ids
  from public.document_yjs_updates as update_row
  where update_row.document_id = v_job.document_id and update_row.epoch = p_source_epoch;
  select coalesce(array_agg(update_id order by update_id), '{}'::uuid[])
    into v_expected_update_ids
  from unnest(coalesce(p_source_update_ids, '{}'::uuid[])) as update_id;
  if coalesce(v_library.dialogue_generation_source_update_ids, '{}'::uuid[]) <> v_expected_update_ids then
    raise exception 'Dialogue Script source provenance is invalid.' using errcode = '42501';
  end if;
  if v_actual_update_ids <> v_expected_update_ids then
    raise exception 'Dialogue source Document updates changed.' using errcode = 'PT409';
  end if;
  update public.libraries
  set dialogue_generation_ready = true
  where id = p_script_library_id and dialogue_generation_ready = false;
  update public.dialogue_generation_jobs
  set status = 'completed', script_library_id = p_script_library_id,
      completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = p_job_id and status = 'running' and lease_owner = p_worker_id;
  return true;
end;
$$;

create or replace function public.fail_dialogue_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_delay_seconds integer default 30
) returns boolean language sql security definer set search_path = '' as $$
  update public.dialogue_generation_jobs
  set status = case when p_delay_seconds <= 0 or attempt_count >= max_attempts then 'failed' else 'queued' end,
      available_at = now() + make_interval(secs => greatest(0, least(p_delay_seconds, 86400))),
      last_error = left(coalesce(p_error, 'Dialogue generation failed.'), 1000),
      lease_owner = null, lease_expires_at = null,
      completed_at = case when p_delay_seconds <= 0 or attempt_count >= max_attempts then now() else null end,
      updated_at = now()
  where id = p_job_id and status = 'running' and lease_owner = p_worker_id
    and lease_expires_at >= now()
  returning true;
$$;

create or replace function public.retry_dialogue_generation_job(
  p_job_id uuid, p_actor_id uuid
) returns setof public.dialogue_generation_jobs
language sql security definer set search_path = '' as $$
  update public.dialogue_generation_jobs as job
  set status = 'queued', attempt_count = 0, available_at = now(), last_error = null,
      lease_owner = null, lease_expires_at = null, completed_at = null, updated_at = now()
  where job.id = p_job_id and job.status = 'failed'
    and exists (
      select 1 from public.projects project
      where project.id = job.project_id and (
        project.owner_id = p_actor_id
        or exists (
          select 1 from public.project_collaborators collaborator
          where collaborator.project_id = job.project_id
            and collaborator.user_id = p_actor_id
            and collaborator.role in ('admin', 'editor')
            and collaborator.accepted_at is not null
        )
      )
    )
  returning job.*;
$$;

revoke all on function public.claim_dialogue_generation_job(text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_dialogue_generation_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_dialogue_generation_job(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_dialogue_script_import(uuid, text, uuid, bigint, bigint, uuid[]) from public, anon, authenticated;
revoke all on function public.fail_dialogue_generation_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.retry_dialogue_generation_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_dialogue_generation_job(text, integer) to service_role;
grant execute on function public.heartbeat_dialogue_generation_job(uuid, text, integer) to service_role;
grant execute on function public.complete_dialogue_generation_job(uuid, text, uuid) to service_role;
grant execute on function public.finalize_dialogue_script_import(uuid, text, uuid, bigint, bigint, uuid[]) to service_role;
grant execute on function public.fail_dialogue_generation_job(uuid, text, text, integer) to service_role;
grant execute on function public.retry_dialogue_generation_job(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
