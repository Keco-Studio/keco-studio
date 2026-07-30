-- Preserve the verified image metadata checks while accepting the HTTP public
-- URL emitted by local Supabase development stacks.
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
declare
  v_item jsonb;
  v_asset uuid;
  v_field uuid;
  v_target_table uuid;
  v_date date;
  v_canonical jsonb;
  v_image_url text;
  v_image_path text;
  v_image_file_name text;
  v_image_file_size bigint;
  v_image_file_type text;
  v_image_uploaded_at timestamptz;
  v_expected_prefix text;
  v_expected_url_suffix text;
  v_path_file_name text;
  v_object_size text;
  v_object_type text;
  v_object_created_at timestamptz;
begin
  if p_field.data_type is null or p_field.data_type in (
    'formula', 'file', 'multimedia', 'audio', 'media'
  ) then
    raise exception 'Field type is not MCP writable' using errcode = '22023';
  end if;
  if public.mcp_value_is_empty(p_value) then return; end if;

  if p_field.data_type = 'image' then
    if jsonb_typeof(p_value) <> 'object'
      or not (p_value ?& array[
        'url', 'path', 'fileName', 'fileSize', 'fileType', 'uploadedAt'
      ])
      or exists (
        select 1
        from jsonb_object_keys(p_value) as key(name)
        where key.name <> all (array[
          'url', 'path', 'fileName', 'fileSize', 'fileType', 'uploadedAt'
        ])
      )
      or jsonb_typeof(p_value -> 'url') <> 'string'
      or jsonb_typeof(p_value -> 'path') <> 'string'
      or jsonb_typeof(p_value -> 'fileName') <> 'string'
      or jsonb_typeof(p_value -> 'fileSize') <> 'number'
      or jsonb_typeof(p_value -> 'fileType') <> 'string'
      or jsonb_typeof(p_value -> 'uploadedAt') <> 'string' then
      raise exception 'Image field requires verified upload metadata'
        using errcode = '22023';
    end if;

    begin
      v_image_url := p_value ->> 'url';
      v_image_path := p_value ->> 'path';
      v_image_file_name := p_value ->> 'fileName';
      v_image_file_size := (p_value ->> 'fileSize')::bigint;
      v_image_file_type := lower(p_value ->> 'fileType');
      v_image_uploaded_at := (p_value ->> 'uploadedAt')::timestamptz;
    exception when others then
      raise exception 'Image field contains invalid upload metadata'
        using errcode = '22023';
    end;

    if v_image_file_size < 1 or v_image_file_size > 5242880
      or (p_value ->> 'fileSize')::numeric <> v_image_file_size
      or not isfinite(v_image_uploaded_at) then
      raise exception 'Image field contains invalid upload metadata'
        using errcode = '22023';
    end if;

    v_expected_prefix := auth.uid()::text || '/' || p_project_id::text || '/';
    if auth.uid() is null
      or left(v_image_path, length(v_expected_prefix)) <> v_expected_prefix then
      raise exception 'Image path is outside the writable project'
        using errcode = '22023';
    end if;

    v_path_file_name := substring(
      substring(v_image_path from length(v_expected_prefix) + 1)
      from '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-([^/]+)$'
    );
    if v_path_file_name is null or v_path_file_name <> v_image_file_name then
      raise exception 'Image file name does not match its upload path'
        using errcode = '22023';
    end if;

    if not (
      v_image_file_type = 'image/png' and lower(v_image_file_name) ~ '\.png$'
      or v_image_file_type = 'image/jpeg' and lower(v_image_file_name) ~ '\.(jpg|jpeg)$'
      or v_image_file_type = 'image/gif' and lower(v_image_file_name) ~ '\.gif$'
      or v_image_file_type = 'image/webp' and lower(v_image_file_name) ~ '\.webp$'
      or v_image_file_type = 'image/svg+xml' and lower(v_image_file_name) ~ '\.svg$'
    ) then
      raise exception 'Image file type does not match its extension'
        using errcode = '22023';
    end if;

    v_expected_url_suffix :=
      '/storage/v1/object/public/library-media-files/' || v_image_path;
    if not (
      v_image_url ~ '^https://'
      or v_image_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'
    )
      or right(v_image_url, length(v_expected_url_suffix)) <> v_expected_url_suffix then
      raise exception 'Image URL does not match its upload path'
        using errcode = '22023';
    end if;

    select
      object.metadata ->> 'size',
      lower(split_part(coalesce(object.metadata ->> 'mimetype', ''), ';', 1)),
      object.created_at
    into v_object_size, v_object_type, v_object_created_at
    from storage.objects as object
    where object.bucket_id = 'library-media-files'
      and object.name = v_image_path;

    if not found or v_object_size is null or v_object_type is null
      or v_object_created_at is null or v_object_size !~ '^[0-9]+$'
      or v_object_size::bigint <> v_image_file_size
      or v_object_type <> v_image_file_type
      or abs(extract(epoch from (v_object_created_at - v_image_uploaded_at))) > 1 then
      raise exception 'Image metadata does not match its Storage object'
        using errcode = '22023';
    end if;
    return;
  end if;

  if p_field.data_type = 'string' and jsonb_typeof(p_value) <> 'string'
    or p_field.data_type = 'boolean' and jsonb_typeof(p_value) <> 'boolean'
    or p_field.data_type in ('int', 'float') and jsonb_typeof(p_value) <> 'number'
    or p_field.data_type in ('string_array', 'int_array', 'float_array')
       and jsonb_typeof(p_value) <> 'array' then
    raise exception 'Field value has the wrong type' using errcode = '22023';
  end if;
  if p_field.data_type = 'int'
    and (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) then
    raise exception 'Integer field requires an integer' using errcode = '22023';
  end if;
  if p_field.data_type in ('string_array', 'int_array', 'float_array') then
    for v_item in select value from jsonb_array_elements(p_value) loop
      if p_field.data_type = 'string_array' and jsonb_typeof(v_item) <> 'string'
        or p_field.data_type in ('int_array', 'float_array')
           and jsonb_typeof(v_item) <> 'number' then
        raise exception 'Array field contains an element of the wrong type'
          using errcode = '22023';
      end if;
      if p_field.data_type = 'int_array'
        and (v_item #>> '{}')::numeric <> trunc((v_item #>> '{}')::numeric) then
        raise exception 'Integer array requires integer elements'
          using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_field.data_type = 'date' then
    if jsonb_typeof(p_value) <> 'string'
      or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Date field requires YYYY-MM-DD' using errcode = '22023';
    end if;
    begin
      v_date := (p_value #>> '{}')::date;
    exception when others then
      raise exception 'Date field requires a real calendar date' using errcode = '22023';
    end;
    if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> (p_value #>> '{}') then
      raise exception 'Date field requires a real calendar date' using errcode = '22023';
    end if;
  end if;
  if p_field.data_type = 'enum' and (
    jsonb_typeof(p_value) <> 'string'
    or not ((p_value #>> '{}') = any(coalesce(p_field.enum_options, array[]::text[])))
  ) then
    raise exception 'Invalid enum value' using errcode = '22023';
  end if;
  if p_field.data_type = 'reference' then
    v_canonical := public.mcp_canonical_reference_value(p_value);
    for v_item in
      select value from jsonb_array_elements(
        case when jsonb_typeof(v_canonical) = 'array'
          then v_canonical else jsonb_build_array(v_canonical) end
      )
    loop
      v_asset := (v_item ->> 'assetId')::uuid;
      v_field := (v_item ->> 'fieldId')::uuid;
      select asset.library_id into v_target_table
      from public.library_assets as asset
      join public.libraries as library
        on library.id = asset.library_id and library.project_id = p_project_id
      join public.library_field_definitions as field
        on field.id = v_field and field.library_id = asset.library_id
      where asset.id = v_asset;
      if v_target_table is null or not (v_target_table = any(coalesce(
        p_field.reference_libraries, array[]::uuid[]
      ))) then
        raise exception 'Reference target is outside the allowed project table'
          using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.mcp_validate_field_value(
  uuid, uuid, public.library_field_definitions, jsonb
) from public, anon, authenticated;
