-- Atomically keep a Script source Document, its row order, and plot plan aligned.

create or replace function public.replace_document_with_markdown_and_reorder_script(
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
  p_script_library_id uuid,
  p_expected_order_ids uuid[],
  p_next_order_ids uuid[],
  p_plot_plan jsonb
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
  v_current_order_ids uuid[];
  v_project_id uuid;
  v_folder_id uuid;
  v_now timestamptz := now();
begin
  if p_plot_plan is null or jsonb_typeof(p_plot_plan) <> 'object' then
    raise exception 'PLOT_PLAN_INVALID: plot plan must be an object'
      using errcode = '22023';
  end if;
  if coalesce(cardinality(p_expected_order_ids), 0) = 0
    or cardinality(p_expected_order_ids) <> cardinality(p_next_order_ids)
    or cardinality(p_next_order_ids) <> (
      select count(distinct row_id) from unnest(p_next_order_ids) as row_id
    )
  then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: invalid row order'
      using errcode = 'PT409';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_script_library_id::text, 0));
  select library.project_id, library.folder_id
    into v_project_id, v_folder_id
    from public.libraries as library
    where library.id = p_script_library_id
      and library.source_document_id = p_document_id
      and library.document_export_type = 'script'
    for update;
  if v_project_id is null or not exists (
    select 1 from public.documents as document
    where document.id = p_document_id and document.project_id = v_project_id
  ) then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: Script source relationship changed'
      using errcode = 'PT409';
  end if;

  perform 1
    from public.library_assets as asset
    where asset.library_id = p_script_library_id
    for update;
  select coalesce(
      array_agg(asset.id order by asset.row_index asc nulls last, asset.created_at, asset.id),
      array[]::uuid[]
    )
    into v_current_order_ids
    from public.library_assets as asset
    where asset.library_id = p_script_library_id;
  if v_current_order_ids is distinct from p_expected_order_ids
    or not (
      select coalesce(bool_and(row_id = any(p_expected_order_ids)), false)
      from unnest(p_next_order_ids) as row_id
    )
  then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: Script rows changed'
      using errcode = 'PT409';
  end if;

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

  with next_order as (
    select row_id, ordinality::integer as row_index
    from unnest(p_next_order_ids) with ordinality as ordered(row_id, ordinality)
  )
  update public.library_assets as asset
    set row_index = next_order.row_index
    from next_order
    where asset.id = next_order.row_id
      and asset.library_id = p_script_library_id;

  update public.libraries
    set plot_plan = p_plot_plan, updated_at = v_now
    where id = p_script_library_id;
  update public.projects set updated_at = v_now where id = v_project_id;
  if v_folder_id is not null then
    update public.folders set updated_at = v_now where id = v_folder_id;
  end if;

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

revoke all on function public.replace_document_with_markdown_and_reorder_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text,
  uuid, uuid[], uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.replace_document_with_markdown_and_reorder_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text,
  uuid, uuid[], uuid[], jsonb
) to service_role;

comment on function public.replace_document_with_markdown_and_reorder_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text,
  uuid, uuid[], uuid[], jsonb
) is 'Atomically replaces a Script source Document, reorders Script rows, and persists plot_plan.';

create or replace function public.reconcile_script_library_from_document(
  p_document_id uuid,
  p_actor_user_id uuid,
  p_expected_epoch bigint,
  p_expected_revision bigint,
  p_script_library_id uuid,
  p_operation jsonb,
  p_plot_plan jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation jsonb := p_operation;
  v_operation_type text := p_operation ->> 'type';
  v_project_id uuid;
  v_folder_id uuid;
  v_type_field_id uuid := nullif(p_operation ->> 'typeFieldId', '')::uuid;
  v_name_field_id uuid := nullif(p_operation ->> 'nameFieldId', '')::uuid;
  v_content_field_id uuid := nullif(p_operation ->> 'contentFieldId', '')::uuid;
  v_action_row_id uuid := nullif(p_operation ->> 'actionRowId', '')::uuid;
  v_speech_row_id uuid := nullif(p_operation ->> 'speechRowId', '')::uuid;
  v_after_row_id uuid := nullif(p_operation ->> 'afterRowId', '')::uuid;
  v_expected_order_ids uuid[];
  v_next_order_ids uuid[];
  v_current_order_ids uuid[];
  v_changed_row_ids uuid[];
  v_speaker text := btrim(coalesce(p_operation ->> 'speaker', ''));
  v_action text := coalesce(p_operation ->> 'action', '');
  v_dialogue text := coalesce(p_operation ->> 'dialogue', '');
  v_speech_type text := p_operation ->> 'speechType';
  v_now timestamptz := now();
begin
  if v_operation_type not in ('edit', 'insert', 'delete', 'reorder') then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: unsupported reconciliation'
      using errcode = '22023';
  end if;
  if p_plot_plan is null or jsonb_typeof(p_plot_plan) <> 'object' then
    raise exception 'PLOT_PLAN_INVALID: plot plan must be an object'
      using errcode = '22023';
  end if;

  select document.project_id
    into v_project_id
    from public.documents as document
    where document.id = p_document_id
      and document.collab_epoch = p_expected_epoch
      and document.collab_revision = p_expected_revision
      and not exists (
        select 1 from public.document_yjs_updates as update_row
        where update_row.document_id = document.id
          and update_row.epoch = document.collab_epoch
      )
    for update;
  if v_project_id is null then
    raise exception 'DOCUMENT_CONFLICT: document changed after compaction'
      using errcode = 'PT409';
  end if;
  if not (
    public.is_project_owner(v_project_id, p_actor_user_id)
    or public.is_editor_or_admin_collaborator(v_project_id, p_actor_user_id)
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_script_library_id::text, 0));
  select library.folder_id
    into v_folder_id
    from public.libraries as library
    where library.id = p_script_library_id
      and library.project_id = v_project_id
      and library.source_document_id = p_document_id
      and library.document_export_type = 'script'
    for update;
  if not found then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: Script relationship changed'
      using errcode = 'PT409';
  end if;

  perform 1 from public.library_assets as asset
    where asset.library_id = p_script_library_id for update;

  select coalesce(array_agg(value::uuid order by ordinality), array[]::uuid[])
    into v_expected_order_ids
    from jsonb_array_elements_text(v_operation -> 'expectedOrderIds')
      with ordinality as expected(value, ordinality);
  select coalesce(array_agg(value::uuid order by ordinality), array[]::uuid[])
    into v_next_order_ids
    from jsonb_array_elements_text(v_operation -> 'nextOrderIds')
      with ordinality as next(value, ordinality);
  select coalesce(
      array_agg(asset.id order by asset.row_index asc nulls last, asset.created_at, asset.id),
      array[]::uuid[]
    )
    into v_current_order_ids
    from public.library_assets as asset
    where asset.library_id = p_script_library_id;

  if v_current_order_ids is distinct from v_expected_order_ids
    or cardinality(v_next_order_ids) <> (
      select count(distinct row_id) from unnest(v_next_order_ids) as row_id
    )
  then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: Script rows changed'
      using errcode = 'PT409';
  end if;

  if v_operation_type in ('edit', 'reorder') then
    if cardinality(v_expected_order_ids) <> cardinality(v_next_order_ids)
      or not (
        select coalesce(bool_and(row_id = any(v_expected_order_ids)), true)
        from unnest(v_next_order_ids) as row_id
      )
    then
      raise exception 'PLOT_PLAN_ROW_ORDER_STALE: invalid target rows'
        using errcode = 'PT409';
    end if;
  elsif v_operation_type = 'insert' then
    if v_action_row_id is null
      or v_speech_row_id is null
      or v_action_row_id = v_speech_row_id
      or v_action_row_id = any(v_expected_order_ids)
      or v_speech_row_id = any(v_expected_order_ids)
      or cardinality(v_next_order_ids) <> cardinality(v_expected_order_ids) + 2
      or not (v_action_row_id = any(v_next_order_ids))
      or not (v_speech_row_id = any(v_next_order_ids))
      or not (
        select coalesce(bool_and(
          row_id = any(v_expected_order_ids)
          or row_id = v_action_row_id
          or row_id = v_speech_row_id
        ), true)
        from unnest(v_next_order_ids) as row_id
      )
      or exists (
        select 1 from unnest(v_expected_order_ids) as row_id
        where not (row_id = any(v_next_order_ids))
      )
      or (v_after_row_id is not null and not (v_after_row_id = any(v_expected_order_ids)))
    then
      raise exception 'PLOT_PLAN_ROW_ORDER_STALE: invalid inserted rows'
        using errcode = 'PT409';
    end if;
  else
    v_changed_row_ids := array_remove(array[v_action_row_id, v_speech_row_id], null);
    if cardinality(v_changed_row_ids) = 0
      or cardinality(v_changed_row_ids) <> (
        select count(distinct row_id) from unnest(v_changed_row_ids) as row_id
      )
      or cardinality(v_next_order_ids)
        <> cardinality(v_expected_order_ids) - cardinality(v_changed_row_ids)
      or not (
        select coalesce(bool_and(row_id = any(v_expected_order_ids)), true)
        from unnest(v_next_order_ids) as row_id
      )
      or exists (
        select 1 from unnest(v_changed_row_ids) as row_id
        where not (row_id = any(v_expected_order_ids))
          or row_id = any(v_next_order_ids)
      )
      or exists (
        select 1 from unnest(v_expected_order_ids) as row_id
        where not (row_id = any(v_next_order_ids))
          and not (row_id = any(v_changed_row_ids))
      )
    then
      raise exception 'PLOT_PLAN_ROW_ORDER_STALE: invalid deleted rows'
        using errcode = 'PT409';
    end if;
  end if;

  if v_operation_type <> 'reorder' then
    if (
      select count(*) from public.library_field_definitions as field_definition
      where field_definition.library_id = p_script_library_id
        and field_definition.id = any(array[
          v_type_field_id, v_name_field_id, v_content_field_id
        ])
    ) <> 3 then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: Script fields changed'
        using errcode = 'PT409';
    end if;
  end if;

  if v_operation_type = 'edit' then
    if cardinality(array_remove(array[v_action_row_id, v_speech_row_id], null)) = 0 then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: Script row is missing'
        using errcode = 'PT409';
    end if;

    if v_action_row_id is not null then
      update public.library_assets set name = coalesce(v_operation ->> 'speaker', name)
        where id = v_action_row_id and library_id = p_script_library_id;
      if not found then
        raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: action row changed'
          using errcode = 'PT409';
      end if;
      insert into public.library_asset_values (asset_id, field_id, value_json)
      values
        (v_action_row_id, v_type_field_id, to_jsonb('3'::text)),
        (v_action_row_id, v_name_field_id, to_jsonb(v_operation ->> 'speaker')),
        (v_action_row_id, v_content_field_id, to_jsonb(coalesce(v_operation ->> 'action', '')))
      on conflict (asset_id, field_id) do update set value_json = excluded.value_json;
    end if;
    if v_speech_row_id is not null then
      update public.library_assets set name = coalesce(v_operation ->> 'speaker', name)
        where id = v_speech_row_id and library_id = p_script_library_id;
      if not found then
        raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: speech row changed'
          using errcode = 'PT409';
      end if;
      insert into public.library_asset_values (asset_id, field_id, value_json)
      values
        (v_speech_row_id, v_type_field_id, to_jsonb(v_operation ->> 'speechType')),
        (v_speech_row_id, v_name_field_id, to_jsonb(v_operation ->> 'speaker')),
        (v_speech_row_id, v_content_field_id, to_jsonb(coalesce(v_operation ->> 'dialogue', '')))
        on conflict (asset_id, field_id) do update set value_json = excluded.value_json;
      end if;
  elsif v_operation_type = 'insert' then
    if v_speaker = '' or v_speech_type not in ('1', '2') then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: dialogue values are invalid'
        using errcode = '22023';
    end if;
    insert into public.library_assets (id, library_id, name, row_index)
    values
      (v_action_row_id, p_script_library_id, v_speaker, -2),
      (v_speech_row_id, p_script_library_id, v_speaker, -1);
    insert into public.library_asset_values (asset_id, field_id, value_json)
    values
      (v_action_row_id, v_type_field_id, to_jsonb('3'::text)),
      (v_action_row_id, v_name_field_id, to_jsonb(v_speaker)),
      (v_action_row_id, v_content_field_id, to_jsonb(v_action)),
      (v_speech_row_id, v_type_field_id, to_jsonb(v_speech_type)),
      (v_speech_row_id, v_name_field_id, to_jsonb(v_speaker)),
      (v_speech_row_id, v_content_field_id, to_jsonb(v_dialogue));
  elsif v_operation_type = 'delete' then
    delete from public.library_assets as asset
      where asset.library_id = p_script_library_id
        and asset.id = any(v_changed_row_ids);
  end if;

  with next_order as (
    select row_id, ordinality::integer as row_index
    from unnest(v_next_order_ids) with ordinality as ordered(row_id, ordinality)
  )
  update public.library_assets as asset
    set row_index = next_order.row_index
    from next_order
    where asset.id = next_order.row_id
      and asset.library_id = p_script_library_id;

  update public.libraries
    set plot_plan = p_plot_plan, updated_at = v_now
    where id = p_script_library_id;
  update public.projects set updated_at = v_now where id = v_project_id;
  if v_folder_id is not null then
    update public.folders set updated_at = v_now where id = v_folder_id;
  end if;
end;
$$;

revoke all on function public.reconcile_script_library_from_document(
  uuid, uuid, bigint, bigint, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_script_library_from_document(
  uuid, uuid, bigint, bigint, uuid, jsonb, jsonb
) to service_role;
