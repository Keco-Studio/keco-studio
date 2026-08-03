-- MCP table maintenance P0/P1: schema edits, destructive maintenance, and batch row writes.

create or replace function public.mcp_reference_value_contains_asset(
  p_value jsonb,
  p_asset_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then false
    when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' = p_asset_id::text
    when jsonb_typeof(p_value) = 'object' then coalesce(p_value ->> 'assetId', p_value ->> 'id') = p_asset_id::text
    when jsonb_typeof(p_value) = 'array' then exists (
      select 1
      from jsonb_array_elements(p_value) as item(value)
      where (
        jsonb_typeof(item.value) = 'string'
        and item.value #>> '{}' = p_asset_id::text
      ) or (
        jsonb_typeof(item.value) = 'object'
        and coalesce(item.value ->> 'assetId', item.value ->> 'id') = p_asset_id::text
      )
    )
    else false
  end
$$;

create or replace function public.mcp_reference_value_remove_assets(
  p_value jsonb,
  p_asset_ids uuid[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_kept_count integer;
  v_asset_id_texts text[];
begin
  if p_value is null or p_value = 'null'::jsonb or coalesce(array_length(p_asset_ids, 1), 0) = 0 then
    return p_value;
  end if;
  select array_agg(asset_id::text) into v_asset_id_texts
  from unnest(p_asset_ids) as asset_id;

  if jsonb_typeof(p_value) = 'string' then
    if (p_value #>> '{}') = any(v_asset_id_texts) then
      return 'null'::jsonb;
    end if;
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    if coalesce(p_value ->> 'assetId', p_value ->> 'id', '') = any(v_asset_id_texts) then
      return 'null'::jsonb;
    end if;
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(item.value), '[]'::jsonb), count(*)
    into v_result, v_kept_count
    from jsonb_array_elements(p_value) as item(value)
    where not (
      jsonb_typeof(item.value) = 'string'
      and (item.value #>> '{}') = any(v_asset_id_texts)
    ) and not (
      jsonb_typeof(item.value) = 'object'
      and coalesce(item.value ->> 'assetId', item.value ->> 'id', '') = any(v_asset_id_texts)
    );
    if v_kept_count = 0 then
      return 'null'::jsonb;
    end if;
    return v_result;
  end if;

  return p_value;
end;
$$;

create or replace function public.mcp_clear_references_to_assets(
  p_project_id uuid,
  p_asset_ids uuid[],
  p_target_table_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if coalesce(array_length(p_asset_ids, 1), 0) = 0
    or coalesce(array_length(p_target_table_ids, 1), 0) = 0 then
    return 0;
  end if;

  with candidates as (
    select value.asset_id, value.field_id, value.value_json
    from public.library_asset_values as value
    join public.library_field_definitions as field
      on field.id = value.field_id and field.data_type = 'reference'
      and coalesce(field.reference_libraries, array[]::uuid[]) && p_target_table_ids
    join public.library_assets as referencing_asset
      on referencing_asset.id = value.asset_id
    join public.libraries as referencing_table
      on referencing_table.id = referencing_asset.library_id
      and referencing_table.project_id = p_project_id
    where exists (
      select 1
      from unnest(p_asset_ids) as target(asset_id)
      where public.mcp_reference_value_contains_asset(value.value_json, target.asset_id)
    )
  ),
  patched as (
    select
      candidates.asset_id,
      candidates.field_id,
      public.mcp_reference_value_remove_assets(candidates.value_json, p_asset_ids) as next_value
    from candidates
  ),
  deleted as (
    delete from public.library_asset_values as value
    using patched
    where value.asset_id = patched.asset_id
      and value.field_id = patched.field_id
      and public.mcp_value_is_empty(patched.next_value)
    returning value.asset_id, value.field_id
  ),
  updated as (
    update public.library_asset_values as value
    set value_json = patched.next_value
    from patched
    where value.asset_id = patched.asset_id
      and value.field_id = patched.field_id
      and not public.mcp_value_is_empty(patched.next_value)
      and value.value_json is distinct from patched.next_value
    returning value.asset_id, value.field_id
  )
  select count(*) into v_updated
  from (
    select * from deleted
    union all
    select * from updated
  ) as changed;

  return coalesce(v_updated, 0);
end;
$$;

create or replace function public.mcp_field_definition_from_json(
  p_project_id uuid,
  p_table_id uuid,
  p_field jsonb
)
returns table (
  label text,
  data_type text,
  section text,
  section_id text,
  description text,
  required boolean,
  enum_options text[],
  reference_table_ids uuid[]
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_type text;
  v_label text;
  v_section text;
  v_section_id text;
  v_description text;
  v_required boolean;
  v_enum_options text[];
  v_reference_table_ids uuid[];
  v_section_count integer;
begin
  if jsonb_typeof(p_field) is distinct from 'object' then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_field) as key(name)
    where key.name <> all (array[
      'label', 'dataType', 'section', 'sectionId', 'description', 'required',
      'enumOptions', 'referenceTableIds'
    ])
  ) then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;

  v_type := p_field ->> 'dataType';
  v_label := btrim(p_field ->> 'label');
  v_section := coalesce(nullif(btrim(p_field ->> 'section'), ''), 'section1');
  v_section_id := nullif(btrim(p_field ->> 'sectionId'), '');
  v_description := nullif(p_field ->> 'description', '');

  if v_type is null or v_type not in (
    'string','string_array','int','int_array','float','float_array',
    'boolean','enum','date','reference','image'
  )
    or jsonb_typeof(p_field -> 'label') is distinct from 'string'
    or length(v_label) not between 1 and 200
    or length(v_section) not between 1 and 100
    or length(v_description) > 1000
    or (p_field ? 'section' and jsonb_typeof(p_field -> 'section') <> 'string')
    or (p_field ? 'sectionId' and (
      jsonb_typeof(p_field -> 'sectionId') <> 'string'
      or length(btrim(p_field ->> 'sectionId')) not between 1 and 200
    ))
    or (p_field ? 'description'
      and jsonb_typeof(p_field -> 'description') not in ('string', 'null'))
    or (p_field ? 'required'
      and jsonb_typeof(p_field -> 'required') <> 'boolean') then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;

  if v_type = 'enum' then
    if jsonb_typeof(p_field -> 'enumOptions') is distinct from 'array'
      or jsonb_array_length(p_field -> 'enumOptions') not between 1 and 100
      or exists (
        select 1 from jsonb_array_elements(p_field -> 'enumOptions') as option(value)
        where jsonb_typeof(option.value) is distinct from 'string'
          or length(btrim(option.value #>> '{}')) not between 1 and 200
      ) then
      raise exception 'Enum options are required' using errcode = '22023';
    end if;
    select array_agg(btrim(value #>> '{}')) into v_enum_options
    from jsonb_array_elements(p_field -> 'enumOptions') as option(value);
  elsif p_field ? 'enumOptions' then
    raise exception 'Enum options require an enum field' using errcode = '22023';
  end if;

  if v_type = 'reference' then
    if jsonb_typeof(p_field -> 'referenceTableIds') is distinct from 'array'
      or jsonb_array_length(p_field -> 'referenceTableIds') not between 1 and 20 then
      raise exception 'Reference table IDs are required' using errcode = '22023';
    end if;
    begin
      select array_agg((value #>> '{}')::uuid) into v_reference_table_ids
      from jsonb_array_elements(p_field -> 'referenceTableIds') as target(value);
    exception when invalid_text_representation then
      raise exception 'Reference table IDs must be UUID strings' using errcode = '22023';
    end;
    if exists (
      select 1
      from unnest(v_reference_table_ids) as target(id)
      left join public.libraries as referenced
        on referenced.id = target.id and referenced.project_id = p_project_id
      where referenced.id is null
    ) then
      raise exception 'Reference table is outside project' using errcode = '23503';
    end if;
  elsif p_field ? 'referenceTableIds' then
    raise exception 'Reference targets require a reference field' using errcode = '22023';
  end if;

  v_required := coalesce((p_field ->> 'required')::boolean, false);

  if v_section_id is null then
    select min(field.section_id), count(distinct field.section_id)
    into v_section_id, v_section_count
    from public.library_field_definitions as field
    where field.library_id = p_table_id and field.section = v_section;
    if v_section_count > 1 then
      raise exception 'Section name is ambiguous; sectionId is required' using errcode = '22023';
    end if;
    v_section_id := coalesce(v_section_id, md5(p_table_id::text || ':' || v_section));
  end if;

  return query select
    v_label,
    v_type,
    v_section,
    v_section_id,
    v_description,
    v_required,
    v_enum_options,
    v_reference_table_ids;
end;
$$;

create or replace function public.mcp_edit_table_field(
  p_project_id uuid,
  p_table_id uuid,
  p_field_id uuid,
  p_field jsonb,
  p_clear_values_on_type_change boolean default false
)
returns table (
  field_id uuid,
  table_id uuid,
  label text,
  data_type text,
  section text,
  section_id text,
  order_index integer,
  required boolean,
  description text,
  enum_options text[],
  reference_table_ids uuid[],
  cleared_value_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_existing public.library_field_definitions%rowtype;
  v_next record;
  v_value record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_non_empty_count integer;
  v_cleared_count integer := 0;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  select * into v_existing from public.library_field_definitions where id = p_field_id and library_id = p_table_id for update;
  if not found then raise exception 'Field not found' using errcode = 'P0002'; end if;

  select * into v_next
  from public.mcp_field_definition_from_json(p_project_id, p_table_id, p_field);

  if exists (
    select 1 from public.library_field_definitions as field
    where field.library_id = p_table_id
      and field.id <> p_field_id
      and lower(btrim(field.label)) = lower(v_next.label)
  ) then
    raise exception 'Field label already exists' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.library_field_definitions as field
    where field.section_id = v_next.section_id
      and field.library_id <> p_table_id
  ) then
    raise exception 'Section is outside table' using errcode = '23503';
  end if;

  if v_existing.data_type is distinct from v_next.data_type then
    select count(*) into v_non_empty_count
    from public.library_asset_values as value
    where value.field_id = p_field_id
      and not public.mcp_value_is_empty(value.value_json);
    if v_non_empty_count > 0 and not p_clear_values_on_type_change then
      raise exception 'Field has values; clearValuesOnTypeChange is required' using errcode = 'PT409';
    end if;
    if v_non_empty_count > 0 then
      delete from public.library_asset_values where field_id = p_field_id;
      v_cleared_count := v_non_empty_count;
    end if;
  end if;

  update public.library_field_definitions
  set
    label = v_next.label,
    data_type = v_next.data_type,
    section = v_next.section,
    section_id = v_next.section_id,
    description = v_next.description,
    required = v_next.required,
    enum_options = v_next.enum_options,
    reference_libraries = v_next.reference_table_ids,
    -- Field formulas depend on the previous field definition and are reset on edit.
    formula_expression = null
  where id = p_field_id and library_id = p_table_id
  returning * into v_existing;

  for v_value in
    select value_json from public.library_asset_values
    where field_id = p_field_id and not public.mcp_value_is_empty(value_json)
  loop
    perform public.mcp_validate_field_value(
      p_project_id,
      p_table_id,
      v_existing,
      v_value.value_json
    );
  end loop;

  if coalesce(v_existing.required, false) and exists (
    select 1
    from public.library_assets as asset
    left join public.library_asset_values as value
      on value.asset_id = asset.id and value.field_id = p_field_id
    where asset.library_id = p_table_id
      and public.mcp_value_is_empty(value.value_json)
  ) then
    raise exception 'Required field would be empty for existing rows' using errcode = 'PT409';
  end if;

  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;

  return query select
    v_existing.id,
    v_existing.library_id,
    v_existing.label,
    v_existing.data_type,
    v_existing.section,
    v_existing.section_id,
    v_existing.order_index,
    coalesce(v_existing.required, false),
    v_existing.description,
    v_existing.enum_options,
    v_existing.reference_libraries,
    v_cleared_count,
    v_now;
end;
$$;

create or replace function public.mcp_delete_table_field(
  p_project_id uuid,
  p_table_id uuid,
  p_field_id uuid,
  p_clear_values boolean default false
)
returns table (
  field_id uuid,
  table_id uuid,
  deleted_value_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_field public.library_field_definitions%rowtype;
  v_field_count integer;
  v_non_empty_count integer;
  v_deleted_values integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  select * into v_field
  from public.library_field_definitions
  where id = p_field_id and library_id = p_table_id
  for update;
  if not found then
    raise exception 'Field not found' using errcode = 'P0002';
  end if;
  select count(*) into v_field_count from public.library_field_definitions where library_id = p_table_id;
  if v_field_count <= 1 then
    raise exception 'Cannot delete the last field in a table' using errcode = '22023';
  end if;
  select count(*) into v_non_empty_count
  from public.library_asset_values
  where field_id = p_field_id and not public.mcp_value_is_empty(value_json);
  if v_non_empty_count > 0 and not p_clear_values then
    raise exception 'Field has values; clearValues is required' using errcode = 'PT409';
  end if;
  delete from public.library_asset_values where field_id = p_field_id;
  get diagnostics v_deleted_values = row_count;
  delete from public.library_field_definitions where id = p_field_id and library_id = p_table_id;
  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_field_id, p_table_id, v_deleted_values, v_now;
end;
$$;

create or replace function public.mcp_delete_table_row(
  p_project_id uuid,
  p_table_id uuid,
  p_row_id uuid default null,
  p_row_index integer default null,
  p_expected_row_id uuid default null,
  p_clear_references boolean default false
)
returns table (
  row_id uuid,
  row_index integer,
  cleared_reference_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_row public.library_assets%rowtype;
  v_reference_count integer;
  v_cleared_references integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if (p_row_id is null) = (p_row_index is null) or p_row_index is not null and p_row_index < 1 then
    raise exception 'Exactly one row selector is required' using errcode = '22023';
  end if;
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  if p_row_id is not null then
    select * into v_row from public.library_assets where id = p_row_id and library_id = p_table_id for update;
  else
    select * into v_row from public.library_assets where library_id = p_table_id
    order by row_index nulls last, id offset p_row_index - 1 limit 1 for update;
  end if;
  if v_row.id is null then raise exception 'Row not found' using errcode = 'P0002'; end if;
  if p_expected_row_id is not null and p_expected_row_id <> v_row.id then
    raise exception 'Row changed' using errcode = 'PT409';
  end if;
  select count(*) into v_reference_count
  from public.library_asset_values as value
  join public.library_field_definitions as field
    on field.id = value.field_id and field.data_type = 'reference'
    and coalesce(field.reference_libraries, array[]::uuid[]) && array[p_table_id]
  join public.library_assets as referencing_asset
    on referencing_asset.id = value.asset_id
  join public.libraries as referencing_table
    on referencing_table.id = referencing_asset.library_id
    and referencing_table.project_id = p_project_id
  where public.mcp_reference_value_contains_asset(value.value_json, v_row.id);
  if v_reference_count > 0 and not p_clear_references then
    raise exception 'Row is referenced; clearReferences is required' using errcode = 'PT409';
  end if;
  if v_reference_count > 0 then
    v_cleared_references := public.mcp_clear_references_to_assets(
      p_project_id,
      array[v_row.id],
      array[p_table_id]
    );
  end if;
  delete from public.library_assets where id = v_row.id and library_id = p_table_id;
  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select v_row.id, v_row.row_index, v_cleared_references, v_now;
end;
$$;

create or replace function public.mcp_update_table(
  p_project_id uuid,
  p_table_id uuid,
  p_name text default null,
  p_description text default null,
  p_folder_id uuid default null,
  p_set_folder boolean default false,
  p_set_description boolean default false
)
returns table (
  table_id uuid,
  name text,
  description text,
  folder_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_previous_folder_id uuid;
  v_name text;
  v_description text;
  v_folder_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  if p_name is null and not p_set_description and not p_set_folder then
    raise exception 'At least one table field is required' using errcode = '22023';
  end if;
  v_name := coalesce(nullif(btrim(p_name), ''), v_table.name);
  v_description := case when p_set_description then nullif(btrim(p_description), '') else v_table.description end;
  v_folder_id := case when p_set_folder then p_folder_id else v_table.folder_id end;
  if length(v_name) not between 1 and 200 or length(v_description) > 2000 then
    raise exception 'Invalid table metadata' using errcode = '22023';
  end if;
  if v_folder_id is not null and not exists (
    select 1 from public.folders where id = v_folder_id and project_id = p_project_id
  ) then
    raise exception 'Folder is outside project' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.libraries as library
    where library.project_id = p_project_id
      and library.id <> p_table_id
      and library.folder_id is not distinct from v_folder_id
      and lower(btrim(library.name)) = lower(v_name)
  ) then
    raise exception 'Table name already exists' using errcode = '23505';
  end if;
  v_previous_folder_id := v_table.folder_id;
  update public.libraries
  set name = v_name, description = v_description, folder_id = v_folder_id,
      updated_at = v_now, updated_by = v_actor
  where id = p_table_id
  returning * into v_table;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  if v_previous_folder_id is not null and v_previous_folder_id is distinct from v_table.folder_id then
    update public.folders set updated_at = v_now where id = v_previous_folder_id;
  end if;
  return query select v_table.id, v_table.name, v_table.description, v_table.folder_id, v_now;
end;
$$;

create or replace function public.mcp_reorder_table_fields(
  p_project_id uuid,
  p_table_id uuid,
  p_fields jsonb
)
returns table (
  table_id uuid,
  reordered_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_existing_count integer;
  v_input_count integer;
  v_item jsonb;
  v_index integer := 0;
  v_field_id uuid;
  v_section text;
  v_section_id text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_fields) is distinct from 'array' then
    raise exception 'Fields must be an array' using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_fields);
  select count(*) into v_existing_count from public.library_field_definitions where library_id = p_table_id;
  if v_input_count <> v_existing_count or v_input_count = 0 then
    raise exception 'Reorder must include every field exactly once' using errcode = '22023';
  end if;
  if (select count(distinct item.value ->> 'fieldId') from jsonb_array_elements(p_fields) as item(value)) <> v_input_count then
    raise exception 'Reorder field IDs must be unique' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_fields) as item(value)
    left join public.library_field_definitions as field
      on jsonb_typeof(item.value -> 'fieldId') = 'string'
      and (item.value ->> 'fieldId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and field.id = (item.value ->> 'fieldId')::uuid
      and field.library_id = p_table_id
    where jsonb_typeof(item.value) is distinct from 'object'
      or jsonb_typeof(item.value -> 'fieldId') is distinct from 'string'
      or not ((item.value ->> 'fieldId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or jsonb_typeof(item.value -> 'section') is distinct from 'string'
      or (item.value ? 'sectionId' and jsonb_typeof(item.value -> 'sectionId') is distinct from 'string')
      or length(btrim(item.value ->> 'section')) not between 1 and 100
      or length(coalesce(nullif(btrim(item.value ->> 'sectionId'), ''), 'x')) > 200
      or field.id is null
  ) then
    raise exception 'Invalid reorder field entry' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_fields) as item(value)
    join public.library_field_definitions as existing_section
      on existing_section.section_id = nullif(btrim(item.value ->> 'sectionId'), '')
      and existing_section.library_id <> p_table_id
    where item.value ? 'sectionId'
  ) then
    raise exception 'Section is outside table' using errcode = '23503';
  end if;

  for v_item in select value from jsonb_array_elements(p_fields) loop
    v_field_id := (v_item ->> 'fieldId')::uuid;
    update public.library_field_definitions set order_index = -(v_index + 1) where id = v_field_id and library_id = p_table_id;
    v_index := v_index + 1;
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(p_fields) loop
    v_field_id := (v_item ->> 'fieldId')::uuid;
    v_section := btrim(v_item ->> 'section');
    v_section_id := coalesce(nullif(btrim(v_item ->> 'sectionId'), ''), md5(p_table_id::text || ':' || v_section));
    update public.library_field_definitions
    set section = v_section, section_id = v_section_id, order_index = v_index
    where id = v_field_id and library_id = p_table_id;
    v_index := v_index + 1;
  end loop;

  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_table_id, v_input_count, v_now;
end;
$$;

create or replace function public.mcp_delete_table(
  p_project_id uuid,
  p_table_id uuid,
  p_confirm_name text,
  p_clear_references boolean default false
)
returns table (
  table_id uuid,
  deleted_row_count integer,
  cleared_reference_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_row_ids uuid[];
  v_reference_count integer;
  v_cleared_references integer := 0;
  v_deleted_rows integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> v_table.name then
    raise exception 'confirmName must match table name' using errcode = 'PT409';
  end if;
  select coalesce(array_agg(id), array[]::uuid[]) into v_row_ids
  from public.library_assets where library_id = p_table_id;
  v_deleted_rows := coalesce(array_length(v_row_ids, 1), 0);
  select count(*) into v_reference_count
  from public.library_asset_values as value
  join public.library_field_definitions as field
    on field.id = value.field_id and field.data_type = 'reference'
    and coalesce(field.reference_libraries, array[]::uuid[]) && array[p_table_id]
  join public.library_assets as referencing_asset
    on referencing_asset.id = value.asset_id
  join public.libraries as referencing_table
    on referencing_table.id = referencing_asset.library_id
    and referencing_table.project_id = p_project_id
  where referencing_table.id <> p_table_id
    and exists (
      select 1 from unnest(v_row_ids) as target(asset_id)
      where public.mcp_reference_value_contains_asset(value.value_json, target.asset_id)
    );
  if v_reference_count > 0 and not p_clear_references then
    raise exception 'Table rows are referenced; clearReferences is required' using errcode = 'PT409';
  end if;
  if v_reference_count > 0 then
    v_cleared_references := public.mcp_clear_references_to_assets(
      p_project_id,
      v_row_ids,
      array[p_table_id]
    );
  end if;
  delete from public.libraries where id = p_table_id and project_id = p_project_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_table_id, v_deleted_rows, v_cleared_references, v_now;
end;
$$;

create or replace function public.mcp_bulk_update_table_rows(
  p_project_id uuid,
  p_table_id uuid,
  p_rows jsonb
)
returns table (
  table_id uuid,
  updated_row_count integer,
  row_ids uuid[],
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_item jsonb;
  v_row public.library_assets%rowtype;
  v_existing jsonb;
  v_resolved jsonb;
  v_pair record;
  v_name text;
  v_row_ids uuid[] := array[]::uuid[];
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Rows must contain 1 to 100 updates' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    group by coalesce(item.value ->> 'rowId', '#' || (item.value ->> 'rowIndex'))
    having count(*) > 1
  ) then
    raise exception 'Duplicate row selectors in request' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'values') is distinct from 'object'
      or (v_item ? 'rowId') = (v_item ? 'rowIndex')
      or (v_item ? 'rowIndex' and (
        jsonb_typeof(v_item -> 'rowIndex') <> 'number'
        or (v_item ->> 'rowIndex') !~ '^[0-9]+$'
        or (v_item ->> 'rowIndex')::integer < 1
      )) then
      raise exception 'Invalid row update entry' using errcode = '22023';
    end if;
    if v_item ? 'rowId' then
      select * into v_row from public.library_assets
      where id = (v_item ->> 'rowId')::uuid and library_id = p_table_id for update;
    else
      select * into v_row from public.library_assets
      where library_id = p_table_id
      order by row_index nulls last, id
      offset ((v_item ->> 'rowIndex')::integer - 1) limit 1 for update;
    end if;
    if v_row.id is null then raise exception 'Row not found' using errcode = 'P0002'; end if;
    if v_item ? 'expectedRowId' and (v_item ->> 'expectedRowId')::uuid <> v_row.id then
      raise exception 'Row changed' using errcode = 'PT409';
    end if;
    select coalesce(jsonb_object_agg(field_id::text, value_json), '{}'::jsonb) into v_existing
    from public.library_asset_values where asset_id = v_row.id;
    v_resolved := public.mcp_resolve_values(p_project_id, p_table_id, v_item -> 'values', v_existing, false);
    select coalesce(nullif(v_resolved ->> field.id::text, ''), v_row.name) into v_name
    from public.library_field_definitions as field
    where field.library_id = p_table_id and field.data_type = 'string'
    order by case when lower(field.label) = 'name' then 0 else 1 end, field.order_index, field.id limit 1;
    v_name := coalesce(v_name, v_row.name);
    for v_pair in select key, value from jsonb_each(v_resolved) loop
      insert into public.library_asset_values(asset_id, field_id, value_json)
      values(v_row.id, v_pair.key::uuid, v_pair.value)
      on conflict(asset_id, field_id) do update set value_json = excluded.value_json;
    end loop;
    update public.library_assets set name = v_name, updated_at = v_now, updated_by = v_actor where id = v_row.id;
    v_row_ids := array_append(v_row_ids, v_row.id);
  end loop;

  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_table_id, coalesce(array_length(v_row_ids, 1), 0), v_row_ids, v_now;
end;
$$;

create or replace function public.mcp_upsert_table_rows(
  p_project_id uuid,
  p_table_id uuid,
  p_match_field text,
  p_rows jsonb,
  p_reuse_empty boolean default false
)
returns table (
  table_id uuid,
  upserted_row_count integer,
  created_row_count integer,
  updated_row_count integer,
  row_ids uuid[],
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_match_field public.library_field_definitions%rowtype;
  v_item jsonb;
  v_match_value jsonb;
  v_existing_matches integer;
  v_row public.library_assets%rowtype;
  v_existing jsonb;
  v_resolved jsonb;
  v_pair record;
  v_name text;
  v_row_ids uuid[] := array[]::uuid[];
  v_created integer := 0;
  v_updated integer := 0;
  v_index integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id = p_table_id and project_id = p_project_id for update;
  if not found then raise exception 'Table not found' using errcode = 'P0002'; end if;
  select * into v_match_field
  from public.library_field_definitions as field
  where field.library_id = p_table_id
    and (field.id::text = p_match_field or lower(btrim(field.label)) = lower(btrim(p_match_field)))
  order by case when field.id::text = p_match_field then 0 else 1 end, field.id
  limit 1;
  if v_match_field.id is null then raise exception 'Match field not found' using errcode = '22023'; end if;
  if v_match_field.data_type not in ('string','int','float','boolean','enum','date') then
    raise exception 'Match field type is not supported' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Rows must contain 1 to 100 upserts' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where jsonb_typeof(item.value) is distinct from 'object'
      or jsonb_typeof(item.value -> 'values') is distinct from 'object'
  ) then
    raise exception 'Invalid row upsert entry' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where not ((item.value -> 'values') ? v_match_field.label)
      and not ((item.value -> 'values') ? v_match_field.id::text)
  ) then
    raise exception 'Match field value is required' using errcode = '22023';
  end if;
  if (
    select count(*)
    from (
      select coalesce(
        (item.value -> 'values') -> v_match_field.label,
        (item.value -> 'values') -> v_match_field.id::text
      ) as match_value
      from jsonb_array_elements(p_rows) as item(value)
    ) as requested
  ) <> (
    select count(distinct match_value)
    from (
      select coalesce(
        (item.value -> 'values') -> v_match_field.label,
        (item.value -> 'values') -> v_match_field.id::text
      ) as match_value
      from jsonb_array_elements(p_rows) as item(value)
    ) as requested
  ) then
    raise exception 'Duplicate match values in request' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.library_asset_values as value
    join public.library_assets as asset
      on asset.id = value.asset_id and asset.library_id = p_table_id
    where value.field_id = v_match_field.id
      and not public.mcp_value_is_empty(value.value_json)
    group by value.value_json
    having count(*) > 1
  ) then
    raise exception 'Existing match field values are not unique' using errcode = 'PT409';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'values') is distinct from 'object' then
      raise exception 'Invalid row upsert entry' using errcode = '22023';
    end if;
    if not ((v_item -> 'values') ? v_match_field.label)
      and not ((v_item -> 'values') ? v_match_field.id::text) then
      raise exception 'Match field value is required' using errcode = '22023';
    end if;
    v_match_value := coalesce(
      (v_item -> 'values') -> v_match_field.label,
      (v_item -> 'values') -> v_match_field.id::text
    );
    perform public.mcp_validate_field_value(p_project_id, p_table_id, v_match_field, v_match_value);
    if public.mcp_value_is_empty(v_match_value) then
      raise exception 'Match field value is required' using errcode = '22023';
    end if;
    select count(*) into v_existing_matches
    from public.library_asset_values as value
    join public.library_assets as asset on asset.id = value.asset_id and asset.library_id = p_table_id
    where value.field_id = v_match_field.id and value.value_json = v_match_value;
    if v_existing_matches > 1 then
      raise exception 'Existing match field values are not unique' using errcode = 'PT409';
    end if;
    if v_existing_matches = 1 then
      select asset.* into v_row
      from public.library_asset_values as value
      join public.library_assets as asset on asset.id = value.asset_id and asset.library_id = p_table_id
      where value.field_id = v_match_field.id and value.value_json = v_match_value
      for update;
      v_updated := v_updated + 1;
    else
      if p_reuse_empty then
        select asset.* into v_row
        from public.library_assets as asset
        where asset.library_id = p_table_id
          and not exists (
            select 1 from public.library_asset_values as value
            where value.asset_id = asset.id and not public.mcp_value_is_empty(value.value_json)
          )
        order by asset.row_index nulls last, asset.id limit 1 for update;
      end if;
      if v_row.id is null then
        select coalesce(max(greatest(asset.row_index, 0)), 0) + 1 into v_index
        from public.library_assets as asset where asset.library_id = p_table_id;
        insert into public.library_assets(id, library_id, name, row_index, created_at, updated_at, updated_by)
        values(gen_random_uuid(), p_table_id, 'Untitled', v_index, v_now, v_now, v_actor)
        returning * into v_row;
        v_created := v_created + 1;
      else
        v_updated := v_updated + 1;
      end if;
    end if;

    select coalesce(jsonb_object_agg(field_id::text, value_json), '{}'::jsonb) into v_existing
    from public.library_asset_values where asset_id = v_row.id;
    v_resolved := public.mcp_resolve_values(p_project_id, p_table_id, v_item -> 'values', v_existing, false);
    select coalesce(nullif(v_resolved ->> field.id::text, ''), v_row.name) into v_name
    from public.library_field_definitions as field
    where field.library_id = p_table_id and field.data_type = 'string'
    order by case when lower(field.label) = 'name' then 0 else 1 end, field.order_index, field.id limit 1;
    v_name := coalesce(v_name, v_row.name);
    for v_pair in select key, value from jsonb_each(v_resolved) loop
      insert into public.library_asset_values(asset_id, field_id, value_json)
      values(v_row.id, v_pair.key::uuid, v_pair.value)
      on conflict(asset_id, field_id) do update set value_json = excluded.value_json;
    end loop;
    update public.library_assets set name = v_name, updated_at = v_now, updated_by = v_actor where id = v_row.id;
    v_row_ids := array_append(v_row_ids, v_row.id);
    v_row := null;
  end loop;

  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_table_id, coalesce(array_length(v_row_ids, 1), 0), v_created, v_updated, v_row_ids, v_now;
end;
$$;

revoke all on function public.mcp_reference_value_contains_asset(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.mcp_reference_value_remove_assets(jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.mcp_clear_references_to_assets(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.mcp_field_definition_from_json(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mcp_edit_table_field(uuid, uuid, uuid, jsonb, boolean) from public, anon;
revoke all on function public.mcp_delete_table_field(uuid, uuid, uuid, boolean) from public, anon;
revoke all on function public.mcp_delete_table_row(uuid, uuid, uuid, integer, uuid, boolean) from public, anon;
revoke all on function public.mcp_update_table(uuid, uuid, text, text, uuid, boolean, boolean) from public, anon;
revoke all on function public.mcp_reorder_table_fields(uuid, uuid, jsonb) from public, anon;
revoke all on function public.mcp_delete_table(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.mcp_bulk_update_table_rows(uuid, uuid, jsonb) from public, anon;
revoke all on function public.mcp_upsert_table_rows(uuid, uuid, text, jsonb, boolean) from public, anon;

grant execute on function public.mcp_edit_table_field(uuid, uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.mcp_delete_table_field(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.mcp_delete_table_row(uuid, uuid, uuid, integer, uuid, boolean) to authenticated;
grant execute on function public.mcp_update_table(uuid, uuid, text, text, uuid, boolean, boolean) to authenticated;
grant execute on function public.mcp_reorder_table_fields(uuid, uuid, jsonb) to authenticated;
grant execute on function public.mcp_delete_table(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.mcp_bulk_update_table_rows(uuid, uuid, jsonb) to authenticated;
grant execute on function public.mcp_upsert_table_rows(uuid, uuid, text, jsonb, boolean) to authenticated;
