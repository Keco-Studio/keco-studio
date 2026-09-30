-- Snapshot the exact contents approved for Agent asset and library deletion.

create function public.agent_asset_delete_fingerprint(p_asset_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'asset', to_jsonb(asset),
    'values', coalesce((select jsonb_agg(to_jsonb(value) order by value.field_id)
      from public.library_asset_values value where value.asset_id = asset.id), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.library_assets asset where asset.id = p_asset_id;
$$;

create function public.agent_library_delete_fingerprint(p_library_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'library', to_jsonb(library),
    'fields', coalesce((select jsonb_agg(to_jsonb(field) order by field.id)
      from public.library_field_definitions field where field.library_id = library.id), '[]'::jsonb),
    'fieldValues', coalesce((select jsonb_agg(to_jsonb(value) order by value.asset_id, value.field_id)
      from public.library_asset_values value
      join public.library_field_definitions field on field.id = value.field_id
      where field.library_id = library.id), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', asset.id, 'fingerprint', public.agent_asset_delete_fingerprint(asset.id)
    ) order by asset.id) from public.library_assets asset
      where asset.library_id = library.id), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.libraries library where library.id = p_library_id;
$$;

create function public.agent_prepare_asset_delete(p_project_id uuid, p_library_id uuid, p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype; v_asset public.library_assets%rowtype;
begin
  perform public.mcp_require_writer(p_project_id);
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  select * into v_asset from public.library_assets
    where id = p_asset_id and library_id = p_library_id;
  if not found then raise exception 'Asset not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('projectId', p_project_id, 'libraryId', p_library_id,
    'libraryName', v_library.name, 'assetId', p_asset_id, 'name', v_asset.name,
    'updatedAt', v_asset.updated_at,
    'fingerprint', public.agent_asset_delete_fingerprint(p_asset_id));
end;
$$;

create function public.agent_delete_asset_if_current(
  p_project_id uuid, p_library_id uuid, p_asset_id uuid, p_expected_library_name text, p_expected_name text,
  p_expected_updated_at timestamptz, p_expected_fingerprint text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype; v_asset public.library_assets%rowtype;
begin
  perform public.mcp_require_writer(p_project_id);
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id for update;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  select * into v_asset from public.library_assets
    where id = p_asset_id and library_id = p_library_id for update;
  if not found then raise exception 'Asset changed after approval' using errcode = 'PT409'; end if;
  perform 1 from public.library_asset_values where asset_id = p_asset_id for update;
  if p_expected_library_name is null or p_expected_name is null or p_expected_updated_at is null or p_expected_fingerprint is null
    or v_library.name is distinct from p_expected_library_name
    or v_asset.name is distinct from p_expected_name
    or v_asset.updated_at is distinct from p_expected_updated_at
    or public.agent_asset_delete_fingerprint(p_asset_id) is distinct from p_expected_fingerprint then
    raise exception 'Asset changed after approval' using errcode = 'PT409';
  end if;
  delete from public.library_assets where id = p_asset_id and library_id = p_library_id;
  update public.libraries set updated_at = clock_timestamp() where id = p_library_id;
  return p_asset_id;
end;
$$;

create function public.agent_prepare_library_delete(p_project_id uuid, p_library_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype;
begin
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'Only project admins can delete libraries' using errcode = '42501';
  end if;
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id;
  if not found then raise exception 'Library not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('projectId', p_project_id, 'libraryId', p_library_id,
    'name', v_library.name, 'updatedAt', v_library.updated_at,
    'fingerprint', public.agent_library_delete_fingerprint(p_library_id));
end;
$$;

create function public.agent_delete_library_if_current(
  p_project_id uuid, p_library_id uuid, p_expected_name text,
  p_expected_updated_at timestamptz, p_expected_fingerprint text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_library public.libraries%rowtype;
begin
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'Only project admins can delete libraries' using errcode = '42501';
  end if;
  select * into v_library from public.libraries
    where id = p_library_id and project_id = p_project_id for update;
  if not found then raise exception 'Library changed after approval' using errcode = 'PT409'; end if;
  perform 1 from public.library_field_definitions where library_id = p_library_id for update;
  perform 1 from public.library_assets where library_id = p_library_id for update;
  perform 1 from public.library_asset_values value
    join public.library_assets asset on asset.id = value.asset_id
    where asset.library_id = p_library_id for update of value;
  perform 1 from public.library_asset_values value
    join public.library_field_definitions field on field.id = value.field_id
    where field.library_id = p_library_id for update of value;
  if p_expected_name is null or p_expected_updated_at is null or p_expected_fingerprint is null
    or v_library.name is distinct from p_expected_name
    or v_library.updated_at is distinct from p_expected_updated_at
    or public.agent_library_delete_fingerprint(p_library_id) is distinct from p_expected_fingerprint then
    raise exception 'Library changed after approval' using errcode = 'PT409';
  end if;
  delete from public.libraries where id = p_library_id and project_id = p_project_id;
  return p_library_id;
end;
$$;

revoke all on function public.agent_asset_delete_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.agent_library_delete_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.agent_prepare_asset_delete(uuid, uuid, uuid) from public, anon;
revoke all on function public.agent_delete_asset_if_current(uuid, uuid, uuid, text, text, timestamptz, text) from public, anon;
revoke all on function public.agent_prepare_library_delete(uuid, uuid) from public, anon;
revoke all on function public.agent_delete_library_if_current(uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.agent_prepare_asset_delete(uuid, uuid, uuid) to authenticated;
grant execute on function public.agent_delete_asset_if_current(uuid, uuid, uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.agent_prepare_library_delete(uuid, uuid) to authenticated;
grant execute on function public.agent_delete_library_if_current(uuid, uuid, text, timestamptz, text) to authenticated;
