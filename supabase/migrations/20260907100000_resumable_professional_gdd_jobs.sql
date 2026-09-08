-- Preserve durable professional GDD checkpoints when a Hobby worker is
-- reclaimed or transiently retried between bounded generation stages.

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
      phase = case
        when job.contract_version = 2 and job.mode = 'professional' then job.phase
        else 'collecting'
      end,
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

create or replace function public.retry_gdd_generation_job(
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
  -- Do not update blueprint, section_drafts, review_report, or repair_round:
  -- those columns are the durable checkpoint for the next stage.
  update public.gdd_generation_jobs as job
  set status = case when job.attempt_count >= job.max_attempts then 'failed' else 'queued' end,
      phase = case
        when job.attempt_count >= job.max_attempts then 'failed'
        when job.contract_version = 2 and job.mode = 'professional' then job.phase
        else 'collecting'
      end,
      available_at = case when job.attempt_count >= job.max_attempts
        then job.available_at
        else now() + make_interval(secs => greatest(0, p_delay_seconds))
      end,
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

revoke all on function public.claim_gdd_generation_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_gdd_generation_job(text, integer)
  to service_role;

revoke all on function public.retry_gdd_generation_job(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.retry_gdd_generation_job(uuid, text, text, integer)
  to service_role;

revoke all on function public.checkpoint_gdd_generation_job(uuid, text, text, jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.checkpoint_gdd_generation_job(uuid, text, text, jsonb, jsonb, jsonb, integer)
  to service_role;

notify pgrst, 'reload schema';
