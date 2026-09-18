-- Present each document as one logical file. Its displayed size includes the
-- Markdown body and physical images that are owned by that document, while the
-- account counters continue to keep physical and logical bytes separate.

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
      'id', project.id, 'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount',
        (select count(*) from public.project_storage_files file
          where file.project_id = project.id and file.owner_id = v_actor
            and file.lifecycle_status = 'active'
            and not (file.source_kind = 'document_image' and exists (
              select 1 from public.project_storage_logical_files logical
              where logical.source_kind = 'document_content'
                and logical.source_entity_id = file.source_entity_id
                and logical.project_id = project.id
            )))
        + (select count(*) from public.project_storage_logical_files logical
          where logical.project_id = project.id and logical.owner_id = v_actor),
      'usedBytes',
        (select coalesce(sum(file.size_bytes), 0) from public.project_storage_files file
          where file.project_id = project.id and file.owner_id = v_actor and file.lifecycle_status = 'active')
        + (select coalesce(sum(logical.size_bytes), 0) from public.project_storage_logical_files logical
          where logical.project_id = project.id and logical.owner_id = v_actor),
      'ownedByCurrentUser', true
    ) as row_json,
    (select coalesce(sum(file.size_bytes), 0) from public.project_storage_files file
      where file.project_id = project.id and file.owner_id = v_actor and file.lifecycle_status = 'active')
    + (select coalesce(sum(logical.size_bytes), 0) from public.project_storage_logical_files logical
      where logical.project_id = project.id and logical.owner_id = v_actor) as sort_bytes
    from public.projects project
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id = v_actor
  ) owned;

  select coalesce(jsonb_agg(row_json order by sort_bytes desc, row_json ->> 'name'), '[]'::jsonb) into v_shared
  from (
    select jsonb_build_object(
      'id', project.id, 'name', project.name,
      'ownerName', coalesce(profile.full_name, profile.username, ''),
      'fileCount',
        (select count(*) from public.project_storage_files file
          where file.project_id = project.id and file.owner_id = project.owner_id
            and file.lifecycle_status = 'active'
            and not (file.source_kind = 'document_image' and exists (
              select 1 from public.project_storage_logical_files logical
              where logical.source_kind = 'document_content'
                and logical.source_entity_id = file.source_entity_id
                and logical.project_id = project.id
            )))
        + (select count(*) from public.project_storage_logical_files logical
          where logical.project_id = project.id and logical.owner_id = project.owner_id),
      'usedBytes',
        (select coalesce(sum(file.size_bytes), 0) from public.project_storage_files file
          where file.project_id = project.id and file.owner_id = project.owner_id and file.lifecycle_status = 'active')
        + (select coalesce(sum(logical.size_bytes), 0) from public.project_storage_logical_files logical
          where logical.project_id = project.id and logical.owner_id = project.owner_id),
      'ownedByCurrentUser', false
    ) as row_json,
    (select coalesce(sum(file.size_bytes), 0) from public.project_storage_files file
      where file.project_id = project.id and file.owner_id = project.owner_id and file.lifecycle_status = 'active')
    + (select coalesce(sum(logical.size_bytes), 0) from public.project_storage_logical_files logical
      where logical.project_id = project.id and logical.owner_id = project.owner_id) as sort_bytes
    from public.projects project
    join public.project_collaborators collaborator on collaborator.project_id = project.id
      and collaborator.user_id = v_actor and collaborator.accepted_at is not null
    left join public.profiles profile on profile.id = project.owner_id
    where project.owner_id <> v_actor
  ) shared;

  select case when count(file.id) = 0 then null else jsonb_build_object(
    'fileCount', count(file.id), 'usedBytes', coalesce(sum(file.size_bytes), 0)
  ) end into v_unassigned
  from public.project_storage_files file
  where file.owner_id = v_actor and file.project_id is null and file.lifecycle_status = 'active';

  return jsonb_build_object(
    'quotaBytes', v_quota.quota_bytes,
    'usedBytes', v_display_used,
    'physicalUsedBytes', v_physical_used,
    'logicalUsedBytes', v_logical_used,
    'reservedBytes', v_quota.reserved_bytes,
    'remainingBytes', greatest(v_quota.quota_bytes - v_display_used - v_quota.reserved_bytes, 0),
    'overageBytes', greatest(v_display_used + v_quota.reserved_bytes - v_quota.quota_bytes, 0),
    'ownedProjects', v_owned, 'sharedProjects', v_shared, 'unassigned', v_unassigned
  );
end;
$$;

create or replace function public.account_storage_project_files(
  p_project_id uuid, p_query text default null, p_sort text default 'size_desc',
  p_limit integer default 50, p_offset integer default 0
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

  with listed as (
    select logical.id, logical.display_name,
      case when count(image.id) > 0 then 'application/x-keco-document' else logical.mime_type end as mime_type,
      logical.size_bytes + coalesce(sum(image.size_bytes), 0) as size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true as source_available
    from public.project_storage_logical_files logical
    left join public.project_storage_files image
      on image.project_id = logical.project_id
      and image.owner_id = logical.owner_id
      and image.lifecycle_status = 'active'
      and image.source_kind = 'document_image'
      and image.source_entity_id = logical.source_entity_id
    where logical.project_id = p_project_id and logical.source_kind = 'document_content'
    group by logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at
    union all
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at,
      file.source_entity_id is null or exists (
        select 1 from public.project_storage_file_locations location
        where location.file_id = file.id
          and location.source_entity_id is not distinct from file.source_entity_id
      )
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and not (file.source_kind = 'document_image' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = p_project_id
          and logical.source_kind = 'document_content'
          and logical.source_entity_id = file.source_entity_id
      ))
    union all
    select logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true
    from public.project_storage_logical_files logical
    where logical.project_id = p_project_id and logical.source_kind <> 'document_content'
  ), filtered as (
    select * from listed
    where nullif(btrim(p_query), '') is null
      or display_name ilike '%' || btrim(p_query) || '%'
  )
  select count(*) into v_total from filtered;

  with listed as (
    select logical.id, logical.display_name,
      case when count(image.id) > 0 then 'application/x-keco-document' else logical.mime_type end as mime_type,
      logical.size_bytes + coalesce(sum(image.size_bytes), 0) as size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true as source_available
    from public.project_storage_logical_files logical
    left join public.project_storage_files image
      on image.project_id = logical.project_id
      and image.owner_id = logical.owner_id
      and image.lifecycle_status = 'active'
      and image.source_kind = 'document_image'
      and image.source_entity_id = logical.source_entity_id
    where logical.project_id = p_project_id and logical.source_kind = 'document_content'
    group by logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at
    union all
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at,
      file.source_entity_id is null or exists (
        select 1 from public.project_storage_file_locations location
        where location.file_id = file.id
          and location.source_entity_id is not distinct from file.source_entity_id
      )
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
      and not (file.source_kind = 'document_image' and exists (
        select 1 from public.project_storage_logical_files logical
        where logical.project_id = p_project_id
          and logical.source_kind = 'document_content'
          and logical.source_entity_id = file.source_entity_id
      ))
    union all
    select logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true
    from public.project_storage_logical_files logical
    where logical.project_id = p_project_id and logical.source_kind <> 'document_content'
  ), filtered as (
    select * from listed
    where nullif(btrim(p_query), '') is null
      or display_name ilike '%' || btrim(p_query) || '%'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'name', page.display_name, 'mimeType', page.mime_type,
    'sizeBytes', page.size_bytes, 'sourceKind', page.source_kind,
    'sourceEntityId', page.source_entity_id, 'createdAt', page.created_at,
    'sourceAvailable', page.source_available
  )), '[]'::jsonb) into v_items
  from (
    select filtered.* from filtered
    order by
      case when p_sort = 'size_desc' then filtered.size_bytes end desc,
      case when p_sort = 'size_asc' then filtered.size_bytes end asc,
      case when p_sort = 'created_desc' then filtered.created_at end desc,
      case when p_sort = 'created_asc' then filtered.created_at end asc,
      case when p_sort = 'name_asc' then lower(filtered.display_name) end asc,
      case when p_sort = 'name_desc' then lower(filtered.display_name) end desc,
      filtered.id
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.account_storage_summary() from public, anon, service_role;
revoke all on function public.account_storage_project_files(uuid, text, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.account_storage_summary() to authenticated;
grant execute on function public.account_storage_project_files(uuid, text, text, integer, integer)
  to authenticated;
