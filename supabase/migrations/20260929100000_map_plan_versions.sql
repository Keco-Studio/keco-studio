-- Persist immutable V3 Plan snapshots independently from generated Map versions.

create table public.map_plan_versions (
  id uuid primary key default gen_random_uuid(),
  map_project_id uuid not null references public.map_projects(id) on delete cascade,
  plan_version_number bigint not null check (plan_version_number > 0),
  draft_revision_id uuid not null,
  draft_save_version bigint not null check (draft_save_version >= 0),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  source_document_id uuid references public.documents(id) on delete no action deferrable initially deferred,
  source_document_updated_at timestamptz,
  source_epoch bigint check (source_epoch >= 0),
  source_revision bigint check (source_revision >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (map_project_id, plan_version_number),
  unique (map_project_id, draft_revision_id, draft_save_version),
  unique (id, map_project_id),
  check (
    (source_document_id is null and source_document_updated_at is null
      and source_epoch is null and source_revision is null)
    or
    (source_document_id is not null and source_document_updated_at is not null
      and source_epoch is not null and source_revision is not null)
  )
);

create index map_plan_versions_map_project_id_idx
  on public.map_plan_versions(map_project_id);

create function public.prevent_map_plan_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'map plan versions are immutable' using errcode = '23514';
end;
$$;

create trigger map_plan_versions_immutable
  before update on public.map_plan_versions
  for each row execute function public.prevent_map_plan_version_mutation();

alter table public.map_plan_versions enable row level security;

create policy map_plan_versions_select on public.map_plan_versions for select using (
  exists (
    select 1
    from public.map_projects as map
    where map.id = map_plan_versions.map_project_id
      and (
        public.is_project_owner(map.project_id, (select auth.uid()))
        or public.is_accepted_collaborator(map.project_id, (select auth.uid()))
      )
  )
);

revoke all on public.map_plan_versions from public, anon, authenticated;
grant select on public.map_plan_versions to authenticated;

alter table public.map_revisions
  add column if not exists map_version_number bigint;
alter table public.map_revisions
  add column if not exists plan_version_id uuid;

alter table public.map_revisions
  add constraint map_revisions_map_version_number_check
  check (map_version_number is null or map_version_number > 0);

-- Existing generated V3 revisions predate explicit Plan versions. Preserve
-- their historical ordering while binding each to a copied immutable Plan.
with versioned_revisions as (
  select
    revision.id,
    revision.map_project_id,
    revision.save_version,
    revision.plan,
    revision.source_document_id,
    revision.source_document_updated_at,
    revision.source_epoch,
    revision.source_revision,
    revision.created_by,
    revision.created_at,
    revision.status,
    row_number() over (
      partition by revision.map_project_id
      order by revision.revision_number, revision.created_at, revision.id
    )::bigint as plan_version_number,
    sum(case when revision.status = 'ready' then 1 else 0 end) over (
      partition by revision.map_project_id
      order by revision.revision_number, revision.created_at, revision.id
    )::bigint as map_version_number
  from public.map_revisions as revision
  where revision.schema_version = 3
    and revision.status <> 'draft'
), inserted_plan_versions as (
  insert into public.map_plan_versions (
    map_project_id,
    plan_version_number,
    draft_revision_id,
    draft_save_version,
    plan,
    source_document_id,
    source_document_updated_at,
    source_epoch,
    source_revision,
    created_by,
    created_at
  )
  select
    revision.map_project_id,
    revision.plan_version_number,
    revision.id,
    revision.save_version,
    revision.plan,
    revision.source_document_id,
    revision.source_document_updated_at,
    revision.source_epoch,
    revision.source_revision,
    revision.created_by,
    revision.created_at
  from versioned_revisions as revision
  returning id, map_project_id, draft_revision_id, plan_version_number
)
update public.map_revisions as revision
set map_version_number = case
      when versioned.status = 'ready' then versioned.map_version_number
      else null
    end,
    plan_version_id = plan_version.id
from versioned_revisions as versioned
join inserted_plan_versions as plan_version
  on plan_version.map_project_id = versioned.map_project_id
  and plan_version.draft_revision_id = versioned.id
where revision.id = versioned.id;

alter table public.map_revisions
  add constraint map_revisions_generated_v3_plan_binding_check
  check (
    (schema_version = 3 and status <> 'draft' and plan_version_id is not null)
    or ((schema_version <> 3 or status = 'draft') and plan_version_id is null)
  );
alter table public.map_revisions
  add constraint map_revisions_ready_v3_map_version_check
  check (
    (schema_version = 3 and status = 'ready' and map_version_number is not null)
    or ((schema_version <> 3 or status <> 'ready') and map_version_number is null)
  );

create unique index map_revisions_map_version_number_idx
  on public.map_revisions(map_project_id, map_version_number)
  where map_version_number is not null;

alter table public.map_revisions
  add constraint map_revisions_plan_version_map_fk
  foreign key (plan_version_id, map_project_id)
  references public.map_plan_versions(id, map_project_id)
  on delete cascade;

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
    or new.save_version is distinct from old.save_version
    or new.source_document_id is distinct from old.source_document_id
    or new.source_document_updated_at is distinct from old.source_document_updated_at
    or new.source_epoch is distinct from old.source_epoch
    or new.source_revision is distinct from old.source_revision
    or new.schema_version is distinct from old.schema_version
    or (
      new.map_version_number is distinct from old.map_version_number
      and not (
        old.map_version_number is null
        and new.map_version_number is not null
        and new.status = 'ready'
      )
    )
    or new.plan_version_id is distinct from old.plan_version_id
  ) then
    raise exception 'published map revision payload is immutable' using errcode = '23514';
  end if;

  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'published map revision cannot return to draft' using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.save_map_plan_v3(
  p_map_id uuid,
  p_draft_revision_id uuid,
  p_expected_save_version bigint
)
returns table (
  status text,
  plan_version_id uuid,
  plan_version_number bigint,
  draft_save_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_draft public.map_revisions%rowtype;
  v_user_id uuid;
  v_next_plan_version bigint;
  v_plan_version_id uuid;
begin
  select * into v_map
  from public.map_projects
  where id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);

  if p_expected_save_version is null then
    return query select 'conflict'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  if v_map.current_revision_id is distinct from p_draft_revision_id then
    return query select 'conflict'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  select * into v_draft
  from public.map_revisions
  where id = p_draft_revision_id
    and map_project_id = p_map_id
    and schema_version = 3
  for update;
  if not found or v_draft.status <> 'draft'
    or v_draft.save_version <> p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;
  perform public.map_validate_v3_payload(v_draft.plan, v_draft.scene);

  select version.id, version.plan_version_number
  into v_plan_version_id, v_next_plan_version
  from public.map_plan_versions as version
  where version.map_project_id = p_map_id
    and version.draft_revision_id = v_draft.id
    and version.draft_save_version = v_draft.save_version;
  if v_plan_version_id is not null then
    return query select
      'saved'::text,
      v_plan_version_id,
      v_next_plan_version,
      v_draft.save_version;
    return;
  end if;

  select coalesce(max(version.plan_version_number), 0) + 1
  into v_next_plan_version
  from public.map_plan_versions as version
  where version.map_project_id = p_map_id;

  insert into public.map_plan_versions (
    map_project_id, plan_version_number, draft_revision_id, draft_save_version,
    plan, source_document_id, source_document_updated_at, source_epoch,
    source_revision, created_by
  ) values (
    p_map_id, v_next_plan_version, v_draft.id, v_draft.save_version,
    v_draft.plan, v_draft.source_document_id, v_draft.source_document_updated_at,
    v_draft.source_epoch, v_draft.source_revision, v_user_id
  ) returning id into v_plan_version_id;

  return query select
    'saved'::text,
    v_plan_version_id,
    v_next_plan_version,
    v_draft.save_version;
end;
$$;

-- Retained callers may reuse an exact explicitly saved snapshot, but only the
-- Save plan RPC is allowed to create one.
create or replace function public.publish_map_revision_v3(
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
  v_plan_version_id uuid;
begin
  select * into v_map
  from public.map_projects
  where id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_map.project_id);

  if p_expected_save_version is null
    or v_map.current_revision_id is distinct from p_draft_revision_id then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_draft
  from public.map_revisions
  where id = p_draft_revision_id
    and map_project_id = p_map_id
    and schema_version = 3
  for update;
  if not found or v_draft.status <> 'draft'
    or v_draft.save_version is distinct from p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

  select version.id into v_plan_version_id
  from public.map_plan_versions as version
  where version.map_project_id = p_map_id
    and version.draft_revision_id = v_draft.id
    and version.draft_save_version = v_draft.save_version
    and version.plan is not distinct from v_draft.plan
    and version.source_document_id is not distinct from v_draft.source_document_id
    and version.source_document_updated_at is not distinct from v_draft.source_document_updated_at
    and version.source_epoch is not distinct from v_draft.source_epoch
    and version.source_revision is not distinct from v_draft.source_revision
  for update;
  if v_plan_version_id is null then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

  return query
  select published.status, published.published_revision_id, published.next_draft_revision_id
  from public.publish_map_revision_v3(
    p_map_id,
    p_draft_revision_id,
    p_expected_save_version,
    v_plan_version_id
  ) as published;
end;
$$;

create function public.publish_map_revision_v3(
  p_map_id uuid,
  p_draft_revision_id uuid,
  p_expected_save_version bigint,
  p_plan_version_id uuid
)
returns table (
  status text,
  published_revision_id uuid,
  next_draft_revision_id uuid,
  map_version_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_draft public.map_revisions%rowtype;
  v_plan_version public.map_plan_versions%rowtype;
  v_user_id uuid;
  v_next_revision_id uuid := gen_random_uuid();
  v_next_revision_number bigint;
begin
  select * into v_map
  from public.map_projects
  where id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);
  if p_expected_save_version is null then
    return query select 'conflict'::text, null::uuid, null::uuid, null::bigint;
    return;
  end if;
  if v_map.current_revision_id is distinct from p_draft_revision_id then
    return query select 'conflict'::text, null::uuid, null::uuid, null::bigint;
    return;
  end if;

  select * into v_draft
  from public.map_revisions
  where id = p_draft_revision_id
    and map_project_id = p_map_id
    and schema_version = 3
  for update;
  if not found or v_draft.status <> 'draft'
    or v_draft.save_version <> p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::uuid, null::bigint;
    return;
  end if;
  perform public.map_validate_v3_payload(v_draft.plan, v_draft.scene);

  select * into v_plan_version
  from public.map_plan_versions
  where id = p_plan_version_id
  for update;
  if not found
    or v_plan_version.map_project_id <> p_map_id
    or v_plan_version.draft_revision_id <> v_draft.id
    or v_plan_version.draft_save_version <> v_draft.save_version
    or v_plan_version.plan is distinct from v_draft.plan
    or v_plan_version.source_document_id is distinct from v_draft.source_document_id
    or v_plan_version.source_document_updated_at is distinct from v_draft.source_document_updated_at
    or v_plan_version.source_epoch is distinct from v_draft.source_epoch
    or v_plan_version.source_revision is distinct from v_draft.source_revision then
    return query select 'conflict'::text, null::uuid, null::uuid, null::bigint;
    return;
  end if;

  select coalesce(max(revision.revision_number), 0) + 1
  into v_next_revision_number
  from public.map_revisions as revision
  where revision.map_project_id = p_map_id
    and revision.schema_version = 3;

  update public.map_revisions
  set status = 'generating',
      plan_version_id = v_plan_version.id
  where id = v_draft.id and schema_version = 3;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_next_revision_id, p_map_id, v_next_revision_number, 0, v_draft.id,
    v_draft.source_document_id, v_draft.source_document_updated_at,
    v_draft.source_epoch, v_draft.source_revision, 3,
    v_draft.plan, v_draft.scene, 'draft', v_user_id
  );
  update public.map_projects
  set current_revision_id = v_next_revision_id, updated_at = now()
  where id = p_map_id;
  return query select
    'published'::text,
    v_draft.id,
    v_next_revision_id,
    null::bigint;
end;
$$;

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
  v_schema_version integer;
  v_expected_path text;
  v_attempt_count integer;
  v_any_unsuccessful boolean;
  v_any_ready boolean;
  v_all_ready boolean;
  v_revision_status text;
  v_next_map_version_number bigint;
begin
  select asset.* into v_asset
  from public.map_assets as asset
  where asset.id = p_asset_id
  for update of asset;
  if not found then raise exception 'asset not found' using errcode = 'P0002'; end if;

  select revision.id, map.id, map.project_id, revision.schema_version
  into v_revision_id, v_map_id, v_project_id, v_schema_version
  from public.map_revisions as revision
  join public.map_projects as map on map.id = revision.map_project_id
  where revision.id = v_asset.map_revision_id
  for update of revision, map;

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
    v_expected_path := format('%s/%s/%s/%s/%s.png',
      v_project_id, v_map_id, v_revision_id, v_asset.asset_key, p_sha256);
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

  v_revision_status := case
    when v_all_ready then 'ready'
    when v_any_unsuccessful and v_any_ready then 'partial'
    when v_any_unsuccessful then 'failed'
    else 'generating'
  end;
  if v_revision_status = 'ready' and v_schema_version = 3 then
    select coalesce(max(revision.map_version_number), 0) + 1
    into v_next_map_version_number
    from public.map_revisions as revision
    where revision.map_project_id = v_map_id
      and revision.schema_version = 3
      and revision.map_version_number is not null;
  end if;

  update public.map_revisions as revision
  set status = v_revision_status,
      map_version_number = case
        when v_revision_status = 'ready' and v_schema_version = 3
          then coalesce(revision.map_version_number, v_next_map_version_number)
        else revision.map_version_number
      end
  where revision.id = v_revision_id and revision.status <> 'draft';

  return query select p_asset_id, p_next_status, v_attempt_count;
end;
$$;

revoke all on function public.save_map_plan_v3(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_map_revision_v3(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_map_revision_v3(uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.save_map_plan_v3(uuid, uuid, bigint) to authenticated;
grant execute on function public.publish_map_revision_v3(uuid, uuid, bigint) to authenticated;
grant execute on function public.publish_map_revision_v3(uuid, uuid, bigint, uuid) to authenticated;

notify pgrst, 'reload schema';
