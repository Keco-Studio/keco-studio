-- Apply approved Studio structure changes while holding the target row lock.
create function public.agent_change_studio_structure_if_current(
  p_project_id uuid, p_action text, p_target_id uuid, p_expected_updated_at timestamptz,
  p_destination_id uuid default null, p_name text default null, p_description text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_folder public.folders%rowtype;
  v_library public.libraries%rowtype;
  v_name text;
  v_now timestamptz;
begin
  if auth.uid() is null or not coalesce(public.is_project_owner_or_admin(p_project_id, auth.uid()), false) then
    raise exception 'Only project admins can change Studio structure' using errcode = '42501';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Approval timestamp is required' using errcode = '22023';
  end if;
  if p_action in ('update_folder', 'move_folder') then
    lock table public.folders in share row exclusive mode;
    select * into v_folder from public.folders
      where id = p_target_id and project_id = p_project_id for update;
    if not found or v_folder.updated_at is distinct from p_expected_updated_at then
      raise exception 'Folder changed after approval' using errcode = 'PT409';
    end if;
    if p_action = 'update_folder' then
      v_name := btrim(p_name);
      if v_name is null or length(v_name) not between 1 and 200 then
        raise exception 'Invalid folder name' using errcode = '22023';
      end if;
      if length(p_description) > 1000 then
        raise exception 'Invalid folder description' using errcode = '22023';
      end if;
      if exists (select 1 from public.folders other where other.project_id = p_project_id
        and other.id <> p_target_id and other.parent_folder_id is not distinct from v_folder.parent_folder_id
        and other.name = v_name) then
        raise exception 'Folder name already exists in this location' using errcode = '23505';
      end if;
      if v_folder.name = v_name and v_folder.description is not distinct from nullif(btrim(p_description), '') then
        return jsonb_build_object('id', v_folder.id, 'name', v_folder.name, 'updatedAt', v_folder.updated_at);
      end if;
      update public.folders set name = v_name, description = nullif(btrim(p_description), ''),
        updated_at = clock_timestamp() where id = p_target_id returning * into v_folder;
    else
      if p_destination_id = p_target_id then
        raise exception 'A folder cannot be its own parent' using errcode = '22023';
      end if;
      if p_destination_id is not null then
        perform 1 from public.folders where id = p_destination_id and project_id = p_project_id for update;
        if not found then raise exception 'Destination folder not found' using errcode = 'P0002'; end if;
        if exists (with recursive descendants(id) as (
          select p_target_id union
          select child.id from public.folders child join descendants on child.parent_folder_id = descendants.id
        ) select 1 from descendants where id = p_destination_id) then
          raise exception 'A folder cannot move into its descendant' using errcode = '22023';
        end if;
      end if;
      if exists (select 1 from public.folders other where other.project_id = p_project_id
        and other.id <> p_target_id and other.parent_folder_id is not distinct from p_destination_id
        and other.name = v_folder.name) then
        raise exception 'Folder name already exists in the destination' using errcode = '23505';
      end if;
      if v_folder.parent_folder_id is not distinct from p_destination_id then
        return jsonb_build_object('id', v_folder.id, 'name', v_folder.name, 'updatedAt', v_folder.updated_at);
      end if;
      update public.folders set parent_folder_id = p_destination_id,
        updated_at = clock_timestamp() where id = p_target_id returning * into v_folder;
    end if;
    return jsonb_build_object('id', v_folder.id, 'name', v_folder.name, 'updatedAt', v_folder.updated_at);
  elsif p_action in ('update_library_metadata', 'move_library') then
    select * into v_library from public.libraries
      where id = p_target_id and project_id = p_project_id for update;
    if not found or v_library.updated_at is distinct from p_expected_updated_at then
      raise exception 'Library changed after approval' using errcode = 'PT409';
    end if;
    if p_action = 'update_library_metadata' then
      v_name := btrim(p_name);
      if v_name is null or length(v_name) not between 1 and 200 then
        raise exception 'Invalid library name' using errcode = '22023';
      end if;
      if length(p_description) > 1000 then
        raise exception 'Invalid library description' using errcode = '22023';
      end if;
      if exists (select 1 from public.libraries other where other.project_id = p_project_id
        and other.id <> p_target_id and other.folder_id is not distinct from v_library.folder_id
        and other.name = v_name) then
        raise exception 'Library name already exists in this location' using errcode = '23505';
      end if;
      if v_library.name = v_name and v_library.description is not distinct from nullif(btrim(p_description), '') then
        return jsonb_build_object('id', v_library.id, 'name', v_library.name, 'updatedAt', v_library.updated_at);
      end if;
      update public.libraries set name = v_name, description = nullif(btrim(p_description), ''),
        updated_at = clock_timestamp() where id = p_target_id returning * into v_library;
    else
      if v_library.source_document_id is not null then
        raise exception 'Libraries generated from a document move with their source document' using errcode = '22023';
      end if;
      if p_destination_id is not null then
        perform 1 from public.folders where id = p_destination_id and project_id = p_project_id for update;
        if not found then raise exception 'Destination folder not found' using errcode = 'P0002'; end if;
      end if;
      if exists (select 1 from public.libraries other where other.project_id = p_project_id
        and other.id <> p_target_id and other.folder_id is not distinct from p_destination_id
        and other.name = v_library.name) then
        raise exception 'Library name already exists in the destination' using errcode = '23505';
      end if;
      if v_library.folder_id is not distinct from p_destination_id then
        return jsonb_build_object('id', v_library.id, 'name', v_library.name, 'updatedAt', v_library.updated_at);
      end if;
      update public.libraries set folder_id = p_destination_id,
        updated_at = clock_timestamp() where id = p_target_id returning * into v_library;
    end if;
    update public.projects set updated_at = clock_timestamp() where id = p_project_id;
    return jsonb_build_object('id', v_library.id, 'name', v_library.name, 'updatedAt', v_library.updated_at);
  end if;
  raise exception 'Unsupported Studio structure action' using errcode = '22023';
end;
$$;

-- A fingerprint of every field column catches section, type, and order edits.
create function public.agent_library_fields_fingerprint(p_library_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce((
    select jsonb_agg(to_jsonb(field) order by field.id)
    from public.library_field_definitions field where field.library_id = p_library_id
  ), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function public.agent_prepare_library_reorder(p_project_id uuid, p_library_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype; v_fields jsonb;
begin
  perform public.mcp_require_writer(p_project_id);
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id for share;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  lock table public.library_field_definitions in share mode;
  select coalesce(jsonb_agg(jsonb_build_object('fieldId', id, 'section', section,
    'sectionId', section_id) order by order_index, id), '[]'::jsonb)
    into v_fields from public.library_field_definitions where library_id = p_library_id;
  return jsonb_build_object('name', v_library.name, 'updatedAt', v_library.updated_at,
    'fingerprint', public.agent_library_fields_fingerprint(p_library_id), 'fields', v_fields);
end;
$$;

create function public.agent_reorder_library_fields_if_current(
  p_project_id uuid, p_library_id uuid, p_fields jsonb,
  p_expected_updated_at timestamptz, p_expected_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype; v_result record;
begin
  perform public.mcp_require_writer(p_project_id);
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id for update;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  lock table public.library_field_definitions in share row exclusive mode;
  if p_expected_updated_at is null or p_expected_fingerprint is null
    or v_library.updated_at is distinct from p_expected_updated_at
    or public.agent_library_fields_fingerprint(p_library_id) is distinct from p_expected_fingerprint then
    raise exception 'Library fields changed after approval' using errcode = 'PT409';
  end if;
  select * into v_result from public.mcp_reorder_table_fields(p_project_id, p_library_id, p_fields);
  return jsonb_build_object('updatedAt', v_result.updated_at, 'reorderedCount', v_result.reordered_count);
end;
$$;

revoke all on function public.agent_change_studio_structure_if_current(uuid, text, uuid, timestamptz, uuid, text, text) from public, anon;
revoke all on function public.agent_library_fields_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.agent_prepare_library_reorder(uuid, uuid) from public, anon;
revoke all on function public.agent_reorder_library_fields_if_current(uuid, uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.agent_change_studio_structure_if_current(uuid, text, uuid, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.agent_prepare_library_reorder(uuid, uuid) to authenticated;
grant execute on function public.agent_reorder_library_fields_if_current(uuid, uuid, jsonb, timestamptz, text) to authenticated;
