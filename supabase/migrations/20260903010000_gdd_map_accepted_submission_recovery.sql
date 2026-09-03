-- Recover GDD map submissions whose provider job was persisted after the
-- request worker lost its response. Continue polling instead of resubmitting
-- paid work or marking an accepted job as failed.

create or replace function public.reconcile_gdd_map_artifact(
  p_artifact_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_artifact public.gdd_map_artifacts%rowtype;
  v_asset_status text;
  v_provider_job_id text;
  v_storage_path text;
  v_asset_updated_at timestamptz;
  v_parent_status text;
begin
  select artifact.gdd_generation_job_id into v_job_id
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id;
  if not found then return null; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job_id::text, 0)
  );

  select artifact.* into v_artifact
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id
  for update;
  if not found then return null; end if;

  if v_artifact.map_asset_id is null or v_artifact.map_revision_id is null then
    return v_artifact.status;
  end if;

  select asset.status, asset.provider_job_id, asset.storage_path, asset.updated_at
    into v_asset_status, v_provider_job_id, v_storage_path, v_asset_updated_at
  from public.map_assets as asset
  where asset.id = v_artifact.map_asset_id
    and asset.map_revision_id = v_artifact.map_revision_id
  for share;
  if not found then return v_artifact.status; end if;

  if v_asset_status = 'generating' and nullif(btrim(v_provider_job_id), '') is not null then
    update public.gdd_map_artifacts as artifact
    set status = 'queued',
        phase = 'polling',
        attempt_count = least(
          artifact.attempt_count,
          greatest(artifact.max_attempts - 1, 0)
        ),
        available_at = now(),
        error = null,
        completed_at = null,
        lease_owner = null,
        lease_expires_at = null,
        heartbeat_at = null
    where artifact.id = v_artifact.id;

    update public.gdd_generation_jobs
    set status = 'waiting_for_maps',
        phase = 'generating_maps',
        completed_at = null,
        error = null
    where id = v_artifact.gdd_generation_job_id
      and status = 'completed_with_map_failures';
    return 'queued';
  end if;

  if v_asset_status = 'queued' and nullif(btrim(v_provider_job_id), '') is null then
    if v_asset_updated_at >= now() - interval '2 minutes' then
      update public.gdd_map_artifacts as artifact
      set status = 'queued',
          phase = 'submitting',
          attempt_count = least(
            artifact.attempt_count,
            greatest(artifact.max_attempts - 1, 0)
          ),
          available_at = now() + interval '15 seconds',
          error = null,
          completed_at = null,
          lease_owner = null,
          lease_expires_at = null,
          heartbeat_at = null
      where artifact.id = v_artifact.id;
      return 'queued';
    end if;

    update public.gdd_map_artifacts as artifact
    set status = 'blocked',
        phase = 'blocked',
        error = 'PixelLab paid submission outcome remained unknown after the reconciliation window.',
        completed_at = now(),
        lease_owner = null,
        lease_expires_at = null,
        heartbeat_at = null
    where artifact.id = v_artifact.id;

    if not exists (
      select 1 from public.gdd_map_artifacts as sibling
      where sibling.gdd_generation_job_id = v_artifact.gdd_generation_job_id
        and sibling.id <> v_artifact.id
        and sibling.status in ('queued', 'running')
    ) then
      update public.gdd_generation_jobs
      set status = 'completed_with_map_failures',
          phase = 'completed',
          completed_at = now(),
          error = null
      where id = v_artifact.gdd_generation_job_id
        and status = 'waiting_for_maps';
    end if;
    return 'blocked';
  end if;

  if v_asset_status <> 'ready' or nullif(btrim(v_storage_path), '') is null then
    return v_artifact.status;
  end if;

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

with recovered as (
  update public.gdd_map_artifacts as artifact
  set status = 'queued',
      phase = 'polling',
      attempt_count = least(
        artifact.attempt_count,
        greatest(artifact.max_attempts - 1, 0)
      ),
      available_at = now(),
      error = null,
      completed_at = null,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null
  from public.map_assets as asset
  where artifact.map_asset_id = asset.id
    and artifact.map_revision_id = asset.map_revision_id
    and artifact.status in ('failed', 'blocked')
    and asset.status = 'generating'
    and nullif(btrim(asset.provider_job_id), '') is not null
  returning artifact.gdd_generation_job_id
)
update public.gdd_generation_jobs as job
set status = 'waiting_for_maps',
    phase = 'generating_maps',
    completed_at = null,
    error = null
where job.id in (select gdd_generation_job_id from recovered)
  and job.status = 'completed_with_map_failures';

create or replace function public.finish_gdd_map_artifact(
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
  v_job_id uuid;
  v_artifact public.gdd_map_artifacts%rowtype;
  v_parent_status text;
begin
  if p_status not in ('ready', 'failed', 'blocked') then
    raise exception 'invalid terminal GDD map status' using errcode = '22023';
  end if;

  select artifact.gdd_generation_job_id into v_job_id
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id;
  if not found then
    raise exception 'GDD map artifact lease was lost' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job_id::text, 0)
  );

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

revoke all on function public.reconcile_gdd_map_artifact(uuid) from public, anon, authenticated;
revoke all on function public.finish_gdd_map_artifact(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reconcile_gdd_map_artifact(uuid) to service_role;
grant execute on function public.finish_gdd_map_artifact(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
