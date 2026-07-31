-- Allow attach/detach of document-derived libraries via DnD (P2).
-- Keep project/folder integrity when ownership is set; allow clearing both fields.

create or replace function public.enforce_derived_library_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
begin
  -- Detached / ordinary library: no source ownership to validate.
  if new.source_document_id is null then
    return new;
  end if;

  select d.* into v_document
  from public.documents d
  where d.id = new.source_document_id
  for share;

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

revoke all on function public.enforce_derived_library_document() from public, anon, authenticated;
