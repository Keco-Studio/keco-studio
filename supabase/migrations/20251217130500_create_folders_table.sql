-- Create folders table to support project→folder→library hierarchy
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folders_project_name_unique unique (project_id, name),
  constraint folders_name_not_empty check (length(trim(name)) > 0)
);

-- Update libraries table to support optional folder_id
alter table public.libraries 
add column if not exists folder_id uuid references public.folders(id) on delete set null;

-- Indexes to support lookups
create index if not exists idx_folders_project on public.folders (project_id);
create index if not exists idx_libraries_folder on public.libraries (folder_id);

-- RLS for folders table
alter table public.folders enable row level security;

-- Folders policies (owner determined via parent project)
create policy folders_select_policy on public.folders
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = folders.project_id and p.owner_id = auth.uid()
    )
  );

create policy folders_insert_policy on public.folders
  for insert with check (
    auth.uid() is not null and
    exists (
      select 1 from public.projects p
      where p.id = folders.project_id and p.owner_id = auth.uid()
    )
  );

create policy folders_update_policy on public.folders
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = folders.project_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = folders.project_id and p.owner_id = auth.uid()
    )
  );

create policy folders_delete_policy on public.folders
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = folders.project_id and p.owner_id = auth.uid()
    )
  );

-- Update libraries unique constraint to support optional folder_id
-- Drop the old constraint that only checked (project_id, name)
alter table public.libraries drop constraint if exists libraries_project_name_unique;

-- Create partial unique indexes:
-- 1. When folder_id is null, (project_id, name) must be unique
create unique index if not exists idx_libraries_project_name_unique 
  on public.libraries (project_id, name) 
  where folder_id is null;

-- 2. When folder_id is not null, (folder_id, name) must be unique
create unique index if not exists idx_libraries_folder_name_unique 
  on public.libraries (folder_id, name) 
  where folder_id is not null;

-- Update libraries policies to handle folder-based access
drop policy if exists libraries_select_policy on public.libraries;
create policy libraries_select_policy on public.libraries
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

-- Update libraries insert policy to handle folder-based access
drop policy if exists libraries_insert_policy on public.libraries;
create policy libraries_insert_policy on public.libraries
  for insert with check (
    auth.uid() is not null and
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

-- Update libraries update policy to handle folder-based access
drop policy if exists libraries_update_policy on public.libraries;
create policy libraries_update_policy on public.libraries
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

-- Update libraries delete policy to handle folder-based access
drop policy if exists libraries_delete_policy on public.libraries;
create policy libraries_delete_policy on public.libraries
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

-- Helper function to create default Resources Folder for a project
create or replace function public.create_default_resources_folder_for_project(
  p_project_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.folders (project_id, name, description)
  values 
    (p_project_id, 'Resources Folder', 'Default resources folder');
end;
$$;

-- Update the existing project creation function to include default Resources Folder

-- 先删除旧版本（如果存在），以便安全地修改返回类型
drop function if exists public.create_project_with_default_resource(text, text);

-- 创建新函数，使用 JSON 返回类型
create or replace function public.create_project_with_default_resource(
  p_name text,
  p_description text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_folder_id uuid;
  v_user uuid := auth.uid();
  v_name text := trim(p_name);
  v_description text := nullif(trim(p_description), '');
  v_result json;
  v_user_email text;
begin
  if v_user is null then
    raise exception 'Unauthorized: auth.uid() is null';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'Project name required';
  end if;

  -- Ensure profile exists for the current user
  -- Get email from auth.users
  select email into v_user_email from auth.users where id = v_user;
  
  -- Insert profile if it doesn't exist (using on conflict to handle race conditions)
  insert into public.profiles (id, email, created_at, updated_at)
  values (v_user, v_user_email, now(), now())
  on conflict (id) do nothing;

  insert into public.projects (owner_id, name, description)
  values (v_user, v_name, v_description)
  returning id into v_project_id;

  -- Create default Resources Folder and get its ID
  insert into public.folders (project_id, name, description)
  values (v_project_id, 'Resources Folder', 'Default resources folder')
  returning id into v_folder_id;

  -- Return as JSON object
  v_result := json_build_object(
    'project_id', v_project_id,
    'folder_id', v_folder_id
  );

  return v_result;
end;
$$;