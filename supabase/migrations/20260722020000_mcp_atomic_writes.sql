-- Keco MCP Phase 2 atomic, non-destructive writes.

create or replace function public.mcp_require_writer(p_project_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not (
    public.is_project_owner(p_project_id, v_actor)
    or public.is_editor_or_admin_collaborator(p_project_id, v_actor)
  ) then
    raise exception 'Project is not writable' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.mcp_replace_document_content(
  p_project_id uuid,p_document_id uuid,p_actor_user_id uuid,p_backup_version_id uuid,
  p_expected_epoch bigint,p_expected_revision bigint,p_expected_update_ids uuid[],
  p_current_yjs_state text,p_current_markdown text,p_replacement_yjs_state text,
  p_replacement_markdown text
)
returns table(document_id uuid,collab_epoch bigint,collab_revision bigint,
  collab_epoch_reason text,updated_at timestamptz,backup_version_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_doc public.documents%rowtype; v_tail uuid[];
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  perform public.assert_document_snapshot_payload(p_current_yjs_state,p_current_markdown);
  perform public.assert_document_snapshot_payload(p_replacement_yjs_state,p_replacement_markdown);
  select * into v_doc from public.documents where id=p_document_id and project_id=p_project_id for update;
  if not found or p_actor_user_id is null or not (
    public.is_project_owner(p_project_id,p_actor_user_id) or
    public.is_editor_or_admin_collaborator(p_project_id,p_actor_user_id)
  ) then raise exception 'Document not found or not writable' using errcode='42501'; end if;
  if v_doc.yjs_state is null or v_doc.collab_epoch<>p_expected_epoch or
    v_doc.collab_revision<>p_expected_revision then
    raise exception 'Document collaboration token changed' using errcode='PT409'; end if;
  select coalesce(array_agg(id order by created_at,id),array[]::uuid[]) into v_tail
    from public.document_yjs_updates where document_id=p_document_id and epoch=v_doc.collab_epoch;
  if v_tail<>coalesce(p_expected_update_ids,array[]::uuid[]) then
    raise exception 'Document update tail changed' using errcode='PT409'; end if;
  insert into public.document_versions(id,document_id,project_id,name,version_type,
    snapshot_yjs_state,snapshot_content,snapshot_epoch,snapshot_revision,created_by)
  values(p_backup_version_id,p_document_id,p_project_id,'Before MCP edit','pre_agent',
    p_current_yjs_state,p_current_markdown,v_doc.collab_epoch,v_doc.collab_revision,p_actor_user_id);
  update public.documents set yjs_state=p_replacement_yjs_state,content=p_replacement_markdown,
    collab_epoch=v_doc.collab_epoch+1,collab_revision=v_doc.collab_revision+1,
    collab_epoch_reason='agent',updated_at=now() where id=p_document_id;
  delete from public.document_yjs_updates where document_id=p_document_id and epoch=v_doc.collab_epoch;
  return query select d.id,d.collab_epoch,d.collab_revision,d.collab_epoch_reason,d.updated_at,p_backup_version_id
    from public.documents d where d.id=p_document_id;
end;
$$;

create or replace function public.mcp_create_table_row(
  p_project_id uuid, p_table_id uuid, p_requested_row_id uuid,
  p_values jsonb, p_reuse_empty boolean default true
)
returns table(row_id uuid, row_index integer, reused_empty_row boolean,
  name text, row_values jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_table public.libraries%rowtype; v_row public.library_assets%rowtype;
  v_resolved jsonb; v_now timestamptz := pg_catalog.clock_timestamp(); v_index integer;
  v_pair record; v_name text;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_table from public.libraries where id=p_table_id and project_id=p_project_id for update;
  if not found then raise exception 'Table not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_table_id::text, 0));
  if p_reuse_empty then
    select a.* into v_row from public.library_assets a
    where a.library_id=p_table_id and not exists (
      select 1 from public.library_asset_values av
      where av.asset_id=a.id and not public.mcp_value_is_empty(av.value_json)
    ) order by a.row_index nulls last, a.created_at, a.id limit 1 for update;
  end if;
  v_resolved := public.mcp_resolve_values(p_project_id,p_table_id,p_values,'{}'::jsonb,true);
  select coalesce(nullif(v_resolved->>f.id::text,''),'Untitled') into v_name
  from public.library_field_definitions f where f.library_id=p_table_id and f.data_type='string'
  order by case when lower(f.label)='name' then 0 else 1 end,f.order_index,f.id limit 1;
  v_name := coalesce(v_name,'Untitled');
  if v_row.id is null then
    if p_requested_row_id is null then raise exception 'Row id required' using errcode='22023'; end if;
    select coalesce(max(greatest(a.row_index,0)),0)+1 into v_index
      from public.library_assets a where a.library_id=p_table_id;
    insert into public.library_assets(id,library_id,name,row_index,created_at,updated_at,updated_by)
      values(p_requested_row_id,p_table_id,v_name,v_index,v_now,v_now,v_actor) returning * into v_row;
  else
    v_index:=v_row.row_index;
    update public.library_assets set name=v_name,updated_at=v_now,updated_by=v_actor where id=v_row.id;
  end if;
  for v_pair in select key,value from jsonb_each(v_resolved) loop
    insert into public.library_asset_values(asset_id,field_id,value_json)
      values(v_row.id,v_pair.key::uuid,v_pair.value)
      on conflict(asset_id,field_id) do update set value_json=excluded.value_json;
  end loop;
  update public.libraries set updated_at=v_now where id=p_table_id;
  update public.projects set updated_at=v_now where id=p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at=v_now where id=v_table.folder_id; end if;
  return query select v_row.id,v_index,(v_row.id is distinct from p_requested_row_id),v_name,v_resolved,v_now;
end;
$$;

create or replace function public.mcp_update_table_row(
  p_project_id uuid, p_table_id uuid, p_row_id uuid default null,
  p_row_index integer default null, p_expected_row_id uuid default null,
  p_values jsonb default '{}'::jsonb
)
returns table(row_id uuid,row_index integer,name text,row_values jsonb,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_table public.libraries%rowtype; v_row public.library_assets%rowtype;
  v_existing jsonb; v_resolved jsonb; v_pair record; v_name text;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  v_actor:=public.mcp_require_writer(p_project_id);
  if (p_row_id is null)=(p_row_index is null) or p_row_index is not null and p_row_index<1 then
    raise exception 'Exactly one row selector is required' using errcode='22023'; end if;
  select * into v_table from public.libraries where id=p_table_id and project_id=p_project_id for update;
  if not found then raise exception 'Table not found' using errcode='P0002'; end if;
  if p_row_id is not null then
    select * into v_row from public.library_assets where id=p_row_id and library_id=p_table_id for update;
  else
    select * into v_row from public.library_assets where library_id=p_table_id
      order by row_index nulls last,created_at,id offset p_row_index-1 limit 1 for update;
  end if;
  if v_row.id is null then raise exception 'Row not found' using errcode='P0002'; end if;
  if p_expected_row_id is not null and p_expected_row_id<>v_row.id then
    raise exception 'Row changed' using errcode='PT409'; end if;
  select coalesce(jsonb_object_agg(field_id::text,value_json),'{}'::jsonb) into v_existing
    from public.library_asset_values where asset_id=v_row.id;
  v_resolved:=public.mcp_resolve_values(p_project_id,p_table_id,p_values,v_existing,false);
  select coalesce(nullif(v_resolved->>f.id::text,''),v_row.name) into v_name
    from public.library_field_definitions f where f.library_id=p_table_id and f.data_type='string'
    order by case when lower(f.label)='name' then 0 else 1 end,f.order_index,f.id limit 1;
  v_name:=coalesce(v_name,v_row.name);
  for v_pair in select key,value from jsonb_each(v_resolved) loop
    insert into public.library_asset_values(asset_id,field_id,value_json)
      values(v_row.id,v_pair.key::uuid,v_pair.value)
      on conflict(asset_id,field_id) do update set value_json=excluded.value_json;
  end loop;
  update public.library_assets set name=v_name,updated_at=v_now,updated_by=v_actor where id=v_row.id;
  update public.libraries set updated_at=v_now where id=p_table_id;
  update public.projects set updated_at=v_now where id=p_project_id;
  if v_table.folder_id is not null then update public.folders set updated_at=v_now where id=v_table.folder_id; end if;
  return query select v_row.id,v_row.row_index,v_name,v_resolved,v_now;
end;
$$;

create or replace function public.mcp_create_document(
  p_project_id uuid,p_document_id uuid,p_folder_id uuid,p_name text,
  p_markdown text,p_yjs_state text,p_allow_duplicate boolean default false
)
returns table(document_id uuid,project_id uuid,folder_id uuid,name text,content text,
  collab_epoch bigint,collab_revision bigint,collab_epoch_reason text,
  update_ids uuid[],updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_name text:=btrim(p_name); v_doc public.documents%rowtype;
begin
  v_actor:=public.mcp_require_writer(p_project_id);
  perform public.assert_document_snapshot_payload(p_yjs_state,p_markdown);
  if p_document_id is null or length(v_name) not between 1 and 200 then
    raise exception 'Invalid document input' using errcode='22023'; end if;
  if p_folder_id is not null and not exists(select 1 from public.folders where id=p_folder_id and project_id=p_project_id) then
    raise exception 'Folder is outside project' using errcode='23503'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text||':'||coalesce(p_folder_id::text,'')||':'||lower(v_name),0));
  if not p_allow_duplicate and exists(select 1 from public.documents where project_id=p_project_id and folder_id is not distinct from p_folder_id and name=v_name) then
    raise exception 'Document name already exists' using errcode='23505'; end if;
  insert into public.documents(id,project_id,folder_id,name,content,yjs_state,collab_epoch,
    collab_revision,collab_epoch_reason,created_by)
  values(p_document_id,p_project_id,p_folder_id,v_name,p_markdown,p_yjs_state,0,1,'initialize',v_actor)
  returning * into v_doc;
  return query select v_doc.id,v_doc.project_id,v_doc.folder_id,v_doc.name,v_doc.content,
    v_doc.collab_epoch,v_doc.collab_revision,v_doc.collab_epoch_reason,array[]::uuid[],v_doc.updated_at;
end;
$$;

create or replace function public.mcp_value_is_empty(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_value is null or p_value = 'null'::jsonb
    or (jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '')
$$;

create or replace function public.mcp_validate_field_value(
  p_project_id uuid,
  p_table_id uuid,
  p_field public.library_field_definitions,
  p_value jsonb
)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
declare v_item jsonb; v_asset uuid; v_field uuid; v_target_table uuid;
begin
  if p_field.data_type is null or p_field.data_type in (
    'formula', 'image', 'file', 'multimedia', 'audio', 'media'
  ) then
    raise exception 'Field type is not MCP writable' using errcode = '22023';
  end if;
  if public.mcp_value_is_empty(p_value) then return; end if;
  if p_field.data_type = 'string' and jsonb_typeof(p_value) <> 'string'
    or p_field.data_type = 'boolean' and jsonb_typeof(p_value) <> 'boolean'
    or p_field.data_type in ('int', 'float') and jsonb_typeof(p_value) <> 'number'
    or p_field.data_type in ('string_array', 'int_array', 'float_array')
       and jsonb_typeof(p_value) <> 'array'
    or p_field.data_type = 'date' and (
      jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}'
    ) then
    raise exception 'Field value has the wrong type' using errcode = '22023';
  end if;
  if p_field.data_type = 'int' and (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) then
    raise exception 'Integer field requires an integer' using errcode = '22023';
  end if;
  if p_field.data_type = 'enum' and (
    jsonb_typeof(p_value) <> 'string'
    or not ((p_value #>> '{}') = any(coalesce(p_field.enum_options, array[]::text[])))
  ) then
    raise exception 'Invalid enum value' using errcode = '22023';
  end if;
  if p_field.data_type = 'reference' then
    if jsonb_typeof(p_value) not in ('object', 'array') then
      raise exception 'Invalid reference value' using errcode = '22023';
    end if;
    for v_item in select value from jsonb_array_elements(
      case when jsonb_typeof(p_value) = 'array' then p_value else jsonb_build_array(p_value) end
    ) loop
      begin
        v_asset := (v_item->>'assetId')::uuid;
        v_field := (v_item->>'fieldId')::uuid;
      exception when others then
        raise exception 'Invalid reference identifiers' using errcode = '22023';
      end;
      select a.library_id into v_target_table
      from public.library_assets a
      join public.libraries l on l.id = a.library_id and l.project_id = p_project_id
      join public.library_field_definitions f on f.id = v_field and f.library_id = a.library_id
      where a.id = v_asset;
      if v_target_table is null or not (v_target_table = any(coalesce(
        p_field.reference_libraries, array[]::uuid[]
      ))) then
        raise exception 'Reference target is outside the allowed project table' using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.mcp_resolve_values(
  p_project_id uuid,
  p_table_id uuid,
  p_values jsonb,
  p_existing jsonb default '{}'::jsonb,
  p_require_all boolean default false
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare v_result jsonb := coalesce(p_existing, '{}'::jsonb);
  v_pair record; v_field public.library_field_definitions%rowtype; v_count integer;
begin
  if jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb
    or pg_catalog.octet_length(p_values::text) >= 262144 then
    raise exception 'Values must be a bounded non-empty object' using errcode = '22023';
  end if;
  for v_pair in select * from jsonb_each(p_values) loop
    select count(*) into v_count
    from public.library_field_definitions f
    where f.library_id = p_table_id
      and (f.label = v_pair.key or lower(btrim(f.label)) = lower(btrim(v_pair.key)));
    if v_count <> 1 then
      raise exception 'Unknown or ambiguous field label' using errcode = '22023';
    end if;
    select f.* into v_field
    from public.library_field_definitions f
    where f.library_id = p_table_id
      and (f.label = v_pair.key or lower(btrim(f.label)) = lower(btrim(v_pair.key)))
    order by case when f.label = v_pair.key then 0 else 1 end, f.id
    limit 1;
    perform public.mcp_validate_field_value(p_project_id, p_table_id, v_field, v_pair.value);
    v_result := jsonb_set(v_result, array[v_field.id::text], v_pair.value, true);
  end loop;
  if exists (
    select 1 from public.library_field_definitions f
    where f.library_id = p_table_id and coalesce(f.required, false)
      and public.mcp_value_is_empty(v_result->f.id::text)
  ) then
    raise exception 'Required field is empty' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

create or replace function public.mcp_create_table(
  p_project_id uuid, p_table_id uuid, p_folder_id uuid, p_name text,
  p_description text, p_fields jsonb, p_initial_row_id uuid
)
returns table (table_id uuid, initial_row_id uuid, initial_row_index integer,
  field_ids uuid[], created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_now timestamptz := pg_catalog.clock_timestamp();
  v_name text := btrim(p_name); v_count integer; v_item jsonb; v_ids uuid[] := array[]::uuid[];
  v_field_id uuid; v_type text; v_label text; v_section text; v_section_id text;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_table_id is null or p_initial_row_id is null or length(v_name) not between 1 and 200
    or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Invalid table input' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_fields);
  if v_count not between 1 and 100 then
    raise exception 'Table must have 1 to 100 fields' using errcode = '22023';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.folders where id = p_folder_id and project_id = p_project_id
  ) then raise exception 'Folder is outside project' using errcode = '23503'; end if;
  if (select count(*) from (select lower(btrim(x->>'label')) from jsonb_array_elements(p_fields) x group by 1) q) <> v_count then
    raise exception 'Field labels must be unique' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':' || coalesce(p_folder_id::text, ''), 0));
  if exists (
    select 1 from public.libraries l
    where l.project_id = p_project_id
      and l.folder_id is not distinct from p_folder_id
      and lower(btrim(l.name)) = lower(v_name)
  ) then
    raise exception 'Table name already exists' using errcode = '23505';
  end if;
  insert into public.libraries(id, project_id, folder_id, name, description, created_at, updated_at, updated_by)
  values(p_table_id, p_project_id, p_folder_id, v_name, nullif(btrim(p_description), ''), v_now, v_now, v_actor);
  for v_item in select value from jsonb_array_elements(p_fields) loop
    begin v_field_id := (v_item->>'id')::uuid; exception when others then
      raise exception 'Invalid field id' using errcode = '22023'; end;
    v_type := v_item->>'dataType'; v_label := btrim(v_item->>'label');
    v_section := coalesce(nullif(btrim(v_item->>'section'), ''), 'section1');
    v_section_id := coalesce(nullif(v_item->>'sectionId', ''), md5(p_table_id::text || ':' || v_section));
    if v_type is null or v_type not in (
      'string','string_array','int','int_array','float','float_array',
      'boolean','enum','date','reference'
    )
      or length(v_label) not between 1 and 200 then
      raise exception 'Unsupported field definition' using errcode = '22023';
    end if;
    if v_type = 'enum' and (jsonb_typeof(v_item->'enumOptions') <> 'array' or jsonb_array_length(v_item->'enumOptions') = 0) then
      raise exception 'Enum options are required' using errcode = '22023'; end if;
    if v_type = 'reference' and (
      jsonb_typeof(v_item->'referenceTableIds') <> 'array'
      or jsonb_array_length(v_item->'referenceTableIds') = 0
      or exists (
        select 1 from jsonb_array_elements_text(v_item->'referenceTableIds') target(id)
        left join public.libraries referenced on referenced.id = target.id::uuid
          and referenced.project_id = p_project_id
        where referenced.id is null
      )
    ) then
      raise exception 'Reference table is outside project' using errcode = '23503';
    end if;
    insert into public.library_field_definitions(
      id, library_id, section, section_id, label, data_type, enum_options,
      reference_libraries, required, description, order_index
    ) values (
      v_field_id, p_table_id, v_section, v_section_id, v_label, v_type,
      case when v_type='enum' then array(select jsonb_array_elements_text(v_item->'enumOptions')) end,
      case when v_type='reference' then array(select jsonb_array_elements_text(v_item->'referenceTableIds'))::uuid[] end,
      coalesce((v_item->>'required')::boolean, false), nullif(v_item->>'description',''),
      array_position(array(select value from jsonb_array_elements(p_fields)), v_item) - 1
    );
    v_ids := array_append(v_ids, v_field_id);
  end loop;
  insert into public.library_assets(id, library_id, name, row_index, created_at, updated_at, updated_by)
  values(p_initial_row_id, p_table_id, '', 1, v_now, v_now, v_actor);
  update public.projects set updated_at=v_now where id=p_project_id;
  if p_folder_id is not null then update public.folders set updated_at=v_now where id=p_folder_id; end if;
  return query select p_table_id, p_initial_row_id, 1, v_ids, v_now;
end;
$$;

revoke all on function public.mcp_require_writer(uuid) from public,anon;
revoke all on function public.mcp_value_is_empty(jsonb) from public,anon,authenticated;
revoke all on function public.mcp_validate_field_value(uuid,uuid,public.library_field_definitions,jsonb) from public,anon,authenticated;
revoke all on function public.mcp_resolve_values(uuid,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.mcp_create_table(uuid,uuid,uuid,text,text,jsonb,uuid) from public,anon;
revoke all on function public.mcp_create_table_row(uuid,uuid,uuid,jsonb,boolean) from public,anon;
revoke all on function public.mcp_update_table_row(uuid,uuid,uuid,integer,uuid,jsonb) from public,anon;
revoke all on function public.mcp_create_document(uuid,uuid,uuid,text,text,text,boolean) from public,anon;
revoke all on function public.mcp_replace_document_content(uuid,uuid,uuid,uuid,bigint,bigint,uuid[],text,text,text,text) from public,anon,authenticated;
grant execute on function public.mcp_create_table(uuid,uuid,uuid,text,text,jsonb,uuid) to authenticated;
grant execute on function public.mcp_create_table_row(uuid,uuid,uuid,jsonb,boolean) to authenticated;
grant execute on function public.mcp_update_table_row(uuid,uuid,uuid,integer,uuid,jsonb) to authenticated;
grant execute on function public.mcp_create_document(uuid,uuid,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.mcp_replace_document_content(uuid,uuid,uuid,uuid,bigint,bigint,uuid[],text,text,text,text) to service_role;
