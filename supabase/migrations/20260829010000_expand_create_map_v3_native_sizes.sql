-- Expand Create Map V3 to the curated PixelLab-native output profiles.

create or replace function public.map_validate_v3_payload(p_plan jsonb, p_scene jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_grid jsonb;
  v_columns integer;
  v_rows integer;
  v_validation_plan jsonb;
  v_validation_scene jsonb;
begin
  if (
    coalesce(p_plan #>> '{map,width}', ''),
    coalesce(p_plan #>> '{map,height}', '')
  ) not in (
    ('256', '256'), ('384', '384'), ('512', '512'),
    ('512', '288'), ('512', '320'), ('512', '384'), ('576', '384'),
    ('624', '416'), ('640', '320'), ('688', '384'),
    ('288', '512'), ('320', '512'), ('384', '512'), ('384', '576'),
    ('416', '624'), ('320', '640'), ('384', '688')
  ) then
    raise exception 'unsupported V3 map dimensions' using errcode = '22023';
  end if;

  if p_scene #>> '{size,width}' is distinct from p_plan #>> '{map,width}'
    or p_scene #>> '{size,height}' is distinct from p_plan #>> '{map,height}' then
    raise exception 'V3 scene dimensions must match the plan' using errcode = '22023';
  end if;
  if jsonb_typeof(p_scene -> 'mapImage') = 'object'
    and (
      p_scene #>> '{mapImage,width}' is distinct from p_plan #>> '{map,width}'
      or p_scene #>> '{mapImage,height}' is distinct from p_plan #>> '{map,height}'
    ) then
    raise exception 'invalid V3 map image binding' using errcode = '22023';
  end if;

  -- The retained base validator owns every non-size V3 rule. Normalize only
  -- its legacy three-profile fields, then validate original dimensions above.
  v_validation_plan := jsonb_set(
    jsonb_set(p_plan, '{map,width}', '512'::jsonb, false),
    '{map,height}', '512'::jsonb, false
  );
  v_validation_scene := p_scene - 'collisionGrid';
  v_validation_scene := jsonb_set(
    jsonb_set(v_validation_scene, '{size,width}', '512'::jsonb, false),
    '{size,height}', '512'::jsonb, false
  );
  if jsonb_typeof(v_validation_scene -> 'mapImage') = 'object' then
    v_validation_scene := jsonb_set(
      jsonb_set(v_validation_scene, '{mapImage,width}', '512'::jsonb, false),
      '{mapImage,height}', '512'::jsonb, false
    );
  end if;

  perform public.map_validate_v3_payload_without_collision_grid(
    v_validation_plan,
    v_validation_scene
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

  if v_columns <= 0
    or v_rows <= 0
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

revoke all on function public.map_validate_v3_payload(jsonb, jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
