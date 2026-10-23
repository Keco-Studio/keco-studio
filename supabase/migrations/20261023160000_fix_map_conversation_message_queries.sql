-- Returned table fields are PL/pgSQL variables. Qualify message table columns
-- so creating a follow-up Plan or attaching a generated Map never resolves
-- `conversation_id` ambiguously.

create or replace function public.create_map_conversation_plan_v1(
  p_project_id uuid,
  p_conversation_id uuid,
  p_parent_plan_node_id uuid,
  p_title text,
  p_message text,
  p_idempotency_key uuid,
  p_intent_hash text,
  p_name text,
  p_source_document_id uuid,
  p_source_document_updated_at timestamptz,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_plan jsonb,
  p_scene jsonb
)
returns table (
  conversation_id uuid, plan_node_id uuid, map_id uuid, draft_revision_id uuid,
  plan_version_id uuid, plan_display_version bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_conversation public.map_conversations%rowtype;
  v_parent public.map_conversation_nodes%rowtype;
  v_request public.map_conversation_requests%rowtype;
  v_created record;
  v_saved record;
  v_sequence bigint;
  v_node_id uuid := gen_random_uuid();
  v_display_version bigint;
begin
  v_user_id := public.map_require_writer(p_project_id);
  if p_idempotency_key is null or p_intent_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid map conversation request identity' using errcode = '22023';
  end if;
  select * into v_request from public.map_conversation_requests
    where project_id = p_project_id and created_by = v_user_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.intent_hash <> p_intent_hash then raise exception 'map conversation idempotency conflict' using errcode = 'KM409'; end if;
    if v_request.plan_node_id is null then raise exception 'map conversation request is incomplete' using errcode = 'KM412'; end if;
    return query select node.conversation_id, node.id, node.map_project_id, version.draft_revision_id,
      node.map_plan_version_id, node.plan_display_version
    from public.map_conversation_nodes as node
    join public.map_plan_versions as version on version.id = node.map_plan_version_id
    where node.id = v_request.plan_node_id;
    return;
  end if;

  if p_conversation_id is null then
    if p_parent_plan_node_id is not null then raise exception 'root Plan cannot have a parent' using errcode = '22023'; end if;
    insert into public.map_conversations (project_id, title, created_by)
      values (p_project_id, btrim(p_title), v_user_id) returning * into v_conversation;
  else
    select * into v_conversation from public.map_conversations where id = p_conversation_id for update;
    if not found or v_conversation.project_id <> p_project_id then raise exception 'map conversation not found' using errcode = 'P0002'; end if;
    if p_parent_plan_node_id is null then raise exception 'follow-up Plan requires a base Plan' using errcode = '22023'; end if;
    select * into v_parent from public.map_conversation_nodes where id = p_parent_plan_node_id;
    if not found or v_parent.node_type <> 'plan' or v_parent.conversation_id <> v_conversation.id then
      raise exception 'base Plan not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.map_conversation_requests (project_id, conversation_id, idempotency_key, intent_hash, created_by)
    values (p_project_id, v_conversation.id, p_idempotency_key, p_intent_hash, v_user_id);
  select coalesce(max(message.sequence_number), 0) + 1 into v_sequence
  from public.map_conversation_messages as message
  where message.conversation_id = v_conversation.id;
  insert into public.map_conversation_messages (conversation_id, sequence_number, role, text, base_plan_node_id, created_by)
    values (v_conversation.id, v_sequence, 'user', btrim(p_message), p_parent_plan_node_id, v_user_id);

  select * into v_created from public.create_map_project_v3(
    p_project_id, p_name, p_source_document_id, p_source_document_updated_at, p_source_epoch, p_source_revision, p_plan, p_scene
  );
  select * into v_saved from public.save_map_plan_v3(v_created.map_id, v_created.draft_revision_id, v_created.save_version);
  if v_saved.status <> 'saved' then raise exception 'map Plan snapshot save conflict' using errcode = 'KM412'; end if;
  update public.map_conversations set next_plan_display_version = next_plan_display_version + 1
    where id = v_conversation.id returning next_plan_display_version - 1 into v_display_version;
  insert into public.map_conversation_nodes (
    id, conversation_id, project_id, node_type, plan_display_version, parent_plan_node_id,
    map_project_id, map_plan_version_id, created_by
  ) values (
    v_node_id, v_conversation.id, p_project_id, 'plan', v_display_version, p_parent_plan_node_id,
    v_created.map_id, v_saved.plan_version_id, v_user_id
  );
  insert into public.map_conversation_messages (conversation_id, sequence_number, role, text, artifact_node_id, created_by)
    values (v_conversation.id, v_sequence + 1, 'assistant', 'Map Plan created', v_node_id, v_user_id);
  update public.map_conversation_requests set plan_node_id = v_node_id
    where project_id = p_project_id and created_by = v_user_id and idempotency_key = p_idempotency_key;
  return query select v_conversation.id, v_node_id, v_created.map_id, v_created.draft_revision_id,
    v_saved.plan_version_id, v_display_version;
end;
$$;

create or replace function public.attach_map_conversation_output_v1(
  p_plan_node_id uuid, p_map_revision_id uuid, p_map_asset_id uuid
)
returns table (map_node_id uuid, plan_display_version bigint, map_version_number bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_plan public.map_conversation_nodes%rowtype;
  v_asset public.map_assets%rowtype;
  v_map_node_id uuid;
  v_sequence bigint;
  v_map_version bigint;
begin
  select * into v_plan from public.map_conversation_nodes where id = p_plan_node_id;
  if not found or v_plan.node_type <> 'plan' then raise exception 'Plan node not found' using errcode = 'P0002'; end if;
  v_user_id := public.map_require_writer(v_plan.project_id);
  select * into v_asset from public.map_assets where id = p_map_asset_id and map_revision_id = p_map_revision_id;
  select map_version_number into v_map_version from public.map_revisions where id = p_map_revision_id and map_project_id = v_plan.map_project_id;
  if v_asset.id is null or v_asset.kind <> 'map_image' or v_map_version is null then
    raise exception 'Map output not found' using errcode = 'P0002';
  end if;
  select id into v_map_node_id from public.map_conversation_nodes
    where parent_plan_node_id = p_plan_node_id and map_revision_id = p_map_revision_id and map_asset_id = p_map_asset_id;
  if v_map_node_id is null then
    v_map_node_id := gen_random_uuid();
    insert into public.map_conversation_nodes (id, conversation_id, project_id, node_type, parent_plan_node_id, map_revision_id, map_asset_id, created_by)
      values (v_map_node_id, v_plan.conversation_id, v_plan.project_id, 'map', p_plan_node_id, p_map_revision_id, p_map_asset_id, v_user_id);
    select coalesce(max(message.sequence_number), 0) + 1 into v_sequence
    from public.map_conversation_messages as message
    where message.conversation_id = v_plan.conversation_id;
    insert into public.map_conversation_messages (conversation_id, sequence_number, role, text, artifact_node_id, created_by)
      values (v_plan.conversation_id, v_sequence, 'assistant', 'Map generated', v_map_node_id, v_user_id);
  end if;
  return query select v_map_node_id, v_plan.plan_display_version, v_map_version;
end;
$$;

notify pgrst, 'reload schema';
