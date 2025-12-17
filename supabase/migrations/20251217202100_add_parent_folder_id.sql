-- Add parent_folder_id to support nested folders
alter table public.folders 
add column if not exists parent_folder_id uuid references public.folders(id) on delete cascade;

-- Create index for parent_folder_id lookups
create index if not exists idx_folders_parent_folder on public.folders (parent_folder_id);

-- Update unique constraint to support nested folders
-- Drop the old constraint that only checked (project_id, name)
alter table public.folders drop constraint if exists folders_project_name_unique;

-- Create partial unique indexes:
-- 1. When parent_folder_id is null, (project_id, name) must be unique
create unique index if not exists idx_folders_project_name_unique 
  on public.folders (project_id, name) 
  where parent_folder_id is null;

-- 2. When parent_folder_id is not null, (parent_folder_id, name) must be unique
create unique index if not exists idx_folders_parent_name_unique 
  on public.folders (parent_folder_id, name) 
  where parent_folder_id is not null;

-- Create a function to validate that parent folder belongs to the same project
-- This function will be used in a trigger to ensure data integrity
create or replace function public.validate_folder_parent_project()
returns trigger
language plpgsql
as $$
begin
  -- If parent_folder_id is null, it's a root folder, which is always valid
  if NEW.parent_folder_id is null then
    return NEW;
  end if;
  
  -- Check if parent folder exists and belongs to the same project
  if not exists (
    select 1 from public.folders parent
    where parent.id = NEW.parent_folder_id 
    and parent.project_id = NEW.project_id
  ) then
    raise exception 'Parent folder must belong to the same project';
  end if;
  
  return NEW;
end;
$$;

-- Create trigger to validate parent folder on insert and update
drop trigger if exists trg_validate_folder_parent_project on public.folders;
create trigger trg_validate_folder_parent_project
before insert or update on public.folders
for each row
execute function public.validate_folder_parent_project();

-- Update RLS policies to handle nested folders
-- The existing policies already check project ownership, which is sufficient
-- since nested folders inherit project ownership through the parent chain
-- The check constraint above ensures parent_folder_id always points to a folder
-- in the same project, so RLS policies work correctly for nested folders.
