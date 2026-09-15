-- Persist asynchronous map jobs together with the GDD references that expose
-- them. The snapshot comparison prevents a background worker from replacing
-- a newer table, dialogue, or collaborative document update.

drop function if exists public.materialize_gdd_resource_payload(
  uuid, text, text, text, jsonb, jsonb, jsonb
);

create or replace function public.materialize_gdd_resource_payload(
  p_job_id uuid,
  p_document_id uuid,
  p_worker_id text,
  p_expected_markdown text,
  p_markdown text,
  p_yjs_state text,
  p_metadata jsonb,
  p_table_resources jsonb,
  p_dialogue_resources jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document public.documents%rowtype;
begin
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  if p_expected_markdown is null then
    raise exception 'Expected GDD Markdown is required' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.id = p_job_id
    and job.status in ('completed', 'completed_with_map_failures')
    and job.resource_mode = 'async'
  for update;
  if not found then
    raise exception 'GDD parent is not available for resource materialization' using errcode = 'P0002';
  end if;
  if v_job.output_document_id is distinct from p_document_id then
    raise exception 'GDD output document does not match the resource job' using errcode = 'P0002';
  end if;

  select document.* into v_document
  from public.documents as document
  where document.id = p_document_id
    and document.project_id = v_job.project_id
    and document.gdd_generation_job_id = v_job.id
  for update;
  if not found then
    raise exception 'GDD output document is missing' using errcode = 'P0002';
  end if;
  if v_document.content is distinct from p_expected_markdown then
    raise exception 'GDD document changed during resource materialization' using errcode = 'PT409';
  end if;
  if exists (
    select 1
    from public.document_yjs_updates as update_tail
    where update_tail.document_id = v_document.id
      and update_tail.epoch = v_document.collab_epoch
  ) then
    raise exception 'GDD Document has pending collaborative edits' using errcode = 'PT409';
  end if;

  update public.gdd_generation_jobs
  set status = 'running',
      lease_owner = p_worker_id,
      lease_expires_at = now() + interval '5 minutes',
      heartbeat_at = now()
  where id = v_job.id;

  perform public.persist_completed_gdd_generation_job(
    v_job.id,
    p_worker_id,
    p_markdown,
    p_yjs_state,
    'Async GDD resources',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('resourceOnly', true),
    v_job.applied_rule_ids,
    v_job.omitted_rule_ids,
    coalesce(p_table_resources, '[]'::jsonb),
    coalesce(p_dialogue_resources, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.materialize_gdd_resource_payload(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.materialize_gdd_resource_payload(
  uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.materialize_gdd_map_artifacts(
  p_job_id uuid,
  p_document_id uuid,
  p_expected_markdown text,
  p_markdown text,
  p_yjs_state text,
  p_map_artifacts jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document public.documents%rowtype;
  v_artifact jsonb;
  v_artifact_count integer;
  v_inserted_count integer := 0;
  v_row_count integer;
begin
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  if p_expected_markdown is null then
    raise exception 'Expected GDD Markdown is required' using errcode = '22023';
  end if;
  if p_map_artifacts is null or jsonb_typeof(p_map_artifacts) <> 'array' then
    raise exception 'GDD map artifacts must be an array' using errcode = '22023';
  end if;
  v_artifact_count := jsonb_array_length(p_map_artifacts);
  if v_artifact_count < 1 or v_artifact_count > 3 then
    raise exception 'A GDD map writeback requires between one and three artifacts' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.id = p_job_id
    and job.status in ('completed', 'completed_with_map_failures')
    and job.resource_mode = 'async'
  for update;
  if not found then
    raise exception 'GDD parent is not available for map materialization' using errcode = 'P0002';
  end if;
  if v_job.output_document_id is distinct from p_document_id then
    raise exception 'GDD output document does not match the map resource job' using errcode = 'P0002';
  end if;

  select document.* into v_document
  from public.documents as document
  where document.id = p_document_id
    and document.project_id = v_job.project_id
    and document.gdd_generation_job_id = v_job.id
  for update;
  if not found then
    raise exception 'GDD output document is missing' using errcode = 'P0002';
  end if;
  if v_document.content is distinct from p_expected_markdown then
    raise exception 'GDD document changed during map materialization' using errcode = 'PT409';
  end if;
  if exists (
    select 1
    from public.document_yjs_updates as update_tail
    where update_tail.document_id = v_document.id
      and update_tail.epoch = v_document.collab_epoch
  ) then
    raise exception 'GDD Document has pending collaborative edits' using errcode = 'PT409';
  end if;

  for v_artifact in select value from jsonb_array_elements(p_map_artifacts) loop
    if jsonb_typeof(v_artifact) <> 'object'
      or coalesce(v_artifact ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_artifact ->> 'mapBriefId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or not (char_length(btrim(coalesce(v_artifact ->> 'title', ''))) between 1 and 160)
      or jsonb_typeof(v_artifact -> 'mapBrief') is distinct from 'object'
      or jsonb_typeof(v_artifact -> 'styleContract') not in ('null', 'object')
      or coalesce(v_artifact ->> 'inputHash', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid GDD map artifact payload' using errcode = '22023';
    end if;

    insert into public.gdd_map_artifacts (
      id,
      gdd_generation_job_id,
      gdd_document_id,
      project_id,
      owner_id,
      design_system_id,
      version_id,
      map_brief_id,
      title,
      map_brief,
      style_contract,
      input_hash
    ) values (
      (v_artifact ->> 'id')::uuid,
      v_job.id,
      v_document.id,
      v_job.project_id,
      v_job.owner_id,
      v_job.design_system_id,
      v_job.version_id,
      (v_artifact ->> 'mapBriefId')::uuid,
      btrim(v_artifact ->> 'title'),
      v_artifact -> 'mapBrief',
      v_artifact -> 'styleContract',
      v_artifact ->> 'inputHash'
    ) on conflict (gdd_generation_job_id, map_brief_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted_count := v_inserted_count + v_row_count;
  end loop;

  update public.documents as document
  set content = p_markdown,
      yjs_state = p_yjs_state,
      collab_epoch = document.collab_epoch + 1,
      collab_revision = document.collab_revision + 1,
      collab_epoch_reason = 'agent',
      updated_at = now()
  where document.id = v_document.id;

  return v_inserted_count;
end;
$$;

revoke all on function public.materialize_gdd_map_artifacts(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.materialize_gdd_map_artifacts(
  uuid, uuid, text, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
