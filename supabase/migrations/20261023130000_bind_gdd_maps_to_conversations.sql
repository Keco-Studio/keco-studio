-- GDD map creation predates the conversation version library. Bind both new
-- and existing GDD-derived Plan branches into one durable conversation per
-- GDD generation job, while retaining Plans that do not yet have an image.

alter table public.map_conversations
  add column if not exists gdd_generation_job_id uuid
  references public.gdd_generation_jobs(id) on delete restrict;

create unique index if not exists map_conversations_gdd_generation_job_idx
  on public.map_conversations(gdd_generation_job_id)
  where gdd_generation_job_id is not null;

create or replace function public.prevent_map_conversation_header_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.next_plan_display_version > old.next_plan_display_version
    and (pg_catalog.to_jsonb(new) - 'next_plan_display_version')
      = (pg_catalog.to_jsonb(old) - 'next_plan_display_version') then
    return new;
  end if;
  raise exception 'map conversation records are immutable' using errcode = '23514';
end;
$$;

create or replace function public.ensure_gdd_map_artifact_conversation_v1(
  p_artifact_id uuid
)
returns table(conversation_id uuid, plan_node_id uuid, map_node_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_document_name text;
  v_plan_version_id uuid;
  v_conversation public.map_conversations%rowtype;
  v_plan_node_id uuid;
  v_map_node_id uuid;
  v_display_version bigint;
  v_sequence bigint;
begin
  select artifact.* into v_artifact
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id;
  if not found or v_artifact.map_project_id is null or v_artifact.map_revision_id is null
    or v_artifact.map_asset_id is null then
    raise exception 'GDD map artifact has no prepared map identity' using errcode = 'P0002';
  end if;

  select revision.plan_version_id into v_plan_version_id
  from public.map_revisions as revision
  where revision.id = v_artifact.map_revision_id
    and revision.map_project_id = v_artifact.map_project_id;
  if v_plan_version_id is null then
    raise exception 'GDD map artifact has no saved Plan snapshot' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_artifact.gdd_generation_job_id::text, 0)
  );

  select conversation.* into v_conversation
  from public.map_conversations as conversation
  where conversation.gdd_generation_job_id = v_artifact.gdd_generation_job_id
  for update;
  if not found then
    select document.name into v_document_name
    from public.documents as document
    where document.id = v_artifact.gdd_document_id;
    insert into public.map_conversations (
      project_id, title, created_by, gdd_generation_job_id
    ) values (
      v_artifact.project_id,
      left(coalesce(nullif(btrim(v_document_name), ''), 'GDD map conversation'), 160),
      v_artifact.owner_id,
      v_artifact.gdd_generation_job_id
    ) returning * into v_conversation;
  end if;

  select node.id into v_plan_node_id
  from public.map_conversation_nodes as node
  where node.conversation_id = v_conversation.id
    and node.node_type = 'plan'
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

    select coalesce(max(sequence_number), 0) + 1 into v_sequence
    from public.map_conversation_messages as message
    where message.conversation_id = v_conversation.id;
    insert into public.map_conversation_messages (
      conversation_id, sequence_number, role, text, artifact_node_id, created_by
    ) values (
      v_conversation.id, v_sequence, 'assistant', 'GDD Map Plan created',
      v_plan_node_id, v_artifact.owner_id
    );
  end if;

  select node.id into v_map_node_id
  from public.map_conversation_nodes as node
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

    select coalesce(max(sequence_number), 0) + 1 into v_sequence
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

-- Recreate the GDD preparation RPC so every newly prepared image begins with
-- its durable Plan and Map nodes already visible in the conversation tree.
create or replace function public.prepare_gdd_map_artifact(
  p_artifact_id uuid,
  p_worker_id text,
  p_plan jsonb,
  p_scene jsonb,
  p_generation_id uuid,
  p_plan_fingerprint text
)
returns table(map_id uuid, generation_revision_id uuid, draft_revision_id uuid, asset_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.gdd_map_artifacts%rowtype;
  v_document public.documents%rowtype;
  v_map_id uuid := gen_random_uuid();
  v_generation_revision_id uuid := gen_random_uuid();
  v_draft_revision_id uuid := gen_random_uuid();
  v_plan_version_id uuid := gen_random_uuid();
  v_asset_id uuid := gen_random_uuid();
  v_generation_params jsonb;
begin
  select artifact.* into v_artifact
  from public.gdd_map_artifacts as artifact
  where artifact.id = p_artifact_id
    and artifact.status = 'running'
    and artifact.phase = 'planning'
    and artifact.lease_owner = p_worker_id
    and artifact.lease_expires_at >= now()
  for update;
  if not found then
    raise exception 'GDD map artifact lease was lost' using errcode = 'P0002';
  end if;

  if p_generation_id is null or p_plan_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid GDD map generation identity' using errcode = '22023';
  end if;
  perform public.map_validate_v3_payload(p_plan, p_scene);

  perform 1 from public.projects as project
  where project.id = v_artifact.project_id and project.owner_id = v_artifact.owner_id
  for share;
  if not found then
    perform 1 from public.project_collaborators as collaborator
    where collaborator.project_id = v_artifact.project_id
      and collaborator.user_id = v_artifact.owner_id
      and collaborator.role in ('admin', 'editor')
      and collaborator.accepted_at is not null
    for share;
    if not found then
      raise exception 'GDD map generation permission is no longer valid' using errcode = '42501';
    end if;
  end if;

  select document.* into v_document
  from public.documents as document
  where document.id = v_artifact.gdd_document_id
    and document.project_id = v_artifact.project_id
    and (
      document.gdd_generation_job_id = v_artifact.gdd_generation_job_id
      or document.gdd_generation_job_id is null
      or exists (
        select 1 from public.gdd_generation_jobs as job
        where job.id = v_artifact.gdd_generation_job_id
          and job.output_document_id = document.id
      )
    )
  for share;
  if not found then
    raise exception 'GDD map source Document is no longer valid' using errcode = 'P0002';
  end if;

  insert into public.map_projects (id, project_id, name, created_by)
  values (v_map_id, v_artifact.project_id, btrim(p_plan ->> 'name'), v_artifact.owner_id);

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_generation_revision_id, v_map_id, 1, 0, null,
    v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    3, p_plan, p_scene, 'draft', v_artifact.owner_id
  );

  update public.map_projects
  set current_revision_id = v_generation_revision_id, updated_at = now()
  where id = v_map_id;

  insert into public.map_plan_versions (
    id, map_project_id, plan_version_number, draft_revision_id, draft_save_version,
    plan, source_document_id, source_document_updated_at, source_epoch, source_revision,
    created_by
  ) values (
    v_plan_version_id, v_map_id, 1, v_generation_revision_id, 0,
    p_plan, v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    v_artifact.owner_id
  );

  update public.map_revisions
  set status = 'generating', plan_version_id = v_plan_version_id
  where id = v_generation_revision_id;

  insert into public.map_revisions (
    id, map_project_id, revision_number, save_version, parent_revision_id,
    source_document_id, source_document_updated_at, source_epoch, source_revision,
    schema_version, plan, scene, status, created_by
  ) values (
    v_draft_revision_id, v_map_id, 2, 0, v_generation_revision_id,
    v_document.id, v_document.updated_at, v_document.collab_epoch, v_document.collab_revision,
    3, p_plan, p_scene, 'draft', v_artifact.owner_id
  );

  update public.map_projects
  set current_revision_id = v_draft_revision_id, updated_at = now()
  where id = v_map_id;

  v_generation_params := jsonb_build_object(
    'width', (p_plan #>> '{map,width}')::integer,
    'height', (p_plan #>> '{map,height}')::integer,
    'noBackground', false,
    'seed', p_plan #> '{generation,seed}',
    'references', p_plan -> 'references',
    'styleReference', p_plan -> 'styleReference'
  );

  insert into public.map_assets (
    id, map_revision_id, generation_id, asset_key, kind, status,
    requested_capability, prompt, generation_params, reference_asset_ids,
    reference_hashes, plan_fingerprint, metadata
  ) values (
    v_asset_id, v_generation_revision_id, p_generation_id, 'map-image', 'map_image', 'planned',
    'direct_map_image', p_plan ->> 'description', v_generation_params, '{}'::uuid[],
    '{}'::text[], p_plan_fingerprint, jsonb_build_object(
      'source', 'gdd-generation',
      'gddMapArtifactId', v_artifact.id,
      'gddGenerationJobId', v_artifact.gdd_generation_job_id
    )
  );

  update public.gdd_map_artifacts as artifact
  set status = 'queued',
      phase = 'submitting',
      map_project_id = v_map_id,
      map_revision_id = v_generation_revision_id,
      map_asset_id = v_asset_id,
      generation_id = p_generation_id,
      plan_fingerprint = p_plan_fingerprint,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = null
  where artifact.id = v_artifact.id;

  perform public.ensure_gdd_map_artifact_conversation_v1(v_artifact.id);
  return query select v_map_id, v_generation_revision_id, v_draft_revision_id, v_asset_id;
end;
$$;

-- Save immutable Plan snapshots for historical GDD-derived draft branches so
-- they remain selectable bases even if no image generation was started.
insert into public.map_plan_versions (
  map_project_id, plan_version_number, draft_revision_id, draft_save_version,
  plan, source_document_id, source_document_updated_at, source_epoch,
  source_revision, created_by
)
select
  map.id,
  1,
  draft.id,
  draft.save_version,
  draft.plan,
  draft.source_document_id,
  draft.source_document_updated_at,
  draft.source_epoch,
  draft.source_revision,
  draft.created_by
from public.map_projects as map
join public.map_revisions as draft on draft.id = map.current_revision_id
join public.documents as document on document.id = draft.source_document_id
where draft.schema_version = 3
  and draft.status = 'draft'
  and document.gdd_generation_job_id is not null
  and not exists (
    select 1 from public.map_plan_versions as version
    where version.map_project_id = map.id
  );

-- The append-only trigger permits normal increments. Disable it briefly only
-- while replaying historical records, whose version counters are reconstructed
-- in one migration transaction.
alter table public.map_conversations disable trigger map_conversations_immutable;

do $$
declare
  candidate record;
  v_conversation public.map_conversations%rowtype;
  v_plan_node_id uuid;
  v_display_version bigint;
  v_sequence bigint;
begin
  for candidate in
    select distinct on (map.id)
      map.id as map_project_id,
      map.project_id,
      map.created_by,
      map.created_at as map_created_at,
      document.gdd_generation_job_id,
      document.name as document_name,
      version.id as plan_version_id
    from public.map_projects as map
    join public.map_revisions as revision on revision.id = map.current_revision_id
    join public.documents as document on document.id = revision.source_document_id
    join public.map_plan_versions as version on version.map_project_id = map.id
    where revision.schema_version = 3
      and document.gdd_generation_job_id is not null
    order by map.id, version.plan_version_number
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(candidate.gdd_generation_job_id::text, 0)
    );
    select conversation.* into v_conversation
    from public.map_conversations as conversation
    where conversation.gdd_generation_job_id = candidate.gdd_generation_job_id
    for update;
    if not found then
      insert into public.map_conversations (
        project_id, title, created_by, gdd_generation_job_id
      ) values (
        candidate.project_id,
        left(coalesce(nullif(btrim(candidate.document_name), ''), 'GDD map conversation'), 160),
        candidate.created_by,
        candidate.gdd_generation_job_id
      ) returning * into v_conversation;
    end if;

    select node.id into v_plan_node_id
    from public.map_conversation_nodes as node
    where node.conversation_id = v_conversation.id
      and node.node_type = 'plan'
      and node.map_project_id = candidate.map_project_id
      and node.map_plan_version_id = candidate.plan_version_id;
    if v_plan_node_id is null then
      update public.map_conversations
      set next_plan_display_version = next_plan_display_version + 1
      where id = v_conversation.id
      returning next_plan_display_version - 1 into v_display_version;
      insert into public.map_conversation_nodes (
        conversation_id, project_id, node_type, plan_display_version,
        map_project_id, map_plan_version_id, created_by
      ) values (
        v_conversation.id, candidate.project_id, 'plan', v_display_version,
        candidate.map_project_id, candidate.plan_version_id, candidate.created_by
      ) returning id into v_plan_node_id;
      select coalesce(max(sequence_number), 0) + 1 into v_sequence
      from public.map_conversation_messages
      where conversation_id = v_conversation.id;
      insert into public.map_conversation_messages (
        conversation_id, sequence_number, role, text, artifact_node_id, created_by
      ) values (
        v_conversation.id, v_sequence, 'assistant', 'GDD Map Plan created',
        v_plan_node_id, candidate.created_by
      );
    end if;
  end loop;
end;
$$;

alter table public.map_conversations enable trigger map_conversations_immutable;

-- Historical GDD image jobs may have completed before the conversation
-- library existed. Add their Map outputs under their already-backfilled Plan.
do $$
declare
  artifact record;
begin
  for artifact in
    select id from public.gdd_map_artifacts
    where map_project_id is not null
      and map_revision_id is not null
      and map_asset_id is not null
  loop
    perform public.ensure_gdd_map_artifact_conversation_v1(artifact.id);
  end loop;
end;
$$;

create function public.find_map_conversation_by_map_id_v1(p_map_project_id uuid)
returns table(conversation_id uuid, plan_node_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select node.conversation_id, node.id
  from public.map_conversation_nodes as node
  where node.node_type = 'plan'
    and node.map_project_id = p_map_project_id
    and (
      public.is_project_owner(node.project_id, (select auth.uid()))
      or public.is_accepted_collaborator(node.project_id, (select auth.uid()))
    )
  order by node.created_at, node.id
  limit 1;
end;
$$;

revoke all on function public.ensure_gdd_map_artifact_conversation_v1(uuid) from public, anon, authenticated;
grant execute on function public.ensure_gdd_map_artifact_conversation_v1(uuid) to service_role;
revoke all on function public.find_map_conversation_by_map_id_v1(uuid) from public, anon;
grant execute on function public.find_map_conversation_by_map_id_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
