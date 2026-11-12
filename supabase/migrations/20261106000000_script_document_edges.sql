create table if not exists public.script_document_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  parent_document_id uuid not null references public.documents(id) on delete cascade,
  child_document_id uuid not null references public.documents(id) on delete cascade,
  branch_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint script_document_edges_distinct_documents check (parent_document_id <> child_document_id),
  constraint script_document_edges_unique_pair unique (project_id, folder_id, parent_document_id, child_document_id)
);

create index if not exists script_document_edges_folder_idx
  on public.script_document_edges (project_id, folder_id, sort_order, created_at);

alter table public.script_document_edges enable row level security;

create policy script_document_edges_select
  on public.script_document_edges for select
  using (public.is_project_owner(project_id, auth.uid()) or public.is_accepted_collaborator(project_id, auth.uid()));

create policy script_document_edges_insert
  on public.script_document_edges for insert
  with check (public.is_project_owner(project_id, auth.uid()) or public.is_accepted_collaborator(project_id, auth.uid()));

create policy script_document_edges_update
  on public.script_document_edges for update
  using (public.is_project_owner(project_id, auth.uid()) or public.is_accepted_collaborator(project_id, auth.uid()))
  with check (public.is_project_owner(project_id, auth.uid()) or public.is_accepted_collaborator(project_id, auth.uid()));

create policy script_document_edges_delete
  on public.script_document_edges for delete
  using (public.is_project_owner(project_id, auth.uid()) or public.is_accepted_collaborator(project_id, auth.uid()));
