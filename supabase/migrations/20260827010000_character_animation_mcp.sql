-- Durable text-to-character and character-to-animation generation for Keco MCP.

create extension if not exists "pgcrypto";

create table public.character_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('character', 'animation')),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  save_version bigint not null default 0 check (save_version >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'ready', 'failed', 'blocked')),
  source_character_asset_id uuid references public.character_assets(id) on delete restrict,
  idempotency_key uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  plan_fingerprint text not null check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  latest_generation_attempt_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key),
  check ((kind = 'character' and source_character_asset_id is null)
    or (kind = 'animation' and source_character_asset_id is not null))
);

create table public.character_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  character_asset_id uuid not null references public.character_assets(id) on delete cascade,
  generation_id uuid not null unique,
  plan_fingerprint text not null check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'queued', 'generating', 'ready', 'failed', 'blocked')),
  requested_capability text not null check (requested_capability in ('character-pro', 'animate-character-v3')),
  provider_operation text,
  provider_transport text check (provider_transport is null or provider_transport in ('mcp', 'rest')),
  provider_job_id text,
  provider_schema_fingerprint text check (
    provider_schema_fingerprint is null or provider_schema_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  last_error_code text,
  storage_path text check (
    storage_path is null
    or storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-f0-9]{64}\.png$'
  ),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  has_transparency boolean,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_asset_id, generation_id)
);

alter table public.character_assets
  add constraint character_assets_latest_attempt_fk
  foreign key (latest_generation_attempt_id)
  references public.character_generation_attempts(id) on delete set null;

create index character_assets_project_id_idx on public.character_assets(project_id);
create index character_assets_source_idx on public.character_assets(source_character_asset_id);
create index character_generation_attempts_asset_idx
  on public.character_generation_attempts(character_asset_id, created_at desc);

create trigger character_assets_updated_at before update on public.character_assets
  for each row execute function public.update_updated_at_column();
create trigger character_generation_attempts_updated_at before update on public.character_generation_attempts
  for each row execute function public.update_updated_at_column();

create function public.character_validate_asset_plan_v1(p_plan jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_prompt text;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
    or p_plan ->> 'schemaVersion' <> '1'
    or p_plan ->> 'kind' not in ('character', 'animation')
    or jsonb_typeof(p_plan -> 'name') is distinct from 'string'
    or not (char_length(btrim(p_plan ->> 'name')) between 1 and 160) then
    raise exception 'invalid character asset plan' using errcode = '22023';
  end if;
  v_kind := p_plan ->> 'kind';

  if v_kind = 'character' then
    if not (p_plan ?& array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent'])
      or p_plan - array['schemaVersion', 'kind', 'name', 'description', 'perspective', 'facing', 'width', 'height', 'transparent'] <> '{}'::jsonb
      or p_plan ->> 'perspective' not in ('topdown', 'platformer', 'isometric')
      or p_plan ->> 'facing' not in ('front', 'back', 'left', 'right')
      or (p_plan ->> 'width')::integer not in (32, 64, 96, 128)
      or (p_plan ->> 'height')::integer <> (p_plan ->> 'width')::integer
      or p_plan -> 'transparent' <> 'true'::jsonb then
      raise exception 'invalid character plan' using errcode = '22023';
    end if;
    v_prompt := p_plan ->> 'description';
  else
    if not (p_plan ?& array['schemaVersion', 'kind', 'name', 'sourceCharacterAssetId', 'sourceCharacterSha256', 'motionDescription', 'frameWidth', 'frameHeight', 'frameCount', 'fps', 'loop'])
      or p_plan - array['schemaVersion', 'kind', 'name', 'sourceCharacterAssetId', 'sourceCharacterSha256', 'motionDescription', 'frameWidth', 'frameHeight', 'frameCount', 'fps', 'loop'] <> '{}'::jsonb
      or coalesce(p_plan ->> 'sourceCharacterAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(p_plan ->> 'sourceCharacterSha256', '') !~ '^[a-f0-9]{64}$'
      or not ((p_plan ->> 'frameWidth')::integer between 16 and 256)
      or ((p_plan ->> 'frameWidth')::integer % 4) <> 0
      or not ((p_plan ->> 'frameHeight')::integer between 16 and 256)
      or ((p_plan ->> 'frameHeight')::integer % 4) <> 0
      or not ((p_plan ->> 'frameCount')::integer between 4 and 16)
      or ((p_plan ->> 'frameCount')::integer % 2) <> 0
      or not ((p_plan ->> 'fps')::integer between 1 and 60)
      or jsonb_typeof(p_plan -> 'loop') is distinct from 'boolean' then
      raise exception 'invalid animation plan' using errcode = '22023';
    end if;
    v_prompt := p_plan ->> 'motionDescription';
  end if;

  if v_prompt is null or not (char_length(v_prompt) between 1 and 2000)
    or char_length(btrim(v_prompt)) = 0
    or v_prompt ~* 'https://|http://|www\.'
    or v_prompt ~* '\y(?:pixellab|mcp|api|create_character|animate_character|animate_image|animate_with_text)\y'
    or v_prompt ~* '\y(?:api\s*key|authorization|bearer|password|token)\y\s*[:=]?' then
    raise exception 'unsafe character asset prompt' using errcode = '22023';
  end if;
end;
$$;

create function public.character_require_writer(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not (
    public.is_project_owner(p_project_id, v_actor_id)
    or public.is_editor_or_admin_collaborator(p_project_id, v_actor_id)
  ) then
    raise exception 'character asset write access denied' using errcode = '42501';
  end if;
  return v_actor_id;
end;
$$;

create function public.create_character_asset_draft(
  p_project_id uuid, p_plan jsonb, p_idempotency_key uuid,
  p_input_hash text, p_plan_fingerprint text
)
returns table (asset_id uuid, save_version bigint, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_existing public.character_assets%rowtype;
  v_asset_id uuid;
  v_source_id uuid;
begin
  v_actor_id := public.character_require_writer(p_project_id);
  perform public.character_validate_asset_plan_v1(p_plan);
  if p_input_hash !~ '^[a-f0-9]{64}$' or p_plan_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid character asset hash' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor_id::text || ':' || p_idempotency_key::text, 0));
  select asset.* into v_existing from public.character_assets as asset
  where asset.created_by = v_actor_id and asset.idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.project_id <> p_project_id or v_existing.input_hash <> p_input_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KM409';
    end if;
    return query select v_existing.id, v_existing.save_version, false;
    return;
  end if;
  v_source_id := case when p_plan ->> 'kind' = 'animation'
    then (p_plan ->> 'sourceCharacterAssetId')::uuid else null end;
  insert into public.character_assets (
    project_id, kind, name, plan, source_character_asset_id, idempotency_key,
    input_hash, plan_fingerprint, created_by
  ) values (
    p_project_id, p_plan ->> 'kind', btrim(p_plan ->> 'name'), p_plan,
    v_source_id, p_idempotency_key, p_input_hash, p_plan_fingerprint, v_actor_id
  ) returning id into v_asset_id;
  return query select v_asset_id, 0::bigint, true;
end;
$$;

create function public.update_character_asset_draft(
  p_asset_id uuid, p_expected_save_version bigint,
  p_plan jsonb, p_plan_fingerprint text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_asset public.character_assets%rowtype; v_next bigint;
begin
  select asset.* into v_asset from public.character_assets as asset
  where asset.id = p_asset_id for update;
  if not found then raise exception 'character asset not found' using errcode = 'P0002'; end if;
  perform public.character_require_writer(v_asset.project_id);
  perform public.character_validate_asset_plan_v1(p_plan);
  if v_asset.save_version <> p_expected_save_version or v_asset.status <> 'draft' then
    raise exception 'character asset revision stale' using errcode = 'KM412';
  end if;
  v_next := v_asset.save_version + 1;
  update public.character_assets set
    kind = p_plan ->> 'kind', name = btrim(p_plan ->> 'name'), plan = p_plan,
    source_character_asset_id = case when p_plan ->> 'kind' = 'animation'
      then (p_plan ->> 'sourceCharacterAssetId')::uuid else null end,
    plan_fingerprint = p_plan_fingerprint, save_version = v_next
  where id = p_asset_id and save_version = p_expected_save_version and status = 'draft';
  return v_next;
end;
$$;

create function public.prepare_character_asset_generation(
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
  update public.character_assets
  set status = 'generating'
  where id = p_asset_id and status = 'draft';
  return query select v_attempt_id, 'planned'::text, 0;
end;
$$;

create function public.transition_character_generation(
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
  update public.character_assets set
    status = case
      when p_next_status in ('queued', 'generating') then 'generating'
      when p_next_status in ('ready', 'failed', 'blocked') then p_next_status
      else status end,
    latest_generation_attempt_id = case when p_next_status = 'ready' then p_attempt_id
      else latest_generation_attempt_id end
  where id = v_attempt.character_asset_id;
  return query select p_attempt_id, p_next_status, v_next_attempt_count;
end;
$$;

alter table public.character_assets enable row level security;
alter table public.character_generation_attempts enable row level security;
create policy character_assets_select on public.character_assets for select using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);
create policy character_generation_attempts_select on public.character_generation_attempts for select using (
  exists (select 1 from public.character_assets as asset
    where asset.id = character_generation_attempts.character_asset_id
      and (public.is_project_owner(asset.project_id, (select auth.uid()))
        or public.is_accepted_collaborator(asset.project_id, (select auth.uid()))))
);
revoke all on public.character_assets, public.character_generation_attempts from public, anon, authenticated;
grant select on public.character_assets, public.character_generation_attempts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-assets', 'character-assets', false, 20971520, array['image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy character_assets_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'character-assets'
  and exists (select 1 from public.character_assets as asset
    join public.character_generation_attempts as attempt on attempt.character_asset_id = asset.id
    where asset.project_id::text = (storage.foldername(storage.objects.name))[1]
      and asset.id::text = (storage.foldername(storage.objects.name))[2]
      and attempt.generation_id::text = (storage.foldername(storage.objects.name))[3]
      and attempt.storage_path = storage.objects.name
      and (public.is_project_owner(asset.project_id, (select auth.uid()))
        or public.is_accepted_collaborator(asset.project_id, (select auth.uid()))))
);

alter table public.project_storage_cleanup_jobs drop constraint if exists project_storage_cleanup_jobs_bucket_id_check;
alter table public.project_storage_cleanup_jobs add constraint project_storage_cleanup_jobs_bucket_id_check
  check (bucket_id in ('map-assets', 'character-assets'));

drop function public.delete_project_and_enqueue_storage_cleanup(uuid);
create function public.delete_project_and_enqueue_storage_cleanup(p_project_id uuid)
returns table (cleanup_job_id uuid, character_cleanup_job_id uuid, storage_paths text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleanup_job_id uuid;
  v_character_cleanup_job_id uuid;
  v_reference_paths text[];
  v_map_paths text[];
  v_character_paths text[];
  v_map_storage_paths text[];
begin
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(reference.storage_path order by reference.storage_path), '{}'::text[])
    into v_reference_paths from public.map_reference_images as reference
    where reference.project_id = p_project_id;
  select coalesce(array_agg(asset.storage_path order by asset.storage_path), '{}'::text[])
    into v_map_paths from public.map_assets as asset
    join public.map_revisions as revision on revision.id = asset.map_revision_id
    join public.map_projects as map on map.id = revision.map_project_id
    where map.project_id = p_project_id and asset.storage_path is not null;
  select coalesce(array_agg(attempt.storage_path order by attempt.storage_path), '{}'::text[])
    into v_character_paths from public.character_generation_attempts as attempt
    join public.character_assets as asset on asset.id = attempt.character_asset_id
    where asset.project_id = p_project_id and attempt.storage_path is not null;
  if exists (select 1 from unnest(v_character_paths) as path
    where path not like p_project_id::text || '/%' or path like '%..%') then
    raise exception 'invalid generated character storage path' using errcode = '23514';
  end if;
  v_map_storage_paths := v_reference_paths || v_map_paths;
  if cardinality(v_map_storage_paths) > 0 then
    insert into public.project_storage_cleanup_jobs (project_id, bucket_id, storage_paths)
    values (p_project_id, 'map-assets', v_map_storage_paths) returning id into v_cleanup_job_id;
  end if;
  if cardinality(v_character_paths) > 0 then
    insert into public.project_storage_cleanup_jobs (project_id, bucket_id, storage_paths)
    values (p_project_id, 'character-assets', v_character_paths) returning id into v_character_cleanup_job_id;
  end if;
  delete from public.projects where id = p_project_id;
  return query select v_cleanup_job_id, v_character_cleanup_job_id,
    v_map_storage_paths || v_character_paths;
end;
$$;

revoke all on function public.character_validate_asset_plan_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.character_require_writer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_character_asset_draft(uuid, jsonb, uuid, text, text) from public, anon, service_role;
revoke all on function public.update_character_asset_draft(uuid, bigint, jsonb, text) from public, anon, service_role;
revoke all on function public.prepare_character_asset_generation(uuid, bigint, uuid, text) from public, anon, service_role;
revoke all on function public.transition_character_generation(uuid, text, text, integer, text, text, text, text, text, text, text, integer, integer, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.delete_project_and_enqueue_storage_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.create_character_asset_draft(uuid, jsonb, uuid, text, text) to authenticated;
grant execute on function public.update_character_asset_draft(uuid, bigint, jsonb, text) to authenticated;
grant execute on function public.prepare_character_asset_generation(uuid, bigint, uuid, text) to authenticated;
grant execute on function public.transition_character_generation(uuid, text, text, integer, text, text, text, text, text, text, text, integer, integer, boolean, jsonb) to service_role;
grant execute on function public.delete_project_and_enqueue_storage_cleanup(uuid) to service_role;

notify pgrst, 'reload schema';
