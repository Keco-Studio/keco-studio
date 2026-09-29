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
    row_number() over (
      partition by revision.map_project_id
      order by revision.revision_number, revision.created_at, revision.id
    )::bigint as version_number
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
    revision.version_number,
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
set map_version_number = versioned.version_number,
    plan_version_id = plan_version.id
from versioned_revisions as versioned
join inserted_plan_versions as plan_version
  on plan_version.map_project_id = versioned.map_project_id
  and plan_version.draft_revision_id = versioned.id
where revision.id = versioned.id;

alter table public.map_revisions
  add constraint map_revisions_plan_map_version_pair_check
  check (
    (map_version_number is null and plan_version_id is null)
    or (
      schema_version = 3
      and status <> 'draft'
      and map_version_number is not null
      and plan_version_id is not null
    )
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
    or new.save_version <> old.save_version
    or new.source_document_id <> old.source_document_id
    or new.source_document_updated_at <> old.source_document_updated_at
    or new.source_epoch <> old.source_epoch
    or new.source_revision <> old.source_revision
    or new.schema_version <> old.schema_version
    or new.map_version_number is distinct from old.map_version_number
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

-- Keep the obsolete signature callable by internal legacy code only, but do
-- not allow it to publish an unbound generated Map.
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
begin
  return query select 'conflict'::text, null::uuid, null::uuid;
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
  v_next_map_version_number bigint;
begin
  select * into v_map
  from public.map_projects
  where id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);
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
    or v_plan_version.plan is distinct from v_draft.plan then
    return query select 'conflict'::text, null::uuid, null::uuid, null::bigint;
    return;
  end if;

  select coalesce(max(revision.revision_number), 0) + 1
  into v_next_revision_number
  from public.map_revisions as revision
  where revision.map_project_id = p_map_id
    and revision.schema_version = 3;
  select coalesce(max(revision.map_version_number), 0) + 1
  into v_next_map_version_number
  from public.map_revisions as revision
  where revision.map_project_id = p_map_id
    and revision.schema_version = 3
    and revision.map_version_number is not null;

  update public.map_revisions
  set status = 'generating',
      map_version_number = v_next_map_version_number,
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
    v_next_map_version_number;
end;
$$;

revoke all on function public.save_map_plan_v3(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_map_revision_v3(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_map_revision_v3(uuid, uuid, bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.save_map_plan_v3(uuid, uuid, bigint) to authenticated;
grant execute on function public.publish_map_revision_v3(uuid, uuid, bigint, uuid) to authenticated;

notify pgrst, 'reload schema';
