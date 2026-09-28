-- An Agent Script mutation is one Document replacement, row reconciliation, and
-- plot-plan update. Receipts make retries and exact, immediate undo durable.
create table public.agent_script_dialogue_mutations (
  idempotency_key uuid primary key,
  actor_user_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  library_id uuid not null,
  request_hash text not null,
  operation jsonb not null,
  undo_payload jsonb not null,
  before_markdown text not null,
  after_markdown text not null,
  before_plot_plan jsonb not null,
  after_plot_plan jsonb not null,
  result_fingerprint text not null,
  result_epoch bigint not null,
  result_revision bigint not null,
  result_yjs_state text not null,
  result_content text not null,
  result_updated_at timestamptz not null,
  backup_version_id uuid not null,
  undo_of uuid references public.agent_script_dialogue_mutations(idempotency_key),
  undone_by uuid references public.agent_script_dialogue_mutations(idempotency_key),
  created_at timestamptz not null default now()
);

create unique index agent_script_dialogue_mutations_one_undo
  on public.agent_script_dialogue_mutations (undo_of) where undo_of is not null;
alter table public.agent_script_dialogue_mutations enable row level security;
revoke all on public.agent_script_dialogue_mutations from public, anon, authenticated;
grant select, insert, update on public.agent_script_dialogue_mutations to service_role;

create function public.agent_prepare_script_edit_row_shape(
  p_library_id uuid,
  p_operation jsonb,
  p_prior_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_create_action uuid := nullif(p_operation ->> 'createActionRowId', '')::uuid;
  v_create_speech uuid := nullif(p_operation ->> 'createSpeechRowId', '')::uuid;
  v_delete_action uuid := nullif(p_operation ->> 'deleteActionRowId', '')::uuid;
  v_delete_speech uuid := nullif(p_operation ->> 'deleteSpeechRowId', '')::uuid;
  v_expected uuid[];
  v_next uuid[];
  v_current uuid[];
  v_target uuid[];
  v_new_id uuid;
  v_deleted_id uuid;
  v_anchor_id uuid;
  v_anchor_index integer;
  v_count integer;
  v_speaker text := btrim(coalesce(p_operation ->> 'speaker', ''));
begin
  v_count := (v_create_action is not null)::integer + (v_create_speech is not null)::integer
    + (v_delete_action is not null)::integer + (v_delete_speech is not null)::integer;
  if v_count = 0 then return p_operation; end if;
  if v_count <> 1 or p_operation ->> 'type' <> 'edit'
    or jsonb_typeof(p_operation -> 'expectedOrderIds') <> 'array'
    or jsonb_typeof(p_operation -> 'nextOrderIds') <> 'array'
    or v_speaker = '' then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: invalid Script row shape'
      using errcode = '22023';
  end if;
  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
    into v_expected from jsonb_array_elements_text(p_operation -> 'expectedOrderIds')
    with ordinality as entry(value, ordinality);
  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
    into v_next from jsonb_array_elements_text(p_operation -> 'nextOrderIds')
    with ordinality as entry(value, ordinality);
  select coalesce(array_agg(asset.id order by asset.row_index asc nulls last,
      asset.created_at, asset.id), '{}'::uuid[])
    into v_current from public.library_assets as asset where asset.library_id = p_library_id;
  if v_current is distinct from v_expected then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: Script rows changed'
      using errcode = 'PT409';
  end if;

  if v_create_action is not null or v_create_speech is not null then
    if p_prior_operation is not null then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: undo cannot create a row'
        using errcode = '22023';
    end if;
    v_new_id := coalesce(v_create_action, v_create_speech);
    v_anchor_id := case when v_create_action is not null
      then nullif(p_operation ->> 'speechRowId', '')::uuid
      else nullif(p_operation ->> 'actionRowId', '')::uuid end;
    v_anchor_index := array_position(v_expected, v_anchor_id);
    if v_anchor_index is null or v_new_id = any(v_expected)
      or (v_create_action is not null and (
        nullif(p_operation ->> 'actionRowId', '')::uuid is distinct from v_new_id
        or btrim(coalesce(p_operation ->> 'action', '')) = ''))
      or (v_create_speech is not null and (
        nullif(p_operation ->> 'speechRowId', '')::uuid is distinct from v_new_id
        or btrim(coalesce(p_operation ->> 'dialogue', '')) = ''
        or p_operation ->> 'speechType' not in ('1', '2'))) then
      raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: invalid inserted Script row'
        using errcode = 'PT409';
    end if;
    v_target := case when v_create_action is not null
      then coalesce(v_expected[1:v_anchor_index - 1], '{}'::uuid[]) || array[v_new_id]
        || coalesce(v_expected[v_anchor_index:cardinality(v_expected)], '{}'::uuid[])
      else coalesce(v_expected[1:v_anchor_index], '{}'::uuid[]) || array[v_new_id]
        || coalesce(v_expected[v_anchor_index + 1:cardinality(v_expected)], '{}'::uuid[])
      end;
    if v_target is distinct from v_next then
      raise exception 'PLOT_PLAN_ROW_ORDER_STALE: inserted Script row position changed'
        using errcode = 'PT409';
    end if;
    update public.library_assets as asset
      set row_index = ordered.ordinality::integer
      from unnest(v_expected) with ordinality as ordered(id, ordinality)
      where asset.id = ordered.id and asset.library_id = p_library_id;
    insert into public.library_assets (id, library_id, name, row_index)
    values (v_new_id, p_library_id, v_speaker, cardinality(v_expected) + 1);
    return jsonb_set(p_operation, '{expectedOrderIds}',
      to_jsonb(v_expected || array[v_new_id]));
  end if;

  v_deleted_id := coalesce(v_delete_action, v_delete_speech);
  if p_prior_operation is null
    or (v_delete_action is not null and (
      nullif(p_prior_operation ->> 'createActionRowId', '')::uuid is distinct from v_deleted_id
      or p_operation ->> 'actionRowId' is not null))
    or (v_delete_speech is not null and (
      nullif(p_prior_operation ->> 'createSpeechRowId', '')::uuid is distinct from v_deleted_id
      or p_operation ->> 'speechRowId' is not null))
    or not (v_deleted_id = any(v_expected))
    or v_next is distinct from array_remove(v_expected, v_deleted_id) then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: invalid deleted Script row'
      using errcode = 'PT409';
  end if;
  delete from public.library_assets as asset
    where asset.id = v_deleted_id and asset.library_id = p_library_id;
  if not found then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: inserted Script row disappeared'
      using errcode = 'PT409';
  end if;
  return jsonb_set(p_operation, '{expectedOrderIds}', to_jsonb(v_next));
end;
$$;

revoke all on function public.agent_prepare_script_edit_row_shape(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_prepare_script_edit_row_shape(uuid, jsonb, jsonb)
  to service_role;

create function public.replace_document_and_reconcile_agent_script(
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
  p_expected_origin_fingerprint text,
  p_expected_plot_plan jsonb,
  p_operation jsonb,
  p_plot_plan jsonb,
  p_sibling_table_operations jsonb,
  p_idempotency_key uuid,
  p_request_hash text,
  p_undo_payload jsonb,
  p_undo_of uuid default null
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
  v_project_id uuid;
  v_receipt public.agent_script_dialogue_mutations%rowtype;
  v_prior public.agent_script_dialogue_mutations%rowtype;
  v_replaced record;
  v_fingerprint text;
  v_effective_operation jsonb;
begin
  select document.project_id into v_project_id
    from public.documents as document where document.id = p_document_id;
  if v_project_id is null or not (
    public.is_project_owner(v_project_id, p_actor_user_id)
    or public.is_editor_or_admin_collaborator(v_project_id, p_actor_user_id)
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_receipt from public.agent_script_dialogue_mutations
    where idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.actor_user_id <> p_actor_user_id
      or v_receipt.project_id <> v_project_id
      or v_receipt.library_id <> p_script_library_id
      or v_receipt.document_id <> p_document_id
      or v_receipt.request_hash <> p_request_hash
    then
      raise exception 'IDEMPOTENCY_CONFLICT: key belongs to another Script action'
        using errcode = 'PT409';
    end if;
    return query select v_receipt.result_epoch, v_receipt.result_revision,
      v_receipt.result_yjs_state, v_receipt.result_content,
      v_receipt.result_updated_at, v_receipt.backup_version_id;
    return;
  end if;

  if p_operation ->> 'type' not in ('insert', 'delete', 'edit', 'reorder')
    or p_expected_origin_fingerprint !~ '^[a-f0-9]{32}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_expected_plot_plan is null
    or p_plot_plan is null
    or p_undo_payload is null
    or p_sibling_table_operations is null
    or jsonb_typeof(p_sibling_table_operations) <> 'array'
  then
    raise exception 'DERIVED_TABLE_MAPPING_AMBIGUOUS: invalid Script operation'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_script_library_id::text, 0));
  perform 1 from public.libraries as library
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
    where asset.library_id = p_script_library_id order by asset.id for update;
  perform 1 from public.library_asset_values as value
    join public.library_assets as asset on asset.id = value.asset_id
    where asset.library_id = p_script_library_id
    order by value.asset_id, value.field_id for update of value;

  if public.script_dialogue_origin_fingerprint(p_script_library_id)
      is distinct from p_expected_origin_fingerprint
    or (select library.plot_plan from public.libraries as library
        where library.id = p_script_library_id) is distinct from p_expected_plot_plan
  then
    raise exception 'PLOT_PLAN_ROW_ORDER_STALE: Script changed'
      using errcode = 'PT409';
  end if;

  if p_undo_of is not null then
    select * into v_prior from public.agent_script_dialogue_mutations
      where idempotency_key = p_undo_of for update;
    if not found or v_prior.actor_user_id <> p_actor_user_id
      or v_prior.library_id <> p_script_library_id
      or v_prior.document_id <> p_document_id
      or v_prior.undone_by is not null
      or v_prior.undo_of is not null
      or v_prior.result_epoch <> p_expected_epoch
      or v_prior.result_revision <> p_expected_revision
      or v_prior.result_fingerprint <> p_expected_origin_fingerprint
      or v_prior.after_plot_plan is distinct from p_expected_plot_plan
      or v_prior.after_markdown is distinct from p_current_markdown
    then
      raise exception 'DOCUMENT_CONFLICT: Script undo is no longer current'
        using errcode = 'PT409';
    end if;
  end if;

  v_effective_operation := public.agent_prepare_script_edit_row_shape(
    p_script_library_id, p_operation, v_prior.operation
  );

  select * into v_replaced
    from public.replace_document_with_markdown_and_sync_tables(
      p_document_id, p_actor_user_id, p_backup_version_id,
      p_expected_epoch, p_expected_revision, p_included_update_ids,
      p_current_yjs_state, p_current_markdown,
      p_replacement_yjs_state, p_replacement_markdown,
      p_sibling_table_operations
    );

  perform public.reconcile_script_library_from_document(
    p_document_id, p_actor_user_id, v_replaced.collab_epoch,
    v_replaced.collab_revision, p_script_library_id, v_effective_operation, p_plot_plan
  );
  v_fingerprint := public.script_dialogue_origin_fingerprint(p_script_library_id);

  insert into public.agent_script_dialogue_mutations (
    idempotency_key, actor_user_id, project_id, document_id, library_id,
    request_hash, operation, undo_payload, before_markdown, after_markdown,
    before_plot_plan, after_plot_plan, result_fingerprint, result_epoch,
    result_revision, result_yjs_state, result_content, result_updated_at,
    backup_version_id, undo_of
  ) values (
    p_idempotency_key, p_actor_user_id, v_project_id, p_document_id,
    p_script_library_id, p_request_hash, p_operation, p_undo_payload,
    p_current_markdown, p_replacement_markdown, p_expected_plot_plan,
    p_plot_plan, v_fingerprint, v_replaced.collab_epoch,
    v_replaced.collab_revision, v_replaced.yjs_state, v_replaced.content,
    v_replaced.updated_at, p_backup_version_id, p_undo_of
  );
  if p_undo_of is not null then
    update public.agent_script_dialogue_mutations
      set undone_by = p_idempotency_key where idempotency_key = p_undo_of;
  end if;

  return query select v_replaced.collab_epoch, v_replaced.collab_revision,
    v_replaced.yjs_state, v_replaced.content, v_replaced.updated_at,
    p_backup_version_id;
end;
$$;

revoke all on function public.replace_document_and_reconcile_agent_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text,
  uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.replace_document_and_reconcile_agent_script(
  uuid, uuid, uuid, bigint, bigint, uuid[], text, text, text, text,
  uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb, uuid
) to service_role;
