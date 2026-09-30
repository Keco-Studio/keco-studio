-- Assistant dialogue writes include the origin Script in the existing Document/table
-- transaction. Lock and compare its complete row preimage before replacement.
create or replace function public.script_dialogue_origin_snapshot(p_library_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', asset.id,
      'name', asset.name,
      'rowIndex', asset.row_index,
      'propertyValues', (
        select coalesce(jsonb_object_agg(value.field_id, value.value_json), '{}'::jsonb)
        from public.library_asset_values as value
        where value.asset_id = asset.id
      )
    ) order by asset.row_index nulls last, asset.created_at, asset.id
  ), '[]'::jsonb)
  from public.library_assets as asset
  where asset.library_id = p_library_id;
$$;

revoke all on function public.script_dialogue_origin_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.script_dialogue_origin_snapshot(uuid) to service_role;

create or replace function public.script_dialogue_origin_fingerprint(p_library_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select md5(public.script_dialogue_origin_snapshot(p_library_id)::text);
$$;

revoke all on function public.script_dialogue_origin_fingerprint(uuid) from public, anon, authenticated;
grant execute on function public.script_dialogue_origin_fingerprint(uuid) to service_role;

create or replace function public.replace_document_with_markdown_and_sync_origin_script(
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
  p_derived_table_operations jsonb,
  p_origin_script_library_id uuid,
  p_expected_origin_fingerprint text
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
begin
  if p_expected_origin_fingerprint is null
    or p_expected_origin_fingerprint !~ '^[a-f0-9]{32}$'
    or not exists (
      select 1 from public.libraries as library
      where library.id = p_origin_script_library_id
        and library.source_document_id = p_document_id
        and library.document_export_type = 'script'
    )
    or not exists (
      select 1 from jsonb_array_elements(p_derived_table_operations) as operation(value)
      where operation.value ->> 'libraryId' = p_origin_script_library_id::text
    )
    or exists (
      select 1 from jsonb_array_elements(p_derived_table_operations) as operation(value)
      where operation.value ->> 'type' <> 'edit'
    )
  then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: origin Script changed'
      using errcode = 'PT409';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_origin_script_library_id::text, 0));
  perform 1 from public.libraries as library
    where library.id = p_origin_script_library_id for update;
  perform 1 from public.library_assets as asset
    where asset.library_id = p_origin_script_library_id
    order by asset.id for update;
  perform 1 from public.library_asset_values as value
    join public.library_assets as asset on asset.id = value.asset_id
    where asset.library_id = p_origin_script_library_id
    order by value.asset_id, value.field_id for update of value;

  if public.script_dialogue_origin_fingerprint(p_origin_script_library_id)
    is distinct from p_expected_origin_fingerprint
  then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: origin Script rows changed'
      using errcode = 'PT409';
  end if;

  return query select * from public.replace_document_with_markdown_and_sync_tables(
    p_document_id, p_actor_user_id, p_backup_version_id,
    p_expected_epoch, p_expected_revision, p_included_update_ids,
    p_current_yjs_state, p_current_markdown,
    p_replacement_yjs_state, p_replacement_markdown,
    p_derived_table_operations
  );
end;
$$;

revoke all on function public.replace_document_with_markdown_and_sync_origin_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.replace_document_with_markdown_and_sync_origin_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text, jsonb, uuid, text
) to service_role;
