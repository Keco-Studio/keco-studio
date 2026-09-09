-- Allow deleting documents that were used as Create Map / GDD map sources.
-- map_revisions.source_document_id is ON DELETE NO ACTION, and authenticated
-- clients only have SELECT on map tables — so document (and folder) deletes
-- otherwise fail with a foreign-key error and nothing is removed.

create or replace function public.documents_delete_dependent_map_projects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.map_projects
  where id in (
    select distinct mr.map_project_id
    from public.map_revisions mr
    where mr.source_document_id = old.id
  );
  return old;
end;
$$;

drop trigger if exists trg_documents_delete_dependent_map_projects on public.documents;
create trigger trg_documents_delete_dependent_map_projects
before delete on public.documents
for each row
execute function public.documents_delete_dependent_map_projects();

revoke all on function public.documents_delete_dependent_map_projects() from public;
revoke all on function public.documents_delete_dependent_map_projects() from anon, authenticated;
