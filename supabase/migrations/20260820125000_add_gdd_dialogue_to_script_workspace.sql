-- Generated dialogue Documents must be Script workspace members so the
-- Script sidebar can group their derived Script libraries beneath them.

create or replace function public.sync_dialogue_document_to_script_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.gdd_generation_jobs as gdd_job
    join public.documents as source_document
      on source_document.id = new.document_id
    where gdd_job.id = new.gdd_generation_job_id
      and gdd_job.project_id = new.project_id
      and source_document.project_id = new.project_id
  ) then
    raise exception 'Dialogue job, source Document, and project do not agree' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    old.project_id is distinct from new.project_id
    or old.document_id is distinct from new.document_id
  ) then
    delete from public.script_workspace_documents
    where project_id = old.project_id and document_id = old.document_id;
  end if;

  insert into public.script_workspace_documents(project_id, document_id, imported_by)
  select new.project_id, new.document_id, gdd_job.owner_id
  from public.gdd_generation_jobs as gdd_job
  where gdd_job.id = new.gdd_generation_job_id
  on conflict (project_id, document_id) do nothing;

  return new;
end;
$$;

drop trigger if exists sync_dialogue_document_to_script_workspace
  on public.dialogue_generation_jobs;
create trigger sync_dialogue_document_to_script_workspace
  after insert or update of project_id, document_id, gdd_generation_job_id
  on public.dialogue_generation_jobs
  for each row execute function public.sync_dialogue_document_to_script_workspace();

insert into public.script_workspace_documents(project_id, document_id, imported_by)
select dialogue_job.project_id, dialogue_job.document_id, gdd_job.owner_id
from public.dialogue_generation_jobs as dialogue_job
join public.gdd_generation_jobs as gdd_job
  on gdd_job.id = dialogue_job.gdd_generation_job_id
join public.documents as source_document
  on source_document.id = dialogue_job.document_id
 and source_document.project_id = dialogue_job.project_id
where gdd_job.project_id = dialogue_job.project_id
on conflict (project_id, document_id) do nothing;

revoke all on function public.sync_dialogue_document_to_script_workspace()
  from public, anon, authenticated;
grant execute on function public.sync_dialogue_document_to_script_workspace()
  to service_role;

notify pgrst, 'reload schema';
