-- Name generated GDD documents "{project name} gdd" instead of a shared
-- generic title that collides across generations.

create or replace function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[]
)
returns table(document_id uuid, document_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document_id uuid;
  v_document_name text;
  v_project_name text;
  v_base_name text;
  v_suffix integer := 1;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'GDD generation metadata must be an object' using errcode = '22023';
  end if;
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at >= now()
  for update;
  if not found then
    raise exception 'GDD generation job lease was lost' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_job.project_id::text, 0));

  perform 1
  from public.projects as project
  where project.id = v_job.project_id
    and project.owner_id = v_job.owner_id
  for share;
  if not found then
    perform 1
    from public.project_collaborators as collaborator
    where collaborator.project_id = v_job.project_id
      and collaborator.user_id = v_job.owner_id
      and collaborator.role in ('admin', 'editor')
      and collaborator.accepted_at is not null
    for share;
    if not found then
      raise exception 'GDD generation permission is no longer valid' using errcode = '42501';
    end if;
  end if;

  perform 1
  from public.project_game_design_systems as binding
  where binding.project_id = v_job.project_id
    and binding.design_system_id = v_job.design_system_id
    and binding.version_id = v_job.version_id
  for share;
  if not found then
    raise exception 'GDD generation binding is no longer valid' using errcode = 'P0002';
  end if;

  select btrim(project.name)
  into v_project_name
  from public.projects as project
  where project.id = v_job.project_id
  for share;
  if v_project_name is null or v_project_name = '' then
    raise exception 'GDD generation project was not found' using errcode = 'P0002';
  end if;
  v_base_name := v_project_name || ' gdd';

  select document.id, document.name
  into v_document_id, v_document_name
  from public.documents as document
  where document.gdd_generation_job_id = v_job.id
  for update;

  if v_document_id is null then
    v_document_name := v_base_name;
    while exists (
      select 1 from public.documents as document
      where document.project_id = v_job.project_id
        and document.name = v_document_name
    ) loop
      v_suffix := v_suffix + 1;
      v_document_name := v_base_name || ' (' || v_suffix::text || ')';
    end loop;

    insert into public.documents (
      project_id,
      folder_id,
      name,
      description,
      content,
      yjs_state,
      created_by,
      gdd_generation_job_id,
      gdd_generation_metadata
    ) values (
      v_job.project_id,
      null,
      v_document_name,
      left(coalesce(p_description, ''), 250),
      p_markdown,
      p_yjs_state,
      v_job.owner_id,
      v_job.id,
      p_metadata
    )
    returning id into v_document_id;
  else
    update public.documents as document
    set content = p_markdown,
        yjs_state = p_yjs_state,
        description = left(coalesce(p_description, ''), 250),
        gdd_generation_metadata = p_metadata
    where document.id = v_document_id;
  end if;

  update public.gdd_generation_jobs as job
  set status = 'completed',
      phase = 'completed',
      output_document_id = v_document_id,
      output_document_name = v_document_name,
      applied_rule_ids = coalesce(p_applied_rule_ids, '{}'::text[]),
      omitted_rule_ids = coalesce(p_omitted_rule_ids, '{}'::text[]),
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = null
  where job.id = v_job.id;

  return query select v_document_id, v_document_name;
end;
$$;

revoke all on function public.persist_completed_gdd_generation_job(uuid, text, text, text, text, jsonb, text[], text[]) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(uuid, text, text, text, text, jsonb, text[], text[]) to service_role;

notify pgrst, 'reload schema';
