-- Keep Agent folder/library copies atomic and replayable even when a response is lost.
create table public.agent_studio_copy_receipts (
  idempotency_key uuid primary key,
  actor_user_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('folder', 'library')),
  request_hash text not null,
  output_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.agent_studio_copy_receipts enable row level security;
revoke all on public.agent_studio_copy_receipts from public, anon, authenticated;

create function public.agent_prepare_library_copy(p_project_id uuid, p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_library public.libraries%rowtype;
begin
  perform public.mcp_require_writer(p_project_id);
  select * into v_library from public.libraries
    where id = p_source_id and project_id = p_project_id;
  if not found or v_library.source_document_id is not null then
    raise exception 'Independent library not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('fingerprint', public.agent_library_delete_fingerprint(p_source_id));
end;
$$;

create function private.agent_folder_copy_fingerprint(p_folder_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'folder', to_jsonb(folder),
    'libraries', coalesce((select jsonb_agg(jsonb_build_object(
      'id', library.id, 'fingerprint', public.agent_library_delete_fingerprint(library.id)
    ) order by library.id) from public.libraries library
      where library.folder_id = folder.id and library.source_document_id is null), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(document) order by document.id)
      from public.documents document where document.folder_id = folder.id), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.folders folder where folder.id = p_folder_id;
$$;

create function public.agent_prepare_folder_copy(p_project_id uuid, p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_folder public.folders%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_project_owner_or_admin(p_project_id, auth.uid()), false) then
    raise exception 'Only project admins can duplicate folders' using errcode = '42501';
  end if;
  select * into v_folder from public.folders
    where id = p_source_id and project_id = p_project_id;
  if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('projectId', p_project_id, 'folderId', v_folder.id,
    'name', v_folder.name, 'fingerprint', private.agent_folder_copy_fingerprint(v_folder.id));
end;
$$;

create function private.agent_setup_copy_maps()
returns void language plpgsql security definer set search_path = '' as $$
begin
  drop table if exists pg_temp.agent_copy_field_map;
  drop table if exists pg_temp.agent_copy_asset_map;
  create temporary table agent_copy_field_map (
    old_id uuid primary key, new_id uuid not null unique, new_order integer not null
  ) on commit drop;
  create temporary table agent_copy_asset_map (
    old_id uuid primary key, new_id uuid not null unique
  ) on commit drop;
end;
$$;

create function private.agent_clone_library_contents(
  p_source_id uuid, p_project_id uuid, p_name text, p_folder_id uuid,
  p_copy_header_only boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_source public.libraries%rowtype;
  v_new_id uuid := gen_random_uuid();
begin
  select * into v_source from public.libraries
    where id = p_source_id and project_id = p_project_id for update;
  if not found or v_source.source_document_id is not null then
    raise exception 'Independent library not found' using errcode = 'P0002';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'Invalid library name' using errcode = '22023';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.folders where id = p_folder_id and project_id = p_project_id
  ) then
    raise exception 'Destination folder not found' using errcode = 'P0002';
  end if;

  insert into public.libraries (id, project_id, folder_id, name, description)
    values (v_new_id, p_project_id, p_folder_id, btrim(p_name), v_source.description);

  truncate pg_temp.agent_copy_field_map, pg_temp.agent_copy_asset_map;

  insert into pg_temp.agent_copy_field_map (old_id, new_id, new_order)
  select field.id, gen_random_uuid(),
    (row_number() over (order by field.order_index, field.id) - 1)::integer
  from public.library_field_definitions field where field.library_id = p_source_id;

  insert into public.library_field_definitions (
    id, library_id, section, label, data_type, enum_options, required,
    order_index, reference_libraries, section_id, description, formula_expression
  )
  select map.new_id, v_new_id, '__keco_flat_fields__', field.label,
    field.data_type, field.enum_options, field.required, map.new_order,
    field.reference_libraries, v_new_id::text || ':keco-flat-fields',
    field.description, field.formula_expression
  from public.library_field_definitions field
  join pg_temp.agent_copy_field_map map on map.old_id = field.id
  order by map.new_order;

  if p_copy_header_only then
    insert into public.library_assets (library_id, name, row_index)
      select v_new_id, '', n from generate_series(0, 2) n;
  else
    insert into pg_temp.agent_copy_asset_map (old_id, new_id)
      select asset.id, gen_random_uuid() from public.library_assets asset
      where asset.library_id = p_source_id;
    insert into public.library_assets (id, library_id, name, row_index)
      select map.new_id, v_new_id, asset.name, asset.row_index
      from public.library_assets asset
      join pg_temp.agent_copy_asset_map map on map.old_id = asset.id;
    insert into public.library_asset_values (asset_id, field_id, value_json)
      select asset_map.new_id, field_map.new_id, value.value_json
      from public.library_asset_values value
      join pg_temp.agent_copy_asset_map asset_map on asset_map.old_id = value.asset_id
      join pg_temp.agent_copy_field_map field_map on field_map.old_id = value.field_id;
  end if;
  return v_new_id;
end;
$$;

create function public.agent_duplicate_library_if_current(
  p_project_id uuid, p_source_id uuid, p_name text, p_copy_header_only boolean,
  p_target_folder_id uuid, p_expected_fingerprint text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_receipt public.agent_studio_copy_receipts%rowtype;
  v_output uuid;
begin
  perform public.mcp_require_writer(p_project_id);
  if p_idempotency_key is null or p_expected_fingerprint is null then
    raise exception 'Copy confirmation data is required' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    p_project_id, p_source_id, p_name, p_copy_header_only,
    p_target_folder_id, p_expected_fingerprint
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_receipt from public.agent_studio_copy_receipts
    where idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.actor_user_id <> v_actor or v_receipt.project_id <> p_project_id
      or v_receipt.kind <> 'library' or v_receipt.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
    if not exists (select 1 from public.libraries where id = v_receipt.output_id) then
      raise exception 'Copied library was deleted; use a new request key' using errcode = 'PT409';
    end if;
    return v_receipt.output_id;
  end if;
  perform 1 from public.libraries where id = p_source_id and project_id = p_project_id for update;
  if not found then raise exception 'Library changed after approval' using errcode = 'PT409'; end if;
  perform 1 from public.library_field_definitions
    where library_id = p_source_id order by id for update;
  perform 1 from public.library_assets
    where library_id = p_source_id order by id for update;
  perform 1 from public.library_asset_values value
    join public.library_assets asset on asset.id = value.asset_id
    where asset.library_id = p_source_id
    order by value.asset_id, value.field_id for update of value;
  if public.agent_library_delete_fingerprint(p_source_id) is distinct from p_expected_fingerprint then
    raise exception 'Library changed after approval' using errcode = 'PT409';
  end if;
  perform private.agent_setup_copy_maps();
  v_output := private.agent_clone_library_contents(
    p_source_id, p_project_id, p_name, p_target_folder_id, p_copy_header_only
  );
  insert into public.agent_studio_copy_receipts
    (idempotency_key, actor_user_id, project_id, kind, request_hash, output_id)
    values (p_idempotency_key, v_actor, p_project_id, 'library', v_hash, v_output);
  return v_output;
end;
$$;

create function public.agent_duplicate_folder_if_current(
  p_project_id uuid, p_source_id uuid, p_expected_fingerprint text,
  p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_source public.folders%rowtype;
  v_hash text;
  v_receipt public.agent_studio_copy_receipts%rowtype;
  v_output uuid := gen_random_uuid();
  v_name text;
  v_suffix integer := 2;
  v_library record;
begin
  if v_actor is null or not coalesce(public.is_project_owner_or_admin(p_project_id, v_actor), false) then
    raise exception 'Only project admins can duplicate folders' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_expected_fingerprint is null then
    raise exception 'Copy confirmation data is required' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_array(
    p_project_id, p_source_id, p_expected_fingerprint
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_receipt from public.agent_studio_copy_receipts
    where idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.actor_user_id <> v_actor or v_receipt.project_id <> p_project_id
      or v_receipt.kind <> 'folder' or v_receipt.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
    if not exists (select 1 from public.folders where id = v_receipt.output_id) then
      raise exception 'Copied folder was deleted; use a new request key' using errcode = 'PT409';
    end if;
    return v_receipt.output_id;
  end if;

  select * into v_source from public.folders
    where id = p_source_id and project_id = p_project_id for update;
  if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
  perform 1 from public.documents where folder_id = p_source_id order by id for update;
  for v_library in select id from public.libraries
    where folder_id = p_source_id and source_document_id is null order by id for update loop
    perform 1 from public.library_field_definitions
      where library_id = v_library.id order by id for update;
    perform 1 from public.library_assets
      where library_id = v_library.id order by id for update;
    perform 1 from public.library_asset_values value
      join public.library_assets asset on asset.id = value.asset_id
      where asset.library_id = v_library.id
      order by value.asset_id, value.field_id for update of value;
  end loop;
  if private.agent_folder_copy_fingerprint(p_source_id) is distinct from p_expected_fingerprint then
    raise exception 'Folder contents changed after approval' using errcode = 'PT409';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'agent-folder-copy-name:' || p_project_id::text || ':root', 0
  ));
  v_name := v_source.name || ' (Copy)';
  while exists (select 1 from public.folders
    where project_id = p_project_id and name = v_name) loop
    v_name := v_source.name || ' (Copy ' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;
  insert into public.folders (id, project_id, parent_folder_id, name, description)
    values (v_output, p_project_id, null, v_name, v_source.description);

  perform private.agent_setup_copy_maps();
  for v_library in select id, name from public.libraries
    where folder_id = p_source_id and project_id = p_project_id
      and source_document_id is null order by id loop
    perform private.agent_clone_library_contents(
      v_library.id, p_project_id, v_library.name || ' (Copy)', v_output, false
    );
  end loop;
  insert into public.documents (project_id, folder_id, name, content, created_by)
    select p_project_id, v_output, document.name, document.content, v_actor
    from public.documents document
    where document.folder_id = p_source_id and document.project_id = p_project_id;

  insert into public.agent_studio_copy_receipts
    (idempotency_key, actor_user_id, project_id, kind, request_hash, output_id)
    values (p_idempotency_key, v_actor, p_project_id, 'folder', v_hash, v_output);
  return v_output;
end;
$$;

revoke all on function private.agent_clone_library_contents(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function private.agent_setup_copy_maps() from public, anon, authenticated;
revoke all on function private.agent_folder_copy_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.agent_prepare_library_copy(uuid, uuid) from public, anon;
revoke all on function public.agent_prepare_folder_copy(uuid, uuid) from public, anon;
revoke all on function public.agent_duplicate_library_if_current(uuid, uuid, text, boolean, uuid, text, uuid) from public, anon;
revoke all on function public.agent_duplicate_folder_if_current(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.agent_duplicate_library_if_current(uuid, uuid, text, boolean, uuid, text, uuid) to authenticated;
grant execute on function public.agent_prepare_library_copy(uuid, uuid) to authenticated;
grant execute on function public.agent_prepare_folder_copy(uuid, uuid) to authenticated;
grant execute on function public.agent_duplicate_folder_if_current(uuid, uuid, text, uuid) to authenticated;
