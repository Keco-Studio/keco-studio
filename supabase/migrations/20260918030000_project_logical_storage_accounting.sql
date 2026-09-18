-- Unified accounting for user-visible logical project files. Physical upload
-- quota enforcement continues to use account_storage_quotas.used_bytes only.

alter table public.account_storage_quotas
  add column logical_used_bytes bigint not null default 0
  check (logical_used_bytes >= 0);

create table public.project_storage_logical_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('document_content', 'library_table')),
  source_entity_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  mime_type text not null check (char_length(btrim(mime_type)) between 1 and 200),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (source_kind, source_entity_id)
);

create index project_storage_logical_files_owner_project_idx
  on public.project_storage_logical_files (owner_id, project_id, updated_at desc);

alter table public.project_storage_logical_files enable row level security;
revoke all on table public.project_storage_logical_files from public, anon, authenticated;

create or replace function private.storage_document_logical_size(p_document_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.octet_length(coalesce(document.content, ''))::bigint
  from public.documents document
  where document.id = p_document_id;
$$;

create or replace function private.storage_library_logical_payload(p_library_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', library.name,
    'description', library.description,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', field.section,
        'label', field.label,
        'dataType', field.data_type,
        'enumOptions', field.enum_options,
        'required', field.required,
        'orderIndex', field.order_index,
        'description', field.description,
        'formulaExpression', field.formula_expression,
        'referenceLibraries', coalesce((
          select jsonb_agg(reference.name order by reference.name, reference.id)
          from unnest(coalesce(field.reference_libraries, '{}'::uuid[])) as reference_ids(id)
          join public.libraries reference on reference.id = reference_ids.id
        ), '[]'::jsonb)
      ) order by field.order_index, field.id)
      from public.library_field_definitions field
      where field.library_id = library.id
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', asset.name,
        'rowIndex', asset.row_index,
        'values', coalesce((
          select jsonb_agg(jsonb_build_object(
            'fieldSection', field.section,
            'fieldLabel', field.label,
            'value', value.value_json
          ) order by field.order_index, field.id)
          from public.library_field_definitions field
          left join public.library_asset_values value
            on value.field_id = field.id and value.asset_id = asset.id
          where field.library_id = library.id
        ), '[]'::jsonb)
      ) order by asset.row_index nulls last, asset.id)
      from public.library_assets asset
      where asset.library_id = library.id
    ), '[]'::jsonb)
  )
  from public.libraries library
  where library.id = p_library_id;
$$;

create or replace function private.storage_library_logical_size(p_library_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.octet_length(payload::text)::bigint
  from (select private.storage_library_logical_payload(p_library_id) as payload) sized
  where payload is not null;
$$;

create or replace function private.storage_settle_logical_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );

  if tg_op = 'DELETE' then
    insert into public.account_storage_quotas (owner_id)
    values (old.owner_id)
    on conflict (owner_id) do nothing;
    perform 1 from public.account_storage_quotas quota
    where quota.owner_id = old.owner_id for update;
    if (select logical_used_bytes from public.account_storage_quotas where owner_id = old.owner_id) < old.size_bytes then
      raise exception 'Logical storage usage underflow'
        using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
    end if;
    update public.account_storage_quotas
    set logical_used_bytes = logical_used_bytes - old.size_bytes,
        updated_at = clock_timestamp()
    where owner_id = old.owner_id;
    return old;
  end if;

  insert into public.account_storage_quotas (owner_id)
  values (new.owner_id)
  on conflict (owner_id) do nothing;

  if tg_op = 'INSERT' then
    perform 1 from public.account_storage_quotas quota
    where quota.owner_id = new.owner_id for update;
    update public.account_storage_quotas
    set logical_used_bytes = logical_used_bytes + new.size_bytes,
        updated_at = clock_timestamp()
    where owner_id = new.owner_id;
    return new;
  end if;

  if old.owner_id = new.owner_id then
    perform 1 from public.account_storage_quotas quota
    where quota.owner_id = new.owner_id for update;
    v_delta := new.size_bytes - old.size_bytes;
    if v_delta < 0 and
       (select logical_used_bytes from public.account_storage_quotas where owner_id = new.owner_id) < -v_delta then
      raise exception 'Logical storage usage underflow'
        using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
    end if;
    update public.account_storage_quotas
    set logical_used_bytes = logical_used_bytes + v_delta,
        updated_at = clock_timestamp()
    where owner_id = new.owner_id;
    return new;
  end if;

  insert into public.account_storage_quotas (owner_id)
  values (old.owner_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.account_storage_quotas quota
  where quota.owner_id in (old.owner_id, new.owner_id)
  order by quota.owner_id for update;
  if (select logical_used_bytes from public.account_storage_quotas where owner_id = old.owner_id) < old.size_bytes then
    raise exception 'Logical storage usage underflow'
      using errcode = 'P0001', detail = 'STORAGE_USAGE_UNDERFLOW';
  end if;
  update public.account_storage_quotas
  set logical_used_bytes = logical_used_bytes - old.size_bytes,
      updated_at = clock_timestamp()
  where owner_id = old.owner_id;
  update public.account_storage_quotas
  set logical_used_bytes = logical_used_bytes + new.size_bytes,
      updated_at = clock_timestamp()
  where owner_id = new.owner_id;
  return new;
end;
$$;

create trigger trg_settle_project_storage_logical_file
after insert or delete or update of project_id, owner_id, size_bytes
on public.project_storage_logical_files
for each row execute function private.storage_settle_logical_file();

create or replace function private.storage_sync_document_logical_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.project_storage_logical_files
    where source_kind = 'document_content' and source_entity_id = old.id;
    return old;
  end if;

  select project.owner_id into v_owner_id
  from public.projects project
  where project.id = new.project_id;
  if v_owner_id is null then
    delete from public.project_storage_logical_files
    where source_kind = 'document_content' and source_entity_id = new.id;
    return new;
  end if;

  insert into public.project_storage_logical_files (
    project_id, owner_id, source_kind, source_entity_id,
    display_name, mime_type, size_bytes, created_at, updated_at
  ) values (
    new.project_id, v_owner_id, 'document_content', new.id,
    new.name, 'text/markdown', pg_catalog.octet_length(coalesce(new.content, '')),
    new.created_at, clock_timestamp()
  )
  on conflict (source_kind, source_entity_id) do update set
    project_id = excluded.project_id,
    owner_id = excluded.owner_id,
    display_name = excluded.display_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    updated_at = clock_timestamp();
  return new;
end;
$$;

create or replace function private.storage_sync_library_logical_file(p_library_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_owner_id uuid;
  v_size bigint;
begin
  select * into v_library from public.libraries library where library.id = p_library_id;
  if not found then
    delete from public.project_storage_logical_files
    where source_kind = 'library_table' and source_entity_id = p_library_id;
    return;
  end if;

  select project.owner_id into v_owner_id
  from public.projects project
  where project.id = v_library.project_id;
  if v_owner_id is null then
    delete from public.project_storage_logical_files
    where source_kind = 'library_table' and source_entity_id = p_library_id;
    return;
  end if;
  v_size := private.storage_library_logical_size(p_library_id);

  insert into public.project_storage_logical_files (
    project_id, owner_id, source_kind, source_entity_id,
    display_name, mime_type, size_bytes, created_at, updated_at
  ) values (
    v_library.project_id, v_owner_id, 'library_table', v_library.id,
    v_library.name, 'application/x-keco-library+json', coalesce(v_size, 0),
    v_library.created_at, clock_timestamp()
  )
  on conflict (source_kind, source_entity_id) do update set
    project_id = excluded.project_id,
    owner_id = excluded.owner_id,
    display_name = excluded.display_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    updated_at = clock_timestamp();
end;
$$;

create or replace function private.storage_sync_library_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dependent_library_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.project_storage_logical_files
    where source_kind = 'library_table' and source_entity_id = old.id;
    for v_dependent_library_id in
      select distinct field.library_id
      from public.library_field_definitions field
      where old.id = any(coalesce(field.reference_libraries, '{}'::uuid[]))
    loop
      perform private.storage_sync_library_logical_file(v_dependent_library_id);
    end loop;
    return old;
  end if;
  perform private.storage_sync_library_logical_file(new.id);
  if tg_op = 'UPDATE' and old.name is distinct from new.name then
    for v_dependent_library_id in
      select distinct field.library_id
      from public.library_field_definitions field
      where new.id = any(coalesce(field.reference_libraries, '{}'::uuid[]))
    loop
      perform private.storage_sync_library_logical_file(v_dependent_library_id);
    end loop;
  end if;
  return new;
end;
$$;

create or replace function private.storage_sync_library_field_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library_id uuid;
begin
  if tg_op = 'INSERT' then
    for v_library_id in select distinct library_id from new_rows loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_library_id in select distinct library_id from old_rows loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  else
    for v_library_id in
      select library_id from new_rows union select library_id from old_rows
    loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  end if;
  return null;
end;
$$;

create or replace function private.storage_sync_library_asset_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library_id uuid;
begin
  if tg_op = 'INSERT' then
    for v_library_id in select distinct library_id from new_rows loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_library_id in select distinct library_id from old_rows loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  else
    for v_library_id in
      select library_id from new_rows union select library_id from old_rows
    loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  end if;
  return null;
end;
$$;

create or replace function private.storage_sync_library_value_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library_id uuid;
begin
  if tg_op = 'INSERT' then
    for v_library_id in
      select distinct asset.library_id
      from new_rows value join public.library_assets asset on asset.id = value.asset_id
    loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_library_id in
      select distinct asset.library_id
      from old_rows value join public.library_assets asset on asset.id = value.asset_id
    loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  else
    for v_library_id in
      select asset.library_id
      from new_rows value join public.library_assets asset on asset.id = value.asset_id
      union
      select asset.library_id
      from old_rows value join public.library_assets asset on asset.id = value.asset_id
    loop
      perform private.storage_sync_library_logical_file(v_library_id);
    end loop;
  end if;
  return null;
end;
$$;

-- Stop the document-only counter before copying its rows into the unified
-- registry. The final rebuild below restores both cached counters from source.
drop trigger if exists trg_sync_document_content_storage on public.documents;
drop trigger if exists trg_settle_document_content_storage on public.project_storage_document_content;

create trigger trg_sync_document_logical_file
after insert or delete or update of project_id, name, content on public.documents
for each row execute function private.storage_sync_document_logical_file();

create trigger trg_sync_library_logical_file
after insert or delete or update of project_id, name, description on public.libraries
for each row execute function private.storage_sync_library_row();

create trigger trg_sync_library_field_insert
after insert on public.library_field_definitions
referencing new table as new_rows for each statement
execute function private.storage_sync_library_field_statement();
create trigger trg_sync_library_field_update
after update on public.library_field_definitions
referencing old table as old_rows new table as new_rows for each statement
execute function private.storage_sync_library_field_statement();
create trigger trg_sync_library_field_delete
after delete on public.library_field_definitions
referencing old table as old_rows for each statement
execute function private.storage_sync_library_field_statement();

create trigger trg_sync_library_asset_insert
after insert on public.library_assets
referencing new table as new_rows for each statement
execute function private.storage_sync_library_asset_statement();
create trigger trg_sync_library_asset_update
after update on public.library_assets
referencing old table as old_rows new table as new_rows for each statement
execute function private.storage_sync_library_asset_statement();
create trigger trg_sync_library_asset_delete
after delete on public.library_assets
referencing old table as old_rows for each statement
execute function private.storage_sync_library_asset_statement();

create trigger trg_sync_library_value_insert
after insert on public.library_asset_values
referencing new table as new_rows for each statement
execute function private.storage_sync_library_value_statement();
create trigger trg_sync_library_value_update
after update on public.library_asset_values
referencing old table as old_rows new table as new_rows for each statement
execute function private.storage_sync_library_value_statement();
create trigger trg_sync_library_value_delete
after delete on public.library_asset_values
referencing old table as old_rows for each statement
execute function private.storage_sync_library_value_statement();

insert into public.project_storage_logical_files (
  project_id, owner_id, source_kind, source_entity_id,
  display_name, mime_type, size_bytes, created_at, updated_at
)
select document.project_id, project.owner_id, 'document_content', document.id,
  document.name, 'text/markdown', pg_catalog.octet_length(coalesce(document.content, '')),
  document.created_at, clock_timestamp()
from public.documents document
join public.projects project on project.id = document.project_id
where project.owner_id is not null
on conflict (source_kind, source_entity_id) do update set
  project_id = excluded.project_id, owner_id = excluded.owner_id,
  display_name = excluded.display_name, mime_type = excluded.mime_type,
  size_bytes = excluded.size_bytes, updated_at = clock_timestamp();

do $$
declare
  v_library_id uuid;
begin
  for v_library_id in
    select library.id
    from public.libraries library
    join public.projects project on project.id = library.project_id
    where project.owner_id is not null
  loop
    perform private.storage_sync_library_logical_file(v_library_id);
  end loop;
end;
$$;

drop table public.project_storage_document_content;
drop function if exists private.sync_document_content_storage();
drop function if exists private.settle_document_content_storage();

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
          where file.project_id = project.id and file.owner_id = v_actor and file.lifecycle_status = 'active')
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
          where file.project_id = project.id and file.owner_id = project.owner_id and file.lifecycle_status = 'active')
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
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at,
      file.source_entity_id is null or exists (
        select 1 from public.project_storage_file_locations location
        where location.file_id = file.id
          and location.source_entity_id is not distinct from file.source_entity_id
      ) as source_available
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
    union all
    select logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true
    from public.project_storage_logical_files logical
    where logical.project_id = p_project_id
  ), filtered as (
    select * from listed
    where nullif(btrim(p_query), '') is null
      or display_name ilike '%' || btrim(p_query) || '%'
  )
  select count(*) into v_total from filtered;

  with listed as (
    select file.id, file.display_name, file.mime_type, file.size_bytes, file.source_kind,
      file.source_entity_id, file.created_at,
      file.source_entity_id is null or exists (
        select 1 from public.project_storage_file_locations location
        where location.file_id = file.id
          and location.source_entity_id is not distinct from file.source_entity_id
      ) as source_available
    from public.project_storage_files file
    where file.project_id = p_project_id and file.lifecycle_status = 'active'
    union all
    select logical.id, logical.display_name, logical.mime_type, logical.size_bytes,
      logical.source_kind, logical.source_entity_id, logical.created_at, true
    from public.project_storage_logical_files logical
    where logical.project_id = p_project_id
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

create or replace function public.service_rebuild_account_storage_quota_totals()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accounts integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-project-storage-accounting', 0)
  );
  insert into public.account_storage_quotas (owner_id, used_bytes, logical_used_bytes, reserved_bytes)
  select owner_id, 0, 0, 0 from (
    select file.owner_id from public.project_storage_files file
    union select logical.owner_id from public.project_storage_logical_files logical
    union select reservation.owner_id from public.storage_upload_reservations reservation
  ) owners on conflict (owner_id) do nothing;

  update public.account_storage_quotas quota
  set used_bytes = coalesce((select sum(file.size_bytes) from public.project_storage_files file
      where file.owner_id = quota.owner_id and file.lifecycle_status in ('active', 'pending_cleanup')), 0),
      logical_used_bytes = coalesce((select sum(logical.size_bytes)
        from public.project_storage_logical_files logical
        where logical.owner_id = quota.owner_id), 0),
      reserved_bytes = coalesce((select sum(reservation.expected_bytes)
        from public.storage_upload_reservations reservation
        where reservation.owner_id = quota.owner_id and reservation.status = 'pending'
          and reservation.expires_at > clock_timestamp()), 0),
      updated_at = clock_timestamp()
  where quota.owner_id is not null;
  get diagnostics v_accounts = row_count;
  return jsonb_build_object('rebuiltAccounts', v_accounts);
end;
$$;

revoke all on function private.storage_document_logical_size(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_library_logical_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_library_logical_size(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_settle_logical_file() from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_document_logical_file() from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_library_logical_file(uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_library_row() from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_library_field_statement() from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_library_asset_statement() from public, anon, authenticated, service_role;
revoke all on function private.storage_sync_library_value_statement() from public, anon, authenticated, service_role;
revoke all on function public.account_storage_summary() from public, anon, service_role;
revoke all on function public.account_storage_project_files(uuid, text, text, integer, integer) from public, anon, service_role;
revoke all on function public.service_rebuild_account_storage_quota_totals() from public, anon, authenticated;
grant execute on function public.account_storage_summary() to authenticated;
grant execute on function public.account_storage_project_files(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.service_rebuild_account_storage_quota_totals() to service_role;

select public.service_rebuild_account_storage_quota_totals();
