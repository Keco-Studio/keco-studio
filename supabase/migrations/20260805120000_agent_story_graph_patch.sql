create or replace function public.apply_story_graph_patch(
  p_library_id uuid,
  p_expected_snapshot jsonb,
  p_new_fields jsonb,
  p_asset_inserts jsonb,
  p_asset_updates jsonb,
  p_plot_plan jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_library public.libraries%rowtype;
  v_expected_fields jsonb;
  v_expected_assets jsonb;
  v_current_fields jsonb;
  v_current_assets jsonb;
  v_item jsonb;
  v_asset_id uuid;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object'
    or p_new_fields is null or jsonb_typeof(p_new_fields) <> 'array'
    or p_asset_inserts is null or jsonb_typeof(p_asset_inserts) <> 'array'
    or p_asset_updates is null or jsonb_typeof(p_asset_updates) <> 'array'
    or p_plot_plan is null or jsonb_typeof(p_plot_plan) <> 'object' then
    raise exception 'Invalid story graph patch payload' using errcode = '22023';
  end if;

  select l.* into v_library
  from public.libraries l
  where l.id = p_library_id
  for update;

  if v_library.id is null or v_library.document_export_type is distinct from 'script' then
    raise exception 'Story Script library not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_project_owner(v_library.project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_library.project_id, v_user_id)
  ) then
    raise exception 'Forbidden: missing editor access' using errcode = '42501';
  end if;

  perform 1
  from public.library_assets la
  where la.library_id = p_library_id
  for update;

  v_expected_fields := coalesce(p_expected_snapshot -> 'fields', '[]'::jsonb);
  v_expected_assets := coalesce(p_expected_snapshot -> 'assets', '[]'::jsonb);
  if jsonb_typeof(v_expected_fields) <> 'array'
    or jsonb_typeof(v_expected_assets) <> 'array' then
    raise exception 'Invalid expected snapshot' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id::text,
      'label', f.label,
      'orderIndex', f.order_index
    ) order by f.order_index, f.id
  ), '[]'::jsonb)
  into v_current_fields
  from public.library_field_definitions f
  where f.library_id = p_library_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id::text,
      'rowIndex', a.row_index,
      'updatedAt', to_jsonb(a.updated_at) #>> '{}'
    ) order by a.row_index, a.created_at, a.id
  ), '[]'::jsonb)
  into v_current_assets
  from public.library_assets a
  where a.library_id = p_library_id;

  if v_library.updated_at is distinct from
      nullif(p_expected_snapshot ->> 'libraryUpdatedAt', '')::timestamptz
    or v_library.plot_plan is distinct from p_expected_snapshot -> 'plotPlan'
    or v_current_fields is distinct from v_expected_fields
    or v_current_assets is distinct from v_expected_assets then
    raise exception 'STORY_GRAPH_CONFLICT: Script changed after preview'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_new_fields) as requested(field)
    where requested.field ->> 'label' !~ '^Option[0-9](_Next|_Commands)?$'
      or coalesce((requested.field ->> 'orderIndex')::int, -1) < 0
  ) then
    raise exception 'Invalid new Script option field' using errcode = '22023';
  end if;

  insert into public.library_field_definitions (
    id, library_id, section, section_id, label, data_type, required, order_index
  )
  select
    (requested.field ->> 'id')::uuid,
    p_library_id,
    '__keco_flat_fields__',
    p_library_id::text || ':keco-flat-fields',
    requested.field ->> 'label',
    'string',
    false,
    (requested.field ->> 'orderIndex')::int
  from jsonb_array_elements(p_new_fields) as requested(field);

  if exists (
    select 1
    from jsonb_array_elements(p_asset_updates) as requested(asset)
    left join public.library_assets existing
      on existing.id = (requested.asset ->> 'id')::uuid
      and existing.library_id = p_library_id
    where existing.id is null
  ) then
    raise exception 'Patch row does not belong to Script library' using errcode = '23503';
  end if;

  for v_item in select value from jsonb_array_elements(p_asset_inserts)
  loop
    v_asset_id := (v_item ->> 'id')::uuid;
    insert into public.library_assets (
      id, library_id, name, row_index, created_at, updated_at
    ) values (
      v_asset_id,
      p_library_id,
      v_item ->> 'name',
      (v_item ->> 'rowIndex')::int,
      v_now,
      v_now
    );
    if exists (
      select 1 from jsonb_each(coalesce(v_item -> 'values', '{}'::jsonb)) as value_entry
      left join public.library_field_definitions f
        on f.id = value_entry.key::uuid and f.library_id = p_library_id
      where f.id is null
    ) then
      raise exception 'Patch value field does not belong to Script library' using errcode = '23503';
    end if;
    insert into public.library_asset_values (asset_id, field_id, value_json)
    select v_asset_id, value_entry.key::uuid, value_entry.value
    from jsonb_each(coalesce(v_item -> 'values', '{}'::jsonb)) as value_entry;
  end loop;

  for v_item in select value from jsonb_array_elements(p_asset_updates)
  loop
    v_asset_id := (v_item ->> 'id')::uuid;
    update public.library_assets
    set name = v_item ->> 'name',
        row_index = (v_item ->> 'rowIndex')::int,
        updated_at = v_now
    where id = v_asset_id and library_id = p_library_id;
    if exists (
      select 1 from jsonb_each(coalesce(v_item -> 'values', '{}'::jsonb)) as value_entry
      left join public.library_field_definitions f
        on f.id = value_entry.key::uuid and f.library_id = p_library_id
      where f.id is null
    ) then
      raise exception 'Patch value field does not belong to Script library' using errcode = '23503';
    end if;
    insert into public.library_asset_values (asset_id, field_id, value_json)
    select v_asset_id, value_entry.key::uuid, value_entry.value
    from jsonb_each(coalesce(v_item -> 'values', '{}'::jsonb)) as value_entry
    on conflict (asset_id, field_id)
    do update set value_json = excluded.value_json;
  end loop;

  update public.libraries
  set plot_plan = p_plot_plan,
      updated_at = v_now
  where id = p_library_id;

  update public.projects set updated_at = v_now where id = v_library.project_id;
  if v_library.folder_id is not null then
    update public.folders set updated_at = v_now where id = v_library.folder_id;
  end if;

  return jsonb_build_object(
    'libraryId', p_library_id::text,
    'updatedAt', to_jsonb(v_now) #>> '{}'
  );
end;
$$;

revoke all on function public.apply_story_graph_patch(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) from public;
grant execute on function public.apply_story_graph_patch(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;

comment on function public.apply_story_graph_patch(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) is 'Atomically applies a confirmed Agent story graph patch to one Script library.';
