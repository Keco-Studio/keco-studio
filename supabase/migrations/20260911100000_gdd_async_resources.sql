-- GDD-first resource processing. The parent document may complete before map
-- artifacts are queued; legacy inline jobs retain their existing semantics.

alter table public.gdd_generation_jobs
  add column if not exists resource_mode text not null default 'inline'
  check (resource_mode in ('async', 'inline'));
grant select (resource_mode) on public.gdd_generation_jobs to authenticated;
create or replace function public.set_gdd_resource_mode_from_input()
returns trigger language plpgsql as $$
begin
  if new.contract_version = 2 and (new.input ->> 'resourceMode') in ('async', 'inline') then
    new.resource_mode := new.input ->> 'resourceMode';
  end if;
  return new;
end;
$$;
drop trigger if exists gdd_generation_jobs_resource_mode on public.gdd_generation_jobs;
create trigger gdd_generation_jobs_resource_mode
  before insert on public.gdd_generation_jobs
  for each row execute function public.set_gdd_resource_mode_from_input();
create index if not exists gdd_generation_jobs_resource_mode_idx
  on public.gdd_generation_jobs(project_id, resource_mode, created_at desc);
create table if not exists public.gdd_resource_jobs (
  id uuid primary key default gen_random_uuid(),
  gdd_generation_job_id uuid not null references public.gdd_generation_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  kind text not null check (kind in ('tables', 'dialogue', 'maps')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gdd_generation_job_id, kind)
);
create index if not exists gdd_resource_jobs_claim_idx
  on public.gdd_resource_jobs(status, available_at, lease_expires_at, created_at);
alter table public.gdd_resource_jobs enable row level security;
drop policy if exists gdd_resource_jobs_select_policy on public.gdd_resource_jobs;
create policy gdd_resource_jobs_select_policy on public.gdd_resource_jobs
  for select using (public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid())));
revoke all on public.gdd_resource_jobs from public, anon, authenticated;
grant select (id, gdd_generation_job_id, project_id, document_id, kind, status, attempt_count, max_attempts, available_at, error, completed_at)
  on public.gdd_resource_jobs to authenticated;
grant select, insert, update, delete on public.gdd_resource_jobs to service_role;
create or replace function public.claim_gdd_resource_job(p_worker_id text, p_lease_seconds integer default 300)
returns setof public.gdd_resource_jobs language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.gdd_resource_jobs
  where attempt_count < max_attempts and ((status = 'queued' and available_at <= now()) or (status = 'running' and lease_expires_at < now()))
  order by available_at, created_at, id for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.gdd_resource_jobs set status = 'running', attempt_count = attempt_count + 1,
    lease_owner = p_worker_id, lease_expires_at = now() + make_interval(secs => p_lease_seconds), error = null
    where id = v_id returning *;
end; $$;
create or replace function public.retry_gdd_resource_job(p_job_id uuid, p_worker_id text, p_error text, p_delay_seconds integer)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  update public.gdd_resource_jobs set status = case when attempt_count >= max_attempts then 'failed' else 'queued' end,
    available_at = case when attempt_count >= max_attempts then available_at else now() + make_interval(secs => greatest(0, p_delay_seconds)) end,
    completed_at = case when attempt_count >= max_attempts then now() else null end,
    lease_owner = null, lease_expires_at = null, error = left(coalesce(p_error, 'Resource generation failed'), 1000)
  where id = p_job_id and status = 'running' and lease_owner = p_worker_id returning status into v_status;
  return v_status;
end; $$;
create or replace function public.finish_gdd_resource_job(p_job_id uuid, p_worker_id text, p_status text, p_error text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if p_status not in ('completed', 'failed') then raise exception 'invalid resource job status' using errcode = '22023'; end if;
  update public.gdd_resource_jobs set status = p_status, completed_at = now(), lease_owner = null,
    lease_expires_at = null, error = case when p_status = 'completed' then null else left(coalesce(p_error, 'Resource generation failed'), 1000) end
  where id = p_job_id and status = 'running' and lease_owner = p_worker_id returning status into v_status;
  return v_status;
end; $$;
-- Resource workers reuse the canonical resource-evolution RPC. The short
-- lease handoff is internal and immediately returns the parent to completed.
create or replace function public.materialize_gdd_resource_payload(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_metadata jsonb,
  p_table_resources jsonb,
  p_dialogue_resources jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_job public.gdd_generation_jobs%rowtype;
begin
  select * into v_job from public.gdd_generation_jobs where id = p_job_id for update;
  if not found or v_job.status not in ('completed', 'completed_with_map_failures') then
    raise exception 'GDD parent is not available for resource materialization' using errcode = 'P0002';
  end if;
  update public.gdd_generation_jobs set status = 'running', lease_owner = p_worker_id,
    lease_expires_at = now() + interval '5 minutes', heartbeat_at = now() where id = p_job_id;
  perform public.persist_completed_gdd_generation_job(
    p_job_id, p_worker_id, p_markdown, p_yjs_state, 'Async GDD resources',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('resourceOnly', true),
    v_job.applied_rule_ids, v_job.omitted_rule_ids,
    coalesce(p_table_resources, '[]'::jsonb), coalesce(p_dialogue_resources, '[]'::jsonb)
  );
end; $$;
create or replace function public.enqueue_gdd_map_artifacts(
  p_job_id uuid,
  p_map_artifacts jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document_id uuid;
  v_artifact jsonb;
  v_count integer := 0;
begin
  if p_map_artifacts is null or jsonb_typeof(p_map_artifacts) <> 'array'
    or jsonb_array_length(p_map_artifacts) > 3 then
    raise exception 'A GDD may enqueue at most three map artifacts' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.id = p_job_id
    and job.status in ('completed', 'completed_with_map_failures')
  for update;
  if not found then
    raise exception 'GDD parent must be completed before map resources are queued' using errcode = 'P0002';
  end if;
  v_document_id := v_job.output_document_id;
  if v_document_id is null then
    raise exception 'GDD output document is missing' using errcode = 'P0002';
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
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.enqueue_gdd_map_artifacts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_gdd_map_artifacts(uuid, jsonb) to service_role;
revoke all on function public.claim_gdd_resource_job(text, integer) from public, anon, authenticated;
revoke all on function public.retry_gdd_resource_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_gdd_resource_job(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_gdd_resource_job(text, integer) to service_role;
grant execute on function public.retry_gdd_resource_job(uuid, text, text, integer) to service_role;
grant execute on function public.finish_gdd_resource_job(uuid, text, text, text) to service_role;
revoke all on function public.materialize_gdd_resource_payload(uuid, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.materialize_gdd_resource_payload(uuid, text, text, text, jsonb, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';
