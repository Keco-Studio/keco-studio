-- Durable, per-user undo journal for mutations initiated by the document table.
-- The browser keeps only operation IDs for its current session; snapshots stay
-- server-side for 24 hours so destructive changes can be safely restored.

create table if not exists public.library_table_operations (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'cells_updated', 'rows_created', 'rows_deleted', 'rows_reordered',
    'field_created', 'field_updated', 'field_deleted', 'fields_reordered'
  )),
  forward_payload jsonb not null,
  inverse_payload jsonb not null,
  expected_payload jsonb not null,
  state text not null default 'active' check (state in ('active', 'undone', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists library_table_operations_actor_active_idx
  on public.library_table_operations (created_by, library_id, state, created_at desc);
create index if not exists library_table_operations_expiry_idx
  on public.library_table_operations (expires_at) where state <> 'expired';

alter table public.library_table_operations enable row level security;

drop policy if exists library_table_operations_select_own on public.library_table_operations;
create policy library_table_operations_select_own
  on public.library_table_operations for select to authenticated
  using (created_by = auth.uid());

revoke all on table public.library_table_operations from public, anon, authenticated;
grant select on table public.library_table_operations to authenticated;

create or replace function public.assert_library_table_write_permission(p_library_id uuid)
returns public.libraries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_library
  from public.libraries
  where id = p_library_id
  for update;

  if not found or not (
    public.is_project_owner(v_library.project_id, v_actor)
    or public.is_editor_or_admin_collaborator(v_library.project_id, v_actor)
  ) then
    raise exception 'Table not found or not writable' using errcode = '42501';
  end if;

  return v_library;
end;
$$;

create or replace function public.touch_library_table_operation_parent(p_library public.libraries)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.libraries
  set updated_at = now(), updated_by = auth.uid()
  where id = p_library.id;
  update public.projects set updated_at = now() where id = p_library.project_id;
  if p_library.folder_id is not null then
    update public.folders set updated_at = now() where id = p_library.folder_id;
  end if;
end;
$$;

-- `expected` is deliberately explicit rather than version-number based because
-- asset values do not have independent version columns. Every listed asset,
-- field, and value must still match before an inverse can be applied.
create or replace function public.assert_library_table_operation_expected(
  p_library_id uuid,
  p_expected jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset jsonb;
  v_value jsonb;
  v_field jsonb;
  v_id uuid;
  v_actual jsonb;
  v_value_exists boolean;
begin
  if jsonb_typeof(p_expected) <> 'object' then
    raise exception 'Table operation conflict' using errcode = '40001';
  end if;

  for v_id in select item.value::uuid
    from jsonb_array_elements_text(coalesce(p_expected -> 'assetIdsAbsent', '[]'::jsonb)) as item(value)
  loop
    if exists (select 1 from public.library_assets where id = v_id and library_id = p_library_id) then
      raise exception 'Table operation conflict' using errcode = '40001';
    end if;
  end loop;

  for v_id in select item.value::uuid
    from jsonb_array_elements_text(coalesce(p_expected -> 'fieldIdsAbsent', '[]'::jsonb)) as item(value)
  loop
    if exists (select 1 from public.library_field_definitions where id = v_id and library_id = p_library_id) then
      raise exception 'Table operation conflict' using errcode = '40001';
    end if;
  end loop;

  for v_asset in select value from jsonb_array_elements(coalesce(p_expected -> 'assets', '[]'::jsonb))
  loop
    select jsonb_build_object('name', asset.name, 'rowIndex', asset.row_index)
      into v_actual
    from public.library_assets asset
    where asset.id = (v_asset ->> 'id')::uuid and asset.library_id = p_library_id
    for update;
    if v_actual is null
      or (v_asset ? 'name' and v_actual -> 'name' is distinct from v_asset -> 'name')
      or (v_asset ? 'rowIndex' and v_actual -> 'rowIndex' is distinct from v_asset -> 'rowIndex')
    then
      raise exception 'Table operation conflict' using errcode = '40001';
    end if;

    for v_value in select value from jsonb_array_elements(coalesce(v_asset -> 'values', '[]'::jsonb))
    loop
      select exists(
        select 1 from public.library_asset_values
        where asset_id = (v_asset ->> 'id')::uuid and field_id = (v_value ->> 'fieldId')::uuid
      ) into v_value_exists;
      select value_json into v_actual
      from public.library_asset_values
      where asset_id = (v_asset ->> 'id')::uuid and field_id = (v_value ->> 'fieldId')::uuid
      for update;
      if coalesce((v_value ->> 'present')::boolean, true) then
        if not v_value_exists or v_actual is distinct from v_value -> 'value' then
          raise exception 'Table operation conflict' using errcode = '40001';
        end if;
      elsif v_value_exists then
        raise exception 'Table operation conflict' using errcode = '40001';
      end if;
    end loop;
  end loop;

  for v_field in select value from jsonb_array_elements(coalesce(p_expected -> 'fields', '[]'::jsonb))
  loop
    select jsonb_build_object(
      'label', field.label,
      'dataType', field.data_type,
      'description', field.description,
      'formulaExpression', field.formula_expression,
      'orderIndex', field.order_index,
      'required', field.required,
      'enumOptions', to_jsonb(field.enum_options),
      'referenceLibraries', to_jsonb(field.reference_libraries)
    ) into v_actual
    from public.library_field_definitions field
    where field.id = (v_field ->> 'id')::uuid and field.library_id = p_library_id
    for update;
    if v_actual is null then
      raise exception 'Table operation conflict' using errcode = '40001';
    end if;
    if (v_field ? 'label' and v_actual -> 'label' is distinct from v_field -> 'label')
      or (v_field ? 'dataType' and v_actual -> 'dataType' is distinct from v_field -> 'dataType')
      or (v_field ? 'description' and v_actual -> 'description' is distinct from v_field -> 'description')
      or (v_field ? 'formulaExpression' and v_actual -> 'formulaExpression' is distinct from v_field -> 'formulaExpression')
      or (v_field ? 'orderIndex' and v_actual -> 'orderIndex' is distinct from v_field -> 'orderIndex')
      or (v_field ? 'required' and v_actual -> 'required' is distinct from v_field -> 'required')
      or (v_field ? 'enumOptions' and v_actual -> 'enumOptions' is distinct from v_field -> 'enumOptions')
      or (v_field ? 'referenceLibraries' and v_actual -> 'referenceLibraries' is distinct from v_field -> 'referenceLibraries')
    then
      raise exception 'Table operation conflict' using errcode = '40001';
    end if;
  end loop;
end;
$$;

create or replace function public.apply_library_table_asset_snapshot(
  p_library_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_values jsonb;
begin
  for v_row in select value from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]'::jsonb))
  loop
    insert into public.library_assets (id, library_id, name, created_at, row_index)
    values (
      (v_row ->> 'id')::uuid,
      p_library_id,
      coalesce(v_row ->> 'name', ''),
      coalesce((v_row ->> 'createdAt')::timestamptz, now()),
      (v_row ->> 'rowIndex')::integer
    )
    on conflict (id) do update set
      name = excluded.name,
      created_at = excluded.created_at,
      row_index = excluded.row_index;

    delete from public.library_asset_values
    where asset_id = (v_row ->> 'id')::uuid;
    v_values := coalesce(v_row -> 'values', '{}'::jsonb);
    insert into public.library_asset_values (asset_id, field_id, value_json)
    select (v_row ->> 'id')::uuid, key::uuid, value
    from jsonb_each(v_values);
  end loop;
end;
$$;

create or replace function public.delete_library_table_asset_snapshot(
  p_library_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.library_assets asset
  where asset.library_id = p_library_id
    and asset.id in (
      select (row ->> 'id')::uuid
      from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]'::jsonb)) row
    );
end;
$$;

create or replace function public.apply_library_table_cells_snapshot(
  p_library_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset jsonb;
  v_value jsonb;
begin
  for v_asset in select value from jsonb_array_elements(coalesce(p_payload -> 'assets', '[]'::jsonb))
  loop
    if v_asset ? 'name' then
      update public.library_assets set name = v_asset ->> 'name'
      where id = (v_asset ->> 'id')::uuid and library_id = p_library_id;
    end if;
    if v_asset ? 'rowIndex' then
      update public.library_assets set row_index = (v_asset ->> 'rowIndex')::integer
      where id = (v_asset ->> 'id')::uuid and library_id = p_library_id;
    end if;
    for v_value in select value from jsonb_array_elements(coalesce(v_asset -> 'values', '[]'::jsonb))
    loop
      if coalesce((v_value ->> 'present')::boolean, true) then
        insert into public.library_asset_values (asset_id, field_id, value_json)
        values ((v_asset ->> 'id')::uuid, (v_value ->> 'fieldId')::uuid, v_value -> 'value')
        on conflict (asset_id, field_id) do update set value_json = excluded.value_json;
      else
        delete from public.library_asset_values
        where asset_id = (v_asset ->> 'id')::uuid and field_id = (v_value ->> 'fieldId')::uuid;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.apply_library_table_field_snapshot(
  p_library_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field jsonb;
  v_value jsonb;
begin
  for v_field in select value from jsonb_array_elements(coalesce(p_payload -> 'fields', '[]'::jsonb))
  loop
    insert into public.library_field_definitions (
      id, library_id, section_id, section, label, description, data_type,
      formula_expression, required, order_index, enum_options, reference_libraries
    ) values (
      (v_field ->> 'id')::uuid, p_library_id,
      coalesce(v_field ->> 'sectionId', p_library_id::text || '::main'),
      coalesce(v_field ->> 'section', 'main'),
      v_field ->> 'label',
      nullif(v_field ->> 'description', ''),
      v_field ->> 'dataType',
      nullif(v_field ->> 'formulaExpression', ''),
      coalesce((v_field ->> 'required')::boolean, false),
      case when p_payload ? 'orderedIds' then -1 else coalesce((v_field ->> 'orderIndex')::integer, 0) end,
      case when jsonb_typeof(v_field -> 'enumOptions') = 'array'
        then array(select jsonb_array_elements_text(v_field -> 'enumOptions')) else null end,
      case when jsonb_typeof(v_field -> 'referenceLibraries') = 'array'
        then array(select jsonb_array_elements_text(v_field -> 'referenceLibraries')::uuid) else null end
    ) on conflict (id) do update set
      label = excluded.label, description = excluded.description, data_type = excluded.data_type,
      formula_expression = excluded.formula_expression, required = excluded.required,
      enum_options = excluded.enum_options,
      reference_libraries = excluded.reference_libraries;
  end loop;

  -- Field deletion cascades these values. They are retained in the inverse
  -- snapshot and restored after definitions so their original IDs survive.
  for v_value in select value from jsonb_array_elements(coalesce(p_payload -> 'assetValues', '[]'::jsonb))
  loop
    insert into public.library_asset_values (asset_id, field_id, value_json)
    select (v_value ->> 'assetId')::uuid, (v_value ->> 'fieldId')::uuid, v_value -> 'value'
    where exists (
      select 1 from public.library_assets
      where id = (v_value ->> 'assetId')::uuid and library_id = p_library_id
    )
    on conflict (asset_id, field_id) do update set value_json = excluded.value_json;
  end loop;
end;
$$;

create or replace function public.delete_library_table_field_snapshot(
  p_library_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.library_field_definitions field
  where field.library_id = p_library_id
    and field.id in (
      select (item ->> 'id')::uuid
      from jsonb_array_elements(coalesce(p_payload -> 'fields', '[]'::jsonb)) item
    );
end;
$$;

create or replace function public.apply_library_table_order_snapshot(
  p_library_id uuid,
  p_payload jsonb,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'rows_reordered' then
    update public.library_assets asset
    set row_index = item.ordinality::integer
    from jsonb_array_elements_text(coalesce(p_payload -> 'orderedIds', '[]'::jsonb))
      with ordinality as item(id, ordinality)
    where asset.id = item.id::uuid and asset.library_id = p_library_id;
  else
    update public.library_field_definitions field
    set order_index = -field.order_index - 1
    where field.library_id = p_library_id;
    update public.library_field_definitions field
    set order_index = item.ordinality::integer - 1
    from jsonb_array_elements_text(coalesce(p_payload -> 'orderedIds', '[]'::jsonb))
      with ordinality as item(id, ordinality)
    where field.id = item.id::uuid and field.library_id = p_library_id;
  end if;
end;
$$;

create or replace function public.apply_library_table_operation_payload(
  p_library_id uuid,
  p_kind text,
  p_payload jsonb,
  p_inverse boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_kind
    when 'cells_updated' then perform public.apply_library_table_cells_snapshot(p_library_id, p_payload);
    when 'rows_created' then
      if p_inverse then perform public.delete_library_table_asset_snapshot(p_library_id, p_payload);
      else perform public.apply_library_table_asset_snapshot(p_library_id, p_payload); end if;
      if p_payload ? 'rowIndexUpdates' then
        perform public.apply_library_table_cells_snapshot(
          p_library_id,
          jsonb_build_object('assets', p_payload -> 'rowIndexUpdates')
        );
      end if;
    when 'rows_deleted' then
      if p_inverse then perform public.apply_library_table_asset_snapshot(p_library_id, p_payload);
      else perform public.delete_library_table_asset_snapshot(p_library_id, p_payload); end if;
    when 'field_created' then
      if p_inverse then
        perform public.delete_library_table_field_snapshot(p_library_id, p_payload);
      else
        perform public.apply_library_table_field_snapshot(p_library_id, p_payload);
      end if;
      if p_payload ? 'orderedIds' then
        perform public.apply_library_table_order_snapshot(p_library_id, p_payload, 'fields_reordered');
      end if;
    when 'field_deleted' then
      if p_inverse then perform public.apply_library_table_field_snapshot(p_library_id, p_payload);
      else perform public.delete_library_table_field_snapshot(p_library_id, p_payload); end if;
    when 'field_updated' then perform public.apply_library_table_field_snapshot(p_library_id, p_payload);
    when 'rows_reordered', 'fields_reordered' then perform public.apply_library_table_order_snapshot(p_library_id, p_payload, p_kind);
    else raise exception 'Unsupported table operation' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.apply_library_table_operation(
  p_library_id uuid,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_actor uuid := auth.uid();
  v_operation public.library_table_operations%rowtype;
  v_kind text := p_operation ->> 'kind';
begin
  if jsonb_typeof(p_operation) <> 'object'
    or v_kind is null
    or jsonb_typeof(p_operation -> 'forward') <> 'object'
    or jsonb_typeof(p_operation -> 'inverse') <> 'object'
    or jsonb_typeof(p_operation -> 'expected') <> 'object'
  then
    raise exception 'Invalid table operation' using errcode = '22023';
  end if;
  v_library := public.assert_library_table_write_permission(p_library_id);
  perform public.assert_library_table_operation_expected(p_library_id, p_operation -> 'expected' -> 'before');
  perform public.apply_library_table_operation_payload(p_library_id, v_kind, p_operation -> 'forward');
  insert into public.library_table_operations (
    library_id, created_by, kind, forward_payload, inverse_payload, expected_payload
  ) values (
    p_library_id, v_actor, v_kind, p_operation -> 'forward', p_operation -> 'inverse', p_operation -> 'expected'
  ) returning * into v_operation;
  perform public.touch_library_table_operation_parent(v_library);
  return jsonb_build_object(
    'operationId', v_operation.id, 'kind', v_operation.kind, 'state', v_operation.state,
    'affectedAssetIds', coalesce(v_operation.forward_payload -> 'affectedAssetIds', '[]'::jsonb),
    'schemaChanged', v_operation.kind like 'field%'
  );
end;
$$;

create or replace function public.undo_library_table_operation(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_actor uuid := auth.uid();
  v_operation public.library_table_operations%rowtype;
begin
  select * into v_operation from public.library_table_operations
  where id = p_operation_id and created_by = v_actor for update;
  if not found then raise exception 'Table operation not found' using errcode = '42501'; end if;
  if v_operation.state <> 'active' or v_operation.expires_at <= now() then
    raise exception 'Table operation is no longer undoable' using errcode = '22023';
  end if;
  v_library := public.assert_library_table_write_permission(v_operation.library_id);
  perform public.assert_library_table_operation_expected(v_operation.library_id, v_operation.expected_payload -> 'after');
  perform public.apply_library_table_operation_payload(v_operation.library_id, v_operation.kind, v_operation.inverse_payload, true);
  update public.library_table_operations set state = 'undone' where id = v_operation.id;
  perform public.touch_library_table_operation_parent(v_library);
  return jsonb_build_object('operationId', v_operation.id, 'kind', v_operation.kind, 'state', 'undone',
    'affectedAssetIds', coalesce(v_operation.inverse_payload -> 'affectedAssetIds', '[]'::jsonb),
    'schemaChanged', v_operation.kind like 'field%');
end;
$$;

create or replace function public.redo_library_table_operation(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_library public.libraries%rowtype;
  v_actor uuid := auth.uid();
  v_operation public.library_table_operations%rowtype;
begin
  select * into v_operation from public.library_table_operations
  where id = p_operation_id and created_by = v_actor for update;
  if not found then raise exception 'Table operation not found' using errcode = '42501'; end if;
  if v_operation.state <> 'undone' or v_operation.expires_at <= now() then
    raise exception 'Table operation is no longer redoable' using errcode = '22023';
  end if;
  v_library := public.assert_library_table_write_permission(v_operation.library_id);
  perform public.assert_library_table_operation_expected(v_operation.library_id, v_operation.expected_payload -> 'before');
  perform public.apply_library_table_operation_payload(v_operation.library_id, v_operation.kind, v_operation.forward_payload);
  update public.library_table_operations set state = 'active' where id = v_operation.id;
  perform public.touch_library_table_operation_parent(v_library);
  return jsonb_build_object('operationId', v_operation.id, 'kind', v_operation.kind, 'state', 'active',
    'affectedAssetIds', coalesce(v_operation.forward_payload -> 'affectedAssetIds', '[]'::jsonb),
    'schemaChanged', v_operation.kind like 'field%');
end;
$$;

-- Returns storage paths that are no longer retained by any non-expired
-- operation. A trusted server worker performs object deletion and accounting.
create or replace function public.expire_library_table_operations(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths jsonb := '[]'::jsonb;
begin
  with expired as (
    select id, forward_payload, inverse_payload
    from public.library_table_operations
    where state <> 'expired' and expires_at <= now()
    order by expires_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ), marked as (
    update public.library_table_operations operation
    set
      state = 'expired',
      -- After expiry, retain only the paths orphaned by the final state. An
      -- active operation orphaned its forward paths; an undone operation
      -- orphaned the paths created by its forward mutation.
      forward_payload = jsonb_set(
        operation.forward_payload,
        '{deferredMediaPaths}',
        case when operation.state = 'active'
          then coalesce(operation.forward_payload -> 'deferredMediaPaths', '[]'::jsonb)
          else coalesce(operation.inverse_payload -> 'deferredMediaPaths', '[]'::jsonb)
        end,
        true
      ),
      inverse_payload = '{}'::jsonb
    from expired
    where operation.id = expired.id
    returning operation.forward_payload, operation.inverse_payload
  ), existing_expired as (
    -- A storage failure leaves the path in an expired operation. Returning it
    -- again makes cleanup retryable; the completion RPC clears it only after
    -- object removal and storage-accounting settlement both succeed.
    select forward_payload, inverse_payload
    from public.library_table_operations
    where state = 'expired'
      and (jsonb_array_length(coalesce(forward_payload -> 'deferredMediaPaths', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(inverse_payload -> 'deferredMediaPaths', '[]'::jsonb)) > 0)
    order by expires_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), candidates as (
    select jsonb_array_elements_text(coalesce(forward_payload -> 'deferredMediaPaths', '[]'::jsonb)) as path from marked
    union
    select jsonb_array_elements_text(coalesce(inverse_payload -> 'deferredMediaPaths', '[]'::jsonb)) as path from marked
    union
    select jsonb_array_elements_text(coalesce(forward_payload -> 'deferredMediaPaths', '[]'::jsonb)) as path from existing_expired
    union
    select jsonb_array_elements_text(coalesce(inverse_payload -> 'deferredMediaPaths', '[]'::jsonb)) as path from existing_expired
  )
  select coalesce(jsonb_agg(path), '[]'::jsonb) into v_paths from candidates candidate
  where not exists (
    select 1 from public.library_table_operations retained
    where retained.state <> 'expired' and retained.expires_at > now()
      and (retained.forward_payload -> 'deferredMediaPaths') ? candidate.path
  );
  return jsonb_build_object('releasedMediaPaths', v_paths);
end;
$$;

create or replace function public.complete_library_table_operation_media_cleanup(p_paths jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if jsonb_typeof(p_paths) <> 'array' then
    raise exception 'Cleanup paths must be an array' using errcode = '22023';
  end if;
  for v_path in select value from jsonb_array_elements_text(p_paths) as item(value)
  loop
    update public.library_table_operations
    set
      forward_payload = jsonb_set(
        forward_payload,
        '{deferredMediaPaths}',
        coalesce((
          select jsonb_agg(value)
          from jsonb_array_elements_text(coalesce(forward_payload -> 'deferredMediaPaths', '[]'::jsonb)) as item(value)
          where value <> v_path
        ), '[]'::jsonb),
        true
      ),
      inverse_payload = jsonb_set(
        inverse_payload,
        '{deferredMediaPaths}',
        coalesce((
          select jsonb_agg(value)
          from jsonb_array_elements_text(coalesce(inverse_payload -> 'deferredMediaPaths', '[]'::jsonb)) as item(value)
          where value <> v_path
        ), '[]'::jsonb),
        true
      )
    where state = 'expired';
  end loop;
end;
$$;

revoke all on function public.assert_library_table_write_permission(uuid) from public;
revoke all on function public.touch_library_table_operation_parent(public.libraries) from public;
revoke all on function public.assert_library_table_operation_expected(uuid, jsonb) from public;
revoke all on function public.apply_library_table_asset_snapshot(uuid, jsonb) from public;
revoke all on function public.delete_library_table_asset_snapshot(uuid, jsonb) from public;
revoke all on function public.apply_library_table_cells_snapshot(uuid, jsonb) from public;
revoke all on function public.apply_library_table_field_snapshot(uuid, jsonb) from public;
revoke all on function public.delete_library_table_field_snapshot(uuid, jsonb) from public;
revoke all on function public.apply_library_table_order_snapshot(uuid, jsonb, text) from public;
revoke all on function public.apply_library_table_operation_payload(uuid, text, jsonb, boolean) from public;
revoke all on function public.apply_library_table_operation(uuid, jsonb) from public;
revoke all on function public.undo_library_table_operation(uuid) from public;
revoke all on function public.redo_library_table_operation(uuid) from public;
revoke all on function public.expire_library_table_operations(integer) from public;
revoke all on function public.complete_library_table_operation_media_cleanup(jsonb) from public;

grant execute on function public.apply_library_table_operation(uuid, jsonb) to authenticated;
grant execute on function public.undo_library_table_operation(uuid) to authenticated;
grant execute on function public.redo_library_table_operation(uuid) to authenticated;
grant execute on function public.expire_library_table_operations(integer) to service_role;
grant execute on function public.complete_library_table_operation_media_cleanup(jsonb) to service_role;
