-- Keep a confirmed Agent field edit bound to the library version it previewed.
-- Existing MCP field RPCs remain unchanged for their callers.

create function public.agent_field_values_snapshot(
  p_project_id uuid, p_table_id uuid, p_field_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_values jsonb;
begin
  perform public.mcp_require_writer(p_project_id);
  if not exists (select 1 from public.library_field_definitions f
    join public.libraries l on l.id = f.library_id
    where f.id = p_field_id and f.library_id = p_table_id and l.project_id = p_project_id) then
    raise exception 'Field not found' using errcode = 'P0002';
  end if;
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'asset_id', value.asset_id, 'value_json', value.value_json
  ) order by value.asset_id), '[]'::jsonb)
  into v_count, v_values
  from public.library_asset_values value where value.field_id = p_field_id;
  return jsonb_build_object('count', v_count, 'fingerprint',
    encode(extensions.digest(convert_to(v_values::text, 'UTF8'), 'sha256'), 'hex'));
end;
$$;

create or replace function public.agent_edit_table_field_if_current(
  p_project_id uuid,
  p_table_id uuid,
  p_field_id uuid,
  p_field jsonb,
  p_clear_values_on_type_change boolean,
  p_expected_updated_at timestamptz,
  p_expected_field jsonb,
  p_expected_value_count bigint,
  p_expected_value_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
  v_field public.library_field_definitions%rowtype;
  v_value_count bigint;
  v_value_snapshot jsonb;
  v_result jsonb;
begin
  perform public.mcp_require_writer(p_project_id);
  select library.updated_at into v_updated_at
  from public.libraries as library
  where library.id = p_table_id and library.project_id = p_project_id
  for update;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or v_updated_at is distinct from p_expected_updated_at then
    raise exception 'Library schema changed after approval' using errcode = 'PT409';
  end if;
  select * into v_field from public.library_field_definitions
  where id = p_field_id and library_id = p_table_id for update;
  if not found then raise exception 'Field changed after approval' using errcode = 'PT409'; end if;
  if p_expected_field is null or p_expected_field is distinct from jsonb_build_object(
    'id', v_field.id, 'library_id', v_field.library_id, 'label', v_field.label,
    'data_type', v_field.data_type, 'description', v_field.description,
    'required', v_field.required, 'enum_options', v_field.enum_options,
    'reference_libraries', v_field.reference_libraries, 'section', v_field.section,
    'section_id', v_field.section_id, 'order_index', v_field.order_index,
    'formula_expression', v_field.formula_expression
  ) then
    raise exception 'Field changed after approval' using errcode = 'PT409';
  end if;
  -- Lock existing cells. The field row lock also fences new cells through their FK.
  perform 1 from public.library_asset_values where field_id = p_field_id for update;
  v_value_snapshot := public.agent_field_values_snapshot(p_project_id, p_table_id, p_field_id);
  v_value_count := (v_value_snapshot ->> 'count')::bigint;
  if p_expected_value_count is null or v_value_count <> p_expected_value_count
    or p_expected_value_fingerprint is null
    or v_value_snapshot ->> 'fingerprint' <> p_expected_value_fingerprint then
    raise exception 'Field values changed after approval' using errcode = 'PT409';
  end if;

  select to_jsonb(edited) into v_result
  from public.mcp_edit_table_field(
    p_project_id, p_table_id, p_field_id, p_field, p_clear_values_on_type_change
  ) as edited;
  return v_result;
end;
$$;

create or replace function public.agent_delete_table_field_if_current(
  p_project_id uuid,
  p_table_id uuid,
  p_field_id uuid,
  p_clear_values boolean,
  p_expected_updated_at timestamptz,
  p_expected_field jsonb,
  p_expected_value_count bigint,
  p_expected_value_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_at timestamptz;
  v_field public.library_field_definitions%rowtype;
  v_value_count bigint;
  v_value_snapshot jsonb;
  v_result jsonb;
begin
  perform public.mcp_require_writer(p_project_id);
  select library.updated_at into v_updated_at
  from public.libraries as library
  where library.id = p_table_id and library.project_id = p_project_id
  for update;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or v_updated_at is distinct from p_expected_updated_at then
    raise exception 'Library schema changed after approval' using errcode = 'PT409';
  end if;
  select * into v_field from public.library_field_definitions
  where id = p_field_id and library_id = p_table_id for update;
  if not found then raise exception 'Field changed after approval' using errcode = 'PT409'; end if;
  if p_expected_field is null or p_expected_field is distinct from jsonb_build_object(
    'id', v_field.id, 'library_id', v_field.library_id, 'label', v_field.label,
    'data_type', v_field.data_type, 'description', v_field.description,
    'required', v_field.required, 'enum_options', v_field.enum_options,
    'reference_libraries', v_field.reference_libraries, 'section', v_field.section,
    'section_id', v_field.section_id, 'order_index', v_field.order_index,
    'formula_expression', v_field.formula_expression
  ) then
    raise exception 'Field changed after approval' using errcode = 'PT409';
  end if;
  perform 1 from public.library_asset_values where field_id = p_field_id for update;
  v_value_snapshot := public.agent_field_values_snapshot(p_project_id, p_table_id, p_field_id);
  v_value_count := (v_value_snapshot ->> 'count')::bigint;
  if p_expected_value_count is null or v_value_count <> p_expected_value_count
    or p_expected_value_fingerprint is null
    or v_value_snapshot ->> 'fingerprint' <> p_expected_value_fingerprint then
    raise exception 'Field values changed after approval' using errcode = 'PT409';
  end if;

  select to_jsonb(deleted) into v_result
  from public.mcp_delete_table_field(
    p_project_id, p_table_id, p_field_id, p_clear_values
  ) as deleted;
  return v_result;
end;
$$;

revoke all on function public.agent_field_values_snapshot(uuid, uuid, uuid) from public, anon;
revoke all on function public.agent_edit_table_field_if_current(uuid, uuid, uuid, jsonb, boolean, timestamptz, jsonb, bigint, text) from public, anon;
revoke all on function public.agent_delete_table_field_if_current(uuid, uuid, uuid, boolean, timestamptz, jsonb, bigint, text) from public, anon;
grant execute on function public.agent_field_values_snapshot(uuid, uuid, uuid) to authenticated;
grant execute on function public.agent_edit_table_field_if_current(uuid, uuid, uuid, jsonb, boolean, timestamptz, jsonb, bigint, text) to authenticated;
grant execute on function public.agent_delete_table_field_if_current(uuid, uuid, uuid, boolean, timestamptz, jsonb, bigint, text) to authenticated;
