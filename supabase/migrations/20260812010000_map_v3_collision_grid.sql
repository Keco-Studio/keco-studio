-- Add a hash-bound, editable 8px collision grid to Create Map V3 scenes.

alter function public.map_validate_v3_payload(jsonb, jsonb)
  rename to map_validate_v3_payload_without_collision_grid;

create function public.map_validate_v3_payload(p_plan jsonb, p_scene jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_grid jsonb;
  v_columns integer;
  v_rows integer;
begin
  perform public.map_validate_v3_payload_without_collision_grid(
    p_plan,
    p_scene - 'collisionGrid'
  );

  if not (p_scene ? 'collisionGrid') or p_scene -> 'collisionGrid' = 'null'::jsonb then
    return;
  end if;

  v_grid := p_scene -> 'collisionGrid';
  if jsonb_typeof(v_grid) is distinct from 'object'
    or not (v_grid ?& array['version', 'cellSize', 'columns', 'rows', 'cells', 'imageSha256'])
    or v_grid - array['version', 'cellSize', 'columns', 'rows', 'cells', 'imageSha256'] <> '{}'::jsonb
    or jsonb_typeof(v_grid -> 'version') is distinct from 'number'
    or v_grid ->> 'version' <> '1'
    or jsonb_typeof(v_grid -> 'cellSize') is distinct from 'number'
    or v_grid ->> 'cellSize' <> '8'
    or jsonb_typeof(v_grid -> 'columns') is distinct from 'number'
    or jsonb_typeof(v_grid -> 'rows') is distinct from 'number'
    or jsonb_typeof(v_grid -> 'cells') is distinct from 'array'
    or coalesce(v_grid ->> 'imageSha256', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid V3 collision grid' using errcode = '22023';
  end if;

  if (v_grid ->> 'columns')::numeric <> trunc((v_grid ->> 'columns')::numeric)
    or (v_grid ->> 'rows')::numeric <> trunc((v_grid ->> 'rows')::numeric) then
    raise exception 'invalid V3 collision grid dimensions' using errcode = '22023';
  end if;
  v_columns := (v_grid ->> 'columns')::integer;
  v_rows := (v_grid ->> 'rows')::integer;

  if (v_columns, v_rows) not in ((64, 64), (86, 48), (48, 86))
    or v_columns * 8 <> (p_scene #>> '{size,width}')::integer
    or v_rows * 8 <> (p_scene #>> '{size,height}')::integer
    or jsonb_array_length(v_grid -> 'cells') <> v_columns * v_rows
    or exists (
      select 1
      from jsonb_array_elements(v_grid -> 'cells') as cell(value)
      where jsonb_typeof(cell.value) is distinct from 'number'
        or cell.value not in ('0'::jsonb, '1'::jsonb)
    ) then
    raise exception 'invalid V3 collision grid cells' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.map_validate_v3_payload_without_collision_grid(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.map_validate_v3_payload(jsonb, jsonb)
  from public, anon, authenticated;

-- Invalidate cached PL/pgSQL call plans so every existing pooled connection
-- resolves the validator's new OID after the rename-and-replace migration.
alter function public.create_map_project_v3(uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb)
  set search_path = '';
alter function public.save_map_draft_v3(uuid, uuid, bigint, jsonb, jsonb)
  set search_path = '';
alter function public.publish_map_revision_v3(uuid, uuid, bigint)
  set search_path = '';
alter function public.create_map_asset_plan_v3(uuid, uuid, text)
  set search_path = '';

notify pgrst, 'reload schema';
