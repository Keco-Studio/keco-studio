-- Collapse Script dialogue add/delete request waterfalls into one transaction.

create or replace function public.insert_script_dialogue_block(
  p_library_id uuid,
  p_after_row_id uuid,
  p_speaker text,
  p_speech_type text,
  p_type_field_id uuid,
  p_name_field_id uuid,
  p_content_field_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_folder_id uuid;
  v_action_id uuid := gen_random_uuid();
  v_speech_id uuid := gen_random_uuid();
  v_action_row_index integer;
  v_row_count integer;
  v_distinct_index_count integer;
  v_min_index integer;
  v_max_index integer;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized: auth.uid() is null' using errcode = '42501';
  end if;
  if nullif(btrim(p_speaker), '') is null then
    raise exception 'Speaker is required' using errcode = '22023';
  end if;
  if p_speech_type not in ('1', '2') then
    raise exception 'Speech type must be 1 or 2' using errcode = '22023';
  end if;

  select library.project_id, library.folder_id
    into v_project_id, v_folder_id
  from public.libraries as library
  where library.id = p_library_id;

  if v_project_id is null then
    raise exception 'Library % was not found', p_library_id using errcode = 'P0002';
  end if;
  if not (
    public.is_project_owner(v_project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_project_id, v_user_id)
  ) then
    raise exception 'Forbidden: missing editor access to library %', p_library_id
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.library_field_definitions as field_definition
    where field_definition.library_id = p_library_id
      and field_definition.id in (p_type_field_id, p_name_field_id, p_content_field_id)
  ) <> 3 then
    raise exception 'Script dialogue fields do not belong to library %', p_library_id
      using errcode = '23503';
  end if;

  -- Serialize index allocation for one library, including initially empty libraries.
  perform pg_advisory_xact_lock(hashtextextended(p_library_id::text, 0));
  perform 1
  from public.library_assets as asset
  where asset.library_id = p_library_id
  for update;

  select
    count(*),
    count(distinct asset.row_index),
    min(asset.row_index),
    max(asset.row_index)
    into v_row_count, v_distinct_index_count, v_min_index, v_max_index
  from public.library_assets as asset
  where asset.library_id = p_library_id;

  if v_row_count > 0 and (
    v_distinct_index_count <> v_row_count
    or v_min_index <> 1
    or v_max_index <> v_row_count
  ) then
    with normalized as (
      select
        asset.id,
        row_number() over (
          order by asset.row_index asc nulls last, asset.created_at asc, asset.id asc
        )::integer as row_index
      from public.library_assets as asset
      where asset.library_id = p_library_id
    )
    update public.library_assets as asset
    set row_index = normalized.row_index
    from normalized
    where asset.id = normalized.id
      and asset.row_index is distinct from normalized.row_index;
  end if;

  if p_after_row_id is null then
    select coalesce(max(asset.row_index), 0) + 1
      into v_action_row_index
    from public.library_assets as asset
    where asset.library_id = p_library_id;
  else
    select asset.row_index + 1
      into v_action_row_index
    from public.library_assets as asset
    where asset.id = p_after_row_id
      and asset.library_id = p_library_id;

    if v_action_row_index is null then
      raise exception 'Insert anchor % was not found in library %', p_after_row_id, p_library_id
        using errcode = 'P0002';
    end if;

    update public.library_assets as asset
    set row_index = asset.row_index + 2
    where asset.library_id = p_library_id
      and asset.row_index >= v_action_row_index;
  end if;

  insert into public.library_assets (id, library_id, name, row_index)
  values
    (v_action_id, p_library_id, btrim(p_speaker), v_action_row_index),
    (v_speech_id, p_library_id, btrim(p_speaker), v_action_row_index + 1);

  insert into public.library_asset_values (asset_id, field_id, value_json)
  values
    (v_action_id, p_type_field_id, to_jsonb('3'::text)),
    (v_action_id, p_name_field_id, to_jsonb(btrim(p_speaker))),
    (v_speech_id, p_type_field_id, to_jsonb(p_speech_type)),
    (v_speech_id, p_name_field_id, to_jsonb(btrim(p_speaker)));

  update public.libraries set updated_at = v_now where id = p_library_id;
  update public.projects set updated_at = v_now where id = v_project_id;
  if v_folder_id is not null then
    update public.folders set updated_at = v_now where id = v_folder_id;
  end if;

  return jsonb_build_object(
    'action_row', jsonb_build_object(
      'id', v_action_id,
      'library_id', p_library_id,
      'name', btrim(p_speaker),
      'row_index', v_action_row_index,
      'property_values', jsonb_build_object(
        p_type_field_id::text, '3',
        p_name_field_id::text, btrim(p_speaker)
      )
    ),
    'speech_row', jsonb_build_object(
      'id', v_speech_id,
      'library_id', p_library_id,
      'name', btrim(p_speaker),
      'row_index', v_action_row_index + 1,
      'property_values', jsonb_build_object(
        p_type_field_id::text, p_speech_type,
        p_name_field_id::text, btrim(p_speaker)
      )
    ),
    'action_row_index', v_action_row_index
  );
end;
$$;

create or replace function public.delete_script_dialogue_block(
  p_library_id uuid,
  p_action_row_id uuid default null,
  p_speech_row_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_folder_id uuid;
  v_requested_ids uuid[];
  v_deleted_ids uuid[];
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized: auth.uid() is null' using errcode = '42501';
  end if;

  v_requested_ids := array_remove(array[p_action_row_id, p_speech_row_id], null);
  if coalesce(array_length(v_requested_ids, 1), 0) = 0 then
    raise exception 'At least one dialogue row is required' using errcode = '22023';
  end if;

  select library.project_id, library.folder_id
    into v_project_id, v_folder_id
  from public.libraries as library
  where library.id = p_library_id;

  if v_project_id is null then
    raise exception 'Library % was not found', p_library_id using errcode = 'P0002';
  end if;
  if not (
    public.is_project_owner(v_project_id, v_user_id)
    or public.is_editor_or_admin_collaborator(v_project_id, v_user_id)
  ) then
    raise exception 'Forbidden: missing editor access to library %', p_library_id
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_library_id::text, 0));
  if (
    select count(*)
    from public.library_assets as asset
    where asset.library_id = p_library_id
      and asset.id = any(v_requested_ids)
  ) <> cardinality(v_requested_ids) then
    raise exception 'One or more dialogue rows do not belong to library %', p_library_id
      using errcode = '23503';
  end if;

  with deleted as (
    delete from public.library_assets as asset
    where asset.library_id = p_library_id
      and asset.id = any(v_requested_ids)
    returning asset.id
  )
  select array_agg(deleted.id order by deleted.id)
    into v_deleted_ids
  from deleted;

  update public.libraries set updated_at = v_now where id = p_library_id;
  update public.projects set updated_at = v_now where id = v_project_id;
  if v_folder_id is not null then
    update public.folders set updated_at = v_now where id = v_folder_id;
  end if;

  return jsonb_build_object('deleted_ids', to_jsonb(coalesce(v_deleted_ids, '{}'::uuid[])));
end;
$$;

revoke all on function public.insert_script_dialogue_block(
  uuid, uuid, text, text, uuid, uuid, uuid
) from public, anon;
revoke all on function public.delete_script_dialogue_block(uuid, uuid, uuid)
  from public, anon;

grant execute on function public.insert_script_dialogue_block(
  uuid, uuid, text, text, uuid, uuid, uuid
) to authenticated, service_role;
grant execute on function public.delete_script_dialogue_block(uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.insert_script_dialogue_block(
  uuid, uuid, text, text, uuid, uuid, uuid
) is 'Atomically inserts one Script action/speech dialogue block.';
comment on function public.delete_script_dialogue_block(uuid, uuid, uuid)
  is 'Atomically deletes one Script dialogue block.';
