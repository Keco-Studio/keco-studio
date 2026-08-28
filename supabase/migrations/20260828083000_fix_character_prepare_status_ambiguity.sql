create or replace function public.prepare_character_asset_generation(
  p_asset_id uuid, p_expected_save_version bigint,
  p_generation_id uuid, p_plan_fingerprint text
)
returns table (generation_attempt_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.character_assets%rowtype;
  v_existing public.character_generation_attempts%rowtype;
  v_source public.character_assets%rowtype;
  v_source_attempt public.character_generation_attempts%rowtype;
  v_attempt_id uuid;
begin
  select asset.* into v_asset from public.character_assets as asset
  where asset.id = p_asset_id for update;
  if not found then raise exception 'character asset not found' using errcode = 'P0002'; end if;
  perform public.character_require_writer(v_asset.project_id);
  if v_asset.save_version <> p_expected_save_version
    or v_asset.plan_fingerprint <> p_plan_fingerprint then
    raise exception 'character asset revision stale' using errcode = 'KM412';
  end if;
  if v_asset.kind = 'animation' then
    select source.* into v_source from public.character_assets as source
    where source.id = v_asset.source_character_asset_id for update;
    if not found or v_source.project_id <> v_asset.project_id
      or v_source.kind <> 'character' or v_source.status <> 'ready' then
      raise exception 'source character unavailable' using errcode = 'KM422';
    end if;
    select attempt.* into v_source_attempt from public.character_generation_attempts as attempt
    where attempt.id = v_source.latest_generation_attempt_id and attempt.status = 'ready';
    if not found or v_asset.plan ->> 'sourceCharacterSha256' <> v_source_attempt.sha256 then
      raise exception 'source character hash mismatch' using errcode = 'KM422';
    end if;
  end if;
  select attempt.* into v_existing from public.character_generation_attempts as attempt
  where attempt.character_asset_id = p_asset_id order by attempt.created_at desc limit 1 for update;
  if found then
    if v_existing.plan_fingerprint <> p_plan_fingerprint then
      raise exception 'character generation identity conflict' using errcode = 'KM413';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.attempt_count;
    return;
  end if;
  if v_asset.status <> 'draft' then
    raise exception 'character asset revision stale' using errcode = 'KM412';
  end if;
  insert into public.character_generation_attempts (
    character_asset_id, generation_id, plan_fingerprint, requested_capability
  ) values (
    p_asset_id, p_generation_id, p_plan_fingerprint,
    case when v_asset.kind = 'character' then 'character-pro' else 'animate-character-v3' end
  ) returning id into v_attempt_id;
  update public.character_assets as asset
  set status = 'generating'
  where asset.id = p_asset_id and asset.status = 'draft';
  return query select v_attempt_id, 'planned'::text, 0;
end;
$$;

create or replace function public.transition_character_generation(
  p_attempt_id uuid, p_expected_status text, p_next_status text,
  p_expected_attempt_count integer, p_provider_operation text,
  p_provider_transport text, p_provider_job_id text,
  p_provider_schema_fingerprint text, p_last_error_code text,
  p_storage_path text, p_sha256 text, p_width integer, p_height integer,
  p_has_transparency boolean, p_metadata jsonb
)
returns table (generation_attempt_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.character_generation_attempts%rowtype;
  v_asset public.character_assets%rowtype;
  v_next_attempt_count integer;
begin
  select attempt.* into v_attempt from public.character_generation_attempts as attempt
  where attempt.id = p_attempt_id for update;
  if not found then raise exception 'character generation not found' using errcode = 'P0002'; end if;
  if v_attempt.status <> p_expected_status
    or v_attempt.attempt_count <> p_expected_attempt_count then
    return query select v_attempt.id, 'conflict'::text, v_attempt.attempt_count;
    return;
  end if;
  select asset.* into strict v_asset from public.character_assets as asset
  where asset.id = v_attempt.character_asset_id for update;
  if p_next_status = 'ready' and (
    p_storage_path is null or p_sha256 is null or p_width is null or p_height is null
    or p_has_transparency is null or p_metadata is null
  ) then
    raise exception 'ready character generation metadata is incomplete' using errcode = '22023';
  end if;
  if p_next_status = 'ready' and p_storage_path <>
    v_asset.project_id::text || '/' || v_asset.id::text || '/' || v_attempt.generation_id::text || '/' || p_sha256 || '.png' then
    raise exception 'invalid character asset storage path' using errcode = '22023';
  end if;
  v_next_attempt_count := v_attempt.attempt_count
    + case when p_next_status = 'queued' then 1 else 0 end;
  update public.character_generation_attempts set
    status = p_next_status, attempt_count = v_next_attempt_count,
    provider_operation = coalesce(p_provider_operation, provider_operation),
    provider_transport = coalesce(p_provider_transport, provider_transport),
    provider_job_id = coalesce(p_provider_job_id, provider_job_id),
    provider_schema_fingerprint = coalesce(p_provider_schema_fingerprint, provider_schema_fingerprint),
    last_error_code = p_last_error_code,
    storage_path = case when p_next_status = 'ready' then p_storage_path else storage_path end,
    sha256 = case when p_next_status = 'ready' then p_sha256 else sha256 end,
    width = case when p_next_status = 'ready' then p_width else width end,
    height = case when p_next_status = 'ready' then p_height else height end,
    has_transparency = case when p_next_status = 'ready' then p_has_transparency else has_transparency end,
    metadata = coalesce(p_metadata, metadata)
  where id = p_attempt_id;
  update public.character_assets as asset set
    status = case
      when p_next_status in ('queued', 'generating') then 'generating'
      when p_next_status in ('ready', 'failed', 'blocked') then p_next_status
      else asset.status end,
    latest_generation_attempt_id = case when p_next_status = 'ready' then p_attempt_id
      else asset.latest_generation_attempt_id end
  where asset.id = v_attempt.character_asset_id;
  return query select p_attempt_id, p_next_status, v_next_attempt_count;
end;
$$;
