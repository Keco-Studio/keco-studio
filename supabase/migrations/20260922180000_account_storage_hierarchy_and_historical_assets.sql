-- Repair historical physical objects that predate the storage registry and
-- expose the Account Storage explorer as a project directory hierarchy.

-- Production history repair can scan more objects than the default two-minute
-- migration timeout permits. Reset the connection setting at the end.
set statement_timeout = '10min';

-- Historical imports are deliberately limited to Keco's accounted buckets.
-- Native registry rows win over path attribution; every path-derived project
-- id must resolve to a real project before an object can enter the ledger.
create or replace function public.service_repair_historical_project_storage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imported bigint;
begin
with storage_inventory as (
  select
    object.bucket_id,
    object.name as object_path,
    (object.metadata ->> 'size')::bigint as size_bytes,
    coalesce(nullif(object.metadata ->> 'mimetype', ''), 'application/octet-stream') as mime_type,
    left(coalesce(nullif(regexp_replace(object.name, '^.*/', ''), ''), 'Stored object'), 255) as display_name,
    object.created_at as object_created_at
  from storage.objects object
  left join public.project_storage_files registered
    on registered.bucket_id = object.bucket_id
    and registered.object_path = object.name
  where object.bucket_id in (
      'library-media-files', 'project-assets', 'map-assets',
      'character-assets', 'tiptap-images'
    )
    and registered.id is null
    and object.metadata ->> 'size' ~ '^[0-9]+$'
    and (object.metadata ->> 'size')::numeric between 1 and 9223372036854775807
), native_candidates as (
  select asset.storage_bucket as bucket_id, asset.storage_path as object_path,
    asset.project_id, 'project_asset'::text as source_kind, asset.id as source_entity_id,
    1 as priority
  from public.project_game_assets asset
  union all
  select 'map-assets', reference.storage_path, reference.project_id,
    'map_reference', reference.id, 1
  from public.map_reference_images reference
  union all
  select 'map-assets', asset.storage_path, map.project_id,
    'map_asset', asset.id, 1
  from public.map_assets asset
  join public.map_revisions revision on revision.id = asset.map_revision_id
  join public.map_projects map on map.id = revision.map_project_id
  where asset.storage_path is not null
  union all
  select 'character-assets', attempt.storage_path, asset.project_id,
    'character_asset', asset.id, 1
  from public.character_generation_attempts attempt
  join public.character_assets asset on asset.id = attempt.character_asset_id
  where attempt.storage_path is not null
  union all
  select inventory.bucket_id, inventory.object_path, document.project_id,
    'document_image', document.id, 1
  from storage_inventory inventory
  join public.documents document
    on inventory.bucket_id in ('library-media-files', 'tiptap-images')
    and pg_catalog.strpos(coalesce(document.content, ''), inventory.object_path) > 0
  union all
  select inventory.bucket_id, inventory.object_path, library.project_id,
    'library_media', asset.id, 1
  from public.library_asset_values value
  join public.library_assets asset on asset.id = value.asset_id
  join public.libraries library on library.id = asset.library_id
  cross join lateral private.storage_json_media_paths(value.value_json) media_path
  join storage_inventory inventory
    on inventory.bucket_id = 'library-media-files'
    and inventory.object_path = media_path.object_path
), path_candidates as (
  select
    inventory.bucket_id,
    inventory.object_path,
    case
      when inventory.bucket_id in ('library-media-files', 'project-assets', 'tiptap-images')
        then split_part(inventory.object_path, '/', 2)
      when inventory.bucket_id = 'map-assets'
        and split_part(inventory.object_path, '/', 1) = 'references'
        then split_part(inventory.object_path, '/', 2)
      when inventory.bucket_id in ('map-assets', 'character-assets')
        then split_part(inventory.object_path, '/', 1)
      else ''
    end as project_id_text,
    case inventory.bucket_id
      when 'library-media-files' then 'library_media'
      when 'tiptap-images' then 'document_image'
      when 'map-assets' then case
        when split_part(inventory.object_path, '/', 1) = 'references' then 'map_reference'
        else 'map_asset'
      end
      when 'character-assets' then 'character_asset'
      else 'project_asset'
    end as source_kind
  from storage_inventory inventory
), candidates as (
  select native.bucket_id, native.object_path, native.project_id,
    native.source_kind, native.source_entity_id, native.priority
  from native_candidates native
  join storage_inventory inventory
    on inventory.bucket_id = native.bucket_id
    and inventory.object_path = native.object_path
  union all
  select path.bucket_id, path.object_path, project.id,
    path.source_kind, null::uuid, 2
  from path_candidates path
  join public.projects project
    on path.project_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and project.id = path.project_id_text::uuid
), chosen as (
  select candidate.*,
    row_number() over (
      partition by candidate.bucket_id, candidate.object_path
      order by candidate.priority, candidate.project_id, candidate.source_entity_id nulls last
    ) as candidate_order
  from candidates candidate
), imported as (
  insert into public.project_storage_files (
    project_id, owner_id, bucket_id, object_path, display_name, mime_type,
    size_bytes, source_kind, source_entity_id, object_created_at
  )
  select
    chosen.project_id,
    project.owner_id,
    inventory.bucket_id,
    inventory.object_path,
    inventory.display_name,
    inventory.mime_type,
    inventory.size_bytes,
    chosen.source_kind,
    chosen.source_entity_id,
    inventory.object_created_at
  from chosen
  join storage_inventory inventory
    on inventory.bucket_id = chosen.bucket_id
    and inventory.object_path = chosen.object_path
  join public.projects project on project.id = chosen.project_id
  where chosen.candidate_order = 1
  on conflict (bucket_id, object_path) do nothing
  returning id, project_id, owner_id, source_kind, source_entity_id
), locations as (
  insert into public.project_storage_file_locations (
    file_id, project_id, owner_id, source_kind, source_entity_id
  )
  select imported.id, imported.project_id, imported.owner_id,
    imported.source_kind, imported.source_entity_id
  from imported
  on conflict do nothing
  returning id
)
select count(*) into v_imported from imported;

-- The trigger above binds new files. Refresh all rows as an idempotent repair
-- for partially deployed historical registries.
perform private.storage_refresh_file_entity_binding(file.id)
from public.project_storage_files file
where file.project_id is not null;

-- Existing native standalone assets imply that the root Assets workspace
-- exists, even when an older project missed the activation flag migration.
update public.projects project
set assets_workspace_enabled = true
where not project.assets_workspace_enabled
  and exists (
    select 1
    from public.project_storage_entity_bindings binding
    where binding.project_id = project.id
      and binding.entity_kind = 'assets'
  );

perform public.service_rebuild_account_storage_quota_totals();
return jsonb_build_object('importedFiles', v_imported);
end;
$$;

create or replace function private.storage_activate_assets_workspace_from_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not null
     and new.lifecycle_status = 'active'
     and new.source_kind in ('project_asset', 'map_reference', 'map_asset', 'character_asset') then
    update public.projects project
    set assets_workspace_enabled = true
    where project.id = new.project_id
      and not project.assets_workspace_enabled;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activate_assets_workspace_from_storage_file
  on public.project_storage_files;
create trigger trg_activate_assets_workspace_from_storage_file
after insert or update of project_id, source_kind, lifecycle_status
on public.project_storage_files
for each row execute function private.storage_activate_assets_workspace_from_file();

-- Rebuild cached physical totals after importing the historical objects.
select public.service_repair_historical_project_storage();

-- Assets existence is controlled by the root workspace, not by a positive
-- physical subtotal. This also lets its detail endpoint return an empty list.
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
    project.id,
    'assets',
    'Assets',
    'application/x-keco-assets',
    0::bigint,
    coalesce(physical_totals.size_bytes, 0)::bigint,
    coalesce(physical_totals.size_bytes, 0)::bigint,
    null::uuid,
    coalesce(physical_totals.created_at, project.created_at),
    true
  from public.projects project
  left join physical_totals
    on physical_totals.entity_kind = 'assets'
    and physical_totals.entity_id = project.id
  where project.id = p_project_id
    and (
      project.assets_workspace_enabled
      or physical_totals.entity_id is not null
    );
$$;

create or replace function private.storage_project_directory_entries(
  p_project_id uuid,
  p_parent_folder_id uuid
)
returns table (
  entry_id uuid,
  entry_kind text,
  display_name text,
  mime_type text,
  logical_bytes bigint,
  physical_bytes bigint,
  size_bytes bigint,
  parent_folder_id uuid,
  created_at timestamptz,
  source_available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive entities as (
    select * from private.storage_project_entities(p_project_id)
  ), folder_tree as (
    select folder.id as root_id, folder.id as descendant_id
    from public.folders folder
    where folder.project_id = p_project_id
    union all
    select tree.root_id, child.id
    from folder_tree tree
    join public.folders child on child.parent_folder_id = tree.descendant_id
    where child.project_id = p_project_id
  ), folder_totals as (
    select
      folder.id,
      folder.parent_folder_id,
      folder.name,
      folder.created_at,
      coalesce(sum(entity.logical_bytes), 0)::bigint as logical_bytes,
      coalesce(sum(entity.physical_bytes), 0)::bigint as physical_bytes,
      coalesce(sum(entity.size_bytes), 0)::bigint as size_bytes
    from public.folders folder
    left join folder_tree tree on tree.root_id = folder.id
    left join entities entity
      on entity.entity_kind <> 'assets'
      and entity.folder_id = tree.descendant_id
    where folder.project_id = p_project_id
    group by folder.id, folder.parent_folder_id, folder.name, folder.created_at
  ), directory_entries as (
    select
      folder.id as entry_id,
      'folder'::text as entry_kind,
      folder.name as display_name,
      'application/x-keco-folder'::text as mime_type,
      folder.logical_bytes,
      folder.physical_bytes,
      folder.size_bytes,
      folder.parent_folder_id,
      folder.created_at,
      true as source_available
    from folder_totals folder
    where folder.parent_folder_id is not distinct from p_parent_folder_id
    union all
    select
      entity.entity_id,
      entity.entity_kind,
      entity.display_name,
      entity.mime_type,
      entity.logical_bytes,
      entity.physical_bytes,
      entity.size_bytes,
      entity.folder_id,
      entity.created_at,
      entity.source_available
    from entities entity
    where (
      entity.entity_kind = 'assets' and p_parent_folder_id is null
    ) or (
      entity.entity_kind <> 'assets'
      and entity.folder_id is not distinct from p_parent_folder_id
    )
  )
  select * from directory_entries;
$$;

drop function if exists public.account_storage_project_entities(uuid, text, text, integer, integer);

create or replace function public.account_storage_project_entities(
  p_project_id uuid,
  p_query text default null,
  p_sort text default 'size_desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_parent_folder_id uuid default null
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
  v_breadcrumb jsonb := '[]'::jsonb;
begin
  perform public.storage_require_reader(p_project_id, v_actor);

  if p_parent_folder_id is not null and not exists (
    select 1 from public.folders folder
    where folder.id = p_parent_folder_id and folder.project_id = p_project_id
  ) then
    raise exception 'Storage folder not found'
      using errcode = 'P0002', detail = 'STORAGE_FOLDER_NOT_FOUND';
  end if;

  if p_sort not in ('name_asc', 'name_desc', 'size_asc', 'size_desc', 'created_asc', 'created_desc') then
    p_sort := 'size_desc';
  end if;

  if p_parent_folder_id is not null then
    with recursive ancestors as (
      select folder.id, folder.name, folder.parent_folder_id, 0 as depth
      from public.folders folder
      where folder.id = p_parent_folder_id and folder.project_id = p_project_id
      union all
      select parent.id, parent.name, parent.parent_folder_id, child.depth + 1
      from ancestors child
      join public.folders parent on parent.id = child.parent_folder_id
      where parent.project_id = p_project_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ancestor.id,
      'name', ancestor.name
    ) order by ancestor.depth desc), '[]'::jsonb)
    into v_breadcrumb
    from ancestors ancestor;
  end if;

  select count(*) into v_total
  from private.storage_project_directory_entries(p_project_id, p_parent_folder_id) entry
  where nullif(btrim(p_query), '') is null
    or entry.display_name ilike '%' || btrim(p_query) || '%';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.entry_id,
    'kind', page.entry_kind,
    'name', page.display_name,
    'mimeType', page.mime_type,
    'logicalBytes', page.logical_bytes,
    'physicalBytes', page.physical_bytes,
    'sizeBytes', page.size_bytes,
    'parentFolderId', page.parent_folder_id,
    'createdAt', page.created_at,
    'sourceAvailable', page.source_available
  )), '[]'::jsonb) into v_items
  from (
    select entry.*
    from private.storage_project_directory_entries(p_project_id, p_parent_folder_id) entry
    where nullif(btrim(p_query), '') is null
      or entry.display_name ilike '%' || btrim(p_query) || '%'
    order by
      case when p_sort = 'size_desc' then entry.size_bytes end desc,
      case when p_sort = 'size_asc' then entry.size_bytes end asc,
      case when p_sort = 'created_desc' then entry.created_at end desc,
      case when p_sort = 'created_asc' then entry.created_at end asc,
      case when p_sort = 'name_asc' then lower(entry.display_name) end asc,
      case when p_sort = 'name_desc' then lower(entry.display_name) end desc,
      entry.entry_id
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'breadcrumb', v_breadcrumb
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
      'fileCount',
        (select count(*) from public.folders folder where folder.project_id = project.id)
        + (select count(*) from private.storage_project_entities(project.id)),
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
      'fileCount',
        (select count(*) from public.folders folder where folder.project_id = project.id)
        + (select count(*) from private.storage_project_entities(project.id)),
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

revoke all on function private.storage_project_entities(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_activate_assets_workspace_from_file()
  from public, anon, authenticated, service_role;
revoke all on function private.storage_project_directory_entries(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.account_storage_project_entities(uuid, text, text, integer, integer, uuid)
  from public, anon, service_role;
grant execute on function public.account_storage_project_entities(uuid, text, text, integer, integer, uuid)
  to authenticated;
revoke all on function public.service_repair_historical_project_storage()
  from public, anon, authenticated;
grant execute on function public.service_repair_historical_project_storage()
  to service_role;

reset statement_timeout;
