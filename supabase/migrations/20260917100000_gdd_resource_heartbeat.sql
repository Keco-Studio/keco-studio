create or replace function public.heartbeat_gdd_resource_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.gdd_resource_jobs
  set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 600))),
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and lease_owner = p_worker_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.heartbeat_gdd_resource_job(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_gdd_resource_job(uuid, text, integer)
  to service_role;

notify pgrst, 'reload schema';
