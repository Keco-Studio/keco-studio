-- One Map conversation owns one root Plan. GDD job identity remains provenance;
-- it no longer groups distinct Map briefs into one version tree.

alter table public.map_conversations
  add column if not exists root_map_project_id uuid
  references public.map_projects(id) on delete restrict;

drop index if exists public.map_conversations_gdd_generation_job_idx;
create index if not exists map_conversations_gdd_generation_job_idx
  on public.map_conversations(gdd_generation_job_id)
  where gdd_generation_job_id is not null;

alter table public.map_conversations disable trigger map_conversations_immutable;
alter table public.map_conversation_nodes disable trigger map_conversation_nodes_immutable;
alter table public.map_conversation_messages disable trigger map_conversation_messages_immutable;

-- The legacy GDD backfill could materialize the same immutable Plan snapshot
-- in more than one conversation. Keep the copy that owns generated Map nodes
-- and redirect durable references before splitting conversations by root Plan.
create temporary table map_conversation_duplicate_root_targets (
  duplicate_node_id uuid primary key,
  duplicate_conversation_id uuid not null,
  canonical_node_id uuid not null
) on commit drop;

insert into map_conversation_duplicate_root_targets (
  duplicate_node_id, duplicate_conversation_id, canonical_node_id
)
select ranked.node_id, ranked.conversation_id, ranked.canonical_node_id
from (
  select
    node.id as node_id,
    node.conversation_id,
    first_value(node.id) over (
      partition by node.map_project_id, node.map_plan_version_id
      order by
        (select count(*) from public.map_conversation_nodes as child
          where child.parent_plan_node_id = node.id) desc,
        node.created_at,
        node.id
    ) as canonical_node_id,
    row_number() over (
      partition by node.map_project_id, node.map_plan_version_id
      order by
        (select count(*) from public.map_conversation_nodes as child
          where child.parent_plan_node_id = node.id) desc,
        node.created_at,
        node.id
    ) as duplicate_number
  from public.map_conversation_nodes as node
  where node.node_type = 'plan'
    and node.parent_plan_node_id is null
) as ranked
where ranked.duplicate_number > 1;

do $$
begin
  if exists (
    select 1
    from map_conversation_duplicate_root_targets as target
    join public.map_conversation_nodes as child
      on child.parent_plan_node_id = target.duplicate_node_id
  ) then
    raise exception 'duplicate root Plan with Map children cannot be coalesced';
  end if;
end;
$$;

update public.map_conversation_messages as message
set artifact_node_id = target.canonical_node_id
from map_conversation_duplicate_root_targets as target
where message.artifact_node_id = target.duplicate_node_id;

update public.map_conversation_messages as message
set base_plan_node_id = target.canonical_node_id
from map_conversation_duplicate_root_targets as target
where message.base_plan_node_id = target.duplicate_node_id;

update public.map_conversation_requests as request
set plan_node_id = target.canonical_node_id
from map_conversation_duplicate_root_targets as target
where request.plan_node_id = target.duplicate_node_id;

delete from public.map_conversation_nodes as node
using map_conversation_duplicate_root_targets as target
where node.id = target.duplicate_node_id;

create temporary table map_conversation_root_targets (
  root_node_id uuid primary key,
  source_conversation_id uuid not null,
  target_conversation_id uuid not null unique
) on commit drop;

insert into map_conversation_root_targets (
  root_node_id, source_conversation_id, target_conversation_id
)
select
  ranked.root_node_id,
  ranked.source_conversation_id,
  case when ranked.root_number = 1
    then ranked.source_conversation_id
    else gen_random_uuid()
  end
from (
  select
    node.id as root_node_id,
    node.conversation_id as source_conversation_id,
    row_number() over (
      partition by node.conversation_id order by node.created_at, node.id
    ) as root_number
  from public.map_conversation_nodes as node
  join public.map_conversations as conversation
    on conversation.id = node.conversation_id
  where node.node_type = 'plan'
    and node.parent_plan_node_id is null
    and conversation.gdd_generation_job_id is not null
) as ranked;

insert into public.map_conversations (
  id, project_id, title, created_by, next_plan_display_version, created_at,
  gdd_generation_job_id, agent_conversation_id, root_map_project_id
)
select
  target.target_conversation_id,
  root.project_id,
  left(map.name, 160),
  root.created_by,
  1,
  root.created_at,
  source.gdd_generation_job_id,
  null,
  root.map_project_id
from map_conversation_root_targets as target
join public.map_conversation_nodes as root on root.id = target.root_node_id
join public.map_projects as map on map.id = root.map_project_id
join public.map_conversations as source on source.id = target.source_conversation_id
where target.target_conversation_id <> target.source_conversation_id;

create temporary table map_conversation_node_targets (
  node_id uuid primary key,
  target_conversation_id uuid not null,
  root_node_id uuid not null
) on commit drop;

with recursive plan_tree as (
  select
    target.root_node_id,
    target.target_conversation_id,
    target.root_node_id as node_id
  from map_conversation_root_targets as target
  union all
  select
    tree.root_node_id,
    tree.target_conversation_id,
    child.id
  from plan_tree as tree
  join public.map_conversation_nodes as child
    on child.parent_plan_node_id = tree.node_id
   and child.node_type = 'plan'
)
insert into map_conversation_node_targets (node_id, target_conversation_id, root_node_id)
select node_id, target_conversation_id, root_node_id from plan_tree;

insert into map_conversation_node_targets (node_id, target_conversation_id, root_node_id)
select map.id, target.target_conversation_id, target.root_node_id
from public.map_conversation_nodes as map
join map_conversation_node_targets as target
  on target.node_id = map.parent_plan_node_id
where map.node_type = 'map';

do $$
begin
  if exists (
    select 1
    from public.map_conversation_nodes as node
    join public.map_conversations as conversation on conversation.id = node.conversation_id
    left join map_conversation_node_targets as target on target.node_id = node.id
    where conversation.gdd_generation_job_id is not null
      and target.node_id is null
  ) then
    raise exception 'GDD Map conversation contains a node outside every root tree';
  end if;

  if exists (
    select 1
    from public.map_conversation_messages as message
    left join map_conversation_node_targets as artifact on artifact.node_id = message.artifact_node_id
    left join map_conversation_node_targets as base on base.node_id = message.base_plan_node_id
    where artifact.node_id is not null
      and base.node_id is not null
      and artifact.target_conversation_id <> base.target_conversation_id
  ) then
    raise exception 'Map conversation message crosses root Plan trees';
  end if;
end;
$$;

update public.map_conversation_nodes as node
set conversation_id = target.target_conversation_id
from map_conversation_node_targets as target
where target.node_id = node.id
  and node.conversation_id <> target.target_conversation_id;

-- Sequence numbers are unique only within a conversation. Give every message
-- a temporary globally unique number before messages cross root boundaries.
create temporary table map_conversation_staged_message_numbers on commit drop as
select
  message.id,
  maximum.value + row_number() over (order by message.created_at, message.id)
    as sequence_number
from public.map_conversation_messages as message
cross join (
  select coalesce(max(sequence_number), 0)::bigint as value
  from public.map_conversation_messages
) as maximum;

update public.map_conversation_messages as message
set sequence_number = staged.sequence_number
from map_conversation_staged_message_numbers as staged
where staged.id = message.id;

update public.map_conversation_messages as message
set conversation_id = target.target_conversation_id
from map_conversation_node_targets as target
where target.node_id = message.artifact_node_id
  and message.conversation_id <> target.target_conversation_id;

update public.map_conversation_messages as message
set conversation_id = target.target_conversation_id
from map_conversation_node_targets as target
where target.node_id = message.base_plan_node_id
  and message.conversation_id <> target.target_conversation_id;

update public.map_conversation_requests as request
set conversation_id = target.target_conversation_id
from map_conversation_node_targets as target
where target.node_id = request.plan_node_id
  and request.conversation_id <> target.target_conversation_id;

do $$
begin
  if exists (
    select 1
    from public.map_conversations as conversation
    join map_conversation_duplicate_root_targets as duplicate
      on duplicate.duplicate_conversation_id = conversation.id
    where not exists (
      select 1 from public.map_conversation_nodes as node
      where node.conversation_id = conversation.id
    )
      and (
        exists (
          select 1 from public.map_conversation_messages as message
          where message.conversation_id = conversation.id
        )
        or exists (
          select 1 from public.map_conversation_requests as request
          where request.conversation_id = conversation.id
        )
      )
  ) then
    raise exception 'duplicate root conversation retained dependent records';
  end if;
end;
$$;

delete from public.map_conversations as conversation
using map_conversation_duplicate_root_targets as duplicate
where conversation.id = duplicate.duplicate_conversation_id
  and not exists (
    select 1 from public.map_conversation_nodes as node
    where node.conversation_id = conversation.id
  );

create temporary table map_conversation_plan_numbers on commit drop as
select
  node.id,
  row_number() over (
    partition by node.conversation_id order by node.created_at, node.id
  ) as display_version
from public.map_conversation_nodes as node
where node.node_type = 'plan';

update public.map_conversation_nodes as node
set plan_display_version = node.plan_display_version + 1000000000
where node.node_type = 'plan';

update public.map_conversation_nodes as node
set plan_display_version = numbered.display_version
from map_conversation_plan_numbers as numbered
where numbered.id = node.id;

create temporary table map_conversation_message_numbers on commit drop as
select
  message.id,
  row_number() over (
    partition by message.conversation_id order by message.created_at, message.id
  ) as sequence_number
from public.map_conversation_messages as message;

update public.map_conversation_messages
set sequence_number = sequence_number + 1000000000;

update public.map_conversation_messages as message
set sequence_number = numbered.sequence_number
from map_conversation_message_numbers as numbered
where numbered.id = message.id;

update public.map_conversations as conversation
set
  root_map_project_id = root.map_project_id,
  next_plan_display_version = plan_count.count + 1,
  title = case
    when conversation.gdd_generation_job_id is not null then left(map.name, 160)
    else conversation.title
  end
from public.map_conversation_nodes as root
join public.map_projects as map on map.id = root.map_project_id
join lateral (
  select count(*)::bigint as count
  from public.map_conversation_nodes as plan
  where plan.conversation_id = root.conversation_id
    and plan.node_type = 'plan'
) as plan_count on true
where root.conversation_id = conversation.id
  and root.node_type = 'plan'
  and root.parent_plan_node_id is null;

do $$
begin
  if exists (
    select 1
    from public.map_conversations as conversation
    left join public.map_conversation_nodes as root
      on root.conversation_id = conversation.id
     and root.node_type = 'plan'
     and root.parent_plan_node_id is null
    group by conversation.id
    having count(root.id) <> 1
  ) then
    raise exception 'Every Map conversation must contain exactly one root Plan';
  end if;

  if exists (
    select 1
    from public.map_conversation_nodes as node
    join public.map_conversations as conversation on conversation.id = node.conversation_id
    where node.project_id <> conversation.project_id
  ) then
    raise exception 'Map conversation node project mismatch after root split';
  end if;

  if exists (
    select 1
    from public.map_conversation_messages as message
    join public.map_conversation_nodes as artifact on artifact.id = message.artifact_node_id
    where artifact.conversation_id <> message.conversation_id
  ) or exists (
    select 1
    from public.map_conversation_messages as message
    join public.map_conversation_nodes as base on base.id = message.base_plan_node_id
    where base.conversation_id <> message.conversation_id
  ) then
    raise exception 'Map conversation message mismatch after root split';
  end if;

  if exists (
    select 1
    from public.map_conversation_requests as request
    join public.map_conversation_nodes as plan on plan.id = request.plan_node_id
    where plan.conversation_id <> request.conversation_id
  ) then
    raise exception 'Map conversation request mismatch after root split';
  end if;
end;
$$;

alter table public.map_conversation_messages enable trigger map_conversation_messages_immutable;
alter table public.map_conversation_nodes enable trigger map_conversation_nodes_immutable;
alter table public.map_conversations enable trigger map_conversations_immutable;

alter table public.map_conversations
  alter column root_map_project_id set not null;

create unique index map_conversations_root_map_project_idx
  on public.map_conversations(root_map_project_id);

create unique index map_conversation_one_root_plan_idx
  on public.map_conversation_nodes(conversation_id)
  where node_type = 'plan' and parent_plan_node_id is null;

create or replace function public.map_conversation_node_validate()
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
    if new.parent_plan_node_id is null
      and new.map_project_id <> v_conversation.root_map_project_id then
      raise exception 'root Plan Map project mismatch' using errcode = '23503';
    end if;
    if new.parent_plan_node_id is not null then
      select * into v_parent from public.map_conversation_nodes where id = new.parent_plan_node_id;
      if not found or v_parent.node_type <> 'plan'
        or v_parent.conversation_id <> new.conversation_id
        or v_parent.project_id <> new.project_id then
        raise exception 'map conversation parent Plan mismatch' using errcode = '23503';
      end if;
    end if;
    select * into v_map_project from public.map_projects where id = new.map_project_id;
    select * into v_plan_version from public.map_plan_versions where id = new.map_plan_version_id;
    if v_map_project.id is null or v_plan_version.id is null
      or v_map_project.project_id <> new.project_id
      or v_plan_version.map_project_id <> new.map_project_id then
      raise exception 'map conversation Plan snapshot mismatch' using errcode = '23503';
    end if;
  else
    select * into v_parent from public.map_conversation_nodes where id = new.parent_plan_node_id;
    select * into v_revision from public.map_revisions where id = new.map_revision_id;
    select * into v_asset from public.map_assets where id = new.map_asset_id;
    if v_parent.id is null or v_parent.node_type <> 'plan'
      or v_parent.conversation_id <> new.conversation_id
      or v_parent.project_id <> new.project_id
      or v_revision.map_project_id <> v_parent.map_project_id
      or v_asset.map_revision_id <> new.map_revision_id then
      raise exception 'map conversation Map output mismatch' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

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

create or replace function public.create_map_conversation_plan_v1(
  p_project_id uuid, p_conversation_id uuid, p_parent_plan_node_id uuid,
  p_title text, p_message text, p_idempotency_key uuid, p_intent_hash text,
  p_name text, p_source_document_id uuid, p_source_document_updated_at timestamptz,
  p_source_epoch bigint, p_source_revision bigint, p_plan jsonb, p_scene jsonb
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
    where project_id = p_project_id and created_by = v_user_id
      and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.intent_hash <> p_intent_hash then
      raise exception 'map conversation idempotency conflict' using errcode = 'KM409';
    end if;
    if v_request.plan_node_id is null then
      raise exception 'map conversation request is incomplete' using errcode = 'KM412';
    end if;
    return query select node.conversation_id, node.id, node.map_project_id,
      version.draft_revision_id, node.map_plan_version_id, node.plan_display_version
    from public.map_conversation_nodes as node
    join public.map_plan_versions as version on version.id = node.map_plan_version_id
    where node.id = v_request.plan_node_id;
    return;
  end if;

  if p_conversation_id is not null then
    select * into v_conversation from public.map_conversations
      where id = p_conversation_id for update;
    if not found or v_conversation.project_id <> p_project_id then
      raise exception 'map conversation not found' using errcode = 'P0002';
    end if;
    if p_parent_plan_node_id is null then
      raise exception 'follow-up Plan requires a base Plan' using errcode = '22023';
    end if;
    select * into v_parent from public.map_conversation_nodes
      where id = p_parent_plan_node_id;
    if not found or v_parent.node_type <> 'plan'
      or v_parent.conversation_id <> v_conversation.id then
      raise exception 'base Plan not found' using errcode = 'P0002';
    end if;
  elsif p_parent_plan_node_id is not null then
    raise exception 'root Plan cannot have a parent' using errcode = '22023';
  end if;

  select * into v_created from public.create_map_project_v3(
    p_project_id, p_name, p_source_document_id, p_source_document_updated_at,
    p_source_epoch, p_source_revision, p_plan, p_scene
  );
  select * into v_saved from public.save_map_plan_v3(
    v_created.map_id, v_created.draft_revision_id, v_created.save_version
  );
  if v_saved.status <> 'saved' then
    raise exception 'map Plan snapshot save conflict' using errcode = 'KM412';
  end if;

  if p_conversation_id is null then
    insert into public.map_conversations (
      project_id, title, created_by, root_map_project_id
    ) values (
      p_project_id, btrim(p_title), v_user_id, v_created.map_id
    ) returning * into v_conversation;
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

  update public.map_conversations
  set next_plan_display_version = next_plan_display_version + 1
  where id = v_conversation.id
  returning next_plan_display_version - 1 into v_display_version;
  insert into public.map_conversation_nodes (
    id, conversation_id, project_id, node_type, plan_display_version,
    parent_plan_node_id, map_project_id, map_plan_version_id, created_by
  ) values (
    v_node_id, v_conversation.id, p_project_id, 'plan', v_display_version,
    p_parent_plan_node_id, v_created.map_id, v_saved.plan_version_id, v_user_id
  );
  insert into public.map_conversation_messages (
    conversation_id, sequence_number, role, text, artifact_node_id, created_by
  ) values (
    v_conversation.id, v_sequence + 1, 'assistant', 'Map Plan created', v_node_id, v_user_id
  );
  update public.map_conversation_requests set plan_node_id = v_node_id
  where project_id = p_project_id and created_by = v_user_id
    and idempotency_key = p_idempotency_key;
  return query select v_conversation.id, v_node_id, v_created.map_id,
    v_created.draft_revision_id, v_saved.plan_version_id, v_display_version;
end;
$$;

create or replace function public.ensure_gdd_map_artifact_conversation_v1(
  p_artifact_id uuid
)
returns table(conversation_id uuid, plan_node_id uuid, map_node_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_plan_version_id uuid;
  v_conversation public.map_conversations%rowtype;
  v_plan_node_id uuid;
  v_map_node_id uuid;
  v_display_version bigint;
  v_sequence bigint;
  v_map_name text;
begin
  select artifact.* into v_artifact from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id;
  if not found or v_artifact.map_project_id is null
    or v_artifact.map_revision_id is null or v_artifact.map_asset_id is null then
    raise exception 'GDD map artifact has no prepared map identity' using errcode = 'P0002';
  end if;
  select revision.plan_version_id into v_plan_version_id
  from public.map_revisions as revision
  where revision.id = v_artifact.map_revision_id
    and revision.map_project_id = v_artifact.map_project_id;
  if v_plan_version_id is null then
    raise exception 'GDD map artifact has no saved Plan snapshot' using errcode = 'P0002';
  end if;
  select map.name into v_map_name from public.map_projects as map
  where map.id = v_artifact.map_project_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_artifact.map_project_id::text, 0)
  );
  select conversation.* into v_conversation
  from public.map_conversations as conversation
  where conversation.root_map_project_id = v_artifact.map_project_id
  for update;
  if not found then
    insert into public.map_conversations (
      project_id, title, created_by, gdd_generation_job_id, root_map_project_id
    ) values (
      v_artifact.project_id,
      left(coalesce(nullif(btrim(v_map_name), ''), 'GDD map conversation'), 160),
      v_artifact.owner_id, v_artifact.gdd_generation_job_id,
      v_artifact.map_project_id
    ) returning * into v_conversation;
  end if;

  select node.id into v_plan_node_id from public.map_conversation_nodes as node
  where node.conversation_id = v_conversation.id and node.node_type = 'plan'
    and node.map_project_id = v_artifact.map_project_id
    and node.map_plan_version_id = v_plan_version_id;
  if v_plan_node_id is null then
    update public.map_conversations
    set next_plan_display_version = next_plan_display_version + 1
    where id = v_conversation.id
    returning next_plan_display_version - 1 into v_display_version;
    insert into public.map_conversation_nodes (
      conversation_id, project_id, node_type, plan_display_version,
      map_project_id, map_plan_version_id, created_by
    ) values (
      v_conversation.id, v_artifact.project_id, 'plan', v_display_version,
      v_artifact.map_project_id, v_plan_version_id, v_artifact.owner_id
    ) returning id into v_plan_node_id;
    select coalesce(max(message.sequence_number), 0) + 1 into v_sequence
    from public.map_conversation_messages as message
    where message.conversation_id = v_conversation.id;
    insert into public.map_conversation_messages (
      conversation_id, sequence_number, role, text, artifact_node_id, created_by
    ) values (
      v_conversation.id, v_sequence, 'assistant', 'GDD Map Plan created',
      v_plan_node_id, v_artifact.owner_id
    );
  end if;

  select node.id into v_map_node_id from public.map_conversation_nodes as node
  where node.parent_plan_node_id = v_plan_node_id
    and node.map_revision_id = v_artifact.map_revision_id
    and node.map_asset_id = v_artifact.map_asset_id;
  if v_map_node_id is null then
    insert into public.map_conversation_nodes (
      conversation_id, project_id, node_type, parent_plan_node_id,
      map_revision_id, map_asset_id, created_by
    ) values (
      v_conversation.id, v_artifact.project_id, 'map', v_plan_node_id,
      v_artifact.map_revision_id, v_artifact.map_asset_id, v_artifact.owner_id
    ) returning id into v_map_node_id;
    select coalesce(max(message.sequence_number), 0) + 1 into v_sequence
    from public.map_conversation_messages as message
    where message.conversation_id = v_conversation.id;
    insert into public.map_conversation_messages (
      conversation_id, sequence_number, role, text, artifact_node_id, created_by
    ) values (
      v_conversation.id, v_sequence, 'assistant', 'Map generation started',
      v_map_node_id, v_artifact.owner_id
    );
  end if;
  return query select v_conversation.id, v_plan_node_id, v_map_node_id;
end;
$$;

create or replace function public.attach_map_conversation_plan_to_agent_v1(
  p_project_id uuid, p_agent_conversation_id uuid, p_parent_plan_node_id uuid,
  p_title text, p_message text, p_idempotency_key uuid, p_intent_hash text,
  p_map_id uuid, p_draft_revision_id uuid, p_expected_save_version bigint
)
returns table (
  conversation_id uuid, plan_node_id uuid, plan_version_id uuid,
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
  select * into v_agent from public.agent_conversations
  where id = p_agent_conversation_id
    and (project_id = p_project_id or project_id is null)
    and user_id = v_user_id;
  if not found then raise exception 'Agent conversation not found' using errcode = 'P0002'; end if;
  select * into v_map_project from public.map_projects
  where id = p_map_id and project_id = p_project_id;
  select * into v_revision from public.map_revisions
  where id = p_draft_revision_id and map_project_id = p_map_id;
  if v_map_project.id is null or v_revision.id is null then
    raise exception 'map draft not found' using errcode = 'P0002';
  end if;

  select * into v_conversation from public.map_conversations
  where agent_conversation_id = p_agent_conversation_id
    and project_id = p_project_id for update;
  if not found then
    if p_parent_plan_node_id is not null then
      raise exception 'root Plan cannot have a parent' using errcode = '22023';
    end if;
    insert into public.map_conversations (
      project_id, title, created_by, agent_conversation_id, root_map_project_id
    ) values (
      p_project_id, btrim(p_title), v_user_id, p_agent_conversation_id, p_map_id
    ) returning * into v_conversation;
  elsif p_parent_plan_node_id is null then
    raise exception 'follow-up Plan requires a base Plan' using errcode = '22023';
  else
    select * into v_parent from public.map_conversation_nodes
    where id = p_parent_plan_node_id;
    if not found or v_parent.node_type <> 'plan'
      or v_parent.conversation_id <> v_conversation.id
      or v_parent.project_id <> p_project_id then
      raise exception 'base Plan not found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_request from public.map_conversation_requests
  where project_id = p_project_id and created_by = v_user_id
    and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.intent_hash <> p_intent_hash then
      raise exception 'map conversation idempotency conflict' using errcode = 'KM409';
    end if;
    if v_request.plan_node_id is null then
      raise exception 'map conversation request is incomplete' using errcode = 'KM412';
    end if;
    return query select node.conversation_id, node.id,
      node.map_plan_version_id, node.plan_display_version
    from public.map_conversation_nodes as node where node.id = v_request.plan_node_id;
    return;
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
  select * into v_saved from public.save_map_plan_v3(
    p_map_id, p_draft_revision_id, p_expected_save_version
  );
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
  update public.map_conversation_requests set plan_node_id = v_node_id
  where project_id = p_project_id and created_by = v_user_id
    and idempotency_key = p_idempotency_key;
  return query select v_conversation.id, v_node_id,
    v_saved.plan_version_id, v_display_version;
end;
$$;

revoke all on function public.ensure_gdd_map_artifact_conversation_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_gdd_map_artifact_conversation_v1(uuid)
  to service_role;

notify pgrst, 'reload schema';
