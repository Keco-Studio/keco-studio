-- Close MCP map idempotency and paid-generation transaction gaps.

alter table public.map_creation_requests
  alter column map_id drop not null,
  alter column revision_id drop not null;

alter table public.map_creation_requests
  add column project_id uuid references public.projects(id) on delete cascade,
  add column status text not null default 'completed'
    check (status in ('planning', 'completed')),
  add column claim_token uuid,
  add column updated_at timestamptz not null default now();

update public.map_creation_requests as request
set project_id = map.project_id
from public.map_projects as map
where map.id = request.map_id;

alter table public.map_creation_requests
  alter column project_id set not null;

drop function public.create_map_project_v3_idempotent(
  uuid, uuid, text, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb
);

alter table public.map_creation_requests
  add constraint map_creation_requests_state_check check (
    (status = 'planning' and project_id is not null and claim_token is not null
      and map_id is null and revision_id is null)
    or
    (status = 'completed' and project_id is not null
      and map_id is not null and revision_id is not null)
  );

create function public.claim_map_project_v3_creation(
  p_project_id uuid,
  p_idempotency_key uuid,
  p_intent_hash text
)
returns table (
  claim_status text,
  request_token uuid,
  map_id uuid,
  revision_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.map_creation_requests%rowtype;
  v_token uuid;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform public.map_require_writer(p_project_id);
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_intent_hash is null or p_intent_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'intent hash must be lowercase SHA-256' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_id::text || ':' || p_idempotency_key::text, 0)
  );
  select request.* into v_request
  from public.map_creation_requests as request
  where request.actor_id = v_actor_id
    and request.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.input_hash <> p_intent_hash
      or v_request.project_id <> p_project_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KM409';
    end if;
    if v_request.status = 'completed' then
      return query select 'completed'::text, null::uuid,
        v_request.map_id, v_request.revision_id;
      return;
    end if;
    if v_request.updated_at > now() - interval '5 minutes' then
      return query select 'in_progress'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    v_token := gen_random_uuid();
    update public.map_creation_requests as request
    set claim_token = v_token, project_id = p_project_id, updated_at = now()
    where request.actor_id = v_actor_id
      and request.idempotency_key = p_idempotency_key;
    return query select 'claimed'::text, v_token, null::uuid, null::uuid;
    return;
  end if;

  v_token := gen_random_uuid();
  insert into public.map_creation_requests (
    actor_id, idempotency_key, input_hash, project_id, status, claim_token
  ) values (
    v_actor_id, p_idempotency_key, p_intent_hash, p_project_id, 'planning', v_token
  );
  return query select 'claimed'::text, v_token, null::uuid, null::uuid;
end;
$$;

create function public.complete_map_project_v3_creation(
  p_idempotency_key uuid,
  p_request_token uuid,
  p_name text,
  p_source_document_id uuid,
  p_source_document_updated_at timestamptz,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (
  map_id uuid,
  draft_revision_id uuid,
  revision_number bigint,
  save_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.map_creation_requests%rowtype;
  v_created record;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select request.* into v_request
  from public.map_creation_requests as request
  where request.actor_id = v_actor_id
    and request.idempotency_key = p_idempotency_key
  for update;
  if not found or v_request.status <> 'planning'
    or v_request.claim_token is distinct from p_request_token then
    raise exception 'map creation claim is not active' using errcode = 'KM410';
  end if;

  select * into strict v_created
  from public.create_map_project_v3(
    v_request.project_id,
    p_name,
    p_source_document_id,
    p_source_document_updated_at,
    p_source_epoch,
    p_source_revision,
    p_plan,
    p_scene
  );

  update public.map_creation_requests as request
  set status = 'completed',
      claim_token = null,
      map_id = v_created.map_id,
      revision_id = v_created.draft_revision_id,
      updated_at = now()
  where request.actor_id = v_actor_id
    and request.idempotency_key = p_idempotency_key;

  return query select
    v_created.map_id::uuid,
    v_created.draft_revision_id::uuid,
    v_created.revision_number::bigint,
    v_created.save_version::bigint;
end;
$$;

create function public.release_map_project_v3_creation(
  p_idempotency_key uuid,
  p_request_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from public.map_creation_requests as request
  where request.actor_id = v_actor_id
    and request.idempotency_key = p_idempotency_key
    and request.status = 'planning'
    and request.claim_token = p_request_token;
  return found;
end;
$$;

create function public.prepare_map_generation_v3(
  p_map_id uuid,
  p_revision_id uuid,
  p_expected_save_version bigint,
  p_generation_id uuid,
  p_plan_fingerprint text
)
returns table (
  published_revision_id uuid,
  next_draft_revision_id uuid,
  asset_id uuid,
  asset_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_revision public.map_revisions%rowtype;
  v_existing public.map_assets%rowtype;
  v_published record;
  v_created record;
  v_next_revision_id uuid;
begin
  select map.* into v_map
  from public.map_projects as map
  where map.id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_map.project_id);

  select revision.* into v_revision
  from public.map_revisions as revision
  where revision.id = p_revision_id
    and revision.map_project_id = p_map_id
    and revision.schema_version = 3
  for update;
  if not found then raise exception 'V3 revision not found' using errcode = 'P0002'; end if;
  if v_revision.save_version <> p_expected_save_version then
    raise exception 'save_conflict' using errcode = 'KM412';
  end if;

  select asset.* into v_existing
  from public.map_assets as asset
  where asset.map_revision_id = p_revision_id
    and asset.asset_key = 'map-image'
    and asset.kind = 'map_image'
  for update;
  if found then
    if v_existing.generation_id is distinct from p_generation_id
      or v_existing.plan_fingerprint is distinct from p_plan_fingerprint then
      raise exception 'generation identity conflict' using errcode = 'KM413';
    end if;
    select child.id into v_next_revision_id
    from public.map_revisions as child
    where child.id = v_map.current_revision_id
      and child.parent_revision_id = p_revision_id;
    return query select p_revision_id, v_next_revision_id,
      v_existing.id, v_existing.status;
    return;
  end if;

  if v_revision.status = 'draft' and v_map.current_revision_id = p_revision_id then
    select * into strict v_published
    from public.publish_map_revision_v3(
      p_map_id, p_revision_id, p_expected_save_version
    );
    if v_published.status <> 'published' then
      raise exception 'save_conflict' using errcode = 'KM412';
    end if;
    v_next_revision_id := v_published.next_draft_revision_id;
  elsif v_revision.status = 'generating'
    and not exists (
      select 1 from public.map_assets as missing_asset
      where missing_asset.map_revision_id = p_revision_id
        and missing_asset.asset_key = 'map-image'
        and missing_asset.kind = 'map_image'
    ) then
    select child.id into v_next_revision_id
    from public.map_revisions as child
    where child.id = v_map.current_revision_id
      and child.parent_revision_id = p_revision_id
      and child.schema_version = 3
      and child.status = 'draft';
    if v_next_revision_id is null then
      raise exception 'save_conflict' using errcode = 'KM412';
    end if;
  else
    raise exception 'save_conflict' using errcode = 'KM412';
  end if;

  select * into strict v_created
  from public.create_map_asset_plan_v3(
    p_revision_id, p_generation_id, p_plan_fingerprint
  );
  return query select p_revision_id, v_next_revision_id,
    v_created.asset_id::uuid, v_created.status::text;
end;
$$;

create function public.transition_map_asset_confirmed(
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
  p_metadata jsonb,
  p_expected_attempt_count integer
)
returns table (asset_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.map_assets%rowtype;
begin
  if p_expected_attempt_count is null or p_expected_attempt_count < 0 then
    raise exception 'expected attempt count is required' using errcode = '22023';
  end if;
  select asset.* into v_asset
  from public.map_assets as asset
  where asset.id = p_asset_id
  for update of asset;
  if not found then raise exception 'asset not found' using errcode = 'P0002'; end if;
  if v_asset.status <> p_expected_status
    or v_asset.attempt_count <> p_expected_attempt_count then
    return query select v_asset.id, 'conflict'::text, v_asset.attempt_count;
    return;
  end if;
  return query
  select transition.asset_id, transition.status, transition.attempt_count
  from public.transition_map_asset(
    p_asset_id,
    p_expected_status,
    p_next_status,
    p_provider_operation,
    p_provider_transport,
    p_provider_job_id,
    p_last_error_code,
    p_storage_path,
    p_sha256,
    p_width,
    p_height,
    p_has_transparency,
    p_metadata
  ) as transition;
end;
$$;

create function public.list_latest_readable_game_design_system_versions(
  p_system_ids uuid[]
)
returns table (
  id uuid,
  system_id uuid,
  version_number integer,
  parent_version_id uuid,
  document jsonb,
  rules jsonb,
  art_style jsonb,
  rendered_markdown text,
  diff jsonb,
  conflicts jsonb,
  content_hash text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
begin
  if cardinality(coalesce(p_system_ids, '{}'::uuid[])) > 101 then
    raise exception 'too many Game Design System ids' using errcode = '22023';
  end if;
  return query
  select distinct on (version.system_id)
    version.id,
    version.system_id,
    version.version_number,
    version.parent_version_id,
    version.document,
    version.rules,
    version.art_style,
    version.rendered_markdown,
    version.diff,
    version.conflicts,
    version.content_hash,
    version.created_by,
    version.created_at
  from public.game_design_system_versions as version
  where version.system_id = any(coalesce(p_system_ids, '{}'::uuid[]))
  order by version.system_id, version.version_number desc, version.id;
end;
$$;

revoke all on table public.map_creation_requests from public, anon, authenticated, service_role;

revoke all on function public.claim_map_project_v3_creation(uuid, uuid, text) from public, anon, service_role;
revoke all on function public.complete_map_project_v3_creation(uuid, uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.release_map_project_v3_creation(uuid, uuid) from public, anon, service_role;
revoke all on function public.prepare_map_generation_v3(uuid, uuid, bigint, uuid, text) from public, anon, service_role;
revoke all on function public.transition_map_asset_confirmed(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb, integer) from public, anon, authenticated;
revoke all on function public.list_latest_readable_game_design_system_versions(uuid[]) from public, anon;

grant execute on function public.claim_map_project_v3_creation(uuid, uuid, text) to authenticated;
grant execute on function public.complete_map_project_v3_creation(uuid, uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.release_map_project_v3_creation(uuid, uuid) to authenticated;
grant execute on function public.prepare_map_generation_v3(uuid, uuid, bigint, uuid, text) to authenticated;
grant execute on function public.transition_map_asset_confirmed(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb, integer) to service_role;
grant execute on function public.list_latest_readable_game_design_system_versions(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
