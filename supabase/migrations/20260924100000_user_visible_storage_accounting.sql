-- User-facing storage follows current project records, while the raw registry
-- remains available for reconciliation and physical cleanup.

create function private.storage_project_visible_physical_files_v6(p_project_id uuid)
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
  select physical.*
  from private.storage_project_entity_physical_files(p_project_id) physical
  join public.project_storage_files file on file.id = physical.file_id
  where physical.entity_kind in ('table', 'document')
    or (
      physical.entity_kind = 'assets'
      and (
        exists (
          select 1
          from public.project_game_assets asset
          where file.source_kind = 'project_asset'
            and asset.project_id = file.project_id
            and asset.storage_bucket = file.bucket_id
            and asset.storage_path = file.object_path
            and asset.status = 'ready'
        )
        or exists (
          select 1
          from public.map_reference_images reference
          where file.source_kind = 'map_reference'
            and reference.project_id = file.project_id
            and reference.storage_path = file.object_path
        )
        or exists (
          select 1
          from public.map_assets map_asset
          join public.map_revisions revision on revision.id = map_asset.map_revision_id
          join public.map_projects map on map.id = revision.map_project_id
          where file.source_kind = 'map_asset'
            and map.project_id = file.project_id
            and map_asset.storage_path = file.object_path
            and map_asset.status = 'ready'
        )
        or exists (
          select 1
          from public.character_generation_attempts attempt
          join public.character_assets character on character.id = attempt.character_asset_id
          where file.source_kind = 'character_asset'
            and character.project_id = file.project_id
            and attempt.storage_path = file.object_path
            and attempt.status = 'ready'
        )
      )
    );
$$;

create function private.storage_owner_visible_physical_bytes_v6(p_owner_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(physical.size_bytes), 0)::bigint
  from public.projects project
  cross join lateral private.storage_project_visible_physical_files_v6(project.id) physical
  where project.owner_id = p_owner_id;
$$;

create function private.storage_owner_logical_bytes_v6(p_owner_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(logical.size_bytes), 0)::bigint
  from public.project_storage_logical_files logical
  join public.projects project on project.id = logical.project_id
  where project.owner_id = p_owner_id;
$$;

create function private.storage_owner_raw_physical_bytes_v6(p_owner_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(file.size_bytes), 0)::bigint
  from public.project_storage_files file
  where file.owner_id = p_owner_id
    and file.lifecycle_status in ('active', 'pending_cleanup');
$$;

create function private.storage_set_quota_check_bytes_v2(
  p_owner_id uuid,
  p_user_visible boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used_bytes bigint;
begin
  insert into public.account_storage_quotas (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  if p_user_visible then
    v_used_bytes := private.storage_owner_visible_physical_bytes_v6(p_owner_id);
  else
    v_used_bytes := private.storage_owner_raw_physical_bytes_v6(p_owner_id);
  end if;

  update public.account_storage_quotas quota
  set used_bytes = v_used_bytes,
      updated_at = pg_catalog.clock_timestamp()
  where quota.owner_id = p_owner_id;
end;
$$;

create function private.storage_project_hierarchy_entities_v6(p_project_id uuid)
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
    select * from private.storage_project_visible_physical_files_v6(p_project_id)
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
    and project.assets_workspace_enabled;
$$;

create function private.storage_project_directory_entries_v6(
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
    select * from private.storage_project_hierarchy_entities_v6(p_project_id)
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

create function public.account_storage_project_entities_v6(
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
  from private.storage_project_directory_entries_v6(p_project_id, p_parent_folder_id) entry
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
    from private.storage_project_directory_entries_v6(p_project_id, p_parent_folder_id) entry
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

create function public.account_storage_entity_details_v6(
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
  from private.storage_project_hierarchy_entities_v6(p_project_id) entity
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
    from private.storage_project_visible_physical_files_v6(p_project_id) physical
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

create function public.account_storage_summary_v6()
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
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_quota
  from public.account_storage_quotas quota
  where quota.owner_id = v_actor;
  if not found then
    v_quota.owner_id := v_actor;
    v_quota.quota_bytes := 1099511627776;
    v_quota.reserved_bytes := 0;
  end if;

  v_physical_used := private.storage_owner_visible_physical_bytes_v6(v_actor);
  v_logical_used := private.storage_owner_logical_bytes_v6(v_actor);
  v_display_used := v_physical_used + v_logical_used;

  select coalesce(jsonb_agg(row_json order by sort_bytes desc, row_json ->> 'name'), '[]'::jsonb)
  into v_owned
  from (
    select jsonb_build_object(
      'id', project.id,
      'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount',
        (select count(*) from public.folders folder where folder.project_id = project.id)
        + (select count(*) from private.storage_project_hierarchy_entities_v6(project.id)),
      'usedBytes', (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_hierarchy_entities_v6(project.id) entity),
      'ownedByCurrentUser', true
    ) as row_json,
    (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_hierarchy_entities_v6(project.id) entity) as sort_bytes
    from public.projects project
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id = v_actor
  ) owned;

  select coalesce(jsonb_agg(row_json order by sort_bytes desc, row_json ->> 'name'), '[]'::jsonb)
  into v_shared
  from (
    select jsonb_build_object(
      'id', project.id,
      'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount',
        (select count(*) from public.folders folder where folder.project_id = project.id)
        + (select count(*) from private.storage_project_hierarchy_entities_v6(project.id)),
      'usedBytes', (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_hierarchy_entities_v6(project.id) entity),
      'ownedByCurrentUser', false
    ) as row_json,
    (select coalesce(sum(entity.size_bytes), 0) from private.storage_project_hierarchy_entities_v6(project.id) entity) as sort_bytes
    from public.projects project
    join public.project_collaborators collaborator
      on collaborator.project_id = project.id
      and collaborator.user_id = v_actor
      and collaborator.accepted_at is not null
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id <> v_actor
  ) shared;

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
    'unassigned', null
  );
end;
$$;

create function public.storage_reserve_project_storage_upload_v2(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_expected_bytes bigint,
  p_display_name text,
  p_mime_type text,
  p_source_kind text,
  p_source_entity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );
  v_owner_id := public.storage_require_writer(p_project_id, p_actor_user_id);
  perform private.storage_set_quota_check_bytes_v2(v_owner_id, true);
  v_result := public.storage_reserve_project_storage_upload(
    p_actor_user_id, p_project_id, p_bucket_id, p_object_path, p_expected_bytes,
    p_display_name, p_mime_type, p_source_kind, p_source_entity_id
  );
  perform private.storage_set_quota_check_bytes_v2(v_owner_id, false);
  return v_result;
end;
$$;

create function public.storage_finalize_project_storage_upload_v2(
  p_actor_user_id uuid,
  p_reservation_id uuid,
  p_actual_bytes bigint,
  p_source_entity_id uuid default null,
  p_object_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_owner_id uuid;
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );
  select reservation.project_id into v_project_id
  from public.storage_upload_reservations reservation
  where reservation.id = p_reservation_id;
  if not found then
    raise exception 'Storage reservation does not exist'
      using errcode = 'P0001', detail = 'STORAGE_OBJECT_MISMATCH';
  end if;

  v_owner_id := public.storage_require_writer(v_project_id, p_actor_user_id);
  perform private.storage_set_quota_check_bytes_v2(v_owner_id, true);
  v_result := public.storage_finalize_project_storage_upload(
    p_actor_user_id, p_reservation_id, p_actual_bytes,
    p_source_entity_id, p_object_created_at
  );
  perform private.storage_set_quota_check_bytes_v2(v_owner_id, false);
  return v_result;
end;
$$;

create function public.reserve_project_storage_upload_v2(
  p_project_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_expected_bytes bigint,
  p_display_name text,
  p_mime_type text,
  p_source_kind text,
  p_source_entity_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_reserve_project_storage_upload_v2(
    auth.uid(), p_project_id, p_bucket_id, p_object_path, p_expected_bytes,
    p_display_name, p_mime_type, p_source_kind, p_source_entity_id
  );
$$;

create function public.finalize_project_storage_upload_v2(
  p_reservation_id uuid,
  p_actual_bytes bigint,
  p_source_entity_id uuid default null,
  p_object_created_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_finalize_project_storage_upload_v2(
    auth.uid(), p_reservation_id, p_actual_bytes,
    p_source_entity_id, p_object_created_at
  );
$$;

create function public.service_reserve_project_storage_upload_v2(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_expected_bytes bigint,
  p_display_name text,
  p_mime_type text,
  p_source_kind text,
  p_source_entity_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_reserve_project_storage_upload_v2(
    p_actor_user_id, p_project_id, p_bucket_id, p_object_path, p_expected_bytes,
    p_display_name, p_mime_type, p_source_kind, p_source_entity_id
  );
$$;

create function public.service_finalize_project_storage_upload_v2(
  p_actor_user_id uuid,
  p_reservation_id uuid,
  p_actual_bytes bigint,
  p_source_entity_id uuid default null,
  p_object_created_at timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.storage_finalize_project_storage_upload_v2(
    p_actor_user_id, p_reservation_id, p_actual_bytes,
    p_source_entity_id, p_object_created_at
  );
$$;

create function public.complete_project_game_asset_storage_upload_v2(
  p_reservation_id uuid,
  p_project_id uuid,
  p_name text,
  p_category text,
  p_mime_type text,
  p_storage_bucket text,
  p_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_has_transparency boolean,
  p_file_size bigint,
  p_object_created_at timestamptz default null
)
returns table (
  id uuid, project_id uuid, created_by uuid, name text, category text,
  status text, mime_type text, storage_path text, sha256 text,
  width integer, height integer, has_transparency boolean, file_size bigint,
  created_at timestamptz, updated_at timestamptz, reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_owner_id uuid;
  v_asset record;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );
  v_owner_id := public.storage_require_writer(p_project_id, auth.uid());
  perform private.storage_set_quota_check_bytes_v2(v_owner_id, true);

  select * into v_asset
  from public.complete_project_game_asset_storage_upload(
    p_reservation_id, p_project_id, p_name, p_category, p_mime_type,
    p_storage_bucket, p_storage_path, p_sha256, p_width, p_height,
    p_has_transparency, p_file_size, p_object_created_at
  );

  perform private.storage_set_quota_check_bytes_v2(v_owner_id, false);

  return query select
    v_asset.id, v_asset.project_id, v_asset.created_by, v_asset.name,
    v_asset.category, v_asset.status, v_asset.mime_type, v_asset.storage_path,
    v_asset.sha256, v_asset.width, v_asset.height, v_asset.has_transparency,
    v_asset.file_size, v_asset.created_at, v_asset.updated_at, v_asset.reused;
end;
$$;

revoke all on function private.storage_project_visible_physical_files_v6(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_owner_visible_physical_bytes_v6(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_owner_logical_bytes_v6(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_owner_raw_physical_bytes_v6(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_set_quota_check_bytes_v2(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_project_hierarchy_entities_v6(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.storage_project_directory_entries_v6(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.account_storage_project_entities_v6(uuid, text, text, integer, integer, uuid)
  from public, anon, service_role;
grant execute on function public.account_storage_project_entities_v6(uuid, text, text, integer, integer, uuid)
  to authenticated;
revoke all on function public.account_storage_entity_details_v6(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.account_storage_entity_details_v6(uuid, text, uuid)
  to authenticated;
revoke all on function public.account_storage_summary_v6()
  from public, anon, service_role;
grant execute on function public.account_storage_summary_v6()
  to authenticated;

revoke all on function public.storage_reserve_project_storage_upload_v2(uuid, uuid, text, text, bigint, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.storage_finalize_project_storage_upload_v2(uuid, uuid, bigint, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_project_storage_upload_v2(uuid, text, text, bigint, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_project_storage_upload_v2(uuid, text, text, bigint, text, text, text, uuid)
  to authenticated;
revoke all on function public.finalize_project_storage_upload_v2(uuid, bigint, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_project_storage_upload_v2(uuid, bigint, uuid, timestamptz)
  to authenticated;
revoke all on function public.complete_project_game_asset_storage_upload_v2(uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_project_game_asset_storage_upload_v2(uuid, uuid, text, text, text, text, text, text, integer, integer, boolean, bigint, timestamptz)
  to authenticated;
revoke all on function public.service_reserve_project_storage_upload_v2(uuid, uuid, text, text, bigint, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_reserve_project_storage_upload_v2(uuid, uuid, text, text, bigint, text, text, text, uuid)
  to service_role;
revoke all on function public.service_finalize_project_storage_upload_v2(uuid, uuid, bigint, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.service_finalize_project_storage_upload_v2(uuid, uuid, bigint, uuid, timestamptz)
  to service_role;
