-- Atomically pin one Script character's dialogue rows to the selected side.

create or replace function public.set_script_dialogue_speaker_side(
  p_library_id uuid,
  p_speaker text,
  p_speech_type text,
  p_type_field_id uuid,
  p_name_field_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_folder_id uuid;
  v_changed_ids uuid[] := '{}'::uuid[];
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
      and field_definition.id in (p_type_field_id, p_name_field_id)
  ) <> 2 then
    raise exception 'Script dialogue fields do not belong to library %', p_library_id
      using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_library_id::text, 0));
  perform 1
  from public.library_assets as asset
  where asset.library_id = p_library_id
  for update;

  with changed as (
    update public.library_asset_values as type_value
    set value_json = to_jsonb(p_speech_type)
    from public.library_assets as asset,
      public.library_asset_values as name_value
    where asset.library_id = p_library_id
      and type_value.asset_id = asset.id
      and type_value.field_id = p_type_field_id
      and type_value.value_json #>> '{}' in ('1', '2')
      and type_value.value_json #>> '{}' <> p_speech_type
      and name_value.asset_id = asset.id
      and name_value.field_id = p_name_field_id
      and btrim(name_value.value_json #>> '{}') = btrim(p_speaker)
    returning type_value.asset_id
  )
  select coalesce(array_agg(changed.asset_id order by changed.asset_id), '{}'::uuid[])
    into v_changed_ids
  from changed;

  if cardinality(v_changed_ids) > 0 then
    update public.library_assets
      set updated_at = v_now, updated_by = v_user_id
    where id = any(v_changed_ids)
      and library_id = p_library_id;
    update public.libraries set updated_at = v_now where id = p_library_id;
    update public.projects set updated_at = v_now where id = v_project_id;
    if v_folder_id is not null then
      update public.folders set updated_at = v_now where id = v_folder_id;
    end if;
  end if;

  return v_changed_ids;
end;
$$;

revoke all on function public.set_script_dialogue_speaker_side(
  uuid, text, text, uuid, uuid
) from public, anon;
grant execute on function public.set_script_dialogue_speaker_side(
  uuid, text, text, uuid, uuid
) to authenticated, service_role;

comment on function public.set_script_dialogue_speaker_side(
  uuid, text, text, uuid, uuid
) is 'Atomically sets every dialogue row for one speaker to Script side Type 1 or 2.';
