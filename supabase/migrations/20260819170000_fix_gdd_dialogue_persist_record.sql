-- Fix 10-arg persist_completed_gdd_generation_job: anonymous record variables
-- cannot expose OUT column names, so (v_result).document_id fails with 42703.

create or replace function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb,
  p_dialogue_resources jsonb
)
returns table(document_id uuid, document_name text, folder_id uuid, table_ids uuid[], table_names text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_persisted_document_id uuid;
  v_persisted_document_name text;
  v_folder_id uuid;
  v_table_ids uuid[];
  v_table_names text[];
  v_job public.gdd_generation_jobs%rowtype;
  v_resource jsonb;
  v_dialogue_job_id uuid;
  v_document_id uuid;
  v_key text;
  v_title text;
  v_content text;
  v_existing_project_id uuid;
begin
  select * into v_job from public.gdd_generation_jobs where id = p_job_id for update;
  if not found then raise exception 'GDD generation job not found' using errcode = 'P0002'; end if;

  select persisted.document_id, persisted.document_name, persisted.folder_id,
         persisted.table_ids, persisted.table_names
  into v_persisted_document_id, v_persisted_document_name, v_folder_id, v_table_ids, v_table_names
  from public.persist_completed_gdd_generation_job(
    p_job_id, p_worker_id, p_markdown, p_yjs_state, p_description,
    p_metadata, p_applied_rule_ids, p_omitted_rule_ids, p_table_resources
  ) as persisted;

  if p_dialogue_resources is null or jsonb_typeof(p_dialogue_resources) <> 'array' then
    raise exception 'GDD dialogue resources must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_dialogue_resources) > 50 then
    raise exception 'GDD dialogue resources must contain at most 50 entries' using errcode = '22023';
  end if;

  for v_resource in select value from jsonb_array_elements(p_dialogue_resources) loop
    if jsonb_typeof(v_resource) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_resource) as resource_key(name)
        where resource_key.name <> all(array['dialogueJobId', 'documentId', 'chapterKey', 'title', 'content', 'hasChoices', 'branchSummary'])
      ) then
      raise exception 'Invalid generated dialogue resource' using errcode = '22023';
    end if;
    begin
      v_dialogue_job_id := (v_resource ->> 'dialogueJobId')::uuid;
      v_document_id := (v_resource ->> 'documentId')::uuid;
    exception when others then
      raise exception 'Invalid generated dialogue resource ID' using errcode = '22023';
    end;
    v_key := btrim(v_resource ->> 'chapterKey');
    v_title := btrim(v_resource ->> 'title');
    v_content := v_resource ->> 'content';
    if v_key is null or length(v_key) not between 1 and 120
      or v_title is null or length(v_title) not between 1 and 160
      or length(v_content) not between 1 and 120000
      or jsonb_typeof(v_resource -> 'hasChoices') <> 'boolean'
      or jsonb_typeof(v_resource -> 'branchSummary') <> 'array'
      or jsonb_array_length(v_resource -> 'branchSummary') > 50
      or exists (
        select 1 from jsonb_array_elements(v_resource -> 'branchSummary') as branch(value)
        where jsonb_typeof(branch.value) <> 'string' or length(branch.value #>> '{}') > 300
      ) then
      raise exception 'Invalid generated dialogue resource' using errcode = '22023';
    end if;

    select document.project_id
    into v_existing_project_id
    from public.documents as document
    where document.id = v_document_id
    for update;
    if v_existing_project_id is null then
      insert into public.documents(id, project_id, folder_id, name, description, content, created_by)
      values (
        v_document_id,
        v_job.project_id,
        v_folder_id,
        v_title || ' dialogue',
        'Generated dialogue chapter.',
        v_content,
        v_job.owner_id
      );
    elsif v_existing_project_id <> v_job.project_id then
      raise exception 'Dialogue source Document belongs to another project' using errcode = '42501';
    end if;

    insert into public.dialogue_generation_jobs(
      id, gdd_generation_job_id, project_id, chapter_key, title, source_content, document_id
    ) values (
      v_dialogue_job_id, v_job.id, v_job.project_id, v_key, v_title, v_content, v_document_id
    )
    on conflict (gdd_generation_job_id, chapter_key) do update set
      title = excluded.title,
      document_id = excluded.document_id,
      updated_at = now();
  end loop;

  return query select v_persisted_document_id, v_persisted_document_name,
    v_folder_id, v_table_ids, v_table_names;
end;
$$;

revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) to service_role;

notify pgrst, 'reload schema';
