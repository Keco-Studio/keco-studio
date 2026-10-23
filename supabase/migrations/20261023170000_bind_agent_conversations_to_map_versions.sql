-- Keep Map Plans and generated Map assets in the Agent conversation that
-- requested them. The Map records stay durable even if the chat is removed.

alter table public.map_conversations
  add column if not exists agent_conversation_id uuid
    references public.agent_conversations(id) on delete set null;

create unique index if not exists map_conversations_agent_conversation_id_idx
  on public.map_conversations(agent_conversation_id);

create function public.read_agent_map_conversation_v1(
  p_project_id uuid,
  p_agent_conversation_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_agent public.agent_conversations%rowtype;
  v_map_conversation public.map_conversations%rowtype;
begin
  select * into v_agent
    from public.agent_conversations
    where id = p_agent_conversation_id
      and (project_id = p_project_id or project_id is null)
      and user_id = (select auth.uid());
  if not found then
    raise exception 'Agent conversation not found' using errcode = 'P0002';
  end if;

  select * into v_map_conversation
    from public.map_conversations
    where agent_conversation_id = p_agent_conversation_id
      and project_id = p_project_id;
  if not found then
    return null;
  end if;
  return public.read_map_conversation_v1(v_map_conversation.id);
end;
$$;

create function public.attach_map_conversation_plan_to_agent_v1(
  p_project_id uuid,
  p_agent_conversation_id uuid,
  p_parent_plan_node_id uuid,
  p_title text,
  p_message text,
  p_idempotency_key uuid,
  p_intent_hash text,
  p_map_id uuid,
  p_draft_revision_id uuid,
  p_expected_save_version bigint
)
returns table (
  conversation_id uuid,
  plan_node_id uuid,
  plan_version_id uuid,
  plan_display_version bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_agent public.agent_conversations%rowtype;
  v_conversation public.map_conversations%rowtype;
  v_parent public.map_conversation_nodes%rowtype;
  v_request public.map_conversation_requests%rowtype;
  v_map_project public.map_projects%rowtype;
  v_revision public.map_revisions%rowtype;
  v_saved record;
  v_sequence bigint;
  v_node_id uuid := gen_random_uuid();
  v_display_version bigint;
begin
  v_user_id := public.map_require_writer(p_project_id);
  if p_idempotency_key is null or p_intent_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid map conversation request identity' using errcode = '22023';
  end if;

  select * into v_agent
    from public.agent_conversations
    where id = p_agent_conversation_id
      and (project_id = p_project_id or project_id is null)
      and user_id = v_user_id;
  if not found then
    raise exception 'Agent conversation not found' using errcode = 'P0002';
  end if;

  select * into v_conversation
    from public.map_conversations
    where agent_conversation_id = p_agent_conversation_id
      and project_id = p_project_id
    for update;

  if not found then
    if p_parent_plan_node_id is not null then
      raise exception 'root Plan cannot have a parent' using errcode = '22023';
    end if;
    insert into public.map_conversations (
      project_id, title, created_by, agent_conversation_id
    ) values (
      p_project_id, btrim(p_title), v_user_id, p_agent_conversation_id
    ) returning * into v_conversation;
  elsif p_parent_plan_node_id is null then
    raise exception 'follow-up Plan requires a base Plan' using errcode = '22023';
  else
    select * into v_parent
      from public.map_conversation_nodes
      where id = p_parent_plan_node_id;
    if not found or v_parent.node_type <> 'plan'
      or v_parent.conversation_id <> v_conversation.id
      or v_parent.project_id <> p_project_id then
      raise exception 'base Plan not found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_request
    from public.map_conversation_requests
    where project_id = p_project_id
      and created_by = v_user_id
      and idempotency_key = p_idempotency_key
    for update;
  if found then
    if v_request.intent_hash <> p_intent_hash then
      raise exception 'map conversation idempotency conflict' using errcode = 'KM409';
    end if;
    if v_request.plan_node_id is null then
      raise exception 'map conversation request is incomplete' using errcode = 'KM412';
    end if;
    return query
      select node.conversation_id, node.id, node.map_plan_version_id, node.plan_display_version
      from public.map_conversation_nodes as node
      where node.id = v_request.plan_node_id;
    return;
  end if;

  select * into v_map_project
    from public.map_projects
    where id = p_map_id
      and project_id = p_project_id;
  select * into v_revision
    from public.map_revisions
    where id = p_draft_revision_id
      and map_project_id = p_map_id;
  if v_map_project.id is null or v_revision.id is null then
    raise exception 'map draft not found' using errcode = 'P0002';
  end if;

  insert into public.map_conversation_requests (
    project_id, conversation_id, idempotency_key, intent_hash, created_by
  ) values (
    p_project_id, v_conversation.id, p_idempotency_key, p_intent_hash, v_user_id
  );

  select coalesce(max(message.sequence_number), 0) + 1 into v_sequence
    from public.map_conversation_messages as message
    where message.conversation_id = v_conversation.id;
  insert into public.map_conversation_messages (
    conversation_id, sequence_number, role, text, base_plan_node_id, created_by
  ) values (
    v_conversation.id, v_sequence, 'user', btrim(p_message), p_parent_plan_node_id, v_user_id
  );

  select * into v_saved
    from public.save_map_plan_v3(p_map_id, p_draft_revision_id, p_expected_save_version);
  if v_saved.status <> 'saved' then
    raise exception 'map Plan snapshot save conflict' using errcode = 'KM412';
  end if;

  update public.map_conversations
    set next_plan_display_version = next_plan_display_version + 1
    where id = v_conversation.id
    returning next_plan_display_version - 1 into v_display_version;

  insert into public.map_conversation_nodes (
    id, conversation_id, project_id, node_type, plan_display_version,
    parent_plan_node_id, map_project_id, map_plan_version_id, created_by
  ) values (
    v_node_id, v_conversation.id, p_project_id, 'plan', v_display_version,
    p_parent_plan_node_id, p_map_id, v_saved.plan_version_id, v_user_id
  );
  insert into public.map_conversation_messages (
    conversation_id, sequence_number, role, text, artifact_node_id, created_by
  ) values (
    v_conversation.id, v_sequence + 1, 'assistant', 'Map Plan created', v_node_id, v_user_id
  );
  update public.map_conversation_requests
    set plan_node_id = v_node_id
    where project_id = p_project_id
      and created_by = v_user_id
      and idempotency_key = p_idempotency_key;

  return query select v_conversation.id, v_node_id, v_saved.plan_version_id, v_display_version;
end;
$$;

grant execute on function public.read_agent_map_conversation_v1(uuid, uuid) to authenticated;
grant execute on function public.attach_map_conversation_plan_to_agent_v1(
  uuid, uuid, uuid, text, text, uuid, text, uuid, uuid, bigint
) to authenticated;

notify pgrst, 'reload schema';
