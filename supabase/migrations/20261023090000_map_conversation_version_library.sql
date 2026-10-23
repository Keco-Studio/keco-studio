-- Durable conversational Plan branches. A branch gets its own existing linear
-- map project; map revisions themselves remain linear.

create table public.map_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  next_plan_display_version bigint not null default 1 check (next_plan_display_version > 0),
  created_at timestamptz not null default now()
);

create table public.map_conversation_nodes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.map_conversations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  node_type text not null check (node_type in ('plan', 'map')),
  plan_display_version bigint check (plan_display_version > 0),
  parent_plan_node_id uuid references public.map_conversation_nodes(id) on delete restrict,
  map_project_id uuid references public.map_projects(id) on delete restrict,
  map_plan_version_id uuid references public.map_plan_versions(id) on delete restrict,
  map_revision_id uuid references public.map_revisions(id) on delete restrict,
  map_asset_id uuid references public.map_assets(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (conversation_id, map_project_id, map_plan_version_id),
  unique (parent_plan_node_id, map_revision_id, map_asset_id),
  check (
    (node_type = 'plan'
      and plan_display_version is not null
      and map_project_id is not null
      and map_plan_version_id is not null
      and map_revision_id is null
      and map_asset_id is null)
    or
    (node_type = 'map'
      and plan_display_version is null
      and parent_plan_node_id is not null
      and map_project_id is null
      and map_plan_version_id is null
      and map_revision_id is not null
      and map_asset_id is not null)
  )
);

create unique index map_conversation_plan_display_version_idx
  on public.map_conversation_nodes(conversation_id, plan_display_version)
  where node_type = 'plan';
create index map_conversation_nodes_conversation_idx
  on public.map_conversation_nodes(conversation_id, created_at);

create table public.map_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.map_conversations(id) on delete cascade,
  sequence_number bigint not null check (sequence_number > 0),
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) <= 4000),
  base_plan_node_id uuid references public.map_conversation_nodes(id) on delete restrict,
  artifact_node_id uuid references public.map_conversation_nodes(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence_number)
);

create table public.map_conversation_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references public.map_conversations(id) on delete cascade,
  idempotency_key uuid not null,
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  plan_node_id uuid references public.map_conversation_nodes(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (project_id, created_by, idempotency_key)
);

create function public.map_conversation_node_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conversation public.map_conversations%rowtype;
  v_parent public.map_conversation_nodes%rowtype;
  v_map_project public.map_projects%rowtype;
  v_plan_version public.map_plan_versions%rowtype;
  v_revision public.map_revisions%rowtype;
  v_asset public.map_assets%rowtype;
begin
  select * into v_conversation from public.map_conversations where id = new.conversation_id;
  if not found or v_conversation.project_id <> new.project_id then
    raise exception 'map conversation project mismatch' using errcode = '23503';
  end if;

  if new.node_type = 'plan' then
    if new.parent_plan_node_id is not null then
      select * into v_parent from public.map_conversation_nodes where id = new.parent_plan_node_id;
      if not found or v_parent.node_type <> 'plan' or v_parent.conversation_id <> new.conversation_id
        or v_parent.project_id <> new.project_id then
        raise exception 'map conversation parent Plan mismatch' using errcode = '23503';
      end if;
    end if;
    select * into v_map_project from public.map_projects where id = new.map_project_id;
    select * into v_plan_version from public.map_plan_versions where id = new.map_plan_version_id;
    if v_map_project.id is null or v_plan_version.id is null or v_map_project.project_id <> new.project_id
      or v_plan_version.map_project_id <> new.map_project_id then
      raise exception 'map conversation Plan snapshot mismatch' using errcode = '23503';
    end if;
  else
    select * into v_parent from public.map_conversation_nodes where id = new.parent_plan_node_id;
    select * into v_revision from public.map_revisions where id = new.map_revision_id;
    select * into v_asset from public.map_assets where id = new.map_asset_id;
    if not found or v_parent.node_type <> 'plan' or v_parent.conversation_id <> new.conversation_id
      or v_parent.project_id <> new.project_id or v_revision.map_project_id <> v_parent.map_project_id
      or v_asset.map_revision_id <> new.map_revision_id then
      raise exception 'map conversation Map output mismatch' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger map_conversation_nodes_validate
  before insert on public.map_conversation_nodes
  for each row execute function public.map_conversation_node_validate();

create function public.map_conversation_message_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_plan_node_id is not null and not exists (
    select 1 from public.map_conversation_nodes as node
    where node.id = new.base_plan_node_id and node.conversation_id = new.conversation_id and node.node_type = 'plan'
  ) then raise exception 'map conversation message base mismatch' using errcode = '23503'; end if;
  if new.artifact_node_id is not null and not exists (
    select 1 from public.map_conversation_nodes as node
    where node.id = new.artifact_node_id and node.conversation_id = new.conversation_id
  ) then raise exception 'map conversation message artifact mismatch' using errcode = '23503'; end if;
  return new;
end;
$$;

create trigger map_conversation_messages_validate
  before insert on public.map_conversation_messages
  for each row execute function public.map_conversation_message_validate();

create function public.prevent_map_conversation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'map conversation records are immutable' using errcode = '23514';
end;
$$;

create function public.prevent_map_conversation_header_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'update'
    and new.id = old.id
    and new.project_id = old.project_id
    and new.title = old.title
    and new.created_by = old.created_by
    and new.created_at = old.created_at
    and new.next_plan_display_version = old.next_plan_display_version + 1 then
    return new;
  end if;
  raise exception 'map conversation records are immutable' using errcode = '23514';
end;
$$;
create trigger map_conversations_immutable before update or delete on public.map_conversations
  for each row execute function public.prevent_map_conversation_header_mutation();
create trigger map_conversation_nodes_immutable before update or delete on public.map_conversation_nodes
  for each row execute function public.prevent_map_conversation_mutation();
create trigger map_conversation_messages_immutable before update or delete on public.map_conversation_messages
  for each row execute function public.prevent_map_conversation_mutation();

alter table public.map_conversations enable row level security;
alter table public.map_conversation_nodes enable row level security;
alter table public.map_conversation_messages enable row level security;
alter table public.map_conversation_requests enable row level security;

create policy map_conversations_select on public.map_conversations for select using (
  public.is_project_owner(project_id, (select auth.uid())) or public.is_accepted_collaborator(project_id, (select auth.uid()))
);
create policy map_conversation_nodes_select on public.map_conversation_nodes for select using (
  public.is_project_owner(project_id, (select auth.uid())) or public.is_accepted_collaborator(project_id, (select auth.uid()))
);
create policy map_conversation_messages_select on public.map_conversation_messages for select using (
  exists (select 1 from public.map_conversations as conversation where conversation.id = map_conversation_messages.conversation_id
    and (public.is_project_owner(conversation.project_id, (select auth.uid())) or public.is_accepted_collaborator(conversation.project_id, (select auth.uid()))))
);

create function public.create_map_conversation_plan_v1(
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
  select coalesce(max(message.sequence_number), 0) + 1 into v_sequence from public.map_conversation_messages as message
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

create function public.attach_map_conversation_output_v1(
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
    select coalesce(max(message.sequence_number), 0) + 1 into v_sequence from public.map_conversation_messages as message
      where message.conversation_id = v_plan.conversation_id;
    insert into public.map_conversation_messages (conversation_id, sequence_number, role, text, artifact_node_id, created_by)
      values (v_plan.conversation_id, v_sequence, 'assistant', 'Map generated', v_map_node_id, v_user_id);
  end if;
  return query select v_map_node_id, v_plan.plan_display_version, v_map_version;
end;
$$;

create function public.read_map_conversation_v1(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.map_conversations%rowtype;
begin
  select * into v_conversation from public.map_conversations where id = p_conversation_id;
  if not found then raise exception 'map conversation not found' using errcode = 'P0002'; end if;
  if not (public.is_project_owner(v_conversation.project_id, (select auth.uid())) or public.is_accepted_collaborator(v_conversation.project_id, (select auth.uid()))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_conversation.id, 'projectId', v_conversation.project_id, 'title', v_conversation.title,
    'nodes', coalesce((select jsonb_agg(node.payload order by node.created_at, node.id) from (
      select node.created_at, node.id, jsonb_build_object('id', node.id, 'type', 'plan', 'displayVersion', node.plan_display_version,
        'parentPlanNodeId', node.parent_plan_node_id, 'mapProjectId', node.map_project_id, 'mapPlanVersionId', node.map_plan_version_id, 'createdAt', node.created_at) as payload
      from public.map_conversation_nodes as node where node.conversation_id = v_conversation.id and node.node_type = 'plan'
      union all
      select node.created_at, node.id, jsonb_build_object('id', node.id, 'type', 'map', 'planNodeId', node.parent_plan_node_id,
        'revisionId', node.map_revision_id, 'assetId', node.map_asset_id, 'mapVersionNumber', revision.map_version_number,
        'status', asset.status, 'createdAt', node.created_at) as payload
      from public.map_conversation_nodes as node join public.map_revisions as revision on revision.id = node.map_revision_id
        join public.map_assets as asset on asset.id = node.map_asset_id
      where node.conversation_id = v_conversation.id and node.node_type = 'map'
    ) as node), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', message.id, 'role', message.role, 'text', message.text,
      'basePlanNodeId', message.base_plan_node_id, 'artifactNodeId', message.artifact_node_id, 'createdAt', message.created_at) order by message.sequence_number)
      from public.map_conversation_messages as message where message.conversation_id = v_conversation.id), '[]'::jsonb)
  );
end;
$$;

create function public.resolve_map_conversation_node_v1(p_node_id uuid)
returns table (plan_node_id uuid, map_project_id uuid, map_plan_version_id uuid, selected_map_asset_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_node public.map_conversation_nodes%rowtype; v_plan public.map_conversation_nodes%rowtype;
begin
  select * into v_node from public.map_conversation_nodes where id = p_node_id;
  if not found then raise exception 'map conversation node not found' using errcode = 'P0002'; end if;
  if not (public.is_project_owner(v_node.project_id, (select auth.uid())) or public.is_accepted_collaborator(v_node.project_id, (select auth.uid()))) then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_node.node_type = 'plan' then v_plan := v_node; else select * into v_plan from public.map_conversation_nodes where id = v_node.parent_plan_node_id; end if;
  return query select v_plan.id, v_plan.map_project_id, v_plan.map_plan_version_id,
    case when v_node.node_type = 'map' then v_node.map_asset_id else null end;
end;
$$;

revoke all on public.map_conversations, public.map_conversation_nodes, public.map_conversation_messages, public.map_conversation_requests from public, anon, authenticated;
grant select on public.map_conversations, public.map_conversation_nodes, public.map_conversation_messages to authenticated;
revoke all on function public.create_map_conversation_plan_v1(uuid, uuid, uuid, text, text, uuid, text, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.create_map_conversation_plan_v1(uuid, uuid, uuid, text, text, uuid, text, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb) to authenticated;
revoke all on function public.attach_map_conversation_output_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.attach_map_conversation_output_v1(uuid, uuid, uuid) to authenticated;
revoke all on function public.read_map_conversation_v1(uuid) from public, anon;
grant execute on function public.read_map_conversation_v1(uuid) to authenticated;
revoke all on function public.resolve_map_conversation_node_v1(uuid) from public, anon;
grant execute on function public.resolve_map_conversation_node_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
