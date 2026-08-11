create or replace function public.transition_map_asset(
  p_asset_id uuid,
  p_expected_status text,
  p_next_status text,
  p_provider_operation text,
  p_provider_transport text,
  p_provider_job_id text,
  p_last_error_code text,
  p_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_has_transparency boolean,
  p_metadata jsonb
)
returns table (asset_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.map_assets%rowtype;
  v_revision_id uuid;
  v_map_id uuid;
  v_project_id uuid;
  v_expected_path text;
  v_attempt_count integer;
  v_any_unsuccessful boolean;
  v_any_ready boolean;
  v_all_ready boolean;
begin
  select asset.*
  into v_asset
  from public.map_assets as asset
  where asset.id = p_asset_id
  for update of asset;
  if not found then raise exception 'asset not found' using errcode = 'P0002'; end if;

  select revision.id, map.id, map.project_id
  into v_revision_id, v_map_id, v_project_id
  from public.map_revisions as revision
  join public.map_projects as map on map.id = revision.map_project_id
  where revision.id = v_asset.map_revision_id
  for update of revision;

  if auth.role() <> 'service_role' then
    perform public.map_require_writer(v_project_id);
  end if;
  if v_asset.status <> p_expected_status then
    return query select v_asset.id, 'conflict'::text, v_asset.attempt_count;
    return;
  end if;

  if not (
    (v_asset.status = 'planned' and p_next_status in ('queued', 'blocked'))
    or (v_asset.status = 'queued' and p_next_status in ('generating', 'failed', 'blocked'))
    or (v_asset.status = 'generating' and p_next_status in ('ready', 'failed', 'blocked'))
    or (v_asset.status = 'failed' and p_next_status in ('queued', 'blocked'))
    or (v_asset.status = 'blocked' and p_next_status = 'queued')
  ) then
    raise exception 'illegal map asset transition % -> %', v_asset.status, p_next_status
      using errcode = '23514';
  end if;

  if p_next_status = 'ready' then
    if p_sha256 is null or p_width is null or p_height is null or p_storage_path is null then
      raise exception 'ready assets require storage metadata' using errcode = '23514';
    end if;
    v_expected_path := format(
      '%s/%s/%s/%s/%s.png',
      v_project_id, v_map_id, v_revision_id, v_asset.asset_key, p_sha256
    );
    if p_storage_path <> v_expected_path then
      raise exception 'storage path does not match asset identity' using errcode = '23514';
    end if;
  end if;

  update public.map_assets
  set status = p_next_status,
      provider_operation = coalesce(p_provider_operation, map_assets.provider_operation),
      provider_transport = coalesce(p_provider_transport, map_assets.provider_transport),
      provider_job_id = coalesce(p_provider_job_id, map_assets.provider_job_id),
      attempt_count = map_assets.attempt_count + case when p_next_status = 'queued' then 1 else 0 end,
      last_error_code = case when p_next_status in ('failed', 'blocked') then p_last_error_code else null end,
      storage_path = case when p_next_status = 'ready' then p_storage_path else map_assets.storage_path end,
      sha256 = case when p_next_status = 'ready' then p_sha256 else map_assets.sha256 end,
      width = case when p_next_status = 'ready' then p_width else map_assets.width end,
      height = case when p_next_status = 'ready' then p_height else map_assets.height end,
      has_transparency = case when p_next_status = 'ready' then p_has_transparency else map_assets.has_transparency end,
      metadata = map_assets.metadata || coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
  returning map_assets.attempt_count into v_attempt_count;

  select
    bool_or(asset.status in ('failed', 'blocked')),
    bool_or(asset.status = 'ready'),
    bool_and(asset.status = 'ready')
  into v_any_unsuccessful, v_any_ready, v_all_ready
  from public.map_assets as asset
  where asset.map_revision_id = v_revision_id;

  update public.map_revisions as revision
  set status = case
    when v_all_ready then 'ready'
    when v_any_unsuccessful and v_any_ready then 'partial'
    when v_any_unsuccessful then 'failed'
    else 'generating'
  end
  where revision.id = v_revision_id and revision.status <> 'draft';

  return query select p_asset_id, p_next_status, v_attempt_count;
end;
$$;

revoke all on function public.transition_map_asset(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_map_asset(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb)
  to service_role;

notify pgrst, 'reload schema';
