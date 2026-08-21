-- Version titles describe the generated change and always attribute it to the
-- user who started the GDD generation job.

create or replace function public.normalize_gdd_document_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_name text;
  v_version_summary text;
begin
  if new.version_type <> 'gdd_generation' then
    return new;
  end if;

  select document.name, nullif(btrim(document.gdd_generation_metadata ->> 'versionSummary'), '')
    into v_document_name, v_version_summary
    from public.documents as document
    where document.id = new.document_id;

  new.name := left(coalesce(v_version_summary, 'Update ' || v_document_name, 'Update GDD document'), 120);
  return new;
end;
$$;

drop trigger if exists normalize_gdd_document_version on public.document_versions;
create trigger normalize_gdd_document_version
  before insert on public.document_versions
  for each row execute function public.normalize_gdd_document_version();

create or replace function public.normalize_gdd_library_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_owner_id uuid;
  v_system_title text;
  v_dialogue_title text;
begin
  if new.version_type <> 'gdd_generation' then
    return new;
  end if;

  begin
    v_job_id := nullif(new.metadata ->> 'generationJobId', '')::uuid;
  exception when others then
    v_job_id := null;
  end;

  select job.owner_id, nullif(btrim(job.input ->> 'systemTitle'), '')
    into v_owner_id, v_system_title
    from public.gdd_generation_jobs as job
    where job.id = v_job_id;

  if v_owner_id is null then
    select generation.owner_id, nullif(btrim(dialogue.title), '')
      into v_owner_id, v_dialogue_title
      from public.dialogue_generation_jobs as dialogue
      join public.gdd_generation_jobs as generation
        on generation.id = dialogue.gdd_generation_job_id
      where dialogue.id = v_job_id;
  end if;

  new.created_by := coalesce(v_owner_id, new.created_by);
  new.version_name := left(
    case
      when v_dialogue_title is not null then 'Update dialogue: ' || v_dialogue_title
      when v_system_title is not null then 'Update GDD resources for ' || v_system_title
      else 'Update generated GDD resource'
    end,
    120
  );
  return new;
end;
$$;

drop trigger if exists normalize_gdd_library_version on public.library_versions;
create trigger normalize_gdd_library_version
  before insert on public.library_versions
  for each row execute function public.normalize_gdd_library_version();
