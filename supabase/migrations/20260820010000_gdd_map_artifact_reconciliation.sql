-- Keep GDD map artifacts consistent when the provider persists the image
-- before a worker lease expires or its response is interrupted.

create function public.heartbeat_gdd_map_artifact(
  p_artifact_id uuid,
  p_worker_id text,
  p_phase text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_phase not in ('planning', 'submitting', 'polling', 'validating') then
    raise exception 'invalid GDD map phase' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;

  update public.gdd_map_artifacts as artifact
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now()
  where artifact.id = p_artifact_id
    and artifact.status = 'running'
    and artifact.phase = p_phase
    and artifact.lease_owner = p_worker_id
    and artifact.lease_expires_at >= now();
  return found;
end;
$$;

create function public.reconcile_gdd_map_artifact(
  p_artifact_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_asset_status text;
  v_storage_path text;
  v_parent_status text;
begin
  select artifact.* into v_artifact
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id
  for update;
  if not found then
    return null;
  end if;

  if v_artifact.map_asset_id is null or v_artifact.map_revision_id is null then
    return v_artifact.status;
  end if;

  select asset.status, asset.storage_path
    into v_asset_status, v_storage_path
  from public.map_assets as asset
  where asset.id = v_artifact.map_asset_id
    and asset.map_revision_id = v_artifact.map_revision_id
  for share;
  if not found or v_asset_status <> 'ready' or nullif(btrim(v_storage_path), '') is null then
    return v_artifact.status;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_artifact.gdd_generation_job_id::text, 0)
  );

  update public.gdd_map_artifacts as artifact
  set status = 'ready',
      phase = 'ready',
      error = null,
      completed_at = coalesce(artifact.completed_at, now()),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null
  where artifact.id = v_artifact.id;

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
      and status in ('waiting_for_maps', 'completed_with_map_failures');
  end if;

  return 'ready';
end;
$$;

revoke all on function public.heartbeat_gdd_map_artifact(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.reconcile_gdd_map_artifact(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_gdd_map_artifact(uuid, text, text, integer) to service_role;
grant execute on function public.reconcile_gdd_map_artifact(uuid) to service_role;

notify pgrst, 'reload schema';
