create table public.script_workspace_documents (
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  primary key (project_id, document_id)
);

create index script_workspace_documents_document_id_idx
  on public.script_workspace_documents (document_id);

alter table public.script_workspace_documents enable row level security;

create policy script_workspace_documents_select
  on public.script_workspace_documents for select
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid()))
  );

create policy script_workspace_documents_insert
  on public.script_workspace_documents for insert
  with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

create policy script_workspace_documents_delete
  on public.script_workspace_documents for delete
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

-- optional: no UPDATE policy (immutable membership rows; delete+insert if needed)
