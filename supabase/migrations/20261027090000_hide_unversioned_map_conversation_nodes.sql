-- GDD map preparation creates durable Map nodes before image generation has
-- assigned a map version. Keep those nodes internal until they are versioned
-- so the public conversation snapshot always satisfies the Map node contract.

create or replace function public.read_map_conversation_v1(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.map_conversations%rowtype;
begin
  select * into v_conversation
  from public.map_conversations
  where id = p_conversation_id;
  if not found then
    raise exception 'map conversation not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_project_owner(v_conversation.project_id, (select auth.uid()))
    or public.is_accepted_collaborator(v_conversation.project_id, (select auth.uid()))
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_conversation.id,
    'projectId', v_conversation.project_id,
    'title', v_conversation.title,
    'nodes', coalesce((
      select jsonb_agg(node.payload order by node.created_at, node.id)
      from (
        select
          node.created_at,
          node.id,
          jsonb_build_object(
            'id', node.id,
            'type', 'plan',
            'displayVersion', node.plan_display_version,
            'parentPlanNodeId', node.parent_plan_node_id,
            'mapProjectId', node.map_project_id,
            'mapPlanVersionId', node.map_plan_version_id,
            'createdAt', node.created_at
          ) as payload
        from public.map_conversation_nodes as node
        where node.conversation_id = v_conversation.id
          and node.node_type = 'plan'

        union all

        select
          node.created_at,
          node.id,
          jsonb_build_object(
            'id', node.id,
            'type', 'map',
            'planNodeId', node.parent_plan_node_id,
            'revisionId', node.map_revision_id,
            'assetId', node.map_asset_id,
            'mapVersionNumber', revision.map_version_number,
            'status', asset.status,
            'createdAt', node.created_at
          ) as payload
        from public.map_conversation_nodes as node
        join public.map_revisions as revision on revision.id = node.map_revision_id
        join public.map_assets as asset on asset.id = node.map_asset_id
        where node.conversation_id = v_conversation.id
          and node.node_type = 'map'
          and revision.map_version_number is not null
      ) as node
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', message.id,
          'role', message.role,
          'text', message.text,
          'basePlanNodeId', message.base_plan_node_id,
          'artifactNodeId', message.artifact_node_id,
          'createdAt', message.created_at
        ) order by message.sequence_number
      )
      from public.map_conversation_messages as message
      where message.conversation_id = v_conversation.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_map_conversation_v1(uuid) from public, anon;
grant execute on function public.read_map_conversation_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
