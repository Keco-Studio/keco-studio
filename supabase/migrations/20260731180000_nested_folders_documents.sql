-- P3: nested folders + nested documents

-- ---------------------------------------------------------------------------
-- folders.parent_folder_id
-- ---------------------------------------------------------------------------
alter table public.folders
  add column if not exists parent_folder_id uuid
    references public.folders(id) on delete restrict;

create index if not exists idx_folders_parent_folder_id
  on public.folders(parent_folder_id)
  where parent_folder_id is not null;

-- Name uniqueness: per root project, or per parent folder
alter table public.folders drop constraint if exists folders_project_name_unique;

create unique index if not exists idx_folders_project_root_name_unique
  on public.folders (project_id, name)
  where parent_folder_id is null;

create unique index if not exists idx_folders_parent_name_unique
  on public.folders (parent_folder_id, name)
  where parent_folder_id is not null;

create or replace function public.enforce_folder_nesting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.folders%rowtype;
  v_walk uuid;
  v_depth int := 1;
  v_max_depth constant int := 8;
begin
  if new.parent_folder_id is null then
    return new;
  end if;

  if new.parent_folder_id = new.id then
    raise exception 'Folder cannot be its own parent' using errcode = '23514';
  end if;

  select f.* into v_parent
  from public.folders f
  where f.id = new.parent_folder_id
  for share;

  if not found then
    raise exception 'Parent folder not found' using errcode = '23503';
  end if;

  if v_parent.project_id <> new.project_id then
    raise exception 'Parent folder must belong to the same project'
      using errcode = '23514';
  end if;

  -- Cycle + depth: walk ancestors of the new parent
  v_walk := new.parent_folder_id;
  while v_walk is not null loop
    if v_walk = new.id then
      raise exception 'Folder nesting would create a cycle' using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > v_max_depth then
      raise exception 'Folder nesting exceeds maximum depth of %', v_max_depth
        using errcode = '23514';
    end if;
    select f.parent_folder_id into v_walk
    from public.folders f
    where f.id = v_walk;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_folders_enforce_nesting on public.folders;
create trigger trg_folders_enforce_nesting
before insert or update of parent_folder_id, project_id
on public.folders
for each row execute function public.enforce_folder_nesting();

revoke all on function public.enforce_folder_nesting() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- documents.parent_document_id
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists parent_document_id uuid
    references public.documents(id) on delete cascade;

create index if not exists idx_documents_parent_document_id
  on public.documents(parent_document_id)
  where parent_document_id is not null;

create or replace function public.enforce_document_nesting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.documents%rowtype;
  v_walk uuid;
  v_depth int := 1;
  v_max_depth constant int := 8;
begin
  if new.parent_document_id is null then
    return new;
  end if;

  if new.parent_document_id = new.id then
    raise exception 'Document cannot be its own parent' using errcode = '23514';
  end if;

  select d.* into v_parent
  from public.documents d
  where d.id = new.parent_document_id
  for share;

  if not found then
    raise exception 'Parent document not found' using errcode = '23503';
  end if;

  if v_parent.project_id <> new.project_id then
    raise exception 'Parent document must belong to the same project'
      using errcode = '23514';
  end if;

  if v_parent.folder_id is distinct from new.folder_id then
    raise exception 'Nested document must follow the parent document folder'
      using errcode = '23514';
  end if;

  v_walk := new.parent_document_id;
  while v_walk is not null loop
    if v_walk = new.id then
      raise exception 'Document nesting would create a cycle' using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > v_max_depth then
      raise exception 'Document nesting exceeds maximum depth of %', v_max_depth
        using errcode = '23514';
    end if;
    select d.parent_document_id into v_walk
    from public.documents d
    where d.id = v_walk;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_documents_enforce_nesting on public.documents;
create trigger trg_documents_enforce_nesting
before insert or update of parent_document_id, folder_id, project_id
on public.documents
for each row execute function public.enforce_document_nesting();

revoke all on function public.enforce_document_nesting() from public, anon, authenticated;

-- When a document moves folders, nested children follow (like derived libraries).
create or replace function public.sync_nested_document_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.documents
  set folder_id = new.folder_id,
      updated_at = now()
  where parent_document_id = new.id
    and folder_id is distinct from new.folder_id;
  return new;
end;
$$;

drop trigger if exists trg_documents_sync_nested_folder on public.documents;
create trigger trg_documents_sync_nested_folder
after update of folder_id on public.documents
for each row
when (old.folder_id is distinct from new.folder_id)
execute function public.sync_nested_document_folder();

revoke all on function public.sync_nested_document_folder() from public, anon, authenticated;
