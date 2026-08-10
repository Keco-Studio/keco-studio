-- Create Map V2 description-first revisions, generation identity, and explicit RPCs.

alter table public.map_revisions
  drop constraint if exists map_revisions_schema_version_check;
alter table public.map_revisions
  add constraint map_revisions_schema_version_check
  check (schema_version in (1, 2));

alter table public.map_revisions
  alter column source_document_id drop not null,
  alter column source_document_updated_at drop not null,
  alter column source_epoch drop not null,
  alter column source_revision drop not null;

alter table public.map_revisions
  add constraint map_revisions_source_tuple_check check (
    (
      schema_version = 1
      and source_document_id is not null
      and source_document_updated_at is not null
      and source_epoch is not null
      and source_revision is not null
    )
    or (
      schema_version = 2
      and (
        (
          source_document_id is null
          and source_document_updated_at is null
          and source_epoch is null
          and source_revision is null
        )
        or (
          source_document_id is not null
          and source_document_updated_at is not null
          and source_epoch is not null
          and source_revision is not null
        )
      )
    )
  );

alter table public.map_assets
  drop constraint if exists map_assets_kind_check;
alter table public.map_assets
  add constraint map_assets_kind_check
  check (kind in ('terrain', 'road', 'object', 'inpaint', 'path', 'obstacle', 'background'));

alter table public.map_assets
  add column generation_id uuid,
  add column plan_fingerprint text
    check (plan_fingerprint is null or plan_fingerprint ~ '^[a-f0-9]{64}$');

create index map_assets_generation_id_idx on public.map_assets(generation_id)
  where generation_id is not null;

create or replace function public.prevent_map_revision_payload_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.map_project_id <> old.map_project_id
    or new.revision_number <> old.revision_number
    or new.parent_revision_id is distinct from old.parent_revision_id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at then
    raise exception 'map revision identity is immutable' using errcode = '23514';
  end if;

  if old.status <> 'draft' and (
    new.plan is distinct from old.plan
    or new.scene is distinct from old.scene
    or new.save_version <> old.save_version
    or new.source_document_id is distinct from old.source_document_id
    or new.source_document_updated_at is distinct from old.source_document_updated_at
    or new.source_epoch is distinct from old.source_epoch
    or new.source_revision is distinct from old.source_revision
    or new.schema_version <> old.schema_version
  ) then
    raise exception 'published map revision payload is immutable' using errcode = '23514';
  end if;

  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'published map revision cannot return to draft' using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.map_validate_v2_payload(p_plan jsonb, p_scene jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_plan) <> 'object'
    or jsonb_typeof(p_scene) <> 'object'
    or p_plan ->> 'schemaVersion' <> '2'
    or p_scene ->> 'schemaVersion' <> '2' then
    raise exception 'V2 plan and scene payloads are required' using errcode = '22023';
  end if;
end;
$$;

create function public.create_map_project_v2(
  p_project_id uuid,
  p_name text,
  p_source_document_id uuid,
  p_source_document_updated_at timestamptz,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (map_id uuid, draft_revision_id uuid, revision_number bigint, save_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_map_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
begin
  v_user_id := public.map_require_writer(p_project_id);
  perform public.map_validate_v2_payload(p_plan, p_scene);

  if not (
    (p_source_document_id is null and p_source_document_updated_at is null and p_source_epoch is null and p_source_revision is null)
    or
    (p_source_document_id is not null and p_source_document_updated_at is not null and p_source_epoch is not null and p_source_revision is not null)
  ) then
    raise exception 'source context must be entirely absent or complete' using errcode = '22023';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.documents
    where id = p_source_document_id and project_id = p_project_id
  ) then
    raise exception 'source document does not belong to project' using errcode = '23503';
  end if;

  insert into public.map_projects (id, project_id, name, created_by)
  values (v_map_id, p_project_id, btrim(p_name), v_user_id);

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_revision_id, v_map_id, 1, 0, null,
    p_source_document_id, p_source_document_updated_at, p_source_epoch, p_source_revision,
    2, p_plan, p_scene, 'draft', v_user_id
  );

  update public.map_projects
  set current_revision_id = v_revision_id, updated_at = now()
  where id = v_map_id;
  return query select v_map_id, v_revision_id, 1::bigint, 0::bigint;
end;
$$;

create function public.save_map_draft_v2(
  p_map_id uuid,
  p_revision_id uuid,
  p_expected_save_version bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (status text, save_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_save_version bigint;
begin
  select project_id into v_project_id from public.map_projects where id = p_map_id;
  if v_project_id is null then raise exception 'map not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_project_id);
  perform public.map_validate_v2_payload(p_plan, p_scene);

  update public.map_revisions as revision
  set plan = p_plan,
      scene = p_scene,
      save_version = revision.save_version + 1
  where revision.id = p_revision_id
    and revision.map_project_id = p_map_id
    and revision.schema_version = 2
    and revision.status = 'draft'
    and revision.save_version = p_expected_save_version
    and exists (
      select 1 from public.map_projects
      where id = p_map_id and current_revision_id = p_revision_id
    )
  returning revision.save_version into v_save_version;

  if v_save_version is null then
    return query select 'conflict'::text, null::bigint;
    return;
  end if;

  update public.map_projects
  set name = btrim(p_plan ->> 'name'), updated_at = now()
  where id = p_map_id;
  return query select 'saved'::text, v_save_version;
end;
$$;

create function public.publish_map_revision_v2(
  p_map_id uuid,
  p_draft_revision_id uuid,
  p_expected_save_version bigint
)
returns table (status text, published_revision_id uuid, next_draft_revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_draft public.map_revisions%rowtype;
  v_user_id uuid;
  v_next_revision_id uuid := gen_random_uuid();
  v_next_revision_number bigint;
begin
  select * into v_map from public.map_projects where id = p_map_id for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);
  if v_map.current_revision_id is distinct from p_draft_revision_id then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_draft
  from public.map_revisions
  where id = p_draft_revision_id
    and map_project_id = p_map_id
    and schema_version = 2
  for update;
  if not found or v_draft.status <> 'draft' or v_draft.save_version <> p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;
  perform public.map_validate_v2_payload(v_draft.plan, v_draft.scene);

  update public.map_revisions set status = 'generating' where id = v_draft.id;
  select coalesce(max(revision.revision_number), 0) + 1 into v_next_revision_number
  from public.map_revisions as revision where revision.map_project_id = p_map_id;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_next_revision_id, p_map_id, v_next_revision_number, 0, v_draft.id,
    v_draft.source_document_id, v_draft.source_document_updated_at,
    v_draft.source_epoch, v_draft.source_revision, 2,
    v_draft.plan, v_draft.scene, 'draft', v_user_id
  );
  update public.map_projects
  set current_revision_id = v_next_revision_id, updated_at = now()
  where id = p_map_id;
  return query select 'published'::text, v_draft.id, v_next_revision_id;
end;
$$;

create function public.create_map_asset_plan_v2(
  p_revision_id uuid,
  p_generation_id uuid,
  p_asset_key text,
  p_kind text,
  p_prompt text,
  p_requested_capability text,
  p_generation_params jsonb,
  p_reference_asset_ids uuid[],
  p_reference_hashes text[],
  p_plan_fingerprint text,
  p_metadata jsonb
)
returns table (asset_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_revision_status text;
  v_asset public.map_assets%rowtype;
begin
  select map.project_id, revision.status into v_project_id, v_revision_status
  from public.map_revisions as revision
  join public.map_projects as map on map.id = revision.map_project_id
  where revision.id = p_revision_id and revision.schema_version = 2;
  if v_project_id is null then raise exception 'V2 revision not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_project_id);
  if v_revision_status not in ('generating', 'partial', 'failed') then
    raise exception 'revision is not accepting asset plans' using errcode = '23514';
  end if;
  if p_kind not in ('terrain', 'path', 'obstacle', 'background') then
    raise exception 'unsupported V2 asset kind' using errcode = '22023';
  end if;
  if p_generation_id is null then
    raise exception 'generation identity is required' using errcode = '22023';
  end if;
  if p_plan_fingerprint is null or p_plan_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid plan fingerprint' using errcode = '22023';
  end if;

  insert into public.map_assets (
    map_revision_id, generation_id, asset_key, kind, status,
    requested_capability, prompt, generation_params, reference_asset_ids,
    reference_hashes, plan_fingerprint, metadata
  ) values (
    p_revision_id, p_generation_id, p_asset_key, p_kind, 'planned',
    p_requested_capability, p_prompt, coalesce(p_generation_params, '{}'::jsonb),
    coalesce(p_reference_asset_ids, '{}'), coalesce(p_reference_hashes, '{}'),
    p_plan_fingerprint, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (map_revision_id, asset_key) do nothing
  returning * into v_asset;

  if v_asset.id is null then
    select * into v_asset from public.map_assets
    where map_revision_id = p_revision_id and asset_key = p_asset_key;
    if v_asset.generation_id is distinct from p_generation_id
      or v_asset.kind <> p_kind
      or v_asset.prompt <> p_prompt
      or v_asset.requested_capability is distinct from p_requested_capability
      or v_asset.generation_params <> coalesce(p_generation_params, '{}'::jsonb)
      or v_asset.reference_asset_ids <> coalesce(p_reference_asset_ids, '{}'::uuid[])
      or v_asset.reference_hashes <> coalesce(p_reference_hashes, '{}'::text[])
      or v_asset.plan_fingerprint <> p_plan_fingerprint
      or not (v_asset.metadata @> coalesce(p_metadata, '{}'::jsonb)) then
      raise exception 'asset key already has a different immutable V2 plan' using errcode = '23505';
    end if;
  end if;
  return query select v_asset.id, v_asset.status;
end;
$$;

revoke all on function public.map_validate_v2_payload(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_map_project_v2(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.save_map_draft_v2(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.publish_map_revision_v2(uuid, uuid, bigint) from public, anon;
revoke all on function public.create_map_asset_plan_v2(uuid, uuid, text, text, text, text, jsonb, uuid[], text[], text, jsonb) from public, anon;

grant execute on function public.create_map_project_v2(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.save_map_draft_v2(uuid, uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.publish_map_revision_v2(uuid, uuid, bigint) to authenticated;
grant execute on function public.create_map_asset_plan_v2(uuid, uuid, text, text, text, text, jsonb, uuid[], text[], text, jsonb) to authenticated;
