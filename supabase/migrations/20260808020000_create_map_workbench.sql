-- Versioned Create Map projects, immutable generation revisions, and private assets.

create extension if not exists "pgcrypto";

create table public.map_projects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  current_revision_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index map_projects_project_id_idx on public.map_projects(project_id);

create table public.map_revisions (
  id uuid primary key default gen_random_uuid(),
  map_project_id uuid not null references public.map_projects(id) on delete cascade,
  revision_number bigint not null check (revision_number > 0),
  save_version bigint not null default 0 check (save_version >= 0),
  parent_revision_id uuid references public.map_revisions(id) on delete set null,
  source_document_id uuid not null references public.documents(id)
    on delete no action deferrable initially deferred,
  source_document_updated_at timestamptz not null,
  source_epoch bigint not null check (source_epoch >= 0),
  source_revision bigint not null check (source_revision >= 0),
  schema_version integer not null default 1 check (schema_version = 1),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  scene jsonb not null check (jsonb_typeof(scene) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'partial', 'ready', 'failed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (map_project_id, revision_number),
  unique (id, map_project_id)
);

alter table public.map_projects
  add constraint map_projects_current_revision_fk
  foreign key (current_revision_id, id)
  references public.map_revisions(id, map_project_id)
  deferrable initially deferred;

create index map_revisions_map_project_id_idx on public.map_revisions(map_project_id);
create index map_revisions_source_document_id_idx on public.map_revisions(source_document_id);

create table public.map_assets (
  id uuid primary key default gen_random_uuid(),
  map_revision_id uuid not null references public.map_revisions(id) on delete cascade,
  asset_key text not null check (asset_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check (kind in ('terrain', 'road', 'object', 'inpaint')),
  status text not null default 'planned'
    check (status in ('planned', 'queued', 'generating', 'ready', 'failed', 'blocked')),
  requested_capability text,
  provider_operation text,
  provider_transport text check (provider_transport is null or provider_transport in ('mcp', 'rest')),
  prompt text not null check (char_length(prompt) between 1 and 2000),
  generation_params jsonb not null default '{}'::jsonb check (jsonb_typeof(generation_params) = 'object'),
  reference_asset_ids uuid[] not null default '{}',
  reference_hashes text[] not null default '{}',
  provider_job_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  storage_path text check (
    storage_path is null
    or storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9]+(-[a-z0-9]+)*/[a-f0-9]{64}\.png$'
  ),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  has_transparency boolean,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (map_revision_id, asset_key)
);

create index map_assets_map_revision_id_idx on public.map_assets(map_revision_id);
create index map_assets_status_idx on public.map_assets(status);

create trigger map_projects_updated_at
  before update on public.map_projects
  for each row execute function public.update_updated_at_column();

create trigger map_assets_updated_at
  before update on public.map_assets
  for each row execute function public.update_updated_at_column();

create function public.prevent_map_revision_payload_mutation()
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
  ) then
    raise exception 'published map revision payload is immutable' using errcode = '23514';
  end if;

  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'published map revision cannot return to draft' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger map_revisions_immutable_payload
  before update on public.map_revisions
  for each row execute function public.prevent_map_revision_payload_mutation();

alter table public.map_projects enable row level security;
alter table public.map_revisions enable row level security;
alter table public.map_assets enable row level security;

create policy map_projects_select on public.map_projects for select using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);

create policy map_revisions_select on public.map_revisions for select using (
  exists (
    select 1 from public.map_projects as map
    where map.id = map_revisions.map_project_id
      and (
        public.is_project_owner(map.project_id, (select auth.uid()))
        or public.is_accepted_collaborator(map.project_id, (select auth.uid()))
      )
  )
);

create policy map_assets_select on public.map_assets for select using (
  exists (
    select 1
    from public.map_revisions as revision
    join public.map_projects as map on map.id = revision.map_project_id
    where revision.id = map_assets.map_revision_id
      and (
        public.is_project_owner(map.project_id, (select auth.uid()))
        or public.is_accepted_collaborator(map.project_id, (select auth.uid()))
      )
  )
);

revoke all on public.map_projects, public.map_revisions, public.map_assets from public, anon, authenticated;
grant select on public.map_projects, public.map_revisions, public.map_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('map-assets', 'map-assets', false, 20971520, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy map_assets_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'map-assets'
    and array_length(storage.foldername(storage.objects.name), 1) = 4
    and exists (
      select 1
      from public.map_assets as asset
      join public.map_revisions as revision on revision.id = asset.map_revision_id
      join public.map_projects as map on map.id = revision.map_project_id
      where map.project_id::text = (storage.foldername(storage.objects.name))[1]
        and map.id::text = (storage.foldername(storage.objects.name))[2]
        and revision.id::text = (storage.foldername(storage.objects.name))[3]
        and asset.asset_key = (storage.foldername(storage.objects.name))[4]
        and asset.storage_path = storage.objects.name
        and (
          public.is_project_owner(map.project_id, (select auth.uid()))
          or public.is_accepted_collaborator(map.project_id, (select auth.uid()))
        )
    )
  );

-- Mutation RPCs use this non-executable helper to keep authorization identical.
create function public.map_require_writer(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not (
    public.is_project_owner(p_project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(p_project_id, v_user_id)
  ) then
    raise exception 'map write access denied' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

revoke all on function public.map_require_writer(uuid) from public, anon, authenticated;

create function public.create_map_project(
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
  if not exists (
    select 1 from public.documents
    where id = p_source_document_id and project_id = p_project_id
  ) then
    raise exception 'source document does not belong to project' using errcode = '23503';
  end if;
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_scene) <> 'object' then
    raise exception 'plan and scene must be JSON objects' using errcode = '22023';
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
    1, p_plan, p_scene, 'draft', v_user_id
  );

  update public.map_projects set current_revision_id = v_revision_id where id = v_map_id;
  return query select v_map_id, v_revision_id, 1::bigint, 0::bigint;
end;
$$;

create function public.save_map_draft(
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
  if v_project_id is null then
    raise exception 'map not found' using errcode = 'P0002';
  end if;
  perform public.map_require_writer(v_project_id);

  update public.map_revisions as revision
  set plan = p_plan,
      scene = p_scene,
      save_version = revision.save_version + 1
  where revision.id = p_revision_id
    and revision.map_project_id = p_map_id
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
  return query select 'saved'::text, v_save_version;
end;
$$;

create function public.fork_map_draft(
  p_map_id uuid,
  p_parent_revision_id uuid,
  p_expected_current_revision_id uuid,
  p_plan jsonb,
  p_scene jsonb
)
returns table (status text, draft_revision_id uuid, revision_number bigint, save_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_parent public.map_revisions%rowtype;
  v_user_id uuid;
  v_revision_id uuid := gen_random_uuid();
  v_revision_number bigint;
begin
  select * into v_map from public.map_projects where id = p_map_id for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_map.project_id);
  if v_map.current_revision_id is distinct from p_expected_current_revision_id then
    return query select 'conflict'::text, null::uuid, null::bigint, null::bigint;
    return;
  end if;

  select * into v_parent
  from public.map_revisions
  where id = p_parent_revision_id and map_project_id = p_map_id;
  if not found then raise exception 'parent revision not found' using errcode = 'P0002'; end if;

  select coalesce(max(revision.revision_number), 0) + 1 into v_revision_number
  from public.map_revisions as revision where revision.map_project_id = p_map_id;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_revision_id, p_map_id, v_revision_number, 0, v_parent.id,
    v_parent.source_document_id, v_parent.source_document_updated_at,
    v_parent.source_epoch, v_parent.source_revision, v_parent.schema_version,
    coalesce(p_plan, v_parent.plan), coalesce(p_scene, v_parent.scene), 'draft', v_user_id
  );

  update public.map_projects set current_revision_id = v_revision_id where id = p_map_id;
  return query select 'forked'::text, v_revision_id, v_revision_number, 0::bigint;
end;
$$;

create function public.publish_map_revision(
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
  where id = p_draft_revision_id and map_project_id = p_map_id
  for update;
  if not found or v_draft.status <> 'draft' or v_draft.save_version <> p_expected_save_version then
    return query select 'conflict'::text, null::uuid, null::uuid;
    return;
  end if;

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
    v_draft.source_epoch, v_draft.source_revision, v_draft.schema_version,
    v_draft.plan, v_draft.scene, 'draft', v_user_id
  );
  update public.map_projects set current_revision_id = v_next_revision_id where id = p_map_id;
  return query select 'published'::text, v_draft.id, v_next_revision_id;
end;
$$;

create function public.create_map_asset_plan(
  p_revision_id uuid,
  p_asset_key text,
  p_kind text,
  p_prompt text,
  p_requested_capability text,
  p_generation_params jsonb,
  p_reference_asset_ids uuid[],
  p_reference_hashes text[],
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
  where revision.id = p_revision_id;
  if v_project_id is null then raise exception 'revision not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_project_id);
  if v_revision_status not in ('generating', 'partial', 'failed') then
    raise exception 'revision is not accepting asset plans' using errcode = '23514';
  end if;

  insert into public.map_assets (
    map_revision_id, asset_key, kind, status, requested_capability, prompt,
    generation_params, reference_asset_ids, reference_hashes, metadata
  ) values (
    p_revision_id, p_asset_key, p_kind, 'planned', p_requested_capability, p_prompt,
    coalesce(p_generation_params, '{}'::jsonb), coalesce(p_reference_asset_ids, '{}'),
    coalesce(p_reference_hashes, '{}'), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (map_revision_id, asset_key) do nothing
  returning * into v_asset;

  if v_asset.id is null then
    select * into v_asset from public.map_assets
    where map_revision_id = p_revision_id and asset_key = p_asset_key;
    if v_asset.kind <> p_kind
      or v_asset.prompt <> p_prompt
      or v_asset.requested_capability is distinct from p_requested_capability
      or v_asset.generation_params <> coalesce(p_generation_params, '{}'::jsonb)
      or v_asset.reference_asset_ids <> coalesce(p_reference_asset_ids, '{}'::uuid[])
      or v_asset.reference_hashes <> coalesce(p_reference_hashes, '{}'::text[]) then
      raise exception 'asset key already has a different immutable plan' using errcode = '23505';
    end if;
  end if;
  return query select v_asset.id, v_asset.status;
end;
$$;

create function public.transition_map_asset(
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

revoke all on function public.prevent_map_revision_payload_mutation() from public, anon, authenticated;
revoke all on function public.create_map_project(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.save_map_draft(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
revoke all on function public.fork_map_draft(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.publish_map_revision(uuid, uuid, bigint) from public, anon;
revoke all on function public.create_map_asset_plan(uuid, text, text, text, text, jsonb, uuid[], text[], jsonb) from public, anon;
revoke all on function public.transition_map_asset(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb) from public, anon, authenticated;

grant execute on function public.create_map_project(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.save_map_draft(uuid, uuid, bigint, jsonb, jsonb) to authenticated;
grant execute on function public.fork_map_draft(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.publish_map_revision(uuid, uuid, bigint) to authenticated;
grant execute on function public.create_map_asset_plan(uuid, text, text, text, text, jsonb, uuid[], text[], jsonb) to authenticated;
grant execute on function public.transition_map_asset(uuid, text, text, text, text, text, text, text, text, integer, integer, boolean, jsonb) to service_role;
