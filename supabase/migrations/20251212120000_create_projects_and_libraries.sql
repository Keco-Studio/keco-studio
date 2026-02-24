-- Create projects table
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_owner_name_unique unique (owner_id, name),
  constraint projects_name_not_empty check (length(trim(name)) > 0)
);

-- Create libraries table
create table if not exists public.libraries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint libraries_project_name_unique unique (project_id, name),
  constraint libraries_name_not_empty check (length(trim(name)) > 0)
);

-- Indexes to support lookups
create index if not exists idx_projects_owner on public.projects (owner_id);
create index if not exists idx_libraries_project on public.libraries (project_id);

-- RLS
alter table public.projects enable row level security;
alter table public.libraries enable row level security;

create policy projects_select_policy on public.projects
  for select using (owner_id = auth.uid());

create policy projects_insert_policy on public.projects
  for insert with check (auth.uid() is not null and owner_id = auth.uid());

create policy projects_update_policy on public.projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy projects_delete_policy on public.projects
  for delete using (owner_id = auth.uid());

-- Libraries policies (owner determined via parent project)
create policy libraries_select_policy on public.libraries
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

create policy libraries_insert_policy on public.libraries
  for insert with check (
    auth.uid() is not null and
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

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

create policy libraries_delete_policy on public.libraries
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = libraries.project_id and p.owner_id = auth.uid()
    )
  );

-- Helper function to create project with default Resource library transactionally
create or replace function public.create_project_with_default_resource(
  p_name text,
  p_description text default null
) returns table(project_id uuid, library_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_library_id uuid;
  v_user uuid := auth.uid();
  v_name text := trim(p_name);
  v_description text := nullif(trim(p_description), '');
begin
  if v_user is null then
    raise exception 'Unauthorized: auth.uid() is null';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'Project name required';
  end if;

  insert into public.projects (owner_id, name, description)
  values (v_user, v_name, v_description)
  returning id into v_project_id;

  insert into public.libraries (project_id, name)
  values (v_project_id, 'Resource')
  returning id into v_library_id;

  return query select v_project_id, v_library_id;
end;
$$;


