-- Allow an editor-authorized server route to recover one exhausted async GDD
-- resource without regenerating the completed parent document.

create or replace function public.retry_failed_gdd_resource_job(
  p_job_id uuid
)
returns setof public.gdd_resource_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_resource_jobs%rowtype;
begin
  select resource.* into v_job
  from public.gdd_resource_jobs as resource
  where resource.id = p_job_id
  for update;

  if not found then
    raise exception 'GDD resource job not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'failed' then
    raise exception 'Only failed GDD resource jobs can be retried' using errcode = 'PT409';
  end if;
  if v_job.kind = 'maps' and exists (
    select 1
    from public.gdd_map_artifacts as artifact
    where artifact.gdd_generation_job_id = v_job.gdd_generation_job_id
  ) then
    raise exception 'GDD map artifacts already exist for this generation' using errcode = 'PT409';
  end if;

  return query
  update public.gdd_resource_jobs as resource
  set status = 'queued',
      attempt_count = 0,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      error = null,
      completed_at = null
  where resource.id = p_job_id
  returning resource.*;
end;
$$;

revoke all on function public.retry_failed_gdd_resource_job(uuid)
  from public, anon, authenticated;
grant execute on function public.retry_failed_gdd_resource_job(uuid) to service_role;

notify pgrst, 'reload schema';
