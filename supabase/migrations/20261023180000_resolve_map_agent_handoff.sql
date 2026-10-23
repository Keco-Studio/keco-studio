-- A Map follow-up must resume the owning Agent conversation rather than
-- creating another standalone Map chat. Legacy/GDD map branches get one
-- global GDS Agent conversation the first time they are continued.

create or replace function public.prevent_map_conversation_header_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.next_plan_display_version > old.next_plan_display_version
    and new.agent_conversation_id is not distinct from old.agent_conversation_id
    and (pg_catalog.to_jsonb(new) - 'next_plan_display_version')
      = (pg_catalog.to_jsonb(old) - 'next_plan_display_version') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.agent_conversation_id is null
    and new.agent_conversation_id is not null
    and new.next_plan_display_version = old.next_plan_display_version
    and (pg_catalog.to_jsonb(new) - 'agent_conversation_id')
      = (pg_catalog.to_jsonb(old) - 'agent_conversation_id') then
    return new;
  end if;

  raise exception 'map conversation records are immutable' using errcode = '23514';
end;
$$;

create function public.resolve_map_agent_handoff_v1(
  p_map_project_id uuid,
  p_plan_node_id uuid
)
returns table (
  project_id uuid,
  agent_conversation_id uuid,
  plan_node_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_conversation public.map_conversations%rowtype;
  v_plan public.map_conversation_nodes%rowtype;
  v_agent public.agent_conversations%rowtype;
begin
  select map.project_id into v_project_id
  from public.map_projects as map
  where map.id = p_map_project_id;
  if v_project_id is null then
    raise exception 'Map not found' using errcode = 'P0002';
  end if;
  v_user_id := public.map_require_writer(v_project_id);

  select node.* into v_plan
  from public.map_conversation_nodes as node
  where node.id = p_plan_node_id
    and node.project_id = v_project_id
    and node.map_project_id = p_map_project_id
    and node.node_type = 'plan';
  if not found then
    raise exception 'Map Plan not found' using errcode = 'P0002';
  end if;

  select conversation.* into v_conversation
  from public.map_conversations as conversation
  where conversation.id = v_plan.conversation_id
  for update;

  if v_conversation.agent_conversation_id is not null then
    select * into v_agent
    from public.agent_conversations as agent
    where agent.id = v_conversation.agent_conversation_id
      and agent.user_id = v_user_id
      and (agent.project_id = v_project_id or agent.project_id is null);
    if not found then
      raise exception 'Map Agent conversation is not available to this user'
        using errcode = '42501';
    end if;
  else
    insert into public.agent_conversations (user_id, project_id, title, meta)
    values (
      v_user_id,
      null,
      left(v_conversation.title || ' map', 160),
      jsonb_build_object(
        'autoExecute', false,
        'scope', jsonb_build_object(
          'level', 'global',
          'workspace', 'game-design-systems'
        )
      )
    )
    returning * into v_agent;

    update public.map_conversations
    set agent_conversation_id = v_agent.id
    where id = v_conversation.id;
  end if;

  return query select v_project_id, v_agent.id, v_plan.id;
end;
$$;

revoke all on function public.resolve_map_agent_handoff_v1(uuid, uuid) from public, anon;
grant execute on function public.resolve_map_agent_handoff_v1(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
