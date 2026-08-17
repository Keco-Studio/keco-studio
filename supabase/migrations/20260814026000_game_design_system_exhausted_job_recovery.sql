-- Expired final-attempt leases must become terminal instead of remaining running.

create or replace function public.claim_game_design_system_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.game_design_system_generation_jobs
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

  update public.game_design_system_generation_jobs
  set status = 'failed',
      phase = 'failed',
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = coalesce(error, 'Generation worker lease expired after final attempt.')
  where status = 'running'
    and lease_expires_at < now()
    and attempt_count >= max_attempts;

  select job.id into v_job_id
  from public.game_design_system_generation_jobs as job
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
  update public.game_design_system_generation_jobs as job
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

revoke all on function public.claim_game_design_system_generation_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_game_design_system_generation_job(text, integer)
  to service_role;

notify pgrst, 'reload schema';
