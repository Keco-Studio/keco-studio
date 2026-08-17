-- Durable generation jobs for project GDD drafts.

create unique index if not exists game_design_system_versions_id_system_idx
  on public.game_design_system_versions(id, system_id);

create table if not exists public.gdd_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  version_id uuid not null references public.game_design_system_versions(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  phase text not null default 'collecting' check (phase in ('collecting', 'generating', 'validating', 'saving', 'completed', 'failed')),
  input jsonb not null,
  source_snapshots jsonb not null default '[]'::jsonb check (jsonb_typeof(source_snapshots) = 'array'),
  applied_rule_ids text[] not null default '{}'::text[],
  omitted_rule_ids text[] not null default '{}'::text[],
  output_document_id uuid references public.documents(id) on delete set null,
  output_document_name text,
  error text,
  idempotency_key text,
  input_hash text,
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
  constraint gdd_generation_jobs_input_size check (pg_catalog.octet_length(input::text) <= 256000),
  constraint gdd_generation_jobs_system_version_match foreign key (version_id, design_system_id)
    references public.game_design_system_versions(id, system_id) on delete restrict
);

create unique index if not exists gdd_generation_jobs_idempotency_idx
  on public.gdd_generation_jobs(owner_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists gdd_generation_jobs_claim_idx
  on public.gdd_generation_jobs(status, available_at, lease_expires_at, created_at);
create index if not exists gdd_generation_jobs_project_idx
  on public.gdd_generation_jobs(project_id, created_at desc);

drop trigger if exists gdd_generation_jobs_updated_at on public.gdd_generation_jobs;
create trigger gdd_generation_jobs_updated_at
  before update on public.gdd_generation_jobs
  for each row execute function public.update_updated_at_column();

alter table public.gdd_generation_jobs enable row level security;

drop policy if exists gdd_generation_jobs_select_policy on public.gdd_generation_jobs;
create policy gdd_generation_jobs_select_policy on public.gdd_generation_jobs
  for select using (
    owner_id = (select auth.uid())
    or public.user_has_project_access(project_id, (select auth.uid()))
  );

revoke all on public.gdd_generation_jobs from public, anon, authenticated;
grant select on public.gdd_generation_jobs to authenticated;
grant select, insert, update, delete on public.gdd_generation_jobs to service_role;

create function public.claim_gdd_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.gdd_generation_jobs
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

  select job.id into v_job_id
  from public.gdd_generation_jobs as job
  where job.attempt_count < job.max_attempts
    and (
      (job.status = 'queued' and job.available_at <= now())
      or (job.status = 'running' and job.lease_expires_at < now())
    )
  order by job.available_at, job.created_at, job.id
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.gdd_generation_jobs as job
  set status = 'running',
      phase = 'collecting',
      attempt_count = job.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      started_at = coalesce(job.started_at, now()),
      completed_at = null,
      error = null
  where job.id = v_job_id
  returning job.*;
end;
$$;

create function public.heartbeat_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_phase text,
  p_lease_seconds integer default 90
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.gdd_generation_jobs
    set phase = p_phase,
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = p_job_id
      and status = 'running'
      and lease_owner = p_worker_id
      and lease_expires_at >= now()
    returning id
  )
  select exists(select 1 from updated);
$$;

create function public.retry_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_delay_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.gdd_generation_jobs as job
  set status = case when job.attempt_count >= job.max_attempts then 'failed' else 'queued' end,
      phase = case when job.attempt_count >= job.max_attempts then 'failed' else 'collecting' end,
      available_at = case when job.attempt_count >= job.max_attempts then job.available_at else now() + make_interval(secs => greatest(0, p_delay_seconds)) end,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      completed_at = case when job.attempt_count >= job.max_attempts then now() else null end,
      error = left(coalesce(p_error, 'GDD generation failed'), 1000)
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
  returning status into v_status;
  return v_status;
end;
$$;

revoke all on function public.claim_gdd_generation_job(text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_gdd_generation_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.retry_gdd_generation_job(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_gdd_generation_job(text, integer) to service_role;
grant execute on function public.heartbeat_gdd_generation_job(uuid, text, text, integer) to service_role;
grant execute on function public.retry_gdd_generation_job(uuid, text, text, integer) to service_role;

notify pgrst, 'reload schema';
