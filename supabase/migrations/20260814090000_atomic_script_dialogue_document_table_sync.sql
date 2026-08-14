-- Keep Script edits, the source Document, and sibling derived Tables in one transaction.

create or replace function public.replace_document_with_markdown_and_sync_tables(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_backup_version_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_included_update_ids uuid[],
  p_current_yjs_state text,
  p_current_markdown text,
  p_replacement_yjs_state text,
  p_replacement_markdown text,
  p_derived_table_operations jsonb
)
returns table (
  collab_epoch bigint,
  collab_revision bigint,
  yjs_state text,
  content text,
  updated_at timestamptz,
  backup_version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation jsonb;
  v_operation_type text;
  v_library_id uuid;
  v_type_field_id uuid;
  v_name_field_id uuid;
  v_content_field_id uuid;
  v_action_row_id uuid;
  v_speech_row_id uuid;
  v_after_row_id uuid;
  v_row_ids uuid[];
  v_speaker text;
  v_action text;
  v_dialogue text;
  v_speech_type text;
  v_row_index integer;
  v_row_count integer;
  v_distinct_index_count integer;
  v_min_index integer;
  v_max_index integer;
  v_expected_table_count integer;
  v_operation_count integer;
  v_distinct_operation_count integer;
  v_project_id uuid;
  v_folder_id uuid;
  v_now timestamptz := now();
begin
  if p_derived_table_operations is null
    or jsonb_typeof(p_derived_table_operations) <> 'array'
  then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: operations must be an array'
      using errcode = '22023';
  end if;

  select count(*)
    into v_expected_table_count
    from public.libraries as library
    where library.project_id = (
      select document.project_id
      from public.documents as document
      where document.id = p_document_id
    )
      and library.source_document_id = p_document_id
      and library.document_export_type = 'table';

  select count(*), count(distinct operation.value ->> 'libraryId')
    into v_operation_count, v_distinct_operation_count
    from jsonb_array_elements(p_derived_table_operations) as operation(value);

  if v_operation_count <> v_expected_table_count
    or v_distinct_operation_count <> v_operation_count
    or exists (
      select 1
      from jsonb_array_elements(p_derived_table_operations) as operation(value)
      where not exists (
        select 1
        from public.libraries as library
        where library.id = nullif(operation.value ->> 'libraryId', '')::uuid
          and library.source_document_id = p_document_id
          and library.document_export_type = 'table'
      )
    )
  then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: derived table set changed'
      using errcode = 'PT409';
  end if;

  -- Acquire table locks in a stable order and validate every prepared operation
  -- before changing the Document snapshot.
  for v_operation in
    select operation.value
    from jsonb_array_elements(p_derived_table_operations) as operation(value)
    order by operation.value ->> 'libraryId'
  loop
    v_library_id := nullif(v_operation ->> 'libraryId', '')::uuid;
    v_operation_type := v_operation ->> 'type';
    v_type_field_id := nullif(v_operation ->> 'typeFieldId', '')::uuid;
    v_name_field_id := nullif(v_operation ->> 'nameFieldId', '')::uuid;
    v_content_field_id := nullif(v_operation ->> 'contentFieldId', '')::uuid;
    v_action_row_id := nullif(v_operation ->> 'actionRowId', '')::uuid;
    v_speech_row_id := nullif(v_operation ->> 'speechRowId', '')::uuid;
    v_after_row_id := nullif(v_operation ->> 'afterRowId', '')::uuid;

    if v_operation_type not in ('edit', 'insert', 'delete') then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: unsupported operation'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_library_id::text, 0));
    perform 1
      from public.library_assets as asset
      where asset.library_id = v_library_id
      for update;

    if (
      select count(*)
      from public.library_field_definitions as field_definition
      where field_definition.library_id = v_library_id
        and field_definition.id = any(array[
          v_type_field_id,
          v_name_field_id,
          v_content_field_id
        ])
    ) <> 3 then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: table fields changed'
        using errcode = 'PT409';
    end if;

    if v_operation_type in ('edit', 'delete') then
      v_row_ids := array_remove(array[v_action_row_id, v_speech_row_id], null);
      if cardinality(v_row_ids) = 0 or (
        select count(*)
        from public.library_assets as asset
        where asset.library_id = v_library_id
          and asset.id = any(v_row_ids)
      ) <> cardinality(v_row_ids) then
        raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: table rows changed'
          using errcode = 'PT409';
      end if;
    elsif v_after_row_id is not null and not exists (
      select 1
      from public.library_assets as asset
      where asset.library_id = v_library_id
        and asset.id = v_after_row_id
    ) then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: insert anchor changed'
        using errcode = 'PT409';
    end if;

    if v_operation_type in ('edit', 'insert') then
      v_speaker := btrim(coalesce(v_operation ->> 'speaker', ''));
      v_speech_type := v_operation ->> 'speechType';
      if v_speaker = '' or v_speech_type not in ('1', '2') then
        raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: dialogue values are invalid'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  perform public.replace_document_with_markdown(
    p_document_id,
    p_actor_user_id,
    p_backup_version_id,
    p_expected_epoch,
    p_expected_revision,
    p_included_update_ids,
    p_current_yjs_state,
    p_current_markdown,
    p_replacement_yjs_state,
    p_replacement_markdown
  );

  for v_operation in
    select operation.value
    from jsonb_array_elements(p_derived_table_operations) as operation(value)
    order by operation.value ->> 'libraryId'
  loop
    v_library_id := (v_operation ->> 'libraryId')::uuid;
    v_operation_type := v_operation ->> 'type';
    v_type_field_id := (v_operation ->> 'typeFieldId')::uuid;
    v_name_field_id := (v_operation ->> 'nameFieldId')::uuid;
    v_content_field_id := (v_operation ->> 'contentFieldId')::uuid;
    v_action_row_id := nullif(v_operation ->> 'actionRowId', '')::uuid;
    v_speech_row_id := nullif(v_operation ->> 'speechRowId', '')::uuid;
    v_after_row_id := nullif(v_operation ->> 'afterRowId', '')::uuid;
    v_speaker := btrim(coalesce(v_operation ->> 'speaker', ''));
    v_action := coalesce(v_operation ->> 'action', '');
    v_dialogue := coalesce(v_operation ->> 'dialogue', '');
    v_speech_type := v_operation ->> 'speechType';

    select
      count(*),
      count(distinct asset.row_index),
      min(asset.row_index),
      max(asset.row_index)
      into v_row_count, v_distinct_index_count, v_min_index, v_max_index
      from public.library_assets as asset
      where asset.library_id = v_library_id;

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
        where asset.library_id = v_library_id
      )
      update public.library_assets as asset
        set row_index = normalized.row_index
        from normalized
        where asset.id = normalized.id
          and asset.row_index is distinct from normalized.row_index;
    end if;

    if v_operation_type = 'edit' then
      if btrim(v_action) <> '' and v_action_row_id is null then
        select asset.row_index
          into v_row_index
          from public.library_assets as asset
          where asset.id = v_speech_row_id
            and asset.library_id = v_library_id;
        update public.library_assets as asset
          set row_index = asset.row_index + 1
          where asset.library_id = v_library_id
            and asset.row_index >= v_row_index;
        v_action_row_id := gen_random_uuid();
        insert into public.library_assets (id, library_id, name, row_index)
          values (v_action_row_id, v_library_id, v_speaker, v_row_index);
      end if;

      if btrim(v_dialogue) <> '' and v_speech_row_id is null then
        select asset.row_index + 1
          into v_row_index
          from public.library_assets as asset
          where asset.id = v_action_row_id
            and asset.library_id = v_library_id;
        update public.library_assets as asset
          set row_index = asset.row_index + 1
          where asset.library_id = v_library_id
            and asset.row_index >= v_row_index;
        v_speech_row_id := gen_random_uuid();
        insert into public.library_assets (id, library_id, name, row_index)
          values (v_speech_row_id, v_library_id, v_speaker, v_row_index);
      end if;

      if v_action_row_id is not null then
        update public.library_assets set name = v_speaker where id = v_action_row_id;
        insert into public.library_asset_values (asset_id, field_id, value_json)
        values
          (v_action_row_id, v_type_field_id, to_jsonb('3'::text)),
          (v_action_row_id, v_name_field_id, to_jsonb(v_speaker)),
          (v_action_row_id, v_content_field_id, to_jsonb(v_action))
        on conflict (asset_id, field_id) do update
          set value_json = excluded.value_json;
      end if;

      if v_speech_row_id is not null then
        update public.library_assets set name = v_speaker where id = v_speech_row_id;
        insert into public.library_asset_values (asset_id, field_id, value_json)
        values
          (v_speech_row_id, v_type_field_id, to_jsonb(v_speech_type)),
          (v_speech_row_id, v_name_field_id, to_jsonb(v_speaker)),
          (v_speech_row_id, v_content_field_id, to_jsonb(v_dialogue))
        on conflict (asset_id, field_id) do update
          set value_json = excluded.value_json;
      end if;
    elsif v_operation_type = 'insert' then
      if v_after_row_id is not null then
        select asset.row_index + 1
          into v_row_index
          from public.library_assets as asset
          where asset.id = v_after_row_id
            and asset.library_id = v_library_id;
      elsif coalesce((v_operation ->> 'insertAtStart')::boolean, false) then
        v_row_index := 1;
      else
        select coalesce(max(asset.row_index), 0) + 1
          into v_row_index
          from public.library_assets as asset
          where asset.library_id = v_library_id;
      end if;

      update public.library_assets as asset
        set row_index = asset.row_index + 2
        where asset.library_id = v_library_id
          and asset.row_index >= v_row_index;

      v_action_row_id := gen_random_uuid();
      v_speech_row_id := gen_random_uuid();
      insert into public.library_assets (id, library_id, name, row_index)
      values
        (v_action_row_id, v_library_id, v_speaker, v_row_index),
        (v_speech_row_id, v_library_id, v_speaker, v_row_index + 1);

      insert into public.library_asset_values (asset_id, field_id, value_json)
      values
        (v_action_row_id, v_type_field_id, to_jsonb('3'::text)),
        (v_action_row_id, v_name_field_id, to_jsonb(v_speaker)),
        (v_action_row_id, v_content_field_id, to_jsonb(v_action)),
        (v_speech_row_id, v_type_field_id, to_jsonb(v_speech_type)),
        (v_speech_row_id, v_name_field_id, to_jsonb(v_speaker)),
        (v_speech_row_id, v_content_field_id, to_jsonb(v_dialogue));
    else
      delete from public.library_assets as asset
        where asset.library_id = v_library_id
          and asset.id = any(array_remove(array[v_action_row_id, v_speech_row_id], null));
    end if;

    select library.project_id, library.folder_id
      into v_project_id, v_folder_id
      from public.libraries as library
      where library.id = v_library_id;
    update public.libraries set updated_at = v_now where id = v_library_id;
    update public.projects set updated_at = v_now where id = v_project_id;
    if v_folder_id is not null then
      update public.folders set updated_at = v_now where id = v_folder_id;
    end if;
  end loop;

  return query
    select
      document.collab_epoch,
      document.collab_revision,
      document.yjs_state,
      document.content,
      document.updated_at,
      p_backup_version_id
    from public.documents as document
    where document.id = p_document_id;
end;
$$;

revoke all on function public.replace_document_with_markdown_and_sync_tables(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_document_with_markdown_and_sync_tables(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, jsonb
) to service_role;

comment on function public.replace_document_with_markdown_and_sync_tables(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, jsonb
) is 'Atomically replaces a Script source Document and applies prepared sibling Table mutations.';
