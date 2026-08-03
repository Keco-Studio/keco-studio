-- Fix ambiguous field_id references in table-field maintenance RPCs.

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
      delete from public.library_asset_values as value where value.field_id = p_field_id;
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
    formula_expression = null
  where id = p_field_id and library_id = p_table_id
  returning * into v_existing;

  for v_value in
    select value.value_json from public.library_asset_values as value
    where value.field_id = p_field_id and not public.mcp_value_is_empty(value.value_json)
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
  from public.library_asset_values as value
  where value.field_id = p_field_id and not public.mcp_value_is_empty(value.value_json);
  if v_non_empty_count > 0 and not p_clear_values then
    raise exception 'Field has values; clearValues is required' using errcode = 'PT409';
  end if;
  delete from public.library_asset_values as value where value.field_id = p_field_id;
  get diagnostics v_deleted_values = row_count;
  delete from public.library_field_definitions where id = p_field_id and library_id = p_table_id;
  update public.libraries set updated_at = v_now, updated_by = v_actor where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at = v_now where id = v_table.folder_id; end if;
  return query select p_field_id, p_table_id, v_deleted_values, v_now;
end;
$$;

revoke all on function public.mcp_edit_table_field(uuid, uuid, uuid, jsonb, boolean) from public, anon;
revoke all on function public.mcp_delete_table_field(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.mcp_edit_table_field(uuid, uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.mcp_delete_table_field(uuid, uuid, uuid, boolean) to authenticated;
