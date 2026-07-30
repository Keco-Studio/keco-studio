-- Allow MCP-created image fields and append optional fields atomically.

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
      'boolean','enum','date','reference','image'
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

create or replace function public.mcp_add_table_field(
  p_project_id uuid,
  p_table_id uuid,
  p_field_id uuid,
  p_field jsonb
)
returns table (
  field_id uuid,
  table_id uuid,
  label text,
  data_type text,
  section text,
  section_id text,
  order_index integer,
  required boolean,
  description text,
  enum_options text[],
  reference_table_ids uuid[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_table public.libraries%rowtype;
  v_created public.library_field_definitions%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_type text;
  v_label text;
  v_section text;
  v_section_id text;
  v_description text;
  v_required boolean;
  v_order_index integer;
  v_section_count integer;
  v_enum_options text[];
  v_reference_table_ids uuid[];
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select library.* into v_table
  from public.libraries as library
  where library.id = p_table_id and library.project_id = p_project_id
  for update;
  if not found then
    raise exception 'Table not found' using errcode = 'P0002';
  end if;

  if p_field_id is null
    or jsonb_typeof(p_field) is distinct from 'object' then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_field) as key(name)
    where key.name <> all (array[
      'label', 'dataType', 'section', 'sectionId', 'description', 'required',
      'enumOptions', 'referenceTableIds'
    ])
  ) then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;

  v_type := p_field ->> 'dataType';
  v_label := btrim(p_field ->> 'label');
  v_section := coalesce(nullif(btrim(p_field ->> 'section'), ''), 'section1');
  v_section_id := nullif(btrim(p_field ->> 'sectionId'), '');
  v_description := nullif(p_field ->> 'description', '');

  if v_type is null or v_type not in (
    'string','string_array','int','int_array','float','float_array',
    'boolean','enum','date','reference','image'
  )
    or jsonb_typeof(p_field -> 'label') is distinct from 'string'
    or length(v_label) not between 1 and 200
    or length(v_section) not between 1 and 100
    or length(v_description) > 1000
    or (p_field ? 'section' and jsonb_typeof(p_field -> 'section') <> 'string')
    or (p_field ? 'sectionId' and (
      jsonb_typeof(p_field -> 'sectionId') <> 'string'
      or length(btrim(p_field ->> 'sectionId')) not between 1 and 200
    ))
    or (p_field ? 'description'
      and jsonb_typeof(p_field -> 'description') not in ('string', 'null'))
    or (p_field ? 'required'
      and jsonb_typeof(p_field -> 'required') <> 'boolean') then
    raise exception 'Unsupported field definition' using errcode = '22023';
  end if;

  if v_section_id is null then
    select min(f.section_id), count(distinct f.section_id)
    into v_section_id, v_section_count
    from public.library_field_definitions as f
    where f.library_id = p_table_id and f.section = v_section;
    if v_section_count > 1 then
      raise exception 'Section name is ambiguous; sectionId is required'
        using errcode = '22023';
    end if;
    v_section_id := coalesce(
      v_section_id,
      md5(p_table_id::text || ':' || v_section)
    );
  end if;

  v_required := coalesce((p_field ->> 'required')::boolean, false);
  if v_required then
    raise exception 'Fields added to existing tables cannot be required'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.library_field_definitions as f
    where f.library_id = p_table_id
      and lower(btrim(f.label)) = lower(v_label)
  ) then
    raise exception 'Field label already exists' using errcode = '23505';
  end if;

  if v_type = 'enum' then
    if jsonb_typeof(p_field -> 'enumOptions') is distinct from 'array' then
      raise exception 'Enum options are required' using errcode = '22023';
    end if;
    if jsonb_array_length(p_field -> 'enumOptions') not between 1 and 100
      or exists (
        select 1 from jsonb_array_elements(p_field -> 'enumOptions') as option(value)
        where jsonb_typeof(option.value) is distinct from 'string'
          or length(btrim(option.value #>> '{}')) not between 1 and 200
      ) then
      raise exception 'Enum options are required' using errcode = '22023';
    end if;
    select array_agg(btrim(value #>> '{}')) into v_enum_options
    from jsonb_array_elements(p_field -> 'enumOptions') as option(value);
  elsif p_field ? 'enumOptions' then
    raise exception 'Enum options require an enum field' using errcode = '22023';
  end if;

  if v_type = 'reference' then
    if jsonb_typeof(p_field -> 'referenceTableIds') is distinct from 'array'
      or jsonb_array_length(p_field -> 'referenceTableIds') not between 1 and 20 then
      raise exception 'Reference table IDs are required' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_field -> 'referenceTableIds') as target(value)
      where jsonb_typeof(target.value) is distinct from 'string'
    ) then
      raise exception 'Reference table IDs must be UUID strings'
        using errcode = '22023';
    end if;
    begin
      select array_agg((value #>> '{}')::uuid) into v_reference_table_ids
      from jsonb_array_elements(p_field -> 'referenceTableIds') as target(value);
    exception when invalid_text_representation then
      raise exception 'Reference table IDs must be UUID strings'
        using errcode = '22023';
    end;
    if exists (
      select 1
      from unnest(v_reference_table_ids) as target(id)
      left join public.libraries as referenced
        on referenced.id = target.id and referenced.project_id = p_project_id
      where referenced.id is null
    ) then
      raise exception 'Reference table is outside project' using errcode = '23503';
    end if;
  elsif p_field ? 'referenceTableIds' then
    raise exception 'Reference targets require a reference field' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.library_field_definitions as f
    where f.section_id = v_section_id and f.library_id <> p_table_id
  ) or exists (
    select 1 from public.library_field_definitions as f
    where f.library_id = p_table_id and f.section_id = v_section_id
      and f.section <> v_section
  ) then
    raise exception 'Section is outside table' using errcode = '23503';
  end if;

  select coalesce(max(f.order_index), -1) + 1 into v_order_index
  from public.library_field_definitions as f
  where f.library_id = p_table_id and f.section_id = v_section_id;

  insert into public.library_field_definitions(
    id, library_id, section, section_id, label, data_type, enum_options,
    reference_libraries, required, description, order_index, created_at
  ) values (
    p_field_id, p_table_id, v_section, v_section_id, v_label, v_type,
    v_enum_options, v_reference_table_ids, false, v_description, v_order_index, v_now
  ) returning * into v_created;

  update public.libraries
  set updated_at = v_now, updated_by = v_actor
  where id = p_table_id;
  update public.projects set updated_at = v_now where id = p_project_id;
  if v_table.folder_id is not null then
    update public.folders set updated_at = v_now where id = v_table.folder_id;
  end if;

  return query select
    v_created.id,
    v_created.library_id,
    v_created.label,
    v_created.data_type,
    v_created.section,
    v_created.section_id,
    v_created.order_index,
    coalesce(v_created.required, false),
    v_created.description,
    v_created.enum_options,
    v_created.reference_libraries,
    v_created.created_at;
end;
$$;

revoke all on function public.mcp_create_table(uuid,uuid,uuid,text,text,jsonb,uuid)
  from public,anon;
grant execute on function public.mcp_create_table(uuid,uuid,uuid,text,text,jsonb,uuid)
  to authenticated;
revoke all on function public.mcp_add_table_field(uuid,uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.mcp_add_table_field(uuid,uuid,uuid,jsonb)
  to authenticated;
