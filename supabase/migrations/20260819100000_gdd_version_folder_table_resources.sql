-- Persist each generated GDD and its independent tables in one job-owned folder.

alter table public.gdd_generation_jobs
  add column if not exists output_folder_id uuid references public.folders(id) on delete set null,
  add column if not exists output_table_ids uuid[] not null default '{}'::uuid[],
  add column if not exists output_table_names text[] not null default '{}'::text[];

alter table public.folders
  add column if not exists gdd_generation_job_id uuid
    references public.gdd_generation_jobs(id) on delete set null;

alter table public.libraries
  add column if not exists gdd_generation_job_id uuid
    references public.gdd_generation_jobs(id) on delete set null;

create unique index if not exists folders_gdd_generation_job_idx
  on public.folders(gdd_generation_job_id)
  where gdd_generation_job_id is not null;

create index if not exists libraries_gdd_generation_job_idx
  on public.libraries(gdd_generation_job_id)
  where gdd_generation_job_id is not null;

grant select (output_folder_id, output_table_ids, output_table_names)
  on public.gdd_generation_jobs to authenticated;

drop function if exists public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[]
);

create function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb default '[]'::jsonb
)
returns table(
  document_id uuid,
  document_name text,
  folder_id uuid,
  table_ids uuid[],
  table_names text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_document_id uuid;
  v_document_name text;
  v_folder_id uuid;
  v_folder_name text;
  v_project_name text;
  v_base_name text;
  v_suffix integer := 1;
  v_version integer;
  v_resource jsonb;
  v_table_id uuid;
  v_table_name text;
  v_purpose text;
  v_fields jsonb;
  v_field jsonb;
  v_field_label text;
  v_field_index integer;
  v_table_ids uuid[] := '{}'::uuid[];
  v_table_names text[] := '{}'::text[];
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'GDD generation metadata must be an object' using errcode = '22023';
  end if;
  if p_table_resources is null or jsonb_typeof(p_table_resources) <> 'array'
    or jsonb_array_length(p_table_resources) > 20 then
    raise exception 'GDD table resources must be an array with at most 20 entries'
      using errcode = '22023';
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job.project_id::text, 0)
  );

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

  select folder.id, folder.name
  into v_folder_id, v_folder_name
  from public.folders as folder
  where folder.gdd_generation_job_id = v_job.id
  for update;

  if v_folder_id is null then
    select count(*) + 1
    into v_version
    from public.folders as folder
    where folder.project_id = v_job.project_id
      and folder.gdd_generation_job_id is not null;
    v_folder_name := v_project_name || ' GDD '
      || to_char(v_job.created_at at time zone 'UTC', 'YYYY-MM-DD')
      || ' v' || v_version::text;
    v_base_name := v_folder_name;
    v_suffix := 1;
    while exists (
      select 1 from public.folders as folder
      where folder.project_id = v_job.project_id
        and folder.parent_folder_id is null
        and lower(btrim(folder.name)) = lower(btrim(v_folder_name))
    ) loop
      v_suffix := v_suffix + 1;
      v_folder_name := v_base_name || ' (' || v_suffix::text || ')';
    end loop;
    insert into public.folders(
      project_id, parent_folder_id, name, description, gdd_generation_job_id
    ) values (
      v_job.project_id,
      null,
      v_folder_name,
      'Generated GDD version resources.',
      v_job.id
    ) returning id into v_folder_id;
  end if;

  for v_resource in select value from jsonb_array_elements(p_table_resources) loop
    if jsonb_typeof(v_resource) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_resource) as resource_key(name)
        where resource_key.name <> all(array['id', 'table', 'purpose', 'fields'])
      ) then
      raise exception 'Invalid generated table resource' using errcode = '22023';
    end if;
    begin
      v_table_id := (v_resource ->> 'id')::uuid;
    exception when others then
      raise exception 'Invalid generated table resource ID' using errcode = '22023';
    end;
    v_table_name := btrim(v_resource ->> 'table');
    v_purpose := btrim(v_resource ->> 'purpose');
    v_fields := v_resource -> 'fields';
    if v_table_name is null or length(v_table_name) not between 1 and 120
      or v_purpose is null or length(v_purpose) not between 1 and 500
      or jsonb_typeof(v_fields) <> 'array'
      or jsonb_array_length(v_fields) not between 1 and 100
      or exists (
        select 1 from jsonb_array_elements(v_fields) as field(value)
        where jsonb_typeof(field.value) <> 'string'
          or length(btrim(field.value #>> '{}')) not between 1 and 120
      )
      or (
        select count(distinct lower(btrim(field.value #>> '{}')))
        from jsonb_array_elements(v_fields) as field(value)
      ) <> jsonb_array_length(v_fields) then
      raise exception 'Invalid generated table definition' using errcode = '22023';
    end if;

    perform 1
    from public.libraries as library
    where library.id = v_table_id
      and library.gdd_generation_job_id = v_job.id
      and library.project_id = v_job.project_id
      and library.folder_id = v_folder_id
    for update;
    if not found then
      if exists (select 1 from public.libraries where id = v_table_id) then
        raise exception 'Generated table ID is already in use' using errcode = '23505';
      end if;
      insert into public.libraries(
        id, project_id, folder_id, name, description, gdd_generation_job_id
      ) values (
        v_table_id, v_job.project_id, v_folder_id, v_table_name, v_purpose, v_job.id
      );

      v_field_index := 0;
      for v_field in select value from jsonb_array_elements(v_fields) loop
        v_field_label := btrim(v_field #>> '{}');
        insert into public.library_field_definitions(
          library_id, section, section_id, label, data_type, required,
          description, order_index
        ) values (
          v_table_id,
          '__keco_flat_fields__',
          md5(v_table_id::text || '::keco-flat-fields'),
          v_field_label,
          'string',
          false,
          null,
          v_field_index
        );
        v_field_index := v_field_index + 1;
      end loop;
    else
      select library.name into v_table_name
      from public.libraries as library
      where library.id = v_table_id;
    end if;
    v_table_ids := array_append(v_table_ids, v_table_id);
    v_table_names := array_append(v_table_names, v_table_name);
  end loop;

  v_base_name := v_project_name || ' gdd';
  select document.id, document.name
  into v_document_id, v_document_name
  from public.documents as document
  where document.gdd_generation_job_id = v_job.id
  for update;

  if v_document_id is null then
    v_document_name := v_base_name;
    v_suffix := 1;
    while exists (
      select 1 from public.documents as document
      where document.project_id = v_job.project_id
        and document.name = v_document_name
    ) loop
      v_suffix := v_suffix + 1;
      v_document_name := v_base_name || ' (' || v_suffix::text || ')';
    end loop;
    insert into public.documents(
      project_id, folder_id, name, description, content, yjs_state,
      created_by, gdd_generation_job_id, gdd_generation_metadata
    ) values (
      v_job.project_id,
      v_folder_id,
      v_document_name,
      left(coalesce(p_description, ''), 250),
      p_markdown,
      p_yjs_state,
      v_job.owner_id,
      v_job.id,
      p_metadata
    ) returning id into v_document_id;
  else
    update public.documents as document
    set folder_id = v_folder_id,
        content = p_markdown,
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
      output_folder_id = v_folder_id,
      output_table_ids = v_table_ids,
      output_table_names = v_table_names,
      applied_rule_ids = coalesce(p_applied_rule_ids, '{}'::text[]),
      omitted_rule_ids = coalesce(p_omitted_rule_ids, '{}'::text[]),
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      error = null
  where job.id = v_job.id;

  return query select
    v_document_id, v_document_name, v_folder_id, v_table_ids, v_table_names;
end;
$$;

revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) to service_role;

notify pgrst, 'reload schema';
