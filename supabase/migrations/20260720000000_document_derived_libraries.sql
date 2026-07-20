alter table public.libraries
  add column if not exists source_document_id uuid
    references public.documents(id) on delete cascade,
  add column if not exists document_export_type text;

alter table public.libraries
  add constraint libraries_document_export_type_check
    check (document_export_type is null or document_export_type in ('table', 'script')),
  add constraint libraries_document_export_pair_check
    check ((source_document_id is null) = (document_export_type is null));

create index if not exists idx_libraries_source_document_id
  on public.libraries(source_document_id)
  where source_document_id is not null;

create or replace function public.enforce_derived_library_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
begin
  if new.source_document_id is null then
    return new;
  end if;

  select d.* into v_document
  from public.documents d
  where d.id = new.source_document_id;

  if not found then
    raise exception 'Source document not found' using errcode = '23503';
  end if;
  if v_document.project_id <> new.project_id then
    raise exception 'Derived library must belong to the source document project'
      using errcode = '23514';
  end if;
  if v_document.folder_id is distinct from new.folder_id then
    raise exception 'Derived library must follow the source document folder'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_libraries_derived_document
before insert or update of project_id, folder_id, source_document_id, document_export_type
on public.libraries
for each row execute function public.enforce_derived_library_document();

create or replace function public.sync_derived_library_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.libraries
  set folder_id = new.folder_id,
      updated_at = now()
  where source_document_id = new.id
    and folder_id is distinct from new.folder_id;
  return new;
end;
$$;

create trigger trg_documents_sync_derived_library_folder
after update of folder_id on public.documents
for each row
when (old.folder_id is distinct from new.folder_id)
execute function public.sync_derived_library_folder();

revoke all on function public.enforce_derived_library_document() from public, anon, authenticated;
revoke all on function public.sync_derived_library_folder() from public, anon, authenticated;
