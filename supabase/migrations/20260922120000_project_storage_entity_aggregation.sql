-- Aggregate project storage around Keco's user-facing creation entities.
-- Physical bytes remain authoritative in project_storage_files and are bound
-- once to a Document, Table, or the project's single Assets aggregate.

create table public.project_storage_entity_bindings (
  file_id uuid primary key references public.project_storage_files(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_kind text not null check (entity_kind in ('document', 'table', 'assets')),
  entity_id uuid not null,
  detail_entity_id uuid,
  provenance text not null check (provenance in ('document_source', 'table_cell_path', 'project_assets')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (entity_kind <> 'assets' or entity_id = project_id)
);

create index project_storage_entity_bindings_project_entity_idx
  on public.project_storage_entity_bindings (project_id, entity_kind, entity_id);

alter table public.project_storage_entity_bindings enable row level security;
revoke all on table public.project_storage_entity_bindings from public, anon, authenticated, service_role;

create or replace function private.storage_json_media_paths(p_value jsonb)
returns table (object_path text)
language sql
immutable
set search_path = ''
as $$
  select distinct btrim(path_value #>> '{}')
  from jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'lax $.**.path') path_value
  where jsonb_typeof(path_value) = 'string'
    and nullif(btrim(path_value #>> '{}'), '') is not null;
$$;

create or replace function private.storage_refresh_file_entity_binding(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.project_storage_files%rowtype;
  v_entity_kind text;
  v_entity_id uuid;
  v_detail_entity_id uuid;
  v_provenance text;
begin
  select * into v_file
  from public.project_storage_files file
  where file.id = p_file_id;

  if not found or v_file.project_id is null or v_file.lifecycle_status <> 'active' then
    delete from public.project_storage_entity_bindings binding
    where binding.file_id = p_file_id;
    return;
  end if;

  if v_file.source_kind = 'document_image'
     and v_file.source_entity_id is not null
     and exists (
       select 1 from public.documents document
       where document.id = v_file.source_entity_id
         and document.project_id = v_file.project_id
     ) then
    v_entity_kind := 'document';
    v_entity_id := v_file.source_entity_id;
    v_detail_entity_id := null;
    v_provenance := 'document_source';
  else
    select library.id, asset.id
      into v_entity_id, v_detail_entity_id
    from public.library_asset_values value
    join public.library_assets asset on asset.id = value.asset_id
    join public.libraries library on library.id = asset.library_id
    cross join lateral private.storage_json_media_paths(value.value_json) media_path
    where library.project_id = v_file.project_id
      and v_file.bucket_id = 'library-media-files'
      and media_path.object_path = v_file.object_path
    order by library.id, asset.id
    limit 1;

    if v_entity_id is not null then
      v_entity_kind := 'table';
      v_provenance := 'table_cell_path';
    else
      v_entity_kind := 'assets';
      v_entity_id := v_file.project_id;
      v_detail_entity_id := v_file.source_entity_id;
      v_provenance := 'project_assets';
    end if;
  end if;

  insert into public.project_storage_entity_bindings (
    file_id, project_id, owner_id, entity_kind, entity_id,
    detail_entity_id, provenance, created_at, updated_at
  ) values (
    v_file.id, v_file.project_id, v_file.owner_id, v_entity_kind, v_entity_id,
    v_detail_entity_id, v_provenance, clock_timestamp(), clock_timestamp()
  )
  on conflict (file_id) do update set
    project_id = excluded.project_id,
    owner_id = excluded.owner_id,
    entity_kind = excluded.entity_kind,
    entity_id = excluded.entity_id,
    detail_entity_id = excluded.detail_entity_id,
    provenance = excluded.provenance,
    updated_at = clock_timestamp();
end;
$$;

create or replace function private.storage_refresh_project_entity_bindings(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file_id uuid;
begin
  for v_file_id in
    select file.id
    from public.project_storage_files file
    where file.project_id = p_project_id
  loop
    perform private.storage_refresh_file_entity_binding(v_file_id);
  end loop;
end;
$$;

create or replace function private.storage_refresh_file_entity_binding_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.storage_refresh_file_entity_binding(new.id);
  return new;
end;
$$;

create trigger trg_refresh_storage_file_entity_binding
after insert or update of project_id, owner_id, source_kind, source_entity_id, lifecycle_status
on public.project_storage_files
for each row execute function private.storage_refresh_file_entity_binding_trigger();

create or replace function private.storage_refresh_media_value_bindings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_file_id uuid;
begin
  for v_path in
    select object_path from private.storage_json_media_paths(case when tg_op = 'INSERT' then null else old.value_json end)
    union
    select object_path from private.storage_json_media_paths(case when tg_op = 'DELETE' then null else new.value_json end)
  loop
    for v_file_id in
      select file.id
      from public.project_storage_files file
      where file.bucket_id = 'library-media-files'
        and file.object_path = v_path
    loop
      perform private.storage_refresh_file_entity_binding(v_file_id);
    end loop;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_refresh_media_value_storage_bindings
after insert or update of value_json or delete on public.library_asset_values
for each row execute function private.storage_refresh_media_value_bindings();

create or replace function private.storage_refresh_library_entity_bindings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and old.project_id is not null then
    perform private.storage_refresh_project_entity_bindings(old.project_id);
  end if;
  if tg_op <> 'DELETE' and new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    perform private.storage_refresh_project_entity_bindings(new.project_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_refresh_library_storage_bindings
after insert or delete or update of project_id on public.libraries
for each row execute function private.storage_refresh_library_entity_bindings();

create or replace function private.storage_refresh_asset_entity_bindings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select library.project_id into v_project_id
  from public.libraries library
  where library.id = old.library_id;
  if v_project_id is not null then
    perform private.storage_refresh_project_entity_bindings(v_project_id);
  end if;

  select library.project_id into v_project_id
  from public.libraries library
  where library.id = new.library_id;
  if v_project_id is not null then
    perform private.storage_refresh_project_entity_bindings(v_project_id);
  end if;
  return new;
end;
$$;

create trigger trg_refresh_asset_storage_bindings
after update of library_id on public.library_assets
for each row execute function private.storage_refresh_asset_entity_bindings();

create or replace function private.storage_refresh_document_entity_bindings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_file_id uuid;
begin
  for v_file_id in
    select file.id
    from public.project_storage_files file
    where file.source_kind = 'document_image'
      and file.source_entity_id = v_document_id
  loop
    perform private.storage_refresh_file_entity_binding(v_file_id);
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_refresh_document_storage_bindings
after insert or delete or update of project_id on public.documents
for each row execute function private.storage_refresh_document_entity_bindings();

-- Backfill all active project objects. The refresh function applies Document,
-- then Table, then Assets precedence and never reads remote object content.
select private.storage_refresh_file_entity_binding(file.id)
from public.project_storage_files file
where file.project_id is not null;

create or replace function private.storage_project_entity_physical_files(p_project_id uuid)
returns table (
  file_id uuid,
  entity_kind text,
  entity_id uuid,
  detail_entity_id uuid,
  display_name text,
  mime_type text,
  size_bytes bigint,
  source_kind text,
  source_entity_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    file.id,
    case
      when binding.entity_kind = 'document' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = file.project_id
          and logical.source_kind = 'document_content'
          and logical.source_entity_id = binding.entity_id
      ) then 'document'
      when binding.entity_kind = 'table' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = file.project_id
          and logical.source_kind = 'library_table'
          and logical.source_entity_id = binding.entity_id
      ) then 'table'
      else 'assets'
    end,
    case
      when binding.entity_kind = 'document' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = file.project_id
          and logical.source_kind = 'document_content'
          and logical.source_entity_id = binding.entity_id
      ) then binding.entity_id
      when binding.entity_kind = 'table' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = file.project_id
          and logical.source_kind = 'library_table'
          and logical.source_entity_id = binding.entity_id
      ) then binding.entity_id
      else file.project_id
    end,
    case when binding.project_id = file.project_id then binding.detail_entity_id else file.source_entity_id end,
    file.display_name,
    file.mime_type,
    file.size_bytes,
    file.source_kind,
    file.source_entity_id,
    file.created_at
  from public.project_storage_files file
  left join public.project_storage_entity_bindings binding
    on binding.file_id = file.id and binding.project_id = file.project_id
  where file.project_id = p_project_id
    and file.lifecycle_status = 'active';
$$;

create or replace function private.storage_project_entities(p_project_id uuid)
returns table (
  entity_id uuid,
  entity_kind text,
  display_name text,
  mime_type text,
  logical_bytes bigint,
  physical_bytes bigint,
  size_bytes bigint,
  folder_id uuid,
  created_at timestamptz,
  source_available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with physical as (
    select * from private.storage_project_entity_physical_files(p_project_id)
  ), physical_totals as (
    select physical.entity_kind, physical.entity_id,
      sum(physical.size_bytes)::bigint as size_bytes,
      min(physical.created_at) as created_at
    from physical
    group by physical.entity_kind, physical.entity_id
  ), logical_entities as (
    select
      logical.source_entity_id as entity_id,
      case logical.source_kind when 'library_table' then 'table' else 'document' end as entity_kind,
      logical.display_name,
      case logical.source_kind
        when 'library_table' then 'application/x-keco-table'
        else 'application/x-keco-document'
      end as mime_type,
      logical.size_bytes as logical_bytes,
      coalesce(physical_totals.size_bytes, 0)::bigint as physical_bytes,
      logical.size_bytes + coalesce(physical_totals.size_bytes, 0) as size_bytes,
      coalesce(library.folder_id, document.folder_id) as folder_id,
      logical.created_at,
      case logical.source_kind
        when 'library_table' then library.id is not null
        else document.id is not null
      end as source_available
    from public.project_storage_logical_files logical
    left join public.libraries library
      on logical.source_kind = 'library_table' and library.id = logical.source_entity_id
    left join public.documents document
      on logical.source_kind = 'document_content' and document.id = logical.source_entity_id
    left join physical_totals
      on physical_totals.entity_kind = case logical.source_kind when 'library_table' then 'table' else 'document' end
      and physical_totals.entity_id = logical.source_entity_id
    where logical.project_id = p_project_id
  )
  select * from logical_entities
  union all
  select
    p_project_id,
    'assets',
    'Assets',
    'application/x-keco-assets',
    0::bigint,
    physical_totals.size_bytes,
    physical_totals.size_bytes,
    null::uuid,
    physical_totals.created_at,
    true
  from physical_totals
  where physical_totals.entity_kind = 'assets'
    and physical_totals.entity_id = p_project_id
    and physical_totals.size_bytes > 0;
$$;

create or replace function public.account_storage_project_entities(
  p_project_id uuid,
  p_query text default null,
  p_sort text default 'size_desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
  v_items jsonb;
begin
  perform public.storage_require_reader(p_project_id, v_actor);
  if p_sort not in ('name_asc', 'name_desc', 'size_asc', 'size_desc', 'created_asc', 'created_desc') then
    p_sort := 'size_desc';
  end if;

  select count(*) into v_total
  from private.storage_project_entities(p_project_id) entity
  where nullif(btrim(p_query), '') is null
    or entity.display_name ilike '%' || btrim(p_query) || '%';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.entity_id,
    'kind', page.entity_kind,
    'name', page.display_name,
    'mimeType', page.mime_type,
    'logicalBytes', page.logical_bytes,
    'physicalBytes', page.physical_bytes,
    'sizeBytes', page.size_bytes,
    'folderId', page.folder_id,
    'createdAt', page.created_at,
    'sourceAvailable', page.source_available
  )), '[]'::jsonb) into v_items
  from (
    select entity.*
    from private.storage_project_entities(p_project_id) entity
    where nullif(btrim(p_query), '') is null
      or entity.display_name ilike '%' || btrim(p_query) || '%'
    order by
      case when p_sort = 'size_desc' then entity.size_bytes end desc,
      case when p_sort = 'size_asc' then entity.size_bytes end asc,
      case when p_sort = 'created_desc' then entity.created_at end desc,
      case when p_sort = 'created_asc' then entity.created_at end asc,
      case when p_sort = 'name_asc' then lower(entity.display_name) end asc,
      case when p_sort = 'name_desc' then lower(entity.display_name) end desc,
      entity.entity_id
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.account_storage_entity_details(
  p_project_id uuid,
  p_entity_kind text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entity record;
  v_items jsonb;
begin
  perform public.storage_require_reader(p_project_id, v_actor);
  if p_entity_kind not in ('table', 'document', 'assets') then
    raise exception 'Invalid storage entity kind' using errcode = '22023';
  end if;

  select * into v_entity
  from private.storage_project_entities(p_project_id) entity
  where entity.entity_kind = p_entity_kind
    and entity.entity_id = p_entity_id;

  if not found then
    raise exception 'Storage entity not found'
      using errcode = 'P0002', detail = 'STORAGE_ENTITY_NOT_FOUND';
  end if;

  with detail_items as (
    select
      logical.id,
      case p_entity_kind when 'table' then 'Table data' else 'Document body' end as name,
      logical.mime_type,
      logical.size_bytes,
      'logical'::text as item_kind,
      null::uuid as group_id,
      null::text as group_name,
      logical.created_at
    from public.project_storage_logical_files logical
    where p_entity_kind in ('table', 'document')
      and logical.project_id = p_project_id
      and logical.source_entity_id = p_entity_id
      and logical.source_kind = case p_entity_kind when 'table' then 'library_table' else 'document_content' end
    union all
    select
      physical.file_id,
      physical.display_name,
      physical.mime_type,
      physical.size_bytes,
      'media',
      physical.detail_entity_id,
      case
        when p_entity_kind = 'table' then coalesce(asset.name, 'Table media')
        when p_entity_kind = 'document' then 'Document media'
        when physical.source_kind = 'map_reference' then 'Map references'
        when physical.source_kind = 'map_asset' then 'Map assets'
        when physical.source_kind = 'character_asset' then 'Character assets'
        else 'Project assets'
      end,
      physical.created_at
    from private.storage_project_entity_physical_files(p_project_id) physical
    left join public.library_assets asset
      on p_entity_kind = 'table' and asset.id = physical.detail_entity_id
    where physical.entity_kind = p_entity_kind
      and physical.entity_id = p_entity_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', detail.id,
    'name', detail.name,
    'mimeType', detail.mime_type,
    'sizeBytes', detail.size_bytes,
    'itemKind', detail.item_kind,
    'groupId', detail.group_id,
    'groupName', detail.group_name,
    'createdAt', detail.created_at
  ) order by detail.item_kind, detail.group_name nulls first, detail.name, detail.id), '[]'::jsonb)
  into v_items
  from detail_items detail;

  return jsonb_build_object(
    'id', v_entity.entity_id,
    'kind', v_entity.entity_kind,
    'name', v_entity.display_name,
    'logicalBytes', v_entity.logical_bytes,
    'physicalBytes', v_entity.physical_bytes,
    'sizeBytes', v_entity.size_bytes,
    'sourceAvailable', v_entity.source_available,
    'items', v_items
  );
end;
$$;

create or replace function public.account_storage_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_quota public.account_storage_quotas%rowtype;
  v_physical_used bigint;
  v_logical_used bigint;
  v_display_used bigint;
  v_owned jsonb;
  v_shared jsonb;
  v_unassigned jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_quota from public.account_storage_quotas quota where quota.owner_id = v_actor;
  if not found then
    v_quota.owner_id := v_actor;
    v_quota.quota_bytes := 1099511627776;
    v_quota.used_bytes := 0;
    v_quota.logical_used_bytes := 0;
    v_quota.reserved_bytes := 0;
  end if;
  v_physical_used := v_quota.used_bytes;
  v_logical_used := v_quota.logical_used_bytes;
  v_display_used := v_physical_used + v_logical_used;

  select coalesce(jsonb_agg(row_json order by sort_bytes desc, row_json ->> 'name'), '[]'::jsonb) into v_owned
  from (
    select jsonb_build_object(
      'id', project.id,
      'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', (select count(*) from private.storage_project_entities(project.id)),
      'usedBytes', (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_entities(project.id) entity),
      'ownedByCurrentUser', true
    ) as row_json,
    (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_entities(project.id) entity) as sort_bytes
    from public.projects project
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id = v_actor
  ) owned;

  select coalesce(jsonb_agg(row_json order by sort_bytes desc, row_json ->> 'name'), '[]'::jsonb) into v_shared
  from (
    select jsonb_build_object(
      'id', project.id,
      'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount', (select count(*) from private.storage_project_entities(project.id)),
      'usedBytes', (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_entities(project.id) entity),
      'ownedByCurrentUser', false
    ) as row_json,
    (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_entities(project.id) entity) as sort_bytes
    from public.projects project
    join public.project_collaborators collaborator
      on collaborator.project_id = project.id
      and collaborator.user_id = v_actor
      and collaborator.accepted_at is not null
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id <> v_actor
  ) shared;

  select case when count(file.id) = 0 then null else jsonb_build_object(
    'fileCount', count(file.id),
    'usedBytes', coalesce(sum(file.size_bytes), 0)
  ) end into v_unassigned
  from public.project_storage_files file
  where file.owner_id = v_actor
    and file.project_id is null
    and file.lifecycle_status = 'active';

  return jsonb_build_object(
    'quotaBytes', v_quota.quota_bytes,
    'usedBytes', v_display_used,
    'physicalUsedBytes', v_physical_used,
    'logicalUsedBytes', v_logical_used,
    'reservedBytes', v_quota.reserved_bytes,
    'remainingBytes', greatest(v_quota.quota_bytes - v_display_used - v_quota.reserved_bytes, 0),
    'overageBytes', greatest(v_display_used + v_quota.reserved_bytes - v_quota.quota_bytes, 0),
    'ownedProjects', v_owned,
    'sharedProjects', v_shared,
    'unassigned', v_unassigned
  );
end;
$$;

create or replace function public.service_account_storage_entity_binding_drift()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with table_candidates as (
    select
      file.id as file_id,
      library.id as entity_id,
      asset.id as detail_entity_id,
      row_number() over (partition by file.id order by library.id, asset.id) as candidate_order
    from public.library_asset_values value
    join public.library_assets asset on asset.id = value.asset_id
    join public.libraries library
      on library.id = asset.library_id
    cross join lateral private.storage_json_media_paths(value.value_json) media_path
    join public.project_storage_files file
      on file.project_id = library.project_id
      and file.bucket_id = 'library-media-files'
      and file.object_path = media_path.object_path
    where file.project_id is not null
      and file.lifecycle_status = 'active'
  ), table_owners as (
    select candidate.file_id, candidate.entity_id, candidate.detail_entity_id
    from table_candidates candidate
    where candidate.candidate_order = 1
  ), table_references as (
    select candidate.file_id, count(distinct candidate.entity_id)::bigint as table_count
    from table_candidates candidate
    group by candidate.file_id
  ), expected_bindings as (
    select
      file.id as file_id,
      file.project_id,
      file.owner_id,
      case
        when document.id is not null then 'document'
        when table_owner.entity_id is not null then 'table'
        else 'assets'
      end as entity_kind,
      coalesce(document.id, table_owner.entity_id, file.project_id) as entity_id,
      case
        when document.id is not null then null::uuid
        when table_owner.entity_id is not null then table_owner.detail_entity_id
        else file.source_entity_id
      end as detail_entity_id,
      case
        when document.id is not null then 'document_source'
        when table_owner.entity_id is not null then 'table_cell_path'
        else 'project_assets'
      end as provenance
    from public.project_storage_files file
    left join public.documents document
      on file.source_kind = 'document_image'
      and document.id = file.source_entity_id
      and document.project_id = file.project_id
    left join table_owners table_owner on table_owner.file_id = file.id
    where file.project_id is not null
      and file.lifecycle_status = 'active'
  ), orphaned_bindings as (
    select binding.file_id
    from public.project_storage_entity_bindings binding
    left join expected_bindings expected on expected.file_id = binding.file_id
    where expected.file_id is null
  ), stale_bindings as (
    select binding.file_id
    from public.project_storage_entity_bindings binding
    join expected_bindings expected on expected.file_id = binding.file_id
    where binding.project_id is distinct from expected.project_id
      or binding.owner_id is distinct from expected.owner_id
      or binding.entity_kind is distinct from expected.entity_kind
      or binding.entity_id is distinct from expected.entity_id
      or binding.detail_entity_id is distinct from expected.detail_entity_id
      or binding.provenance is distinct from expected.provenance
    union all
    select orphan.file_id from orphaned_bindings orphan
  )
  select jsonb_build_object(
    'missingBindings', (
      select count(*)
      from expected_bindings expected
      left join public.project_storage_entity_bindings binding on binding.file_id = expected.file_id
      where binding.file_id is null
    ),
    'staleBindings', (select count(*) from stale_bindings),
    'conflictingBindings', (
      select count(*)
      from public.project_storage_files file
      left join table_references reference on reference.file_id = file.id
      where file.project_id is not null
        and file.lifecycle_status = 'active'
        and (
          coalesce(reference.table_count, 0) > 1
          or (coalesce(reference.table_count, 0) > 0 and file.source_kind = 'document_image' and exists (
            select 1 from public.documents document
            where document.id = file.source_entity_id and document.project_id = file.project_id
          ))
        )
    )
  );
$$;

create or replace function public.service_refresh_account_storage_entity_bindings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file_id uuid;
  v_refreshed bigint := 0;
begin
  for v_file_id in select file.id from public.project_storage_files file
  loop
    perform private.storage_refresh_file_entity_binding(v_file_id);
    v_refreshed := v_refreshed + 1;
  end loop;
  return jsonb_build_object('refreshedFiles', v_refreshed);
end;
$$;

revoke all on function public.account_storage_project_entities(uuid, text, text, integer, integer)
  from public, anon, service_role;
revoke all on function public.account_storage_entity_details(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.account_storage_project_entities(uuid, text, text, integer, integer)
  to authenticated;
grant execute on function public.account_storage_entity_details(uuid, text, uuid)
  to authenticated;

revoke all on function private.storage_json_media_paths(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_file_entity_binding(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_project_entity_bindings(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_file_entity_binding_trigger() from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_media_value_bindings() from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_library_entity_bindings() from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_asset_entity_bindings() from public, anon, authenticated, service_role;
revoke all on function private.storage_refresh_document_entity_bindings() from public, anon, authenticated, service_role;
revoke all on function private.storage_project_entity_physical_files(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_project_entities(uuid) from public, anon, authenticated, service_role;
revoke all on function public.service_account_storage_entity_binding_drift() from public, anon, authenticated;
revoke all on function public.service_refresh_account_storage_entity_bindings() from public, anon, authenticated;
grant execute on function public.service_account_storage_entity_binding_drift() to service_role;
grant execute on function public.service_refresh_account_storage_entity_bindings() to service_role;
