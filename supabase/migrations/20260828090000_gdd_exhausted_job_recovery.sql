-- Expired final-attempt GDD leases must become terminal instead of blocking
-- every later generation request for the project.

update public.gdd_generation_jobs
set status = 'failed',
    phase = 'failed',
    completed_at = now(),
    lease_owner = null,
    lease_expires_at = null,
    heartbeat_at = null,
    error = coalesce(error, 'Generation worker lease expired after final attempt.')
where status = 'running'
  and attempt_count >= max_attempts
  and (lease_expires_at is null or lease_expires_at < now());

create or replace function public.claim_gdd_generation_job(
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

  update public.gdd_generation_jobs
  set status = 'failed',
      phase = 'failed',
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = coalesce(error, 'Generation worker lease expired after final attempt.')
  where status = 'running'
    and attempt_count >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());

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

create or replace function public.create_gdd_generation_job_guarded(
  p_owner_id uuid,
  p_project_id uuid,
  p_design_system_id uuid,
  p_version_id uuid,
  p_mode text,
  p_contract_version integer,
  p_input jsonb,
  p_source_snapshots jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_idempotency_key text,
  p_input_hash text
)
returns setof public.gdd_generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
begin
  if p_owner_id is null or p_project_id is null or p_design_system_id is null or p_version_id is null then
    raise exception 'GDD generation identity is required' using errcode = '22023';
  end if;
  if p_mode not in ('quick', 'professional') or p_contract_version not in (1, 2) then
    raise exception 'GDD generation mode or contract version is invalid' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object'
    or p_source_snapshots is null or jsonb_typeof(p_source_snapshots) <> 'array' then
    raise exception 'GDD generation input is invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = ''
    or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'GDD generation idempotency input is invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text, 0));

  update public.gdd_generation_jobs
  set status = 'failed',
      phase = 'failed',
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = coalesce(error, 'Generation worker lease expired after final attempt.')
  where project_id = p_project_id
    and status = 'running'
    and attempt_count >= max_attempts
    and (lease_expires_at is null or lease_expires_at < now());

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.owner_id = p_owner_id
    and job.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_job.input_hash <> p_input_hash then
      raise exception 'GDD generation idempotency key was reused with different input'
        using errcode = 'P0001', hint = 'gdd_idempotency_conflict';
    end if;
    return next v_job;
    return;
  end if;

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.project_id = p_project_id
    and job.status in ('queued', 'running', 'waiting_for_maps')
  order by
    case job.status when 'waiting_for_maps' then 0 when 'running' then 1 else 2 end,
    job.created_at,
    job.id
  limit 1
  for update;
  if found then
    if v_job.input_hash = p_input_hash then
      return next v_job;
      return;
    end if;
    raise exception 'Another GDD generation is already active for this project'
      using errcode = 'P0001', detail = v_job.id::text, hint = 'gdd_active_job_conflict';
  end if;

  insert into public.gdd_generation_jobs (
    owner_id, project_id, design_system_id, version_id, mode, contract_version,
    input, source_snapshots, applied_rule_ids, omitted_rule_ids,
    idempotency_key, input_hash, status, phase
  ) values (
    p_owner_id, p_project_id, p_design_system_id, p_version_id, p_mode, p_contract_version,
    p_input, p_source_snapshots, coalesce(p_applied_rule_ids, '{}'::text[]),
    coalesce(p_omitted_rule_ids, '{}'::text[]), p_idempotency_key, p_input_hash,
    'queued', 'collecting'
  ) returning * into v_job;

  return next v_job;
end;
$$;

revoke all on function public.claim_gdd_generation_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_gdd_generation_job(text, integer)
  to service_role;

revoke all on function public.create_gdd_generation_job_guarded(
  uuid, uuid, uuid, uuid, text, integer, jsonb, jsonb, text[], text[], text, text
) from public, anon, authenticated;
grant execute on function public.create_gdd_generation_job_guarded(
  uuid, uuid, uuid, uuid, text, integer, jsonb, jsonb, text[], text[], text, text
) to service_role;

notify pgrst, 'reload schema';
