-- Add updated_by column to libraries table
alter table public.libraries 
add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Add updated_by column to folders table
alter table public.folders 
add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Create indexes for updated_by lookups
create index if not exists idx_libraries_updated_by on public.libraries (updated_by);
create index if not exists idx_folders_updated_by on public.folders (updated_by);

-- Create trigger function to automatically set updated_by on update
create or replace function public.set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- Create triggers for libraries table
drop trigger if exists set_libraries_updated_by on public.libraries;
create trigger set_libraries_updated_by
  before update on public.libraries
  for each row
  execute function public.set_updated_by();

-- Create triggers for folders table
drop trigger if exists set_folders_updated_by on public.folders;
create trigger set_folders_updated_by
  before update on public.folders
  for each row
  execute function public.set_updated_by();

-- Also set updated_by on insert
create or replace function public.set_updated_by_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Create triggers for libraries table insert
drop trigger if exists set_libraries_updated_by_on_insert on public.libraries;
create trigger set_libraries_updated_by_on_insert
  before insert on public.libraries
  for each row
  execute function public.set_updated_by_on_insert();

-- Create triggers for folders table insert
drop trigger if exists set_folders_updated_by_on_insert on public.folders;
create trigger set_folders_updated_by_on_insert
  before insert on public.folders
  for each row
  execute function public.set_updated_by_on_insert();

-- Backfill existing records with owner_id as updated_by
-- For libraries, use the project owner
update public.libraries l
set updated_by = p.owner_id
from public.projects p
where l.project_id = p.id and l.updated_by is null;

-- For folders, use the project owner
update public.folders f
set updated_by = p.owner_id
from public.projects p
where f.project_id = p.id and f.updated_by is null;

